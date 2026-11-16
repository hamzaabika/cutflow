// AI labelling inventory (FB-23 / P1-32): every row in src/aiInventory.js
// carries all four labels (placement / internet / key / receives) plus a
// provider and a cost, every Forge model in electron/forge.cjs carries a
// cost estimate, and estimateFor prices one generation before it runs.
// Usage: node scripts/test-ai-inventory.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const forge = require('../electron/forge.cjs');
import { AI_INVENTORY, formatForgeEstimate } from '../src/aiInventory.js';

const EXPECTED_IDS = [
  'flowai', 'forge-photo-pollinations', 'forge-photo-gemini', 'forge-video-veo',
  'gen-studio', 'tts-elevenlabs', 'tts-piper', 'captions-whisper', 'captions-cloud',
  'captions-translate', 'enhance', 'matting', 'reframe', 'clean-voice',
  'detect-local', 'recommend', 'mcp',
];
assert.deepEqual(AI_INVENTORY.map((r) => r.id), EXPECTED_IDS, 'inventory covers every AI feature, in a stable order');
for (const row of AI_INVENTORY) {
  assert.ok(['local', 'remote'].includes(row.placement), `${row.id}: placement is local or remote`);
  assert.equal(typeof row.internet, 'boolean', `${row.id}: internet is a boolean`);
  assert.equal(typeof row.apiKey, 'boolean', `${row.id}: apiKey is a boolean`);
  for (const f of ['feature', 'where', 'provider', 'receives', 'cost']) {
    assert.equal(typeof row[f], 'string', `${row.id}: ${f} is an i18n key`);
    assert.ok(row[f].length > 0, `${row.id}: ${f} is set`);
  }
  if (row.placement === 'local') {
    assert.equal(row.internet, false, `${row.id}: a local feature needs no internet`);
    assert.equal(row.apiKey, false, `${row.id}: a local feature needs no key`);
    assert.equal(row.provider, 'ai.providerNone', `${row.id}: a local feature has no provider`);
  }
  if (row.placement === 'remote') assert.equal(row.internet, true, `${row.id}: a remote feature needs internet`);
}
assert.ok(AI_INVENTORY.filter((r) => r.placement === 'local').length >= 8, 'most AI features run locally');
assert.ok(AI_INVENTORY.filter((r) => r.placement === 'remote').length >= 6, 'remote features are all labelled');

// --- Forge catalog estimates (checked 2026-11-15, Google published rates) ---
const cat = forge.catalog();
assert.equal(cat.costChecked, '2026-11-15', 'catalog carries the price-check date');
for (const m of [...cat.photoModels, ...cat.videoModels]) {
  assert.ok(m.estimate && typeof m.estimate.amount === 'number', `${m.id}: catalog model has a cost estimate`);
  assert.ok(m.estimate.amount >= 0, `${m.id}: estimate is not negative`);
}
assert.deepEqual(forge.estimateFor({ kind: 'photo', modelId: 'pollinations' }), { amount: 0, unit: 'image', label: 'Free', costChecked: '2026-11-15' }, 'Pollinations is free');
assert.equal(forge.estimateFor({ kind: 'photo', modelId: 'gemini-2.5-flash-image' }).amount, 0.039, 'Nano Banana ≈ $0.039/image');
assert.equal(forge.estimateFor({ kind: 'video', modelId: 'veo-3.1-fast-generate-001', duration: 8 }).amount, 0.8, 'Veo Fast 8 s ≈ $0.80');
assert.equal(forge.estimateFor({ kind: 'video', modelId: 'veo-3.1-generate-001', duration: 5 }).amount, 2, 'Veo Standard 5 s ≈ $2.00');
assert.equal(forge.estimateFor({ kind: 'video', modelId: 'nope', duration: 8 }), null, 'unknown model has no estimate');
assert.deepEqual(formatForgeEstimate({ amount: 0 }), { amount: 0, text: 'Free' }, 'free formats as Free');
assert.equal(formatForgeEstimate({ amount: 0.8 }).text, '≈ $0.80', 'paid estimate formats with two decimals');

console.log('PASS  test-ai-inventory');
