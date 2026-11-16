// Roll / slip / slide / rate-stretch (P2-01, TL-05) — non-destructive trim tools.
// Pure functions over the project; the reducer wires them as actions and the
// Timeline's trim-tool mode drives them from edge / body drags. All four keep
// the source window inside the media bounds, keep every clip >= MIN_CLIP, and
// refuse speed-curve clips (the curve integral makes a roll/slip ambiguous —
// those clips keep the plain trim path, which already understands curves).
// Sign conventions (timeline seconds, from the gesture):
//   roll  delta > 0 moves the shared edit point LATER (A grows, B shrinks)
//   slip  delta > 0 shows LATER source (the window slides right, start fixed)
//   slide delta > 0 moves the clip LATER (neighbours trim/extend to fill)
//   rate  delta > 0 makes the clip LONGER (speed drops, window unchanged)
import { MIN_CLIP, clipLen, freeLen, videoLayout } from './store.js';
import { hasCurve } from './speedCurve.js';
import { effectiveFps, quantize } from './frames.js';

const TRACKS = { video: 'videoClips', overlay: 'overlayClips', audio: 'audioClips' };
const MEDIA_TRACKS = ['video', 'overlay', 'audio'];

const mediaDur = (p, c) => {
  const m = c && c.mediaId ? p.media.find((x) => x.id === c.mediaId) : null;
  if (!m) return Infinity;
  return m.type === 'image' ? Infinity : (m.duration || Infinity);
};
const spanOf = (c) => c.out - c.in;
const speedOf = (c) => c.speed || 1;
const clampD = (d, lo, hi) => Math.max(lo, Math.min(hi, d));

// ---- Roll: move the edit point between two adjacent clips. A grows/shrinks,
// B shrinks/grows by the same timeline amount; the total duration never
// changes, so sync with every other track is preserved by construction.
export function rollEdit(p, { track = 'video', id, edge = 'right', delta = 0 }) {
  if (!MEDIA_TRACKS.includes(track)) return p;
  delta = quantize(delta, effectiveFps(p));
  if (!delta) return p;
  const key = TRACKS[track];
  const list = p[key];
  if (track === 'video') {
    const lay = videoLayout(list);
    const idx = lay.findIndex((l) => l.clip.id === id);
    if (idx < 0) return p;
    const aIdx = edge === 'left' ? idx - 1 : idx;
    const bIdx = edge === 'left' ? idx : idx + 1;
    const A = list[aIdx];
    const B = list[bIdx];
    if (!A || !B || A.gap || B.gap) return p;
    if (hasCurve(A) || hasCurve(B)) return p;
    const spA = speedOf(A);
    const spB = speedOf(B);
    // d > 0: edit point later — A longer, B shorter. Bounds: A keeps >=
    // MIN_CLIP and stays inside its media; B keeps >= MIN_CLIP and in >= 0.
    const lo = Math.max(-(clipLen(A) - MIN_CLIP), -(B.in / spB));
    const hi = Math.min(clipLen(B) - MIN_CLIP, (mediaDur(p, A) - A.out) / spA);
    // B.out is fixed, so B can only shrink to MIN_CLIP and A can only grow
    // while its own media lasts; the B.in >= 0 bound covers d < 0.
    const d = clampD(delta, lo, hi);
    if (!d) return p;
    const next = [...list];
    next[aIdx] = { ...A, out: A.out + d * spA };
    next[bIdx] = { ...B, in: B.in + d * spB };
    return { ...p, [key]: next };
  }
  // Free tracks: the two clips must touch (A ends where B starts).
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return p;
  const aIdx = edge === 'left' ? idx - 1 : idx;
  const bIdx = edge === 'left' ? idx : idx + 1;
  const A = list[aIdx];
  const B = list[bIdx];
  if (!A || !B || hasCurve(A) || hasCurve(B)) return p;
  if (Math.abs((A.start + freeLen(track, A)) - B.start) > 0.05) return p;
  const spA = speedOf(A);
  const spB = speedOf(B);
  const d = clampD(delta,
    Math.max(-(freeLen(track, A) - MIN_CLIP), -(B.in / spB)),
    Math.min(freeLen(track, B) - MIN_CLIP, (mediaDur(p, A) - A.out) / spA));
  if (!d) return p;
  const next = [...list];
  next[aIdx] = { ...A, out: A.out + d * spA };
  next[bIdx] = { ...B, in: B.in + d * spB, start: B.start + d };
  return { ...p, [key]: next };
}

// ---- Slip: move the source window inside the media. The clip's timeline
// position and length never change, so nothing else on any track moves.
export function slipClip(p, { track = 'video', id, delta = 0 }) {
  if (!MEDIA_TRACKS.includes(track)) return p;
  delta = quantize(delta, effectiveFps(p));
  if (!delta) return p;
  const key = TRACKS[track];
  const list = p[key];
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return p;
  const c = list[idx];
  if (c.gap || hasCurve(c)) return p;
  const sp = speedOf(c);
  const span = spanOf(c);
  const maxOut = mediaDur(p, c);
  // Source shift, clamped so [in, out] stays inside [0, media duration].
  const shift = clampD(delta * sp, -c.in, maxOut - c.out);
  if (!shift) return p;
  const next = [...list];
  next[idx] = { ...c, in: c.in + shift, out: c.out + shift };
  return { ...p, [key]: next };
}

// ---- Slide: move the clip along the timeline; the neighbours absorb the
// move (the one left behind extends, the one ahead is trimmed), so the total
// duration and every other track stay in sync.
export function slideClip(p, { track = 'video', id, delta = 0 }) {
  if (!MEDIA_TRACKS.includes(track)) return p;
  delta = quantize(delta, effectiveFps(p));
  if (!delta) return p;
  const key = TRACKS[track];
  const list = p[key];
  if (track === 'video') {
    const lay = videoLayout(list);
    const idx = lay.findIndex((l) => l.clip.id === id);
    if (idx < 0) return p;
    const A = list[idx - 1];
    const B = list[idx];
    const C = list[idx + 1];
    if (!A || !C || B.gap || hasCurve(B)) return p;
    if ((A.gap && hasCurve(A)) || (C.gap && hasCurve(C))) return p;
    const next = [...list];
    if (delta > 0) {
      // B moves right: A extends into B's old space, C is trimmed at its head.
      let d = delta;
      if (!A.gap) d = Math.min(d, (mediaDur(p, A) - A.out) / speedOf(A));
      // C head-trim bound: C.in can advance at most (its length - MIN_CLIP)
      // in timeline seconds; a gap C just shrinks.
      if (!C.gap) d = Math.min(d, clipLen(C) - MIN_CLIP);
      d = Math.max(0, d);
      if (!d) return p;
      next[idx - 1] = A.gap ? { ...A, out: A.out + d } : { ...A, out: A.out + d * speedOf(A) };
      next[idx + 1] = C.gap ? { ...C, out: C.out - d } : { ...C, in: C.in + d * speedOf(C) };
      return { ...p, [key]: next };
    }
    // B moves left: A is trimmed at its tail, C extends into B's old space.
    let d = -delta;
    if (!A.gap) d = Math.min(d, clipLen(A) - MIN_CLIP);
    else d = Math.min(d, Math.max(0, (A.out - A.in) - 0.02));
    if (!C.gap) d = Math.min(d, (mediaDur(p, C) - C.out) / speedOf(C));
    d = Math.max(0, d);
    if (!d) return p;
    next[idx - 1] = A.gap ? { ...A, out: A.out - d } : { ...A, out: A.out - d * speedOf(A) };
    next[idx + 1] = C.gap ? { ...C, out: C.out + d } : { ...C, in: C.in - d * speedOf(C) };
    return { ...p, [key]: next };
  }
  // Free tracks: move start by d; a neighbour the clip would overlap is
  // trimmed at the overlapped edge (never deleted — d is clamped so no
  // neighbour is fully covered).
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return p;
  const c = list[idx];
  if (hasCurve(c)) return p;
  const len = freeLen(track, c);
  let d = Math.max(-c.start, delta);
  const newStart = c.start + d;
  const newEnd = newStart + len;
  // Clamp so no same-layer neighbour is fully covered by the new span.
  for (const o of list) {
    if (o.id === c.id || (o.layer || 0) !== (c.layer || 0)) continue;
    const os = o.start;
    const oe = os + freeLen(track, o);
    if (newStart <= os && newEnd >= oe) {
      // Would swallow o whole: stop at its edge.
      d = d > 0 ? Math.max(0, os - len - c.start) : Math.min(0, oe - c.start);
    }
  }
  if (!d) return p;
  const ns = c.start + d;
  const ne = ns + len;
  const next = list.map((o) => {
    if (o.id === c.id) return { ...o, start: ns };
    if ((o.layer || 0) !== (c.layer || 0)) return o;
    const os = o.start;
    const oe = os + freeLen(track, o);
    if (oe > ns && os < ns && oe <= ne) {
      // Neighbour ends inside the moved clip: trim its tail (source out).
      const cut = oe - ns; // timeline seconds to remove from its tail
      if (track === 'audio' || track === 'overlay') {
        const nl = freeLen(track, o) - cut;
        if (nl < MIN_CLIP) return o;
        return { ...o, out: o.out - cut * speedOf(o) };
      }
      return o;
    }
    if (os >= ns && os < ne && oe > ne) {
      // Neighbour starts inside the moved clip: trim its head, keep its end.
      const cut = ne - os;
      if (track === 'audio' || track === 'overlay') {
        const nl = freeLen(track, o) - cut;
        if (nl < MIN_CLIP) return o;
        return { ...o, in: o.in + cut * speedOf(o), start: ne };
      }
      return o;
    }
    return o;
  });
  return { ...p, [key]: next };
}

// ---- Rate-stretch: change the clip's duration by delta, keeping the source
// window. The speed is recomputed (span / new length) and clamped to the
// 0.25x–4x range the speed engine supports; the effective length follows the
// clamped speed, so the result is always exactly what the speed says.
// pitch: 'preserve' (default — atempo, pitch unchanged) or 'shift' (resample,
// pitch follows the speed, like varispeed). Stored on the clip as ratePitch so
// the export can honour it explicitly.
export function rateStretch(p, { track = 'video', id, delta = 0, preservePitch = true }) {
  if (!MEDIA_TRACKS.includes(track)) return p;
  delta = quantize(delta, effectiveFps(p));
  if (!delta) return p;
  const key = TRACKS[track];
  const list = p[key];
  const idx = list.findIndex((c) => c.id === id);
  if (idx < 0) return p;
  const c = list[idx];
  if (c.gap || hasCurve(c)) return p;
  const span = spanOf(c);
  const len = track === 'video' ? clipLen(c) : freeLen(track, c);
  if (span <= 0 || len <= 0) return p;
  const wantLen = Math.max(MIN_CLIP, len + delta);
  let speed = span / wantLen;
  speed = Math.max(0.25, Math.min(4, speed));
  if (Math.abs(speed - speedOf(c)) < 1e-9) return p;
  const next = [...list];
  next[idx] = { ...c, speed, ratePitch: preservePitch ? 'preserve' : 'shift' };
  return { ...p, [key]: next };
}
