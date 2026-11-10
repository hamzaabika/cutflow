// Draft safety for project FILES (the user's own .clipcraft.json): transactional saves
// with rotating backups, and reads that fall back to the newest usable copy.
//
// The failure this guards against: the bound file used to be written in place (via a
// .part rename — atomic, but with no history), so one bad save (corrupt JSON from a
// broken state, a torn write on a full disk, a crash at the wrong moment) destroyed the
// ONLY copy of the project. The autosave slots were already atomic and capped; the
// user's own file was the least-protected copy. Now every save path that writes a
// project file goes through writeProjectTx:
//
//   validate -> write <file>.part -> fsync -> read back + parse-verify
//            -> rotate backups (file -> .bak1 -> .bak2 ... bounded)
//            -> rename .part into place
//
// Every step is a rename or a not-yet-visible temp file, so a crash at ANY point leaves
// a readable state behind: before the rotation the old file is intact; mid-rotation the
// previous content sits in .bak1; after the commit the new file is complete. A save
// whose payload is not valid project JSON is REFUSED before anything is touched —
// a broken in-app state can never overwrite a good file.
//
// Reads mirror the writes: readProjectWithFallback tries the file, then the backups
// newest-first, then the project's autosave slot (supplied by the caller), and reports
// WHERE the project came from so the UI can tell the user a recovery happened.
//
// Plain-Node friendly (no Electron imports) so scripts/test-draft-safety.cjs drives it.

const fs = require('node:fs');
const path = require('node:path');

const MAX_BACKUPS = 5; // .bak1 (newest) .. .bak5 (oldest) beside the project file

const backupPath = (file, n) => `${file}.bak${n}`;

function backupPaths(file) {
  const out = [];
  for (let n = 1; n <= MAX_BACKUPS; n += 1) {
    const p = backupPath(file, n);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

// A project payload is a JSON string that parses to a plain object. Anything else
// (truncated write, HTML error page saved by mistake, an array, a bare string) is not
// a project and must never replace one.
function parseProjectJson(json) {
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch { /* some platforms/filesystems refuse directory fsync — best effort */ }
}

// Transactional save of a project file. Throws (leaving the previous state untouched)
// when the payload is invalid or the verified temp write fails.
function writeProjectTx(file, json) {
  if (!file || typeof file !== 'string') throw new Error('No project file to save to.');
  if (!parseProjectJson(json)) throw new Error('Refused to save: the project data is not valid and the existing file was left untouched.');
  const tmp = `${file}.part`;
  // Write + flush the temp file completely before it can become the project.
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, json, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // Verify what actually landed on disk, not what we meant to write.
  let landed = null;
  try { landed = fs.readFileSync(tmp, 'utf8'); } catch { /* treated as failure below */ }
  if (!landed || !parseProjectJson(landed)) {
    try { fs.unlinkSync(tmp); } catch { /* already gone */ }
    throw new Error('Refused to save: the written copy could not be verified and the existing file was left untouched.');
  }
  // Rotate: current file becomes .bak1, .bak1 becomes .bak2, ... the oldest falls off.
  if (fs.existsSync(file)) {
    for (let n = MAX_BACKUPS - 1; n >= 1; n -= 1) {
      const src = backupPath(file, n);
      if (fs.existsSync(src)) fs.renameSync(src, backupPath(file, n + 1));
    }
    fs.renameSync(file, backupPath(file, 1));
  }
  fs.renameSync(tmp, file);
  fsyncDir(path.dirname(file));
  return file;
}

// Read a project file with fallback. slotJson (optional) is the project's autosave-slot
// payload — the last resort, fresher than any backup but kept on this PC only.
// Returns one of:
//   { json, recoveredFrom: null }                          — the file itself was fine
//   { json, recoveredFrom: { kind: 'backup', path, savedAt } }
//   { json, recoveredFrom: { kind: 'autosave', savedAt } }  — from the slot
//   { missing: true }   — no file, no backups, no slot (a genuinely absent project)
//   { corrupt: true }   — something exists but nothing readable survived
function readProjectWithFallback(file, slotJson, slotSavedAt) {
  let sawSomething = false;
  const tryRead = (p) => {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      sawSomething = true;
      return parseProjectJson(raw) ? raw : null;
    } catch {
      return null;
    }
  };
  if (file && fs.existsSync(file)) {
    sawSomething = true;
    const raw = tryRead(file);
    if (raw) return { json: raw, recoveredFrom: null };
  }
  if (file) {
    for (const bak of backupPaths(file)) {
      const raw = tryRead(bak);
      if (raw) {
        let savedAt = null;
        try { savedAt = fs.statSync(bak).mtimeMs; } catch { /* cosmetic only */ }
        return { json: raw, recoveredFrom: { kind: 'backup', path: bak, savedAt } };
      }
    }
  }
  if (slotJson && parseProjectJson(slotJson)) {
    return { json: slotJson, recoveredFrom: { kind: 'autosave', savedAt: slotSavedAt || null } };
  }
  return sawSomething ? { corrupt: true } : { missing: true };
}

module.exports = { MAX_BACKUPS, backupPath, backupPaths, parseProjectJson, writeProjectTx, readProjectWithFallback };
