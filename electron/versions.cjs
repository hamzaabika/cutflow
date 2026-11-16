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
const NAME_MAX = 80;

// P1-48: a named version is a snapshot with a human name. Names are validated
// (trimmed, printable, capped) and live only in index.json — a torn index
// rebuild loses names, never snapshots.
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n || /[\u0000-\u001f\u007f]/.test(n)) return null;
  return n.slice(0, NAME_MAX);
}

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
        name: null,
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
  return entries
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, CAP)
    .map((e) => ({ ...e, name: cleanName(e.name) }));
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
    name: cleanName(opts.name),
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

// P1-48: rename a snapshot. Returns the updated entry, or null when the file
// is not one of this project's snapshots or the name is blank/invalid. The
// snapshot file itself is untouched — only index.json changes.
function renameVersion(root, id, file, name) {
  const dir = projectDir(root, id);
  const clean = cleanName(name);
  if (!dir || !clean || !FILE_OK.test(String(file || ''))) return null;
  const entries = listVersions(root, id);
  const target = entries.find((e) => e.file === file);
  if (!target || !fs.existsSync(path.join(dir, file))) return null;
  const kept = entries.map((e) => (e.file === file ? { ...e, name: clean } : e));
  writeJsonAtomic(indexPath(dir), JSON.stringify(kept));
  return { ...target, name: clean };
}

// ---- P1-48: version comparison + selective restoration ----------------------
// These are pure functions over project documents, so the dialog can compare
// any two snapshots (or a snapshot against the live project) and restore only
// chosen tracks/clips without touching the rest of the live project.

const TRACK_KEYS = ['video', 'overlay', 'text', 'audio', 'sticker', 'effect'];
const TRACK_LIST = {
  video: 'videoClips', overlay: 'overlayClips', text: 'textClips',
  audio: 'audioClips', sticker: 'stickerClips', effect: 'effectClips',
};

const mediaLabel = (p, mediaId) => {
  const m = (p.media || []).find((x) => x.id === mediaId);
  const n = m && (m.name || m.file || m.path || '');
  return n ? String(n).split(/[\\/]/).pop() : (mediaId ? String(mediaId) : '');
};

function clipLabel(p, track, c) {
  if (!c || typeof c !== 'object') return '';
  if (c.gap) return 'gap';
  if (track === 'text') return String(c.text || c.caption || 'Text').slice(0, 40) || 'Text';
  if (track === 'effect') return c.kind === 'grade' ? 'Grade layer' : `Effect ${c.fx || ''}`.trim();
  if (track === 'sticker') return String(c.name || c.src || 'Sticker').split(/[\\/]/).pop();
  return mediaLabel(p, c.mediaId) || String(c.id || 'Clip');
}

function clipLen(c) {
  if (typeof c.out === 'number' && typeof c.in === 'number') return Math.max(0, c.out - c.in);
  return Number(c.duration) || 0;
}

// Readable shape of one project: title, duration, and per-track clip counts
// with a short label per clip (used for the compare panel and the selective
// restore checklist). Duration mirrors the store's projectDuration shape
// (video laid out end-to-end, other tracks by end time) closely enough for a
// summary; it is never used for export timing.
function summarizeProject(p) {
  const proj = p && typeof p === 'object' ? p : {};
  let videoEnd = 0;
  const tracks = {};
  for (const key of TRACK_KEYS) {
    const list = Array.isArray(proj[TRACK_LIST[key]]) ? proj[TRACK_LIST[key]] : [];
    const clips = list.map((c) => ({
      id: c && c.id != null ? String(c.id) : '',
      label: clipLabel(proj, key, c),
      start: Number(c && c.start) || 0,
      duration: clipLen(c || {}),
      mediaId: c && c.mediaId ? String(c.mediaId) : null,
    }));
    if (key === 'video') videoEnd = clips.reduce((end, c) => end + c.duration, 0);
    tracks[key] = { count: clips.length, clips };
  }
  const ends = [videoEnd];
  for (const key of ['overlay', 'text', 'audio', 'sticker', 'effect']) {
    for (const c of tracks[key].clips) ends.push(c.start + c.duration);
  }
  return {
    title: typeof proj.name === 'string' ? proj.name : '',
    duration: Math.max(0, ...ends),
    tracks,
    media: (proj.media || []).map((m) => mediaLabel(proj, m.id)).filter(Boolean),
  };
}

// Textual diff between two project documents: title, duration, per-track clip
// counts with added/removed clip labels, and media added/removed by name.
function diffProjects(a, b) {
  const sa = summarizeProject(a);
  const sb = summarizeProject(b);
  const tracks = {};
  for (const key of TRACK_KEYS) {
    const la = sa.tracks[key].clips.map((c) => c.label);
    const lb = sb.tracks[key].clips.map((c) => c.label);
    const added = lb.filter((l) => !la.includes(l));
    const removed = la.filter((l) => !lb.includes(l));
    tracks[key] = { before: sa.tracks[key].count, after: sb.tracks[key].count, added, removed };
  }
  return {
    title: sa.title === sb.title ? null : { from: sa.title, to: sb.title },
    duration: { from: sa.duration, to: sb.duration, delta: sb.duration - sa.duration },
    tracks,
    mediaAdded: sb.media.filter((m) => !sa.media.includes(m)),
    mediaRemoved: sa.media.filter((m) => !sb.media.includes(m)),
  };
}

// Selective restoration: merge chosen parts of a snapshot into the live
// project and return the merged document (the caller loads it like any
// project). selection: { tracks: ['text', ...], clips: [{ track, id }, ...] }.
// A whole track replaces the live track; a single clip replaces the live clip
// with the same id, or is appended when the live project has no such clip.
// Media entries the restored clips reference are copied over when missing, so
// a restored clip never points at media the project does not know.
function selectiveRestore(current, snapshot, selection) {
  const cur = current && typeof current === 'object' ? current : {};
  const snap = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const sel = selection && typeof selection === 'object' ? selection : {};
  const merged = { ...cur };
  const trackSet = new Set(Array.isArray(sel.tracks) ? sel.tracks.filter((k) => TRACK_KEYS.includes(k)) : []);
  const clipSel = (Array.isArray(sel.clips) ? sel.clips : [])
    .filter((c) => c && TRACK_KEYS.includes(c.track) && c.id != null)
    .map((c) => ({ track: c.track, id: String(c.id) }));
  const neededMedia = new Set();
  const collectMedia = (clips) => { for (const c of clips || []) if (c && c.mediaId) neededMedia.add(String(c.mediaId)); };
  for (const key of trackSet) {
    const list = Array.isArray(snap[TRACK_LIST[key]]) ? snap[TRACK_LIST[key]] : [];
    merged[TRACK_LIST[key]] = JSON.parse(JSON.stringify(list));
    collectMedia(list);
  }
  for (const { track, id } of clipSel) {
    if (trackSet.has(track)) continue; // the whole track already came over
    const snapList = Array.isArray(snap[TRACK_LIST[track]]) ? snap[TRACK_LIST[track]] : [];
    const clip = snapList.find((c) => c && String(c.id) === id);
    if (!clip) continue;
    const liveList = Array.isArray(merged[TRACK_LIST[track]]) ? [...merged[TRACK_LIST[track]]] : [];
    const at = liveList.findIndex((c) => c && String(c.id) === id);
    const copy = JSON.parse(JSON.stringify(clip));
    if (at >= 0) liveList[at] = copy; else liveList.push(copy);
    merged[TRACK_LIST[track]] = liveList;
    collectMedia([clip]);
  }
  if (neededMedia.size) {
    const liveMedia = Array.isArray(merged.media) ? [...merged.media] : [];
    const have = new Set(liveMedia.map((m) => m && String(m.id)));
    for (const mid of neededMedia) {
      const m = (snap.media || []).find((x) => x && String(x.id) === mid);
      if (m && !have.has(mid)) liveMedia.push(JSON.parse(JSON.stringify(m)));
    }
    merged.media = liveMedia;
  }
  return merged;
}

module.exports = { CAP, MIN_INTERVAL, listVersions, recordVersion, readVersion, renameVersion, cleanName, summarizeProject, diffProjects, selectiveRestore, TRACK_KEYS };
