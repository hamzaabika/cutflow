// CreativePreset schema v1 (P1-55 / P1-56): the one versioned, portable
// preset format across filter / text / caption / audio / transition.
// A preset is a plain JSON object, importable/exportable as a .json file:
//
//   {
//     kind: 'cutflow.creative-preset', schemaVersion: 1,
//     id: 'cp_...', name: 'Vivid Pop',
//     target: 'filter', family: 'look', variant: 'vivid',
//     params: { intensity: 80, adjust: {} },
//     source: 'user' | 'seed' | 'legacy-filter' | 'legacy-text',
//     createdAt, updatedAt
//   }
//
// `variant` names the built-in the preset wraps (a filter id, a text
// template id, an audio preset id, a transition id) — or null where the
// preset is pure parameters (a caption style, a custom audio chain).
// `params` holds only that target's parameter keys, clamped by the registry
// (src/presets/registry.js). Anything a future version adds must bump
// schemaVersion; v1 readers reject newer versions rather than guessing.

import { clampParams, familyFor, isPresetTarget, variantExists } from './registry.js';
import { sanitizeAssets } from './assets.js';
import { sanitizePreset as sanitizeLegacyFilter } from '../fx/presets.js';
import { sanitizeUserTemplate as sanitizeLegacyText } from '../text/userTemplates.js';

export const CREATIVE_PRESET_SCHEMA_VERSION = 1;
export const CREATIVE_PRESET_KIND = 'cutflow.creative-preset';
export const PRESET_SOURCES = ['user', 'seed', 'legacy-filter', 'legacy-text'];

let counter = 0;
export const newPresetId = () => `cp_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const isIso = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// Build a fresh preset; returns null when the target/params cannot make one.
// `assets` is the P2-17 manifest (LUT/font/media entries, sanitized); a
// preset without assets is a plain v1 preset, as before.
export function newCreativePreset({ name, target, variant = null, params = null, source = 'user', assets = null } = {}) {
  const now = new Date().toISOString();
  return sanitizeCreativePreset({
    kind: CREATIVE_PRESET_KIND,
    schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION,
    id: newPresetId(),
    name, target, variant,
    family: familyFor(target),
    params: params ?? undefined,
    assets: assets ?? undefined,
    source,
    createdAt: now,
    updatedAt: now,
  });
}

// Normalize a raw value into a CreativePreset, or null when it cannot be one.
// Unknown future fields are dropped; out-of-range numerics are clamped by
// the registry; a variant that names no built-in is rejected, never guessed.
export function sanitizeCreativePreset(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.kind !== CREATIVE_PRESET_KIND) return null;
  if (v.schemaVersion !== CREATIVE_PRESET_SCHEMA_VERSION) return null;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 80) return null;
  if (!isPresetTarget(v.target)) return null;
  const variant = v.variant == null ? null : (typeof v.variant === 'string' ? v.variant : null);
  if (!variantExists(v.target, variant)) return null;
  const id = typeof v.id === 'string' && v.id.trim() ? v.id.trim() : newPresetId();
  const source = PRESET_SOURCES.includes(v.source) ? v.source : 'user';
  const createdAt = isIso(v.createdAt) ? v.createdAt : new Date().toISOString();
  const updatedAt = isIso(v.updatedAt) ? v.updatedAt : createdAt;
  const out = {
    kind: CREATIVE_PRESET_KIND,
    schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION,
    id,
    name,
    target: v.target,
    family: familyFor(v.target),
    variant,
    params: clampParams(v.target, v.params),
    assets: sanitizeAssets(v.assets),
    source,
    createdAt,
    updatedAt,
  };
  if (typeof v.notes === 'string' && v.notes.trim()) out.notes = v.notes.trim().slice(0, 500);
  return out;
}

// Validate with reasons: { ok, preset, errors[] }. A newer schemaVersion is
// a hard error (the reader must not guess at a format it does not know).
export function validateCreativePreset(v) {
  const errors = [];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, preset: null, errors: ['not an object'] };
  if (v.kind !== CREATIVE_PRESET_KIND) errors.push(`kind must be '${CREATIVE_PRESET_KIND}'`);
  if (v.schemaVersion !== CREATIVE_PRESET_SCHEMA_VERSION) {
    errors.push(typeof v.schemaVersion === 'number' && v.schemaVersion > CREATIVE_PRESET_SCHEMA_VERSION
      ? `schemaVersion ${v.schemaVersion} is newer than supported ${CREATIVE_PRESET_SCHEMA_VERSION}`
      : `schemaVersion must be ${CREATIVE_PRESET_SCHEMA_VERSION}`);
  }
  if (typeof v.name !== 'string' || !v.name.trim()) errors.push('name is required');
  else if (v.name.trim().length > 80) errors.push('name is longer than 80 characters');
  if (!isPresetTarget(v.target)) errors.push(`unknown target '${String(v.target)}'`);
  else if (!variantExists(v.target, v.variant == null ? null : v.variant)) errors.push(`variant '${String(v.variant)}' does not exist for target '${v.target}'`);
  if (errors.length) return { ok: false, preset: null, errors };
  const preset = sanitizeCreativePreset(v);
  if (!preset) return { ok: false, preset: null, errors: ['could not be normalized'] };
  return { ok: true, preset, errors: [] };
}

// --- .json file format -------------------------------------------------
// A file holds one preset object, or { kind: 'cutflow.creative-preset-list',
// schemaVersion: 1, presets: [...] } for a whole library.

export function serializeCreativePreset(preset) {
  return JSON.stringify(preset, null, 2);
}

export function serializeCreativePresets(list) {
  return JSON.stringify({ kind: 'cutflow.creative-preset-list', schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION, presets: list }, null, 2);
}

// Parse file text: { presets: [...valid], errors: [...] }. Invalid entries
// are reported and skipped; a file with zero valid presets parses to an
// empty list with its errors, never a throw.
export function parseCreativePresetFile(text) {
  const errors = [];
  let data;
  try { data = JSON.parse(text); } catch (e) { return { presets: [], errors: [`invalid JSON: ${e.message}`] }; }
  const raw = Array.isArray(data) ? data
    : Array.isArray(data?.presets) ? data.presets
    : [data];
  if (Array.isArray(data?.presets) && data.kind && data.kind !== 'cutflow.creative-preset-list') {
    errors.push(`list kind must be 'cutflow.creative-preset-list'`);
  }
  const presets = [];
  raw.forEach((entry, i) => {
    const r = validateCreativePreset(entry);
    if (r.ok) presets.push(r.preset);
    else errors.push(`preset ${i + 1} (${typeof entry?.name === 'string' ? entry.name : 'unnamed'}): ${r.errors.join('; ')}`);
  });
  return { presets, errors };
}

// --- Legacy migration --------------------------------------------------
// A legacy filter preset {filter look, intensity, adjust} becomes a v1
// filter preset wrapping the same look id with the same intensity/adjust —
// the clip patch it produces is byte-identical to the legacy one (pinned in
// scripts/test-creative-presets.mjs), so old projects render identically.
// A legacy user text template (a caption style patch) becomes a v1 caption
// preset carrying the same style patch. LUT looks were never storable as
// legacy filter presets (sanitizePreset rejects 'lut:'), so none migrate.

export function fromLegacyFilterPreset(p) {
  const clean = sanitizeLegacyFilter(p);
  if (!clean) return null;
  return sanitizeCreativePreset({
    kind: CREATIVE_PRESET_KIND,
    schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION,
    id: newPresetId(),
    name: clean.name,
    target: 'filter',
    variant: clean.filter,
    params: { intensity: clean.filterIntensity, adjust: clone(clean.adjust) },
    source: 'legacy-filter',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export function fromLegacyTextTemplate(t) {
  const clean = sanitizeLegacyText(t);
  if (!clean) return null;
  return sanitizeCreativePreset({
    kind: CREATIVE_PRESET_KIND,
    schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION,
    id: newPresetId(),
    name: clean.name,
    target: 'caption',
    variant: null,
    params: { style: clone(clean.patch) },
    source: 'legacy-text',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}
