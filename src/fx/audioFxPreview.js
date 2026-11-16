// Which file carries a clip's sound in the preview: the AudioFx derivative when one is
// rendered for the clip's current settings / range / source, else the Voice Enhancer's
// file when it is on, else the media itself. The export resolves the same order in
// electron/ffmpeg.cjs (audioFxPathOf / enhancePathOf) — the validity rules below mirror
// it field for field, so the two sides can never disagree about which sound is current.
import { cleanVoiceChain, hasAudioFx, hasCleanVoice, hasRepair } from './audioFxChain.js';

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
  if (cleanVoiceChain(clip.cleanVoice, clip.audioFx, clip.repair) !== r.chain) return null;
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

// P1-13 — the audition slice: the same chain, but only a short window of the clip's
// sound, so a preset change is heard in ~1 s instead of after a full-clip render.
// The window is located by SOURCE offset (srcOff = sourceOffsetAt(clip, local time)):
// the derivative file's timeline runs in source offsets from the clip's in-point, so
// a slice starting at source offset srcOff0 plays at file offset (srcOff - srcOff0).
// srcOff0 is stored on the record so the preview can shift by exactly that much, and
// so a re-trim (clip.in moves) invalidates the slice the same way it invalidates the
// full render. The export never sees a slice: it reads audioFxPathOf only.
export const AUDIO_FX_SLICE_SECONDS = 6;

export function audioFxSliceSourceFor(clip, media, srcOff) {
  if (!media || !Number.isFinite(srcOff) || srcOff < 0) return null;
  const clipLen = Math.max(0, (clip.out ?? 0) - (clip.in || 0));
  if (srcOff >= clipLen) return null;
  const ep = enhancePathOf(clip);
  if (ep) {
    return { srcPath: ep, from: srcOff, to: Math.min(srcOff + AUDIO_FX_SLICE_SECONDS, clipLen), channels: 2, srcOff0: srcOff };
  }
  const end = clip.out ?? media.duration;
  if (end == null || srcOff >= (end - (clip.in || 0))) return null;
  return { srcPath: media.path, from: (clip.in || 0) + srcOff, to: Math.min((clip.in || 0) + srcOff + AUDIO_FX_SLICE_SECONDS, end), channels: media.channels || 2, srcOff0: srcOff };
}

// The stored slice record for a clip, when it is still the current chain, still the
// current sound source, still aligned with the clip's in-point, and covering the
// source offset the playhead is at now. Returns { path, delta } where delta is added
// to the derivative file offset the preview already computes (srcOff) — the slice's
// file starts srcOff0 into the clip, so it plays at srcOff - srcOff0.
export function audioFxSliceOf(clip, media, srcOff) {
  const r = clip && clip.audioFxSlice;
  if (!r || !r.path || !r.chain || !Number.isFinite(r.srcOff0)) return null;
  if (cleanVoiceChain(clip.cleanVoice, clip.audioFx, clip.repair) !== r.chain) return null;
  const src = enhancePathOf(clip) || (media && media.path);
  if (src && r.src !== src) return null;
  // A re-trim moved the clip's in-point: the slice's source window no longer starts
  // where the record says it does. Media source: from == clip.in + srcOff0.
  // Enhanced source: the file's timeline starts at the in-point, so from == srcOff0.
  if (enhancePathOf(clip)) {
    if (Math.abs((r.from ?? -1) - r.srcOff0) > 0.02) return null;
  } else if (Math.abs((r.from ?? -1) - (clip.in || 0) - r.srcOff0) > 0.02) {
    return null;
  }
  if (!Number.isFinite(srcOff)) return null;
  const len = Math.max(0, (r.to ?? r.from ?? 0) - (r.from ?? 0));
  if (srcOff < r.srcOff0 - 0.02 || srcOff >= r.srcOff0 + len) return null;
  return { path: r.path, delta: -r.srcOff0 };
}

// Any slice for the current chain / source / in-point (no playhead needed): the
// panel's "auditioning" state.
export function audioFxSliceValid(clip, media) {
  const r = clip && clip.audioFxSlice;
  if (!r || !r.path || !r.chain || !Number.isFinite(r.srcOff0)) return false;
  if (cleanVoiceChain(clip.cleanVoice, clip.audioFx, clip.repair) !== r.chain) return false;
  const src = enhancePathOf(clip) || (media && media.path);
  if (src && r.src !== src) return false;
  if (enhancePathOf(clip)) return Math.abs((r.from ?? -1) - r.srcOff0) <= 0.02;
  return Math.abs((r.from ?? -1) - (clip.in || 0) - r.srcOff0) <= 0.02;
}

// The AudioFx panel's preview state: 'ready' (full derivative), 'slice' (a short
// audition of the new chain while the full render lands), 'pending' (no render yet),
// null (no effects on the clip).
export function audioFxPreviewState(clip, media) {
  if (!hasAudioFx(clip && clip.audioFx) && !hasCleanVoice(clip && clip.cleanVoice) && !hasRepair(clip && clip.repair)) return null;
  if (audioFxPathOf(clip, media)) return 'ready';
  if (audioFxSliceValid(clip, media)) return 'slice';
  return 'pending';
}

// Which file carries a clip's sound in the preview, with the file offset to play it
// from: the full derivative first, then a covering slice, then the Voice Enhancer's
// file. Returns { path, delta } (file offset = srcOff + delta) or null for the
// original sound. The export resolves the same order minus the slice.
export function substitutedSoundOf(clip, media, srcOff) {
  const full = audioFxPathOf(clip, media);
  if (full) return { path: full, delta: 0 };
  const slice = audioFxSliceOf(clip, media, srcOff);
  if (slice) return slice;
  const enh = enhancePathOf(clip);
  if (enh) return { path: enh, delta: 0 };
  return null;
}
