// One-click audio "essentials" presets for the inspector. This table MIRRORS
// AUDIO_FX_PRESETS in electron/audiofx.cjs (the export engine's copy) — a suite
// (scripts/test-audio-presets.mjs) keeps the two identical. A preset is a COMPLETE
// audioFx object: applying it replaces the clip's audioFx wholesale.
export const AUDIO_PRESETS = [
  { id: 'clear-voice', name: 'Clear Voice', cat: 'Voice', fx: { eq: { low: -3, mid: 2, high: 3 }, highpass: 80, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'podcast', name: 'Podcast', cat: 'Voice', fx: { eq: { low: 2, mid: 1, high: -1 }, highpass: 60, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'warm', name: 'Warm', cat: 'Dynamics', fx: { eq: { low: 4, mid: 0, high: -3 }, highpass: 0, lowpass: 12000, comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'bright', name: 'Bright', cat: 'Dynamics', fx: { eq: { low: -2, mid: 1, high: 5 }, highpass: 40, lowpass: 0, comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  // Preset packs (10/10 step 3, Filmora-merge row 3): the essentials grew into four
  // categorized packs — Voice, Space, Restore, Dynamics. Every entry is an original
  // parameter set over the same chain; each drives at least three real filters.
  { id: 'radio-voice', name: 'Radio Voice', cat: 'Voice', fx: { eq: { low: 3, mid: 4, high: 1 }, highpass: 120, lowpass: 6500, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'narration', name: 'Narration', cat: 'Voice', fx: { eq: { low: 1, mid: 3, high: 2 }, highpass: 70, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'interview', name: 'Interview', cat: 'Voice', fx: { eq: { low: -2, mid: 3, high: 2 }, highpass: 90, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'deep-voice', name: 'Deep Voice', cat: 'Voice', fx: { eq: { low: 6, mid: -1, high: -2 }, highpass: 0, lowpass: 0, comp: true, limit: false, denoise: false, loudnorm: true, echo: null, pitch: -2 } },
  { id: 'bright-voice', name: 'Bright Voice', cat: 'Voice', fx: { eq: { low: -4, mid: 2, high: 6 }, highpass: 100, lowpass: 0, comp: false, limit: false, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'phone-voice', name: 'Phone Voice', cat: 'Voice', fx: { eq: { low: 0, mid: 3, high: 0 }, highpass: 300, lowpass: 3400, comp: true, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'whisper', name: 'Whisper', cat: 'Voice', fx: { eq: { low: -6, mid: 1, high: 7 }, highpass: 140, lowpass: 0, comp: true, limit: false, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'small-room', name: 'Small Room', cat: 'Space', fx: { eq: { low: 1, mid: 0, high: -1 }, highpass: 0, lowpass: 0, comp: false, limit: false, denoise: false, loudnorm: false, echo: { delay: 90, decay: 0.22 }, pitch: 0 } },
  { id: 'hall', name: 'Concert Hall', cat: 'Space', fx: { eq: { low: 0, mid: 0, high: -2 }, highpass: 0, lowpass: 9000, comp: false, limit: false, denoise: false, loudnorm: false, echo: { delay: 320, decay: 0.5 }, pitch: 0 } },
  { id: 'cathedral', name: 'Cathedral', cat: 'Space', fx: { eq: { low: 2, mid: 0, high: -3 }, highpass: 0, lowpass: 7000, comp: false, limit: false, denoise: false, loudnorm: false, echo: { delay: 520, decay: 0.65 }, pitch: 0 } },
  { id: 'cave', name: 'Cave Echo', cat: 'Space', fx: { eq: { low: 3, mid: 0, high: 0 }, highpass: 0, lowpass: 3800, comp: false, limit: false, denoise: false, loudnorm: false, echo: { delay: 240, decay: 0.55 }, pitch: 0 } },
  { id: 'stadium', name: 'Stadium', cat: 'Space', fx: { eq: { low: 0, mid: 2, high: 2 }, highpass: 120, lowpass: 0, comp: true, limit: false, denoise: false, loudnorm: false, echo: { delay: 180, decay: 0.4 }, pitch: 0 } },
  { id: 'underwater', name: 'Underwater', cat: 'Space', fx: { eq: { low: 4, mid: 0, high: -8 }, highpass: 0, lowpass: 900, comp: false, limit: false, denoise: false, loudnorm: false, echo: { delay: 130, decay: 0.3 }, pitch: -1 } },
  { id: 'cleanup', name: 'Clean Up', cat: 'Restore', fx: { eq: { low: 0, mid: 0, high: -2 }, highpass: 60, lowpass: 0, comp: false, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'dehum', name: 'De-Hum', cat: 'Restore', fx: { eq: { low: -6, mid: 0, high: 0 }, highpass: 100, lowpass: 0, comp: false, limit: false, denoise: true, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'room-fix', name: 'Room Fix', cat: 'Restore', fx: { eq: { low: -3, mid: 2, high: 0 }, highpass: 80, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'tape-rescue', name: 'Tape Rescue', cat: 'Restore', fx: { eq: { low: 1, mid: 0, high: 3 }, highpass: 0, lowpass: 8000, comp: false, limit: false, denoise: true, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'wind-guard', name: 'Wind Guard', cat: 'Restore', fx: { eq: { low: -5, mid: 1, high: 0 }, highpass: 180, lowpass: 0, comp: true, limit: false, denoise: true, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'level-rescue', name: 'Level Rescue', cat: 'Restore', fx: { eq: { low: 0, mid: 1, high: 0 }, highpass: 40, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'broadcast', name: 'Broadcast Loud', cat: 'Dynamics', fx: { eq: { low: 2, mid: 1, high: 1 }, highpass: 50, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'gentle-glue', name: 'Gentle Glue', cat: 'Dynamics', fx: { eq: { low: 1, mid: 0, high: 1 }, highpass: 0, lowpass: 0, comp: true, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'punch', name: 'Punch', cat: 'Dynamics', fx: { eq: { low: 3, mid: -1, high: 3 }, highpass: 0, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: false, echo: null, pitch: 0 } },
  { id: 'night-mode', name: 'Night Mode', cat: 'Dynamics', fx: { eq: { low: 0, mid: 0, high: -3 }, highpass: 0, lowpass: 6000, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
  { id: 'max-loud', name: 'Max Loudness', cat: 'Dynamics', fx: { eq: { low: 4, mid: 2, high: 4 }, highpass: 30, lowpass: 0, comp: true, limit: true, denoise: false, loudnorm: true, echo: null, pitch: 0 } },
];

// The preset packs, in shelf order (10/10 step 3). Every preset names its pack in `cat`.
export const PRESET_CATS = ['Voice', 'Space', 'Restore', 'Dynamics'];

const DEFAULTS = {
  eq: { low: 0, mid: 0, high: 0 }, highpass: 0, lowpass: 0,
  comp: false, limit: false, denoise: false, loudnorm: false, echo: null, pitch: 0,
};

// Fill every field so a stored partial audioFx can be compared to a preset.
export function normalizeAudioFx(fx) {
  const f = fx || {};
  return {
    eq: { ...DEFAULTS.eq, ...(f.eq || {}) },
    highpass: f.highpass || 0,
    lowpass: f.lowpass || 0,
    comp: !!f.comp,
    limit: !!f.limit,
    denoise: !!f.denoise,
    loudnorm: !!f.loudnorm,
    echo: f.echo ? { delay: f.echo.delay ?? 180, decay: f.echo.decay ?? 0.3 } : null,
    pitch: f.pitch || 0,
  };
}

export const audioFxEquals = (a, b) => JSON.stringify(normalizeAudioFx(a)) === JSON.stringify(normalizeAudioFx(b));

// The preset matching the clip's current settings, if any (drives the active chip).
export function activePreset(fx) {
  return AUDIO_PRESETS.find((p) => audioFxEquals(fx, p.fx)) || null;
}
