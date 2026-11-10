// Generated library stills (10/10 step 5): every pixel effect, transition,
// filter look and bundled LUT the grids can show has a real rendered still on
// disk, produced by scripts/gen-fx-thumbs.mjs from the app's own CPU reference
// renderer — and the renderer wiring uses the stills (no glyph placeholders).
// Overlay effects are the documented exception: their tile is the live canvas.
// Usage: node scripts/test-fx-thumbs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FX_THUMB } from '../src/fx/thumbIndex.js';
import { PIXEL_EFFECTS, OVERLAY_EFFECTS, FX_TRANSITIONS } from '../src/fx/catalog.js';
import { EFFECTS, TRANSITIONS, FILTERS } from '../src/effects.js';
import { BUNDLED_LUTS } from '../src/fx/lut.js';

const root = path.join(import.meta.dirname, '..');
const keys = Object.keys(FX_THUMB);

const checkFile = (key) => {
  const rel = FX_THUMB[key];
  assert.ok(rel?.startsWith('./fxthumbs/'), `${key} points into public/fxthumbs (${rel})`);
  const file = path.join(root, 'public', rel.replace('./', ''));
  assert.ok(fs.existsSync(file), `${key}: still file exists (${rel})`);
  const buf = fs.readFileSync(file);
  assert.ok(buf.length > 250 && buf.length < 90000, `${key}: still is a compact JPEG (${buf.length} B)`);
  assert.equal(buf[0], 0xff, `${key}: JPEG magic (start)`);
  assert.equal(buf[1], 0xd8, `${key}: JPEG magic (SOI)`);
  assert.notEqual(buf.subarray(100, 200).toString('latin1'), buf.subarray(300, 400).toString('latin1'), `${key}: still carries real picture data, not a flat fill`);
};

// Effects: every catalogue effect that is not an overlay has a still; the six
// basics (mirror/flipv/blur/pixel/vignette/grain) included.
const overlayIds = new Set(OVERLAY_EFFECTS.map((e) => e.id));
for (const e of EFFECTS) {
  if (overlayIds.has(e.id)) {
    assert.ok(!(`effect:${e.id}` in FX_THUMB), `overlay effect ${e.id} has NO generated still (live canvas by design)`);
  } else {
    assert.ok(`effect:${e.id}` in FX_THUMB, `effect ${e.id} has a generated still`);
    checkFile(`effect:${e.id}`);
  }
}
assert.equal(keys.filter((k) => k.startsWith('effect:')).length, EFFECTS.length - OVERLAY_EFFECTS.length,
  `effect stills cover all ${EFFECTS.length - OVERLAY_EFFECTS.length} non-overlay effects`);
assert.equal(PIXEL_EFFECTS.length + 6, EFFECTS.length - OVERLAY_EFFECTS.length, 'pixel + 6 basics account for the non-overlay set');

// Transitions: engine + classic, the full TRANSITIONS list.
for (const t of TRANSITIONS) {
  assert.ok(`transition:${t.id}` in FX_THUMB, `transition ${t.id} has a generated still`);
  checkFile(`transition:${t.id}`);
}
assert.ok(FX_TRANSITIONS.length < TRANSITIONS.length, 'classic transitions exist beyond the engine set and are covered too');

// Filters: every look incl. 'none' (the plain frame).
for (const f of FILTERS) {
  assert.ok(`filter:${f.id}` in FX_THUMB, `filter ${f.id} has a generated still`);
  checkFile(`filter:${f.id}`);
}

// Bundled LUTs: one still per shipped .cube.
for (const l of BUNDLED_LUTS) {
  assert.ok(`lut:${l.file}` in FX_THUMB, `LUT ${l.file} has a generated still`);
  checkFile(`lut:${l.file}`);
}

// No orphan stills: every manifest entry is a known catalogue item.
const known = new Set([
  ...EFFECTS.filter((e) => !overlayIds.has(e.id)).map((e) => `effect:${e.id}`),
  ...TRANSITIONS.map((t) => `transition:${t.id}`),
  ...FILTERS.map((f) => `filter:${f.id}`),
  ...BUNDLED_LUTS.map((l) => `lut:${l.file}`),
]);
for (const k of keys) assert.ok(known.has(k), `manifest entry ${k} belongs to the catalogues`);

// The files on disk and the manifest agree (no stale stills left behind).
const onDisk = fs.readdirSync(path.join(root, 'public', 'fxthumbs')).filter((f) => f.endsWith('.jpg'));
assert.equal(onDisk.length, keys.length, `public/fxthumbs holds exactly the ${keys.length} manifest stills`);

// Wiring: the tile components read the index.
const previews = fs.readFileSync(path.join(root, 'src/fx/previews.jsx'), 'utf8');
assert.ok(previews.includes("from './thumbIndex.js'") && previews.includes('FX_THUMB'), 'FxThumb paints the generated still at rest');
const filterThumbs = fs.readFileSync(path.join(root, 'src/components/FilterThumbs.jsx'), 'utf8');
assert.ok(filterThumbs.includes('FX_THUMB'), 'LookThumb paints the generated still for bundled filters/LUTs');

const total = keys.reduce((a, k) => a + fs.statSync(path.join(root, 'public', FX_THUMB[k].replace('./', ''))).size, 0);
console.log(`fx-thumbs ok: ${keys.length} stills (${EFFECTS.length - OVERLAY_EFFECTS.length} effects, ${TRANSITIONS.length} transitions, ${FILTERS.length} filters, ${BUNDLED_LUTS.length} LUTs), ${(total / 1024).toFixed(0)} KB — all real renders on disk, wiring live`);
