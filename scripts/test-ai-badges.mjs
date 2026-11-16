// B-F14 — cloud AI labelled distinctly from local: the badge classifier
// (ollama = local, every hosted provider = internet + API key, unknown =
// API key by default so nothing hosted is ever presented as local) and a
// source check that every AI surface renders an AiBadge next to its name.
// Usage: node scripts/test-ai-badges.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { badgeForProvider, badgeForTranscribe, badgeForFeature, FEATURE_BADGES } from '../src/ai/badges.js';

assert.equal(badgeForProvider('ollama'), 'local', 'ollama is local');
for (const p of ['gemini', 'groq', 'openai', 'openrouter', 'claude', 'custom', 'deepgram', 'elevenlabs', 'bogus-provider']) {
  assert.equal(badgeForProvider(p), 'api', `${p} needs internet + an API key`);
}
assert.equal(badgeForTranscribe('local'), 'local', 'local whisper is local');
assert.equal(badgeForTranscribe('cloud', 'groq'), 'api', 'cloud transcription needs internet + a key');
assert.equal(badgeForFeature('enhance'), 'local', 'Real-ESRGAN enhance is local');
assert.equal(badgeForFeature('reframe'), 'local', 'auto-reframe is local');
assert.equal(badgeForFeature('enhanceVoice'), 'local', 'voice enhance (bundled FFmpeg) is local');
assert.equal(badgeForFeature('forge'), 'api', 'Forge (Gemini) needs internet + a key');
assert.equal(badgeForFeature('elevenlabs'), 'api', 'ElevenLabs needs internet + a key');
assert.equal(badgeForFeature('unknown-thing'), 'api', 'an unknown feature defaults to API-key, never to local');

// Every AI surface renders the badge next to its name (source check — the
// live app check is the CDP pass, which screenshots the badges in place).
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const surfaces = [
  ['../src/components/CraftPilot.jsx', 'AiBadge', 'FlowAI header follows the selected provider'],
  ['../src/components/SettingsDialog.jsx', 'AiBadge', 'Settings AI section follows the provider picker'],
  ['../src/components/LeftPanel.jsx', 'AiBadge', 'Captions auto + translate badges'],
  ['../src/components/EnhanceDialog.jsx', 'AiBadge', 'AI Enhance (local)'],
  ['../src/components/ReframeDialog.jsx', 'AiBadge', 'Auto-reframe (local)'],
  ['../src/components/EnhanceVoice.jsx', 'AiBadge', 'Voice Enhance (local)'],
  ['../src/components/ForgePanel.jsx', 'AiBadge', 'Forge (API key)'],
  ['../src/components/ElevenLabsStudio.jsx', 'AiBadge', 'ElevenLabs (API key)'],
];
for (const [file, needle, label] of surfaces) {
  const text = src(file);
  assert.ok(text.includes(`import AiBadge from './AiBadge.jsx'`) && text.includes('<AiBadge'), `${label}: ${file} renders AiBadge`);
}
for (const lang of ['en', 'fr', 'ar']) {
  const i18n = src(`../src/i18n/${lang}.js`);
  for (const k of ['ai.badge.local', 'ai.badge.internet', 'ai.badge.api', 'ai.badge.localTitle', 'ai.badge.apiTitle']) {
    assert.ok(i18n.includes(`"${k}"`), `i18n ${lang} has ${k}`);
  }
}
const css = src('../src/styles.css');
assert.ok(css.includes('.ai-badge--local') && css.includes('.ai-badge--api'), 'badge styles exist');

console.log('ai-badges: all checks passed');
