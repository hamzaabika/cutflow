// CreativePreset system (P1-55 / P1-56): schema v1, registry, store +
// migration, capture/apply, seeds. No app needed — pure logic + the real
// render expression (filterExpr) for the migration parity check.
// Run: node scripts/test-creative-presets.mjs
import assert from 'node:assert/strict';
import {
  CREATIVE_PRESET_KIND, CREATIVE_PRESET_SCHEMA_VERSION,
  newCreativePreset, sanitizeCreativePreset, validateCreativePreset,
  serializeCreativePreset, serializeCreativePresets, parseCreativePresetFile,
  fromLegacyFilterPreset, fromLegacyTextTemplate,
} from '../src/presets/schema.js';
import { TARGET_DEFS, paramDefs, defaultParams, clampParams, variantExists, getParam, setParam } from '../src/presets/registry.js';
import {
  loadCreativePresets, saveCreativePresets, upsertCreativePreset, removeCreativePreset, migrateLegacyPresets,
} from '../src/presets/store.js';
import { capturePresetFromClip, presetClipPatch, presetTextPatch, presetAppliesTo } from '../src/presets/apply.js';
import { seedPresets } from '../src/presets/seeds.js';
import { presetPatch as legacyFilterPatch, PRESET_KEY } from '../src/fx/presets.js';
import { userTemplatePatch, USER_TEMPLATE_KEY } from '../src/text/userTemplates.js';
import { filterExpr } from '../src/fx/filters.js';
import { AUDIO_PRESETS, normalizeAudioFx } from '../src/fx/audioPresets.js';
import { TEXT_TEMPLATES } from '../src/text/catalog.js';

// In-memory storage stand-in (same getItem/setItem/removeItem shape).
const memStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

const base = (over = {}) => ({
  kind: CREATIVE_PRESET_KIND, schemaVersion: CREATIVE_PRESET_SCHEMA_VERSION,
  id: 'cp_test1', name: 'Test Look', target: 'filter', variant: 'vivid',
  params: { intensity: 80, adjust: { brightness: 10 } },
  source: 'user', createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
  ...over,
});

// ---------- schema ----------
assert.equal(validateCreativePreset(base()).ok, true, 'a well-formed v1 preset validates');
assert.equal(validateCreativePreset(base({ schemaVersion: 2 })).ok, false, 'a newer schema version is rejected, not guessed');
assert.equal(validateCreativePreset(base({ schemaVersion: 2 })).errors.join(' ').includes('newer'), true, 'newer-version error says so');
assert.equal(validateCreativePreset(base({ schemaVersion: 0 })).ok, false, 'schema version 0 is rejected');
assert.equal(validateCreativePreset(base({ kind: 'other' })).ok, false, 'wrong kind is rejected');
assert.equal(validateCreativePreset(base({ target: 'sticker' })).ok, false, 'unknown target is rejected');
assert.equal(validateCreativePreset(base({ name: '  ' })).ok, false, 'empty name is rejected');
assert.equal(validateCreativePreset(base({ variant: 'no-such-filter' })).ok, false, 'a variant naming no built-in is rejected');
assert.equal(validateCreativePreset(base({ target: 'audio', variant: null })).ok, true, 'audio allows a null variant (custom chain)');
assert.equal(validateCreativePreset(base({ target: 'caption', variant: null })).ok, true, 'caption allows a null variant (pure style)');
assert.equal(validateCreativePreset(base({ target: 'filter', variant: null })).ok, false, 'filter requires a real look id');
assert.equal(validateCreativePreset(null).ok, false, 'null is rejected');
assert.equal(validateCreativePreset('nope').ok, false, 'a string is rejected');
// Clamping, not rejection, for out-of-range numerics.
assert.equal(sanitizeCreativePreset(base({ params: { intensity: 150 } })).params.intensity, 100, 'intensity clamps to 100');
assert.equal(sanitizeCreativePreset(base({ params: { intensity: -5 } })).params.intensity, 0, 'intensity clamps to 0');
assert.equal(sanitizeCreativePreset(base({ target: 'transition', variant: 'fade', params: { duration: 9 } })).params.duration, 2, 'duration clamps to 2s');
assert.deepEqual(sanitizeCreativePreset(base({ params: { intensity: 50, bogus: 1 } })).params, { intensity: 50, adjust: {} }, 'unknown param keys are dropped');
assert.equal(sanitizeCreativePreset(base()).family, 'look', 'family derives from the target');
// newCreativePreset builds a complete preset.
const fresh = newCreativePreset({ name: 'Fresh', target: 'transition', variant: 'fade' });
assert.equal(validateCreativePreset(fresh).ok, true, 'newCreativePreset validates');
assert.equal(fresh.params.duration, 0.5, 'new transition preset defaults to 0.5s');
assert.ok(fresh.id.startsWith('cp_'), 'new preset gets a cp_ id');

// ---------- registry ----------
for (const t of ['filter', 'text', 'caption', 'audio', 'transition']) {
  assert.ok(TARGET_DEFS[t], `${t} has a registry entry`);
  assert.ok(paramDefs(t).length >= 1, `${t} exposes editable params`);
  assert.ok(defaultParams(t), `${t} has defaults`);
  assert.equal(variantExists(t, null), t === 'caption' || t === 'audio', `${t} null-variant rule`);
}
assert.equal(variantExists('filter', 'vivid'), true, 'vivid is a real filter');
assert.equal(variantExists('text', 'title-bold'), true, 'title-bold is a real text template');
assert.equal(variantExists('transition', 'fade'), true, 'fade is a real transition');
assert.equal(variantExists('audio', 'clear-voice'), true, 'clear-voice is a real audio preset');
assert.deepEqual(getParam({ audioFx: { pitch: 3 } }, 'audioFx.pitch'), 3, 'getParam reads a dotted path');
assert.deepEqual(setParam({ style: {} }, 'style.size', 42), { style: { size: 42 } }, 'setParam writes a dotted path');
assert.equal(clampParams('audio', { audioFx: { pitch: 99 } }).audioFx.pitch, 99, 'audioFx params normalize through the audio chain (pitch is unclamped there, like the inspector)');

// ---------- .json import/export round-trip ----------
const rt = parseCreativePresetFile(serializeCreativePreset(base()));
assert.equal(rt.errors.length, 0, `single-preset file parses clean (${rt.errors.join('; ')})`);
assert.deepEqual(rt.presets[0], sanitizeCreativePreset(base()), 'single-preset round-trip is exact');
const listText = serializeCreativePresets([base(), base({ id: 'cp_test2', name: 'Second', target: 'audio', variant: 'clear-voice', params: { audioFx: normalizeAudioFx(AUDIO_PRESETS.find((p) => p.id === 'clear-voice').fx) } })]);
const rtList = parseCreativePresetFile(listText);
assert.equal(rtList.presets.length, 2, 'a preset-list file parses both entries');
const bad = parseCreativePresetFile(JSON.stringify([base(), base({ id: 'cp_bad', name: 'Bad', variant: 'nope' }), { kind: 'nope' }]));
assert.equal(bad.presets.length, 1, 'import keeps the valid entries and reports the bad ones');
assert.equal(bad.errors.length, 2, 'import reports one error per bad entry');
assert.equal(parseCreativePresetFile('not json').presets.length, 0, 'invalid JSON parses to an empty list');
assert.equal(parseCreativePresetFile('not json').errors.length, 1, 'invalid JSON reports one error');

// ---------- seeds: few, real, valid ----------
const seeds = seedPresets();
assert.equal(seeds.length, 6, `6 seed presets, got ${seeds.length}`);
assert.deepEqual([...new Set(seeds.map((s) => s.target))].sort(), ['audio', 'caption', 'filter', 'text', 'transition'], 'seeds cover filter/text/caption/audio/transition');
for (const s of seeds) assert.equal(validateCreativePreset(s).ok, true, `seed ${s.id} validates`);
assert.equal(seeds.filter((s) => s.source === 'seed').length, 6, 'all seeds are source seed');
// Seed patches land on the real built-ins.
assert.deepEqual(presetClipPatch(seeds.find((s) => s.id === 'seed-vivid-pop')), { filter: 'vivid', filterIntensity: 80, adjust: {} }, 'vivid seed patch');
assert.deepEqual(presetClipPatch(seeds.find((s) => s.id === 'seed-soft-crossfade')), { transition: { type: 'fade', duration: 0.5 } }, 'crossfade seed patch');
assert.deepEqual(
  presetClipPatch(seeds.find((s) => s.id === 'seed-clear-voice')).audioFx,
  normalizeAudioFx(AUDIO_PRESETS.find((p) => p.id === 'clear-voice').fx),
  'clear-voice seed patch is the real audio preset chain',
);
assert.equal(presetTextPatch(seeds.find((s) => s.id === 'seed-big-title')).template, 'title-bold', 'big-title seed patch names its template');
assert.equal(presetTextPatch(seeds.find((s) => s.id === 'seed-essential-captions')).font, TEXT_TEMPLATES.find((t) => t.id === 'cap-classic').patch.font, 'essential-captions seed patch carries the template style');

// ---------- store: upsert/remove ----------
{
  const st = memStorage();
  let list = loadCreativePresets(st);
  assert.deepEqual(list, [], 'empty store loads empty');
  list = upsertCreativePreset(list, base());
  assert.equal(list.length, 1, 'upsert adds');
  list = upsertCreativePreset(list, base({ name: 'Renamed' }));
  assert.equal(list.length, 1, 'upsert by id replaces, not duplicates');
  assert.equal(list[0].name, 'Renamed', 'upsert replaces the content');
  list = upsertCreativePreset(list, { kind: 'nope' });
  assert.equal(list.length, 1, 'an invalid preset is not stored');
  saveCreativePresets(st, list);
  assert.equal(loadCreativePresets(st).length, 1, 'save/load round-trips');
  assert.deepEqual(removeCreativePreset(list, 'cp_test1'), [], 'remove by id empties');
}

// ---------- migration: legacy -> v1, render-identical ----------
{
  const legacyFilters = [
    { name: 'Golden Hour', filter: 'vivid', filterIntensity: 80, adjust: { brightness: 10 } },
    { name: 'Noir Night', filter: 'noir', filterIntensity: 100, adjust: {} },
    { name: 'LUT Look', filter: 'lut:amber.cube', filterIntensity: 100, adjust: {} },
  ];
  const legacyTexts = [
    { name: 'My Caps', patch: { font: 'montserrat', bold: true, color: '#ffffff', size: 64 } },
  ];
  const st = memStorage({
    [PRESET_KEY]: JSON.stringify(legacyFilters),
    [USER_TEMPLATE_KEY]: JSON.stringify(legacyTexts),
  });
  const first = migrateLegacyPresets(st);
  assert.deepEqual(first, { added: 3, skipped: 0, alreadyMigrated: false }, `migration adds 3 (LUT look excluded), got ${JSON.stringify(first)}`);
  const migrated = loadCreativePresets(st);
  assert.equal(migrated.length, 3, '3 migrated presets stored');
  assert.deepEqual(migrated.map((p) => p.source).sort(), ['legacy-filter', 'legacy-filter', 'legacy-text'], 'migration sources recorded');
  // The legacy stores are untouched: the old panels keep working.
  assert.equal(JSON.parse(st.getItem(PRESET_KEY)).length, 3, 'legacy filter store left in place');
  assert.equal(JSON.parse(st.getItem(USER_TEMPLATE_KEY)).length, 1, 'legacy text store left in place');
  const second = migrateLegacyPresets(st);
  assert.deepEqual(second, { added: 0, skipped: 0, alreadyMigrated: true }, 'a second migration adds nothing');

  // Render parity: the same base clip patched the legacy way and the
  // migrated way must be identical, AND the real render expression
  // (filterExpr — the GPU look the preview and export both draw) must
  // match exactly.
  const clip0 = { filter: 'none', filterIntensity: 100, adjust: {} };
  for (const legacy of legacyFilters.slice(0, 2)) {
    const viaLegacy = { ...clip0, ...legacyFilterPatch(legacy) };
    const mig = migrated.find((p) => p.name === legacy.name);
    assert.ok(mig, `migrated preset found for ${legacy.name}`);
    const viaMigrated = { ...clip0, ...presetClipPatch(mig) };
    assert.deepEqual(viaMigrated, viaLegacy, `${legacy.name}: migrated patch is byte-identical to the legacy patch`);
    assert.equal(filterExpr(viaMigrated), filterExpr(viaLegacy), `${legacy.name}: filterExpr identical before/after migration`);
    assert.ok(filterExpr(viaMigrated), `${legacy.name}: the migrated look actually renders a filter expression`);
  }
  // Text parity: the migrated caption patch equals the legacy template patch.
  const legacyText = legacyTexts[0];
  const migText = migrated.find((p) => p.name === 'My Caps');
  assert.deepEqual(presetTextPatch(migText), userTemplatePatch(legacyText), 'migrated caption patch equals the legacy template patch');
  // Direct converters reject what the legacy stores reject.
  assert.equal(fromLegacyFilterPreset({ name: 'LUT', filter: 'lut:x.cube' }), null, 'a LUT look does not migrate');
  assert.equal(fromLegacyTextTemplate({ name: 'Empty', patch: {} }), null, 'an empty text template does not migrate');
  // A name clash keeps the existing preset (no duplicate, no overwrite).
  const st2 = memStorage({
    [PRESET_KEY]: JSON.stringify([{ name: 'Clash', filter: 'warm', filterIntensity: 50, adjust: {} }]),
  });
  saveCreativePresets(st2, [sanitizeCreativePreset(base({ id: 'cp_kept', name: 'Clash', target: 'filter', variant: 'cool', params: { intensity: 30, adjust: {} } }))]);
  const clash = migrateLegacyPresets(st2);
  assert.deepEqual(clash, { added: 0, skipped: 1, alreadyMigrated: false }, 'a same-name preset is skipped, existing kept');
  assert.equal(loadCreativePresets(st2)[0].variant, 'cool', 'the existing preset wins the clash');
}

// ---------- capture / apply ----------
{
  const pic = { filter: 'warm', filterIntensity: 65, adjust: { brightness: 5 }, audioFx: normalizeAudioFx(AUDIO_PRESETS.find((p) => p.id === 'podcast').fx), transition: { type: 'wipeleft', duration: 0.75 } };
  const cap = capturePresetFromClip(pic, 'filter', 'Warm 65');
  assert.equal(cap?.variant, 'warm', 'capture reads the filter id');
  assert.deepEqual(presetClipPatch(cap), { filter: 'warm', filterIntensity: 65, adjust: { brightness: 5 } }, 'captured filter preset re-applies exactly');
  assert.equal(presetAppliesTo(cap), 'picture', 'filter preset applies to a picture clip');
  assert.equal(capturePresetFromClip({ filter: 'none' }, 'filter', 'Nope'), null, 'no filter means nothing to capture');
  // P2-17: a LUT look IS capturable now — the preset carries the LUT as an asset entry.
  const lutCap = capturePresetFromClip({ filter: 'lut:cf-01-teak.cube', filterIntensity: 90 }, 'filter', 'Teak LUT');
  assert.equal(lutCap?.variant, 'lut:cf-01-teak.cube', 'a LUT look captures with the LUT as its variant');
  assert.deepEqual(lutCap?.assets, [{ kind: 'lut', name: 'cf-01-teak.cube', relPath: 'luts/cf-01-teak.cube' }], 'captured LUT preset carries the LUT asset entry');
  const audioCap = capturePresetFromClip(pic, 'audio', 'Pod');
  assert.equal(audioCap?.variant, 'podcast', 'capture detects the matching audio preset');
  assert.deepEqual(presetClipPatch(audioCap).audioFx, normalizeAudioFx(pic.audioFx), 'captured audio preset re-applies exactly');
  const trCap = capturePresetFromClip(pic, 'transition', 'Wipe');
  assert.deepEqual(presetClipPatch(trCap), { transition: { type: 'wipeleft', duration: 0.75 } }, 'captured transition re-applies exactly');
  assert.equal(capturePresetFromClip({}, 'transition', 'None'), null, 'no transition means nothing to capture');
  const textClip = { text: 'Hello', template: 'title-bold', font: 'anton', size: 120, color: '#ffffff' };
  const textCap = capturePresetFromClip(textClip, 'text', 'Big');
  assert.equal(textCap?.variant, 'title-bold', 'capture reads the text template id');
  assert.equal(presetAppliesTo(textCap), 'text', 'text preset applies to a text clip');
  assert.equal(presetTextPatch(textCap).template, 'title-bold', 'captured text preset re-applies its template');
  assert.equal(presetTextPatch(textCap).size, 120, 'captured text preset keeps the edited size');
  const capClip = { text: 'hi', caption: true, source: 'srt', template: 'cap-classic', font: 'montserrat', bold: true };
  const capCap = capturePresetFromClip(capClip, 'caption', 'Caps');
  assert.equal(capCap?.variant, 'cap-classic', 'capture reads the caption template id');
  const userTplClip = { text: 'hi', caption: true, template: 'user:My Style', font: 'cairo', bold: true };
  const userCap = capturePresetFromClip(userTplClip, 'caption', 'Mine');
  assert.equal(userCap?.variant, null, 'a user-named template is not claimed as a built-in variant');
  assert.equal(userCap?.params.style.font, 'cairo', 'the style patch still carries the look');
}

console.log('creative-presets ok (schema v1 + registry + store/migration with filterExpr render parity + capture/apply + 6 seeds)');
