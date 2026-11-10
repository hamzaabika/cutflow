#!/usr/bin/env node
// Cutflow MCP server: a small stdio shim that speaks the Model Context
// Protocol (newline-delimited JSON-RPC, protocol 2024-11-05 — the same
// conventions as the app's own MCP client in electron/mcp.cjs) and translates
// tool calls to the Cutflow agent bridge's REST API (electron/bridge.cjs).
// It lets an external MCP client (Claude Desktop, Claude Code, ...) read the
// project open in Cutflow and propose edits to it.
//
// Safety model — inherited from the bridge, unchanged:
// - The bridge listens on 127.0.0.1 only, and only while the user enables it
//   in Cutflow (Settings -> Agent bridge). While off, nothing listens.
// - Every bridge request carries the per-launch token, which the user copies
//   out of Settings into this process's environment (CUTFLOW_BRIDGE_TOKEN).
//   The token is never written to disk by Cutflow and dies with the bridge.
// - Edits land on SHADOW drafts: private copies of the project pinned to a
//   recorded revision. Nothing here can change the live project, and there is
//   deliberately NO tool that accepts a draft — accepting is the user's act,
//   inside Cutflow (top bar -> Agent drafts), where a compare-and-swap
//   refuses a draft whose base revision has gone stale.
//
// Configuration (environment):
//   CUTFLOW_BRIDGE_TOKEN  (required) the token from Settings -> Agent bridge.
//   CUTFLOW_BRIDGE_URL    full base URL, e.g. http://127.0.0.1:47617.
//   CUTFLOW_BRIDGE_PORT   port only; base URL becomes http://127.0.0.1:<port>.
//   CUTFLOW_BRIDGE_FILE   path to the bridge discovery file (bridge.json).
// With no URL/PORT, the port is read from the discovery file Cutflow writes
// while the bridge listens: <userData>/bridge.json (Linux default:
// ~/.config/ClipCraft/bridge.json). The discovery file never holds the token.
//
// Plain Node, zero dependencies. Run: node cutflow-mcp.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'cutflow-mcp', version: '1.0.0' };
const REQUEST_TIMEOUT_MS = 30000;

const HOW_TO_START = 'Start Cutflow, open Settings -> Agent bridge, switch it On, and copy the access token it shows into this MCP client\'s env as CUTFLOW_BRIDGE_TOKEN (the token changes every time the bridge starts).';

// ---------------------------------------------------------------------------
// Bridge access

function defaultDiscoveryFile() {
  if (process.env.CUTFLOW_BRIDGE_FILE) return process.env.CUTFLOW_BRIDGE_FILE;
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'ClipCraft', 'bridge.json');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'ClipCraft', 'bridge.json');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ClipCraft', 'bridge.json');
}

// Resolved per call: the bridge may start, stop, or move ports between calls
// (its token will have changed too, but that is the client's env to update).
function bridgeBase() {
  const url = String(process.env.CUTFLOW_BRIDGE_URL || '').trim();
  if (url) return url.replace(/\/+$/, '');
  const portEnv = String(process.env.CUTFLOW_BRIDGE_PORT || '').trim();
  if (portEnv) return `http://127.0.0.1:${portEnv}`;
  const file = defaultDiscoveryFile();
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (info && info.port) return `http://127.0.0.1:${info.port}`;
  } catch { /* no discovery file: the bridge is not listening (or never started) */ }
  return null;
}

function bridgeToken() {
  const t = String(process.env.CUTFLOW_BRIDGE_TOKEN || '').trim();
  return t || null;
}

class ToolFailure extends Error {} // a message meant for the calling AI, verbatim

let sessionId = null; // one bridge session per shim process, created lazily

async function bridgeFetch(base, route, { method = 'GET', session = false, body } = {}) {
  const headers = { authorization: `Bearer ${bridgeToken()}` };
  if (session) headers['x-cutflow-session'] = sessionId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${base}${route}`, {
      method, headers, signal: ctrl.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ToolFailure(`Could not reach the Cutflow agent bridge at ${base} (${e.name === 'AbortError' ? 'it did not answer in time' : e.message}). ${HOW_TO_START}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* document routes answer raw JSON too */ }
  return { status: res.status, json, text };
}

async function createSession(base) {
  const r = await bridgeFetch(base, '/v1/sessions', { method: 'POST', body: { client: 'cutflow-mcp' } });
  if (r.status !== 201 || !r.json?.sessionId) {
    throw new ToolFailure(`The bridge refused to open a session (HTTP ${r.status}${r.json?.error ? `: ${r.json.error}` : ''}). ${HOW_TO_START}`);
  }
  sessionId = r.json.sessionId;
}

// One bridge call with the shim's error posture: setup problems (no token, no
// bridge) become actionable instructions; bridge HTTP errors pass through
// with their status and message; a dead session (403) is recreated once.
async function bridgeCall(route, opts = {}) {
  if (!bridgeToken()) {
    throw new ToolFailure(`CUTFLOW_BRIDGE_TOKEN is not set, so Cutflow's agent bridge will refuse every request. ${HOW_TO_START}`);
  }
  const base = bridgeBase();
  if (!base) {
    throw new ToolFailure(`Cutflow's agent bridge is not reachable: no bridge address is configured and no discovery file was found at ${defaultDiscoveryFile()}. ${HOW_TO_START}`);
  }
  if (opts.session && !sessionId) await createSession(base);
  let r = await bridgeFetch(base, route, opts);
  if (opts.session && r.status === 403) {
    // The session died (the bridge restarted under us): mint a fresh one and
    // retry exactly once before surfacing the failure.
    sessionId = null;
    await createSession(base);
    r = await bridgeFetch(base, route, opts);
  }
  if (r.status === 401) {
    throw new ToolFailure(`The bridge rejected the access token (HTTP 401). The token changes every time the bridge starts, so the one in CUTFLOW_BRIDGE_TOKEN is stale. ${HOW_TO_START}`);
  }
  if (r.status < 200 || r.status >= 300) {
    throw new ToolFailure(`Cutflow bridge answered HTTP ${r.status}${r.json?.error ? `: ${r.json.error}` : ''}`);
  }
  return r.json !== null ? r.json : r.text;
}

// ---------------------------------------------------------------------------
// Tools

const SHADOW_NOTE = 'Edits land on a SHADOW draft — a private copy of the project. They never touch the live project directly, and there is no tool to accept a draft: the USER reviews and accepts it inside Cutflow (top bar -> Agent drafts), or discards it there. Tell your user their changes are waiting for review in Cutflow.';

const opSchema = {
  type: 'object',
  description: 'One shadow edit operation. Supported types: '
    + 'transcript.setText {type, start, end, text} — replace the caption text in [start, end) seconds (word-timed neighbours keep their out-of-range words); '
    + 'transcript.deleteRange {type, start, end} — delete the captions in a range; '
    + 'clip.patch {type, list, clipId, patch} — assign fields on one clip; list is one of videoClips, overlayClips, textClips, audioClips, effectClips; the clip id itself is not patchable; '
    + 'document.replace {type, project} — swap the whole shadow document; project.id must stay the open project\'s id.',
  properties: { type: { type: 'string' } },
  required: ['type'],
  additionalProperties: true,
};

const shadowIdArg = { type: 'string', description: 'The shadow draft id returned by cutflow_create_shadow.' };

const TOOLS = [
  {
    name: 'cutflow_status',
    description: 'Bridge status: whether a project is open in Cutflow, its name, id, live revision, track/media counts, and how many shadow drafts are pending review.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/status'),
  },
  {
    name: 'cutflow_get_project',
    description: 'A summary of the project open in Cutflow: id, name, revision, duration, per-track clip counts and media count (not the full document).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/project'),
  },
  {
    name: 'cutflow_get_document',
    description: 'The full project document (JSON) of the project open in Cutflow. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/project/document'),
  },
  {
    name: 'cutflow_get_transcript',
    description: 'The open project\'s transcript: caption sentences with absolute word timings, derived from its caption clips.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/project/transcript'),
  },
  {
    name: 'cutflow_list_versions',
    description: 'The open project\'s saved version history (snapshots recorded by saves and restores in Cutflow).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/project/versions'),
  },
  {
    name: 'cutflow_list_derivatives',
    description: 'The state of the derivative cache for the open project (remux twins, preview proxies, per-clip audio-effect renders): which files are ready, pending or stale. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/project/derivatives'),
  },
  {
    name: 'cutflow_refresh_derivatives',
    description: 'Warm one derivative cache file for the open project (the same file the editor itself produces). It never changes the project document — it only renders a cache file ahead of time. With no arguments, asks the bridge to refresh its default target.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Derivative kind, e.g. "audiofx".' },
        mediaId: { type: 'string' },
        clipId: { type: 'string' },
        action: { type: 'string' },
      },
      additionalProperties: false,
    },
    run: (a) => bridgeCall('/v1/derivatives/refresh', { method: 'POST', session: true, body: { kind: a.kind, mediaId: a.mediaId, clipId: a.clipId, action: a.action } }),
  },
  {
    name: 'cutflow_list_shadows',
    description: 'All shadow drafts on the bridge (pending, accepted, discarded) with their base/live revisions, staleness and op logs.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/shadows'),
  },
  {
    name: 'cutflow_create_shadow',
    description: `Create a shadow draft of the project open in Cutflow, pinned to its current revision. ${SHADOW_NOTE}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => bridgeCall('/v1/shadows', { method: 'POST', session: true, body: {} }),
  },
  {
    name: 'cutflow_get_shadow',
    description: 'One shadow draft: its status, base vs live revision, staleness, op log, and the structural diff against the project it was made from.',
    inputSchema: { type: 'object', properties: { shadowId: shadowIdArg }, required: ['shadowId'], additionalProperties: false },
    run: (a) => bridgeCall(`/v1/shadows/${encodeURIComponent(a.shadowId)}`),
  },
  {
    name: 'cutflow_get_shadow_document',
    description: 'The full document (JSON) of one shadow draft, including any edits applied to it so far.',
    inputSchema: { type: 'object', properties: { shadowId: shadowIdArg }, required: ['shadowId'], additionalProperties: false },
    run: (a) => bridgeCall(`/v1/shadows/${encodeURIComponent(a.shadowId)}/document`),
  },
  {
    name: 'cutflow_get_shadow_transcript',
    description: 'The transcript of one shadow draft, reflecting the caption edits applied to it.',
    inputSchema: { type: 'object', properties: { shadowId: shadowIdArg }, required: ['shadowId'], additionalProperties: false },
    run: (a) => bridgeCall(`/v1/shadows/${encodeURIComponent(a.shadowId)}/transcript`),
  },
  {
    name: 'cutflow_apply_op',
    description: `Apply one edit operation to a shadow draft and get back a summary plus the structural diff. Set dryRun true to compute the diff without persisting anything — not even on the shadow. ${SHADOW_NOTE}`,
    inputSchema: {
      type: 'object',
      properties: {
        shadowId: shadowIdArg,
        op: opSchema,
        dryRun: { type: 'boolean', description: 'Compute the would-be diff and change nothing.' },
      },
      required: ['shadowId', 'op'],
      additionalProperties: false,
    },
    run: (a) => bridgeCall(`/v1/shadows/${encodeURIComponent(a.shadowId)}/ops`, {
      method: 'POST', session: true, body: { op: a.op, dryRun: a.dryRun === true },
    }),
  },
  {
    name: 'cutflow_discard_shadow',
    description: 'Discard one of this client\'s shadow drafts. The live project was never touched, so discarding simply drops the draft.',
    inputSchema: { type: 'object', properties: { shadowId: shadowIdArg }, required: ['shadowId'], additionalProperties: false },
    run: (a) => bridgeCall(`/v1/shadows/${encodeURIComponent(a.shadowId)}/discard`, { method: 'POST', session: true, body: {} }),
  },
];

const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// JSON-RPC over stdio (newline-delimited, like electron/mcp.cjs's client)

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function handle(msg) {
  const isRequest = msg.id !== undefined && msg.id !== null;
  try {
    switch (msg.method) {
      case 'initialize':
        return isRequest && send({
          jsonrpc: '2.0', id: msg.id,
          result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO },
        });
      case 'ping':
        return isRequest && send({ jsonrpc: '2.0', id: msg.id, result: {} });
      case 'tools/list':
        return isRequest && send({
          jsonrpc: '2.0', id: msg.id,
          result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
        });
      case 'tools/call': {
        if (!isRequest) return;
        const tool = toolByName.get(msg.params?.name);
        if (!tool) {
          return send({
            jsonrpc: '2.0', id: msg.id,
            result: { content: [{ type: 'text', text: `Unknown tool "${msg.params?.name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.` }], isError: true },
          });
        }
        try {
          const out = await tool.run(msg.params?.arguments || {});
          const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
          return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }] } });
        } catch (e) {
          const text = e instanceof ToolFailure ? e.message : `The ${tool.name} tool failed unexpectedly: ${e.message}`;
          return send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text }], isError: true } });
        }
      }
      default:
        // Notifications (notifications/initialized, ...) need no answer;
        // unknown requests get a proper JSON-RPC method-not-found.
        if (isRequest) {
          return send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
        }
        return undefined;
    }
  } catch (e) {
    if (isRequest) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `Internal error: ${e.message}` } });
    return undefined;
  }
}

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
    try { msg = JSON.parse(line); } catch { continue; } // a malformed line is not a request
    if (msg && typeof msg.method === 'string') handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
