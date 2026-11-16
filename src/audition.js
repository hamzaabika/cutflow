// Sound-browser audition helpers (MisterHorse P2-4): pitch and reverse
// previews for licensed library audio. Audition only — adding a sound to the
// timeline still uses the original file, never the pitched or reversed
// preview. No synthesized sounds are involved: the pitch is the Audio
// element's own playbackRate with preservesPitch off, and the reverse is the
// existing FFmpeg areverse derivative (electron/reverse.cjs) through the
// reverseRun IPC that the clip context menu already uses.
export const AUDITION_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Reverse holds the whole segment in memory, so the audition reverses at
// most the first 20 seconds — the same cap as the clip reverse.
export const REVERSE_AUDITION_SECONDS = 20;

// The [from, to] window the reverse audition renders for a sound of the
// given duration (unknown durations audition the first 20 seconds).
export function reverseAuditionWindow(duration) {
  const d = Number(duration);
  const to = Math.min(Number.isFinite(d) && d > 0 ? d : REVERSE_AUDITION_SECONDS, REVERSE_AUDITION_SECONDS);
  return { from: 0, to };
}

// The item shape reverseRun expects for a pure-audio file.
export function reverseAuditionItem(path, duration) {
  return { path, duration: duration || REVERSE_AUDITION_SECONDS, type: 'audio' };
}
