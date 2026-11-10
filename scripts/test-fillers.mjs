// Filler-word removal (10/10 step 5, §4 parity row): detection over the
// generated captions' word timings — Arabic/Darija + EN + FR lexicons as
// data, phrases, punctuation/case-insensitive matching, pauses trimmed to a
// breath — and the ranges it returns really cut the video through the same
// cutRanges action the transcript editor uses.
// Usage: node scripts/test-fillers.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectFillers, normalizeWord } from '../src/fillers.js';
import { historyReducer, normalizeProject } from '../src/store.js';

// Clip 1 sits at t=10 (words are clip-relative); clip 2 at t=30.
const project = {
  textClips: [
    {
      id: 'c1', caption: true, start: 10, duration: 6, text: 'Hello um world يعني friends',
      words: [
        { text: 'Hello', start: 0, end: 0.4 }, { text: 'um', start: 0.5, end: 0.8 },
        { text: 'world', start: 0.9, end: 1.4 }, { text: 'يعني', start: 1.5, end: 1.9 },
        { text: 'friends', start: 3.4, end: 3.9 },
      ],
    },
    {
      id: 'c2', caption: true, start: 30, duration: 4, text: 'You know, UH! right',
      words: [
        { text: 'You', start: 0, end: 0.3 }, { text: 'know,', start: 0.35, end: 0.7 },
        { text: 'UH!', start: 0.8, end: 1.1 }, { text: 'right', start: 1.2, end: 1.6 },
      ],
    },
    { id: 'x1', start: 50, duration: 2, text: 'um title card' }, // not a caption clip: never read
  ],
};

// Normalisation: case, punctuation and Arabic diacritics all wash out.
assert.equal(normalizeWord('Um,'), 'um');
assert.equal(normalizeWord('يَعْنِي'), 'يعني', 'diacritics strip before matching');
assert.equal(normalizeWord('know,'), 'know');

const found = detectFillers(project);
assert.equal(found.fillerCount, 4, 'four fillers: um, يعني, the you-know phrase, UH');
assert.equal(found.pauseCount, 1, 'one long pause (يعني -> friends, 1.5 s)');
const at = (s) => found.ranges.find((r) => Math.abs(r.start - s) < 0.001);
assert.ok(at(10.5) && Math.abs(at(10.5).end - 10.8) < 0.001, 'um cuts at its word bounds (timeline-absolute)');
assert.ok(at(11.5) && Math.abs(at(11.5).end - 11.9) < 0.001, 'يعني cuts at its word bounds');
assert.ok(at(30) && Math.abs(at(30).end - 30.7) < 0.001, 'the phrase cuts as one range');
assert.ok(at(30.8) && Math.abs(at(30.8).end - 31.1) < 0.001, 'UH! matches through case + punctuation');
const pause = found.ranges.find((r) => Math.abs(r.start - 12.05) < 0.001);
assert.ok(pause && Math.abs(pause.end - 13.25) < 0.001, 'the pause is trimmed to a 0.3 s breath (0.15 s kept each side)');
assert.ok(!found.ranges.some((r) => r.start >= 50), 'non-caption text is never scanned');

// Toggles and thresholds are honoured.
assert.equal(detectFillers(project, { fillers: false }).fillerCount, 0, 'fillers off: none reported');
assert.equal(detectFillers(project, { fillers: false }).ranges.length, 1, 'fillers off: only the pause remains');
assert.equal(detectFillers(project, { pauses: false }).pauseCount, 0, 'pauses off: none reported');
assert.equal(detectFillers(project, { minPause: 3 }).pauseCount, 0, 'a higher pause threshold finds nothing');

// No captions with words -> nothing detected (the card says "generate first").
assert.deepEqual(detectFillers({ textClips: [{ id: 's', source: 'srt', start: 0, duration: 2, text: 'um' }] }).ranges, [], 'srt clips without word timings are out of scope');

// End to end: the detected ranges cut the main track by their total length.
const full = normalizeProject({
  media: [{ id: 'm1', path: '/tmp/x.mp4', type: 'video', duration: 40 }],
  videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 40, speed: 1, volume: 1, filter: 'none', adjust: {}, effects: [], transition: null }],
  textClips: project.textClips,
});
const total = found.ranges.reduce((a, r) => a + (r.end - r.start), 0);
const st = historyReducer({ past: [], present: full, future: [] }, { type: 'cutRanges', ranges: found.ranges, rippleText: true });
const remaining = st.present.videoClips.reduce((a, c) => a + (c.out - c.in) / (c.speed || 1), 0);
assert.ok(Math.abs(remaining - (40 - total)) < 0.01, `the cut removes exactly the detected ranges (${total.toFixed(2)} s of ${40})`);

// Wiring: the Captions tab carries the card over the same detector.
const panel = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/components/LeftPanel.jsx'), 'utf8');
assert.ok(panel.includes('FillerCard') && panel.includes('detectFillers'), 'Captions tab wires the filler card');
console.log(`fillers ok: lexicon + phrase + pause detection over word timings, ranges cut the main track exactly (${total.toFixed(2)} s in the fixture)`);
