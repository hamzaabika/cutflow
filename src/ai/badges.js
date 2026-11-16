// AI badges (B-F14): every AI feature says, next to its own name, whether it
// runs on this machine or needs the network / an API key. The classification
// is one pure function per surface so the badge can never drift from the
// engine it describes:
//   'local'    — runs on this machine (bundled models / FFmpeg filters).
//                No internet, no key, nothing leaves the PC.
//   'internet' — a hosted service, but no key of the user's own (none of
//                today's hosted features qualify — kept for future use).
//   'api'      — a hosted service that needs the user's own API key.
// Providers: only Ollama runs locally. Every hosted chat provider (Gemini,
// Groq, OpenAI, OpenRouter, Claude, Custom) needs internet + a key.
export const AI_BADGE_KINDS = ['local', 'internet', 'api'];

// The chat-provider badge. Unknown providers are 'api': a hosted service
// the app does not recognise must never be presented as local.
export function badgeForProvider(provider) {
  return provider === 'ollama' ? 'local' : 'api';
}

// Transcription: the bundled Whisper models run locally; the cloud list
// (Groq / OpenAI / Deepgram / ElevenLabs) needs internet + a key.
export function badgeForTranscribe(mode, provider) {
  if (mode === 'local') return 'local';
  return 'api';
}

// Fixed features — the engine is not a user choice, so the badge is a
// constant. (Forge = Gemini generation, ElevenLabs = cloud TTS, Enhance /
// Reframe / Voice Enhance = bundled local models and FFmpeg filters.)
export const FEATURE_BADGES = {
  enhance: 'local', // Real-ESRGAN, bundled
  reframe: 'local', // on-device face tracking
  enhanceVoice: 'local', // bundled FFmpeg denoise chain
  forge: 'api', // Gemini image/video generation
  elevenlabs: 'api', // ElevenLabs cloud TTS / Scribe
  captionsLocal: 'local',
  captionsCloud: 'api',
};

export const badgeForFeature = (feature) => FEATURE_BADGES[feature] || 'api';
