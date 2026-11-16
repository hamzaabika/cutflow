// Gap-build Stream E — AI-02 API-cost / placement indicators.
// Run: node scripts/test-ai-cost.mjs
import assert from 'node:assert/strict';
import { AI_FEATURES, aiCost, cloudCaptionFeature, estimateCost, placementLabel } from '../src/aiCost.js';

// Every AI feature the app offers is in the registry, with a placement and
// a billing model — no AI call site may exist without a record.
for (const [id, f] of Object.entries(AI_FEATURES)) {
  assert.ok(['local', 'cloud', 'network'].includes(f.placement), `${id} has a placement`);
  assert.ok(f.billing, `${id} has a billing model`);
  assert.ok(typeof f.sendsMedia === 'boolean', `${id} says whether media leaves the device`);
  assert.ok(typeof f.needsKey === 'boolean', `${id} says whether it needs the user's API key`);
  assert.ok(f.note, `${id} explains itself in plain words`);
  // A local feature must never claim to send media or need a key.
  if (f.placement === 'local') {
    assert.equal(f.sendsMedia, false, `${id} is local, so it sends nothing`);
    assert.equal(f.needsKey, false, `${id} is local, so it needs no key`);
  }
  if (f.placement === 'cloud') {
    assert.equal(f.sendsMedia, true, `${id} is cloud, so it sends media off-device`);
    assert.equal(f.needsKey, true, `${id} is cloud, so it needs the user's key`);
  }
}
assert.equal(aiCost('no-such-feature'), null, 'unknown feature resolves to null, never a guess');
assert.equal(cloudCaptionFeature('groq'), 'captions-cloud-groq', 'provider id maps to its feature');
assert.equal(cloudCaptionFeature('deepgram'), 'captions-cloud-deepgram', 'deepgram maps to its feature');

// Estimates: per-minute billing multiplies the rate by the job's own minutes.
let est = estimateCost('captions-cloud-openai', { minutes: 10 });
assert.equal(est.usd, 0.06, 'OpenAI whisper-1: 10 min at $0.006/min is $0.06');
assert.ok(est.text.includes('10.0 min'), 'estimate text names the job size');
est = estimateCost('captions-cloud-groq', { minutes: 10 });
assert.ok(Math.abs(est.usd - 0.019) < 0.001, 'Groq: 10 min at ~$0.0019/min is ~$0.019');
assert.equal(estimateCost('captions-cloud-deepgram', { minutes: 10 }), null, 'a rate this file is unsure of yields no dollar figure, not an invented one');
assert.equal(estimateCost('captions-local', { minutes: 10 }), null, 'a free local feature has no estimate');
assert.equal(estimateCost('tts-elevenlabs', { chars: 1500 }).text, '1,500 characters of your quota', 'quota billing counts characters');
assert.equal(estimateCost('tts-elevenlabs', {}), null, 'no job size, no estimate');
assert.equal(estimateCost('flowai-hosted', { minutes: 1 }), null, 'per-token billing has no per-minute estimate');
assert.ok(placementLabel('local').includes('stays on this PC'), 'local label says the media stays');
assert.ok(placementLabel('cloud').includes('leaves this PC'), 'cloud label says the media leaves');

console.log('test-ai-cost: PASS');
