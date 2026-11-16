// Creative Pack Manager (P2-14): validation rejects traversal / executable
// payloads, import/export round-trips on disk, missing assets are reported
// and repaired by hash.
// Usage: node scripts/test-packs.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packs = require('../electron/packs.cjs');
const { buildManifest, isSafeAssetName, validatePack } = await import('../src/packs.js');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const goodPack = () => buildManifest({
  name: 'Starter Titles',
  description: 'A few titles',
  cutflowVersion: '2.1.0',
  presets: [
    { kind: 'text', id: 'big-title', name: 'Big Title', data: { font: 'montserrat', size: 72, bold: true } },
    { kind: 'anim', id: 'fade-in', name: 'Fade In', data: { kind: 'in', type: 'fade_in', duration: 0.5 } },
    { kind: 'transition', id: 'soft-fade', name: 'Soft Fade', data: { type: 'fade', duration: 0.5 } },
  ],
  assets: [{ name: 'logo.png', sha256: sha(png), size: png.length, data: png.toString('base64') }],
});

// --- Validation -------------------------------------------------------------
{
  const v = validatePack(goodPack());
  assert.ok(v.ok, `good pack validates: ${JSON.stringify(v.errors)}`);
  assert.ok(!isSafeAssetName('../evil.png'), 'traversal rejected');
  assert.ok(!isSafeAssetName('/etc/passwd'), 'absolute path rejected');
  assert.ok(!isSafeAssetName('a\\b.png'), 'backslash rejected');
  assert.ok(!isSafeAssetName('a/b/c.png'), 'two levels deep rejected');
  assert.ok(isSafeAssetName('assets/logo.png'), 'one subfolder allowed');
  const bad = (mut) => {
    const p = goodPack();
    mut(p);
    return validatePack(p);
  };
  assert.ok(!bad((p) => { p.assets[0].name = '../evil.png'; }).ok, 'traversal asset rejected');
  assert.ok(!bad((p) => { p.assets[0].name = 'run.js'; }).ok, 'executable asset rejected');
  assert.ok(!bad((p) => { p.assets[0].name = 'run.exe'; }).ok, 'exe asset rejected');
  assert.ok(!bad((p) => { p.assets[0].sha256 = 'zz'; }).ok, 'bad sha rejected');
  assert.ok(!bad((p) => { p.presets.push({ kind: 'text', id: 'big-title', name: 'Dup', data: {} }); }).ok, 'duplicate preset id rejected');
  assert.ok(!bad((p) => { p.presets[0].kind = 'magic'; }).ok, 'unknown preset kind rejected');
  assert.ok(!bad((p) => { p.format = 'other'; }).ok, 'wrong format rejected');
  assert.ok(!bad((p) => { p.version = 99; }).ok, 'wrong version rejected');
  assert.ok(!bad((p) => { p.assets[0].size = 6 * 1024 * 1024; }).ok, 'oversize asset rejected');
  console.log('  validation rejects traversal / executables / bad hashes');
}

// --- Disk round-trip ----------------------------------------------------------
const base = path.join(process.cwd(), 'tmp', 'test-packs');
fs.rmSync(base, { recursive: true, force: true });
fs.mkdirSync(base, { recursive: true });
const srcDir = path.join(base, 'src');
fs.mkdirSync(srcDir, { recursive: true });
const packFile = path.join(srcDir, 'starter.cutflowpack');
fs.writeFileSync(packFile, JSON.stringify(goodPack(), null, 2));
const store = path.join(base, 'store');

{
  // Import a single-file pack: files land on disk, nothing missing.
  const r = await packs.importPack(store, packFile);
  assert.ok(r.ok, `import ok: ${JSON.stringify(r)}`);
  assert.strictEqual(r.id, 'starter-titles', `id slug (got ${r.id})`);
  assert.deepStrictEqual(r.missingAssets, [], 'no missing assets');
  assert.ok(fs.existsSync(path.join(store, 'starter-titles', 'assets', 'logo.png')), 'asset file installed');
  const listed = packs.listPacks(store);
  assert.strictEqual(listed.length, 1, 'one pack listed');
  assert.strictEqual(listed[0].presetCount, 3, 'preset count recorded');
  assert.deepStrictEqual(listed[0].missingAssets, [], 'listed with nothing missing');
  // A second import of the same version is refused.
  const again = await packs.importPack(store, packFile);
  assert.ok(!again.ok && /already installed/.test(again.error), `re-import refused: ${again.error}`);
  console.log('  single-file import + listing + re-import guard');
}
{
  // A pack whose asset is missing from the file: installs, but reports it.
  const missing = goodPack();
  missing.name = 'Missing Asset Pack';
  delete missing.assets[0].data;
  const missingFile = path.join(srcDir, 'missing.cutflowpack');
  fs.writeFileSync(missingFile, JSON.stringify(missing));
  const r = await packs.importPack(store, missingFile);
  assert.ok(r.ok, `missing-asset pack still installs: ${JSON.stringify(r)}`);
  assert.strictEqual(r.missingAssets.length, 1, 'one asset reported missing');
  assert.strictEqual(r.missingAssets[0].name, 'logo.png', 'missing asset named');
  assert.strictEqual(r.missingAssets[0].reason, 'file not in pack', 'missing reason given');
  // Repair with the wrong file is refused; with the right file it lands.
  const wrong = path.join(srcDir, 'wrong.png');
  fs.writeFileSync(wrong, Buffer.from('not the logo'));
  const badRepair = await packs.repairAsset(store, 'missing-asset-pack', 'logo.png', wrong);
  assert.ok(!badRepair.ok && /hash mismatch/.test(badRepair.error), `wrong repair refused: ${badRepair.error}`);
  const right = path.join(srcDir, 'logo.png');
  fs.writeFileSync(right, png);
  const goodRepair = await packs.repairAsset(store, 'missing-asset-pack', 'logo.png', right);
  assert.ok(goodRepair.ok, `repair ok: ${JSON.stringify(goodRepair)}`);
  assert.deepStrictEqual(packs.listPacks(store).find((p) => p.id === 'missing-asset-pack').missingAssets, [], 'missing cleared after repair');
  console.log('  missing assets reported + repaired by hash');
}
{
  // A folder pack (pack.json + assets/) imports the same way.
  const folder = path.join(srcDir, 'folder-pack');
  fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
  const manifest = goodPack();
  manifest.name = 'Folder Pack';
  delete manifest.assets[0].data;
  fs.writeFileSync(path.join(folder, 'pack.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(folder, 'assets', 'logo.png'), png);
  const r = await packs.importPack(store, folder);
  assert.ok(r.ok, `folder import ok: ${JSON.stringify(r)}`);
  assert.deepStrictEqual(r.missingAssets, [], 'folder assets found');
  // A folder smuggling an executable is refused outright.
  const evil = path.join(srcDir, 'evil-pack');
  fs.mkdirSync(path.join(evil, 'assets'), { recursive: true });
  const evilManifest = goodPack();
  evilManifest.name = 'Evil Pack';
  fs.writeFileSync(path.join(evil, 'pack.json'), JSON.stringify(evilManifest, null, 2));
  fs.writeFileSync(path.join(evil, 'run.exe'), Buffer.from('MZ'));
  const rEvil = await packs.importPack(store, evil);
  assert.ok(!rEvil.ok && /executable/.test(rEvil.error), `executable smuggled in folder refused: ${rEvil.error}`);
  console.log('  folder import + executable smuggling refused');
}
{
  // Export writes a pack another (clean) install can import.
  const outFile = path.join(base, 'exported.cutflowpack');
  const manifest = goodPack();
  manifest.name = 'Exported Pack';
  const ex = await packs.exportPack(outFile, manifest);
  assert.ok(ex.ok && fs.existsSync(outFile), 'export writes the file');
  const clean = path.join(base, 'clean-store');
  const r = await packs.importPack(clean, outFile);
  assert.ok(r.ok && r.missingAssets.length === 0, `clean-install import ok: ${JSON.stringify(r)}`);
  // Remove drops it from the registry and the disk.
  const rm = packs.removePack(store, 'folder-pack');
  assert.ok(rm.ok, 'remove ok');
  assert.ok(!packs.listPacks(store).some((p) => p.id === 'folder-pack'), 'removed pack unlisted');
  assert.ok(!fs.existsSync(path.join(store, 'folder-pack')), 'removed pack files gone');
  console.log('  export -> clean-install import + remove');
}

console.log('test-packs: PASS');
