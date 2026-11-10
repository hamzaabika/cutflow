// Filler-word + long-pause detection for one-click cleanup (10/10 step 5,
// closing the §4 parity row with local parts only): the lexicons are data,
// matched against the generated captions' word timings; the ranges it returns
// are timeline seconds, ready for the same cutRanges action the transcript
// editor and the silence tool already use. Nothing here cuts — it detects.
import { flatWords, mergeRanges, transcriptSentences } from './transcript.js';

// Starter lexicons — genuinely empty speech sounds and discourse fillers,
// Arabic/Darija first (the audience), then English and French. Words match
// case-insensitively with punctuation and Arabic diacritics stripped.
export const FILLER_WORDS = {
  ar: ['يعني', 'آه', 'اه', 'إيه', 'ايه', 'أم', 'ام', 'أحم', 'احم', 'هاه'],
  en: ['um', 'uh', 'erm', 'er', 'ah', 'hmm'],
  fr: ['euh', 'hein', 'ben', 'bah'],
};
// Multi-word fillers, matched over consecutive words of the same caption clip.
export const FILLER_PHRASES = ['you know', 'tu vois'];

const ALL_FILLERS = new Set(Object.values(FILLER_WORDS).flat());

export const normalizeWord = (w) => String(w || '')
  .toLowerCase()
  .replace(/[ً-٭ٰ]/g, '') // Arabic harakat / tanwin
  .replace(/[.,!?؟،؛:;…"'«»“”‘’()[\]{}-]/g, '')
  .trim();

// Detect filler ranges and over-long pauses in the project's generated
// captions. Pauses are trimmed, not erased: 0.3 s of the gap always survives
// (0.15 s each side), so speech keeps its breath. Returns the merged cut
// ranges plus the counts the UI reports.
export function detectFillers(project, { fillers = true, pauses = true, minPause = 0.7 } = {}) {
  const words = flatWords(transcriptSentences(project)).filter((w) => w.end > w.start);
  const ranges = [];
  let fillerCount = 0;
  let pauseCount = 0;
  if (fillers) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (ALL_FILLERS.has(normalizeWord(w.text))) {
        ranges.push({ start: w.start, end: w.end });
        fillerCount++;
        continue;
      }
      // Phrases: consecutive words in the same clip spelling a filler phrase.
      for (const phrase of FILLER_PHRASES) {
        const parts = phrase.split(' ');
        if (i + parts.length > words.length) continue;
        const seq = words.slice(i, i + parts.length);
        if (seq.some((s) => s.clipId !== w.clipId)) continue;
        if (seq.map((s) => normalizeWord(s.text)).join(' ') === phrase) {
          ranges.push({ start: seq[0].start, end: seq[seq.length - 1].end });
          fillerCount++;
          i += parts.length - 1;
          break;
        }
      }
    }
  }
  if (pauses) {
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const next = words[i];
      // A pause lives inside one caption clip's speech — the gap between two
      // separate caption clips is just uncaptioned video, not dead air.
      if (prev.clipId !== next.clipId) continue;
      const gap = next.start - prev.end;
      if (gap >= minPause) {
        const start = prev.end + 0.15;
        const end = next.start - 0.15;
        if (end - start > 0.05) { ranges.push({ start, end }); pauseCount++; }
      }
    }
  }
  return { ranges: mergeRanges(ranges), fillerCount, pauseCount };
}
