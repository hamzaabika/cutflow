// Multiple sequences per project (P2-02) — pure module, no imports beyond the
// speed sampler. It deliberately does NOT import store.js (store.js imports
// this module): the video-layout math it needs is re-implemented here in
// miniature (layoutOf mirrors store.videoLayout; the test suite asserts the
// two agree on shared fixtures).
//
// Model — the "working-copy" pattern:
//   * The project's flat timeline fields (videoClips, overlayClips, ...) are
//     ALWAYS the active sequence's timeline, so every existing reader —
//     preview, export, the timeline UI, the reducer — works unchanged.
//   * project.sequences[] holds one entry per sequence: { id, name, timeline }
//     where timeline is a snapshot of the same flat fields. Entries for
//     non-active sequences are authoritative; the active entry is re-synced
//     from the flat fields on every store transition (store.syncActiveSequence)
//     and on load (flat fields win), so a stale active entry can never lose
//     an edit.
//   * A sequence clip is a main-track clip { sequenceId, in, out, ... } with
//     NO mediaId. Its in/out window addresses source seconds of the referenced
//     sequence. flattenProject() expands such clips (recursively, with a
//     visited set) into the real clips for the preview / export path.

import { clipDuration, sliceCurve, sourceOffsetAt } from './speedCurve.js';

export const TIMELINE_FIELDS = [
  'videoClips', 'overlayClips', 'textClips', 'audioClips', 'stickerClips', 'effectClips',
  'markers', 'layers', 'layerNames', 'layerState', 'magnet', 'beats',
];

// The flat timeline fields of a project, as a fresh object (lists shared by
// reference — callers that mutate must copy first, as the store does).
export function timelineOf(p) {
  const t = {};
  for (const f of TIMELINE_FIELDS) t[f] = p[f];
  return t;
}

export function withTimeline(p, t) {
  return { ...p, ...timelineOf(t) };
}

// Empty timeline for a brand-new sequence: the same shape emptyProject
// starts with, so a fresh sequence behaves exactly like a fresh project.
export function emptyTimeline() {
  return {
    videoClips: [], overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    effectClips: [],
    magnet: { video: true, overlay: false, audio: true, text: false },
    layerState: {}, markers: [], beats: null,
  };
}

let seqCounter = 0;
export const newSequenceId = () => `seq${(seqCounter++).toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newSequence(name, timeline) {
  return { id: newSequenceId(), name, timeline: timeline || emptyTimeline() };
}

// First free "Sequence N" name.
export function nextSequenceName(p) {
  const names = new Set(((p.sequences || []).map((s) => s.name)));
  let n = (p.sequences || []).length + 1;
  while (names.has(`Sequence ${n}`)) n++;
  return `Sequence ${n}`;
}

export function validSequenceEntry(s) {
  return s && typeof s.id === 'string' && typeof s.name === 'string'
    && s.timeline && typeof s.timeline === 'object';
}

// Ensures a project carries sequences[] + activeSequenceId. An old
// single-timeline project becomes one default sequence ("Sequence 1") holding
// its existing timeline, and renders identically — the flat fields are
// untouched. Returns p itself when nothing needs doing.
export function ensureSequences(p) {
  const list = Array.isArray(p.sequences) ? p.sequences.filter(validSequenceEntry) : [];
  if (list.length && list.some((s) => s.id === p.activeSequenceId)) {
    if (list === p.sequences || (list.length === p.sequences.length && p.sequences.every((s, i) => s === list[i]))) return p;
    return { ...p, sequences: list };
  }
  if (!list.length) {
    const seq = { id: newSequenceId(), name: 'Sequence 1', timeline: timelineOf(p) };
    return { ...p, sequences: [seq], activeSequenceId: seq.id };
  }
  return { ...p, sequences: list, activeSequenceId: list[0].id };
}

export function sequenceById(p, id) {
  return (p.sequences || []).find((s) => s.id === id) || null;
}

export function activeSequence(p) {
  return sequenceById(p, p.activeSequenceId) || (p.sequences || [])[0] || null;
}

// Writes the flat (active) timeline into the active sequence entry.
export function syncActiveSequence(p) {
  const ensured = ensureSequences(p);
  const active = activeSequence(ensured);
  if (!active) return ensured;
  const timeline = timelineOf(ensured);
  if (active.timeline === timeline) return ensured;
  return {
    ...ensured,
    sequences: ensured.sequences.map((s) => (s.id === active.id ? { ...s, timeline } : s)),
  };
}

// Switches the active sequence: the outgoing timeline is saved into its
// entry first, then the target entry's timeline becomes the flat fields.
// Returns p unchanged for an unknown id or a switch to the active sequence.
export function switchSequence(p, id) {
  const ensured = ensureSequences(p);
  if (id === ensured.activeSequenceId) return ensured;
  const target = sequenceById(ensured, id);
  if (!target) return ensured;
  const saved = syncActiveSequence(ensured);
  return { ...withTimeline(saved, target.timeline), activeSequenceId: id };
}

export function createSequence(p, name) {
  const ensured = ensureSequences(p);
  const seq = newSequence((typeof name === 'string' && name.trim()) || nextSequenceName(ensured));
  const saved = syncActiveSequence(ensured);
  return { ...withTimeline({ ...saved, sequences: [...saved.sequences, seq] }, seq.timeline), activeSequenceId: seq.id };
}

export function renameSequence(p, id, name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return p;
  const ensured = ensureSequences(p);
  if (!sequenceById(ensured, id)) return ensured;
  return { ...ensured, sequences: ensured.sequences.map((s) => (s.id === id ? { ...s, name: clean } : s)) };
}

// Every sequence that references `id` as a nested clip (flat active timeline
// plus every stored entry), as [{ sequenceId, clipId }]. Deleting a sequence
// in use would strand those clips, so deleteSequence refuses it.
export function sequenceUsedBy(p, id) {
  const out = [];
  const scan = (seqId, timeline) => {
    for (const c of timeline.videoClips || []) {
      if (c && c.sequenceId === id) out.push({ sequenceId: seqId, clipId: c.id });
    }
  };
  scan('__active__', timelineOf(p));
  for (const s of p.sequences || []) scan(s.id, s.timeline || {});
  return out;
}

export function deleteSequence(p, id) {
  const ensured = ensureSequences(p);
  if (ensured.sequences.length < 2) return ensured;
  if (!sequenceById(ensured, id)) return ensured;
  if (sequenceUsedBy(ensured, id).length) return ensured;
  const rest = ensured.sequences.filter((s) => s.id !== id);
  if (id === ensured.activeSequenceId) {
    const target = rest[0];
    return { ...withTimeline({ ...ensured, sequences: rest }, target.timeline), activeSequenceId: target.id };
  }
  return { ...ensured, sequences: rest };
}

// ---- Nesting / cycles ----

// Does the sequence `seqId` contain (directly or transitively) a nested clip
// of `targetId`? The transitive walk is what makes the cycle check sound:
// A contains B contains A is refused even though neither step is direct.
export function sequenceContains(p, seqId, targetId, seen = new Set()) {
  if (seen.has(seqId)) return false;
  seen.add(seqId);
  const entry = sequenceById(p, seqId);
  const timeline = entry ? entry.timeline : (seqId === p.activeSequenceId ? timelineOf(p) : null);
  if (!timeline) return false;
  for (const c of timeline.videoClips || []) {
    if (!c || !c.sequenceId) continue;
    if (c.sequenceId === targetId) return true;
    if (sequenceContains(p, c.sequenceId, targetId, seen)) return true;
  }
  return false;
}

// May `sourceId` be nested on `parentSeqId` (the active sequence when
// parentSeqId is omitted)? False for self-nesting and for any indirect
// cycle: nesting B in A is refused when B already contains A.
export function canNest(p, sourceId, parentSeqId) {
  const parent = parentSeqId || p.activeSequenceId;
  if (!sourceId || !parent || sourceId === parent) return false;
  if (!sequenceById(p, sourceId)) return false;
  return !sequenceContains(p, sourceId, parent);
}

// ---- Durations / layout (miniature mirrors of store.js) ----

function transitionDur(clips, i) {
  const t = clips[i]?.transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  return Math.max(0, Math.min(t.duration, clipDuration(clips[i]) / 2, clipDuration(clips[i - 1]) / 2));
}

// Mirrors store.videoLayout: positional layout of the main track, clips
// overlapping by the transition into them.
export function layoutOf(videoClips) {
  let end = 0;
  return (videoClips || []).map((c, i) => {
    const td = transitionDur(videoClips, i);
    const start = Math.max(0, end - td);
    const item = { clip: c, index: i, start, end: start + clipDuration(c), trans: td };
    end = item.end;
    return item;
  });
}

const freeLen = (track, c) => (track === 'audio' || track === 'overlay' ? clipDuration(c) : (c.duration || 0));

// Total duration of one timeline object (same ends as store.projectDuration).
export function timelineDuration(t) {
  const v = layoutOf(t.videoClips || []);
  const ends = [v.length ? v[v.length - 1].end : 0];
  for (const c of t.textClips || []) ends.push(c.start + c.duration);
  for (const c of t.audioClips || []) ends.push(c.start + freeLen('audio', c));
  for (const c of t.overlayClips || []) ends.push(c.start + freeLen('overlay', c));
  for (const c of t.stickerClips || []) ends.push((c.start || 0) + (c.duration || 0));
  for (const c of t.effectClips || []) ends.push((c.start || 0) + (c.duration || 0));
  return Math.max(0, ...ends);
}

export function sequenceDuration(p, id) {
  const entry = sequenceById(p, id);
  if (!entry) return 0;
  return timelineDuration(entry.timeline || {});
}

// A main-track clip addressing a sequence: in/out are SOURCE seconds of the
// referenced sequence, speed scales the window (timeline length
// (out - in) / speed). No mediaId — render paths must go through
// flattenProject, which expands it into real clips.
export function newSequenceClip(id, sourceId, sourceName, duration) {
  return {
    id, sequenceId: sourceId, sequenceName: sourceName || '',
    in: 0, out: Math.max(0.1, duration || 0), speed: 1, volume: 1, muted: false,
    filter: 'none', adjust: {}, effects: [], transition: null,
  };
}

// ---- Flattening (preview / export path) ----

const LAYERED_TRACKS = { overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' };

// Parent layer counts, so nested free-track clips land on fresh layers above
// the parent's own (never colliding with a parent clip's layer).
function parentLayerCounts(t) {
  const counts = {};
  for (const [track, key] of Object.entries(LAYERED_TRACKS)) {
    counts[track] = (t[key] || []).reduce((n, c) => Math.max(n, (c.layer ?? 0) + 1), 1);
  }
  return counts;
}

// Flattens ONE timeline object (its video track may itself hold sequence
// clips) into a sequence-free timeline. `seen` guards recursion: a cycle
// that slipped past the insert guard renders as a gap, never a loop.
function flattenTimeline(timeline, resolve, seen) {
  const video = [];
  const extra = { overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [] };
  const counts = parentLayerCounts(timeline);
  const layout = layoutOf(timeline.videoClips || []);
  for (const l of layout) {
    const c = l.clip;
    if (!c.sequenceId) { video.push(c); continue; }
    if (seen.has(c.sequenceId)) {
      video.push({ id: `${c.id}-cycle`, gap: true, in: 0, out: Math.max(0.1, l.end - l.start), speed: 1 });
      continue;
    }
    const source = resolve(c.sequenceId);
    if (!source) {
      video.push({ id: `${c.id}-missing`, gap: true, in: 0, out: Math.max(0.1, l.end - l.start), speed: 1 });
      continue;
    }
    const nested = flattenTimeline(source, resolve, new Set([...seen, c.sequenceId]));
    const winLen = Math.max(0.1, l.end - l.start);
    const speed = c.speed || 1;
    const winStart = c.in || 0;
    const winEnd = c.out ?? (winStart + winLen * speed);
    // Main track: splice the source's video clips (intersected with the
    // window) in place of the sequence clip, then pad with a gap so the
    // segment fills the window exactly — later parent clips must not shift.
    const segLayout = layoutOf(nested.videoClips || []);
    const seg = [];
    for (const sl of segLayout) {
      const sc = sl.clip;
      const a = Math.max(sl.start, winStart);
      const b = Math.min(sl.end, winEnd);
      if (b - a < 0.02) continue;
      const inOff = sourceOffsetAt(sc, a - sl.start);
      const outOff = sourceOffsetAt(sc, b - sl.start);
      // The sequence clip's own speed scales the whole nested segment:
      // every kept clip plays faster/slower by that factor, so the segment
      // fills the window in timeline seconds, not source seconds. A speed
      // curve scales by multiplying its knot speeds (the integral then
      // scales by 1/factor, exactly like the constant path).
      let curve = sc.speedCurve ? sliceCurve(sc, inOff, outOff) : sc.speedCurve;
      if (curve && speed !== 1) {
        curve = { ...curve, points: (curve.points || []).map((pt) => ({ ...pt, speed: pt.speed * speed })) };
      }
      const copy = {
        ...sc,
        id: `${c.id}:${sc.id}`,
        in: (sc.in || 0) + inOff,
        out: (sc.in || 0) + outOff,
        speed: (sc.speed || 1) * speed,
        speedCurve: curve,
        linkId: undefined, linkOff: undefined, linkInOff: undefined,
      };
      if (sc.gap) { copy.in = 0; copy.out = (b - a) / speed; copy.speed = 1; delete copy.speedCurve; }
      seg.push(copy);
    }
    if (seg.length) {
      seg[0] = { ...seg[0], transition: c.transition || null };
      for (let i = 1; i < seg.length; i++) {
        if (seg[i].gap) seg[i] = { ...seg[i], transition: null };
      }
    }
    for (const s of seg) video.push(s);
    const segLen = layoutOf(seg).length ? layoutOf(seg)[layoutOf(seg).length - 1].end : 0;
    if (segLen < winLen - 1e-6) {
      video.push({ id: `${c.id}-pad`, gap: true, in: 0, out: winLen - segLen, speed: 1 });
    }
    // Free tracks: re-time into the parent window, truncate at its edges,
    // lift onto fresh layers. Source time tau maps to parent time
    // l.start + (tau - winStart) / speed.
    const toParent = (tau) => l.start + (tau - winStart) / speed;
    const winEndT = l.start + winLen;
    for (const [track, key] of Object.entries({ overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', sticker: 'stickerClips', effect: 'effectClips' })) {
      for (const fc of nested[key] || []) {
        const len = freeLen(track, fc);
        const fs = fc.start || 0;
        const fe = fs + len;
        const a = Math.max(fs, winStart);
        const b = Math.min(fe, winEnd);
        if (b - a < 0.02) continue;
        const copy = { ...fc, id: `${c.id}:${fc.id}`, linkId: undefined, linkOff: undefined, linkInOff: undefined };
        if (track === 'overlay' || track === 'audio') {
          const inOff = sourceOffsetAt(fc, a - fs);
          const outOff = sourceOffsetAt(fc, b - fs);
          copy.start = toParent(a);
          copy.in = (fc.in || 0) + inOff;
          copy.out = (fc.in || 0) + outOff;
          copy.speed = (fc.speed || 1) * speed;
          let fcurve = fc.speedCurve ? sliceCurve(fc, inOff, outOff) : fc.speedCurve;
          if (fcurve && speed !== 1) {
            fcurve = { ...fcurve, points: (fcurve.points || []).map((pt) => ({ ...pt, speed: pt.speed * speed })) };
          }
          copy.speedCurve = fcurve;
        } else {
          copy.start = toParent(a);
          copy.duration = (b - a) / speed;
        }
        if (LAYERED_TRACKS[track]) copy.layer = (fc.layer ?? 0) + counts[track];
        extra[key].push(copy);
      }
    }
  }
  const out = { ...timeline, videoClips: video };
  for (const [key, list] of Object.entries(extra)) out[key] = [...(timeline[key] || []), ...list];
  // Layer counts: parent rows plus the lifted nested rows.
  const layers = { ...(timeline.layers || {}) };
  for (const [track, key] of Object.entries(LAYERED_TRACKS)) {
    const nestedMax = (extra[key] || []).reduce((n, cc) => Math.max(n, (cc.layer ?? 0) + 1), 0);
    if (nestedMax) layers[track] = Math.max(layers[track] || 1, nestedMax);
  }
  if (Object.keys(layers).length) out.layers = layers;
  return out;
}

// Expands every sequence clip on the ACTIVE timeline into the referenced
// sequence's clips, for the preview and export paths. Returns p unchanged
// (same reference) when the active timeline holds no sequence clips.
export function flattenProject(p) {
  const ensured = ensureSequences(p);
  if (!(ensured.videoClips || []).some((c) => c && c.sequenceId)) return ensured === p ? p : ensured;
  const resolve = (id) => {
    const entry = sequenceById(ensured, id);
    return entry ? entry.timeline : null;
  };
  const flat = flattenTimeline(timelineOf(ensured), resolve, new Set([ensured.activeSequenceId]));
  return withTimeline(ensured, flat);
}
