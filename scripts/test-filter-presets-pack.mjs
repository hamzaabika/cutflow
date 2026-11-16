// B-F10 — filter looks on portable versioned packs (.cutflowpack v1):
// a filter-target CreativePreset converts to a pack 'filter' preset (with
// its LUT as a hash-checked pack asset), and back; a pack that dangles a
// LUT reference fails validation, so a look that cannot render never ships.
// Usage: node scripts/test-filter-presets-pack.mjs
import assert from 'node:assert/strict';
import { validatePack, validatePreset, buildManifest } from '../src/packs.js';
import { newCreativePreset } from '../src/presets/schema.js';
import { sha256Hex } from '../src/presets/assets.js';
import {
  creativePresetToPackPreset, packPresetToCreativePreset,
  collectFilterPackAssets, exportFilterPresetsToPack, importFilterPresetsFromPack,
} from '../src/presets/packBridge.js';

const look = newCreativePreset({ name: 'Teak 90', target: 'filter', variant: 'lut:cf-01-teak.cube', params: { intensity: 90, adjust: {} } });
const plain = newCreativePreset({ name: 'Vivid', target: 'filter', variant: 'vivid', params: { intensity: 80, adjust: { saturation: 1.2 } } });
assert.ok(look && plain, 'filter CreativePresets build');

// --- pack kind validation -------------------------------------------------
assert.equal(validatePreset({ kind: 'filter', id: 'teak-90', name: 'Teak 90', data: { variant: 'lut:cf-01-teak.cube', intensity: 90, adjust: {} } }, 0), null, 'filter preset validates');
assert.match(validatePreset({ kind: 'filter', id: 'x', name: 'X', data: {} }, 0), /variant/, 'filter preset without a variant is rejected');
assert.match(validatePreset({ kind: 'filter', id: 'x', name: 'X', data: { variant: 'vivid', intensity: 140 } }, 0), /intensity/, 'intensity over 100 is rejected');

// --- a dangling LUT ref fails the whole pack ------------------------------
const dangling = buildManifest({ name: 'Dangling', presets: [{ kind: 'filter', id: 'teak-90', name: 'Teak 90', data: { variant: 'lut:cf-01-teak.cube', lut: 'cf-01-teak.cube' } }], assets: [] });
const dv = validatePack(dangling);
assert.equal(dv.ok, false, 'pack with a LUT ref but no asset fails validation');
assert.ok(dv.errors.some((e) => e.includes('cf-01-teak.cube')), 'the error names the missing LUT asset');

// --- round-trip: preset -> pack -> preset ---------------------------------
const cubeText = '# test cube\nLUT_3D_SIZE 2\n0.0 0.0 0.0\n';
const fakeReadLut = async ({ bundled }) => (bundled === 'cf-01-teak.cube' ? { text: cubeText } : { error: 'No LUT' });
const { assets, skipped } = await collectFilterPackAssets([look, plain], fakeReadLut, sha256Hex);
assert.equal(skipped.length, 0, 'bundled LUT reads fine');
assert.equal(assets.length, 1, 'one LUT asset collected for the LUT look only');
assert.equal(assets[0].name, 'cf-01-teak.cube', 'asset is named for its .cube file');
assert.equal(assets[0].sha256, await sha256Hex(new TextEncoder().encode(cubeText)), 'asset hash matches the bytes');
assert.equal(Buffer.from(assets[0].data, 'base64').toString('utf8'), cubeText, 'inline base64 decodes back to the .cube text');

const blobs = Object.fromEntries(assets.map((a) => [a.name, { sha256: a.sha256, size: a.size, data: a.data }]));
const { manifest, skipped: skipped2 } = exportFilterPresetsToPack([look, plain], { name: 'Looks', assetBlobs: blobs });
assert.equal(skipped2.length, 0, 'nothing skipped when the LUT bytes are supplied');
assert.equal(validatePack(manifest).ok, true, 'exported pack validates');
assert.equal(manifest.presets.length, 2, 'both looks are in the pack');
assert.equal(manifest.assets.length, 1, 'the LUT rides as one pack asset');

const back = importFilterPresetsFromPack(manifest);
assert.equal(back.errors.length, 0, 'import converts without errors');
assert.equal(back.presets.length, 2, 'both looks come back');
const backLut = back.presets.find((p) => p.name === 'Teak 90');
assert.equal(backLut.variant, 'lut:cf-01-teak.cube', 'LUT variant survives the round-trip');
assert.equal(backLut.params.intensity, 90, 'intensity survives the round-trip');
assert.equal(backLut.assets?.[0]?.name, 'cf-01-teak.cube', 'LUT asset entry survives the round-trip');
const backPlain = back.presets.find((p) => p.name === 'Vivid');
assert.equal(backPlain.params.adjust.saturation, 1.2, 'adjust params survive the round-trip');

// --- export without the LUT bytes skips the look, keeps the pack valid ---
const { manifest: m2, skipped: s2 } = exportFilterPresetsToPack([look, plain], { name: 'Looks' });
assert.deepEqual(s2, ['Teak 90'], 'the LUT look is skipped when its bytes are missing');
assert.equal(m2.presets.length, 1, 'the plain look still exports');
assert.equal(validatePack(m2).ok, true, 'the partial pack still validates');

// --- unreadable LUT on collect -------------------------------------------
const { skipped: s3 } = await collectFilterPackAssets([look], async () => ({ error: 'gone' }), sha256Hex);
assert.deepEqual(s3, ['Teak 90'], 'an unreadable LUT is reported skipped, never exported dangling');

// --- non-filter presets do not convert ------------------------------------
assert.equal(creativePresetToPackPreset(newCreativePreset({ name: 'T', target: 'text', variant: null })), null, 'a text preset is not a filter pack preset');
assert.equal(packPresetToCreativePreset({ kind: 'text', id: 't', name: 'T', data: {} }), null, 'a text pack preset is not a filter look');
assert.equal(importFilterPresetsFromPack({ format: 'nope' }).presets.length, 0, 'an invalid manifest converts nothing');

console.log('filter-presets-pack: all checks passed');
