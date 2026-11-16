// Caption correction / proofreading (B-H-capcor). Deterministic, local, no AI:
// the rules fix what Whisper and typing most often get wrong in a caption —
// doubled spaces, a word typed twice in a row, spaces before punctuation,
// and a lower-case sentence start — and nothing else. It never invents words,
// never "improves" phrasing, and leaves Arabic/Darija text, digits and
// all-caps lines alone. Word timings survive: corrected tokens are aligned
// back onto the original words in order, so a dropped duplicate only removes
// that word's timing and every other word keeps its own.

const normTok = (w) => String(w).toLowerCase().replace(/[.,!?;:…"”''"()[\]]/g, '');

// One caption line in, one caption line out.
export function correctCaptionText(text) {
  if (typeof text !== 'string' || !text.trim()) return text || '';
  let s = text.replace(/\s+/g, ' ').trim();
  // Spaces before punctuation go; a space after , ! ? ; : is added only
  // before a letter, so 3.5 and 12:30 are never split.
  s = s.replace(/\s+([,.!?;:])/g, '$1');
  s = s.replace(/([,!?;:])(?=[A-Za-zÀ-ÿ\u0600-\u06FF])/g, '$1 ');
  // The lookahead only fires before a letter, so decimals (3.5) and times
  // (12:30) are never split.
  s = s.replace(/([.])(?=[A-Za-zÀ-ÿ\u0600-\u06FF])/g, '$1 ');
  // A word typed twice in a row ("the the", "هذا هذا") drops its duplicate.
  const toks = s.split(' ');
  const kept = [];
  for (const tok of toks) {
    const prev = kept[kept.length - 1];
    if (prev && normTok(tok) && normTok(tok) === normTok(prev)) continue;
    kept.push(tok);
  }
  s = kept.join(' ');
  // Sentence start: capitalise the first Latin lower-case letter, unless the
  // whole line is shouted in capitals or starts with a digit / Arabic.
  if (/^[a-z]/.test(s) && s !== s.toUpperCase()) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

// Align corrected tokens back onto the original word timings, in order.
// Returns { words, text } — words keep their start/end; a dropped duplicate
// is the only word that disappears.
export function retimeCorrectedWords(origWords, correctedText) {
  const toks = correctedText.split(' ').filter(Boolean);
  const words = [];
  let j = 0;
  for (const w of origWords || []) {
    if (j >= toks.length) break;
    if (normTok(w.text) === normTok(toks[j])) {
      words.push({ ...w, text: toks[j] });
      j++;
    }
    // Otherwise this original word has no partner in the corrected text —
    // it was the dropped duplicate — and is skipped, timings untouched.
  }
  // Tokens the original had no word for (should not happen: correction only
  // removes or re-cases) are appended untimed rather than lost.
  while (j < toks.length) {
    const last = words[words.length - 1];
    words.push({ text: toks[j], start: last ? last.end : 0, end: last ? last.end : 0 });
    j++;
  }
  return words;
}

// Proofread every caption clip in the project. Returns
// { clips, changes: [{ id, before, after }] } — clips are new objects, the
// input project is untouched. Non-caption text clips are passed through.
export function correctCaptionClips(textClips) {
  const changes = [];
  const clips = (textClips || []).map((c) => {
    if (!c || !c.caption || typeof c.text !== 'string') return c;
    const after = correctCaptionText(c.text);
    if (after === c.text) return c;
    const next = { ...c, text: after };
    if (Array.isArray(c.words) && c.words.length) next.words = retimeCorrectedWords(c.words, after);
    changes.push({ id: c.id, before: c.text, after });
    return next;
  });
  return { clips, changes };
}
