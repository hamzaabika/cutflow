// Version history (lite) for projects: timestamped snapshots of the project document,
// kept per project id under <userData>/versions/<id>/:
//
//   <root>/<id>/<savedAt>-<hash8>.json   the snapshot — a plain project document,
//                                        loadable through the exact same path as a
//                                        .clipcraft.json file (hygiene included)
//   <root>/<id>/index.json              [{ file, savedAt, source, boundFile, bytes, hash }]
//                                        newest first; a cache — torn/missing rebuilds
//                                        by scanning the snapshot files
//
// Recording policy (decided here so every caller behaves the same):
// - A snapshot is content-addressed by the SHA-256 of the payload: re-saving an
//   unchanged project never creates a duplicate.
// - Explicit saves always record (force). Background writers (bound-file autosave,
//   slot writes) record at most one snapshot per MIN_INTERVAL per project — history
//   should show the shape of a session, not every keystroke.
// - At most CAP snapshots per project; the oldest are evicted (files deleted).
//
// Restoring is the caller's job (load the snapshot JSON like any project open); this
// store never edits a live project. Plain-Node friendly for scripts/test-versions.cjs.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CAP = 10; // snapshots kept per project
const MIN_INTERVAL = 5 * 60 * 1000; // background snapshots: at most one per 5 minutes
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/; // same sanitised id scheme as the autosave store
const FILE_OK = /^\d+-[0-9a-f]{8}\.json$/;

const projectDir = (root, id) => (ID_OK.test(String(id || '')) ? path.join(root, String(id)) : null);
const indexPath = (dir) => path.join(dir, 'index.json');

function writeJsonAtomic(file, text) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function parseProject(json) {
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

// The index is a cache of the snapshot files; a torn or missing index rebuilds from
// the files themselves (their names carry savedAt + hash prefix).
function rebuildIndex(dir) {
  const entries = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return entries; }
  for (const name of names) {
    if (!FILE_OK.test(name)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      entries.push({
        file: name,
        savedAt: Number(name.split('-')[0]) || st.mtimeMs,
        source: 'snapshot',
        boundFile: null,
        bytes: st.size,
        hash: name.split('-')[1].replace('.json', ''),
      });
    } catch { /* a vanished file is skipped, never fatal */ }
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
}

function listVersions(root, id) {
  const dir = projectDir(root, id);
  if (!dir || !fs.existsSync(dir)) return [];
  let entries = null;
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(dir), 'utf8'));
    if (Array.isArray(raw)) {
      entries = raw.filter((e) => e && FILE_OK.test(String(e.file || '')) && fs.existsSync(path.join(dir, e.file)));
    }
  } catch { /* rebuilt below */ }
  if (!entries) entries = rebuildIndex(dir);
  return entries.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).slice(0, CAP);
}

// Record a snapshot of projectJson for project id. opts: { source, boundFile, force, now }.
// Returns the stored entry, or null when the snapshot was skipped (duplicate content,
// background throttle) or refused (bad id / invalid payload).
function recordVersion(root, id, projectJson, opts = {}) {
  const dir = projectDir(root, id);
  if (!dir) return null;
  const json = typeof projectJson === 'string' ? projectJson : JSON.stringify(projectJson);
  if (!parseProject(json)) return null;
  const now = Number(opts.now) || Date.now();
  const hash = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
  const entries = listVersions(root, id);
  const newest = entries[0];
  if (newest && newest.hash && hash.startsWith(newest.hash)) return null; // unchanged content
  if (!opts.force && newest && now - (newest.savedAt || 0) < MIN_INTERVAL) return null; // background throttle
  fs.mkdirSync(dir, { recursive: true });
  const file = `${now}-${hash.slice(0, 8)}.json`;
  writeJsonAtomic(path.join(dir, file), json);
  const entry = {
    file,
    savedAt: now,
    source: String(opts.source || 'save'),
    boundFile: opts.boundFile ? String(opts.boundFile) : null,
    bytes: Buffer.byteLength(json, 'utf8'),
    hash: hash.slice(0, 8),
  };
  const kept = [entry, ...entries.filter((e) => e.file !== file)];
  for (const evicted of kept.splice(CAP)) {
    try { fs.unlinkSync(path.join(dir, evicted.file)); } catch { /* already gone */ }
  }
  writeJsonAtomic(indexPath(dir), JSON.stringify(kept));
  return entry;
}

// The raw project JSON of one snapshot (for restore), or null. The file name must be
// one this store minted — no path escapes, no arbitrary reads.
function readVersion(root, id, file) {
  const dir = projectDir(root, id);
  if (!dir || !FILE_OK.test(String(file || ''))) return null;
  try {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    return parseProject(raw) ? raw : null;
  } catch {
    return null;
  }
}

module.exports = { CAP, MIN_INTERVAL, listVersions, recordVersion, readVersion };
