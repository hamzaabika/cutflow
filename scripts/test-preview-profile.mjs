// FB-16 (P1-21) — the preview frame-latency recorder (src/previewProfile.js)
// computes honest percentiles. Plain Node; no app needed.
// Usage: node scripts/test-preview-profile.mjs
import assert from 'node:assert';
import { recordFrame, recordInteraction, previewProfileSummary, resetPreviewProfile } from '../src/previewProfile.js';

resetPreviewProfile();
for (let i = 0; i < 100; i++) {
  recordFrame({ rafDelta: 16.7, applyMs: 2 + (i % 5), onTimeMs: 0.5, toPaintMs: 10 + (i % 10) });
}
recordInteraction('play-click', 42);
let s = previewProfileSummary();
assert.equal(s.frames, 100, '100 frames recorded');
assert.equal(s.rafDelta.p50, 16.7, 'rafDelta p50');
assert.equal(s.applyMs.p50, 4, 'applyMs p50 (2..6 cycle)');
assert.equal(s.applyMs.max, 6, 'applyMs max');
assert.equal(s.onTimeMs.p95, 0.5, 'onTimeMs p95');
assert.equal(s.toPaintMs.p95, 19, 'toPaintMs p95 (10..19 cycle, 95th of 100)');
assert.equal(s.toPaintMs.max, 19, 'toPaintMs max');
assert.equal(s.interactions.length, 1, 'interaction recorded');
assert.equal(s.interactions[0].ms, 42, 'interaction latency kept');

// Ring buffer bounds at 600 frames.
resetPreviewProfile();
for (let i = 0; i < 650; i++) recordFrame({ rafDelta: 16, applyMs: 1, onTimeMs: 0.1, toPaintMs: 5 });
s = previewProfileSummary();
assert.equal(s.frames, 600, 'buffer caps at 600 frames');

// Empty summary is nulls, not NaN.
resetPreviewProfile();
s = previewProfileSummary();
assert.equal(s.frames, 0, 'reset clears frames');
assert.equal(s.rafDelta.p50, null, 'empty p50 is null, not NaN');
assert.equal(s.toPaintMs.max, null, 'empty max is null');

console.log('PREVIEW-PROFILE OK');
