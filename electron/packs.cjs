// Creative Pack Manager (P2-14), main-process side: pack folders on disk,
// the installed-pack registry, import/export/repair. Pure node (fs + crypto)
// so the test suite can drive it directly against a temp directory.
//
// Layout under the packs dir (userData/packs, or FVE_SMOKE/packs-test):
//   registry.json                  — [{ id, name, version, importedAt, presetCount, assetCount, missingAssets }]
//   <id>/pack.json                 — the validated manifest
//   <id>/assets/<name>             — the pack's asset files
//
// Import accepts a single-file .cutflowpack (JSON, assets inline as base64)
// or a folder (pack.json + assets/). Every asset is hash-checked against
// the manifest; a missing or mismatched asset is REPORTED (missingAssets),
// never silently skipped, and can be repaired later by picking the file.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// src/packs.js is ESM (the renderer imports it); the main process loads it
// with a dynamic import — require(esm) is not available on this Electron's
// Node — so the functions below are async.
let packsMod = null;
async function packs() {
  if (!packsMod) packsMod = await import('../src/packs.js');
  return packsMod;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const slug = (name) => String(name || 'pack').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'pack';
const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function registryPath(baseDir) { return path.join(baseDir, 'registry.json'); }
function readRegistry(baseDir) {
  try {
    const v = JSON.parse(fs.readFileSync(registryPath(baseDir), 'utf8'));
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeRegistry(baseDir, list) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(registryPath(baseDir), JSON.stringify(list, null, 2));
}

// Read a pack from a file or folder. Returns { manifest, files } where files
// maps asset name -> Buffer (inline base64 decoded, or read from the folder),
// or { error }.
function readPackSource(sourcePath) {
  let stat;
  try { stat = fs.statSync(sourcePath); } catch { return { error: `pack not found: ${sourcePath}` }; }
  let manifest;
  const files = new Map();
  if (stat.isDirectory()) {
    const manifestPath = path.join(sourcePath, 'pack.json');
    if (!fs.existsSync(manifestPath)) return { error: 'folder has no pack.json' };
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { return { error: `pack.json is not valid JSON (${e.message})` }; }
    // Defence in depth: a folder pack must not smuggle executables alongside
    // the manifest, even outside the assets list.
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(js|mjs|cjs|exe|dll|sh|bat|cmd|ps1|py|html|htm|wasm)$/i.test(entry.name)) {
          return entry.name;
        }
      }
      return null;
    };
    const bad = walk(sourcePath);
    if (bad) return { error: `executable file rejected in pack folder: ${bad}` };
    for (const a of manifest.assets || []) {
      const candidates = [path.join(sourcePath, 'assets', a.name), path.join(sourcePath, a.name)];
      const found = candidates.find((c) => fs.existsSync(c));
      if (found) files.set(a.name, fs.readFileSync(found));
    }
  } else {
    let raw;
    try { raw = fs.readFileSync(sourcePath, 'utf8'); } catch (e) { return { error: `cannot read pack file (${e.message})` }; }
    try { manifest = JSON.parse(raw); } catch (e) { return { error: `pack file is not valid JSON (${e.message})` }; }
    for (const a of manifest.assets || []) {
      if (typeof a.data === 'string') {
        try { files.set(a.name, Buffer.from(a.data, 'base64')); } catch { /* reported as missing below */ }
      }
    }
  }
  return { manifest, files };
}

// Import a pack into baseDir. Returns { ok, id?, manifest?, missingAssets?, errors?, error? }.
async function importPack(baseDir, sourcePath) {
  const { MAX_ASSET_BYTES, MAX_PACK_BYTES, validatePack } = await packs();
  const src = readPackSource(sourcePath);
  if (src.error) return { ok: false, error: src.error };
  const { manifest, files } = src;
  const check = validatePack(manifest);
  if (!check.ok) return { ok: false, errors: check.errors };
  const id = slug(manifest.name);
  if (!ID_RE.test(id)) return { ok: false, error: 'pack name cannot form an id' };
  const registry = readRegistry(baseDir);
  const existing = registry.find((p) => p.id === id);
  if (existing && (existing.version || 0) >= (manifest.version || 0)) {
    return { ok: false, error: `pack '${manifest.name}' v${existing.version} is already installed` };
  }
  // Hash-check every asset; a missing or mismatched one is reported, and the
  // pack still installs (its presets work; the asset is listed for repair).
  const missingAssets = [];
  let totalBytes = 0;
  for (const a of manifest.assets || []) {
    const buf = files.get(a.name);
    if (!buf) { missingAssets.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'file not in pack' }); continue; }
    if (buf.length > MAX_ASSET_BYTES) { missingAssets.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'asset too large' }); continue; }
    totalBytes += buf.length;
    if (totalBytes > MAX_PACK_BYTES) { missingAssets.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'pack too large' }); continue; }
    if (sha256(buf) !== a.sha256) { missingAssets.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'hash mismatch' }); continue; }
    if (buf.length !== a.size) { missingAssets.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'size mismatch' }); continue; }
  }
  const dir = path.join(baseDir, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  const stored = { ...manifest, assets: (manifest.assets || []).map((a) => ({ name: a.name, sha256: a.sha256, size: a.size })) };
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(stored, null, 2));
  for (const a of manifest.assets || []) {
    const buf = files.get(a.name);
    if (!buf || missingAssets.some((m) => m.name === a.name)) continue;
    const dest = path.join(dir, 'assets', a.name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  const entry = {
    id, name: manifest.name, version: manifest.version, importedAt: new Date().toISOString(),
    presetCount: (manifest.presets || []).length, assetCount: (manifest.assets || []).length, missingAssets,
  };
  writeRegistry(baseDir, [...registry.filter((p) => p.id !== id), entry]);
  return { ok: true, id, manifest: stored, missingAssets, warnings: check.warnings };
}

// Installed packs, with their missing-asset lists re-checked against disk.
function listPacks(baseDir) {
  const out = [];
  for (const entry of readRegistry(baseDir)) {
    const dir = path.join(baseDir, entry.id);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch { /* keep the entry, flagged below */ }
    const missing = [];
    if (!manifest) missing.push({ name: '(pack files)', reason: 'pack.json is gone' });
    else {
      for (const a of manifest.assets || []) {
        const p = path.join(dir, 'assets', a.name);
        if (!fs.existsSync(p)) { missing.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'file not installed' }); continue; }
        const buf = fs.readFileSync(p);
        if (sha256(buf) !== a.sha256) missing.push({ name: a.name, sha256: a.sha256, size: a.size, reason: 'hash mismatch' });
      }
    }
    out.push({ ...entry, manifest, missingAssets: missing });
  }
  return out;
}

function removePack(baseDir, id) {
  if (!ID_RE.test(String(id))) return { ok: false, error: 'bad pack id' };
  fs.rmSync(path.join(baseDir, id), { recursive: true, force: true });
  writeRegistry(baseDir, readRegistry(baseDir).filter((p) => p.id !== id));
  return { ok: true };
}

// Repair one missing asset by picking the file: the hash must match the
// manifest, or the file is refused.
async function repairAsset(baseDir, id, name, filePath) {
  if (!ID_RE.test(String(id))) return { ok: false, error: 'bad pack id' };
  const dir = path.join(baseDir, id);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch { return { ok: false, error: 'pack not installed' }; }
  const asset = (manifest.assets || []).find((a) => a.name === name);
  if (!asset) return { ok: false, error: `no asset named ${name} in this pack` };
  let buf;
  try { buf = fs.readFileSync(filePath); } catch { return { ok: false, error: 'cannot read the picked file' }; }
  if (sha256(buf) !== asset.sha256) return { ok: false, error: `hash mismatch — that file is not ${name}` };
  if (buf.length !== asset.size) return { ok: false, error: `size mismatch — that file is not ${name}` };
  const dest = path.join(dir, 'assets', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { ok: true };
}

// Write a single-file pack (manifest + inline base64 assets) to destPath.
async function exportPack(destPath, manifest) {
  const { validatePack } = await packs();
  const check = validatePack(manifest);
  if (!check.ok) return { ok: false, errors: check.errors };
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, JSON.stringify(manifest, null, 2));
  return { ok: true, path: destPath };
}

module.exports = { importPack, listPacks, removePack, repairAsset, exportPack, readPackSource, readRegistry, sha256, slug };
