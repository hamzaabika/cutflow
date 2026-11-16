# AI labelling inventory — Cutflow (policy)

Source of truth in code: `src/aiInventory.js` (rendered by
`src/components/AiInventoryDialog.jsx`, opened from the Forge panel's
"AI & privacy" button). This document is the same table in prose form.
Change one, change both — `scripts/test-ai-inventory.mjs` fails when a
row is missing a field or a Forge model has no cost estimate.

Prices checked **2026-11-15** against the providers' published rates.
The provider's own pricing page is the authority; prices change.

## Labels

- **Local** — runs on this PC. No media, text, or audio leaves it. (A
  model may still be downloaded once, on first use.)
- **Remote** — the request goes to the named provider, on the user's own
  key or account.
- **Needs internet / Works offline** — whether the feature works with no
  connection (after any one-time model download).
- **Needs an API key / No key needed** — whether the user must save a key
  in Settings first. Keys are stored encrypted (OS keychain via
  Electron safeStorage) and never leave the main process.
- **Provider receives** — exactly what leaves this PC, in plain words.

## The inventory

| Feature | Where | Placement | Internet | API key | Provider | Provider receives | Cost |
|---|---|---|---|---|---|---|---|
| FlowAI assistant | AI assistant panel | Remote | Needs internet | Needs a key | Your configured AI provider (Settings → AI assistant: Gemini, Groq, Ollama, OpenAI, OpenRouter, Claude, Custom) | Your prompts, the project structure (clip names and times, captions) and the transcript text — never your media files | Billed by your provider's plan |
| Forge — photo (Pollinations) | Forge panel | Remote | Needs internet | No key | Pollinations | Your prompt text only | Free |
| Forge — photo (Gemini) | Forge panel | Remote | Needs internet | Needs a key | Google Gemini | Your prompt text only | ≈ $0.03–0.04 per image |
| Forge — video (Veo) | Forge panel | Remote | Needs internet | Needs a key | Google Gemini (Veo) | Your prompt text, plus the start image when you animate a photo | ≈ $0.10–0.40 per second of video (720p) |
| GenStudio — avatars & video | GenStudio | Remote | Needs internet | Needs a key | ElevenLabs | Your prompt text and the photo you picked | Billed by your ElevenLabs plan (credits) |
| Voice-over (ElevenLabs) | Text to speech | Remote | Needs internet | Needs a key | ElevenLabs | The text you asked it to speak | Billed by your ElevenLabs plan (characters) |
| Voice-over (Piper, local voices) | Text to speech | Local | Works offline | No key | None | Nothing | Free |
| Auto captions (Whisper, local) | Captions panel | Local | Works offline | No key | None | Nothing | Free |
| Auto captions (cloud) | Captions panel | Remote | Needs internet | Needs a key | Groq, OpenAI, Deepgram or ElevenLabs (whichever you picked) | Your audio file (sent for transcription) | Billed by your provider's plan |
| Caption translation | Captions panel | Remote | Needs internet | Needs a key | Your configured AI provider | Your caption text | Billed by your provider's plan |
| AI enhancer | Enhance | Local | Works offline | No key | None | Nothing | Free |
| Background removal | Background removal | Local | Works offline | No key | None | Nothing | Free |
| Auto reframe (face tracking) | Reframe | Local | Works offline | No key | None | Nothing | Free |
| Clean voice | Audio effects | Local | Works offline | No key | None | Nothing | Free |
| Silence / filler / retake / chapter detection | Captions panel | Local | Works offline | No key | None | Nothing | Free |
| Smart media recommendations | Media panel | Local | Works offline | No key | None | Nothing | Free |
| MCP server (local automation) | Settings → Automation | Local | Works offline | No key | None | Nothing | Free |

## Cost estimates shown before generating (Forge)

The Forge panel shows the estimated provider cost for the exact
generation before the user presses Generate, from the catalog rates in
`electron/forge.cjs` (`estimateFor`):

- Pollinations photo: **$0.00** (free).
- Gemini 2.5 Flash Image (Nano Banana): **≈ $0.039 per image**.
- Gemini 3.1 Flash Image (Nano Banana 2): **≈ $0.034 per image**.
- Veo 3.1 Fast, 720p: **≈ $0.10 per second** → 5 s ≈ $0.50, 8 s ≈ $0.80.
- Veo 3.1 (Standard), 720p: **≈ $0.40 per second** → 5 s ≈ $2.00, 8 s ≈ $3.20.
- 1080p/4K video costs more; Google bills only for video that generates
  successfully. Note: Google listed the Veo 3.1 preview model IDs for
  possible retirement from 22 Oct 2026 — availability needs a check before
  relying on them.

## Secrets-in-logs audit

Rules, enforced by `scripts/test-secrets-in-logs.cjs`:

1. API keys are never written to renderer logs, diagnostic logs, or the
   transcript. The main-process providers redact the active key from
   every error they surface (`electron/ai.cjs`), and every provider-error
   path that reaches the UI runs through `electron/redact.cjs`, which
   strips exact keys plus key-shaped values (Google `AIza…`, `sk-…`,
   `sk-ant-…`, `gsk_…`, keys in URLs, pasted `Authorization` headers).
2. Keys travel only in request headers (`x-goog-api-key`,
   `Authorization: Bearer …`, `x-api-key`, `xi-api-key`) — never in a
   URL, a log line, or a project file.
3. The audit test greps `src/` and `electron/` for `console.*` calls
   that interpolate a key variable, and asserts the redactor strips
   every key shape above from a hostile sample string (including a
   provider error body that echoes a key back).
4. `Forge` surfaces provider errors verbatim *after* redaction — the
   provider's words, minus any secret.
