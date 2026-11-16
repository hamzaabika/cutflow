// One-click audio "essentials" presets for the inspector.
// FB-05: the table has ONE source of truth — shared/audioPresets.json, read
// here by the renderer and by the export engine (electron/audiofx.cjs).
// Never hand-edit a copy in either place; edit the JSON. A preset is a
// COMPLETE audioFx object: applying it replaces the clip's audioFx wholesale.
import { compParams, limitParams } from './audioFxChain.js';
import PRESET_TABLE from '../../shared/audioPresets.json' with { type: 'json' };

export const AUDIO_PRESETS = PRESET_TABLE;

// The shared low-pass cutoff domain (FB-05): OFF is 0; an enabled cutoff is
// 100–19,999 Hz. The export gate, the slider and preset validation all use
// these — the old slider minimum (4000) could not even reach the stored
// Phone Voice (3400) / Cave (3800) / Underwater (900) values, and the old
// export gate (>= 1000 Hz) silently dropped Underwater's 900 Hz.
export const LOWPASS_OFF = 0;
export const LOWPASS_MIN = 100;
export const LOWPASS_MAX = 20000; // slider top; stored 20000 means OFF
export const LOWPASS_MAX_ENABLED = 19999;
// Canonicalise any stored value into the domain: 0 stays OFF, >= 20000 is
// OFF (it renders as no filter), anything below 100 Hz clamps up to 100.
export function clampLowpass(v) {
  const n = Number(v) || 0;
  if (n <= 0 || n >= LOWPASS_MAX) return LOWPASS_OFF;
  return Math.round(Math.min(LOWPASS_MAX_ENABLED, Math.max(LOWPASS_MIN, n)));
}

// ---- FB-06: preset merge / replace + A/B ------------------------------------
// A preset is a COMPLETE audioFx, but applying one need not wipe the clip's
// own settings. Modules group the fields so a preset can be applied as a
// layer: only the selected modules are taken from the preset, the rest stay
// exactly as the user set them. By default the EQ module is NOT merged — a
// manual EQ survives a preset apply in merge mode.
export const PRESET_MODULES = ['eq', 'filters', 'dynamics', 'cleanup', 'space', 'pitch', 'stereo'];
export const MODULE_FIELDS = {
  eq: ['eq', 'eqBands'],
  filters: ['highpass', 'lowpass'],
  dynamics: ['comp', 'limit'],
  cleanup: ['denoise', 'loudnorm'],
  space: ['echo'],
  pitch: ['pitch'],
  stereo: ['pan', 'width'],
};
export const DEFAULT_MERGE_MODULES = PRESET_MODULES.filter((m) => m !== 'eq');

// Take only `moduleIds` from the preset (normalised, so a preset comp:true
// lands as the object the chain renders); every other field stays as stored.
export function mergeAudioFx(base, presetFx, moduleIds) {
  const normPreset = normalizeAudioFx(presetFx);
  const next = structuredClone(base || {});
  for (const m of moduleIds || []) {
    for (const field of MODULE_FIELDS[m] || []) {
      if (field in normPreset) next[field] = structuredClone(normPreset[field]);
    }
  }
  return next;
}

// The modules whose normalised values differ — drives the "Changed: …" line
// after a preset apply.
export function diffAudioFxModules(a, b) {
  const na = normalizeAudioFx(a);
  const nb = normalizeAudioFx(b);
  return PRESET_MODULES.filter((m) => MODULE_FIELDS[m].some((f) => JSON.stringify(na[f]) !== JSON.stringify(nb[f])));
}

// The preset packs, in shelf order (10/10 step 3). Every preset names its pack in `cat`.
export const PRESET_CATS = ['Voice', 'Space', 'Restore', 'Dynamics'];

// Fill every field so a stored partial audioFx can be compared to a preset.
// P2-21: the advanced fields take part — a tweaked EQ band, pan or compressor
// value must unmatch the preset, while the legacy boolean forms canonicalize
// to the same numbers the chain renders (compParams / limitParams).
const r3 = (v) => Math.round(v * 1000) / 1000;
const clampN = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));

const DEFAULTS = {
  eq: { low: 0, mid: 0, high: 0 }, highpass: 0, lowpass: 0,
  comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0,
  eqBands: [], pan: 0, width: 1,
};

export function normalizeAudioFx(fx) {
  const f = fx || {};
  const comp = compParams(f.comp);
  const lim = limitParams(f.limit);
  return {
    eq: { ...DEFAULTS.eq, ...(f.eq || {}) },
    highpass: f.highpass || 0,
    lowpass: clampLowpass(f.lowpass), // FB-05: normalise into the shared domain
    humNotch: f.humNotch === true ? 'auto' : ['50', '60', 'auto'].includes(f.humNotch) ? f.humNotch : false, // FB-08
    comp: comp ? { threshold: r3(comp.threshold), ratio: comp.ratio, attack: comp.attack, release: comp.release, makeup: comp.makeup } : false,
    limit: lim ? { limit: r3(lim.limit) } : false,
    denoise: !!f.denoise,
    loudnorm: !!f.loudnorm,
    echo: f.echo ? { delay: f.echo.delay ?? 180, decay: f.echo.decay ?? 0.3 } : null,
    pitch: f.pitch || 0,
    eqBands: (Array.isArray(f.eqBands) ? f.eqBands : []).slice(0, 4)
      .filter((b) => b && typeof b === 'object' && (b.g ?? 0))
      .map((b) => ({ f: Math.round(clampN(b.f ?? 1000, 20, 18000)), g: clampN(b.g ?? 0, -15, 15), q: r3(clampN(b.q ?? 1, 0.5, 10)) })),
    pan: r3(clampN(f.pan ?? 0, -1, 1)),
    width: r3(clampN(f.width ?? 1, 0, 2)),
  };
}

export const audioFxEquals = (a, b) => JSON.stringify(normalizeAudioFx(a)) === JSON.stringify(normalizeAudioFx(b));

// AU-04 (gap-b) — apply a preset AS A LAYER over the clip's current chain
// instead of replacing it. A preset field counts as "set" when its normalized
// value differs from normalizeAudioFx({})'s — so layering "Warm" over a clip
// that already has denoise on keeps the denoise. eqBands merge by frequency
// slot (a preset band replaces the band in the same slot, other slots survive).
// Distinct from mergeAudioFx(base, presetFx, moduleIds) above, which takes
// whole modules wholesale (the UI's merge mode); this one takes only what the
// preset actually sets. Pure: neither input is mutated. (Canonical 2-arg
// layer function — replaces gap-a's per-field mergeAudioFxLayer, same
// semantics, unified isSet rule.)
export function mergeAudioFxLayer(current, presetFx) {
  const cur = normalizeAudioFx(current);
  const pre = normalizeAudioFx(presetFx);
  const base = normalizeAudioFx({});
  const out = { ...cur };
  const isSet = (v, d) => JSON.stringify(v) !== JSON.stringify(d);
  for (const k of ['eq', 'highpass', 'lowpass', 'comp', 'limit', 'denoise', 'loudnorm', 'echo', 'pitch', 'pan', 'width']) {
    if (isSet(pre[k], base[k])) out[k] = structuredClone(pre[k]);
  }
  if (pre.eqBands.length) {
    const bands = [...cur.eqBands];
    pre.eqBands.forEach((b, i) => { bands[i] = { ...b }; });
    out.eqBands = bands;
  }
  return out;
}
// AU-04 — A/B preview state for one preset audition (UI-owned, pure shape):
// A = the clip's current fx, B = the preset as it would apply (replace or
// merge). The panel toggles which side is audible; committing B writes it.
export function abPreviewPair(currentFx, presetFx, mode = 'replace') {
  return {
    a: structuredClone(currentFx || {}),
    b: mode === 'merge' ? mergeAudioFxLayer(currentFx, presetFx) : structuredClone(presetFx),
    mode,
  };
}

// The preset matching the clip's current settings, if any (drives the active chip).
export function activePreset(fx) {
  return AUDIO_PRESETS.find((p) => audioFxEquals(fx, p.fx)) || null;
}
