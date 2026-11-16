// Portable presets (P2-17): versioned files, LUT/font asset relinking with
// checksum + relative paths, migration for existing localStorage records,
// import on a clean install.
// Usage: node scripts/test-portable-presets.mjs
import assert from 'assert/strict';

const { sanitizeAsset, sanitizeAssets, sha256Hex, lutAsset, fontAsset, relinkAssets, mapResolver } = await import('../src/presets/assets.js');
const { newCreativePreset, parseCreativePresetFile, serializeCreativePresets, validateCreativePreset } = await import('../src/presets/schema.js');
const { migratePresetAssets, loadCreativePresets, saveCreativePresets } = await import('../src/presets/store.js');
const { capturePresetFromClip, presetClipPatch } = await import('../src/presets/apply.js');

const memStorage = (init = {}) => {
  const v = { ...init };
  return { getItem: (k) => v[k] ?? null, setItem: (k, val) => { v[k] = val; }, removeItem: (k) => { delete v[k]; } };
};

// --- asset sanitising: traversal / absolute paths / junk are refused --------
assert.equal(sanitizeAsset({ kind: 'lut', name: 'x.cube', relPath: '../evil.cube' }), null, 'parent traversal refused');
assert.equal(sanitizeAsset({ kind: 'lut', name: 'x.cube', relPath: '/etc/x.cube' }), null, 'absolute path refused');
assert.equal(sanitizeAsset({ kind: 'lut', name: 'x.cube', relPath: 'C:\\x.cube' }), null, 'drive path refused');
assert.equal(sanitizeAsset({ kind: 'exe', name: 'x.exe', relPath: 'x.exe' }), null, 'executable kind refused');
assert.equal(sanitizeAsset({ kind: 'lut', name: 'a/b.cube', relPath: 'luts/a.cube' }), null, 'name with a slash refused');
assert.deepEqual(sanitizeAsset({ kind: 'lut', name: 'cf-01-teak.cube', relPath: 'luts/cf-01-teak.cube', sha256: 'zz' }),
  { kind: 'lut', name: 'cf-01-teak.cube', relPath: 'luts/cf-01-teak.cube' }, 'a malformed checksum is dropped, not kept');
assert.equal(sanitizeAssets([{ kind: 'lut', name: 'a.cube', relPath: 'luts/a.cube' }, { kind: 'lut', name: 'a.cube', relPath: 'luts/a.cube' }]).length, 1, 'duplicate asset entries collapse');
assert.equal(lutAsset('cf-01-teak.cube')?.relPath, 'luts/cf-01-teak.cube', 'LUT asset is pack-relative');
assert.equal(fontAsset('cairo')?.kind, 'font', 'font asset by family name');
assert.equal(fontAsset(''), null, 'empty font has no asset');

// --- checksum: known vector, and a mismatch is a missing asset ------------
const helloHash = await sha256Hex('hello');
assert.equal(helloHash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', 'SHA-256 of "hello" matches the known vector');
{
  const good = { kind: 'lut', name: 'a.cube', relPath: 'luts/a.cube', sha256: helloHash };
  const r1 = await relinkAssets([good], mapResolver({ 'luts/a.cube': { path: '/packs/luts/a.cube', sha256: helloHash } }));
  assert.equal(r1.resolved.length, 1, 'matching checksum resolves');
  assert.equal(r1.missing.length, 0, 'nothing missing on a match');
  const r2 = await relinkAssets([good], mapResolver({ 'luts/a.cube': { path: '/packs/luts/a.cube', sha256: '0'.repeat(64) } }));
  assert.equal(r2.missing.length, 1, 'a checksum mismatch is reported missing, never silently substituted');
  assert.equal(r2.resolved.length, 0, 'mismatched asset does not resolve');
  const r3 = await relinkAssets([good], mapResolver({}));
  assert.equal(r3.missing.length, 1, 'an absent file is missing');
  const r4 = await relinkAssets([{ kind: 'lut', name: 'a.cube', relPath: 'luts/a.cube', sha256: helloHash }], mapResolver({ 'luts/a.cube': { path: '/packs/luts/a.cube' } }));
  assert.equal(r4.unverified.length, 1, 'a file without a checksum to compare is unverified, not missing');
  assert.equal(r4.resolved.length, 1, 'unverified still resolves (the user sees the warning)');
}

// --- versioned file round-trip keeps assets --------------------------------
{
  const lut = capturePresetFromClip({ filter: 'lut:cf-01-teak.cube', filterIntensity: 90 }, 'filter', 'Teak 90');
  const cap = capturePresetFromClip({ text: 'hi', caption: true, template: 'cap-classic', font: 'cairo', bold: true }, 'caption', 'Cairo Caps');
  assert.ok(lut && cap, 'both presets capture');
  assert.equal(cap.assets?.[0]?.name, 'cairo', 'caption preset carries its font asset');
  const file = serializeCreativePresets([lut, cap]);
  const { presets, errors } = parseCreativePresetFile(file);
  assert.deepEqual(errors, [], 'versioned file parses clean');
  assert.equal(presets.length, 2, 'both presets survive the file round-trip');
  assert.deepEqual(presets[0].assets, lut.assets, 'LUT asset survives the file round-trip');
  assert.deepEqual(presets[1].assets, cap.assets, 'font asset survives the file round-trip');
  assert.deepEqual(presetClipPatch(presets[0]), { filter: 'lut:cf-01-teak.cube', filterIntensity: 90, adjust: {} }, 'LUT preset re-applies after the round-trip');
  const bad = parseCreativePresetFile(JSON.stringify({ ...lut, schemaVersion: 99 }));
  assert.equal(bad.presets.length, 0, 'a newer schema version is rejected, never guessed');
  assert.ok(bad.errors.length, 'the rejection is reported');
}

// --- migration enriches pre-asset v1 records -------------------------------
{
  const st = memStorage();
  const old = newCreativePreset({ name: 'Old Teak', target: 'filter', variant: 'lut:cf-01-teak.cube', params: { intensity: 80, adjust: {} } });
  delete old.assets; // simulate a record saved before P2-17
  const oldCap = newCreativePreset({ name: 'Old Caps', target: 'caption', variant: null, params: { style: { font: 'tajawal' } } });
  delete oldCap.assets;
  saveCreativePresets(st, [old, oldCap]);
  assert.equal(migratePresetAssets(st), 2, 'both pre-asset records gain their assets');
  const after = loadCreativePresets(st);
  assert.equal(after[0].assets[0].name, 'cf-01-teak.cube', 'LUT asset derived from the variant');
  assert.equal(after[1].assets[0].name, 'tajawal', 'font asset derived from the style');
  assert.equal(migratePresetAssets(st), 0, 'migration is idempotent');
}

// --- import on a clean install ----------------------------------------------
{
  const st = memStorage(); // nothing stored: a clean install
  const lut = capturePresetFromClip({ filter: 'lut:cf-02-glacier.cube', filterIntensity: 70 }, 'filter', 'Glacier 70');
  const { presets } = parseCreativePresetFile(serializeCreativePresets([lut]));
  assert.equal(loadCreativePresets(st).length, 0, 'clean install starts empty');
  saveCreativePresets(st, presets);
  const imported = loadCreativePresets(st);
  assert.equal(imported.length, 1, 'one preset imports on a clean install');
  assert.equal(imported[0].assets[0].relPath, 'luts/cf-02-glacier.cube', 'its asset manifest arrives with it');
  const { missing } = await relinkAssets(imported[0].assets, mapResolver({ 'luts/cf-02-glacier.cube': { path: '/app/luts/cf-02-glacier.cube' } }));
  assert.equal(missing.length, 0, 'the bundled LUT relinks on the new machine');
  assert.equal(validateCreativePreset(imported[0]).ok, true, 'imported preset validates');
}

console.log('PORTABLE-PRESETS OK');
