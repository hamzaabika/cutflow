// Seed presets (P1-56): a few real examples so the schema + render path can
// be exercised end to end — deliberately NOT a catalog expansion. Every seed
// wraps an existing built-in (a filter look, a text template, an audio
// preset, a transition); no new render content is invented here. Seeds are
// not persisted: they are merged in at display time and cannot be deleted,
// only copied into a user's own preset when edited.

import { sanitizeCreativePreset } from './schema.js';
import { AUDIO_PRESETS } from '../fx/audioPresets.js';

const FIXED_AT = '2026-11-15T00:00:00.000Z';

const RAW_SEEDS = [
  {
    id: 'seed-vivid-pop', name: 'Vivid Pop', target: 'filter', variant: 'vivid',
    params: { intensity: 80, adjust: {} },
  },
  {
    id: 'seed-noir-still', name: 'Noir Still', target: 'filter', variant: 'noir',
    params: { intensity: 100, adjust: {} },
  },
  {
    id: 'seed-big-title', name: 'Big Title', target: 'text', variant: 'title-bold',
    params: { style: {} },
  },
  {
    id: 'seed-essential-captions', name: 'Essential Captions', target: 'caption', variant: 'cap-classic',
    params: { style: {} },
  },
  {
    id: 'seed-clear-voice', name: 'Clear Voice', target: 'audio', variant: 'clear-voice',
    params: { audioFx: AUDIO_PRESETS.find((p) => p.id === 'clear-voice')?.fx || null },
  },
  {
    id: 'seed-soft-crossfade', name: 'Soft Crossfade', target: 'transition', variant: 'fade',
    params: { duration: 0.5 },
  },
];

export function seedPresets() {
  return RAW_SEEDS.map((s) => sanitizeCreativePreset({
    kind: 'cutflow.creative-preset',
    schemaVersion: 1,
    ...s,
    source: 'seed',
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
  })).filter(Boolean);
}
