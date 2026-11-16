// AI-cut confidence (FB-24 / P1-33): silence / filler / pause / retake
// cuts carry a 0..1 confidence and a reason; the review dialog filters by
// threshold and applies only the accepted cuts.
// Usage: node scripts/test-ai-cut-confidence.mjs
import assert from 'node:assert/strict';
import {
  acceptedRanges, applyThreshold, scoreFillerDetection, scoreRetakeCuts, scoreSilenceRanges, silenceConfidence,
} from '../src/aiCutConfidence.js';
import { detectFillers } from '../src/fillers.js';
import { retakeGroups, transcriptSentences } from '../src/transcript.js';

// --- silence: longer is surer, floored at 0.55 ---
assert.equal(silenceConfidence(0.2, 0.6), 0.55, 'a blip at the floor scores 0.55');
assert.ok(silenceConfidence(0.9, 0.6) > 0.55 && silenceConfidence(0.9, 0.6) < 1, 'a mid silence is mid-confidence');
assert.equal(silenceConfidence(2.5, 0.6), 1, 'a long silence caps at 1.0');
assert.ok(silenceConfidence(1.2, 0.6) > silenceConfidence(0.7, 0.6), 'confidence rises with duration');
const scored = scoreSilenceRanges([{ start: 10, end: 12.5 }, { start: 20, end: 20.3 }], { minDur: 0.6 });
assert.equal(scored.length, 2, 'every range is scored');
assert.ok(scored[0].confidence > scored[1].confidence, 'the long span outranks the short one');
assert.equal(scored[0].kind, 'silence', 'kind is silence');
assert.ok(scored[0].reason.includes('2.5'), 'reason names the duration');

// --- fillers: exact word 0.90, phrase 0.85, pause grows with the gap ---
const project = {
  textClips: [{
    id: 'c1', caption: true, start: 10, duration: 8, text: 'Hello um world يعني friends',
    words: [
      { text: 'Hello', start: 0, end: 0.4 }, { text: 'um', start: 0.5, end: 0.8 },
      { text: 'world', start: 0.9, end: 1.4 }, { text: 'يعني', start: 1.5, end: 1.9 },
      { text: 'friends', start: 3.4, end: 3.9 },
    ],
  }],
};
const found = detectFillers(project);
assert.ok(Array.isArray(found.details) && found.details.length === found.ranges.length, 'detectFillers reports one detail per cut');
const fillerCuts = scoreFillerDetection(found, { minPause: 0.7 });
const um = fillerCuts.find((c) => c.kind === 'filler' && c.word === 'um');
assert.equal(um?.confidence, 0.9, 'exact lexicon hit scores 0.90');
const pause = fillerCuts.find((c) => c.kind === 'pause');
assert.ok(pause && pause.confidence >= 0.55 && pause.confidence <= 0.95, 'pause confidence is in range');
assert.ok(pause.confidence > 0.55, 'a 1.5 s gap beats the floor');
// A longer gap is surer than a short one.
const longPause = scoreFillerDetection({ details: [{ start: 0, end: 2, kind: 'pause', gap: 2.6 }] }, { minPause: 0.7 });
const shortPause = scoreFillerDetection({ details: [{ start: 0, end: 0.9, kind: 'pause', gap: 0.75 }] }, { minPause: 0.7 });
assert.ok(longPause[0].confidence > shortPause[0].confidence, 'longer pause, higher confidence');

// --- retakes: near-identical lines are safe to drop ---
const capStyle = { font: 'cairo', size: 64, bold: true, color: '#ffffff', y: 0.8, caption: true };
const cap = (id, start, duration, text) => {
  const words = text.split(' ').map((t, i, arr) => ({ text: t, start: (duration * i) / arr.length, end: (duration * (i + 1)) / arr.length }));
  return { ...capStyle, id, start, duration, text, words };
};
const sentences = transcriptSentences({
  textClips: [
    cap('c1', 0, 1, 'welcome back to'),
    cap('c2', 2, 3, 'welcome back to the show everyone'),
    cap('c3', 6, 3, 'today we test three laptops'),
    cap('c4', 10, 3, 'today we test three laptops'),
  ],
});
const groups = retakeGroups(sentences);
assert.equal(groups.length, 2, 'two retake groups');
const retakeCuts = scoreRetakeCuts(sentences, groups[0]);
assert.equal(retakeCuts.length, 1, 'one removed take in group 1');
assert.equal(retakeCuts[0].kind, 'retake', 'kind is retake');
assert.ok(retakeCuts[0].confidence > 0.8, 'a cut-off subset of the kept line is high-confidence');
assert.ok(retakeCuts[0].reason.includes('cut-off'), 'reason names the cut-off attempt');

// --- threshold + accept: the review dialog's filter and apply ---
const mixed = [
  { start: 0, end: 1, confidence: 0.95 },
  { start: 2, end: 3, confidence: 0.6 },
  { start: 4, end: 5, confidence: 0.4 },
];
assert.equal(applyThreshold(mixed, 0.9).length, 1, 'threshold 0.9 keeps only the sure cut');
assert.equal(applyThreshold(mixed, 0).length, 3, 'threshold 0 keeps all');
const accepted = acceptedRanges([
  { start: 0, end: 1, accepted: true },
  { start: 2, end: 3, accepted: false },
  { start: 4, end: 5, accepted: true },
]);
assert.deepEqual(accepted, [{ start: 0, end: 1 }, { start: 4, end: 5 }], 'rejected cuts never reach cutRanges');
assert.deepEqual(acceptedRanges([{ start: 0, end: 1 }, { start: 1.2, end: 2 }]), [{ start: 0, end: 1 }, { start: 1.2, end: 2 }], 'accepted defaults to true, ranges stay separate');

console.log('PASS  test-ai-cut-confidence');
