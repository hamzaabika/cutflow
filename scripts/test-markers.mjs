// Coloured markers + bulk delete (10/10 step 5, closing the parity row):
// a marker carries a palette colour through add / chapters-bulk-add / load
// normalisation, colour changes are palette-validated, and markers can be
// removed in bulk — all of them, or the ones inside a time range (the
// selected clip's span in the UI) — each as one undo step.
// Usage: node scripts/test-markers.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MARKER_COLORS, historyReducer, markerColorHex, markerColorId, normalizeProject } from '../src/store.js';

const fresh = () => ({ past: [], present: normalizeProject({}), future: [] });
const run = (st, ...actions) => actions.reduce(historyReducer, st);

// Palette sanity: unique ids, real hexes, amber first (the historical colour).
assert.equal(new Set(MARKER_COLORS.map((c) => c.id)).size, MARKER_COLORS.length, 'palette ids are unique');
assert.equal(MARKER_COLORS[0].id, 'amber', 'amber leads the palette (the pre-colour default)');
for (const c of MARKER_COLORS) assert.match(c.hex, /^#[0-9a-f]{6}$/i, `${c.id} carries a hex`);
assert.equal(markerColorHex('violet'), '#825cfb', 'hex lookup resolves the brand violet');
assert.equal(markerColorHex('bogus'), MARKER_COLORS[0].hex, 'unknown colour falls back to amber hex');
assert.equal(markerColorId('teal'), 'teal'); assert.equal(markerColorId('bogus'), 'amber');

// addMarker: default amber, explicit colour kept, junk colour normalised.
let st = run(fresh(),
  { type: 'addMarker', id: 'm1', time: 5 },
  { type: 'addMarker', id: 'm2', time: 2, color: 'teal', label: 'hook' },
  { type: 'addMarker', id: 'm3', time: 9, color: 'neon' });
assert.deepEqual(st.present.markers.map((m) => [m.id, m.color]), [['m2', 'teal'], ['m1', 'amber'], ['m3', 'amber']],
  'markers sort by time and carry validated colours');

// Chapters bulk add keeps colours too.
st = run(st, { type: 'addMarkers', markers: [{ id: 'c1', time: 20, label: 'Part 2', color: 'violet' }] });
assert.equal(st.present.markers.find((m) => m.id === 'c1').color, 'violet', 'bulk-added markers keep their colour');

// setMarkerColor: target only; a non-palette colour is refused outright.
const before = st.present;
st = run(st, { type: 'setMarkerColor', id: 'm1', color: 'pink' });
assert.equal(st.present.markers.find((m) => m.id === 'm1').color, 'pink', 'colour lands on the target marker');
assert.equal(st.present.markers.find((m) => m.id === 'm2').color, 'teal', 'other markers keep their colour');
const refused = run(st, { type: 'setMarkerColor', id: 'm1', color: 'ultraviolet' });
assert.equal(refused.present, st.present, 'a non-palette colour changes nothing');

// Bulk delete by range: [from, to) — reversed bounds tolerated, one undo step.
const pastLen = st.past.length;
st = run(st, { type: 'removeMarkersInRange', from: 9, to: 2 });
assert.deepEqual(st.present.markers.map((m) => m.id), ['m3', 'c1'], 'range delete removes the markers inside [2, 9) only (the marker at exactly 9 stays)');
assert.equal(st.past.length, pastLen + 1, 'the range delete is a single undo step');
const noop = run(st, { type: 'removeMarkersInRange', from: 100, to: 200 });
assert.equal(noop.present, st.present, 'a range with no markers inside changes nothing');

// Clear all — and clearing an empty ruler is a no-op.
st = run(st, { type: 'clearMarkers' });
assert.equal(st.present.markers.length, 0, 'clearMarkers empties the ruler');
const noop2 = run(st, { type: 'clearMarkers' });
assert.equal(noop2.present, st.present, 'clearing an empty ruler changes nothing');

// Load normalisation: legacy markers (no colour) gain amber, junk is dropped,
// colours are validated, times clamp and sort.
const loaded = normalizeProject({
  markers: [
    { id: 'old', time: 7, label: 'legacy' },
    { id: 'bad', time: 'x' },
    { time: 3, color: 'sky' },
    null, 'junk',
    { id: 'neg', time: -4, color: 'bogus' },
  ],
});
assert.deepEqual(loaded.markers.map((m) => [m.time, m.color]), [[0, 'amber'], [3, 'sky'], [7, 'amber']],
  'loaded markers are clamped, sorted, colour-validated and junk-free');
assert.ok(loaded.markers.every((m) => m.id), 'every loaded marker has an id');

// Wiring: the timeline menu dispatches the new actions.
const timeline = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/components/Timeline.jsx'), 'utf8');
for (const needle of ['setMarkerColor', 'removeMarkersInRange', 'clearMarkers', 'markerColorHex']) {
  assert.ok(timeline.includes(needle), `Timeline wires ${needle}`);
}
console.log('markers ok: palette colours round-trip through add/bulk/load, invalid colours refused, range + full bulk delete are single undo steps');
