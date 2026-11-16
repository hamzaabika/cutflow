// Brand kit + preset portability (P2-40): versioned brand pack with
// font/colour/logo/intro-outro references that relink on a clean install.
// Usage: node scripts/test-brand-pack.mjs
import assert from 'assert/strict';

const { emptyBrand, sanitizeBrand, loadBrand, saveBrand, serializeBrandPack, parseBrandPack, relinkBrandPack, brandPackAssets } = await import('../src/brand.js');
const { sha256Hex } = await import('../src/presets/assets.js');
const { mapResolver } = await import('../src/presets/assets.js');

const memStorage = (init = {}) => {
  const v = { ...init };
  return { getItem: (k) => v[k] ?? null, setItem: (k, val) => { v[k] = val; }, removeItem: (k) => { delete v[k]; } };
};

// --- intro / outro references are part of the kit ---------------------------
const kit = {
  logos: [{ path: '/brand/logo.png', name: 'logo.png' }],
  colors: ['#825cfb', '#ffffff'], font: 'cairo', color: '#825cfb',
  intro: { path: '/brand/intro.mp4', name: 'intro.mp4', duration: 2.5 },
  outro: { path: '/brand/outro.mp4', name: 'outro.mp4' },
};
const clean = sanitizeBrand(kit);
assert.deepEqual(clean.intro, { path: '/brand/intro.mp4', name: 'intro.mp4', duration: 2.5 }, 'intro keeps path, name and duration');
assert.deepEqual(clean.outro, { path: '/brand/outro.mp4', name: 'outro.mp4' }, 'outro keeps path and name');
assert.equal(sanitizeBrand({ intro: { name: 'no path' } }).intro, null, 'an intro without a path is dropped');
assert.deepEqual(emptyBrand(), { logos: [], colors: [], font: '', color: '', intro: null, outro: null }, 'empty kit has null intro/outro');

// --- the pack: versioned file with an asset manifest -------------------------
const logoHash = await sha256Hex('logo-bytes');
const hashes = { '/brand/logo.png': logoHash };
const file = serializeBrandPack(kit, hashes);
const parsed = JSON.parse(file);
assert.equal(parsed.kind, 'cutflow.brand-pack', 'pack kind is versioned');
assert.equal(parsed.schemaVersion, 1, 'pack schema version is 1');
assert.deepEqual(parsed.assets.map((a) => a.relPath).sort(),
  ['fonts/cairo.ttf', 'intro/intro.mp4', 'logos/logo.png', 'outro/outro.mp4'], 'manifest lists logos, intro, outro and font by relative path');
assert.equal(parsed.assets.find((a) => a.relPath === 'logos/logo.png').sha256, logoHash, 'logo carries its checksum');
const { brand, assets, errors } = parseBrandPack(file);
assert.deepEqual(errors, [], 'pack parses clean');
assert.deepEqual(brand, clean, 'parsed brand equals the sanitized kit');
assert.equal(assets.length, 4, 'manifest survives the round-trip');
assert.deepEqual(parseBrandPack(JSON.stringify({ ...parsed, schemaVersion: 99 })).errors.length > 0, true, 'a newer pack version is rejected');
assert.ok(parseBrandPack('{broken').errors.length, 'broken JSON is reported, never thrown');

// --- relinking on a clean install --------------------------------------------
{
  // The new machine has the logo (same checksum) and the font, but not the
  // intro/outro files.
  const resolver = mapResolver({
    'logos/logo.png': { path: '/new/logo.png', sha256: logoHash },
    'fonts/cairo.ttf': { path: 'font:cairo' },
  });
  const { brand: relinked, missing, unverified } = await relinkBrandPack({ brand, assets }, resolver);
  assert.equal(relinked.logos[0].path, '/new/logo.png', 'logo relinks to the new machine path');
  assert.equal(relinked.font, 'cairo', 'font survives by family name');
  assert.deepEqual(missing.map((a) => a.relPath).sort(), ['intro/intro.mp4', 'outro/outro.mp4'], 'intro/outro are reported missing, never substituted');
  assert.deepEqual(unverified, [], 'nothing unverified when checksums are present');
  assert.equal(relinked.intro.path, '/brand/intro.mp4', 'a missing intro keeps its recorded path for repair');
}
{
  // A checksum mismatch is missing too.
  const { missing } = await relinkBrandPack({ brand, assets }, mapResolver({
    'logos/logo.png': { path: '/new/logo.png', sha256: '0'.repeat(64) },
  }));
  assert.ok(missing.some((a) => a.relPath === 'logos/logo.png'), 'a logo with the wrong checksum does not relink');
}
{
  // Clean-install import end to end: parse the pack, relink, save, reload.
  const st = memStorage();
  assert.deepEqual(loadBrand(st), emptyBrand(), 'clean install starts with an empty kit');
  const { brand: b2, assets: a2 } = parseBrandPack(file);
  const { brand: relinked } = await relinkBrandPack({ brand: b2, assets: a2 }, mapResolver({
    'logos/logo.png': { path: '/new/logo.png', sha256: logoHash },
    'intro/intro.mp4': { path: '/new/intro.mp4' },
    'outro/outro.mp4': { path: '/new/outro.mp4' },
    'fonts/cairo.ttf': { path: 'font:cairo' },
  }));
  saveBrand(st, relinked);
  const loaded = loadBrand(st);
  assert.equal(loaded.logos[0].path, '/new/logo.png', 'imported kit persists with the relinked logo path');
  assert.equal(loaded.intro.path, '/new/intro.mp4', 'imported kit persists with the relinked intro');
  assert.equal(loaded.outro.path, '/new/outro.mp4', 'imported kit persists with the relinked outro');
  assert.equal(loaded.font, 'cairo', 'imported kit persists with the font');
  assert.deepEqual(loaded.colors, ['#825cfb', '#ffffff'], 'imported kit persists with the palette');
  assert.deepEqual(brandPackAssets(loaded), brandPackAssets(relinked), 're-exporting the imported kit gives the same manifest');
}

console.log('BRAND-PACK OK');
