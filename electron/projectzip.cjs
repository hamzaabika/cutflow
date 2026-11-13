// Project ZIP export (checklist #7): package a .clipcraft.json project with
// every referenced media file into one .zip for backup and sharing.
//
// The archive streams through archiver (constant memory — a project can
// hold gigabytes of footage, so nothing that buffers the whole archive
// may be used here). Layout inside the zip:
//   <name>.clipcraft.json   the project, media paths rewritten to assets/…
//   assets/<basename>      one copy of each referenced file (deduped by
//                          path; same basename from different folders
//                          gets a -2 / -3 suffix)
// Missing media is reported, never silently dropped: its entry stays in
// the bundled JSON with its original path (so the receiving side can
// still relink it) and the file is simply not in the zip.
// Cache fields (thumbnails, waveforms, preview proxies) are stripped
// from the bundled JSON — they are regenerable, and a stale absolute
// cache path from another PC must never ride along.
const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const CACHE_FIELDS = ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH', 'wave', 'proxy', 'poster', 'lightProxy', 'proxies', 'optimizing'];

const safeName = (name) => String(name || 'project').replace(/[\\/:*?"<>|]+/g, '').trim() || 'project';

// Pure (only existence checks touch the disk) so the test suite can
// exercise the manifest directly: { name, jsonName, json, files, missing }.
function buildZipManifest(project, name) {
  const base = safeName(name || project.name);
  const media = project.media || [];
  const used = new Map(); // absolute path -> dest inside the zip
  const seenNames = new Set();
  const files = [];
  const missing = [];
  const destFor = (srcPath) => {
    const file = path.basename(srcPath);
    let dest = `assets/${file}`;
    let n = 2;
    while (seenNames.has(dest)) {
      const ext = path.extname(file);
      dest = `assets/${path.basename(file, ext)}-${n}${ext}`;
      n += 1;
    }
    seenNames.add(dest);
    return dest;
  };
  const bundledMedia = media.map((m) => {
    const out = { ...m };
    CACHE_FIELDS.forEach((f) => delete out[f]);
    if (!m.path || !fs.existsSync(m.path)) {
      if (m.path) missing.push({ id: m.id, name: m.name || path.basename(m.path), path: m.path });
      return out;
    }
    if (used.has(m.path)) { out.path = used.get(m.path); return out; }
    const dest = destFor(m.path);
    used.set(m.path, dest);
    files.push({ src: m.path, dest });
    out.path = dest;
    return out;
  });
  return {
    name: base,
    jsonName: `${base}.clipcraft.json`,
    json: JSON.stringify({ ...project, media: bundledMedia }, null, 2),
    files,
    missing,
  };
}

let current = null; // the in-flight write, so zip:cancel can abort it

function cancelProjectZip() {
  if (!current) return false;
  const cur = current;
  current = null;
  cur.canceled = true;
  // Reject the abort race first: after an abort the archiver stream never
  // ends on its own (its queues are killed while busy), so nothing below
  // may be awaited for settlement.
  try { cur.abort?.(); } catch { /* already settled */ }
  try { cur.archive.abort(); } catch { /* already finishing */ }
  try { cur.out.destroy(); } catch { /* already closed */ }
  try { fs.unlinkSync(cur.outPath); } catch { /* nothing written yet */ }
  return true;
}

async function writeProjectZip(project, name, outPath, onProgress) {
  const manifest = buildZipManifest(project, name);
  const totalBytes = manifest.files.reduce((n, f) => {
    try { return n + fs.statSync(f.src).size; } catch { return n; }
  }, 0);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  const out = fs.createWriteStream(outPath);
  archive.pipe(out);
  const cur = { archive, out, outPath, canceled: false, abort: null };
  current = cur;
  try {
    const finished = new Promise((resolve, reject) => {
      out.on('close', resolve);
      out.on('error', reject);
      archive.on('error', reject);
      archive.on('warning', (w) => { if (w.code !== 'ENOENT') reject(w); });
    });
    // A late archive error after a cancel must not surface as an unhandled
    // rejection; awaiting `finished` below still observes it.
    finished.catch(() => {});
    // finalize() returns the archive, not a promise — the output stream's
    // close is the real completion signal. Raced against the abort signal
    // so a cancel settles promptly (see cancelProjectZip).
    let abortReject;
    const aborted = new Promise((_, reject) => { abortReject = reject; });
    cur.abort = () => abortReject(new Error('zip export aborted'));
    archive.on('progress', (p) => {
      if (onProgress && totalBytes > 0) {
        onProgress({
          entries: p.entries.processed,
          totalEntries: p.entries.total,
          bytes: p.fs.processedBytes,
          total: totalBytes,
          fraction: Math.min(1, p.fs.processedBytes / totalBytes),
        });
      }
    });
    archive.append(manifest.json, { name: manifest.jsonName });
    for (const f of manifest.files) archive.file(f.src, { name: f.dest });
    archive.finalize();
    await Promise.race([finished, aborted]);
    if (cur.canceled) return { canceled: true };
    return {
      path: outPath,
      name: manifest.name,
      jsonName: manifest.jsonName,
      files: manifest.files.length,
      missing: manifest.missing,
      bytes: fs.statSync(outPath).size,
    };
  } catch (e) {
    if (cur.canceled) return { canceled: true };
    try { fs.unlinkSync(outPath); } catch { /* partial file already gone */ }
    throw e;
  } finally {
    if (current === cur) current = null;
  }
}

module.exports = { buildZipManifest, writeProjectZip, cancelProjectZip, CACHE_FIELDS };
