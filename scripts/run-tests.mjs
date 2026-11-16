// Test runner (A-F7): runs every scripts/test-*.{mjs,cjs} suite with node and
// reports PASS/FAIL per suite, like the battery shell loop in
// ~/workspace/capcut-re/battery-p2-20261115/run.sh, but as one command:
//   npm test                 — everything (slow; live suites need Xvfb :99)
//   npm run test:ci          — CI mode: skips the known environment-only
//                              suites (see CI_SKIP below) so the gate is green
//                              on a clean checkout, not on this VM's quirks
//   npm run test:one -- test-fx-params   — one suite by substring
// Options: --ci, --filter <sub>, --timeout <ms, default 300000>,
//          --out <results file>, --jobs <n, default 1> (suites share Xvfb
//          and /tmp, so keep the default unless you know what you do).
// Exit code is 0 only when every run suite passes.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const ci = args.includes('--ci');
const filter = opt('--filter', '');
const timeoutMs = Number(opt('--timeout', '300000')) || 300000;
const outFile = opt('--out', '');

// Known environment-only failures (AGENTS.md battery notes, 2026-11-15):
// Windows-only suites, a live-network 429, and the demucs probes that OOM
// on a 6 GB cell. These are skipped in --ci mode only; `npm test` still
// runs them so a real regression on capable hardware is not hidden.
const CI_SKIP = new Set([
  'test-captions.cjs', // Windows-only
  'test-captions-linux.cjs', // Windows-only (name notwithstanding, needs Win fixtures)
  'test-fonts.cjs', // Windows-only fonts suite
  'test-library.cjs', // live-network 429 in this sandbox
  'test-p2e-demucs-direct.mjs', // demucs probe, OOM on 6 GB
  'test-p2e-demucs-smoke.mjs', // demucs probe, OOM on 6 GB
]);

const files = fs.readdirSync(path.join(root, 'scripts'))
  .filter((f) => /^test-.*\.(mjs|cjs)$/.test(f))
  .sort()
  .filter((f) => (!filter || f.includes(filter)) && !(ci && CI_SKIP.has(f)));

const runOne = (f) => new Promise((resolve) => {
  const child = spawn('node', [path.join(root, 'scripts', f)], { stdio: 'ignore', timeout: timeoutMs });
  const t0 = Date.now();
  child.on('error', () => resolve({ f, pass: false, ms: Date.now() - t0, note: 'spawn failed' }));
  child.on('close', (code) => resolve({ f, pass: code === 0, ms: Date.now() - t0, note: code === null ? 'timeout' : '' }));
});

const results = [];
for (const f of files) {
  const r = await runOne(f);
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${f} (${(r.ms / 1000).toFixed(1)}s)${r.note ? ' — ' + r.note : ''}`);
}
const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass);
console.log(`\n${pass} PASS / ${fail.length} FAIL of ${results.length}${ci ? ' (CI mode — env-only suites skipped)' : ''}`);
if (fail.length) console.log('Failed: ' + fail.map((r) => r.f).join(', '));
if (outFile) {
  fs.writeFileSync(outFile, results.map((r) => `${r.pass ? 'PASS' : 'FAIL'} ${r.f}`).join('\n') + '\n');
}
process.exit(fail.length ? 1 : 0);
