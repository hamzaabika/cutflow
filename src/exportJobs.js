// Export jobs: the phase model and queue arithmetic behind the R4 export flow.
//
// The export dialog is a settings form; starting an export enqueues a JOB and
// the job runs detached from the dialog, reported in the jobs tray (App.jsx +
// ExportJobsTray.jsx). Jobs run strictly one at a time — the main process has
// exactly one video-export slot and one audio-export slot, both report on the
// shared export:progress channel and both answer export:cancel, so serialising
// in the renderer is what keeps progress and cancel attributed to the right job.
//
// This module is pure (no imports): the phase lists a job will pass through and
// the state each phase is in, derived from the same facts the pipeline itself
// branches on — text frames render only when the project has text clips, the
// effects pass only when fxWork() is non-zero, the cover embed only for a
// chosen poster frame in MP4/MOV. Nothing here invents a phase the pipeline
// does not actually run.

// The GIF duration cap, mirrored from GIF_MAX_SECONDS in electron/ffmpeg.cjs —
// the engine refuses longer timelines with this wording; the dialog states the
// same limit up front instead of letting the export fail after the fact.
export const GIF_MAX_SECONDS = 30;
export const gifLimitMessage = (seconds) => `GIF export is limited to ${GIF_MAX_SECONDS} s of timeline — this project is ${Number(seconds).toFixed(1)} s. Trim the timeline or split it into shorter exports.`;

// The phases of a video export, in pipeline order. `stage` is the sentence the
// tray shows while the phase runs (the wording the modal flow used before R4).
export function videoPhases(project, eff, hasFx) {
  const phases = [];
  if ((project.textClips || []).length) phases.push({ id: 'text', label: 'Text', stage: 'Rendering text' });
  if (hasFx) phases.push({ id: 'effects', label: 'Effects', stage: 'Rendering effects' });
  phases.push({ id: 'encode', label: 'Encoding', stage: 'Encoding video' });
  if (typeof project.posterAt === 'number' && (eff.format === 'mp4' || eff.format === 'mov')) {
    phases.push({ id: 'cover', label: 'Cover', stage: 'Embedding cover' });
  }
  return phases;
}

// The audio-only job's phases (electron/ffmpeg.cjs runAudioExport): the mixdown
// renders over progress 0 → AUDIO_PHASE_SPLIT, then the master loudness is
// measured and the real encode runs over the remainder. The split is the job's
// own constant, so the tray's phase boundary is the pipeline's, not a guess.
export const AUDIO_PHASE_SPLIT = 0.7;
export function audioPhases() {
  return [
    { id: 'mix', label: 'Mixdown', stage: 'Mixing audio' },
    { id: 'master', label: 'Master & encode', stage: 'Mastering & encoding audio' },
  ];
}

// The project-ZIP job's phases (checklist #7): one step — the archive
// streams file by file, so the single phase carries the whole bar.
export function zipPhases() {
  return [{ id: 'pack', label: 'Packing', stage: 'Packing project' }];
}
export const audioPhaseId = (progress) => (progress < AUDIO_PHASE_SPLIT ? 'mix' : 'master');

// The AI-enhance job's phases (electron/esrgan.cjs): frames are extracted,
// upscaled by the local Real-ESRGAN engine, then re-encoded — the same
// three stages the pipeline reports, in its own progress fractions.
export function enhancePhases() {
  return [
    { id: 'frames', label: 'Frames', stage: 'Extracting frames' },
    { id: 'upscale', label: 'AI upscale', stage: 'Upscaling frames' },
    { id: 'encode', label: 'Encoding', stage: 'Encoding video' },
  ];
}

// Each phase's display state for a job: everything before the active phase is
// done, everything after it is pending. A queued job has done nothing; a
// finished job has done everything.
export function phaseStates(phases, activeId, status) {
  if (status === 'done') return phases.map((p) => ({ ...p, state: 'done' }));
  if (status !== 'running') return phases.map((p) => ({ ...p, state: 'pending' }));
  const at = Math.max(0, phases.findIndex((p) => p.id === activeId));
  return phases.map((p, i) => ({ ...p, state: i < at ? 'done' : i === at ? 'active' : 'pending' }));
}

// How many jobs are ahead of a new export (running + queued) — the dialog's
// queue hint and the tray's ordering both read this, so they cannot disagree.
export const jobsAhead = (jobs) => jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
