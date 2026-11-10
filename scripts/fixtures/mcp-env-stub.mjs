#!/usr/bin/env node
// A tiny stdio MCP server used by scripts/test-mcp-http.mjs to prove that
// per-server env vars reach a spawned server: its one tool reports the
// MCP_SUITE_MARKER variable from ITS OWN environment.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    const reply = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
    if (msg.method === 'initialize') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'env-stub', version: '0.1.0' } } });
    } else if (msg.method === 'tools/list') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'marker', description: 'Reports the MCP_SUITE_MARKER env var.', inputSchema: { type: 'object', properties: {} } }] } });
    } else if (msg.method === 'tools/call') {
      reply({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `marker: ${process.env.MCP_SUITE_MARKER || 'unset'}` }] } });
    } else if (msg.id !== undefined) {
      reply({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
    }
  }
});
