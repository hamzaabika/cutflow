#!/usr/bin/env node
// A tiny streamable-HTTP MCP server used by scripts/test-mcp-http.mjs.
// Speaks POSTed JSON-RPC: initialize (minting the session id
// "stub-session-1" in the mcp-session-id response header), tools/list and
// tools/call with two tools:
//   echo   — echoes the given text back.
//   whoami — reports what the server SAW on that very request: the session
//            header and the Authorization header, so the suite can prove
//            session carry and ${VAR} header expansion over the wire.
// With ?mode=sse in the URL, answers come back as an SSE stream with a
// notification event ahead of the response event. Notifications (no id)
// get a bare 202. Listens on an ephemeral port and prints it as PORT=<n>.
import http from 'node:http';

const SESSION = 'stub-session-1';

const server = http.createServer((req, res) => {
  const mode = new URL(req.url, 'http://127.0.0.1').searchParams.get('mode');
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    let msg = null;
    try { msg = JSON.parse(raw); } catch { /* not JSON: handled below */ }
    if (!msg) { res.writeHead(400).end('{}'); return; }
    if (msg.id === undefined) { res.writeHead(202).end(); return; } // notification
    let payload;
    if (msg.method === 'initialize') {
      payload = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub-http', version: '0.1.0' } };
    } else if (msg.method === 'tools/list') {
      payload = {
        tools: [
          { name: 'echo', description: 'Echoes the given text back.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
          { name: 'whoami', description: 'Reports the session and authorization headers of the request.', inputSchema: { type: 'object', properties: {} } },
        ],
      };
    } else if (msg.method === 'tools/call' && msg.params?.name === 'echo') {
      payload = { content: [{ type: 'text', text: `echo: ${(msg.params.arguments && msg.params.arguments.text) || ''}` }] };
    } else if (msg.method === 'tools/call' && msg.params?.name === 'whoami') {
      const seen = { session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization || null };
      payload = { content: [{ type: 'text', text: JSON.stringify(seen) }] };
    } else {
      const err = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION }).end(JSON.stringify(err));
      return;
    }
    const out = { jsonrpc: '2.0', id: msg.id, result: payload };
    if (mode === 'sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': SESSION });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\nevent: message\ndata: ${JSON.stringify(out)}\n\n`);
    } else {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': SESSION }).end(JSON.stringify(out));
    }
  });
});
server.listen(0, '127.0.0.1', () => console.log(`PORT=${server.address().port}`));
