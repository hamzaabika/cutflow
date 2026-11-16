// Standalone music ducking (FB-07, P1-12) — renderer mirror of the engine
// helpers in electron/audiofx.cjs. The UI computes the same dialogue spans
// and duck keyframes the export will render, so the panel shows the dips
// that will actually land. A suite (scripts/test-fb07-ducking.mjs) keeps the
// two in sync. Stored on a music (audio-track) clip as clip.duck =
// { on, to, fade, sensitivity } and optional manual clip.duckKeys =
// [{ t, v }] in SOURCE time (the volKeys convention — a split copies them
// and both halves stay correct).
const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const num = (v) => String(Math.round(v * 1000) / 1000);

export const DUCK_DEFAULTS = { on: false, to: 0.35, fade: 0.15, sensitivity: 0.75 };
export function normalizeDuck(duck) {
  if (!duck || typeof duck !== 'object') return { ...DUCK_DEFAULTS };
  return {
    on: !!duck.on,
    to: clamp(duck.to ?? 0.35, 0.05, 0.9),
    fade: clamp(duck.fade ?? 0.15, 0.05, 1),
    sensitivity: clamp(duck.sensitivity ?? 0.75, 0, 1),
  };
}

// Mirror of cleanVoiceDuckSpans (electron/audiofx.cjs): spans where a voice
// clip with the Clean Voice duck step on is speaking.
export function cleanVoiceDuckSpans(videoClips, audioClips, videoStart) {
  const spans = [];
  for (const c of videoClips || []) {
    if (!c || !c.cleanVoice || !c.cleanVoice.on || !c.cleanVoice.steps || !c.cleanVoice.steps.duck) continue;
    if (c.gap || c.muted) continue;
    const start = videoStart(c.id);
    if (!Number.isFinite(start)) continue;
    const len = Math.max(0, (c.out ?? 0) - (c.in || 0));
    if (len > 0) spans.push({ start, end: start + len, id: c.id });
  }
  for (const c of audioClips || []) {
    if (!c || !c.cleanVoice || !c.cleanVoice.on || !c.cleanVoice.steps || !c.cleanVoice.steps.duck) continue;
    if (c.muted) continue;
    const len = Math.max(0, (c.out ?? 0) - (c.in || 0));
    if (len > 0) spans.push({ start: c.start || 0, end: (c.start || 0) + len, id: c.id });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

export function dialogueSpans(videoClips, audioClips, videoStart) {
  const spans = cleanVoiceDuckSpans(videoClips, audioClips, videoStart);
  const seen = new Set(spans.map((s) => s.id));
  for (const c of audioClips || []) {
    if (!c || c.role !== 'dialogue' || c.muted || seen.has(c.id)) continue;
    const len = Math.max(0, (c.out ?? 0) - (c.in || 0));
    if (len > 0) spans.push({ start: c.start || 0, end: (c.start || 0) + len, id: c.id });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

export function filterDuckSpans(spans, sensitivity) {
  const minSpan = (1 - clamp(sensitivity ?? 0.75, 0, 1)) * 1.0;
  return (spans || []).filter((s) => (s.end - s.start) >= minSpan);
}

export function duckKeysFromSpans(spans, clip, duck) {
  const d = normalizeDuck(duck);
  const len = Math.max(0, (clip.out ?? 0) - (clip.in || 0));
  const start = clip.start || 0;
  const byT = new Map();
  const put = (lt, v) => {
    const t = Math.round(Math.min(len, Math.max(0, lt)) * 1000) / 1000;
    byT.set(t, Math.min(byT.has(t) ? byT.get(t) : 1, v));
  };
  for (const s of filterDuckSpans(spans, d.sensitivity)) {
    const a = s.start - start;
    const b = s.end - start;
    if (b <= 0 || a >= len) continue;
    put(Math.max(0, a - d.fade), 1);
    put(Math.max(0, a), d.to);
    put(Math.min(len, b), d.to);
    put(Math.min(len, b + d.fade), 1);
  }
  const srcIn = clip.in || 0;
  return [...byT.entries()].sort((x, y) => x[0] - y[0])
    .map(([lt, v]) => ({ t: Math.round((srcIn + lt) * 1000) / 1000, v }));
}

function duckGainAt(pts, t) {
  if (!pts.length) return 1;
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (t >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, g0] = pts[i];
    const [t1, g1] = pts[i + 1];
    if (t >= t0 && t <= t1) return g0 + (g1 - g0) * ((t - t0) / Math.max(1e-9, t1 - t0));
  }
  return last[1];
}

export function duckKeysExpr(localPts, len) {
  const L = Math.max(0, len);
  const raw = (localPts || [])
    .map((p) => [Number(p && p[0]), Number(p && p[1])])
    .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v))
    .sort((a, b) => a[0] - b[0]);
  if (!raw.length) return 'volume=1';
  const byT = new Map();
  for (const [t, v] of raw) {
    const rt = Math.round(Math.min(L, Math.max(0, t)) * 1000) / 1000;
    byT.set(rt, Math.min(byT.has(rt) ? byT.get(rt) : 1, clamp(v, 0, 1)));
  }
  const pts = [[0, duckGainAt(raw, 0)], ...[...byT.entries()], [L, duckGainAt(raw, L)]]
    .sort((a, b) => a[0] - b[0]);
  const dedup = [];
  for (const [t, v] of pts) {
    if (dedup.length && dedup[dedup.length - 1][0] === t) dedup[dedup.length - 1][1] = Math.min(dedup[dedup.length - 1][1], v);
    else dedup.push([t, v]);
  }
  if (dedup.every((p) => Math.abs(p[1] - 1) < 1e-9)) return 'volume=1';
  let expr = num(dedup[dedup.length - 1][1]);
  for (let i = dedup.length - 2; i >= 0; i--) {
    const [t0, g0] = dedup[i];
    const [t1, g1] = dedup[i + 1];
    const seg = `${num(g0)}+(${num(g1)}-${num(g0)})*(t-${num(t0)})/${num(Math.max(1e-4, t1 - t0))}`;
    expr = `if(lt(t,${num(t1)}),${seg},${expr})`;
  }
  return `volume='${expr}':eval=frame`;
}

// The keyframe points the panel shows for a music clip: manual keys when
// the user pinned them (with their source time and clip-local time), else
// the points derived from the live dialogue spans. Each entry is
// { t (source s), lt (clip-local s), v (gain), manual }.
export function duckDisplayPoints(clip, spans) {
  const len = Math.max(0, (clip.out ?? 0) - (clip.in || 0));
  const manual = Array.isArray(clip.duckKeys) ? clip.duckKeys : [];
  const src = manual.length
    ? manual.filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
    : duckKeysFromSpans(spans, clip, clip.duck);
  return src
    .map((p) => ({ t: p.t, lt: Math.round((p.t - (clip.in || 0)) * 1000) / 1000, v: p.v, manual: manual.length > 0 }))
    .filter((p) => p.lt >= 0 && p.lt <= len)
    .sort((a, b) => a.lt - b.lt);
}
