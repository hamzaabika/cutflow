// Lint (A-F7): the dependency-free checker behind `npm run lint`.
// No eslint is installed in this repo, so this is not a style linter — it
// catches the failures that have actually bitten this tree:
//   1. node --check on every parseable file (electron + scripts + src .js;
//      .jsx files are parsed by vite at build time, so `npm run build`
//      covers them — lint fails the build step out loud when it is missing).
//   2. `debugger` statements and stray console.log in shipped code.
//   3. Module-size guard: the six monoliths named in A-F7 must not grow
//      past their 2026-11-15 line counts (+2% slack). Splitting them further
//      is a separate, seam-by-seam job; this stops the bleed.
//   4. Every scripts/test-* suite parses (a suite that cannot even load
//      must not silently disappear from the battery).
// Usage: node scripts/lint.cjs  (exit 1 on any failure)
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
let failures = 0;
const fail = (msg) => { console.log(`FAIL  ${msg}`); failures++; };
const ok = (msg) => { console.log(`PASS  ${msg}`); };

const walk = (dir, exts, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
};

// 1. Syntax-check every plain-JS file. In-process via vm.SourceTextModule
// (one parse per file, milliseconds) — spawning `node --check` per file took
// 2m27s on this cell. Any file the vm parser rejects is confirmed with a
// real `node --check` spawn before it counts as a failure, so a vm/CJS goal
// quirk (e.g. top-level return in a .cjs) never fails the lint on its own.
// The vm module API needs --experimental-vm-modules; re-exec once with it.
if (!process.execArgv.includes('--experimental-vm-modules') && !process.env.CUTFLOW_LINT_NO_REEXEC) {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', __filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, CUTFLOW_LINT_NO_REEXEC: '1' } });
  process.exit(r.status ?? 1);
}
const vm = require('node:vm');
const jsFiles = [
  ...walk(path.join(root, 'electron'), ['.cjs', '.js']),
  ...walk(path.join(root, 'scripts'), ['.cjs', '.mjs']),
  ...walk(path.join(root, 'src'), ['.js']),
].filter((p) => !p.includes('node_modules'));
const checkOne = (f) => {
  try {
    new vm.SourceTextModule(fs.readFileSync(f, 'utf8'), { identifier: f });
    return null;
  } catch {
    // Confirm with the real parser before failing.
    try {
      require('node:child_process').execFileSync('node', ['--check', f], { stdio: 'ignore' });
      return null;
    } catch { return f; }
  }
};
const checkAll = (files) => files.map(checkOne).filter(Boolean);

(async () => {
  const badJs = checkAll(jsFiles);
  for (const f of badJs) fail(`node --check: ${path.relative(root, f)}`);
  if (!badJs.length) ok(`node --check on ${jsFiles.length} JS files`);

// 2. No debugger / stray console.log in shipped code (warn/error are fine).
const shipped = [...walk(path.join(root, 'src'), ['.js', '.jsx']), ...walk(path.join(root, 'electron'), ['.cjs', '.js'])];
const dbg = shipped.filter((f) => /(^|[^\w$.])debugger[;\s]/.test(fs.readFileSync(f, 'utf8')));
dbg.length ? fail(`debugger statements in: ${dbg.map((f) => path.relative(root, f)).join(', ')}`) : ok('no debugger statements in src/ + electron/');
const logs = shipped.filter((f) => /console\.log\(/.test(fs.readFileSync(f, 'utf8')));
logs.length ? fail(`console.log left in shipped code: ${logs.map((f) => path.relative(root, f)).join(', ')}`) : ok('no console.log in src/ + electron/');

// 3. Module-size guard (A-F7 monoliths, line counts 2026-11-15 + 2% slack).
const SIZE_GUARD = {
  'src/App.jsx': 3559,
  'electron/main.cjs': 2602,
  'src/store.js': 2455,
  'src/components/LeftPanel.jsx': 1981,
  'electron/ffmpeg.cjs': 1834,
  'src/components/Timeline.jsx': 1611,
};
for (const [rel, base] of Object.entries(SIZE_GUARD)) {
  const lines = fs.readFileSync(path.join(root, rel), 'utf8').split('\n').length;
  const cap = Math.ceil(base * 1.02);
  lines <= cap ? ok(`${rel} ${lines} lines (cap ${cap})`) : fail(`${rel} grew to ${lines} lines (cap ${cap}) — split it, do not grow it`);
}

// 4. Every test suite parses.
const suites = fs.readdirSync(path.join(root, 'scripts')).filter((f) => /^test-.*\.(mjs|cjs)$/.test(f));
const unparsable = checkAll(suites.map((f) => path.join(root, 'scripts', f)));
for (const f of unparsable) fail(`test suite does not parse: ${path.basename(f)}`);
if (!unparsable.length) ok(`all ${suites.length} test suites parse`);

if (failures) { console.error(`\nlint: ${failures} failure(s)`); process.exit(1); }
console.log('\nlint: clean');
})();
