// Clip audio effects for the EXPORT pipeline. The HTMLVideo preview cannot run ffmpeg
// filters, so these are applied only when rendering (the UI says so). Stored on the clip as
// clip.audioFx = { eq: {low, mid, high} (dB), highpass (Hz), lowpass (Hz), comp, limit,
// denoise, loudnorm, echo: {delay, decay}, pitch (semitones) }.
// Returns ffmpeg audio filter strings to splice into a chain that is already at 48 kHz.

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const num = (v) => String(Math.round(v * 1000) / 1000);

function audioFxFilters(fx) {
  if (!fx || typeof fx !== 'object') return [];
  const out = [];
  // Cut the rumble / hiss ends first, then shape with the EQ.
  const hp = clamp(fx.highpass ?? 0, 0, 1000);
  if (hp >= 20) out.push(`highpass=f=${Math.round(hp)}`);
  const lp = clamp(fx.lowpass ?? 0, 0, 20000);
  // FB-05: the shared cutoff domain — enabled 100–19,999 Hz, 0 (or >= 20,000)
  // is OFF. The old `lp >= 1000` gate silently dropped the Underwater preset's
  // 900 Hz cutoff (and every stored value below 1 kHz).
  if (lp >= 100 && lp < 20000) out.push(`lowpass=f=${Math.round(lp)}`);
  // FB-08: mains-hum notch — a real two-pole Butterworth band-reject at the
  // mains frequency and its harmonics (true notch, not an EQ dip). 'auto'
  // notches both the 50 Hz and the 60 Hz families, so the same preset works
  // on either mains standard. `true` is the lenient form of 'auto'.
  if (fx.humNotch) out.push(...humNotchFilters(fx.humNotch === true ? 'auto' : fx.humNotch));
  if (fx.eq) {
    const { low = 0, mid = 0, high = 0 } = fx.eq;
    if (low) out.push(`equalizer=f=100:width_type=o:width=2:g=${num(clamp(low, -15, 15))}`);
    if (mid) out.push(`equalizer=f=1000:width_type=o:width=2:g=${num(clamp(mid, -15, 15))}`);
    if (high) out.push(`equalizer=f=8000:width_type=o:width=2:g=${num(clamp(high, -15, 15))}`);
  }
  // P2-21 — parametric EQ: up to 4 extra bands { f (Hz), g (dB), q }.
  // A zero-gain band is a no-op and emits nothing.
  if (Array.isArray(fx.eqBands)) {
    for (const b of fx.eqBands.slice(0, 4)) {
      if (!b || typeof b !== 'object') continue;
      const g = clamp(b.g ?? 0, -15, 15);
      if (!g) continue;
      const f = clamp(b.f ?? 1000, 20, 18000);
      const q = clamp(b.q ?? 1, 0.5, 10);
      out.push(`equalizer=f=${Math.round(f)}:width_type=q:width=${num(q)}:g=${num(g)}`);
    }
  }
  // P2-21 — compressor: boolean true keeps the legacy fixed chain
  // (byte-identical to before); an object carries real parameters.
  const comp = compParams(fx.comp);
  if (comp) out.push(`acompressor=threshold=${num(comp.threshold)}:ratio=${num(comp.ratio)}:attack=${num(comp.attack)}:release=${num(comp.release)}:makeup=${num(comp.makeup)}`);
  // P2-21 — limiter: boolean true keeps the legacy fixed chain; an object
  // carries a ceiling in dB.
  const lim = limitParams(fx.limit);
  if (lim) out.push(`alimiter=limit=${num(lim.limit)}:level=false`);
  if (fx.denoise) out.push('afftdn=nr=12');
  if (fx.echo) {
    const delay = Math.round(clamp(fx.echo.delay ?? 180, 20, 900));
    const decay = num(clamp(fx.echo.decay ?? 0.3, 0.05, 0.8));
    out.push(`aecho=0.8:0.7:${delay}:${decay}`);
  }
  const semi = clamp(fx.pitch ?? 0, -12, 12);
  if (semi) {
    const ratio = Math.pow(2, semi / 12);
    // Shift the sample rate, resample back to 48 kHz, then restore the original tempo:
    // the pitch moves, the duration does not.
    out.push(`asetrate=${Math.round(48000 * ratio)}`, 'aresample=48000', `atempo=${num(1 / ratio)}`);
  }
  // P2-21 — pan / stereo width, as one pan matrix AFTER the dynamics (so a
  // hard pan does not unbalance the compressor) and before loudness.
  // Width w mixes mid/side: L' = (1+w)/2·L + (1-w)/2·R, R' mirrored; the
  // balance gains keep unity at centre (pan 0 = untouched).
  const pan = clamp(fx.pan ?? 0, -1, 1);
  const width = clamp(fx.width ?? 1, 0, 2);
  if (pan || width !== 1) {
    const gL = pan <= 0 ? 1 : 1 - pan;
    const gR = pan >= 0 ? 1 : 1 + pan;
    const a = (1 + width) / 2;
    const b = (1 - width) / 2;
    out.push(`pan=stereo|c0=${num(a * gL)}*c0+${num(b * gL)}*c1|c1=${num(b * gR)}*c0+${num(a * gR)}*c1`);
  }
  // Loudness last: single-pass loudnorm to the podcast/social target. It works at
  // 192 kHz internally, so resample back to the chain's 48 kHz right after it.
  if (fx.loudnorm) out.push('loudnorm=I=-14:TP=-1:LRA=11', 'aresample=48000');
  return out;
}

// P2-21 — advanced dynamics parameters, shared by the chain above and the
// inspector. Boolean true is the legacy fixed preset (kept byte-identical);
// an object is clamped to the safe bounds the UI offers. An object that
// already passed through here carries LINEAR values (threshold in (0, 1]);
// a fresh object from the inspector carries dB (threshold in [-60, 0]).
// Threshold alone disambiguates — dB can never exceed 0, linear can never
// exceed 1 — so normalising twice is a no-op instead of a second conversion
// (a normalised preset re-applied used to come back as threshold 1 / makeup
// 1.259). Out-of-range values (> 1) take the dB path and clamp, as before.
function compParams(comp) {
  if (!comp) return null;
  if (comp === true) return { threshold: 0.125, ratio: 4, attack: 20, release: 200, makeup: 2 };
  if (typeof comp.threshold === 'number' && comp.threshold > 0 && comp.threshold <= 1) {
    return {
      threshold: clamp(comp.threshold, 0, 1),
      ratio: clamp(comp.ratio ?? 4, 1, 20),
      attack: clamp(comp.attack ?? 20, 0.1, 100),
      release: clamp(comp.release ?? 200, 10, 1000),
      makeup: clamp(comp.makeup ?? 2, 1, 64),
    };
  }
  return {
    threshold: Math.pow(10, clamp(comp.threshold ?? -18, -60, 0) / 20),
    ratio: clamp(comp.ratio ?? 4, 1, 20),
    attack: clamp(comp.attack ?? 20, 0.1, 100),
    release: clamp(comp.release ?? 200, 10, 1000),
    // ffmpeg's makeup is a LINEAR gain (1–64), not dB: the object stores dB
    // (0–24) and converts here. The legacy true keeps makeup 2 (linear).
    makeup: Math.pow(10, clamp(comp.makeup ?? 2, 0, 24) / 20),
  };
}
function limitParams(limit) {
  if (!limit) return null;
  if (limit === true) return { limit: 0.95 };
  // Already-normalised objects carry { limit } linear (0, 1]; fresh objects
  // from the inspector carry { ceiling } in dB.
  if (typeof limit.limit === 'number' && limit.limit > 0 && limit.limit <= 1) return { limit: clamp(limit.limit, 0, 1) };
  return { limit: Math.pow(10, clamp(limit.ceiling ?? -0.5, -12, 0) / 20) };
}

const hasAudioFx = (fx) => audioFxFilters(fx).length > 0;

// ---- Mains-hum notch (FB-08) ----
// A two-pole Butterworth band-reject (Q 8, ~6 Hz wide at 50 Hz) at the mains
// frequency and its first two harmonics — a genuine notch. This ffmpeg build
// has no `anotch` filter, so bandreject is the notch here; the old dehum
// approach (a narrow EQ dip) is not used for hum anywhere new.
function humNotchFilters(mode) {
  const freqs = mode === '50' ? [50, 100, 150]
    : mode === '60' ? [60, 120, 180]
    : mode === 'auto' ? [50, 100, 150, 60, 120, 180]
    : [];
  return freqs.map((f) => `bandreject=f=${f}:width_type=q:width=8`);
}

// ---- Voice repair (FB-08, P1-17) ----
// Stored on the clip as clip.repair = { on, declick, denoise (0–1),
// hum ('off' | '50' | '60' | 'auto') }. An ADDITIVE layer like Clean Voice:
// it never replaces volume, fades, Voice Enhance or the clip's own audioFx,
// and it runs FIRST in the chain (repair the source, then clean up, then
// shape). The derivative chain key includes it, so toggling a repair
// control invalidates a stored render exactly like any other chain change.
const REPAIR_DEFAULTS = { on: false, declick: false, denoise: 0, hum: 'off' };
function normalizeRepair(repair) {
  if (!repair || typeof repair !== 'object') return { ...REPAIR_DEFAULTS };
  return {
    on: !!repair.on,
    declick: !!repair.declick,
    denoise: clamp(repair.denoise ?? 0, 0, 1),
    hum: ['50', '60', 'auto'].includes(repair.hum) ? repair.hum : 'off',
  };
}
function repairFilters(repair) {
  const r = normalizeRepair(repair);
  if (!r.on) return [];
  const out = [];
  if (r.declick) out.push('adeclick');
  if (r.hum !== 'off') out.push(...humNotchFilters(r.hum));
  if (r.denoise > 0) out.push(`afftdn=nr=${Math.round(6 + r.denoise * 18)}`);
  return out;
}
const hasRepair = (repair) => repairFilters(repair).length > 0;

// ---- One-click Clean Voice (P2-25) ----
// Stored on the clip as clip.cleanVoice = { on, steps: { enhance, deesser,
// hum, comp, duck } (booleans) }. It is an ADDITIVE layer over everything
// else on the clip — volume, fades, Voice Enhance and clip.audioFx all stay
// exactly as they are, and the Clean Voice filters run BEFORE audioFx in the
// chain (cleanup first, the user's own EQ/comp after). `duck` is not a filter
// on the voice: it lowers the music track under the voice spans (see
// duckVolumeExpr / cleanVoiceDuckSpans, applied to audioClips in ffmpeg.cjs).
// The derivative chain key is the Clean Voice filters + the audioFx filters
// (cleanVoiceChain), so toggling a step invalidates a stored derivative.
const CLEAN_VOICE_STEPS = ['enhance', 'deesser', 'hum', 'comp', 'duck'];

function cleanVoiceFilters(cv) {
  if (!cv || !cv.on || typeof cv !== 'object') return [];
  const s = cv.steps || {};
  const out = [];
  if (s.enhance) out.push('highpass=f=80', 'equalizer=f=3000:width_type=o:width=1.5:g=2');
  if (s.deesser) out.push('deesser=i=0.5');
  if (s.hum) out.push('equalizer=f=50:width_type=q:width=8:g=-18', 'equalizer=f=100:width_type=q:width=8:g=-12');
  if (s.comp) out.push('acompressor=threshold=0.087:ratio=3:attack=10:release=150:makeup=3');
  return out;
}

const hasCleanVoice = (cv) => cleanVoiceFilters(cv).length > 0;

// The full effected chain for a clip, in export order: Repair first, then
// Clean Voice, then the clip's own audioFx. Every place that validates a
// stored derivative against "the current chain" compares this string.
const cleanVoiceChain = (cv, fx, repair) => [...repairFilters(repair), ...cleanVoiceFilters(cv), ...audioFxFilters(fx)].join(',');

// Timeline spans [{ start, end, id }] where a voice clip with the duck step
// on is speaking — the music track is lowered under exactly these. videoStart
// (id): timeline start of a main-track clip; audio clips carry their own
// c.start. The source id travels with the span so a voiceover never ducks
// itself. Spans are sorted; overlapping ones are fine — duckVolumeExpr takes
// their max. AU-02: the length is the TIMELINE length (source length /
// speed) — a 0.5x clip speaks twice as long, so its span must too; the old
// source-length span ended the duck halfway through a slowed voice.
function cleanVoiceDuckSpans(videoClips, audioClips, videoStart) {
  const spans = [];
  for (const c of videoClips || []) {
    if (!c || !c.cleanVoice || !c.cleanVoice.on || !c.cleanVoice.steps || !c.cleanVoice.steps.duck) continue;
    if (c.gap || c.muted) continue;
    const start = videoStart(c.id);
    if (!Number.isFinite(start)) continue;
    const len = Math.max(0, ((c.out ?? 0) - (c.in || 0)) / (c.speed || 1));
    if (len > 0) spans.push({ start, end: start + len, id: c.id });
  }
  for (const c of audioClips || []) {
    if (!c || !c.cleanVoice || !c.cleanVoice.on || !c.cleanVoice.steps || !c.cleanVoice.steps.duck) continue;
    if (c.muted) continue;
    const len = Math.max(0, ((c.out ?? 0) - (c.in || 0)) / (c.speed || 1));
    if (len > 0) spans.push({ start: c.start || 0, end: (c.start || 0) + len, id: c.id });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

// A voice clip's duck settings, clamped: duckTo 0.05..1 (music level under
// the voice), ramp 0.02..1 s. The renderer's mirror is duckSettingsOf in
// src/duckKeys.js.
function duckSettingsOf(cv) {
  const duckTo = Number.isFinite(Number(cv?.duckTo)) ? Math.min(1, Math.max(0.05, Number(cv.duckTo))) : 0.35;
  const duckRamp = Number.isFinite(Number(cv?.duckRamp)) ? Math.min(1, Math.max(0.02, Number(cv.duckRamp))) : 0.15;
  return { duckTo, duckRamp };
}

// The music gain multiplier at timeline time t: 1 outside every span,
// duckTo inside, linear ramps at the edges — the same curve duckVolumeExpr
// renders, evaluated directly. The renderer's mirror lives in
// src/duckKeys.js (duckFactorAt); the two are kept in sync by
// scripts/test-duck-rederive.mjs. selfId: a voiceover never ducks itself.
function duckFactorAt(spans, t, selfId = null) {
  let inside = 0;
  for (const s of spans || []) {
    if (selfId && s.id === selfId) continue;
    const duckTo = Number.isFinite(s.duckTo) ? s.duckTo : 0.35;
    const ramp = Number.isFinite(s.duckRamp) && s.duckRamp > 0 ? s.duckRamp : 0.15;
    const up = Math.min(1, Math.max(0, (t - (s.start - ramp)) / ramp));
    const down = Math.min(1, Math.max(0, ((s.end + ramp) - t) / ramp));
    inside = Math.max(inside, up * down * (1 - duckTo));
  }
  return 1 - inside;
}

// A `volume` filter that drops the music to `duckTo` under each span, with a
// `ramp`-second linear fade at each edge (a hard step would click). Spans are
// [start, end] in the music clip's own time (timeline time minus its start),
// as [a, b] pairs or { start, end, duckTo, duckRamp } objects (a span's own
// settings win over the defaults — each voice clip carries its own depth
// and ramp). Returns null when there is nothing to duck.
function duckVolumeExpr(spans, duckTo = 0.35, ramp = 0.15) {
  if (!spans || !spans.length) return null;
  const num = (v) => String(Math.round(v * 1000) / 1000);
  const per = (s) => {
    const a = Array.isArray(s) ? s[0] : s.start;
    const b = Array.isArray(s) ? s[1] : s.end;
    const to = Number.isFinite(s.duckTo) ? s.duckTo : duckTo;
    const rp = Number.isFinite(s.duckRamp) && s.duckRamp > 0 ? s.duckRamp : ramp;
    const depth = Math.min(0.95, Math.max(0, 1 - to));
    // A span starting inside its own ramp would read `t--0.5` — legal
    // ffmpeg, but `t+0.5` is what a human expects to see.
    const a0 = a - rp;
    const up = a0 < 0 ? `(t+${num(-a0)})` : `(t-${num(a0)})`;
    return { expr: `clip(${up}/${num(rp)},0,1)*clip((${num(b + rp)}-t)/${num(rp)},0,1)`, depth };
  };
  const parts = spans.map(per);
  // One shared depth (the common case): the old single-expression form.
  // Mixed depths need a per-span depth, so each window carries its own.
  if (parts.every((p) => p.depth === parts[0].depth)) {
    const depth = parts[0].depth;
    const inside = parts.length === 1 ? parts[0].expr : `max(${parts.map((p) => p.expr).join(',')})`;
    return `volume='1-${num(depth)}*${inside}':eval=frame`;
  }
  const inside = parts.map((p) => `${num(p.depth)}*(${p.expr})`).join(',');
  return `volume='1-max(${inside})':eval=frame`;
}

const voiceByIdOf = (project) => new Map([...(project.videoClips || []), ...(project.audioClips || [])].map((c) => [c.id, c]));

// One-click "essentials" presets (essential-sound style). A preset is a COMPLETE
// audioFx object: every parameter it does not name is off/neutral, so applying one fully
// replaces the clip audioFx. FB-05: this table has ONE source of truth —
// shared/audioPresets.json, read by the export engine here and by the renderer
// (src/fx/audioPresets.js). Never hand-edit a copy in either place; edit the JSON.
const AUDIO_FX_PRESETS = require('../shared/audioPresets.json');
// ---- Standalone music ducking (FB-07, P1-12) ----
// Stored on a MUSIC (audio-track) clip as clip.duck = { on, to, fade,
// sensitivity }. Unlike the Clean Voice duck (per-voice depth/ramp from
// the voice clip's cleanVoice.duckTo/duckRamp, AU-02), this is the music
// clip's own feature: configurable amount / fade / sensitivity, and
// editable keyframes.
//   to: music level under dialogue, 0.05–0.9 (default 0.35)
//   fade: ramp seconds at each span edge, 0.05–1 (default 0.15)
//   sensitivity: 0–1 (default 0.75); the shortest speech span that still
//     ducks is (1 - sensitivity) seconds — short noises below it are ignored.
// Dialogue spans are the Clean Voice duck spans plus every unmuted
// role:'dialogue' audio clip (detached / extracted voice); a clip never
// ducks itself. Keyframes are stored in SOURCE time (clip.duckKeys =
// [{ t, v }]) — the volKeys convention, so a split copies them and both
// halves stay correct. Without manual keys the expression is re-derived
// from the live timeline on every export, so a cut to the voice or the
// music updates it; editing a key pins the clip to its manual keys until
// Regenerate.
const DUCK_DEFAULTS = { on: false, to: 0.35, fade: 0.15, sensitivity: 0.75 };
function normalizeDuck(duck) {
  if (!duck || typeof duck !== 'object') return { ...DUCK_DEFAULTS };
  return {
    on: !!duck.on,
    to: clamp(duck.to ?? 0.35, 0.05, 0.9),
    fade: clamp(duck.fade ?? 0.15, 0.05, 1),
    sensitivity: clamp(duck.sensitivity ?? 0.75, 0, 1),
  };
}
function dialogueSpans(videoClips, audioClips, videoStart) {
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
function filterDuckSpans(spans, sensitivity) {
  const minSpan = (1 - clamp(sensitivity ?? 0.75, 0, 1)) * 1.0;
  return (spans || []).filter((s) => (s.end - s.start) >= minSpan);
}
// Duck keyframe points (source time) derived from dialogue spans for one
// music clip: a 1 -> to ramp at each span edge, clipped to the clip's range;
// overlapping spans merge into one dip (lowest gain wins at a shared time).
function duckKeysFromSpans(spans, clip, duck) {
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
// A `volume` filter from clip-local duck points [[t, v], ...]: gain 1 outside
// the dips, linear ramps between points — the same if-chain shape as
// volExprFor in electron/volkeys.cjs. Points outside [0, len] are CLAMPED,
// not dropped: a dip that runs past the clip end holds its gain to the end
// (a split mid-dip keeps both halves dipped), and a dip that started before
// the clip starts at its interpolated gain — the boundary gains are sampled
// from the piecewise-linear curve, exactly like volCurvePoints does.
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
function duckKeysExpr(localPts, len) {
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
// The standalone duck filters for one music clip, or [] when ducking is off
// or there is nothing to duck under. Manual duckKeys win over the derived
// expression. Only at 1x with no speed curve — the volume expression's `t`
// is clip-local time, which maps to timeline time only then (the same
// restriction as the Clean Voice duck).
function standaloneDuckFilters(clip, spans, len) {
  const d = normalizeDuck(clip && clip.duck);
  if (!d.on || !clip) return [];
  if ((clip.speed || 1) !== 1) return [];
  const manual = Array.isArray(clip.duckKeys) ? clip.duckKeys : [];
  if (manual.length) {
    const pts = manual
      .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
      .map((p) => [p.t - (clip.in || 0), p.v]);
    const expr = duckKeysExpr(pts, len);
    return expr === 'volume=1' ? [] : ['asetnsamples=n=1024:p=1', expr];
  }
  const local = (spans || []).filter((s) => s.id !== clip.id)
    .map((s) => ({ start: s.start - (clip.start || 0), end: s.end - (clip.start || 0) }))
    .filter((s) => s.end > 0 && s.start < len);
  const kept = filterDuckSpans(local, d.sensitivity).map((s) => [s.start, s.end]);
  const expr = duckVolumeExpr(kept, d.to, d.fade);
  return expr ? ['asetnsamples=n=1024:p=1', expr] : [];
}

module.exports = { audioFxFilters, hasAudioFx, AUDIO_FX_PRESETS, compParams, limitParams, CLEAN_VOICE_STEPS, cleanVoiceFilters, hasCleanVoice, cleanVoiceChain, cleanVoiceDuckSpans, duckVolumeExpr, duckFactorAt, duckSettingsOf, voiceByIdOf, normalizeDuck, dialogueSpans, filterDuckSpans, duckKeysFromSpans, duckKeysExpr, standaloneDuckFilters, humNotchFilters, normalizeRepair, repairFilters, hasRepair };
