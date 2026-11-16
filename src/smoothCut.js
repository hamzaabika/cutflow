// Smooth Cut (P2-06) — jump-cut smoothing for talking-head cuts, distinct from the
// transition catalog: it lives ON the cut between two clips of the SAME source,
// not in the transition list. Two modes:
//
//   punch — a subtle scale punch (1 -> 1.06) across the cut, written as ordinary
//           scale keyframes on both clips (marked sc: true), so the preview and
//           the export render it through the same motion curves (anim.js) with
//           full parity. The A/B preview toggle suppresses those keys only in the
//           preview (stateAt opts.skipSmoothCut); the export always includes them.
//   blend — a short (0.05-0.3 s) linear crossfade at export time (xfade fade in
//           electron/ffmpeg.cjs). The preview cannot crossfade a plain cut, so
//           blend is export-only and the UI says so.
//
// Fallback: the motion check (electron/smoothcut.cjs) compares the frames either
// side of the cut; a large change (PSNR below SMOOTH_CUT_PSNR_MIN) means the cut
// would warp a face or hands, so the cut stays hard and the reason is stored on
// clip.smoothCut.fallback. Nothing here touches clip.transition or clip.audioFx.
import { clipDuration } from './speedCurve.js';
import { keyAt, setKey } from './anim.js';

export const SMOOTH_CUT_PSNR_MIN = 24; // dB across the cut; below this, fall back to a hard cut
export const SMOOTH_CUT_PUNCH = 1.06; // peak punch-in scale across the cut
export const SMOOTH_CUT_DUR_MIN = 0.05;
export const SMOOTH_CUT_DUR_MAX = 0.3;
export const clampDur = (d) => Math.min(SMOOTH_CUT_DUR_MAX, Math.max(SMOOTH_CUT_DUR_MIN, Number(d) || 0.15));

// The clip before `clip` on the main track, when the two form one continuous
// take of the same source (the only cuts a smooth cut can smooth).
export function smoothCutPair(project, clip) {
  const clips = (project && project.videoClips) || [];
  const i = clips.findIndex((c) => c.id === clip.id);
  if (i <= 0) return null;
  const prev = clips[i - 1];
  if (!prev || prev.gap || clip.gap) return null;
  if (!prev.mediaId || prev.mediaId !== clip.mediaId) return null;
  if (Math.abs((prev.out ?? 0) - (clip.in ?? 0)) > 0.05) return null;
  return { prev, next: clip, index: i };
}

const hasAnimScale = (c) => !!(c.anim && (c.anim.in || c.anim.combo));

// Why this cut cannot take a punch-in (null = it can). The export blend path
// re-checks eligibility in electron/smoothcut.cjs, so the two cannot drift.
export function smoothCutBlockReason(project, clip, dur = 0.15) {
  const pair = smoothCutPair(project, clip);
  if (!pair) return 'no-pair';
  const d = clampDur(dur);
  if (clipDuration(pair.prev) < d + 0.1 || clipDuration(clip) < d + 0.1) return 'too-short';
  if (hasAnimScale(pair.prev) || hasAnimScale(clip)) return 'has-anim';
  // Existing scale keys inside the punch window would be overwritten by the
  // recipe, so refuse rather than destroy the user's own curve.
  for (const [c, lt0, lt1] of [[pair.prev, clipDuration(pair.prev) - d, clipDuration(pair.prev)], [clip, 0, d]]) {
    const keys = (c.keyframes?.scale || []).filter((k) => {
      // localTime needs the clip; approximate with the source-time span of the window
      return k.t >= (c.in || 0) + lt0 * (c.speed || 1) - 0.01 && k.t <= (c.in || 0) + lt1 * (c.speed || 1) + 0.01;
    });
    if (keys.length) return 'has-keys';
  }
  return null;
}

// Punch-in keyframes for one clip, as a { keyframes } patch (anim.js setKey, so
// the times stay glued to the picture on speed changes). The generated keys are
// marked sc: true (found back through keyAt, so ramped clips mark correctly),
// which is what the A/B preview skips.
function punchKeys(clip, pairs) {
  let draft = { ...clip };
  for (const [lt, v] of pairs) draft = { ...draft, ...setKey(draft, 'scale', lt, v) };
  const keyframes = { ...(draft.keyframes || {}) };
  keyframes.scale = (keyframes.scale || []).map((k) => ({ ...k }));
  for (const [lt] of pairs) {
    const found = keyAt(draft, 'scale', lt);
    if (!found) continue;
    const idx = keyframes.scale.findIndex((k) => k === found || Math.abs(k.t - found.t) < 1e-4);
    if (idx >= 0) keyframes.scale[idx] = { ...keyframes.scale[idx], sc: true };
  }
  return { keyframes };
}
export function smoothCutPunchPatches(project, clip, dur = 0.15) {
  const pair = smoothCutPair(project, clip);
  if (!pair) return null;
  const d = clampDur(dur);
  const reason = smoothCutBlockReason(project, clip, d);
  if (reason) return { ok: false, reason };
  const sPrev = (pair.prev.transform && pair.prev.transform.scale) || 1;
  const sNext = (clip.transform && clip.transform.scale) || 1;
  const lp = clipDuration(pair.prev);
  return {
    ok: true,
    patches: [
      { id: pair.prev.id, patch: punchKeys(pair.prev, [[lp - d, sPrev], [lp, sPrev * SMOOTH_CUT_PUNCH]]) },
      { id: clip.id, patch: punchKeys(clip, [[0, sNext * SMOOTH_CUT_PUNCH], [d, sNext]]) },
    ],
  };
}

// Strip the recipe's keys from a clip (disabling Smooth Cut restores the cut
// exactly — the user's own keys are never touched).
export function stripSmoothCutKeys(clip) {
  if (!clip.keyframes?.scale?.some((k) => k.sc)) return null;
  const keyframes = { ...clip.keyframes };
  keyframes.scale = keyframes.scale.filter((k) => !k.sc);
  if (!keyframes.scale.length) delete keyframes.scale;
  return { keyframes };
}

// True when the preview should show the HARD cut for this clip: its own
// smooth-cut preview is set to hard, or it is the clip before one whose
// preview is hard (the punch spans both sides of the cut).
export function smoothCutPreviewHard(project, clip) {
  if (!clip) return false;
  if (clip.smoothCut && clip.smoothCut.preview === 'hard') return true;
  const clips = (project && project.videoClips) || [];
  const i = clips.findIndex((c) => c.id === clip.id);
  const next = i >= 0 ? clips[i + 1] : null;
  return !!(next && next.smoothCut && next.smoothCut.preview === 'hard');
}

// The export blend length for the junction into clips[i] (0 = hard cut):
// blend mode, no fallback, same-source contiguous pair. Mirrored in
// electron/smoothcut.cjs (smoothCutBlendDur) — the node test keeps them in sync.
export function smoothCutBlendDur(clips, i) {
  const c = clips[i];
  if (!c || !c.smoothCut || c.smoothCut.mode !== 'blend') return 0;
  if (c.smoothCut.fallback) return 0;
  const prev = clips[i - 1];
  if (!prev || !prev.mediaId || prev.mediaId !== c.mediaId) return 0;
  if (Math.abs((prev.out ?? 0) - (c.in ?? 0)) > 0.05) return 0;
  return clampDur(c.smoothCut.dur ?? 0.12);
}
