// Darija caption eval harness (FB-25 / P1-34).
// Scores the LOCAL Whisper base model against the dictated-script eval
// set in scripts/darija-eval-set.json — Hamza's own voice, local material
// only, no downloads. Timed samples (ecom, promo) are scored by time
// window and also yield a timestamp error; untimed samples (nettworki-v1,
// script.md has no timings) are scored by a global word-level alignment
// across the whole file, in script order. Turbo and Darija models are NOT
// evaluated: their files are not present locally and the task forbids
// downloading models for the eval set — the report records that instead
// of guessing.
// Usage: node scripts/eval-darija.mjs [--model base]
// Output: scripts/darija-eval-results.json + a console table.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const whisper = require('../electron/whisper.cjs');
const ff = require('../electron/ffmpeg.cjs');
const { wer, cer, normalizeDarija } = await import('../src/proofread.js');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SET_PATH = path.join(ROOT, 'scripts', 'darija-eval-set.json');
const OUT_PATH = path.join(ROOT, 'scripts', 'darija-eval-results.json');
const WORK = path.join(os.homedir(), 'workspace', '.tmp-battery', 'darija-eval');
const WHISPER_DIR = process.env.FVE_WHISPER_DIR || path.join(os.homedir(), '.config', 'ClipCraft', 'whisper');
const MODEL = process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : 'base';

const set = JSON.parse(fs.readFileSync(SET_PATH, 'utf8'));
fs.mkdirSync(WORK, { recursive: true });

const st = whisper.status(WHISPER_DIR);
if (!st.installed) throw new Error(`Whisper engine not installed in ${WHISPER_DIR} — run the app's captions once first.`);
if (!st.models[MODEL]) throw new Error(`Model ${MODEL} is not downloaded locally (only base is cached). Not evaluated — see docs/darija-eval.md.`);

// Word-level alignment of the concatenated reference (in script order)
// against the hypothesis word stream: returns, per reference unit, the
// hypothesis words aligned to it (substitutions/insertions included).
function alignSlices(refUnits, hypWords) {
  const refTokens = [];
  refUnits.forEach((u, ui) => {
    normalizeDarija(u.text).split(' ').filter(Boolean).forEach((tok) => refTokens.push({ tok, unit: ui }));
  });
  const hypTokens = hypWords.map((w) => normalizeDarija(w.text)).filter(Boolean);
  const m = refTokens.length; const n = hypTokens.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (refTokens[i - 1].tok === hypTokens[j - 1] ? 0 : 1));
    }
  }
  // Backtrack: assign every hypothesis word to a reference unit. Matches
  // and substitutions attach to their reference token's unit; insertions
  // (hypothesis words with no reference token) attach to the next unit
  // that consumes a word, or the last unit if they come after everything.
  const hypUnit = new Array(n).fill(null);
  let i = m; let j = n;
  let pending = [];
  const flush = (unit) => { for (const hj of pending) hypUnit[hj] = unit; pending = []; };
  while (i > 0 && j > 0) {
    if (refTokens[i - 1].tok === hypTokens[j - 1]) { flush(refTokens[i - 1].unit); hypUnit[j - 1] = refTokens[i - 1].unit; i -= 1; j -= 1; }
    else if (dp[i][j] === dp[i - 1][j - 1] + 1) { flush(refTokens[i - 1].unit); hypUnit[j - 1] = refTokens[i - 1].unit; i -= 1; j -= 1; }
    else if (dp[i][j] === dp[i - 1][j] + 1) { i -= 1; }
    else { pending.push(j - 1); j -= 1; }
  }
  // Leftover hypothesis words before the first reference token.
  if (pending.length) flush(0);
  while (j > 0) { hypUnit[j - 1] = 0; j -= 1; }
  const hypIdxByUnit = Array.from({ length: refUnits.length }, () => []);
  hypUnit.forEach((unit, hj) => { if (unit != null) hypIdxByUnit[unit].push(hj); });
  return hypIdxByUnit.map((idxs) => idxs.map((k) => hypWords[k].text).join(' '));
}

const results = { model: MODEL, language: 'ar', created: new Date().toISOString(), set: set.name, sources: [], samples: [] };

for (const src of set.sources) {
  const wav = path.join(WORK, `${src.id}.wav`);
  if (!fs.existsSync(wav)) {
    execFileSync(ff.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', src.audio, '-vn', '-ac', '1', '-ar', '16000', wav]);
  }
  console.log(`transcribing ${src.id} (${src.audio}) with whisper/${MODEL}…`);
  const segments = await whisper.transcribe(WHISPER_DIR, wav, { language: 'ar', model: MODEL });
  const words = segments.flatMap((s) => s.words || []).sort((a, b) => a.start - b.start);
  const samples = set.samples.filter((s) => s.source === src.id);
  const timed = samples.filter((s) => s.start != null);
  const untimed = samples.filter((s) => s.start == null);
  const untimedHyp = untimed.length ? alignSlices(untimed, words) : [];

  for (const s of samples) {
    let hypText = ''; let startErr = null; let endErr = null;
    if (s.start != null) {
      const inWindow = words.filter((w) => {
        const mid = (w.start + w.end) / 2;
        return mid >= s.start - 0.3 && mid <= s.end + 0.3;
      });
      hypText = inWindow.map((w) => w.text).join(' ');
      if (inWindow.length) {
        startErr = Math.abs(inWindow[0].start - s.start);
        endErr = Math.abs(inWindow[inWindow.length - 1].end - s.end);
      }
    } else {
      hypText = untimedHyp[untimed.indexOf(s)] || '';
    }
    const w = wer(s.text, hypText);
    const c = cer(s.text, hypText);
    results.samples.push({
      id: s.id, source: s.source, ref: s.text, hyp: hypText,
      wer: +w.wer.toFixed(4), cer: +c.cer.toFixed(4), refWords: w.refWords,
      startErr: startErr == null ? null : +startErr.toFixed(3),
      endErr: endErr == null ? null : +endErr.toFixed(3),
    });
  }
  results.sources.push({ id: src.id, segments: segments.length, words: words.length });
}

const timed = results.samples.filter((s) => s.startErr != null);
const agg = (rows, key) => (rows.length ? rows.reduce((a, r) => a + r[key], 0) / rows.length : null);
const wordWeightedWer = results.samples.reduce((a, r) => a + r.wer * r.refWords, 0) / Math.max(1, results.samples.reduce((a, r) => a + r.refWords, 0));
results.aggregate = {
  samples: results.samples.length,
  meanWer: +(agg(results.samples, 'wer') || 0).toFixed(4),
  wordWeightedWer: +wordWeightedWer.toFixed(4),
  meanCer: +(agg(results.samples, 'cer') || 0).toFixed(4),
  meanStartErr: timed.length ? +(agg(timed, 'startErr')).toFixed(3) : null,
  meanEndErr: timed.length ? +(agg(timed, 'endErr')).toFixed(3) : null,
  timedSamples: timed.length,
};
results.notEvaluated = [
  { model: 'turbo', reason: 'ggml-large-v3-turbo-q5_0.bin not present locally; downloads forbidden for the eval set.' },
  { model: 'darija', reason: 'ggml-medium-darija-q5_0.bin not present locally; downloads forbidden for the eval set.' },
];
fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
console.log(`\n${'sample'.padEnd(14)} ${'WER'.padStart(6)} ${'CER'.padStart(6)} ${'startErr'.padStart(8)} ${'endErr'.padStart(7)}`);
for (const r of results.samples) {
  console.log(`${r.id.padEnd(14)} ${r.wer.toFixed(3).padStart(6)} ${r.cer.toFixed(3).padStart(6)} ${(r.startErr == null ? '—' : r.startErr.toFixed(2)).padStart(8)} ${(r.endErr == null ? '—' : r.endErr.toFixed(2)).padStart(7)}`);
}
console.log(`\nAGGREGATE n=${results.aggregate.samples} meanWER=${results.aggregate.meanWer} wordWeightedWER=${results.aggregate.wordWeightedWer} meanCER=${results.aggregate.meanCer} meanStartErr=${results.aggregate.meanStartErr ?? '—'}s meanEndErr=${results.aggregate.meanEndErr ?? '—'}s (timed n=${results.aggregate.timedSamples})`);
console.log(`wrote ${OUT_PATH}`);
