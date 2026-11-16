// R4 export flow: the jobs model behind the queue + tray.
// - videoPhases lists exactly the phases the pipeline will run for a project
//   (text only with text clips, effects only with fx work, cover only for a
//   chosen poster frame in MP4/MOV) — the tray never promises a phase the
//   export does not have, and never hides one it does.
// - phaseStates orders done/active/pending around the active phase.
// - The audio phase boundary is runAudioExport's own 0.7 split.
// - Wiring: App mounts the tray and runs exports as jobs; the dialog is the
//   settings form only (no progress/done/error views left inside it), and it
//   states the GIF limit up front from the same constant the engine enforces.
// Usage: node scripts/test-export-queue.mjs
import assert from 'assert/strict';
import fs from 'fs';
import { AUDIO_PHASE_SPLIT, audioPhaseId, audioPhases, gifLimitMessage, jobsAhead, phaseStates, videoPhases } from '../src/exportJobs.js';

const proj = (patch = {}) => ({ textClips: [], posterAt: undefined, ...patch });
const eff = (patch = {}) => ({ format: 'mp4', ...patch });

// Phase lists follow the pipeline's own branches.
assert.deepEqual(videoPhases(proj(), eff(), false).map((p) => p.id), ['encode', 'qc'], 'bare project: encode + the QC check');
assert.deepEqual(videoPhases(proj({ textClips: [{}] }), eff(), false).map((p) => p.id), ['text', 'encode', 'qc'], 'text clips add the text phase');
assert.deepEqual(videoPhases(proj(), eff(), true).map((p) => p.id), ['effects', 'encode', 'qc'], 'fx work adds the effects phase');
assert.deepEqual(videoPhases(proj({ textClips: [{}], posterAt: 1.5 }), eff(), true).map((p) => p.id),
  ['text', 'effects', 'encode', 'cover', 'qc'], 'full pipeline, in order');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'webm' }), false).map((p) => p.id), ['encode', 'qc'],
  'no cover phase for WebM — the embed does not exist there');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'gif' }), false).map((p) => p.id), ['encode', 'qc'],
  'no cover phase for GIF');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'mov' }), false).map((p) => p.id), ['encode', 'cover', 'qc'],
  'MOV takes the cover phase like MP4');

// Phase states around the active phase.
const phases = videoPhases(proj({ textClips: [{}], posterAt: 2 }), eff(), true);
assert.deepEqual(phaseStates(phases, 'encode', 'running').map((p) => p.state), ['done', 'done', 'active', 'pending', 'pending']);
assert.deepEqual(phaseStates(phases, 'text', 'running').map((p) => p.state), ['active', 'pending', 'pending', 'pending', 'pending']);
assert.ok(phaseStates(phases, 'encode', 'done').every((p) => p.state === 'done'), 'a finished job: every phase done');
assert.ok(phaseStates(phases, 'encode', 'queued').every((p) => p.state === 'pending'), 'a queued job: nothing started');

// Audio phases ride the engine job's own split.
assert.equal(AUDIO_PHASE_SPLIT, 0.7);
assert.equal(audioPhaseId(0), 'mix');
assert.equal(audioPhaseId(0.69), 'mix');
assert.equal(audioPhaseId(0.7), 'master');
assert.equal(audioPhaseId(1), 'master');
assert.deepEqual(audioPhases().map((p) => p.id), ['mix', 'master', 'qc']);

// The GIF limit the dialog states is the engine's sentence, with its number.
assert.equal(gifLimitMessage(42.26), 'GIF export is limited to 30 s of timeline — this project is 42.3 s. Trim the timeline or split it into shorter exports.');

// Queue arithmetic.
assert.equal(jobsAhead([]), 0);
assert.equal(jobsAhead([{ status: 'done' }, { status: 'error' }]), 0, 'settled jobs are not ahead of anyone');
assert.equal(jobsAhead([{ status: 'running' }, { status: 'queued' }, { status: 'done' }]), 2);

// Wiring: the tray is mounted by App, exports run as jobs, and the dialog is
// the settings form only.
const appSrc = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
assert.ok(appSrc.includes('ExportJobsTray'), 'App mounts the export jobs tray');
assert.ok(appSrc.includes('enqueueExportJob'), 'App enqueues export jobs');
const dialogSrc = fs.readFileSync(new URL('../src/components/ExportDialog.jsx', import.meta.url), 'utf8');
assert.ok(!dialogSrc.includes('state.done') && !dialogSrc.includes('Export complete'), 'the dialog has no done view — completion lives in the tray');
assert.ok(!dialogSrc.includes('Exporting video'), 'the dialog has no in-progress view — progress lives in the tray');
assert.ok(dialogSrc.includes('gifLimitMessage'), 'the dialog states the GIF limit up front');
assert.ok((dialogSrc.match(/exportDuration\s*\(/g) || []).length >= 2, 'the dialog still derives durations from exportDuration()');

// P1-52 — pause / resume / retry, and the main-process pause itself.
// The pump skips paused jobs; a failed job re-queues with the same snapshot
// and a counted attempt; only video/audio pause while running. The SIGSTOP /
// SIGCONT mechanism is verified against /proc state on a real child, not a mock.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pickNextJob, retryPatch, canPauseRunning } from '../src/exportJobs.js';
const require = createRequire(import.meta.url);
const { trackExportProc, setExportPaused, clearExportPause, isExportPaused, liveExportProcCount } = require('../electron/exportPause.cjs');

const qjob = (over) => ({
  id: 'j1', kind: 'video', title: 'Export', status: 'queued', progress: 0, phase: null,
  phases: [{ id: 'text' }, { id: 'encode' }, { id: 'qc' }], attempts: 1, paused: false,
  error: null, cancelled: { current: false }, ...over,
});
const procState = (pid) => {
  try {
    const m = /State:\s*(\w)/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? m[1] : null;
  } catch { return null; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  assert.equal(pickNextJob([qjob({ id: 'a', paused: true }), qjob({ id: 'b' })])?.id, 'b',
    'pump skips a paused job and starts the one behind it');
  assert.equal(pickNextJob([qjob({ id: 'a', paused: true })]), null,
    'pump starts nothing when the only queued job is paused');
  assert.equal(pickNextJob([qjob({ id: 'a', status: 'running' }), qjob({ id: 'b' })])?.id, 'b',
    'pump skips the running job and picks the queued one');
  assert.equal(pickNextJob([]), null, 'empty queue picks nothing');

  const failedVideo = qjob({ status: 'error', progress: 0.6, phase: 'encode', error: 'boom', attempts: 1, cancelled: { current: true } });
  const rv = retryPatch(failedVideo);
  assert.deepEqual({ status: rv.status, progress: rv.progress, error: rv.error, phase: rv.phase, attempts: rv.attempts },
    { status: 'queued', progress: 0, error: null, phase: null, attempts: 2 },
    'retry re-queues a video job with progress/error cleared and the attempt counted');
  assert.equal(rv.cancelled.current, false, 'retry gets a fresh cancel flag');
  assert.equal(rv.paused, false, 'retry is unpaused');
  const failedAudio = qjob({ kind: 'audio', status: 'error', attempts: 2, phases: [{ id: 'mix' }, { id: 'master' }] });
  assert.equal(retryPatch(failedAudio).phase, 'mix', 'audio retry restarts at its first phase');
  assert.equal(retryPatch(failedAudio).attempts, 3, 'audio retry counts 2 -> 3');
  assert.equal(failedVideo.status, 'error', 'retryPatch does not mutate the failed job');

  assert.equal(canPauseRunning(qjob({ kind: 'video' })), true, 'video pauses while running');
  assert.equal(canPauseRunning(qjob({ kind: 'audio' })), true, 'audio pauses while running');
  assert.equal(canPauseRunning(qjob({ kind: 'enhance' })), false, 'enhance does NOT pause while running (no safe stop point)');
  assert.equal(canPauseRunning(qjob({ kind: 'zip' })), false, 'zip does NOT pause while running (in-process archiver)');

  const p = spawn('sleep', ['30']);
  trackExportProc(p);
  assert.equal(liveExportProcCount(), 1, 'tracked child is live');
  assert.equal(isExportPaused(), false, 'starts unpaused');
  setExportPaused(true);
  await sleep(300);
  assert.equal(procState(p.pid), 'T', `paused child is stopped (state ${procState(p.pid)})`);
  const p2 = spawn('sleep', ['30']);
  trackExportProc(p2);
  await sleep(300);
  assert.equal(procState(p2.pid), 'T', 'child spawned during a pause is stopped immediately');
  assert.equal(liveExportProcCount(), 2, 'both children tracked');
  setExportPaused(false);
  await sleep(300);
  assert.notEqual(procState(p.pid), 'T', 'resume restarts the first child');
  assert.notEqual(procState(p2.pid), 'T', 'resume restarts the second child');
  clearExportPause();
  assert.equal(isExportPaused(), false, 'clearExportPause leaves the flag unset');
  p.kill('SIGKILL');
  p2.kill('SIGKILL');
  await sleep(300);
  assert.equal(liveExportProcCount(), 0, 'closed children leave the live set');
})();

console.log('export-queue OK');
