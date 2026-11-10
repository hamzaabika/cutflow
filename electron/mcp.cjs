// Minimal MCP (Model Context Protocol) client: speaks JSON-RPC to a server over one of
// two transports — stdio (spawn the server process, newline-delimited messages) or
// streamable HTTP (POST each message to the server's URL; the answer comes back as a
// JSON body or an SSE stream, and the session id the server mints at initialize is
// carried on later requests). A server config picks its transport by shape:
// { name, command, args, env? } for stdio, { name, url, env?, headers? } for HTTP.
// Per-server env vars merge over the app's own environment: they become the spawned
// process's environment on stdio, and on HTTP they feed ${VAR} expansion in header
// values (so an Authorization token can live in the environment, not the config).
// Deliberately free of Electron imports so it can be unit-tested in plain node
// (scripts/test-mcp.mjs, scripts/test-mcp-http.mjs).
const { spawn } = require('child_process');

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'ClipCraft', version: '2.0.0' };

class McpError extends Error {}

// The JSON-RPC response for `id` inside an HTTP answer body: a plain JSON
// document, or an SSE stream of `data:` payloads (the matching message is
// the one carrying the id; notifications in the stream are skipped).
function parseHttpBody(contentType, text, id) {
  if (!text) return null;
  if (String(contentType).includes('text/event-stream')) {
    let fallback = null;
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      try {
        const msg = JSON.parse(t.slice(5).trim());
        if (msg && msg.id === id) return msg;
        if (msg && msg.id !== undefined) fallback = msg;
      } catch { /* a malformed event is not the answer */ }
    }
    return fallback;
  }
  try { return JSON.parse(text); } catch { return null; }
}

class McpClient {
  constructor(server, { timeoutMs = 20000 } = {}) {
    this.server = server; // { name, command?, args?, url?, env?, headers? }
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.buffer = '';
    this.nextId = 1;
    this.pending = new Map(); // id -> { resolve, reject } (stdio transport)
    this.started = null; // promise of the initialize handshake
    this.sessionId = null; // HTTP transport: the server's mcp-session-id, once minted
  }

  get isHttp() { return !!this.server.url; }

  start() {
    if (this.started) return this.started;
    this.started = (async () => {
      if (!this.isHttp) {
        const { command, args = [] } = this.server;
        if (!command) throw new McpError('This MCP server has no command.');
        this.proc = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, ...(this.server.env || {}) },
        });
        this.proc.stdout.setEncoding('utf8');
        this.proc.stdout.on('data', (chunk) => this.onData(chunk));
        this.proc.stderr.setEncoding('utf8');
        this.proc.stderr.on('data', () => {}); // server logs: drained, not shown
        this.proc.on('error', (e) => this.failAll(new McpError(`Could not start the MCP server "${this.server.name}": ${e.message}`)));
        this.proc.on('exit', (code) => {
          if (this.pending.size) this.failAll(new McpError(`The MCP server "${this.server.name}" exited (code ${code}).`));
          this.proc = null;
        });
      }
      const init = await this.request('initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      this.notify('notifications/initialized', {});
      return init;
    })();
    // A failed start must not poison later retries.
    this.started.catch(() => { this.started = null; });
    return this.started;
  }

  onData(chunk) {
    this.buffer += chunk;
    let at;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).trim();
      this.buffer = this.buffer.slice(at + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new McpError(msg.error.message || `MCP error ${msg.error.code}`));
        else resolve(msg.result);
      }
      // Server->client requests/notifications are not answered by this minimal client.
    }
  }

  failAll(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  // The merged environment for this server: the app's own, overridden by
  // the server's per-server vars. Stdio children inherit it directly; HTTP
  // uses it only to expand ${VAR} references in header values.
  env() {
    return { ...process.env, ...(this.server.env || {}) };
  }

  httpHeaders() {
    const env = this.env();
    const out = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    for (const [k, v] of Object.entries(this.server.headers || {})) {
      out[k] = String(v).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => (env[name] !== undefined ? String(env[name]) : ''));
    }
    if (this.sessionId) out['mcp-session-id'] = this.sessionId;
    return out;
  }

  // One HTTP round trip. Requests resolve with the message's result (the
  // pending map is a stdio concern — HTTP answers are per-request);
  // notifications resolve with null (a 202 with no body is the norm). The
  // session id the server returns at initialize is captured here and sent
  // on every later request, as the streamable-HTTP transport requires.
  async requestHttp(obj) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(this.server.url, {
        method: 'POST', headers: this.httpHeaders(), body: JSON.stringify(obj), signal: ctrl.signal,
      });
    } catch (e) {
      throw new McpError(e.name === 'AbortError'
        ? `The MCP server "${this.server.name}" did not answer "${obj.method}" in time.`
        : `Could not reach the MCP server "${this.server.name}": ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;
    if (obj.id === undefined) return null; // notification: status is all there is
    if (!res.ok) throw new McpError(`The MCP server "${this.server.name}" answered HTTP ${res.status} to "${obj.method}".`);
    const msg = parseHttpBody(res.headers.get('content-type') || '', await res.text(), obj.id);
    if (!msg) throw new McpError(`The MCP server "${this.server.name}" returned no answer to "${obj.method}".`);
    if (msg.error) throw new McpError(msg.error.message || `MCP error ${msg.error.code}`);
    return msg.result;
  }

  send(obj) {
    if (!this.proc || !this.proc.stdin.writable) throw new McpError(`The MCP server "${this.server.name}" is not running.`);
    this.proc.stdin.write(`${JSON.stringify(obj)}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    if (this.isHttp) return this.requestHttp({ jsonrpc: '2.0', id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`The MCP server "${this.server.name}" did not answer "${method}" in time.`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  notify(method, params) {
    if (this.isHttp) {
      // Fire and forget: a notification has no answer to wait for, and a
      // failed one surfaces on the next request, like a dead stdio server.
      this.requestHttp({ jsonrpc: '2.0', method, params }).catch(() => {});
      return;
    }
    try { this.send({ jsonrpc: '2.0', method, params }); } catch { /* a dead server surfaces on the next request */ }
  }

  async listTools() {
    await this.start();
    const res = await this.request('tools/list', {});
    return (res?.tools || []).map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object' } }));
  }

  async callTool(name, args) {
    await this.start();
    const res = await this.request('tools/call', { name, arguments: args || {} });
    if (res?.isError) {
      const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ');
      throw new McpError(text || `The MCP tool ${name} reported an error.`);
    }
    return res;
  }

  stop() {
    if (this.proc) { try { this.proc.kill(); } catch { /* already gone */ } this.proc = null; }
    this.sessionId = null; // HTTP: the session dies with the client; the next start re-initializes
    this.started = null;
    this.failAll(new McpError('The MCP client was stopped.'));
  }
}

// Keeps one client per configured server (keyed by its full transport
// shape — name + command + args, or name + url + env + headers), so agent
// runs reuse the spawned processes / HTTP sessions, and editing any part
// of a server's config earns it a fresh client. getServers() returns the
// current settings list.
function createRegistry(getServers) {
  const clients = new Map();
  const keyOf = (s) => [s.name, s.command || '', (s.args || []).join(' '), s.url || '',
    JSON.stringify(s.env || {}), JSON.stringify(s.headers || {})].join('\n');
  const clientFor = (server) => {
    const key = keyOf(server);
    if (!clients.has(key)) clients.set(key, new McpClient(server));
    return clients.get(key);
  };
  const sanitize = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';

  return {
    // Gemini-format tool declarations for every configured server, named mcp_<server>_<tool>.
    async declarations() {
      const decls = [];
      const problems = [];
      for (const server of getServers()) {
        try {
          const tools = await clientFor(server).listTools();
          for (const tool of tools) {
            decls.push({
              name: `mcp_${sanitize(server.name)}_${tool.name}`,
              description: `[MCP: ${server.name}] ${tool.description}`.trim(),
              parameters: tool.inputSchema,
              _mcp: { server: server.name, tool: tool.name },
            });
          }
        } catch (e) {
          problems.push({ server: server.name, error: e.message });
        }
      }
      return { decls, problems };
    },
    // Routes an mcp_<server>_<tool> call to its server.
    async call(prefixedName, args) {
      const servers = getServers().slice().sort((a, b) => sanitize(b.name).length - sanitize(a.name).length);
      for (const server of servers) {
        const prefix = `mcp_${sanitize(server.name)}_`;
        if (prefixedName.startsWith(prefix)) {
          const tool = prefixedName.slice(prefix.length);
          const res = await clientFor(server).callTool(tool, args);
          const text = (res?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
          return { result: text || res };
        }
      }
      throw new McpError(`No MCP server matches the tool "${prefixedName}".`);
    },
    async test(server) {
      const client = new McpClient(server, { timeoutMs: 15000 });
      try {
        const tools = await client.listTools();
        return { ok: true, tools: tools.map((t) => t.name) };
      } catch (e) {
        return { ok: false, error: e.message };
      } finally {
        client.stop();
      }
    },
    stopAll() { for (const c of clients.values()) c.stop(); clients.clear(); },
  };
}

module.exports = { McpClient, McpError, createRegistry, PROTOCOL_VERSION, parseHttpBody };
