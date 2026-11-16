// Non-destructive AI editing (P1-31): the plan runs against a clone, the real
// project is untouched until Apply, Apply is exactly one undo step, invalid
// timestamps are rejected per step, and the diff spells out what changed.
// Usage: node scripts/test-plan-mode.mjs
import { createRequire } from 'node:module';
import { historyReducer, projectDuration } from '../src/store.js';
import { createToolRunner, describeStepFor, mutatesTool } from '../src/agent/tools.js';
import { createPlanRun, replayPlan, diffPlan } from '../src/agent/plan.js';

const require = createRequire(import.meta.url);
void require;

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

const fixture = () => ({
  id: 'p1', name: 'plan', width: 1280, height: 720, fps: 30, background: '#000',
  media: [
    { id: 'm1', name: 'clip-a.mp4', type: 'video', duration: 10 },
    { id: 'm2', name: 'clip-b.mp4', type: 'video', duration: 10 },
  ],
  videoClips: [
    { id: 'v1', mediaId: 'm1', in: 0, out: 10, volume: 1 },
    { id: 'v2', mediaId: 'm2', in: 0, out: 10, volume: 1 },
  ],
  overlayClips: [], textClips: [], audioClips: [], effectClips: [], stickerClips: [],
});
const r2 = (n) => Math.round(n * 100) / 100;

// ---- the plan run edits a clone; the real project is untouched --------------
const base = fixture();
const baseJson = JSON.stringify(base);
const run = createPlanRun(base, {});
const runner = createToolRunner(run.ctx);
const cut = await runner.run('cut_range', { start_sec: 2, end_sec: 4 });
check(!cut.error, `plan cut runs: ${JSON.stringify(cut)}`);
const text = await runner.run('add_text', { text: 'Hello', start_sec: 0, duration_sec: 3 });
check(!text.error, `plan add_text runs: ${JSON.stringify(text)}`);
check(JSON.stringify(base) === baseJson, 'real project untouched by the plan run');
check(r2(projectDuration(run.getPlannedProject())) === 18, `planned duration is 18 (got ${projectDuration(run.getPlannedProject())})`);
check(run.getPlannedProject().textClips.length === 1, 'planned project has the added text clip');

// ---- export is not available inside a plan -----------------------------------
const exp = await runner.run('export_video', {});
check(!!exp.error, `export_video refused in a plan: ${exp.error}`);

// ---- addProbed stays inside the draft ----------------------------------------
const probed = run.ctx.addProbed({ path: '/tmp/song.mp3', name: 'song.mp3', type: 'audio', duration: 5 });
check(!!probed && probed.id, 'draft addProbed returns a media item');
check(base.media.length === 2 && run.getPlannedProject().media.length === 3, 'draft addProbed adds media to the draft only');

// ---- diff spells out the change ----------------------------------------------
const diff = diffPlan(base, run.getPlannedProject());
check(diff.durationBefore === 20 && diff.durationAfter === 18, `diff durations 20 -> 18 (got ${diff.durationBefore} -> ${diff.durationAfter})`);
check(diff.lists.textClips.added === 1, `diff counts the added text clip (${JSON.stringify(diff.lists.textClips)})`);
check(diff.lists.videoClips.changed >= 1, `diff counts the changed main clips (${JSON.stringify(diff.lists.videoClips)})`);

// ---- describeStepFor: destructive steps carry numbers -------------------------
const desc = await describeStepFor(base, {}, 'cut_range', { start_sec: 2, end_sec: 4 });
check(!!desc && /Removes 2s/.test(desc.text) && /20s to 18s/.test(desc.text), `cut summary has numbers: ${desc?.text}`);
check(await describeStepFor(base, {}, 'add_text', { text: 'x' }) === null, 'non-destructive steps return null (caller falls back to the label)');

// ---- replay with a step disabled recomputes from the original ------------------
const steps = [
  { tool: 'cut_range', args: { start_sec: 2, end_sec: 4 }, enabled: true },
  { tool: 'add_text', args: { text: 'Hello', start_sec: 0, duration_sec: 3 }, enabled: true },
];
const full = await replayPlan(base, {}, steps);
check(r2(projectDuration(full.project)) === 18 && full.project.textClips.length === 1, 'replay of both steps matches the live plan');
check(full.steps.length === 2 && full.steps.every((s) => s.ok), 'replay steps all ok');
const noCut = await replayPlan(base, {}, [
  { tool: 'cut_range', args: { start_sec: 2, end_sec: 4 }, enabled: false },
  { tool: 'add_text', args: { text: 'Hello', start_sec: 0, duration_sec: 3 }, enabled: true },
]);
check(r2(projectDuration(noCut.project)) === 20 && noCut.project.textClips.length === 1, 'cut disabled -> duration back to 20, text kept');
check(noCut.steps.length === 2 && noCut.steps[0].skipped === true && noCut.steps[1].ok, 'disabled step stays in the list as skipped');

// ---- invalid timestamps are rejected per step, the rest still applies ---------
const bad = await replayPlan(base, {}, [
  { tool: 'cut_range', args: { start_sec: 2, end_sec: 4 }, enabled: true },
  { tool: 'cut_range', args: { start_sec: 0, end_sec: 99 }, enabled: true },
]);
check(bad.steps[0].ok && !bad.steps[1].ok && !!bad.steps[1].error, `out-of-range step fails with its error: ${bad.steps[1].error}`);
check(r2(projectDuration(bad.project)) === 18, 'the valid step still applied after the bad one');

// ---- Apply is exactly one undo step -------------------------------------------
let state = { past: [], present: fixture(), future: [], gestureStart: null };
const planned = full.project;
state = historyReducer(state, { type: 'applyPlan', project: planned });
check(state.past.length === 1, `applyPlan pushes exactly one past entry (got ${state.past.length})`);
check(r2(projectDuration(state.present)) === 18, 'present is the planned project after apply');
state = historyReducer(state, { type: 'undo' });
check(r2(projectDuration(state.present)) === 20 && state.present.textClips.length === 0, 'one undo restores the exact pre-plan project');

// ---- mutatesTool matches the runner --------------------------------------------
check(mutatesTool('cut_range') && !mutatesTool('get_project') && !mutatesTool('export_video') && mutatesTool('add_text'), 'mutatesTool flags reads/export as non-mutating');

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nAll plan-mode checks passed.');
