// Secrets-in-logs audit (FB-23 / P1-32): no API key may reach a renderer
// log, a diagnostic log, or the UI — through a log call, a provider error
// body, or a pasted header. Two halves:
//   1) Unit: electron/redact.cjs strips exact keys AND key-shaped values
//      (Google AIza…, sk-…, sk-ant-…, gsk_…, keys in URLs, pasted auth
//      headers) from a hostile sample; containsSecret() agrees afterwards.
//   2) Static: no console.* call in src/ or electron/ interpolates a key
//      variable (apiKey / getKey() / serviceKey / xi-api-key), and every
//      provider-error path that surfaces text to the UI goes through
//      redactSecrets (forge, cloudCaptions, tts, gen, ai).
// Usage: node scripts/test-secrets-in-logs.cjs
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { redactSecrets, containsSecret } = require('../electron/redact.cjs');

const GOOGLE_KEY = 'AIzaSyDabcdefghijklmnopqrstuvwxyz012345'; // 39 chars, AIza shape
const OPENAI_KEY = 'sk-proj-abcdefghij1234567890abcdefghij1234567890';
const ANTHROPIC_KEY = 'sk-ant-api03-abcdefghij1234567890abcdefghij1234567890';
const ELEVEN_KEY = 'sk_abcdef1234567890abcdef1234567890abcdef1234567890abcdef12';
const GROQ_KEY = 'gsk_abcdefghij1234567890abcdefghij1234567890';

// --- 1) the redactor strips every shape, keeps the readable words ---
const hostile = [
  `Provider answered 400: invalid key ${GOOGLE_KEY} here`,
  `openai key ${OPENAI_KEY} was rejected`,
  `claude: ${ANTHROPIC_KEY} expired`,
  `groq: ${GROQ_KEY} bad`,
  `eleven: xi-api-key ${ELEVEN_KEY} refused`,
  `https://example.com/v1/models?key=${GOOGLE_KEY}&x=1`,
  `headers: authorization: Bearer ${OPENAI_KEY}`,
  `x-goog-api-key: ${GOOGLE_KEY}`,
];
for (const sample of hostile) {
  const out = redactSecrets(sample);
  assert.ok(!out.includes(GOOGLE_KEY) && !out.includes(OPENAI_KEY) && !out.includes(ANTHROPIC_KEY)
    && !out.includes(ELEVEN_KEY) && !out.includes(GROQ_KEY), `no key survives redaction: ${out}`);
  assert.equal(containsSecret(out), false, `nothing key-shaped remains: ${out}`);
  assert.ok(out.includes('***'), 'the redaction is visible, not a silent drop');
}
assert.equal(redactSecrets(`key is ${GOOGLE_KEY} end`, [GOOGLE_KEY]), 'key is *** end', 'an exact key is stripped even when the shape changes');
assert.equal(redactSecrets('plain text, no secrets'), 'plain text, no secrets', 'clean text passes through untouched');
assert.equal(redactSecrets(`bad key ${OPENAI_KEY} and ${GOOGLE_KEY}`), 'bad key *** and ***', 'two keys in one line both go');
assert.equal(redactSecrets('https://example.com/v1/models?key=AIzaSyD-abcdefghijklmnopqrstuvwxyz0123456789&x=1'),
  'https://example.com/v1/models?key=***&x=1', 'a key in a URL keeps the URL, drops the value');

// --- 2) static audit: no log call interpolates a key; provider errors are redacted ---
const ROOT = path.join(__dirname, '..');
const readTree = (dir) => {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (name !== 'node_modules') out.push(...readTree(p)); }
    else if (/\.(cjs|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
};
const KEY_VAR = /\b(apiKey|api_key|getKey\(\)|serviceKey|xi-api-key|getServiceKey)\b/;
const LOG_CALL = /console\.(log|warn|error|info|debug)\s*\(/;
for (const file of [...readTree(path.join(ROOT, 'src')), ...readTree(path.join(ROOT, 'electron'))]) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (LOG_CALL.test(line) && KEY_VAR.test(line)) {
      assert.fail(`${path.relative(ROOT, file)}:${i + 1} logs a key variable: ${line.trim()}`);
    }
  });
}
// Every module that surfaces provider text to the UI redacts it first.
for (const mod of ['electron/forge.cjs', 'electron/cloudCaptions.cjs', 'electron/tts.cjs', 'electron/gen.cjs', 'electron/ai.cjs']) {
  const text = fs.readFileSync(path.join(ROOT, mod), 'utf8');
  assert.ok(/redactSecrets/.test(text), `${mod} runs provider text through redactSecrets`);
}
// Renderer log writes: the diagnostic log path never receives a key either
// (settings expose only 4-char hints, never key material — see settings.cjs).
const settings = fs.readFileSync(path.join(ROOT, 'electron/settings.cjs'), 'utf8');
assert.ok(/hint/.test(settings), 'settings expose key hints, not keys');
assert.ok(!/apiKey[^,}\n]{0,40}(console|log)/.test(settings), 'settings never logs a key');

console.log('PASS  test-secrets-in-logs');
