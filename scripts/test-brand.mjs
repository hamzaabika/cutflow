// Brand kit registry: pure store logic (sanitize/persist/defaults patch),
// following the test-user-templates.mjs pattern. Usage: node scripts/test-brand.mjs
import assert from 'assert/strict';
import {
  BRAND_KEY, brandTextPatch, emptyBrand, hasBrand, loadBrand, sanitizeBrand,
  sanitizeColor, saveBrand,
} from '../src/brand.js';

const store = { v: {}, getItem(k) { return this.v[k] ?? null; }, setItem(k, val) { this.v[k] = val; }, removeItem(k) { delete this.v[k]; } };

// Sanitising colours: 3-digit hex expands, case normalises, junk is refused.
assert.equal(sanitizeColor('#ABC'), '#aabbcc');
assert.equal(sanitizeColor('#825CFB'), '#825cfb');
assert.equal(sanitizeColor('red'), null);
assert.equal(sanitizeColor('#12345'), null);
assert.equal(sanitizeColor(42), null);

// Sanitising the kit: logos need a path, dupes (by path / by colour) collapse,
// names fall back to the file's basename, and a primary colour that is not in
// the palette does not survive.
const dirty = {
  logos: [
    { path: '/brand/logo.png', name: 'Logo' },
    { path: '/brand/logo.png', name: 'Dupe' },
    { path: 'C:\\brand\\mark.webp' },
    { name: 'no path' },
    'junk',
  ],
  colors: ['#FFF', '#ffffff', '#825cfb', 'nope'],
  font: 'poppins',
  color: '#123456',
};
const clean = sanitizeBrand(dirty);
assert.deepEqual(clean.logos, [
  { path: '/brand/logo.png', name: 'Logo' },
  { path: 'C:\\brand\\mark.webp', name: 'mark.webp' },
]);
assert.deepEqual(clean.colors, ['#ffffff', '#825cfb']);
assert.equal(clean.font, 'poppins');
assert.equal(clean.color, '', 'a primary colour outside the palette is dropped');
assert.equal(sanitizeBrand({ ...dirty, color: '#FFF' }).color, '#ffffff', 'a palette colour survives as primary');
assert.deepEqual(sanitizeBrand(null), emptyBrand());
assert.deepEqual(sanitizeBrand('junk'), emptyBrand());

// Persistence round-trip through the injected storage.
assert.deepEqual(loadBrand(store), emptyBrand());
const kit = { logos: [{ path: '/b/l.png', name: 'l.png' }], colors: ['#825cfb'], font: 'anton', color: '#825cfb' };
saveBrand(store, kit);
assert.deepEqual(loadBrand(store), kit);
assert.ok(store.v[BRAND_KEY].includes('/b/l.png'));
store.v[BRAND_KEY] = '{broken json';
assert.deepEqual(loadBrand(store), emptyBrand(), 'a torn settings value falls back to the empty kit');

// The text patch: only set keys contribute, and an empty kit changes nothing —
// the pre-kit behaviour of the add-text paths.
assert.deepEqual(brandTextPatch(emptyBrand()), {});
assert.deepEqual(brandTextPatch({ logos: [], colors: [], font: 'anton', color: '' }), { font: 'anton' });
assert.deepEqual(brandTextPatch({ logos: [], colors: ['#ffffff'], font: '', color: '#ffffff' }), { color: '#ffffff' });
assert.deepEqual(brandTextPatch(kit), { font: 'anton', color: '#825cfb' });

// hasBrand drives nothing but honesty checks in the UI; pin its edges.
assert.equal(hasBrand(emptyBrand()), false);
assert.equal(hasBrand({ logos: [{ path: '/x.png' }], colors: [], font: '', color: '' }), true);
assert.equal(hasBrand({ logos: [], colors: ['#000000'], font: '', color: '' }), true);

console.log('BRAND OK');
