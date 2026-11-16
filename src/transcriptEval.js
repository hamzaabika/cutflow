// WER / CER benchmark harness (P1-33 / P1-34, Roadmap AI-03/AI-04).
// The metric code is complete; the SAMPLES are deliberately not here.
// Decision #7 (gap-build list): Darija caption evaluation needs Hamza's
// opt-in samples. This module reads them from a JSON file when one exists:
//   { "samples": [{ "id": "...", "reference": "...", "hypothesis": "..." }] }
// and reports "no samples" otherwise — it never invents reference text.
// Usage: node scripts/test-transcript-eval.cjs [--samples path/to/samples.json]

// Levenshtein distance over token arrays (words for WER, characters for CER).
function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const normWords = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter(Boolean);
const normChars = (s) => [...String(s || '').toLowerCase().replace(/\s+/g, ' ')].filter((c) => c !== ' ');

// Word error rate: (substitutions + deletions + insertions) / reference words.
export function wer(reference, hypothesis) {
  const ref = normWords(reference);
  const hyp = normWords(hypothesis);
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}
// Character error rate: same, over characters (spaces ignored).
export function cer(reference, hypothesis) {
  const ref = normChars(reference);
  const hyp = normChars(hypothesis);
  if (!ref.length) return hyp.length ? 1 : 0;
  return levenshtein(ref, hyp) / ref.length;
}
export function evaluateTranscript(reference, hypothesis) {
  return { wer: wer(reference, hypothesis), cer: cer(reference, hypothesis) };
}
// Aggregate over a samples list; returns null when there are no samples.
export function evaluateSamples(samples) {
  const list = (samples || []).filter((s) => s && typeof s.reference === 'string' && typeof s.hypothesis === 'string');
  if (!list.length) return null;
  const rows = list.map((s) => ({ id: s.id || '', ...evaluateTranscript(s.reference, s.hypothesis) }));
  const mean = (k) => rows.reduce((n, r) => n + r[k], 0) / rows.length;
  return { n: rows.length, meanWer: mean('wer'), meanCer: mean('cer'), rows };
}
