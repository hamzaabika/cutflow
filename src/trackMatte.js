// True Track Matte System (P2-12): one track's picture drives another
// track's transparency. Pure logic — the inspector uses it to validate a
// pick, the preview uses it to find the source canvas, and the export
// (electron/ffmpeg.cjs) mirrors the same rules when it builds the matte
// layer: no nesting, no ramped sources, the source must start at or before
// the target (its frames are sampled at target time minus the start gap).
import { clipLen, videoLayout } from './store.js';
import { hasCurve } from './speedCurve.js';

export const MATTE_MODES = [
  { id: 'alpha', name: 'Alpha' },
  { id: 'luma', name: 'Luma' },
];
export const matteModeOf = (clip) => (clip.matte?.mode === 'luma' ? 'luma' : 'alpha');

// Timeline start of a picture clip (video clips are laid out back to back).
export function clipStart(project, track, clip) {
  if (track === 'overlay') return clip.start || 0;
  const found = videoLayout(project.videoClips).find((l) => l.clip.id === clip.id);
  return found ? found.start : 0;
}
export function findClipAnyTrack(project, id) {
  const v = (project.videoClips || []).find((c) => c.id === id);
  if (v) return { track: 'video', clip: v };
  const o = (project.overlayClips || []).find((c) => c.id === id);
  if (o) return { track: 'overlay', clip: o };
  return null;
}

// Clips that can be a matte source for `clip`: picture clips with media,
// not itself, not a gap.
export function matteCandidates(project, clip) {
  const mediaById = Object.fromEntries((project.media || []).map((m) => [m.id, m]));
  const ok = (c) => c.id !== clip.id && !c.gap && mediaById[c.mediaId] && mediaById[c.mediaId].type !== 'audio';
  return [
    ...(project.videoClips || []).filter(ok).map((c) => ({ track: 'video', clip: c })),
    ...(project.overlayClips || []).filter(ok).map((c) => ({ track: 'overlay', clip: c })),
  ];
}

// Validate clip.matte and resolve the sampling offset. Returns
// { ok, source, sourceTrack, fromLocal, mode, note?, reason? }.
// `reason` / `note` are stable codes (not display text) — the inspector maps
// them to translated strings via prim.matteReason* / prim.matteNote*.
export function resolveTrackMatte(project, clip, track) {
  const matte = clip.matte;
  if (!matte || !matte.sourceId) return { ok: false, reason: 'no-matte' };
  const found = findClipAnyTrack(project, matte.sourceId);
  if (!found) return { ok: false, reason: 'source-gone' };
  if (found.clip.id === clip.id) return { ok: false, reason: 'self' };
  if (found.clip.matte?.sourceId) return { ok: false, reason: 'nested' };
  const media = (project.media || []).find((m) => m.id === found.clip.mediaId);
  if (!media || media.type === 'audio') return { ok: false, reason: 'no-picture' };
  if (media.missing) return { ok: false, reason: 'media-missing' };
  if (hasCurve(found.clip)) return { ok: false, reason: 'ramped' };
  const targetStart = clipStart(project, track, clip);
  const sourceStart = clipStart(project, found.track, found.clip);
  const fromLocal = targetStart - sourceStart;
  if (fromLocal < -1e-6) return { ok: false, reason: 'starts-after' };
  const len = clipLen(clip);
  const sourceLen = clipLen(found.clip);
  const note = fromLocal + len > sourceLen + 1e-6 ? 'held-last-frame' : null;
  return { ok: true, source: found.clip, sourceTrack: found.track, fromLocal: Math.max(0, fromLocal), mode: matteModeOf(clip), note };
}
