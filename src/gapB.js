// Gap-build Stream B (§5.2 + §5.4) — pure helpers for the new features.
// Every function here is side-effect free and covered by scripts/test-gap-b-core.cjs.
// The store wires them as actions; the preview/export read the fields they write.
// Nothing here invents media or samples: all inputs come from the project document.
import { MIN_CLIP, clipLen, freeLen, videoLayout } from './store.js';
import { hasCurve, sourceOffsetAt, timelineOffsetAt } from './speedCurve.js';

// ---------------------------------------------------------------------------
// FX-01 — non-destructive effect stack: bypass, reorder, copy/paste.
// A clip's stack is clip.effects (order = render order) plus per-effect maps
// (fxParams / fxStrength / fxTiming / fxRegions / fxKeys). Bypass lives in
// clip.fxBypass { [fxId]: true }; src/fx/apply.js skips bypassed ids in
// pixelPasses / drawOverlayPasses / overlayRanges / clipHasPixelFx, so a
// bypassed effect renders as if it were not there, without losing its settings.
// Before/after is UI state (hold-to-compare): the inspector renders the clip
// with the whole stack bypassed while held — see ClipInspector.
export const fxBypass = (clip, fx) => !!(clip && clip.fxBypass && clip.fxBypass[fx]);
export function setFxBypass(clip, fx, on) {
  const next = { ...(clip.fxBypass || {}) };
  if (on) next[fx] = true; else delete next[fx];
  return { ...clip, fxBypass: next };
}
export function moveFx(clip, fx, dir) {
  const list = [...(clip.effects || [])];
  const i = list.indexOf(fx);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return clip;
  [list[i], list[j]] = [list[j], list[i]];
  return { ...clip, effects: list };
}
// A portable copy of one clip's whole stack (effects + every per-effect map).
export function copyFxStack(clip) {
  const pick = (m) => (m ? structuredClone(m) : undefined);
  return {
    effects: [...(clip.effects || [])],
    fxParams: pick(clip.fxParams), fxStrength: pick(clip.fxStrength),
    fxTiming: pick(clip.fxTiming), fxRegions: pick(clip.fxRegions),
    fxKeys: pick(clip.fxKeys), fxBypass: pick(clip.fxBypass),
  };
}
export function pasteFxStack(clip, stack) {
  if (!stack || !Array.isArray(stack.effects)) return clip;
  const next = { ...clip, effects: [...stack.effects] };
  for (const k of ['fxParams', 'fxStrength', 'fxTiming', 'fxRegions', 'fxKeys', 'fxBypass']) {
    if (stack[k]) next[k] = structuredClone(stack[k]); else delete next[k];
  }
  return next;
}

// ---------------------------------------------------------------------------
// TL-03 — J-cuts / L-cuts + independent linked-audio trimming.
// A detached pair shares linkId; linkOff = audio.start - videoStart (seconds,
// negative = audio leads the picture = J-cut) and linkInOff = audio.in - video.in.
// The video clip never moves here: only the audio partner's window/offset moves.
export function linkedAudioOf(p, videoClip) {
  if (!videoClip || !videoClip.linkId) return null;
  return (p.audioClips || []).find((a) => a.linkId === videoClip.linkId) || null;
}
export function videoStartOf(p, clipId) {
  const l = videoLayout(p.videoClips).find((x) => x.clip.id === clipId);
  return l ? l.start : 0;
}
// J-cut: the next clip's audio starts `delta` seconds BEFORE its picture.
export function applyJCut(p, videoClipId, delta) {
  const v = p.videoClips.find((c) => c.id === videoClipId);
  const a = v && linkedAudioOf(p, v);
  if (!v || !a) return p;
  const d = Math.max(0, Math.min(Number(delta) || 0, Math.max(0, a.start)));
  if (!d) return p;
  const audio = { ...a, start: a.start - d, linkOff: (a.linkOff || 0) - d };
  return { ...p, audioClips: p.audioClips.map((x) => (x.id === a.id ? audio : x)) };
}
// L-cut: the previous clip's audio runs `delta` seconds PAST its picture's end.
export function applyLCut(p, videoClipId, delta) {
  const v = p.videoClips.find((c) => c.id === videoClipId);
  const a = v && linkedAudioOf(p, v);
  if (!v || !a) return p;
  const m = p.media.find((x) => x.id === a.mediaId);
  const maxOut = m && m.type !== 'image' ? (m.duration || Infinity) : Infinity;
  const sp = a.speed || 1;
  const d = Math.max(0, Number(delta) || 0);
  const newOut = Math.min(a.out + d * sp, maxOut);
  if (newOut - a.out < 0.01) return p;
  const audio = { ...a, out: newOut, linkEndOff: (a.linkEndOff || 0) + (newOut - a.out) / sp };
  return { ...p, audioClips: p.audioClips.map((x) => (x.id === a.id ? audio : x)) };
}
// Trim a linked audio clip's own window without moving its video partner.
// edge 'left': move audio.in (and start) later; 'right': move audio.out earlier.
// linkOff/linkInOff are re-derived so a later re-link / replace keeps the trim.
export function trimLinkedAudio(p, { id, edge, delta }) {
  const a = (p.audioClips || []).find((x) => x.id === id);
  if (!a || !a.linkId) return p;
  const sp = a.speed || 1;
  const v = p.videoClips.find((c) => c.linkId === a.linkId);
  let next = null;
  if (edge === 'left') {
    const newIn = Math.max(0, Math.min(a.in + delta * sp, a.out - MIN_CLIP * sp));
    const d = (newIn - a.in) / sp;
    if (!d) return p;
    next = { ...a, in: newIn, start: a.start + d, linkInOff: (a.linkInOff || 0) + d, linkOff: (a.linkOff || 0) + d, linkTrimmed: true };
  } else {
    const m = p.media.find((x) => x.id === a.mediaId);
    const maxOut = m && m.type !== 'image' ? (m.duration || Infinity) : Infinity;
    const newOut = Math.max(a.in + MIN_CLIP * sp, Math.min(a.out - delta * sp, maxOut));
    const d = (a.out - newOut) / sp;
    if (!d) return p;
    next = { ...a, out: newOut, linkEndOff: (a.linkEndOff || 0) - d, linkTrimmed: true };
  }
  void v;
  return { ...p, audioClips: p.audioClips.map((x) => (x.id === a.id ? next : x)) };
}

// ---------------------------------------------------------------------------
// Q/W trim (spec matrix): Q = ripple-trim the edit BEFORE the playhead to the
// playhead; W = ripple-trim the edit AFTER the playhead to the playhead.
// Implemented as the store's existing trimActions (split + delete one half)
// via the 'qwTrim' action in historyReducer — this helper only describes the
// request; the store does the work, so there is exactly one code path.
export function qwTrimActions(p, { track, id, t, which }) {
  return { track, id, t, side: which === 'q' ? 'left' : 'right' };
}

// ---------------------------------------------------------------------------
// P1-50 — frame hold. clip.frameHold = { at, duration }:
//   at: SOURCE seconds of the frame to freeze (absolute in the media file);
//   duration: TIMELINE seconds the frozen frame stays on screen.
// The picture freezes; the clip's audio keeps playing underneath (the
// standard NLE behaviour). Preview maps the hold window to the frozen source
// time (src/components/Preview.jsx); export rebuilds the clip as
// pre + frozen-frame + post in electron/ffmpeg.cjs.
export function frameHoldWindow(clip, clipStart) {
  const fh = clip && clip.frameHold;
  if (!fh || !Number.isFinite(fh.at) || !Number.isFinite(fh.duration) || fh.duration <= 0) return null;
  const len = clipLen(clip);
  const sp = clip.speed || 1;
  const local = (fh.at - (clip.in || 0)) / sp; // timeline offset of the frozen frame
  if (local < 0 || local >= len) return null;
  const dur = Math.min(fh.duration, len - local);
  if (dur < 0.05) return null;
  return { start: clipStart + local, end: clipStart + local + dur, at: fh.at, local, duration: dur };
}
// Source offset (relative to clip.in) the preview should show at timeline
// offset lt into the clip, or null when no hold applies there.
export function frameHoldSourceOffset(clip, lt) {
  if (!clip || !clip.frameHold || hasCurve(clip)) return null;
  const w = frameHoldWindow(clip, 0);
  if (!w) return null;
  if (lt < w.local || lt >= w.local + w.duration) return null;
  return w.at - (clip.in || 0);
}
export function validateFrameHold(clip) {
  if (!clip || !clip.frameHold) return { ok: true };
  const fh = clip.frameHold;
  if (!Number.isFinite(fh.at) || fh.at < (clip.in || 0) || fh.at > (clip.out || 0)) {
    return { ok: false, error: 'Hold frame must be inside the clip’s source window.' };
  }
  if (!Number.isFinite(fh.duration) || fh.duration <= 0) return { ok: false, error: 'Hold duration must be positive.' };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Split Screen effect (spec matrix — distinct from the removed fx_split
// transition). A layout tool, not a pixel shader: it places two picture clips
// side by side (or stacked) using the transform the preview and export
// already render. Returns update patches [{ track, id, patch }].
export const SPLIT_SCREEN_MODES = ['left-right', 'right-left', 'top-bottom', 'bottom-top'];
export function splitScreenPatches(p, { aTrack, aId, bTrack, bId, mode }) {
  if (!SPLIT_SCREEN_MODES.includes(mode)) return [];
  const find = (track, id) => {
    const key = { video: 'videoClips', overlay: 'overlayClips' }[track];
    return key ? (p[key] || []).find((c) => c.id === id) : null;
  };
  const a = find(aTrack, aId);
  const b = find(bTrack, bId);
  if (!a || !b || a.id === b.id) return [];
  const horizontal = mode.includes('left-right') || mode.includes('right-left');
  const firstOnLeft = mode === 'left-right' || mode === 'top-bottom';
  const [first, second] = firstOnLeft ? [a, b] : [b, a];
  const at = (c, sign) => ({
    ...c,
    transform: { ...(c.transform || {}), scale: 0.5, x: horizontal ? sign * 0.25 : 0, y: horizontal ? 0 : sign * 0.25 },
    splitScreen: { partner: c.id === a.id ? b.id : a.id, mode },
  });
  return [
    { track: aTrack, id: a.id, patch: at(a, a.id === first.id ? -1 : 1) },
    { track: bTrack, id: b.id, patch: at(b, b.id === first.id ? -1 : 1) },
  ];
}

// ---------------------------------------------------------------------------
// Pan-Zoom named tool (spec matrix). A Ken Burns move over the whole clip,
// stored as the fx_panzoom pixel effect with params (see src/fx/catalog.js):
// scale interpolates startScale -> endScale across `span` seconds while the
// picture pans panX/panY (frame fractions). span is set from the clip length
// by the store action so the move always spans the clip.
export function panZoomPatch(clip, { from, to }) {
  const len = clipLen(clip);
  const fxParams = {
    ...(clip.fxParams || {}),
    fx_panzoom: {
      startScale: Number(from?.scale) || 1,
      endScale: Number(to?.scale) || 1.15,
      panX: (Number(to?.x) || 0) - (Number(from?.x) || 0),
      panY: (Number(to?.y) || 0) - (Number(from?.y) || 0),
      span: Math.max(0.1, len),
    },
  };
  return {
    effects: [...(clip.effects || []).filter((e) => e !== 'fx_panzoom'), 'fx_panzoom'],
    fxParams,
    panZoom: { from: { scale: 1, x: 0, y: 0, ...(from || {}) }, to: { scale: 1.15, x: 0, y: 0, ...(to || {}) } },
  };
}

// ---------------------------------------------------------------------------
// Speed range 0.1–100× + Montage / Hero / Bullet presets (spec matrix).
// The old Speed dialog clamped to 0.05–16×; the store never clamped, so
// widening the dialog is the whole change (plus these named presets).
export const SPEED_MIN = 0.1;
export const SPEED_MAX = 100;
export const SPEED_PRESETS_NAMED = [
  { id: 'montage', name: 'Montage', speed: 4, note: 'Fast-cut energy: 4×' },
  { id: 'hero', name: 'Hero', speed: 0.5, note: 'Slow-motion hero moment: 0.5×' },
  { id: 'bullet', name: 'Bullet', speed: 10, note: 'Bullet-time sweep: 10×' },
];
export const clampSpeedRange = (s) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, Number(s) || 1));

// ---------------------------------------------------------------------------
// Source Monitor helpers (spec matrix): a source in/out window over one media
// item. The store's addToTimeline honours a.in/a.out when given.
export function sourceWindow(media, { inPoint, outPoint } = {}) {
  const dur = media && media.duration ? media.duration : 0;
  const i = Math.max(0, Number(inPoint) || 0);
  const o = outPoint == null ? dur : Math.min(dur, Number(outPoint));
  if (dur > 0 && o - i < MIN_CLIP) return null;
  return { in: i, out: o || dur };
}

// Re-exported for tests that import from here.
export { clipLen as _clipLen, freeLen as _freeLen, videoLayout as _videoLayout };
export { sourceOffsetAt as _sourceOffsetAt, timelineOffsetAt as _timelineOffsetAt };
