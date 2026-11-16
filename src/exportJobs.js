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
// The master-loudness phase runs only when mastering is on AND the timeline
// has audible sound — a silent project never enters it, and a GIF has no
// audio to master.
export function projectHasAudio(project) {
  const byId = new Map((project.media || []).map((m) => [m.id, m]));
  const audible = (c) => c && !c.muted && byId.get(c.mediaId)?.hasAudio;
  return (project.videoClips || []).some(audible)
    || (project.overlayClips || []).some(audible)
    || (project.audioClips || []).some(audible);
}
export function videoPhases(project, eff, hasFx) {
  const phases = [];
  if ((project.textClips || []).length) phases.push({ id: 'text', label: 'Text', stage: 'Rendering text' });
  if (hasFx) phases.push({ id: 'effects', label: 'Effects', stage: 'Rendering effects' });
  phases.push({ id: 'encode', label: 'Encoding', stage: 'Encoding video' });
  if (eff && eff.loudness !== 'off' && eff.format !== 'gif' && projectHasAudio(project)) {
    phases.push({ id: 'loudness', label: 'Loudness', stage: 'Mastering loudness' });
  }
  if (typeof project.posterAt === 'number' && (eff.format === 'mp4' || eff.format === 'mov')) {
    phases.push({ id: 'cover', label: 'Cover', stage: 'Embedding cover' });
  }
  // P1-57: the automatic quality check runs on every video export, after
  // the encode (and the loudness master) — the tray shows it as the last
  // phase before the done card.
  phases.push({ id: 'qc', label: 'Quality', stage: 'Checking export quality' });
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
    // P1-57: the automatic quality check (silence + duration) runs on every
    // audio export too, after the encode.
    { id: 'qc', label: 'Quality', stage: 'Checking export quality' },
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

// P1-52 — queue controls (pure, unit-tested in test-export-queue.mjs).
//
// The pump starts the first job that is queued AND not paused. A paused job
// holds its place; everything behind it may run. (Pause is per-job, never
// global — one long export must not freeze the whole queue.)
export const pickNextJob = (jobs) => jobs.find((j) => j.status === 'queued' && !j.paused) || null;

// The field patch that re-queues a failed job for another attempt. The job
// keeps its id, project snapshot and target, so the retry is the same export
// run again — not a new job. The settle promise is replaced by the caller
// (the old one already resolved on failure). Video jobs start with phase
// null (the text phase is optional); the other kinds start at their first
// listed phase.
export function retryPatch(job) {
  return {
    status: 'queued', progress: 0,
    phase: job.kind === 'video' ? null : (job.phases?.[0]?.id || null),
    error: null, attempts: (job.attempts || 1) + 1, paused: false, settled: false,
    cancelled: { current: false },
  };
}

// Which kinds support pausing WHILE RUNNING. Video and audio exports pause
// in both places that matter: the renderer frame loops wait (see the
// isPaused callbacks) and the live ffmpeg children are SIGSTOP'd. Enhance
// runs a long-lived external engine child with its own staging, and the ZIP
// runs in-process through archiver — neither has a safe stop point, so a
// running enhance/zip job can only be paused while it is still queued, and
// can otherwise only be cancelled.
export const canPauseRunning = (job) => job.kind === 'video' || job.kind === 'audio';
