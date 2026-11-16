// Caption proofreading (FB-25 / P1-34): correct proper nouns, punctuation
// and timing, with speaker labels on caption clips. The same file also
// carries the Darija eval metrics (WER/CER + normalisation), shared with
// scripts/eval-darija.mjs so the harness and the app never drift apart.

// --- caption rows -------------------------------------------------------
export function captionRows(project) {
  return (project.textClips || [])
    .filter((c) => c.caption)
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      id: c.id, text: c.text || '', start: c.start, end: c.start + c.duration,
      speaker: c.speaker || '', words: (c.words || []).map((w) => ({ text: w.text, start: w.start, end: w.end })),
    }));
}

// --- word re-alignment --------------------------------------------------
// After a text edit, keep every unchanged word's timing and interpolate
// the new/changed words between their matched neighbours, so a one-word
// fix does not throw away the whole clip's karaoke timings. LCS over the
// word lists; unmatched new words share the gap between the surrounding
// matched words (or the clip edge).
const splitWords = (text) => String(text || '').trim().split(/\s+/).filter(Boolean);

function lcsPairs(a, b) {
  const m = a.length; const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0; let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { pairs.push([i, j]); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return pairs;
}

export function realignWords(oldWords, oldText, newText) {
  const oldList = splitWords(oldText);
  const newList = splitWords(newText);
  if (!oldList.length || !newList.length) return [];
  // oldWords are parallel to oldList when they exist; fall back to the
  // raw text when a clip has no word timings at all.
  const timed = oldWords && oldWords.length === oldList.length ? oldWords : null;
  if (!timed) return [];
  const pairs = lcsPairs(oldList, newList);
  const matchedNew = new Map(pairs.map(([oi, ni]) => [ni, timed[oi]]));
  const out = new Array(newList.length).fill(null);
  pairs.forEach(([oi, ni]) => { out[ni] = { text: newList[ni], start: timed[oi].start, end: timed[oi].end }; });
  // Fill the gaps: each unmatched run shares the span between its matched
  // neighbours (or the clip edge, using the first/last matched word).
  let k = 0;
  while (k < newList.length) {
    if (out[k]) { k += 1; continue; }
    const runStart = k;
    while (k < newList.length && !out[k]) k += 1;
    const runEnd = k; // exclusive
    const before = runStart > 0 ? out[runStart - 1] : null;
    const after = runEnd < newList.length ? out[runEnd] : null;
    const spanStart = before ? before.end : 0;
    const spanEnd = after ? after.start : (timed[timed.length - 1]?.end ?? spanStart + 0.4);
    const span = Math.max(0.05, spanEnd - spanStart);
    const count = runEnd - runStart;
    for (let q = 0; q < count; q += 1) {
      out[runStart + q] = {
        text: newList[runStart + q],
        start: spanStart + (span * q) / count,
        end: spanStart + (span * (q + 1)) / count,
      };
    }
  }
  return out;
}

// --- flags --------------------------------------------------------------
const END_PUNCT = /[.!؟?،,;:…]$/u;
export function punctuationFlag(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  return END_PUNCT.test(t) ? null : 'missingEnd';
}

export const DEFAULT_NAMES = ['Cutflow', 'CapCut', 'Premiere Pro', 'Nettworki', 'Hamza', 'WhatsApp', 'Instagram', 'TikTok', 'YouTube'];

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// A token that is one or two edits away from a known name is probably a
// mistyped proper noun (e.g. "Katflo" for "Cutflow", "Capcut" for
// "CapCut"). Exact matches are fine; anything farther away is left alone.
export function nameFlags(text, names = DEFAULT_NAMES) {
  const out = [];
  const tokens = splitWords(text);
  for (const token of tokens) {
    const clean = token.replace(/[.,!?؟،;:…()«»"']/g, '');
    if (clean.length < 4) continue;
    for (const name of names) {
      const first = name.split(/\s+/)[0];
      if (clean.toLowerCase() === first.toLowerCase()) break;
      if (levenshtein(clean.toLowerCase(), first.toLowerCase()) <= 2) {
        out.push({ token: clean, suggest: name });
        break;
      }
    }
  }
  return out;
}

// --- Darija eval metrics ------------------------------------------------
// Normalisation for scoring only (the reference text is never rewritten):
// strip punctuation and Arabic diacritics, fold alef variants to ا,
// teh marbuta to ه, alef maksura to ي, and collapse whitespace. Latin
// brand names are lowercased. The raw texts stay in the report so the
// normalisation can be audited.
export function normalizeDarija(text) {
  return String(text || '')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[.,!?؟،;:…()«»"'\-–—]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

function editDistance(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const cur = [i];
    for (let j = 1; j <= n; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Word error rate: substitutions + deletions + insertions over reference
// words. Returns { wer, subs, dels, ins, refWords }.
export function wer(ref, hyp) {
  const r = normalizeDarija(ref).split(' ').filter(Boolean);
  const h = normalizeDarija(hyp).split(' ').filter(Boolean);
  if (!r.length) return { wer: h.length ? 1 : 0, subs: 0, dels: 0, ins: h.length, refWords: 0 };
  const d = editDistance(r, h);
  // A plain edit distance counts a substitution as 1 (not 2), which is
  // exactly what WER wants; the split into sub/del/ins needs the alignment.
  const m = r.length; const n = h.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    }
  }
  let i = m; let j = n; let subs = 0; let dels = 0; let ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && r[i - 1] === h[j - 1]) { i -= 1; j -= 1; }
    else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) { subs += 1; i -= 1; j -= 1; }
    else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { dels += 1; i -= 1; }
    else { ins += 1; j -= 1; }
  }
  return { wer: d / r.length, subs, dels, ins, refWords: r.length };
}

// Character error rate over the normalised strings (spaces removed).
export function cer(ref, hyp) {
  const r = normalizeDarija(ref).replace(/\s+/g, '');
  const h = normalizeDarija(hyp).replace(/\s+/g, '');
  if (!r.length) return { cer: h.length ? 1 : 0, refChars: 0 };
  return { cer: editDistance([...r], [...h]) / [...r].length, refChars: [...r].length };
}
