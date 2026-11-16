// Creative Preset registry (P1-56): the single registry every preset family
// plugs into. One entry per target type: the family name, which clip kind it
// applies to, the parameter limits/defaults an editor may offer, the
// renderers that honour it, and a performance tag. The built-in tables it
// validates variants against (FILTERS, TEXT_TEMPLATES, AUDIO_PRESETS,
// TRANSITIONS) are the app's own catalogs — a preset that names a variant
// that does not exist there is invalid, never silently substituted.

import { FILTERS, TRANSITIONS } from '../effects.js';
import { TEXT_TEMPLATES } from '../text/catalog.js';
import { AUDIO_PRESETS, normalizeAudioFx } from '../fx/audioPresets.js';
import { BUNDLED_LUTS } from '../fx/lut.js';

// A LUT filter variant: 'lut:<bundled .cube file>' — a real bundled LUT, or
// a user .cube filename (relinked by the asset manifest on import, P2-17).
const isLutVariant = (v) => typeof v === 'string' && v.startsWith('lut:')
  && /^lut:[A-Za-z0-9._-]+\.cube$/.test(v)
  && (BUNDLED_LUTS.some((l) => l.file === v.slice(4)) || !v.includes('/'));

export const PRESET_TARGETS = ['filter', 'text', 'caption', 'audio', 'transition'];

// A numeric parameter an editor may offer for a target: key, label, range,
// step and default. Object parameters (adjust, style, audioFx) are edited
// through their own panels; the registry only bounds their numeric leaves.
export const TARGET_DEFS = {
  filter: {
    label: 'Filter', family: 'look', appliesTo: 'picture',
    renderers: ['preview', 'export'], performance: 'low',
    params: [
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, def: 100 },
    ],
  },
  text: {
    label: 'Text', family: 'title', appliesTo: 'text',
    renderers: ['preview', 'export'], performance: 'low',
    params: [
      { key: 'style.size', label: 'Size', min: 8, max: 300, step: 1, def: null },
      { key: 'style.opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, def: null },
    ],
  },
  caption: {
    label: 'Caption', family: 'caption-style', appliesTo: 'text',
    renderers: ['preview', 'export'], performance: 'low',
    params: [
      { key: 'style.size', label: 'Size', min: 8, max: 300, step: 1, def: null },
      { key: 'style.opacity', label: 'Opacity', min: 0, max: 1, step: 0.05, def: null },
    ],
  },
  audio: {
    label: 'Audio', family: 'voice', appliesTo: 'picture',
    renderers: ['preview', 'export'], performance: 'low',
    params: [
      { key: 'audioFx.pitch', label: 'Pitch', min: -12, max: 12, step: 1, def: 0 },
      { key: 'audioFx.highpass', label: 'High-pass', min: 0, max: 300, step: 10, def: 0 },
    ],
  },
  transition: {
    label: 'Transition', family: 'crossfade', appliesTo: 'picture',
    renderers: ['preview', 'export'], performance: 'low',
    params: [
      { key: 'duration', label: 'Duration', min: 0.2, max: 2, step: 0.05, def: 0.5, unit: 's' },
    ],
  },
};

export const targetDef = (target) => TARGET_DEFS[target] || null;
export const isPresetTarget = (t) => PRESET_TARGETS.includes(t);
export const paramDefs = (target) => (TARGET_DEFS[target]?.params || []).map((p) => ({ ...p }));
export const familyFor = (target) => TARGET_DEFS[target]?.family || 'custom';

// Does `variant` name a real built-in this target can wrap? null is allowed
// only where a preset can be pure parameters (caption style, custom audio
// chain); every other target must name an existing built-in.
export function variantExists(target, variant) {
  if (variant == null) return target === 'caption' || target === 'audio';
  if (typeof variant !== 'string' || !variant) return false;
  switch (target) {
    case 'filter': return FILTERS.some((f) => f.id === variant) || isLutVariant(variant);
    case 'text': return TEXT_TEMPLATES.some((t) => t.id === variant);
    case 'caption': return TEXT_TEMPLATES.some((t) => t.id === variant);
    case 'audio': return AUDIO_PRESETS.some((p) => p.id === variant);
    case 'transition': return TRANSITIONS.some((t) => t.id === variant);
    default: return false;
  }
}

const clampNum = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// The default parameter set for a target (and variant, where the built-in
// supplies one — an audio variant's chain, a transition's own duration).
export function defaultParams(target, variant = null) {
  switch (target) {
    case 'filter': return { intensity: 100, adjust: {} };
    case 'text': return { style: {} };
    case 'caption': return { style: {} };
    case 'audio': {
      const p = variant ? AUDIO_PRESETS.find((x) => x.id === variant) : null;
      return { audioFx: normalizeAudioFx(p ? p.fx : null) };
    }
    case 'transition': {
      const t = variant ? TRANSITIONS.find((x) => x.id === variant) : null;
      const d = t && Number.isFinite(t.duration) ? t.duration : 0.5;
      return { duration: clampNum(d, 0.5, 0.2, 2) };
    }
    default: return {};
  }
}

// Normalize a raw params object for a target: unknown keys dropped, numeric
// leaves clamped to the registry limits, objects deep-cloned so a stored
// preset can never alias a live clip's objects.
export function clampParams(target, params) {
  const p = (params && typeof params === 'object' && !Array.isArray(params)) ? params : {};
  switch (target) {
    case 'filter':
      return {
        intensity: clampNum(p.intensity, 100, 0, 100),
        adjust: (p.adjust && typeof p.adjust === 'object' && !Array.isArray(p.adjust)) ? clone(p.adjust) : {},
      };
    case 'text':
    case 'caption': {
      const style = (p.style && typeof p.style === 'object' && !Array.isArray(p.style)) ? clone(p.style) : {};
      if (Number.isFinite(Number(style.size))) style.size = clampNum(style.size, style.size, 8, 300);
      if (Number.isFinite(Number(style.opacity))) style.opacity = clampNum(style.opacity, style.opacity, 0, 1);
      return { style };
    }
    case 'audio':
      return { audioFx: normalizeAudioFx(p.audioFx || null) };
    case 'transition':
      return { duration: clampNum(p.duration, 0.5, 0.2, 2) };
    default:
      return {};
  }
}

// Read/write one dotted param path (e.g. 'style.size', 'audioFx.pitch')
// inside a clamped params object.
export function getParam(params, key) {
  const [head, leaf] = key.split('.');
  if (!leaf) return params?.[head];
  return params?.[head]?.[leaf];
}

export function setParam(params, key, value) {
  const [head, leaf] = key.split('.');
  const next = { ...(params || {}) };
  if (!leaf) { next[head] = value; return next; }
  next[head] = { ...(next[head] || {}), [leaf]: value };
  return next;
}
