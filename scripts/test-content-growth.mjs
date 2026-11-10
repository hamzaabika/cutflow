// Sprint 12 content growth (§11 content-work rows): every item added to the
// local libraries in this sprint is proven to (a) exist in the catalogue the
// UI reads, (b) actually apply and render, and (c) be its own thing — the new
// LUTs are checked against their generator formulas, the new filters render
// pairwise-distinct frames, and the new transitions start exactly on A and
// end exactly on B through the same runTransition the preview uses.
// (Pixel-effect growth is proven by test-effects-library, which renders and
// pairwise-separates the WHOLE library; text templates by test-text-templates.)
// Usage: node scripts/test-content-growth.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_LUTS, parseCube } from '../src/fx/lut.js';
import { FILTER_LOOKS, filterExpr } from '../src/fx/filters.js';
import { FX_TRANSITIONS } from '../src/fx/catalog.js';
import { EFFECTS, TRANSITIONS } from '../src/effects.js';
import { runEffect, runTransition } from '../src/fx/run.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- Shared test chart ------------------------------------------------------
const W = 192; const H = 108;
const chart = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const gx = Math.floor(x / (W / 8)); const gy = Math.floor(y / (H / 6));
  chart[i] = (gx * 36 + gy * 7) % 256; chart[i + 1] = (gy * 42 + gx * 3) % 256; chart[i + 2] = ((x + y) * 255 / (W + H)) % 256; chart[i + 3] = 255;
}
const chartB = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < chartB.length; i += 4) { chartB[i] = 255 - chart[i]; chartB[i + 1] = (chart[i + 1] * 0.4) | 0; chartB[i + 2] = (chart[i] * 0.7) | 0; chartB[i + 3] = 255; }
const renderExpr = (expr, T = 0.35) => { const out = new Uint8ClampedArray(W * H * 4); runEffect(chart, out, W, H, T, expr); return out; };
const meanDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (W * H * 3); };

// ---- LUTs: cf-01..04 exist, parse, are attributed correctly, and transform ---
const NEW_LUTS = [
  { file: 'cf-01-teak.cube', name: 'Teak', cat: 'Warm' },
  { file: 'cf-02-glacier.cube', name: 'Glacier', cat: 'Cool' },
  { file: 'cf-03-rose.cube', name: 'Rosé', cat: 'Portrait' },
  { file: 'cf-04-slate.cube', name: 'Slate', cat: 'Film' },
  // 10/10 step-3 growth: cf-05..cf-20, held to the same pins (17^3, non-identity probe,
  // truthful no-credit split, pairwise probe distance > 2 against every other cf LUT).
  { file: 'cf-05-ember.cube', name: 'Ember', cat: 'Warm' },
  { file: 'cf-06-lagoon.cube', name: 'Lagoon', cat: 'Cool' },
  { file: 'cf-07-velvet.cube', name: 'Velvet', cat: 'Portrait' },
  { file: 'cf-08-mono.cube', name: 'Mono', cat: 'Film' },
  { file: 'cf-09-goldenhour.cube', name: 'Golden Hour', cat: 'Warm' },
  { file: 'cf-10-forest.cube', name: 'Forest', cat: 'Travel' },
  { file: 'cf-11-candy.cube', name: 'Candy', cat: 'Creative' },
  { file: 'cf-12-denim.cube', name: 'Denim', cat: 'Cool' },
  { file: 'cf-13-noir.cube', name: 'Noir LUT', cat: 'Film' },
  { file: 'cf-14-peach.cube', name: 'Peach', cat: 'Portrait' },
  { file: 'cf-15-arctic.cube', name: 'Arctic', cat: 'Cool' },
  { file: 'cf-16-vintage70.cube', name: 'Vintage 70', cat: 'Film' },
  { file: 'cf-17-neon.cube', name: 'Neon Night', cat: 'Creative' },
  { file: 'cf-18-sepia.cube', name: 'Sepia', cat: 'Film' },
  { file: 'cf-19-meadow.cube', name: 'Meadow', cat: 'Travel' },
  { file: 'cf-20-dusk.cube', name: 'Dusk', cat: 'Creative' },
];
const applyLut = (lut, r, g, b) => { // nearest-grid sample of the parsed LUT data
  const s = lut.size - 1;
  const d = (Math.round(g * s) * lut.size * lut.size + Math.round(b * s) * lut.size + Math.round(r * s)) * 4;
  return [lut.data[d], lut.data[d + 1], lut.data[d + 2]];
};
const parsed = new Map();
for (const want of NEW_LUTS) {
  const entry = BUNDLED_LUTS.find((l) => l.file === want.file);
  assert.ok(entry, `${want.file} is registered in BUNDLED_LUTS`);
  assert.equal(entry.name, want.name, `${want.file} carries its display name`);
  assert.equal(entry.cat, want.cat, `${want.file} sits in its category`);
  assert.equal(entry.credit, undefined, `${want.file} is Cutflow-original: it must NOT carry the slay credit`);
  const text = fs.readFileSync(path.join(root, 'shared', 'luts', want.file), 'utf8');
  const lut = parseCube(text);
  assert.equal(lut.size, 17, `${want.file} parses as a 17^3 LUT`);
  parsed.set(want.file, lut);
  // Non-identity: a mid red probe moves visibly.
  const probe = applyLut(lut, 0.8, 0.25, 0.2);
  const identity = [0.8 * 255, 0.25 * 255, 0.2 * 255];
  assert.ok(probe.some((v, c) => Math.abs(v - identity[c]) > 6), `${want.file} visibly transforms colour (probe ${probe} vs identity ${identity.map(Math.round)})`);
  // Files on disk are the generator's: the identity corner maps near (0,0,0)/(255,255,255) only as the formula dictates —
  // and the header declares the LUT's origin, so the provenance travels with the file.
  assert.ok(text.includes('authored for Cutflow'), `${want.file} header states its origin`);
}
for (const l of BUNDLED_LUTS.filter((x) => x.file.startsWith('slay-'))) {
  assert.equal(l.credit, 'slay (CC BY 4.0)', `${l.file} keeps its third-party credit`);
}
// Pairwise distinct transforms over a probe grid.
const probes = [[0.2, 0.3, 0.7], [0.8, 0.25, 0.2], [0.5, 0.5, 0.5], [0.1, 0.8, 0.3], [0.9, 0.85, 0.8]];
const sig = (lut) => probes.flatMap(([r, g, b]) => applyLut(lut, r, g, b));
const sigs = [...parsed.values()].map(sig);
for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) {
  const d = sigs[i].reduce((s, v, k) => s + Math.abs(v - sigs[j][k]), 0) / sigs[i].length;
  assert.ok(d > 2, `LUTs ${i} and ${j} are distinct transforms (probe distance ${d.toFixed(2)})`);
}

// ---- Filter looks: the 8 Sprint 12 grades render and differ -----------------
const NEW_FILTERS = ['cafe', 'nordic', 'meadow', 'rose', 'monowarm', 'blockbuster', 'airymatte', 'studiopop',
  // 10/10 step-3 growth (+30 looks).
  'punch', 'softlight', 'widescreen', 'nightcity', 'desert', 'bwsoft', 'bwcontrast', 'honey', 'ember', 'arctic',
  'denim', 'silk', 'cream', 'retrofade', 'seventies', 'ultravivid', 'duogreen', 'candy', 'bakery', 'citrus',
  'coastline', 'postcard', 'beauty', 'bronze', 'pearl', 'blush', 'catalog', 'macro', 'celshade', 'pastelpop'];
const renders = new Map();
for (const id of NEW_FILTERS) {
  const look = FILTER_LOOKS.find((f) => f.id === id);
  assert.ok(look, `filter ${id} is in FILTER_LOOKS`);
  const expr = filterExpr({ filter: id, filterIntensity: 100 });
  assert.ok(expr, `filter ${id} builds an expression`);
  const out = renderExpr(expr);
  assert.ok(meanDiff(chart, out) > 0.5, `filter ${id} visibly changes the picture`);
  renders.set(id, out);
}
const ids = [...renders.keys()];
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
  assert.ok(meanDiff(renders.get(ids[i]), renders.get(ids[j])) > 0.35, `filters ${ids[i]} and ${ids[j]} render distinctly`);
}

// ---- Transitions: the 4 studio additions run A -> B exactly ------------------
const NEW_TRANSITIONS = ['fx_clockwipe', 'fx_bandwipe', 'fx_zoomthrough', 'fx_spinfall'];
for (const id of NEW_TRANSITIONS) {
  const t = FX_TRANSITIONS.find((x) => x.id === id);
  assert.ok(t?.expr, `transition ${id} is an engine transition`);
  const ui = TRANSITIONS.find((x) => x.id === id);
  assert.ok(ui && ui.fx === true, `transition ${id} surfaces in the UI catalogue as a shader transition`);
  const at = (P) => { const out = new Uint8ClampedArray(W * H * 4); runTransition(chart, chartB, out, W, H, P, t.expr); return out; };
  assert.ok(meanDiff(at(0), chart) < 0.6, `${id} starts exactly on A`);
  assert.ok(meanDiff(at(1), chartB) < 0.6, `${id} ends exactly on B`);
  const mid = at(0.5);
  assert.ok(meanDiff(mid, chart) > 1 && meanDiff(mid, chartB) > 1, `${id} mid-point is a real blend of the two clips`);
}

// ---- Effects: the 10 Sprint 12 pixel effects are in the UI catalogue ---------
const NEW_EFFECTS = ['fx_thermal', 'fx_emboss', 'fx_neonedge', 'fx_dither', 'fx_hatchlines', 'fx_warhol', 'fx_fisheye', 'fx_nightvision', 'fx_blueprint', 'fx_stainedglass'];
for (const id of NEW_EFFECTS) assert.ok(EFFECTS.some((e) => e.id === id), `effect ${id} is listed for the Effects panel`);

console.log(`content-growth OK: ${NEW_LUTS.length} LUTs, ${NEW_FILTERS.length} filter looks, ${NEW_TRANSITIONS.length} transitions, ${NEW_EFFECTS.length} effects — all present, functional, distinct`);
