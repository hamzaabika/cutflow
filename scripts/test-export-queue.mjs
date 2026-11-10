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
assert.deepEqual(videoPhases(proj(), eff(), false).map((p) => p.id), ['encode'], 'bare project: encode only');
assert.deepEqual(videoPhases(proj({ textClips: [{}] }), eff(), false).map((p) => p.id), ['text', 'encode'], 'text clips add the text phase');
assert.deepEqual(videoPhases(proj(), eff(), true).map((p) => p.id), ['effects', 'encode'], 'fx work adds the effects phase');
assert.deepEqual(videoPhases(proj({ textClips: [{}], posterAt: 1.5 }), eff(), true).map((p) => p.id),
  ['text', 'effects', 'encode', 'cover'], 'full pipeline, in order');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'webm' }), false).map((p) => p.id), ['encode'],
  'no cover phase for WebM — the embed does not exist there');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'gif' }), false).map((p) => p.id), ['encode'],
  'no cover phase for GIF');
assert.deepEqual(videoPhases(proj({ posterAt: 0 }), eff({ format: 'mov' }), false).map((p) => p.id), ['encode', 'cover'],
  'MOV takes the cover phase like MP4');

// Phase states around the active phase.
const phases = videoPhases(proj({ textClips: [{}], posterAt: 2 }), eff(), true);
assert.deepEqual(phaseStates(phases, 'encode', 'running').map((p) => p.state), ['done', 'done', 'active', 'pending']);
assert.deepEqual(phaseStates(phases, 'text', 'running').map((p) => p.state), ['active', 'pending', 'pending', 'pending']);
assert.ok(phaseStates(phases, 'encode', 'done').every((p) => p.state === 'done'), 'a finished job: every phase done');
assert.ok(phaseStates(phases, 'encode', 'queued').every((p) => p.state === 'pending'), 'a queued job: nothing started');

// Audio phases ride the engine job's own split.
assert.equal(AUDIO_PHASE_SPLIT, 0.7);
assert.equal(audioPhaseId(0), 'mix');
assert.equal(audioPhaseId(0.69), 'mix');
assert.equal(audioPhaseId(0.7), 'master');
assert.equal(audioPhaseId(1), 'master');
assert.deepEqual(audioPhases().map((p) => p.id), ['mix', 'master']);

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

console.log('export-queue OK');
