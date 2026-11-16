// AI labelling inventory (FB-23 / P1-32): every AI feature in Cutflow, in
// one place, with the four facts a user needs before they use it — does it
// run on this PC or on someone else's server, does it need internet, does
// it need an API key, and what does the provider receive. This table is the
// single source for the in-app AI & privacy dialog AND the policy doc
// (docs/ai-labelling-inventory.md); change one, change both, and the
// inventory test fails when a row is missing a field or a Forge model has
// no estimate. Costs are estimates from the providers' published rates,
// checked 2026-11-15; the provider's own pricing page is the authority.
//
// Placement (local): Local = runs on this PC, no media or text leaves it
// (a model may still be downloaded once). Remote = the request goes to the
// named provider with the user's own key or account.
export const AI_PLACEMENT = { LOCAL: 'local', REMOTE: 'remote' };

// receives: what leaves this PC, in plain words. Keep it literal: FlowAI
// sends project structure and captions, never media files.
export const AI_INVENTORY = [
  {
    id: 'flowai', feature: 'ai.flowai', where: 'ai.whereFlowai',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'ai.providerConfigured',
    receives: 'ai.receivesFlowai',
    cost: 'ai.costMetered',
  },
  {
    id: 'forge-photo-pollinations', feature: 'ai.forgePhotoPoll', where: 'ai.whereForge',
    placement: 'remote', internet: true, apiKey: false,
    provider: 'Pollinations',
    receives: 'ai.receivesPromptOnly',
    cost: 'ai.costFree',
  },
  {
    id: 'forge-photo-gemini', feature: 'ai.forgePhotoGemini', where: 'ai.whereForge',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'Google Gemini',
    receives: 'ai.receivesPromptOnly',
    cost: 'ai.costForgePhoto',
  },
  {
    id: 'forge-video-veo', feature: 'ai.forgeVideo', where: 'ai.whereForge',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'Google Gemini (Veo)',
    receives: 'ai.receivesPromptImage',
    cost: 'ai.costForgeVideo',
  },
  {
    id: 'gen-studio', feature: 'ai.genStudio', where: 'ai.whereGenStudio',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'ElevenLabs',
    receives: 'ai.receivesPromptPhoto',
    cost: 'ai.costMetered',
  },
  {
    id: 'tts-elevenlabs', feature: 'ai.ttsEleven', where: 'ai.whereTts',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'ElevenLabs',
    receives: 'ai.receivesText',
    cost: 'ai.costMetered',
  },
  {
    id: 'tts-piper', feature: 'ai.ttsPiper', where: 'ai.whereTts',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'captions-whisper', feature: 'ai.captionsWhisper', where: 'ai.whereCaptions',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'captions-cloud', feature: 'ai.captionsCloud', where: 'ai.whereCaptions',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'ai.providerCaptionCloud',
    receives: 'ai.receivesAudio',
    cost: 'ai.costMetered',
  },
  {
    id: 'captions-translate', feature: 'ai.translate', where: 'ai.whereCaptions',
    placement: 'remote', internet: true, apiKey: true,
    provider: 'ai.providerConfigured',
    receives: 'ai.receivesCaptionText',
    cost: 'ai.costMetered',
  },
  {
    id: 'enhance', feature: 'ai.enhance', where: 'ai.whereEnhance',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'matting', feature: 'ai.matting', where: 'ai.whereMatting',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'reframe', feature: 'ai.reframe', where: 'ai.whereReframe',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'clean-voice', feature: 'ai.cleanVoice', where: 'ai.whereAudioFx',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'detect-local', feature: 'ai.detectLocal', where: 'ai.whereCaptions',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'recommend', feature: 'ai.recommend', where: 'ai.whereMedia',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
  {
    id: 'mcp', feature: 'ai.mcp', where: 'ai.whereMcp',
    placement: 'local', internet: false, apiKey: false,
    provider: 'ai.providerNone',
    receives: 'ai.receivesNothing',
    cost: 'ai.costFree',
  },
];

// Badge helpers for the dialog: placement + the two requirements.
export const placementBadge = (row) => (row.placement === 'local' ? 'ai.badgeLocal' : 'ai.badgeRemote');
export const internetBadge = (row) => (row.internet ? 'ai.badgeInternet' : 'ai.badgeOffline');
export const keyBadge = (row) => (row.apiKey ? 'ai.badgeKey' : 'ai.badgeNoKey');

// Estimated Forge cost for one generation, from the catalog's rates
// (electron/forge.cjs estimateFor). The renderer passes the catalog entry;
// this keeps the formatting in one place.
export function formatForgeEstimate(estimate) {
  if (!estimate) return null;
  if (estimate.amount === 0) return { amount: 0, text: 'Free' };
  return { amount: estimate.amount, text: `≈ $${estimate.amount.toFixed(2)}` };
}
