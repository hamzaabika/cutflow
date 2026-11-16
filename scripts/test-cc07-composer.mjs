// CC-07 Composer UI (MASTER-SPEC §5): the catalog model behind the Composer
// panel — sections built from the live catalogs, search incl. Arabic/French
// aliases, filter chips, favourites/recent presets, and the honest "unavailable"
// state for CC-01–CC-03 content whose id is not registered yet. Also pins
// validated pack import (src/packs.js): malformed or dangerous packs are
// rejected, never partially applied.
// Run: node scripts/test-cc07-composer.mjs   (plain Node)
import assert from 'node:assert';
import {
  BLOOM_PRESETS, COMING_CONTENT, COMPOSER_SECTIONS, FILM_BURN_VARIATIONS,
  FLICKER_PRESETS, buildComposerItems, filterComposerItems, loadComposerFavs,
  loadComposerRecentPresets, matchesQuery, recordComposerRecentPreset, toggleComposerFav,
  validatePackFile,
} from '../src/composer/catalog.js';
import { buildManifest } from '../src/packs.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

const items = buildComposerItems();
const bySection = (id) => items.filter((i) => i.section === id);

// ---- Sections: every spec section is populated from live catalogs ----
for (const s of ['text', 'motion', 'transitions', 'glow', 'film', 'titles', 'graphics', 'sound']) {
  ok(bySection(s).length > 0, `section ${s} is populated (${bySection(s).length} items)`);
}
ok(COMPOSER_SECTIONS.map((s) => s.id).join(',') === 'text,motion,transitions,glow,film,titles,graphics,sound,library', 'section order matches the spec');
ok(bySection('motion').some((i) => i.phase === 'in'), 'motion has In items');
ok(bySection('motion').some((i) => i.phase === 'out'), 'motion has Out items');
ok(bySection('motion').some((i) => i.phase === 'loop'), 'motion has Loop items');
ok(bySection('text').every((i) => i.template), 'every text item carries its live template');
ok(bySection('graphics').every((i) => i.sticker), 'every graphics item carries its live sticker');
ok(bySection('sound').every((i) => i.audioPreset), 'every sound item carries its live audio preset');

// ---- Live content is available; coming content is honestly unavailable ----
ok(bySection('glow').some((i) => i.engineId === 'fx_bloom1' && i.available), 'fx_bloom1 (real effect) is available in Glow');
ok(items.some((i) => i.engineId === 'title-flicker' && i.available), 'title-flicker (real template) is available');
ok(items.some((i) => i.engineId === 'title-decode' && i.available), 'title-decode (real template) is available');
ok(BLOOM_PRESETS.length === 11, 'CC-01 names 11 bloom presets');
ok(FILM_BURN_VARIATIONS.length === 12, 'CC-02 names 12 film-burn variations');
ok(FLICKER_PRESETS.length === 13, 'CC-03 names 13 flicker presets');
ok(COMING_CONTENT.length === 36, '36 coming-content entries in total');
const coming = items.filter((i) => i.kind === 'coming');
ok(coming.length === 36, 'all 36 coming entries are in the browse list');
ok(coming.every((i) => !i.available && i.unavailableReason === 'missing-content'), 'every coming entry is unavailable with an honest reason');
ok(coming.every((i) => i.providesId), 'every coming entry names the preset id that would make it live');
ok(!items.some((i) => i.kind === 'coming' && i.name === 'Soft Neon Flicker' && i.available), 'Soft Neon Flicker is unavailable until CC-03 registers it');
// Registering the id flips exactly that tile live — no fake preview before.
const live = buildComposerItems({ presetIds: new Set(['bloom-clean-soft-bloom']) });
ok(live.find((i) => i.engineId === 'bloom-clean-soft-bloom').available, 'a registered bloom id becomes available');
ok(live.filter((i) => i.kind === 'coming' && i.available).length === 1, 'only the registered id flips live');

// ---- Search incl. Arabic / French aliases ----
ok(matchesQuery(bySection('glow')[0], 'glow'), 'search matches the section alias');
ok(filterComposerItems(items, { q: 'bloom' }).length >= 11, 'search "bloom" finds the glow effects and the bloom presets');
ok(filterComposerItems(items, { q: 'توهج' }).some((i) => i.section === 'glow'), 'Arabic "توهج" finds Glow');
ok(filterComposerItems(items, { q: 'lueur' }).some((i) => i.section === 'glow'), 'French "lueur" finds Glow');
ok(filterComposerItems(items, { q: 'انتقال' }).every((i) => i.section === 'transitions'), 'Arabic "انتقال" finds only Transitions');
ok(filterComposerItems(items, { q: 'zzz-no-match' }).length === 0, 'a nonsense query finds nothing');

// ---- Filter chips ----
ok(filterComposerItems(items, { chip: 'recommended' }).length > 0, 'Recommended is non-empty');
ok(filterComposerItems(items, { chip: 'recommended' }).every((i) => i.recommended), 'Recommended only returns flagged items');
ok(filterComposerItems(items, { chip: 'in' }).every((i) => i.phase === 'in'), 'In chip only returns In motion');
ok(filterComposerItems(items, { chip: 'out' }).every((i) => i.phase === 'out'), 'Out chip only returns Out motion');
ok(filterComposerItems(items, { chip: 'loop' }).every((i) => i.phase === 'loop'), 'Loop chip only returns Loop motion');
ok(filterComposerItems(items, { chip: '3d' }).some((i) => i.engineId === 'title-3d'), '3D chip includes the 3D title');
ok(filterComposerItems(items, { chip: '3d' }).every((i) => i.dims === '3d'), '3D chip only returns 3D items');
ok(filterComposerItems(items, { chip: 'noflash' }).every((i) => i.noFlash), 'No Flash excludes flicker/glitch items');
ok(filterComposerItems(items, { chip: 'noflash' }).every((i) => !/flicker/i.test(i.engineId)), 'No Flash excludes the flicker template');
ok(filterComposerItems(items, { chip: 'lowend' }).every((i) => i.lowEnd), 'Low-End Friendly only returns low-end items');
ok(filterComposerItems(items, { media: 'text' }).every((i) => i.target === 'text'), 'media filter narrows to text');
ok(filterComposerItems(items, { hideUnavailable: true }).every((i) => i.available), 'Hide unavailable removes the coming entries');

// ---- Favourites + recent (injectable storage) ----
const mem = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
};
{
  const s = mem();
  ok(loadComposerFavs(s).size === 0, 'favs start empty');
  const after = toggleComposerFav(s, 'composer:motion:fade_in');
  ok(after.has('composer:motion:fade_in'), 'toggle adds a favourite');
  ok(loadComposerFavs(s).has('composer:motion:fade_in'), 'favourite persists in storage');
  ok(filterComposerItems(items, { chip: 'favorites', favs: loadComposerFavs(s) }).length === 1, 'Favorites chip returns the favourited tile');
  ok(toggleComposerFav(s, 'composer:motion:fade_in').size === 0, 'toggle again removes it');
  const r1 = recordComposerRecentPreset(s, 'composer:motion:fade_in');
  const r2 = recordComposerRecentPreset(s, 'composer:glow:fx_bloom1');
  ok(r2[0] === 'composer:glow:fx_bloom1' && r2[1] === 'composer:motion:fade_in', 'recent is most-recent-first');
  ok(recordComposerRecentPreset(s, 'composer:motion:fade_in')[0] === 'composer:motion:fade_in', 're-applying moves an item to the front of recent presets');
  ok(loadComposerRecentPresets(s).length === 2, 'recent presets persist in storage');
  ok(filterComposerItems(items, { chip: 'recent', recentPresets: loadComposerRecentPresets(s) }).length === 2, 'Last Used chip returns recent preset tiles');
}

// ---- Validated pack import: reject malformed / dangerous, accept valid ----
{
  const good = buildManifest({
    name: 'Test pack',
    presets: [{ kind: 'transition', id: 't1', name: 'Fade', data: { type: 'fade', duration: 0.5 } }],
    assets: [],
  });
  const v = validatePackFile(JSON.stringify(good));
  ok(v.ok && v.pack && v.pack.presets.length === 1, 'a valid pack validates');
  ok(!validatePackFile('{not json').ok, 'malformed JSON is rejected');
  const traversal = { ...good, assets: [{ name: '../evil.png', sha256: '0'.repeat(64), size: 10 }] };
  ok(!validatePackFile(JSON.stringify(traversal)).ok, 'a path-traversal asset is rejected');
  const exe = { ...good, assets: [{ name: 'evil.js', sha256: '0'.repeat(64), size: 10 }] };
  ok(!validatePackFile(JSON.stringify(exe)).ok, 'an executable asset is rejected');
  const badKind = { ...good, presets: [{ kind: 'malware', id: 'x', name: 'X', data: {} }] };
  ok(!validatePackFile(JSON.stringify(badKind)).ok, 'an unknown preset kind is rejected');
  const badVersion = { ...good, version: 99 };
  ok(!validatePackFile(JSON.stringify(badVersion)).ok, 'a wrong pack version is rejected');
  const dup = { ...good, presets: [good.presets[0], good.presets[0]] };
  ok(!validatePackFile(JSON.stringify(dup)).ok, 'duplicate preset ids are rejected');
}

console.log(`test-cc07-composer: PASS (${checks} checks)`);
