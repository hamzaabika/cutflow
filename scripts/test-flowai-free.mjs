// FlowAI free path + confirm gate (P1-30):
//   - ollamaStatus: a stub Ollama server answers /api/tags -> { running, models };
//     a dead server -> { running: false, models: [] }, never a throw.
//   - validOllamaModel: registry ids pass, shell metacharacters / paths / empty fail.
//   - confirm gate: destructive calls ask first (summary with numbers), apply only
//     on accept, never on decline; out-of-bounds and whole-video cuts are rejected
//     even without a gate; remove_silences reuses the gate's detection.
// Usage: node scripts/test-flowai-free.mjs
import http from 'node:http';
import { createRequire } from 'node:module';
import { createToolRunner, isDestructive, DESTRUCTIVE } from '../src/agent/tools.js';

const require = createRequire(import.meta.url);
const { ollamaStatus, validOllamaModel } = require('../electron/ai.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

// ---- ollamaStatus against a stub server -------------------------------------
const stub = http.createServer((req, res) => {
  if (req.url === '/api/tags') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b' }, { name: 'llama3.2:3b' }] }));
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const port = stub.address().port;
const up = await ollamaStatus(`http://127.0.0.1:${port}`);
check(up.running === true && up.models.length === 2 && up.models.includes('qwen2.5:3b'), `stub server up -> running with models (${JSON.stringify(up.models)})`);
stub.close();
await new Promise((r) => setTimeout(r, 50));
const down = await ollamaStatus(`http://127.0.0.1:${port}`);
check(down.running === false && down.models.length === 0, 'dead server -> { running: false, models: [] }, no throw');

// ---- model-name validation ----------------------------------------------------
for (const good of ['qwen2.5:3b', 'llama3.2', 'mistral:7b-instruct', 'a/b:c', 'library/qwen2.5:3b']) check(validOllamaModel(good), `valid model name passes: ${good}`);
for (const bad of ['', ' ', 'qwen; rm -rf /', '../../etc/passwd', 'a/../../b', 'model$(id)', 'model`id`', 'a'.repeat(70), '-lead', 'with space']) {
  check(!validOllamaModel(bad), `invalid model name refused: ${JSON.stringify(bad)}`);
}

// ---- confirm gate + bounds validation ----------------------------------------
const fixture = () => ({
  id: 'p1', name: 'gate', width: 1280, height: 720, fps: 30, background: '#000',
  media: [
    { id: 'm1', name: 'clip-a.mp4', type: 'video', duration: 10 },
    { id: 'm2', name: 'clip-b.mp4', type: 'video', duration: 10 },
  ],
  videoClips: [
    { id: 'v1', mediaId: 'm1', in: 0, out: 10, volume: 1 },
    { id: 'v2', mediaId: 'm2', in: 0, out: 10, volume: 1 },
  ],
  overlayClips: [{ id: 'o1', mediaId: 'm1', start: 3, duration: 4, in: 0, out: 4 }],
  textClips: [{ id: 't1', text: 'hello', start: 2, duration: 2 }],
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 5, duration: 5, in: 0, out: 5 }],
  effectClips: [], stickerClips: [],
});
const mkCtx = (onConfirm, silences = [{ start: 2, end: 5 }]) => {
  const dispatched = [];
  return {
    dispatched,
    ctx: {
      getProject: fixture,
      dispatch: (a) => dispatched.push(a),
      settle: async () => {},
      api: { agentSilences: async () => ({ ok: true, silences }) },
      ...(onConfirm ? { onConfirm } : {}),
    },
  };
};
check(DESTRUCTIVE.length === 4 && isDestructive('cut_range') && isDestructive('delete_clip') && !isDestructive('add_text') && !isDestructive('get_project'),
  'destructive set is exactly the four removing tools');

// Out-of-bounds cut: rejected, nothing dispatched, gate never asked.
{
  const { dispatched, ctx } = mkCtx(async () => { throw new Error('gate must not be asked for an invalid call'); });
  const r = await createToolRunner(ctx).run('cut_range', { start_sec: 5, end_sec: 99 });
  check(!!r.error && /outside the video/.test(r.error), `cut beyond duration rejected: ${r.error}`);
  check(dispatched.length === 0, 'rejected cut dispatched nothing');
}
// Whole-video cut: rejected.
{
  const { dispatched, ctx } = mkCtx(null);
  const r = await createToolRunner(ctx).run('cut_range', { start_sec: 0, end_sec: 20 });
  check(!!r.error && /whole video/.test(r.error), `whole-video cut rejected: ${r.error}`);
  check(dispatched.length === 0, 'whole-video cut dispatched nothing');
}
// Valid cut, user declines: summary shown, nothing dispatched.
{
  let seen = null;
  const { dispatched, ctx } = mkCtx(async (c) => { seen = c; return false; });
  const r = await createToolRunner(ctx).run('cut_range', { start_sec: 2, end_sec: 4 });
  check(!!r.error && /declined/.test(r.error), `declined cut reports the decline: ${r.error}`);
  check(dispatched.length === 0, 'declined cut dispatched nothing');
  check(seen && /Removes 2s/.test(seen.summary) && /20s to 18s/.test(seen.summary), `cut summary has numbers: ${seen?.summary}`);
}
// Valid cut, user accepts: dispatched once.
{
  let seen = null;
  const { dispatched, ctx } = mkCtx(async (c) => { seen = c; return true; });
  const r = await createToolRunner(ctx).run('cut_range', { start_sec: 2, end_sec: 4 });
  check(!r.error && dispatched.length === 1 && dispatched[0].type === 'cutRanges', `accepted cut dispatches cutRanges (${JSON.stringify(dispatched)})`);
  check(seen && seen.tool === 'cut_range' && seen.removedSec === 2 && seen.newDurationSec === 18, 'cut confirm payload carries removed/new durations');
}
// keep_ranges: empty keep rejected; out-of-bounds rejected; valid + accept dispatches.
{
  const { dispatched, ctx } = mkCtx(null);
  const r1 = await createToolRunner(ctx).run('keep_ranges', { ranges: [{ start_sec: 5, end_sec: 5 }] });
  check(!!r1.error, `empty keep range rejected: ${r1.error}`);
  const r2 = await createToolRunner(ctx).run('keep_ranges', { ranges: [{ start_sec: 0, end_sec: 99 }] });
  check(!!r2.error && /inside the video/.test(r2.error), `out-of-bounds keep rejected: ${r2.error}`);
  check(dispatched.length === 0, 'rejected keeps dispatched nothing');
}
{
  const { dispatched, ctx } = mkCtx(async () => true);
  const r = await createToolRunner(ctx).run('keep_ranges', { ranges: [{ start_sec: 0, end_sec: 5 }] });
  check(!r.error && dispatched.length === 1, `accepted keep dispatches once (${JSON.stringify(dispatched)})`);
}
// remove_silences: gate asks with the detected ranges; decline dispatches nothing;
// accept dispatches once (and reuses the gate detection, not a second one).
{
  let calls = 0;
  const api = { agentSilences: async () => { calls++; return { ok: true, silences: [{ start: 2, end: 5 }] }; } };
  const dispatched = [];
  const ctx = { getProject: fixture, dispatch: (a) => dispatched.push(a), settle: async () => {}, api, onConfirm: async () => false };
  const r = await createToolRunner(ctx).run('remove_silences', {});
  check(!!r.error && /declined/.test(r.error), 'declined silence removal reports the decline');
  check(dispatched.length === 0, 'declined silence removal dispatched nothing');
  check(calls === 1, `silence detection ran once for the gate (${calls})`);
}
{
  let seen = null;
  const { dispatched, ctx } = mkCtx(async (c) => { seen = c; return true; });
  const r = await createToolRunner(ctx).run('remove_silences', {});
  check(!r.error && dispatched.length === 1 && dispatched[0].type === 'cutRanges', 'accepted silence removal dispatches cutRanges once');
  check(seen && /silent stretch/.test(seen.summary) && /2.76s/.test(seen.summary), `silence summary has the count + seconds (3s minus 0.12s padding each side): ${seen?.summary}`);
}
// remove_silences with no silence: gate steps aside, tool reports it, no dispatch.
{
  let asked = false;
  const { dispatched, ctx } = mkCtx(async () => { asked = true; return true; }, []);
  const r = await createToolRunner(ctx).run('remove_silences', {});
  check(!r.error && r.removed_count === 0 && !asked && dispatched.length === 0, 'no silence -> no confirm, no dispatch, clean report');
}
// delete_clip: unknown id rejected; known id + decline dispatches nothing; accept deletes.
{
  const { dispatched, ctx } = mkCtx(null);
  const r = await createToolRunner(ctx).run('delete_clip', { clip_id: 'nope' });
  check(!!r.error && /No clip/.test(r.error), `unknown clip id rejected: ${r.error}`);
  check(dispatched.length === 0, 'rejected delete dispatched nothing');
}
{
  const { dispatched, ctx } = mkCtx(async () => false);
  const r = await createToolRunner(ctx).run('delete_clip', { clip_id: 'v1' });
  check(!!r.error && /declined/.test(r.error) && dispatched.length === 0, 'declined delete dispatched nothing');
}
{
  const { dispatched, ctx } = mkCtx(async () => true);
  const r = await createToolRunner(ctx).run('delete_clip', { clip_id: 'v1' });
  check(!r.error && dispatched.length === 1 && dispatched[0].type === 'delete', 'accepted delete dispatches once');
}
// No onConfirm at all (headless): destructive calls still apply, bounds still enforced.
{
  const { dispatched, ctx } = mkCtx(null);
  const r = await createToolRunner(ctx).run('cut_range', { start_sec: 2, end_sec: 4 });
  check(!r.error && dispatched.length === 1, 'headless (no gate) still applies a valid cut');
}

// ---- hook order: no hook after an early return ------------------------------
// Regression for the React #310 crash (2026-11-15): the Ollama status effect
// sat after `if (!saved) return null` in SettingsDialog, so the dialog rendered
// fewer hooks before settings loaded and MORE after — React unmounted the app
// the moment Settings opened. Every hook in a component must come before any
// conditional early return in that component.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hookRe = /\buse(Effect|State|Callback|Memo|Ref)\s*\(/g;
const checkHooksBeforeReturn = (file, componentStart, ret, label) => {
  const src = readFileSync(join(root, file), 'utf8');
  const body = src.slice(src.indexOf(componentStart));
  const retAt = body.indexOf(ret);
  check(retAt > 0, `${label}: early return present`);
  const after = body.slice(retAt);
  // Cut the slice at the next top-level component so sub-components below do
  // not pollute the check (their own hooks are ordered independently).
  const nextComp = after.search(/\nfunction [A-Z]\w+\s*\(/);
  const scoped = nextComp > 0 ? after.slice(0, nextComp) : after;
  const bad = scoped.match(hookRe);
  check(!bad, `${label}: no hooks after the early return${bad ? ` (found ${bad.length}: ${bad.slice(0, 3).join(', ')})` : ''}`);
};
checkHooksBeforeReturn('src/components/SettingsDialog.jsx', 'export default function SettingsDialog', 'if (!saved) return null;', 'SettingsDialog');
{
  // CraftPilot (CraftAI): no early return at all before the render — all its
  // hooks run on every render.
  const src = readFileSync(join(root, 'src/components/CraftPilot.jsx'), 'utf8');
  const body = src.slice(src.indexOf('export default function CraftAI'));
  const firstHook = body.search(hookRe);
  const earlyRet = body.search(/^\s*if \(.*\) return null;/m);
  check(earlyRet < 0 || earlyRet > firstHook, 'CraftAI: no early return before its hooks');
}

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll FlowAI free-path + confirm-gate checks passed.');
