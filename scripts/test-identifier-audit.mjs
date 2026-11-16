// FB-22 (P1-40) — legacy-identifier audit: static assertions on the CURRENT state.
// This suite asserts that NO rename has happened and pins the exact residue the
// audit documents (docs/identifier-migration-audit.md). If a rename is ever
// ordered, this suite must be updated deliberately as part of that work —
// a failure here means something moved without the migration plan.
// Plain node; no network (the live feed check is documented in the audit doc).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let fails = 0;
const check = (name, cond, extra = '') => { if (!cond) fails += 1; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const grep = (dir, re, exts) => {
  let hits = [];
  for (const f of fs.readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })) {
    if (!f.isFile() || !exts.some((e) => f.name.endsWith(e))) continue;
    const p = path.join(f.parentPath || path.join(ROOT, dir), f.name);
    const s = fs.readFileSync(p, 'utf8');
    if (re.test(s)) hits.push(path.relative(ROOT, p));
  }
  return hits;
};

const main = read('electron/main.cjs');
const updates = read('electron/updates.cjs');
const pkg = JSON.parse(read('package.json'));
const release = JSON.parse(read('electron-builder.release.json'));

// App identity — still ClipCraft where it controls data/OS identity.
check('app.setName is ClipCraft (userData dir ~/.config/ClipCraft)', /app\.setName\('ClipCraft'\)/.test(main));
check('appId is com.clipcraft.app in package.json', pkg.build?.appId === 'com.clipcraft.app', String(pkg.build?.appId));
check('appId is com.clipcraft.app in the release builder config', release.appId === 'com.clipcraft.app');
check('productName is Cutflow (the public brand)', pkg.build?.productName === 'Cutflow' && release.productName === 'Cutflow');
check('Snap name is cutflow (already migrated)', /^\s*name:\s*cutflow\s*$/m.test(read('snap/snapcraft.yaml')));

// Update feed — default host is still clipcrafts; the allowlist gap is real.
check('updater default feed is clipcrafts.pages.dev', /const SITE = 'https:\/\/clipcrafts\.pages\.dev'/.test(updates) && updates.includes('`${SITE}/version.json`'));
check('LINK_HOSTS does NOT contain getcutflow.pages.dev (the documented gap)', !/LINK_HOSTS = \[[^\]]*getcutflow\.pages\.dev/.test(updates), 'a feed move must add it or downloads are rejected by safeLink');
check('HELP_HOSTS already allows getcutflow.pages.dev', /HELP_HOSTS[\s\S]{0,2000}getcutflow\.pages\.dev/.test(main));

// Project files — .clipcraft.json is still the save/open extension.
check('save dialog defaults to .clipcraft.json', main.includes('`${name}.clipcraft.json`'));
check('project ZIPs still use .clipcraft.json', read('electron/projectzip.cjs').includes('`${base}.clipcraft.json`'));

// UI — the renderer shows Cutflow, never ClipCraft.
check('no ClipCraft string in src/ (UI is Cutflow)', grep('src', /ClipCraft/, ['.js', '.jsx']).length === 0, grep('src', /ClipCraft/, ['.js', '.jsx']).join(', ') || 'clean');

// Public surface — README advertises the Cutflow site, not the old feed host.
const readme = read('README.md');
check('README links getcutflow.pages.dev as the site', readme.includes('https://getcutflow.pages.dev'));
check('README does not point users at clipcrafts.pages.dev', !readme.includes('clipcrafts.pages.dev'));

// Recents/recovery/trash keys keep the old prefix (they live inside userData,
// so a userData migration carries them — renaming the keys would wipe them).
check('localStorage keys still use the clipcraft. prefix', ['clipcraft.recents', 'clipcraft.recovery', 'clipcraft.trash'].every((k) => read('src/App.jsx').includes(`'${k}'`)));

// Env-var overrides still carry the old name (kept as aliases on any rename).
check('CLIPCRAFT_UPDATE_URL override still referenced', updates.includes('CLIPCRAFT_UPDATE_URL'));

console.log(fails === 0 ? 'test-identifier-audit: PASS' : `test-identifier-audit: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
