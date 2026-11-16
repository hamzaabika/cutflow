// MCP streamable-HTTP transport + per-server env vars (10/10 step 4):
// the existing McpClient gains an HTTP transport beside stdio (the verdict
// recorded in held-changes.md: the client's request/notify surface was
// already transport-shaped, so the split is internal — no caller changes).
// Proven here against a real local HTTP stub (scripts/fixtures/
// mcp-http-stub.mjs):
//   1. initialize / tools/list / tools/call over HTTP (JSON answers).
//   2. The mcp-session-id minted at initialize is carried on later calls
//      (the stub's whoami tool reports what it SAW).
//   3. SSE answers: a notification event ahead of the response is skipped,
//      the response is matched by id.
//   4. ${VAR} header expansion: from the process environment, and with a
//      per-server env override winning over it.
//   5. Per-server env reaches a spawned stdio server's own environment.
//   6. The settings sanitize keeps both transports and refuses bad ones.
//   7. The registry names and routes HTTP servers like stdio ones.
// The stdio suite (test-mcp.mjs) must keep passing unchanged.
// Usage: node scripts/test-mcp-http.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { McpClient, createRegistry, parseHttpBody } = require('../electron/mcp.cjs');
const { sanitizeMcpServer } = require('../electron/settings.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const httpStub = path.join(here, 'fixtures', 'mcp-http-stub.mjs');
const envStub = path.join(here, 'fixtures', 'mcp-env-stub.mjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// ---- parseHttpBody units ------------------------------------------------------
{
  const json = parseHttpBody('application/json', JSON.stringify({ jsonrpc: '2.0', id: 3, result: { ok: 1 } }), 3);
  ok(json && json.result.ok === 1, 'parse: a plain JSON answer is the message');
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":2}}\n\n';
  const fromSse = parseHttpBody('text/event-stream', sse, 7);
  ok(fromSse && fromSse.result.ok === 2, 'parse: an SSE stream yields the response matched by id, not the notification');
  ok(parseHttpBody('application/json', '', 1) === null, 'parse: an empty body is no answer');
}

// ---- the HTTP stub server -------------------------------------------------------
const stubProc = spawn(process.execPath, [httpStub], { stdio: ['ignore', 'pipe', 'pipe'] });
const port = await new Promise((resolve, reject) => {
  let buf = '';
  stubProc.stdout.setEncoding('utf8');
  stubProc.stdout.on('data', (d) => { buf += d; const m = buf.match(/PORT=(\d+)/); if (m) resolve(Number(m[1])); });
  stubProc.on('error', reject);
  setTimeout(() => reject(new Error('the HTTP stub did not announce a port')), 10000);
});
const base = `http://127.0.0.1:${port}/mcp`;

try {
  // 1+2. JSON mode: handshake, tools, and the session carried on later calls.
  {
    const client = new McpClient({ name: 'Stub HTTP', url: base }, { timeoutMs: 10000 });
    const init = await client.start();
    ok(init.serverInfo.name === 'stub-http', 'http: the initialize handshake returns the stub identity');
    const tools = await client.listTools();
    ok(JSON.stringify(tools.map((t) => t.name)) === '["echo","whoami"]', 'http: tools/list round-trips');
    const res = await client.callTool('echo', { text: 'hello http' });
    ok(res.content[0].text === 'echo: hello http', 'http: tools/call round-trips');
    const who = await client.callTool('whoami', {});
    const seen = JSON.parse(who.content[0].text);
    ok(seen.session === 'stub-session-1', `http: the minted session id is carried on later requests (saw ${seen.session})`);
    ok(seen.auth === null, 'http: no Authorization header is invented when none is configured');
    client.stop();
    ok(client.sessionId === null, 'http: stopping the client drops the session (the next start re-initializes)');
  }

  // 3. SSE mode.
  {
    const client = new McpClient({ name: 'Stub SSE', url: `${base}?mode=sse` }, { timeoutMs: 10000 });
    const tools = await client.listTools();
    ok(tools.length === 2, 'http/sse: tools/list survives an SSE stream with a leading notification');
    const res = await client.callTool('echo', { text: 'via sse' });
    ok(res.content[0].text === 'echo: via sse', 'http/sse: tools/call matches its response by id');
    client.stop();
  }

  // 4. Header expansion: process env, then the per-server override.
  {
    process.env.MCP_SUITE_TOKEN = 'from-process-env';
    const c1 = new McpClient({ name: 'Hdr', url: base, headers: { Authorization: 'Bearer ${MCP_SUITE_TOKEN}' } }, { timeoutMs: 10000 });
    const seen1 = JSON.parse((await c1.callTool('whoami', {})).content[0].text);
    ok(seen1.auth === 'Bearer from-process-env', 'headers: ${VAR} expands from the process environment');
    c1.stop();
    const c2 = new McpClient({ name: 'Hdr2', url: base, env: { MCP_SUITE_TOKEN: 'from-server-env' }, headers: { Authorization: 'Bearer ${MCP_SUITE_TOKEN}' } }, { timeoutMs: 10000 });
    const seen2 = JSON.parse((await c2.callTool('whoami', {})).content[0].text);
    ok(seen2.auth === 'Bearer from-server-env', 'headers: a per-server env var wins over the process environment');
    c2.stop();
    delete process.env.MCP_SUITE_TOKEN;
  }

  // 7. Registry over HTTP.
  {
    const registry = createRegistry(() => [{ name: 'Stub HTTP', url: base }]);
    const { decls, problems } = await registry.declarations();
    ok(problems.length === 0 && decls.some((d) => d.name === 'mcp_stub-http_echo'), 'registry: an HTTP server declares mcp_<server>_<tool> like a stdio one');
    const routed = await registry.call('mcp_stub-http_echo', { text: 'routed http' });
    ok(String(routed.result).includes('routed http'), 'registry: a call routes to the HTTP server');
    registry.stopAll();
  }
} finally {
  stubProc.kill();
}

// 5. Per-server env reaches a spawned stdio server.
{
  const withEnv = new McpClient({ name: 'Env', command: process.execPath, args: [envStub], env: { MCP_SUITE_MARKER: 'yes-env' } }, { timeoutMs: 10000 });
  const r1 = await withEnv.callTool('marker', {});
  ok(r1.content[0].text === 'marker: yes-env', 'stdio: the server process sees its per-server env vars');
  withEnv.stop();
  const without = new McpClient({ name: 'Env2', command: process.execPath, args: [envStub] }, { timeoutMs: 10000 });
  const r2 = await without.callTool('marker', {});
  ok(r2.content[0].text === 'marker: unset', 'stdio: without env config, the var is simply absent');
  without.stop();
}

// 6. Settings sanitize.
{
  const stdio = sanitizeMcpServer({ name: ' fs ', command: ' npx ', args: ['-y', 'x'] });
  ok(stdio && stdio.name === 'fs' && stdio.command === 'npx' && !('url' in stdio), 'settings: a stdio server survives, trimmed');
  const http = sanitizeMcpServer({ name: 'remote', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${T}' }, env: { A: '1' } });
  ok(http && http.url === 'https://example.com/mcp' && http.headers.Authorization === 'Bearer ${T}' && http.env.A === '1', 'settings: an HTTP server keeps url, headers and env');
  ok(sanitizeMcpServer({ name: 'bad', url: 'ftp://x' }) === null, 'settings: a non-HTTP(S) URL is refused');
  ok(sanitizeMcpServer({ name: 'empty' }) === null, 'settings: a server with neither command nor URL is refused');
  ok(sanitizeMcpServer({ name: 'x', command: 'c', env: { GOOD: 'v', BAD: 42 } }).env.BAD === undefined, 'settings: non-string env values are dropped');
}

// Wiring: the Settings surface offers both new fields.
{
  const dialog = fs.readFileSync(path.join(here, '..', 'src', 'components', 'SettingsDialog.jsx'), 'utf8');
  ok(dialog.includes('URL (remote server') && dialog.includes('Environment variables') && dialog.includes('HTTP headers'), 'settings UI: URL, env and header fields are offered');
}

console.log(failures ? `MCP HTTP FAIL — ${failures} assertion(s)` : 'MCP HTTP OK — HTTP transport (JSON + SSE + session), header expansion, stdio env, sanitize, registry');
process.exit(failures ? 1 : 0);
