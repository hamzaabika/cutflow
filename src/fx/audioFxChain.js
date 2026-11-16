// The AudioFx filter chain, mirrored for the renderer. This function is a deliberate
// copy of audioFxFilters in electron/audiofx.cjs (the export engine's canonical copy) —
// the renderer needs the identical chain string to validate a clip's preview derivative
// (clip.audioFxRender.chain) against its current settings. A suite
// (scripts/test-audiofx-preview.mjs) keeps the two byte-identical across a corpus of
// settings, the same arrangement as the audio presets mirror (fx/audioPresets.js).
// Stored on the clip as clip.audioFx = { eq: {low, mid, high} (dB), highpass (Hz),
// lowpass (Hz), comp, limit, denoise, loudnorm, echo: {delay, decay}, pitch (semitones) }.
// Returns ffmpeg audio filter strings for a chain that is already at 48 kHz.

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const num = (v) => String(Math.round(v * 1000) / 1000);

export function audioFxFilters(fx) {
  if (!fx || typeof fx !== 'object') return [];
  const out = [];
  // Cut the rumble / hiss ends first, then shape with the EQ.
  const hp = clamp(fx.highpass ?? 0, 0, 1000);
  if (hp >= 20) out.push(`highpass=f=${Math.round(hp)}`);
  const lp = clamp(fx.lowpass ?? 0, 0, 20000);
  if (lp >= 100 && lp < 20000) out.push(`lowpass=f=${Math.round(lp)}`);
  // FB-08: mains-hum notch (true band-reject, see electron/audiofx.cjs).
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
export function compParams(comp) {
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
export function limitParams(limit) {
  if (!limit) return null;
  if (limit === true) return { limit: 0.95 };
  // Already-normalised objects carry { limit } linear (0, 1]; fresh objects
  // from the inspector carry { ceiling } in dB.
  if (typeof limit.limit === 'number' && limit.limit > 0 && limit.limit <= 1) return { limit: clamp(limit.limit, 0, 1) };
  return { limit: Math.pow(10, clamp(limit.ceiling ?? -0.5, -12, 0) / 20) };
}

export const hasAudioFx = (fx) => audioFxFilters(fx).length > 0;

// FB-08 — mains-hum notch + voice repair, byte-identical mirrors of
// electron/audiofx.cjs (this ffmpeg build has no `anotch`; bandreject is
// the notch). Repair is an additive first layer: it never replaces volume,
// fades, Voice Enhance or the clip's own audioFx.
export function humNotchFilters(mode) {
  const freqs = mode === '50' ? [50, 100, 150]
    : mode === '60' ? [60, 120, 180]
    : mode === 'auto' ? [50, 100, 150, 60, 120, 180]
    : [];
  return freqs.map((f) => `bandreject=f=${f}:width_type=q:width=8`);
}

export const REPAIR_DEFAULTS = { on: false, declick: false, denoise: 0, hum: 'off' };
export function normalizeRepair(repair) {
  if (!repair || typeof repair !== 'object') return { ...REPAIR_DEFAULTS };
  return {
    on: !!repair.on,
    declick: !!repair.declick,
    denoise: clamp(repair.denoise ?? 0, 0, 1),
    hum: ['50', '60', 'auto'].includes(repair.hum) ? repair.hum : 'off',
  };
}
export function repairFilters(repair) {
  const r = normalizeRepair(repair);
  if (!r.on) return [];
  const out = [];
  if (r.declick) out.push('adeclick');
  if (r.hum !== 'off') out.push(...humNotchFilters(r.hum));
  if (r.denoise > 0) out.push(`afftdn=nr=${Math.round(6 + r.denoise * 18)}`);
  return out;
}
export const hasRepair = (repair) => repairFilters(repair).length > 0;

// One-click Clean Voice (P2-25) — byte-identical mirror of cleanVoiceFilters
// in electron/audiofx.cjs. clip.cleanVoice = { on, steps: { enhance, deesser,
// hum, comp, duck } }. The filters run BEFORE audioFx in the chain; `duck`
// is not a filter (it lowers the music track — see electron/audiofx.cjs).
export function cleanVoiceFilters(cv) {
  if (!cv || !cv.on || typeof cv !== 'object') return [];
  const s = cv.steps || {};
  const out = [];
  if (s.enhance) out.push('highpass=f=80', 'equalizer=f=3000:width_type=o:width=1.5:g=2');
  if (s.deesser) out.push('deesser=i=0.5');
  if (s.hum) out.push('equalizer=f=50:width_type=q:width=8:g=-18', 'equalizer=f=100:width_type=q:width=8:g=-12');
  if (s.comp) out.push('acompressor=threshold=0.087:ratio=3:attack=10:release=150:makeup=3');
  return out;
}

export const hasCleanVoice = (cv) => cleanVoiceFilters(cv).length > 0;

// The full effected chain for a clip, in export order — the string every
// derivative-validity check compares. Repair runs first.
export const cleanVoiceChain = (cv, fx, repair) => [...repairFilters(repair), ...cleanVoiceFilters(cv), ...audioFxFilters(fx)].join(',');
