// Media-cache bounds (P1-26): the media-cache folder (thumbnails, sprites,
// waveforms, posters, preview proxies, light/quality copies, remux twins,
// frame grabs) grew without any bound — only the fx-segment subfolder was
// capped (fxjobs.cjs, 2 GiB default). This module is the same LRU policy
// applied to the rest of the folder, with the same rules: eviction is
// best-effort and never throws; a file an export is using, a file the open
// project points at, a file written in the last minute, and every .part file
// in flight are never evicted; stale .part files (over an hour old — a
// crashed ffmpeg can leave one) are dropped by the same pass. Deleting a
// cached copy is never destructive: checkGenerated (projectfile.cjs) drops
// the pointer on the next load and pruneDeadCopies (quality.cjs) does the
// same mid-session, so the copy is simply made again when needed.
// The fx-segments subfolder is NOT counted here — it has its own cap.
const fs = require('fs');
const path = require('path');

const MEDIA_CACHE_CAP_DEFAULT_MB = 4096;
const RECENT_MS = 60 * 1000; // a file written in the last minute may still be in flight
const STALE_PART_MS = 60 * 60 * 1000; // a .part file older than an hour is a crashed write

function capBytes(capMB) {
  const mb = Number(capMB);
  return Number.isFinite(mb) && mb > 0 ? Math.round(mb) * 1024 * 1024 : MEDIA_CACHE_CAP_DEFAULT_MB * 1024 * 1024;
}

// Every cache entry on disk: finished files only. Subdirectories (the
// fx-segments folder) are not entries — they are capped separately.
function mediaCacheEntries(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) continue;
      out.push({ file, bytes: st.size, mtimeMs: st.mtimeMs, part: name.endsWith('.part') || name.includes('.part.') });
    } catch { /* a vanished entry is skipped */ }
  }
  return out;
}

function mediaCacheStats(dir) {
  const entries = mediaCacheEntries(dir).filter((e) => !e.part);
  return { files: entries.length, bytes: entries.reduce((n, e) => n + e.bytes, 0) };
}

const resolveSet = (files) => new Set((files || []).map((f) => { try { return path.resolve(f); } catch { return f; } }));

// Evict least-recently-used finished entries until the folder fits the cap.
// Protected files (the open project's copies + live-job files) are never
// touched; when only protected entries remain over the cap, the folder stays
// over — an export in flight outranks the cap. Stale .part files are dropped
// by the same pass. Returns the files actually deleted.
function evictMediaCache(dir, capMB, protectedFiles) {
  const cap = capBytes(capMB);
  const entries = mediaCacheEntries(dir);
  const kept = resolveSet(protectedFiles);
  const now = Date.now();
  const deleted = [];
  // Stale partial writes first — they are never valid entries.
  for (const e of entries) {
    if (!e.part) continue;
    if (now - e.mtimeMs < STALE_PART_MS) continue;
    if (kept.has(path.resolve(e.file))) continue;
    try { fs.rmSync(e.file, { force: true }); deleted.push(e.file); } catch { /* skipped, never fatal */ }
  }
  let total = entries.filter((e) => !e.part).reduce((n, e) => n + e.bytes, 0);
  if (total <= cap) return deleted;
  for (const e of entries.filter((e) => !e.part).sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= cap) break;
    if (kept.has(path.resolve(e.file))) continue;
    if (now - e.mtimeMs < RECENT_MS) continue; // may still be written
    try {
      fs.rmSync(e.file, { force: true });
      total -= e.bytes;
      deleted.push(e.file);
    } catch { /* an undeletable entry is skipped, never fatal */ }
  }
  return deleted;
}

// Drop every cached entry that is not protected (the Settings "clear the
// cache" operation). Stale .part files go too; a fresh .part is a write in
// flight and is kept. Returns the files actually deleted.
function clearMediaCache(dir, protectedFiles) {
  const kept = resolveSet(protectedFiles);
  const now = Date.now();
  const deleted = [];
  for (const e of mediaCacheEntries(dir)) {
    if (kept.has(path.resolve(e.file))) continue;
    if (e.part && now - e.mtimeMs < STALE_PART_MS) continue;
    try { fs.rmSync(e.file, { force: true }); deleted.push(e.file); } catch { /* skipped, never fatal */ }
  }
  return deleted;
}

module.exports = { MEDIA_CACHE_CAP_DEFAULT_MB, capBytes, mediaCacheEntries, mediaCacheStats, evictMediaCache, clearMediaCache };
