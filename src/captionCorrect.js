// Arabic / Darija caption correction (gap-build Stream E, AI-04).
//
// A deterministic, rule-based proofreader for caption text — no model, no
// network, nothing leaves the PC. It fixes what ASR actually gets wrong
// (stray diacritics, tatweel, doubled words, punctuation spacing, the
// classic "انشاء الله" class of errors, detached single-letter prefixes)
// and deliberately does NOT "fix" Darija into Fusha: هادا / هادي / ديال /
// باش / غادي / دابا / كاين stay exactly as spoken. Every change is
// reported ({ from, to, rule }) so the panel can show what was corrected
// and the user can undo the whole pass in one step.
//
// What it does not do: it cannot know whether "علي" is the name Ali or the
// preposition "على", or whether a final ه is a ة — those stay untouched
// rather than guessed. The WER/CER benchmark (scripts/bench-caption-wer.mjs)
// measures the correction against Hamza's own reference samples when he
// opts them in (decision #7); until then the harness reports "awaiting
// samples" and no accuracy number is claimed.
const DIACRITICS = /[ًٌٍَُِّْٰ]/g;
const TATWEEL = /ـ/g;

// Classic misspellings ASR produces (word-boundary matched).
const CONFUSIONS = [
  ['انشاء الله', 'إن شاء الله'],
  ['ان شاء الله', 'إن شاء الله'],
  ['مشاء الله', 'ما شاء الله'],
  ['مشا الله', 'ما شاء الله'],
  ['الله اكبر', 'الله أكبر'],
  ['الله واكبر', 'الله أكبر'],
  ['انشاءالله', 'إن شاء الله'],
  ['ماشاء الله', 'ما شاء الله'],
];

// Single letters that attach to the following word in Arabic orthography
// (conjunction و, prepositions ف / ب / ل). "و قال" -> "وقال".
const ATTACH = /(?<![\p{L}\p{N}])([وفب])\s+([\p{L}])/gu;
const LAM_ATTACH = /(?<![\p{L}\p{N}])ل\s+(ال[\p{L}]+)/gu;

export function correctCaptionText(input) {
  const changes = [];
  const note = (from, to, rule) => { if (from !== to) changes.push({ from, to, rule }); };
  let text = String(input || '');
  const step = (next, rule, from = text) => { note(from, next, rule); return next; };

  // 1. Stray diacritics + tatweel (ASR inserts both; captions never print them).
  text = step(text.replace(DIACRITICS, '').replace(TATWEEL, ''), 'diacritics');
  // 2. Classic misspellings.
  for (const [wrong, right] of CONFUSIONS) {
    const re = new RegExp(wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    if (re.test(text)) text = step(text.replace(re, right), 'spelling', text);
  }
  // 3. Punctuation spacing: no space before ، . ؟ ! : ; , one space after.
  {
    const before = text;
    text = text.replace(/\s+([،.؟!,:;])/g, '$1').replace(/([،.؟!,:;])(?=[^\s،.؟!,:;])/g, '$1 ');
    text = step(text, 'punctuation', before);
  }
  // 4. Collapsed repeated punctuation.
  {
    const before = text;
    text = text.replace(/([.؟!])\1{2,}/g, '$1$1').replace(/،{2,}/g, '،');
    text = step(text, 'punctuation', before);
  }
  // 5. Doubled words ("قال قال") — the ASR stutter duplicate.
  {
    const before = text;
    text = text.replace(/(?<![\p{L}\p{N}])([\p{L}\p{N}]{2,})(?:\s+\1(?![\p{L}\p{N}]))+/gu, '$1');
    text = step(text, 'duplicate', before);
  }
  // 6. Detached single-letter prefixes attach to the next word.
  {
    const before = text;
    text = text.replace(ATTACH, '$1$2').replace(LAM_ATTACH, (_, w) => `لل${w.slice(2)}`); // "ل الدار" -> "للدار"
    text = step(text, 'prefix', before);
  }
  // 7. Whitespace: collapse + trim.
  {
    const before = text;
    text = text.replace(/\s+/g, ' ').trim();
    text = step(text, 'spacing', before);
  }
  return { text, changes };
}

// Apply correction to one caption clip, keeping the word timings: the
// corrected words map onto the old word timings by position when the word
// count is unchanged; when it changed (a duplicate was removed, a prefix
// attached), timings are shared out by word length over the clip span.
export function correctClip(clip) {
  const { text, changes } = correctCaptionText(clip?.text || '');
  if (!changes.length) return { patch: null, changes };
  const oldWords = (clip.words || []).map((w) => ({ ...w }));
  const newWords = text.split(/\s+/).filter(Boolean);
  let words = oldWords;
  if (oldWords.length && newWords.length === oldWords.length) {
    words = oldWords.map((w, i) => ({ ...w, text: newWords[i] }));
  } else if (oldWords.length && newWords.length) {
    const total = newWords.reduce((n, w) => n + w.length, 0) || 1;
    const span = (clip.duration || 0);
    let t = 0;
    words = newWords.map((w) => {
      const d = (span * w.length) / total;
      const out = { text: w, start: t, end: t + d };
      t += d;
      return out;
    });
  }
  return { patch: { text, words }, changes };
}

// ---- WER / CER (benchmark harness) ----
// Word error rate / character error rate: Levenshtein distance over words
// (or characters) divided by the reference length. Arabic-normalised
// comparison (alef forms, teh marbuta, diacritics) is the default, so a
// correction that only normalises spelling is not scored as an error.
export function normalizeForEval(s) {
  return String(s || '')
    .replace(DIACRITICS, '').replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function wer(reference, hypothesis, { normalize = true } = {}) {
  const ref = (normalize ? normalizeForEval(reference) : String(reference || '').trim()).split(/\s+/).filter(Boolean);
  const hyp = (normalize ? normalizeForEval(hypothesis) : String(hypothesis || '').trim()).split(/\s+/).filter(Boolean);
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}

export function cer(reference, hypothesis, { normalize = true } = {}) {
  const ref = normalize ? normalizeForEval(reference) : String(reference || '');
  const hyp = normalize ? normalizeForEval(hypothesis) : String(hypothesis || '');
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein([...ref], [...hyp]) / [...ref].length;
}

// Score one sample { reference, hypothesis }: WER/CER before and after correction.
export function scoreSample(sample) {
  const corrected = correctCaptionText(sample.hypothesis || '').text;
  return {
    werBefore: wer(sample.reference, sample.hypothesis),
    werAfter: wer(sample.reference, corrected),
    cerBefore: cer(sample.reference, sample.hypothesis),
    cerAfter: cer(sample.reference, corrected),
    corrected,
  };
}
