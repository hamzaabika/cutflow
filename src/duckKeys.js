// Music ducking vs dialogue (AU-02): the renderer's mirror of the export's
// ducking (electron/audiofx.cjs cleanVoiceDuckSpans / duckVolumeExpr).
// The spans are computed FRESH from the project every time they are needed —
// a split, trim, mute or speed change re-derives them, because nothing is
// cached. The same spans drive three things: the preview (duckFactorAt per
// frame), the export (the volume expression), and baking (bakeDuckKeys,
// which writes the curve into a music clip's volume keyframes so the user
// can edit it in the volume keyframe editor).
import { clipDuration, hasCurve, sourceOffsetAt } from './speedCurve.js';
import { normalizeVolKeys, volumeAt } from './volKeys.js';

export const DUCK_DEFAULT_TO = 0.35; // music level under voice, as a fraction of full
export const DUCK_DEFAULT_RAMP = 0.15; // seconds of linear ramp at each span edge

// A voice clip's duck settings, clamped: duckTo 0.05..1 (music level under
// the voice), ramp 0.02..1 s.
export function duckSettingsOf(cv) {
  const duckTo = Number.isFinite(Number(cv?.duckTo)) ? Math.min(1, Math.max(0.05, Number(cv.duckTo))) : DUCK_DEFAULT_TO;
  const duckRamp = Number.isFinite(Number(cv?.duckRamp)) ? Math.min(1, Math.max(0.02, Number(cv.duckRamp))) : DUCK_DEFAULT_RAMP;
  return { duckTo, duckRamp };
}

// Timeline spans [{ start, end, id, duckTo, duckRamp }] where a voice clip
// with the duck step on is speaking. Same rules as the export's
// cleanVoiceDuckSpans: muted/gap clips don't speak, the source id travels
// so a voiceover never ducks itself, and the length is the TIMELINE length
// (source length / speed — a 0.5x clip speaks twice as long).
export function duckSpansFor(videoClips, audioClips, videoStart) {
  const spans = [];
  const push = (c, start) => {
    if (!c || !c.cleanVoice || !c.cleanVoice.on || !c.cleanVoice.steps || !c.cleanVoice.steps.duck) return;
    if (c.gap || c.muted) return;
    if (!Number.isFinite(start)) return;
    const len = Math.max(0, ((c.out ?? 0) - (c.in || 0)) / (c.speed || 1));
    if (len <= 0) return;
    spans.push({ start, end: start + len, id: c.id, ...duckSettingsOf(c.cleanVoice) });
  };
  for (const c of videoClips || []) push(c, videoStart(c.id));
  for (const c of audioClips || []) push(c, c.start || 0);
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

// The music gain multiplier at timeline time t: 1 outside every span,
// duckTo inside, linear ramps at the edges. Mirrors duckVolumeExpr's math
// exactly (1 - depth * max(per-span window)), so preview and export draw
// the same curve. selfId: a voiceover never ducks itself.
export function duckFactorAt(spans, t, selfId = null) {
  let inside = 0;
  for (const s of spans || []) {
    if (selfId && s.id === selfId) continue;
    const duckTo = Number.isFinite(s.duckTo) ? s.duckTo : DUCK_DEFAULT_TO;
    const ramp = Number.isFinite(s.duckRamp) && s.duckRamp > 0 ? s.duckRamp : DUCK_DEFAULT_RAMP;
    const up = Math.min(1, Math.max(0, (t - (s.start - ramp)) / ramp));
    const down = Math.min(1, Math.max(0, ((s.end + ramp) - t) / ramp));
    inside = Math.max(inside, up * down * (1 - duckTo));
  }
  return 1 - inside;
}

// Bake the duck curve into a music clip's volume keyframes: the duck spans
// become editable volKeys (source-time points), so the user can see and
// reshape the ducking in the volume keyframe editor instead of taking the
// live expression on faith. The baked points MULTIPLY the clip's existing
// gain curve — a clip at 0.8 stays at 0.8 outside the spans and dips to
// 0.8 * duckTo inside. Only 1x constant-speed clips (the live expression's
// own limit); returns null when there is nothing to bake. The returned
// `times` are the baked source times (ms) so the bake can be removed again.
export function bakeDuckKeys(musicClip, spans) {
  const c = musicClip;
  if (!c || c.muted || hasCurve(c) || (c.speed || 1) !== 1) return null;
  const len = clipDuration(c);
  if (!(len > 0)) return null;
  const start = c.start || 0;
  const points = [];
  for (const s of spans || []) {
    const a0 = Math.max(s.start - s.duckRamp, start);
    const a1 = Math.max(s.start, start);
    const b1 = Math.min(s.end, start + len);
    const b2 = Math.min(s.end + s.duckRamp, start + len);
    if (b1 <= a1) continue; // no overlap with this clip
    for (const [lt, factor] of [[a0 - start, 1], [a1 - start, s.duckTo], [b1 - start, s.duckTo], [b2 - start, 1]]) {
      const st = (c.in || 0) + sourceOffsetAt(c, Math.max(0, lt));
      points.push({ t: Math.round(st * 1000) / 1000, v: volumeAt(c, Math.max(0, lt)) * factor });
    }
  }
  if (!points.length) return null;
  const volKeys = normalizeVolKeys({ ...c, volKeys: [...(c.volKeys || []), ...points] });
  return { volKeys, times: points.map((p) => p.t) };
}
