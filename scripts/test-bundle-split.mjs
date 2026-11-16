// P2-28 regression guard: the bundle stays split. Asserts the dist layout the
// code-splitting work produced — a main chunk under 1.3 MB, React in its own
// vendor chunk, French/Arabic catalogs + the agent/Forge/dialog panels in
// their own lazy chunks — so a future static import cannot silently re-merge
// the bundle. Run AFTER `npm run build`:  node scripts/test-bundle-split.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = path.join(ROOT, 'dist', 'assets');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const size = (f) => fs.statSync(path.join(dir, f)).size;
const find = (re) => files.find((f) => re.test(f));

const main = find(/^index-.*\.js$/);
assert.ok(main, 'main index chunk exists');
assert.ok(size(main) < 1.3 * 1024 * 1024, `main chunk under 1.3 MB (got ${size(main)})`);

// P2-28 follow-up: no legacy .woff fallback ships — the @fontsource CSS
// references woff2 first and Chromium never fetches the .woff, so those
// files are dead weight (was 297 files / ~5.4 MB). The woff2 files stay.
const allAssets = fs.readdirSync(dir);
const woff = allAssets.filter((f) => f.endsWith('.woff'));
assert.equal(woff.length, 0, `no .woff files ship (got ${woff.length}: ${woff.slice(0, 3).join(', ')})`);
const woff2 = allAssets.filter((f) => f.endsWith('.woff2'));
assert.ok(woff2.length > 0, 'woff2 faces still ship');
console.log(`  woff2 faces: ${woff2.length} files, ${woff2.reduce((n, f) => n + size(f), 0)} bytes`);

for (const [label, re] of [
  ['vendor-react', /^vendor-react-.*\.js$/],
  ['fr catalog', /^fr-.*\.js$/],
  ['ar catalog', /^ar-.*\.js$/],
  ['CraftPilot (agent)', /^CraftPilot-.*\.js$/],
  ['ForgePanel', /^ForgePanel-.*\.js$/],
  ['SettingsDialog', /^SettingsDialog-.*\.js$/],
  ['ExportDialog', /^ExportDialog-.*\.js$/],
]) {
  const f = find(re);
  assert.ok(f, `${label} has its own chunk`);
  console.log(`  ${label}: ${f} (${size(f)} bytes)`);
}
console.log(`  main: ${main} (${size(main)} bytes)`);
console.log('BUNDLE SPLIT OK');
