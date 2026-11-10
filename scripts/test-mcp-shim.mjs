// MCP shim (mcp-server/cutflow-mcp.mjs): the real bridge hosted against a
// fake project (the test-bridge.cjs harness), and the shim itself spawned
// over stdio and driven with the repo's own MCP client — the exact seat an
// external MCP client sits in. Covers:
// - the initialize handshake and the full tools/list, with NO accept tool
// - bridge discovery through the bridge.json file (CUTFLOW_BRIDGE_FILE)
// - shadow flow end to end: create -> dry-run op (diff, nothing persisted)
//   -> real op (shadow changed, LIVE document byte-identical, no commits)
//   -> discard
// - the read tools (status, project, transcript, versions, derivatives)
// - wrong / missing token: actionable errors, never stack traces
// Usage: node scripts/test-mcp-shim.mjs
import assert from 'assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { createBridge } = require('../electron/bridge.cjs');
const { McpClient } = require('../electron/mcp.cjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const shimPath = path.join(here, '..', 'mcp-server', 'cutflow-mcp.mjs');

const fixture = () => ({
  id: 'p-shim',
  name: 'Shim fixture',
  ratio: '16:9', width: 1280, height: 720, fps: 30, background: '#000000',
  media: [{ id: 'm1', path: '/media/a.mp4', type: 'video', duration: 12 }],
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 12, speed: 1 }],
  overlayClips: [],
  textClips: [
    {
      id: 'cap1', caption: true, text: 'alpha bravo charlie delta', start: 0, duration: 4, y: 0.8,
      words: [
        { text: 'alpha', start: 0, end: 1 }, { text: 'bravo', start: 1, end: 2 },
        { text: 'charlie', start: 2, end: 3 }, { text: 'delta', start: 3, end: 4 },
      ],
    },
    {
      id: 'cap2', caption: true, text: 'echo foxtrot golf hotel', start: 5, duration: 4, y: 0.8,
      words: [
        { text: 'echo', start: 0, end: 1 }, { text: 'foxtrot', start: 1, end: 2 },
        { text: 'golf', start: 2, end: 3 }, { text: 'hotel', start: 3, end: 4 },
      ],
    },
    { id: 'cap3', caption: true, source: 'srt', text: 'imported cue', start: 10, duration: 2, y: 0.8 },
    { id: 'title1', text: 'Title card', start: 1, duration: 3, y: 0.2 },
  ],
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 12, volume: 0.8 }],
  effectClips: [],
});

// The fake host, same shape as test-bridge.cjs plus the derivative surface.
let fakeFile = null;
let commits = 0;
let refreshes = 0;
const bridge = createBridge({
  commit: ({ json }) => {
    commits += 1;
    fakeFile = json;
    const p = JSON.parse(json);
    bridge.noteLive(p.id, json, '/fake/shim.clipcraft.json');
  },
  listVersions: () => [{ file: '1700000000000-abcd1234.json', savedAt: 1700000000000, source: 'save' }],
  derivatives: () => ({ audioFx: { pending: 1, ready: 0 } }),
  refreshDerivative: () => { refreshes += 1; return { ok: true, warmed: 'a1' }; },
});

const json0 = JSON.stringify(fixture());
fakeFile = json0;
bridge.noteLive('p-shim', json0, '/fake/shim.clipcraft.json');

const started = await bridge.start(0); // ephemeral port
assert.equal(started.listening, true);

// Discovery: the file the app writes while the bridge listens (port only).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-mcp-shim-'));
const discoveryFile = path.join(dir, 'bridge.json');
fs.writeFileSync(discoveryFile, JSON.stringify({ port: started.port, pid: process.pid, startedAt: Date.now(), version: 1 }));

const makeClient = (env) => new McpClient(
  { name: 'cutflow-shim', command: process.execPath, args: [shimPath], env },
  { timeoutMs: 15000 },
);
const callJson = async (client, name, args = {}) => {
  const res = await client.callTool(name, args);
  return JSON.parse(res.content[0].text);
};

const EXPECTED_TOOLS = [
  'cutflow_apply_op', 'cutflow_create_shadow', 'cutflow_discard_shadow',
  'cutflow_get_document', 'cutflow_get_project', 'cutflow_get_shadow',
  'cutflow_get_shadow_document', 'cutflow_get_shadow_transcript',
  'cutflow_get_transcript', 'cutflow_list_derivatives', 'cutflow_list_shadows',
  'cutflow_list_versions', 'cutflow_refresh_derivatives', 'cutflow_status',
];

// ---- Handshake + tool list ---------------------------------------------------
const client = makeClient({ CUTFLOW_BRIDGE_FILE: discoveryFile, CUTFLOW_BRIDGE_TOKEN: started.token });
const init = await client.start();
assert.equal(init.serverInfo.name, 'cutflow-mcp', 'initialize handshake returned the shim identity');
assert.equal(init.protocolVersion, '2024-11-05', 'the shim speaks the repo protocol version');
const tools = await client.listTools();
assert.deepEqual(tools.map((t) => t.name).sort(), EXPECTED_TOOLS, 'the full tool set, nothing more');
assert.ok(!tools.some((t) => /accept/i.test(t.name)), 'there is NO accept tool');
assert.match(tools.find((t) => t.name === 'cutflow_apply_op').description, /Agent drafts/, 'edit tools state the human-accept model');
await assert.rejects(() => client.callTool('cutflow_accept_shadow', {}), /Unknown tool/, 'accept does not exist under any other name either');

// ---- Reads -------------------------------------------------------------------
const status = await callJson(client, 'cutflow_status');
assert.equal(status.projectOpen, true);
assert.equal(status.live.projectId, 'p-shim');
assert.equal(status.live.revision, 1);
const project = await callJson(client, 'cutflow_get_project');
assert.equal(project.counts.textClips, 4);
const transcript = await callJson(client, 'cutflow_get_transcript');
assert.equal(transcript.sentences.length, 3); // cap1, cap2, cap3 — title1 is not a caption
const versions = await callJson(client, 'cutflow_list_versions');
assert.equal(versions.versions.length, 1);
const derivatives = await callJson(client, 'cutflow_list_derivatives');
assert.equal(derivatives.derivatives.audioFx.pending, 1);
const refreshed = await callJson(client, 'cutflow_refresh_derivatives', { kind: 'audiofx', clipId: 'a1' });
assert.equal(refreshed.ok, true);
assert.equal(refreshes, 1);

// ---- Shadow flow: dry run, real op, live untouched, discard -------------------
const shadow = await callJson(client, 'cutflow_create_shadow');
assert.ok(shadow.id.startsWith('shadow-'), 'a shadow draft was created');
assert.equal(shadow.baseRevision, 1);
const patch = { type: 'clip.patch', list: 'audioClips', clipId: 'a1', patch: { volume: 0.5 } };
const dry = await callJson(client, 'cutflow_apply_op', { shadowId: shadow.id, op: patch, dryRun: true });
assert.equal(dry.dryRun, true);
assert.equal(dry.diff.lists.audioClips.changed, 1);
const afterDry = await callJson(client, 'cutflow_get_shadow_document', { shadowId: shadow.id });
assert.equal(afterDry.audioClips[0].volume, 0.8, 'the dry run persisted nothing, not even on the shadow');
const real = await callJson(client, 'cutflow_apply_op', { shadowId: shadow.id, op: patch });
assert.equal(real.ok, true);
assert.deepEqual(real.summary.fields, ['volume']);
const shadowDoc = await callJson(client, 'cutflow_get_shadow_document', { shadowId: shadow.id });
assert.equal(shadowDoc.audioClips[0].volume, 0.5, 'the real op landed on the shadow');
const liveDoc = await callJson(client, 'cutflow_get_document');
assert.equal(liveDoc.audioClips[0].volume, 0.8, 'the LIVE document is unchanged');
assert.equal(fakeFile, json0, 'the project "file" is byte-identical');
assert.equal(commits, 0, 'nothing was ever committed');
const shadowTranscript = await callJson(client, 'cutflow_get_shadow_transcript', { shadowId: shadow.id });
assert.equal(shadowTranscript.sentences.length, 3);
const list = await callJson(client, 'cutflow_list_shadows');
assert.equal(list.shadows.length, 1);
assert.equal(list.shadows[0].status, 'pending');
const discarded = await callJson(client, 'cutflow_discard_shadow', { shadowId: shadow.id });
assert.deepEqual(discarded, { ok: true });
const afterDiscard = await callJson(client, 'cutflow_get_shadow', { shadowId: shadow.id });
assert.equal(afterDiscard.status, 'discarded');
client.stop();

// ---- Token failures are actionable, never stack traces -------------------------
const wrongToken = makeClient({ CUTFLOW_BRIDGE_FILE: discoveryFile, CUTFLOW_BRIDGE_TOKEN: 'stale-token' });
await assert.rejects(() => wrongToken.callTool('cutflow_status', {}), /HTTP 401/, 'a stale token names its HTTP status');
await assert.rejects(() => wrongToken.callTool('cutflow_status', {}), /CUTFLOW_BRIDGE_TOKEN/, 'a stale token says where the fresh one goes');
wrongToken.stop();
const noToken = makeClient({ CUTFLOW_BRIDGE_FILE: discoveryFile });
await assert.rejects(() => noToken.callTool('cutflow_status', {}), /CUTFLOW_BRIDGE_TOKEN is not set/, 'a missing token is explained before any request');
await assert.rejects(() => noToken.callTool('cutflow_status', {}), /Settings -> Agent bridge/, 'a missing token says where to get one');
noToken.stop();

await bridge.stop();
fs.rmSync(dir, { recursive: true, force: true });
console.log('test-mcp-shim: all assertions passed');
process.exit(0);
