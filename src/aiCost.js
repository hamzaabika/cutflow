// AI cost / placement indicators (gap-build Stream E, AI-02).
//
// Before this module, an AI feature that costs money or sends media
// off-device looked exactly like a free local one — the panels said
// "Cloud — your API key" and nothing about what the call bills or where the
// audio goes. Every AI entry point now carries one of these records, and
// the AiCostBadge component renders it next to the button that spends the
// money / sends the media.
//
// Placement: 'local' (runs on this PC, nothing leaves it), 'cloud' (the
// media or text is sent to the provider's servers and billed to the user's
// own key), 'network' (goes online but is free and sends no project media).
// Rates are the providers' published list prices, labelled approximate —
// they change, and the badge always links the idea, not a promise: where
// this file is unsure of a rate it says so instead of inventing one
// (rateUsdPerMin: null). Estimates are computed from the job's own size
// (minutes of audio, characters of text), never from a guess.
export const AI_PLACEMENT = { LOCAL: 'local', CLOUD: 'cloud', NETWORK: 'network' };

export const AI_FEATURES = {
  'captions-local': {
    label: 'Auto captions (local Whisper)', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Runs on this PC with whisper.cpp. No audio leaves the machine and nothing is billed.',
  },
  'captions-cloud-groq': {
    label: 'Cloud captions (Groq)', placement: 'cloud', billing: 'per-minute',
    rateUsdPerMin: 0.0019, rateNote: 'Approx. list price: $0.111/hour for whisper-large-v3-turbo.',
    sendsMedia: true, needsKey: true,
    note: 'Audio is uploaded to Groq and billed per minute to your own key.',
  },
  'captions-cloud-openai': {
    label: 'Cloud captions (OpenAI)', placement: 'cloud', billing: 'per-minute',
    rateUsdPerMin: 0.006, rateNote: 'Approx. list price: $0.006/minute for whisper-1.',
    sendsMedia: true, needsKey: true,
    note: 'Audio is uploaded to OpenAI and billed per minute to your own key.',
  },
  'captions-cloud-deepgram': {
    label: 'Cloud captions (Deepgram)', placement: 'cloud', billing: 'per-minute',
    rateUsdPerMin: null, rateNote: 'Billed per minute — see Deepgram pricing for nova-3.',
    sendsMedia: true, needsKey: true,
    note: 'Audio is uploaded to Deepgram and billed per minute to your own key.',
  },
  'captions-cloud-elevenlabs': {
    label: 'Cloud captions (ElevenLabs Scribe)', placement: 'cloud', billing: 'per-minute',
    rateUsdPerMin: null, rateNote: 'Billed per minute — see ElevenLabs pricing for Scribe.',
    sendsMedia: true, needsKey: true,
    note: 'Audio is uploaded to ElevenLabs and billed per minute to your own key.',
  },
  'tts-piper': {
    label: 'Text to speech (Piper)', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Runs on this PC with Piper. No text leaves the machine and nothing is billed.',
  },
  'tts-elevenlabs': {
    label: 'Text to speech (ElevenLabs)', placement: 'cloud', billing: 'character quota',
    rateUsdPerMin: null, rateNote: 'Uses characters from your ElevenLabs plan quota — the panel shows the remaining quota.',
    sendsMedia: true, needsKey: true,
    note: 'Text is sent to ElevenLabs and billed in characters against your plan.',
  },
  'flowai-ollama': {
    label: 'FlowAI (Ollama)', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Runs against a model on this PC. Nothing leaves the machine and nothing is billed.',
  },
  'flowai-hosted': {
    label: 'FlowAI (hosted provider)', placement: 'cloud', billing: 'per-token',
    rateUsdPerMin: null, rateNote: 'Billed per token by the provider — see its pricing for the model in use.',
    sendsMedia: true, needsKey: true,
    note: 'Your prompt and project context are sent to the hosted provider and billed per token to your own key.',
  },
  'translate': {
    label: 'Caption translation', placement: 'cloud', billing: 'per-token',
    rateUsdPerMin: null, rateNote: 'Billed per token by the active FlowAI provider — see its pricing.',
    sendsMedia: true, needsKey: true,
    note: 'Caption lines are sent to the active AI provider and billed per token to your own key.',
  },
  'stock': {
    label: 'Stock search', placement: 'network', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Searches the stock catalogue online. Free; no project media is uploaded.',
  },
  'scenes': {
    label: 'Scene detection', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'A local FFmpeg pass over the file. No network, no model download, nothing billed.',
  },
  'semantic-index': {
    label: 'Semantic media search', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'An in-memory index over the project’s own media and transcripts. Nothing leaves the PC.',
  },
  'enhance': {
    label: 'Voice enhance / Clean Voice', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Local FFmpeg filters on this PC. No audio leaves the machine and nothing is billed.',
  },
  'matting': {
    label: 'Auto background removal / reframe', placement: 'local', billing: 'free',
    sendsMedia: false, needsKey: false,
    note: 'Runs on-device with a downloaded model. No media leaves the machine and nothing is billed.',
  },
};

export function aiCost(featureId) {
  return AI_FEATURES[featureId] || null;
}

// The cloud-caption feature id for a provider id (groq/openai/deepgram/elevenlabs).
export function cloudCaptionFeature(provider) {
  return `captions-cloud-${provider}`;
}

// A cost estimate for a job of a known size, or null when the feature has
// no per-unit rate (local/free/quota/token-billed: the badge still shows
// placement + billing, just no dollar figure).
//   { minutes } for per-minute billing, { chars } for per-character quota.
// Returns { usd, text } — text is the human line the badge shows.
export function estimateCost(featureId, { minutes, chars } = {}) {
  const f = aiCost(featureId);
  if (!f) return null;
  if (f.billing === 'per-minute' && typeof f.rateUsdPerMin === 'number' && Number.isFinite(minutes) && minutes > 0) {
    const usd = f.rateUsdPerMin * minutes;
    return { usd, text: `≈ $${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} for ${minutes.toFixed(1)} min of audio` };
  }
  if (f.billing === 'character quota' && Number.isFinite(chars) && chars > 0) {
    return { usd: null, text: `${Math.round(chars).toLocaleString('en-US')} characters of your quota` };
  }
  return null;
}

// Short placement label for the badge.
export function placementLabel(placement) {
  return placement === 'local' ? 'Local · free · stays on this PC'
    : placement === 'cloud' ? 'Cloud · costs money · media leaves this PC'
    : 'Online · free · no media uploaded';
}
