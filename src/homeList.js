// Home switchboard list logic (R5): how autosave slots and file recents become the
// ONE project list Home shows, plus the sort/search the switchboard offers and the
// trash bookkeeping for projects that live only in a file. Pure functions — App.jsx
// owns the state and the IPC; this module owns the shapes, so scripts/test-home-list.mjs
// can pin the behaviour without a window.
//
// Entry shapes:
//   live:    { slotId?, path, file?, name, ratio, modifiedAt, thumb, duration }
//            (slotId present when the project has an autosave slot; path/file is the
//            bound .clipcraft file or null for a slot-only project)
//   trashed: { kind: 'slot' | 'file', slotId?, path?, name, ratio, thumb, duration,
//              modifiedAt, trashedAt }
//            'slot' entries are parked inside the slot store (electron/autosave.cjs);
//            'file' entries are only a parked REFERENCE in localStorage — the user's
//            project file itself is never moved or deleted by trashing.

// Mirrors TRASH_RETENTION_MS in electron/autosave.cjs (30 days): file references are
// dropped from Home's trash after the same window, for one consistent rule.
export const TRASH_RETENTION_MS = 30 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// Slots and recents merged into one list, newest first. A file-backed project appears
// once: its slot and its recent describe the same project, merged by path — the slot
// provides identity/state, the recent can only fill a missing poster or a fresher
// timestamp (and, for slots written before durations were recorded, the duration).
export function mergeHomeEntries(slots, recents) {
  const list = (slots || []).map((s) => ({
    slotId: s.id, path: s.file || null, file: s.file || null,
    name: s.title || 'Untitled', ratio: s.ratio || '', modifiedAt: s.updatedAt || 0,
    thumb: s.thumb || null, duration: Number(s.duration) || 0,
  }));
  for (const r of recents || []) {
    const m = list.find((e) => e.path && r.path && e.path === r.path);
    if (m) {
      if (!m.thumb && r.thumb) m.thumb = r.thumb;
      if (!m.duration && r.duration) m.duration = r.duration;
      if ((r.modifiedAt || 0) > (m.modifiedAt || 0)) m.modifiedAt = r.modifiedAt;
    } else {
      list.push({ ...r, duration: Number(r.duration) || 0 });
    }
  }
  return list.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
}

// The switchboard's two orders. 'recent' is the merged list's native order.
export function sortHomeEntries(list, sort) {
  const out = [...(list || [])];
  if (sort === 'name') {
    out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || (b.modifiedAt || 0) - (a.modifiedAt || 0));
  } else {
    out.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
  }
  return out;
}

// Search: name or ratio, case-insensitive — the same reach the old home search had.
export function filterHomeEntries(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [...(list || [])];
  return (list || []).filter((r) => (r.name || '').toLowerCase().includes(q) || (r.ratio || '').includes(q));
}

// Park a file-only recent in Home's trash: the entry keeps everything restoring it
// needs (path, name, poster) plus the trash stamp. The file itself stays on disk.
export function trashEntryForRecent(r, now = Date.now()) {
  return {
    kind: 'file', path: r.path, name: r.name || 'Untitled', ratio: r.ratio || '',
    thumb: r.thumb || null, duration: Number(r.duration) || 0,
    modifiedAt: r.modifiedAt || 0, trashedAt: Number(now) || Date.now(),
  };
}

// A trashed slot-store entry in the same shape the trash view renders for both kinds.
export function trashEntryForSlot(s) {
  return {
    kind: 'slot', slotId: s.id, path: s.file || null, name: s.title || 'Untitled',
    ratio: s.ratio || '', thumb: s.thumb || null, duration: Number(s.duration) || 0,
    modifiedAt: s.updatedAt || 0, trashedAt: s.trashedAt || 0,
  };
}

// Whole days a trashed entry has left before the purge (never negative).
export function daysLeftInTrash(trashedAt, now = Date.now()) {
  const left = TRASH_RETENTION_MS - ((Number(now) || Date.now()) - (Number(trashedAt) || 0));
  return Math.max(0, Math.ceil(left / DAY_MS));
}

// Expired file references (the slot store purges its own; these are App's to drop).
export function isTrashExpired(entry, now = Date.now()) {
  return (Number(now) || Date.now()) - (Number(entry?.trashedAt) || 0) > TRASH_RETENTION_MS;
}

// '0:07' / '12:34' / '1:02:34' for card chips; '' when the length is unknown.
export function fmtDuration(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}
