// Caption WER/CER benchmark harness (gap-build Stream E, AI-04).
//
//   node scripts/bench-caption-wer.mjs [--dir <samples-dir>]
//
// Samples are Hamza's own opt-in pairs (decision #7): one JSON file per
// sample, { reference, hypothesis, note? } — the reference is what he
// actually said (his corrected transcript), the hypothesis is what the
// transcription engine produced. The harness reports WER/CER before and
// after the rule-based correction, so a number only ever comes from his
// real audio, never from invented samples.
//
// With no samples directory (the expected state until he opts in), it
// prints AWAITING SAMPLES and exits 0 — a missing benchmark is reported,
// not faked.
import fs from 'node:fs';
import path from 'node:path';
import { scoreSample } from '../src/captionCorrect.js';

const DEFAULT_DIR = path.join(process.env.HOME || '', 'workspace/cutflow-audit-20261115/caption-eval-samples');

function loadSamples(dir) {
  if (!fs.existsSync(dir)) return { dir, samples: [], reason: 'no samples directory' };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const samples = [];
  const errors = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (typeof j.reference === 'string' && typeof j.hypothesis === 'string') samples.push({ file: f, ...j });
      else errors.push(`${f}: needs { reference, hypothesis } strings`);
    } catch (e) { errors.push(`${f}: ${e.message}`); }
  }
  return { dir, samples, errors };
}

const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const dir = dirFlag >= 0 && args[dirFlag + 1] ? args[dirFlag + 1] : DEFAULT_DIR;
const { samples, errors } = loadSamples(dir);

console.log(`caption WER/CER benchmark — samples dir: ${dir}`);
if (errors?.length) for (const e of errors) console.log(`  skipped: ${e}`);
if (!samples.length) {
  console.log('  AWAITING SAMPLES — no opt-in reference pairs yet (decision #7: Hamza\'s opt-in samples).');
  console.log('  Add one JSON file per sample, { "reference": "...", "hypothesis": "..." }, and re-run.');
  console.log('  No WER/CER number is claimed until then.');
  process.exit(0);
}
let werB = 0; let werA = 0; let cerB = 0; let cerA = 0;
for (const s of samples) {
  const sc = scoreSample(s);
  werB += sc.werBefore; werA += sc.werAfter; cerB += sc.cerBefore; cerA += sc.cerAfter;
  console.log(`  ${s.file}: WER ${(sc.werBefore * 100).toFixed(1)}% -> ${(sc.werAfter * 100).toFixed(1)}%  CER ${(sc.cerBefore * 100).toFixed(1)}% -> ${(sc.cerAfter * 100).toFixed(1)}%${s.note ? `  (${s.note})` : ''}`);
}
const n = samples.length;
console.log(`  mean over ${n} sample${n === 1 ? '' : 's'}: WER ${((werB / n) * 100).toFixed(1)}% -> ${((werA / n) * 100).toFixed(1)}%  CER ${((cerB / n) * 100).toFixed(1)}% -> ${((cerA / n) * 100).toFixed(1)}%`);
