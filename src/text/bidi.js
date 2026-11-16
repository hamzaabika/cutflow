// Bidi layout for mixed Arabic/Darija + Latin text (P2-38, UX-06). Pure —
// no DOM, no canvas, no imports — so the test suite can exercise it in
// plain Node. The canvas renderer (src/text/render.js) calls bidiVisualOrder
// for every laid-out line.
//
// The old layout reversed EVERY word of an RTL line, which scrambles any
// Latin run longer than one word ("شاهد Cutflow Pro الآن" came out
// "Pro Cutflow" backwards) and strands numbers and punctuation on the wrong
// side of the run they belong to. This follows the Unicode Bidi Algorithm's
// shape instead: words group into directional runs, weak items (digits,
// punctuation-only words) attach to the run before them, runs order by
// paragraph direction, and words inside a run keep their own direction's
// order (LTR runs read left-to-right, RTL runs right-to-left).
export const RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LATIN_STRONG = /[A-Za-zÀ-ɏ]/;
const DIGIT = /[0-9٠-٩]/;

export function wordDir(word) {
  for (const ch of word) {
    if (RTL_RE.test(ch)) return 'rtl';
    if (LATIN_STRONG.test(ch)) return 'ltr';
    if (DIGIT.test(ch)) return 'num';
  }
  return 'punct';
}

// Trailing punctuation glued to a word ("2026!", "حالك؟", "Cutflow!").
// Returns { core, punct } when the word ends with punctuation/symbols
// after a real core, else null. A word that IS only punctuation ("!") is
// already its own item and is left alone, and a trailing diacritic
// (a mark, not punctuation) never splits — "مَرْحَبًا" stays whole.
export function splitTrailingPunct(text) {
  if (!text) return null;
  const m = text.match(/^(.*[\p{L}\p{N}\p{M}])([\p{P}\p{S}]+)$/u);
  if (!m) return null;
  return { core: m[1], punct: m[2] };
}

// Visual (left-to-right paint) order of a line's words ({ text, w, i }).
export function bidiVisualOrder(words, rtl) {
  const runs = [];
  words.forEach((wd, wi) => {
    const d = wordDir(wd.text);
    if ((d === 'num' || d === 'punct') && runs.length) {
      // B-UX9: a punctuation item at the very end of an RTL line is a
      // paragraph-end neutral — it belongs to the line end, not to the
      // word before it ("مرحبا Cutflow 2026!" ends with the ! at the far
      // left, like the browser's own bidi, not glued to the 2026).
      // Numbers still attach: "الحلقة 12" keeps 12 with الحلقة.
      if (d === 'punct' && rtl && wi === words.length - 1) {
        runs.push({ dir: 'rtl', words: [wd] });
      } else {
        runs[runs.length - 1].words.push(wd);
      }
    } else if (d === 'num' || d === 'punct') {
      // A leading weak item has no run before it: it opens a run in the
      // paragraph's own direction.
      runs.push({ dir: rtl ? 'rtl' : 'ltr', words: [wd] });
    } else if (runs.length && runs[runs.length - 1].dir === d) {
      runs[runs.length - 1].words.push(wd);
    } else {
      runs.push({ dir: d, words: [wd] });
    }
  });
  const orderedRuns = rtl ? [...runs].reverse() : runs;
  return orderedRuns.flatMap((r) => (r.dir === 'rtl' ? [...r.words].reverse() : r.words));
}
