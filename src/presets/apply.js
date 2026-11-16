// Applying CreativePresets (P1-56): capture a preset from a clip's current
// settings, and turn a preset back into the clip patch that renders it.
// Both directions go through the SAME clip fields the preview and the
// export engine already read (filter/filterIntensity/adjust, audioFx,
// transition, text style patch + template) — a preset never invents a
// render path, so preview and export stay consistent by construction, and
// applying a preset is one undoable dispatch, like any other panel edit.

import { newCreativePreset } from './schema.js';
import { targetDef } from './registry.js';
import { lutAsset, fontAsset } from './assets.js';
import { TEXT_TEMPLATES } from '../text/catalog.js';
import { captureStylePatch } from '../text/userTemplates.js';
import { activePreset, normalizeAudioFx } from '../fx/audioPresets.js';

// Keys that stay per clip and never travel in a text/caption style patch
// (mirrors stylePatch in src/components/TextInspector.jsx).
const PER_CLIP = ['id', 'text', 'start', 'duration', 'words', 'caption'];
const stripPerClip = (patch) => {
  const out = { ...(patch || {}) };
  PER_CLIP.forEach((k) => delete out[k]);
  return out;
};

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// 'picture' (video/overlay clip, via updateTarget) or 'text' (a text clip,
// via dispatch update track 'text').
export const presetAppliesTo = (preset) => targetDef(preset?.target)?.appliesTo || null;

// Capture the clip's current settings for `target` as a new preset.
// Returns null when the clip carries nothing capturable for that target
// (no filter, no transition, no audio chain, no text style).
export function capturePresetFromClip(clip, target, name) {
  if (!clip || !name || !String(name).trim()) return null;
  const cleanName = String(name).trim();
  switch (target) {
    case 'filter': {
      const filter = clip.filter;
      if (!filter || filter === 'none') return null;
      // A LUT filter ('lut:<file>.cube') IS capturable now (P2-17): the
      // preset carries the LUT as an asset entry, relinked on import.
      const assets = String(filter).startsWith('lut:') ? [lutAsset(filter.slice(4))].filter(Boolean) : [];
      return newCreativePreset({
        name: cleanName, target, variant: filter,
        params: { intensity: clip.filterIntensity ?? 100, adjust: clone(clip.adjust || {}) },
        assets,
      });
    }
    case 'text': {
      if (clip.text == null) return null;
      return captureTextPreset(clip, target, cleanName);
    }
    case 'caption': {
      if (!clip.caption && clip.source !== 'srt') return null;
      return captureTextPreset(clip, target, cleanName);
    }
    case 'audio': {
      if (!clip.audioFx) return null;
      return newCreativePreset({
        name: cleanName, target, variant: activePreset(clip.audioFx)?.id ?? null,
        params: { audioFx: normalizeAudioFx(clip.audioFx) },
      });
    }
    case 'transition': {
      if (!clip.transition?.type) return null;
      return newCreativePreset({
        name: cleanName, target, variant: clip.transition.type,
        params: { duration: clip.transition.duration ?? 0.5 },
      });
    }
    default: return null;
  }
}

function captureTextPreset(clip, target, name) {
  // A clip template that is not a built-in (e.g. 'user:<name>') cannot be a
  // variant — the captured style patch carries the look instead.
  const tplId = typeof clip.template === 'string' && TEXT_TEMPLATES.some((t) => t.id === clip.template)
    ? clip.template : null;
  const style = captureStylePatch(clip) || {};
  if (!tplId && !Object.keys(style).length) return null;
  // P2-17: the font the style names travels as an asset entry, so an import
  // on a machine without that font reports it instead of silently falling back.
  const assets = style.font ? [fontAsset(style.font)].filter(Boolean) : [];
  return newCreativePreset({ name, target, variant: tplId, params: { style }, assets });
}

// The picture-clip patch a preset applies (filter / audio / transition).
// Filter patch is identical in shape to the legacy presetPatch
// (src/fx/presets.js): { filter, filterIntensity, adjust }.
export function presetClipPatch(preset) {
  if (!preset) return {};
  switch (preset.target) {
    case 'filter':
      return { filter: preset.variant, filterIntensity: preset.params?.intensity ?? 100, adjust: clone(preset.params?.adjust || {}) };
    case 'audio':
      return { audioFx: normalizeAudioFx(preset.params?.audioFx || null) };
    case 'transition':
      return { transition: { type: preset.variant, duration: preset.params?.duration ?? 0.5 } };
    default:
      return {};
  }
}

// The text-clip patch a preset applies (text / caption): the wrapped
// template's style first, the preset's own style overrides on top, and the
// template id so the clip keeps its template identity.
export function presetTextPatch(preset) {
  if (!preset) return {};
  const tpl = preset.variant ? TEXT_TEMPLATES.find((t) => t.id === preset.variant) : null;
  const patch = { ...(tpl ? stripPerClip(tpl.patch) : {}), ...(preset.params?.style || {}) };
  if (tpl) patch.template = tpl.id;
  return patch;
}
