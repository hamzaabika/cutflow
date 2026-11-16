// FB-33 (P2-28) — true per-font on-demand loading: no bundled face is
// imported into the bundle any more (the runtime font store in
// public/fonts/ holds the woff2 files, loaded through FontFace on
// demand), the load gate resolves the exact faces a font id needs, and
// every bundled face in FONT_LIST has its files in the manifest.
// Usage: node scripts/test-fonts-ondemand.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FONT_LIST, facesForFont, fontById } from '../src/fonts.js';
import { FONT_FACES } from '../src/fontManifest.js';
import { faceInStore } from '../src/fontStore.js';

let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// --- the bundle no longer imports any font CSS ---
check('fonts.js has no static @fontsource CSS imports', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'fonts.js'), 'utf8');
  assert.ok(!/^import '@fontsource\//m.test(src), 'static @fontsource imports remain');
  assert.ok(src.includes("from './fontStore.js'"), 'fonts.js does not use the runtime store');
});
check('the manifest generator is wired into the build', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.build.includes('gen-font-manifest'), `build script: ${pkg.scripts.build}`);
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('public/fonts/'), 'public/fonts/ is not gitignored (build artifact)');
});

// --- the gate resolves the right faces ---
check('cairo bold needs the 400 and 900 faces', () => {
  const faces = facesForFont('cairo', { bold: true });
  assert.deepEqual(faces.map((f) => `${f.family}|${f.weight}|${f.style}`).sort(),
    ['Cairo|400|normal', 'Cairo|900|normal']);
});
check('cairo regular needs only the 400 face', () => {
  assert.deepEqual(facesForFont('cairo', {}), [{ family: 'Cairo', weight: 400, style: 'normal' }]);
});
check('playfair bold-italic resolves to the real 700 italic face', () => {
  const faces = facesForFont('playfairbi', { bold: true, italic: true });
  assert.ok(faces.some((f) => f.family === 'Playfair Display' && f.weight === 700 && f.style === 'italic'),
    JSON.stringify(faces));
});
check('a system font resolves to its family with no store face', () => {
  const faces = facesForFont('arial', { bold: true });
  assert.deepEqual(faces.map((f) => `${f.family}|${f.weight}|${f.style}`).sort(),
    ['Arial|400|normal', 'Arial|700|normal']);
  assert.equal(faceInStore('Arial', 400, 'normal'), null);
});
check('inter (imported by main.jsx) needs no store face', () => {
  const f = fontById('inter');
  assert.equal(f.family, 'Inter Variable');
  assert.equal(faceInStore('Inter Variable', 500, 'normal'), null);
  assert.equal(faceInStore('Inter Variable', 700, 'normal'), null);
});
check('an unknown font id falls back to Arial faces (fontById fallback)', () => {
  assert.deepEqual(facesForFont('no-such-font', {}), [{ family: 'Arial', weight: 400, style: 'normal' }]);
});

// --- manifest coverage: every bundled face the app can ask for exists ---
check('every FONT_LIST bundled face is in the manifest', () => {
  const missing = [];
  for (const f of FONT_LIST) {
    if (f.family.startsWith('Cutflow ')) continue;
    for (const { weight, style } of facesForFont(f.id, { bold: true, italic: true })) {
      // System families have no store entry by design; Inter is main.jsx's.
      if (['Arial', 'Georgia', 'Garamond', 'Times New Roman', 'Impact', 'Arial Black', 'Segoe UI', 'Segoe UI Black', 'Bahnschrift', 'Calibri', 'Verdana', 'Trebuchet MS', 'Comic Sans MS', 'Consolas', 'Brush Script MT', 'Segoe Script', 'Ink Free', 'Showcard Gothic', 'Cooper Black', 'Stencil', 'Broadway', 'Sakkal Majalla', 'Tahoma', 'Inter Variable'].includes(f.family)) continue;
      if (!faceInStore(f.family, weight, style)) missing.push(`${f.id}: ${f.family} ${weight} ${style}`);
    }
  }
  assert.deepEqual(missing, []);
});
check('every manifest subset file exists in the store directory', () => {
  const missing = [];
  for (const face of FONT_FACES) {
    for (const s of face.subsets) {
      if (!fs.existsSync(path.join(ROOT, 'public', 'fonts', s.file))) missing.push(s.file);
    }
  }
  assert.deepEqual(missing.slice(0, 5), []);
  assert.ok(FONT_FACES.length >= 90, `only ${FONT_FACES.length} faces in the manifest`);
});
check('the export and the preview go through the gate, not fontsReady', () => {
  const exp = fs.readFileSync(path.join(ROOT, 'src', 'exportText.js'), 'utf8');
  assert.ok(exp.includes('ensureFontsForProject(project)'), 'exportText does not gate on the project fonts');
  assert.ok(!exp.includes('fontsReady()'), 'exportText still calls fontsReady');
  const prev = fs.readFileSync(path.join(ROOT, 'src', 'components', 'Preview.jsx'), 'utf8');
  assert.ok(prev.includes('ensureFontsForProject(project)'), 'Preview does not gate on the project fonts');
});

console.log(`FONTS ON-DEMAND OK (${n} checks, ${FONT_FACES.length} faces in the store)`);
