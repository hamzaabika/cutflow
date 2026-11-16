// Which file carries a clip's sound in the preview: the AudioFx derivative when one is
// rendered for the clip's current settings / range / source, else the Voice Enhancer's
// file when it is on, else the media itself. The export resolves the same order in
// electron/ffmpeg.cjs (audioFxPathOf / enhancePathOf) — the validity rules below mirror
// it field for field, so the two sides can never disagree about which sound is current.
import { audioFxFilters } from './audioFxChain.js';

// The Voice Enhancer's cached file for a clip, when on and rendered for the clip's
// current range (a re-trim makes it stale and inert, exactly as in the export).
export function enhancePathOf(clip) {
  const e = clip && clip.enhance;
  if (!e || !e.on || !e.path) return null;
  if (Math.abs((e.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((e.to ?? -1) - (clip.out ?? -1)) > 0.02) return null;
  return e.path;
}

// The stored AudioFx derivative record for a clip, when still valid: same chain as the
// clip's current audioFx produce, same range, rendered from the clip's current sound
// source (the enhanced file when Voice Enhance replaces the sound, else the media file).
export function audioFxRenderOf(clip, media) {
  const r = clip && clip.audioFxRender;
  if (!r || !r.path || !r.chain) return null;
  if (audioFxFilters(clip.audioFx).join(',') !== r.chain) return null;
  if (Math.abs((r.from ?? -1) - (clip.in || 0)) > 0.02 || Math.abs((r.to ?? -1) - (clip.out ?? -1)) > 0.02) return null;
  const src = enhancePathOf(clip) || (media && media.path);
  if (src && r.src !== src) return null;
  return r;
}

export const audioFxPathOf = (clip, media) => {
  const r = audioFxRenderOf(clip, media);
  return r ? r.path : null;
};

// What a derivative render must process for a clip: the enhanced file's whole span
// (its timeline starts at the clip's in-point) when Voice Enhance replaces the sound,
// else the media range [clip.in, clip.out].
export function audioFxSourceFor(clip, media) {
  const ep = enhancePathOf(clip);
  if (ep) return { srcPath: ep, from: 0, to: (clip.out ?? 0) - (clip.in || 0), channels: 2 };
  if (!media) return null;
  return { srcPath: media.path, from: clip.in || 0, to: clip.out ?? media.duration, channels: media.channels || 2 };
}
