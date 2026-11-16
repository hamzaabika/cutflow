// Creative Composer catalog (CC-07): the browse model for the Composer panel.
//
// Built live from the app's own catalogs — effects, transitions, text
// templates, clip animations, audio presets, stickers — plus the CC-01–CC-03
// named content (bloom presets, film-burn variations, flicker presets),
// each entry carrying the engine id it needs. An entry whose content id is
// NOT in the live catalogs is `available: false` with an honest reason: the
// tile shows "unavailable", never a fake preview. No new render content is
// invented here; a named preset becomes available only when the stream that
// owns it registers it (its `providesId` appears in the preset registry).
//
// Pure logic (no DOM, no React) so node tests share it with the panel;
// localStorage access goes through an injectable `storage` argument.

import { EFFECTS, TRANSITIONS } from '../effects.js';
import { TEXT_TEMPLATES } from '../text/catalog.js';
import { ANIMATIONS } from '../anim.js';
import { AUDIO_PRESETS } from '../fx/audioPresets.js';
import { STICKERS } from '../stickers.js';
import { validatePack } from '../packs.js';

export const COMPOSER_SECTIONS = [
  { id: 'text', target: 'text' },
  { id: 'motion', target: 'picture' },
  { id: 'transitions', target: 'picture' },
  { id: 'glow', target: 'picture' },
  { id: 'film', target: 'picture' },
  { id: 'titles', target: 'text' },
  { id: 'graphics', target: 'sticker' },
  { id: 'sound', target: 'picture' },
  { id: 'library', target: 'any' },
];

// Search aliases per section (English / French / Arabic). Item search also
// matches the item name and its engine id, so a user typing in any of the
// three languages finds the same tile.
const SECTION_ALIASES = {
  text: { en: ['text', 'word'], fr: ['texte', 'mot'], ar: ['نص', 'كلمة'] },
  motion: { en: ['motion', 'animation', 'move'], fr: ['mouvement', 'animation'], ar: ['حركة', 'تحريك'] },
  transitions: { en: ['transition', 'cut'], fr: ['transition'], ar: ['انتقال'] },
  glow: { en: ['glow', 'bloom', 'light', 'neon'], fr: ['lueur', 'lumière', 'néon'], ar: ['توهج', 'ضوء', 'نيون'] },
  film: { en: ['film', 'burn', 'leak', 'vintage', 'grain', 'vhs'], fr: ['film', 'vintage', 'grain'], ar: ['فيلم', 'حرق', 'تسرب'] },
  titles: { en: ['title', 'heading'], fr: ['titre'], ar: ['عنوان'] },
  graphics: { en: ['sticker', 'graphic', 'arrow', 'shape'], fr: ['autocollant', 'graphique'], ar: ['ملصق', 'رسم'] },
  sound: { en: ['sound', 'audio', 'voice'], fr: ['son', 'audio', 'voix'], ar: ['صوت'] },
  library: { en: ['preset', 'saved', 'mine'], fr: ['préréglage'], ar: ['إعداد'] },
};

// CC-01 starter bloom presets (MASTER-SPEC §5): the named presets the bloom
// stream registers. `providesId` is the preset id that makes the tile live.
export const BLOOM_PRESETS = [
  'Clean Soft Bloom', 'Warm Halation', 'Cool Diffuse', 'Neon Sign', 'Edge Glow',
  'Dream', 'Colored Bloom', 'Chromatic Neon', 'Highlight Halo', 'Text Glow Pulse',
  'Gentle Light Sweep',
].map((name) => ({ name, providesId: `bloom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }));

// CC-02 film-burn / light-leak variations (MASTER-SPEC §5). The film-burn and
// light-leak TRANSITIONS stay removed by Hamza's order; these are the
// continuous-effect variations, which need the CC-02 stream to register them.
export const FILM_BURN_VARIATIONS = [
  'Warm Edge', 'Center Flash', 'Red Analog', 'Sunrise Leak', 'Dirty 8mm',
  'Gold Bloom', 'Soft Burn', 'Film Gate Burn', 'Double Flash', 'Light Streak',
  'Pastel Leak', 'Burn Match Cut',
].map((name) => ({ name, providesId: `filmburn-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }));

// CC-03 curated flicker / decode variations (MASTER-SPEC §5). The engines
// exist (title-flicker / title-decode / title-cascade templates); the named
// presets become live only when the CC-03 stream registers them.
export const FLICKER_PRESETS = [
  'Soft Neon Flicker', 'Startup Neon', 'Flicker Reveal', 'Flicker Out',
  'Digital Decode', 'Terminal Resolve', 'Signal Error', 'RGB Glitch Reveal',
  'Character Scan', 'Word Flicker', 'Electric Subtitle', 'Gentle Pulse',
  'Slow Staggered Neon',
].map((name) => ({ name, providesId: `flicker-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` }));

export const COMING_CONTENT = [
  ...BLOOM_PRESETS.map((p) => ({ ...p, section: 'glow', kind: 'coming' })),
  ...FILM_BURN_VARIATIONS.map((p) => ({ ...p, section: 'film', kind: 'coming' })),
  ...FLICKER_PRESETS.map((p) => ({ ...p, section: 'film', kind: 'coming' })),
];

// A small curated set the Recommended chip surfaces (real engine ids only).
const RECOMMENDED = new Set([
  'fade_in', 'zoom_in', 'pop_in', 'pulse', 'kenburns', 'fade', 'wipeleft',
  'fx_bloom1', 'title-bold', 'title-neon', 'clear-voice', 'fx_vignette',
]);

const FLASHY = /flicker|glitch|flash|strobe|shake|vibrate/i;

const base = (section, kind, engineId, name, extra = {}) => ({
  key: `composer:${section}:${engineId}`,
  section,
  kind,
  engineId,
  name,
  aliases: SECTION_ALIASES[section] || { en: [], fr: [], ar: [] },
  target: (COMPOSER_SECTIONS.find((s) => s.id === section) || {}).target || 'picture',
  phase: null,
  dims: '2d',
  noFlash: !FLASHY.test(`${engineId} ${name}`),
  lowEnd: kind !== 'effect' || !['Light & Glow', 'Blur & Focus'].includes(extra.group || ''),
  recommended: RECOMMENDED.has(engineId),
  available: true,
  unavailableReason: null,
  ...extra,
});

// Build the full browse list. `presetIds` is the set of registered creative
// preset ids (seeds + stored + imported packs): a coming-content entry is
// available only when its providesId is in it.
export function buildComposerItems({ presetIds = new Set() } = {}) {
  const items = [];
  for (const t of TEXT_TEMPLATES) {
    if (t.caption) continue;
    const section = t.cat === 'Titles' ? 'titles' : 'text';
    items.push(base(section, 'text', t.id, t.name, {
      template: t,
      dims: t.id === 'title-3d' ? '3d' : '2d',
      previewText: t.previewText || undefined,
    }));
  }
  for (const kind of ['in', 'out', 'combo']) {
    for (const a of ANIMATIONS[kind]) {
      items.push(base('motion', 'anim', a.id, a.name, {
        animKind: kind,
        phase: kind === 'combo' ? 'loop' : kind,
        dims: a.id === 'orbit' ? '3d' : '2d',
      }));
    }
  }
  for (const tr of TRANSITIONS) {
    items.push(base('transitions', 'transition', tr.id, tr.name, { duration: tr.duration || 0.5 }));
  }
  for (const e of EFFECTS) {
    const section = e.group === 'Light & Glow' ? 'glow' : e.group === 'Film & Vintage' ? 'film' : null;
    if (!section) continue;
    items.push(base(section, 'effect', e.id, e.name, { group: e.group }));
  }
  for (const s of STICKERS) {
    items.push(base('graphics', 'sticker', s.id, s.name, { sticker: s }));
  }
  for (const p of AUDIO_PRESETS) {
    items.push(base('sound', 'audio', p.id, p.name, { audioPreset: p }));
  }
  for (const c of COMING_CONTENT) {
    const live = presetIds.has(c.providesId);
    items.push(base(c.section, 'coming', c.providesId, c.name, {
      available: live,
      unavailableReason: live ? null : 'missing-content',
      providesId: c.providesId,
    }));
  }
  return items;
}

// ---- Search ----
// Arabic-insensitive normalisation: lower-case, strip tatweel + diacritics.
export const normQuery = (s) => String(s || '')
  .toLowerCase()
  .replace(/[ـً-ٰٟ]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export function matchesQuery(item, query) {
  const q = normQuery(query);
  if (!q) return true;
  const hay = normQuery([
    item.name, item.engineId, item.section,
    ...(item.aliases?.en || []), ...(item.aliases?.fr || []), ...(item.aliases?.ar || []),
  ].join(' '));
  return q.split(' ').every((tok) => hay.includes(tok));
}

// Filter chips: 'all' | 'recommended' | 'favorites' | 'recent' | 'in' | 'out'
// | 'loop' | '2d' | '3d' | 'noflash' | 'lowend'. `media` narrows the target
// media type ('all' | 'picture' | 'text' | 'audio' | 'sticker').
export function filterComposerItems(items, { q = '', chip = 'all', media = 'all', section = 'all', favs = new Set(), recentPresets = [], hideUnavailable = false } = {}) {
  return items.filter((it) => {
    if (section !== 'all' && it.section !== section) return false;
    if (media !== 'all' && it.target !== media) return false;
    if (hideUnavailable && !it.available) return false;
    if (!matchesQuery(it, q)) return false;
    switch (chip) {
      case 'recommended': return !!it.recommended;
      case 'favorites': return favs.has(it.key);
      case 'recent': return recentPresets.includes(it.key);
      case 'in': return it.phase === 'in';
      case 'out': return it.phase === 'out';
      case 'loop': return it.phase === 'loop';
      case '2d': return it.dims === '2d';
      case '3d': return it.dims === '3d';
      case 'noflash': return !!it.noFlash;
      case 'lowend': return !!it.lowEnd;
      default: return true;
    }
  });
}

// ---- Favourites + recent (localStorage, injectable for tests) ----
export const COMPOSER_FAV_KEY = 'cutflow.composer.favs';
// Recent PRESETS (Composer) — distinct from F3's recent EFFECTS list by
// name, key and helper: this one records applied Composer items only.
export const COMPOSER_RECENT_PRESETS_KEY = 'cutflow.composer.recentPresets';
export const COMPOSER_PACKS_KEY = 'cutflow.composer.packs';
const safeStorage = (s) => (s && typeof s.getItem === 'function' && typeof s.setItem === 'function' ? s : null);
const readSet = (storage, key) => {
  const s = safeStorage(storage);
  if (!s) return new Set();
  try { return new Set(JSON.parse(s.getItem(key) || '[]')); } catch { return new Set(); }
};
const readList = (storage, key) => {
  const s = safeStorage(storage);
  if (!s) return [];
  try { const v = JSON.parse(s.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

export const loadComposerFavs = (storage) => readSet(storage, COMPOSER_FAV_KEY);
export function toggleComposerFav(storage, key) {
  const next = readSet(storage, COMPOSER_FAV_KEY);
  if (next.has(key)) next.delete(key); else next.add(key);
  const s = safeStorage(storage);
  if (s) { try { s.setItem(COMPOSER_FAV_KEY, JSON.stringify([...next])); } catch { /* convenience only */ } }
  return next;
}
export const loadComposerRecentPresets = (storage) => readList(storage, COMPOSER_RECENT_PRESETS_KEY);
export function recordComposerRecentPreset(storage, key, max = 12) {
  const next = [key, ...readList(storage, COMPOSER_RECENT_PRESETS_KEY).filter((k) => k !== key)].slice(0, max);
  const s = safeStorage(storage);
  if (s) { try { s.setItem(COMPOSER_RECENT_PRESETS_KEY, JSON.stringify(next)); } catch { /* convenience only */ } }
  return next;
}

// ---- Validated pack import (reuses src/packs.js) ----
export function validatePackFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${e.message}`], pack: null };
  }
  const { ok, errors, warnings } = validatePack(parsed);
  return { ok, errors, warnings, pack: ok ? parsed : null };
}
