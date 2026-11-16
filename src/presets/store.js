// Unified CreativePreset store (P1-56): the one localStorage home for v1
// presets. The legacy stores (clipcraft.filterPresets,
// clipcraft.captionTemplates) are left in place — the old Filters / Captions
// panels keep reading them, and migration only READS them, so nothing an
// old project or panel relied on is moved or deleted. Migration runs once
// (flagged in storage) and is idempotent: a second run adds nothing.

import { CREATIVE_PRESET_KIND, CREATIVE_PRESET_SCHEMA_VERSION, fromLegacyFilterPreset, fromLegacyTextTemplate, sanitizeCreativePreset } from './schema.js';
import { lutAsset, fontAsset, sanitizeAssets } from './assets.js';
import { loadPresets as loadLegacyFilterPresets } from '../fx/presets.js';
import { loadUserTemplates as loadLegacyTextTemplates } from '../text/userTemplates.js';

export const CREATIVE_PRESET_KEY = 'cutflow.creativePresets.v1';
export const CREATIVE_PRESET_MIGRATED_KEY = 'cutflow.creativePresets.migrated.v1';

export function loadCreativePresets(storage) {
  try {
    const v = JSON.parse((storage || localStorage).getItem(CREATIVE_PRESET_KEY) || '[]');
    return (Array.isArray(v) ? v : []).map(sanitizeCreativePreset).filter(Boolean);
  } catch { return []; }
}

export function saveCreativePresets(storage, list) {
  try { (storage || localStorage).setItem(CREATIVE_PRESET_KEY, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}

// Adds (or replaces, by id) a preset; returns the new list.
export function upsertCreativePreset(list, preset) {
  const clean = sanitizeCreativePreset(preset);
  if (!clean) return list;
  return [...list.filter((p) => p.id !== clean.id), clean];
}

export function removeCreativePreset(list, id) {
  return list.filter((p) => p.id !== id);
}

// One-shot migration of the legacy stores into v1. Returns { added,
// skipped, alreadyMigrated }. A legacy entry is skipped when a v1 preset
// with the same target + name already exists (a previous migration, or a
// user preset the user named the same) — the existing preset wins, the
// legacy one stays readable in its old store.
export function migrateLegacyPresets(storage) {
  const s = storage || localStorage;
  try {
    if (s.getItem(CREATIVE_PRESET_MIGRATED_KEY)) return { added: 0, skipped: 0, alreadyMigrated: true };
  } catch { /* storage blocked: report nothing migrated */ }
  const existing = loadCreativePresets(s);
  const have = new Set(existing.map((p) => `${p.target}:${p.name.toLowerCase()}`));
  const converted = [
    ...loadLegacyFilterPresets(s).map(fromLegacyFilterPreset),
    ...loadLegacyTextTemplates(s).map(fromLegacyTextTemplate),
  ].filter(Boolean);
  let added = 0;
  let skipped = 0;
  const next = [...existing];
  for (const p of converted) {
    const key = `${p.target}:${p.name.toLowerCase()}`;
    if (have.has(key)) { skipped += 1; continue; }
    have.add(key);
    next.push(p);
    added += 1;
  }
  if (added) saveCreativePresets(s, next);
  try { s.setItem(CREATIVE_PRESET_MIGRATED_KEY, '1'); } catch { /* flag best-effort */ }
  return { added, skipped, alreadyMigrated: false };
}

// P2-17 — enrich v1 presets saved before assets existed (or migrated from
// legacy records, which never carried assets): derive the LUT / font asset
// entries from the preset's own variant + params. Idempotent: a preset that
// already lists an asset for that file/font is left alone. Returns the
// number of presets changed.
export function migratePresetAssets(storage) {
  const s = storage || localStorage;
  const list = loadCreativePresets(s);
  let changed = 0;
  const next = list.map((p) => {
    const derived = [];
    if (p.target === 'filter' && typeof p.variant === 'string' && p.variant.startsWith('lut:')) {
      const a = lutAsset(p.variant.slice(4));
      if (a) derived.push(a);
    }
    if ((p.target === 'text' || p.target === 'caption') && p.params?.style?.font) {
      const a = fontAsset(p.params.style.font);
      if (a) derived.push(a);
    }
    if (!derived.length) return p;
    const have = new Set((p.assets || []).map((a) => `${a.kind}:${a.relPath}`));
    const merged = sanitizeAssets([...(p.assets || []), ...derived.filter((a) => !have.has(`${a.kind}:${a.relPath}`))]);
    if (merged.length === (p.assets || []).length) return p;
    changed += 1;
    return { ...p, assets: merged, updatedAt: new Date().toISOString() };
  });
  if (changed) saveCreativePresets(s, next);
  return changed;
}
