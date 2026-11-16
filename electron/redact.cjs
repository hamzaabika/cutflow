// Secret redaction (FB-23 / P1-32): one place that strips secrets from any
// text the app shows, logs, or sends to the renderer. The per-module exact
// -key redaction in electron/ai.cjs stays (it knows the active key), but an
// exact match is not enough: a provider error body, a pasted log line, or a
// diagnostic dump can carry a key the caller never saw — a different
// service's key, a key-shaped token, or a key embedded in a URL. So this
// also strips well-known key shapes and key-carrying URL params, and the
// provider-error paths in forge / cloudCaptions / tts / gen run through it
// before anything is surfaced. Keys are never written to logs, transcripts,
// or the renderer in the first place; this is the backstop, not the plan.
'use strict';

// Key shapes the app's providers use. Deliberately narrow: a false positive
// redacts a harmless string, a false negative leaks a key.
const PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/g, // Google AI Studio / Gemini keys
  /sk-ant-[A-Za-z0-9-]{20,}/g, // Anthropic
  /sk-proj-[A-Za-z0-9_-]{20,}/g, // OpenAI project keys
  /sk-[A-Za-z0-9]{20,}/g, // OpenAI / Groq / OpenRouter bearer keys
  /sk_[A-Za-z0-9]{20,}/g, // ElevenLabs + other sk_… keys
  /gsk_[A-Za-z0-9]{20,}/g, // Groq
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack-style tokens (MCP servers)
  /ghp_[A-Za-z0-9]{20,}/g, // GitHub personal tokens
  /hf_[A-Za-z0-9]{20,}/g, // Hugging Face tokens
  // A key riding in a URL: ?key=… / ?api_key=… / ?access_token=… (value kept out entirely).
  /([?&](?:key|api_key|apiKey|access_token|token)=)[^&\s'"]+/gi,
  // Authorization-style headers pasted into text: "authorization: Bearer …" / "x-api-key: …".
  // The value must be at least 8 chars, so the literal word "Bearer" alone never matches.
  /((?:authorization|x-api-key|x-goog-api-key|xi-api-key)\s*[:=]\s*(?:Bearer\s+)?)[^\s'";,}]{8,}/gi,
];

const REPLACEMENT = '***';

// text: anything user-visible. keys: exact key strings to strip as well
// (the caller's active key — the shapes above cannot know every provider).
function redactSecrets(text, keys = []) {
  let out = String(text ?? '');
  for (const key of keys) {
    if (key && typeof key === 'string' && key.length >= 4) out = out.split(key).join(REPLACEMENT);
  }
  for (const re of PATTERNS) {
    out = out.replace(re, (m, prefix) => (typeof prefix === 'string' && prefix ? `${prefix}${REPLACEMENT}` : REPLACEMENT));
  }
  return out;
}

// True when the text still contains a key-shaped value (the audit test's
// assertion: after redaction, nothing matches). The *** placeholder itself
// is not a secret: it is stripped first, so `?key=***` reads clean.
function containsSecret(text) {
  const s = String(text ?? '').replace(/\*\*\*/g, '');
  return PATTERNS.some((re) => { re.lastIndex = 0; return re.test(s); });
}

module.exports = { redactSecrets, containsSecret };
