// The AudioFx filter chain, mirrored for the renderer. This function is a deliberate
// copy of audioFxFilters in electron/audiofx.cjs (the export engine's canonical copy) —
// the renderer needs the identical chain string to validate a clip's preview derivative
// (clip.audioFxRender.chain) against its current settings. A suite
// (scripts/test-audiofx-preview.mjs) keeps the two byte-identical across a corpus of
// settings, the same arrangement as the audio presets mirror (fx/audioPresets.js).
// Stored on the clip as clip.audioFx = { eq: {low, mid, high} (dB), highpass (Hz),
// lowpass (Hz), comp, limit, denoise, loudnorm, echo: {delay, decay}, pitch (semitones) }.
// Returns ffmpeg audio filter strings for a chain that is already at 48 kHz.

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const num = (v) => String(Math.round(v * 1000) / 1000);

export function audioFxFilters(fx) {
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

export const hasAudioFx = (fx) => audioFxFilters(fx).length > 0;
