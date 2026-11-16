// Clip audio effects for the EXPORT pipeline. The HTMLVideo preview cannot run ffmpeg
// filters, so these are applied only when rendering (the UI says so). Stored on the clip as
// clip.audioFx = { eq: {low, mid, high} (dB), highpass (Hz), lowpass (Hz), comp, limit,
// denoise, loudnorm, echo: {delay, decay}, pitch (semitones) }.
// Returns ffmpeg audio filter strings to splice into a chain that is already at 48 kHz.

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const num = (v) => String(Math.round(v * 1000) / 1000);

function audioFxFilters(fx) {
  if (!fx || typeof fx !== 'object') return [];
  const out = [];
  // Cut the rumble / hiss ends first, then shape with the EQ.
  const hp = clamp(fx.highpass ?? 0, 0, 1000);
  if (hp >= 20) out.push(`highpass=f=${Math.round(hp)}`);
  const lp = clamp(fx.lowpass ?? 0, 0, 20000);
  if (lp >= 1000 && lp < 20000) out.push(`lowpass=f=${Math.round(lp)}`);
  if (fx.eq) {
    const { low = 0, mid = 0, high = 0 } = fx.eq;
    if (low) out.push(`equalizer=f=100:width_type=o:width=2:g=${num(clamp(low, -15, 15))}`);
    if (mid) out.push(`equalizer=f=1000:width_type=o:width=2:g=${num(clamp(mid, -15, 15))}`);
    if (high) out.push(`equalizer=f=8000:width_type=o:width=2:g=${num(clamp(high, -15, 15))}`);
  }
  if (fx.comp) out.push('acompressor=threshold=0.125:ratio=4:attack=20:release=200:makeup=2');
  if (fx.limit) out.push('alimiter=limit=0.95:level=false');
  if (fx.denoise) out.push('afftdn=nr=12');
  if (fx.echo) {
    const delay = Math.round(clamp(fx.echo.delay ?? 180, 20, 900));
    const decay = num(clamp(fx.echo.decay ?? 0.3, 0.05, 0.8));
    out.push(`aecho=0.8:0.7:${delay}:${decay}`);
  }
  const semi = clamp(fx.pitch ?? 0, -12, 12);
  if (semi) {
    const ratio = Math.pow(2, semi / 12);
    // Shift the sample rate, resample back to 48 kHz, then restore the original tempo:
    // the pitch moves, the duration does not.
    out.push(`asetrate=${Math.round(48000 * ratio)}`, 'aresample=48000', `atempo=${num(1 / ratio)}`);
  }
  // Loudness last: single-pass loudnorm to the podcast/social target. It works at
  // 192 kHz internally, so resample back to the chain's 48 kHz right after it.
  if (fx.loudnorm) out.push('loudnorm=I=-14:TP=-1:LRA=11', 'aresample=48000');
  return out;
}

const hasAudioFx = (fx) => audioFxFilters(fx).length > 0;

// One-click "essentials" presets (essential-sound style). A preset is a COMPLETE
// audioFx object: every parameter it does not name is off/neutral, so applying one fully
// replaces the clip's audioFx. The renderer mirrors this table (src/fx/audioPresets.js);
// a test keeps the two in sync.
const AUDIO_FX_PRESETS = [
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

module.exports = { audioFxFilters, hasAudioFx, AUDIO_FX_PRESETS };
