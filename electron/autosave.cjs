// Per-project autosave store: every project the user works on is kept in its OWN slot
// under <userData>/autosave/, so going Home and opening another project never strands the
// previous one (the old design kept a single shared crash-recovery snapshot that any
// other project overwrote). A slot is one JSON file per project id:
//
//   <root>/<id>.json   { id, title, file, ratio, thumb, duration, updatedAt, trashedAt, project }
//   <root>/index.json  [{ id, title, file, ratio, thumb, duration, updatedAt, trashedAt }]
//                      — newest first
//
// `file` is the project's own .clipcraft file when it has one (the binding: the slot and
// the file describe the same project id, and opening either finds the same state); it is
// null for a project that was never saved to a file — those live ONLY here, which is the
// point: they survive Home navigation, other projects, and app restarts.
//
// `trashedAt` is the soft-delete marker (Home's trash, parity §8): a trashed slot leaves
// the live list but keeps its file until the retention window passes; the list pass
// purges expired trash. Trashing never touches the bound .clipcraft file or any media —
// it only parks this store's own copy.
//
// Hygiene: the store keeps at most CAP live projects; writing beyond the cap evicts the
// OLDEST live slots (never the one just written, never a trashed one — trash is bounded
// by the purge, not the cap). All writes are tmp-file + rename, so a crash mid-write
// never leaves a torn slot. Ids are sanitized to a safe filename alphabet — a hostile
// or corrupt id can never escape the store directory.
//
// Plain-Node friendly (no Electron imports) so scripts/test-autosave.cjs can drive it.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CAP = 24; // live projects kept in the store; the brief's floor is 20
const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000; // trashed slots are purged after 30 days
const ID_OK = /^[A-Za-z0-9_-]{1,80}$/;

const slotPath = (root, id) => (ID_OK.test(String(id || '')) ? path.join(root, `${id}.json`) : null);
const indexPath = (root) => path.join(root, 'index.json');

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, file);
}

function readIndex(root) {
  try {
    const list = JSON.parse(fs.readFileSync(indexPath(root), 'utf8'));
    if (Array.isArray(list)) return list.filter((e) => e && ID_OK.test(String(e.id || '')));
  } catch { /* rebuilt below */ }
  return null;
}

// The index is a cache of the slot files' headers; if it is missing or torn, rebuild it
// by scanning the slots (a slot file is the source of truth).
function rebuildIndex(root) {
  const entries = [];
  let names = [];
  try { names = fs.readdirSync(root); } catch { return entries; }
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'index.json') continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      if (s && ID_OK.test(String(s.id || ''))) {
        entries.push({ id: s.id, title: s.title || 'Untitled', file: s.file || null, ratio: s.ratio || '', thumb: s.thumb || null, duration: Number(s.duration) || 0, updatedAt: s.updatedAt || 0, trashedAt: s.trashedAt || null });
      }
    } catch { /* a torn slot is skipped, never fatal */ }
  }
  return entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Every index entry whose slot file still exists (live and trashed). The index is a
// cache maintained by the writers below; when it is missing or torn it rebuilds from
// the slot files, which are the source of truth.
function allEntries(root) {
  const entries = readIndex(root) || rebuildIndex(root);
  return entries.filter((e) => {
    const f = slotPath(root, e.id);
    return f && fs.existsSync(f);
  });
}

// The maintenance pass: trashed slots older than the retention window are deleted for
// real (slot file + index entry). Runs at the head of both list reads, so the purge
// happens whenever Home looks at the store — no separate scheduler needed. Only the
// store's own slot files are ever removed; bound project files and media are untouched.
function purgeTrashed(root, now = Date.now()) {
  const entries = allEntries(root);
  const expired = entries.filter((e) => e.trashedAt && now - Number(e.trashedAt) > TRASH_RETENTION_MS);
  if (!expired.length) return [];
  const gone = new Set(expired.map((e) => e.id));
  for (const e of expired) {
    const f = slotPath(root, e.id);
    if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  }
  try { writeJsonAtomic(indexPath(root), entries.filter((e) => !gone.has(e.id))); } catch { /* index rebuilds on next read */ }
  return [...gone];
}

function listSlots(root) {
  purgeTrashed(root);
  return allEntries(root)
    .filter((e) => !e.trashedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Trashed slots, most recently trashed first — Home's trash view.
function listTrashed(root) {
  purgeTrashed(root);
  return allEntries(root)
    .filter((e) => e.trashedAt)
    .sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
}

function prune(root, entries, keepId) {
  // The CAP bounds LIVE slots only; trashed entries ride along untouched (the purge
  // bounds them). Eviction deletes the evicted slot's file, as before.
  const kept = [];
  const trashed = [];
  for (const e of entries) {
    if (e.trashedAt) { trashed.push(e); continue; }
    if (kept.length < CAP || e.id === keepId) { kept.push(e); continue; }
    const f = slotPath(root, e.id);
    if (f) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  }
  return [...kept, ...trashed];
}

// record: { id, title, file, ratio, thumb, updatedAt, projectJson } — projectJson is the
// project serialized by the renderer (the same JSON a .clipcraft file would hold).
// Returns the stored index entry, or null when the record is unusable.
function writeSlot(root, record) {
  try {
    if (!record || !ID_OK.test(String(record.id || ''))) return null;
    const file = slotPath(root, record.id);
    let project;
    try { project = JSON.parse(record.projectJson); } catch { return null; }
    if (!project || typeof project !== 'object') return null;
    fs.mkdirSync(root, { recursive: true });
    // A slot that sits in the trash STAYS in the trash across rewrites (the editor
    // may still hold the project when it is trashed from Home): restore is the only
    // way back into the live list. The flag is read from the index header — the
    // index is maintained by the trash/restore writers, and rebuilds from the slot
    // files (which carry the same flag) when torn.
    const priorEntries = allEntries(root);
    const priorEntry = priorEntries.find((e) => e.id === record.id);
    const slot = {
      id: record.id,
      title: String(record.title || project.name || 'Untitled'),
      file: record.file ? String(record.file) : null,
      ratio: String(record.ratio || project.ratio || ''),
      thumb: record.thumb || null,
      duration: Number(record.duration) || 0,
      updatedAt: Number(record.updatedAt) || Date.now(),
      trashedAt: priorEntry?.trashedAt || null,
      project,
    };
    writeJsonAtomic(file, slot);
    const entry = { id: slot.id, title: slot.title, file: slot.file, ratio: slot.ratio, thumb: slot.thumb, duration: slot.duration, updatedAt: slot.updatedAt, trashedAt: slot.trashedAt };
    const rest = priorEntries.filter((e) => e.id !== slot.id);
    const entries = prune(root, [entry, ...rest], slot.id);
    writeJsonAtomic(indexPath(root), entries);
    return entry;
  } catch {
    return null;
  }
}

function readSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return null;
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && s.project ? s : null;
  } catch {
    return null;
  }
}

function deleteSlot(root, id) {
  const file = slotPath(root, id);
  if (!file) return false;
  let gone = false;
  try { fs.unlinkSync(file); gone = true; } catch { /* not there */ }
  try {
    const entries = allEntries(root).filter((e) => e.id !== id);
    writeJsonAtomic(indexPath(root), entries);
  } catch { /* index rebuilds from slots on next read */ }
  return gone;
}

// Rewrite one slot's header fields (trash marker, title) in place: the slot file and
// its index entry move together, the project payload is carried through untouched.
function patchSlot(root, id, patch) {
  const slot = readSlot(root, id);
  if (!slot) return null;
  const next = { ...slot, ...patch };
  try {
    writeJsonAtomic(slotPath(root, id), next);
    const header = { id: next.id, title: next.title || 'Untitled', file: next.file || null, ratio: next.ratio || '', thumb: next.thumb || null, duration: Number(next.duration) || 0, updatedAt: next.updatedAt || 0, trashedAt: next.trashedAt || null };
    const entries = allEntries(root).map((e) => (e.id === id ? header : e));
    if (!entries.some((e) => e.id === id)) entries.unshift(header);
    writeJsonAtomic(indexPath(root), entries);
    return header;
  } catch {
    return null;
  }
}

// Soft-delete: park the slot in the trash with a timestamp. The bound project file
// (slot.file) and all media are deliberately NOT touched — only this store's copy is
// parked, and restoreSlot brings it back exactly as it was.
function trashSlot(root, id, now = Date.now()) {
  const slot = readSlot(root, id);
  if (!slot) return false;
  if (slot.trashedAt) return true; // already parked
  return !!patchSlot(root, id, { trashedAt: Number(now) || Date.now() });
}

function restoreSlot(root, id) {
  const slot = readSlot(root, id);
  if (!slot || !slot.trashedAt) return false;
  return !!patchSlot(root, id, { trashedAt: null });
}

// Rename in place: the slot's title AND the project document's own name move together
// (the editor's title comes from the document), and updatedAt is preserved — a rename
// is not an edit, so the project keeps its place in the recency order.
function renameSlot(root, id, title) {
  const name = String(title || '').trim().slice(0, 120);
  if (!name) return null;
  const slot = readSlot(root, id);
  if (!slot || slot.trashedAt) return null;
  return writeSlot(root, {
    id,
    title: name,
    file: slot.file || null,
    ratio: slot.ratio || '',
    thumb: slot.thumb || null,
    duration: Number(slot.duration) || 0,
    updatedAt: slot.updatedAt || Date.now(),
    projectJson: JSON.stringify({ ...slot.project, name }),
  });
}

// Duplicate: an independent copy under a fresh id (the daily "start from that project"
// workflow). The copy carries the full project document with its id and name rewritten,
// and starts UNBOUND — two live identities must never share one .clipcraft file (the
// file↔slot binding is one-to-one; opening either would adopt the same slot). The copy
// gets its own file the first time the user saves it. Media is referenced, never copied.
function copySlot(root, id, now = Date.now()) {
  const slot = readSlot(root, id);
  if (!slot || slot.trashedAt) return null;
  const newId = crypto.randomBytes(6).toString('base64url'); // 8 chars, ID_OK alphabet
  if (!ID_OK.test(newId) || slotPath(root, newId) === slotPath(root, id)) return null;
  const title = `${slot.title || slot.project?.name || 'Untitled'} copy`;
  return writeSlot(root, {
    id: newId,
    title,
    file: null,
    ratio: slot.ratio || '',
    thumb: slot.thumb || null,
    duration: Number(slot.duration) || 0,
    updatedAt: Number(now) || Date.now(),
    projectJson: JSON.stringify({ ...slot.project, id: newId, name: title }),
  });
}

// The slot bound to a project FILE (same .clipcraft path), if one exists — opening a file
// adopts its slot's id so file and slot stay one identity.
function slotForFile(root, filePath) {
  if (!filePath) return null;
  return listSlots(root).find((e) => e.file === filePath) || null;
}

module.exports = { CAP, TRASH_RETENTION_MS, writeSlot, readSlot, listSlots, listTrashed, deleteSlot, slotForFile, slotPath, trashSlot, restoreSlot, renameSlot, copySlot, purgeTrashed };
