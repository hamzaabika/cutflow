// Clip groups (P2-03, TL-07) — a group is a shared clip.groupId across any
// tracks, so a picture clip and its detached audio (or a stack of overlays)
// move, delete and duplicate as one. Selecting any member selects the whole
// group (App.select expands through here); bulk ops then act on the expanded
// selection, and the store's lock guard refuses any member on a locked layer.
import { freeLen, videoLayout } from './store.js';

export const GROUP_TRACKS = ['video', 'overlay', 'text', 'audio', 'effect', 'sticker'];
const TRACK_KEY = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips', sticker: 'stickerClips' };

export const groupIdOf = (c) => (c && typeof c.groupId === 'string' && c.groupId ? c.groupId : null);

// Every clip sharing the group of the named clip (including itself), as
// { track, id } items in timeline order. [] when the clip is ungrouped.
export function groupMates(p, track, id) {
  const list = p[TRACK_KEY[track]] || [];
  const clip = list.find((c) => c.id === id);
  const gid = groupIdOf(clip);
  if (!gid) return [];
  const out = [];
  for (const t of GROUP_TRACKS) {
    const arr = p[TRACK_KEY[t]] || [];
    const starts = t === 'video'
      ? new Map(videoLayout(arr).map((l) => [l.clip.id, l.start]))
      : null;
    for (const c of arr) {
      if (groupIdOf(c) === gid) {
        out.push({ track: t, id: c.id, start: starts ? starts.get(c.id) ?? 0 : (c.start || 0) });
      }
    }
  }
  return out.sort((a, b) => a.start - b.start).map(({ track: t, id: i }) => ({ track: t, id: i }));
}

// A selection with every group member added (deduplicated). Single-clip and
// multi-clip selections both expand; ungrouped clips pass through unchanged.
export function expandGroupSelection(p, items) {
  const have = new Set(items.map((i) => `${i.track}:${i.id}`));
  const out = [...items];
  for (const it of [...items]) {
    for (const mate of groupMates(p, it.track, it.id)) {
      const k = `${mate.track}:${mate.id}`;
      if (!have.has(k)) { have.add(k); out.push(mate); }
    }
  }
  return out;
}

// Select-following: the clip under the playhead and every clip after it on
// the track (a clip counts while the playhead is still inside it), in
// timeline order.
export function followingClips(p, track, time) {
  const key = TRACK_KEY[track];
  if (!key) return [];
  if (track === 'video') {
    return videoLayout(p.videoClips).filter((l) => !l.clip.gap && l.end > time + 1e-6).map((l) => ({ track, id: l.clip.id }));
  }
  const arr = p[key] || [];
  const lenOf = (c) => (track === 'audio' || track === 'overlay' ? freeLen(track, c) : (c.duration || 0));
  return arr.filter((c) => (c.start || 0) + lenOf(c) > time + 1e-6)
    .sort((a, b) => (a.start || 0) - (b.start || 0))
    .map((c) => ({ track, id: c.id }));
}

// Start of a clip on its track, for ordering / range checks.
export function clipStart(p, track, c) {
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === c.id);
    return l ? l.start : 0;
  }
  return c.start || 0;
}
