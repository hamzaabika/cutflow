// Project model + reducer (with undo/redo).
//
// The main (video) track plays clips back to back, so a clip's timeline position is derived from order.
// With the track magnet OFF, deleting or trimming leaves a "gap" clip ({ gap: true }) so later clips stay put;
// with it ON the track closes up the way the main track does. Audio / text clips have a free `start`;
// their magnet snaps drags to neighbours and closes the gap after a delete or trim (ripple).
// Overlay clips (picture-in-picture) are videos / photos with a free `start` drawn above the main track.

import { RATIOS, sizeFor } from './effects.js';
import { adaptClipPresets } from './anim.js';
import { cleanPins } from './track.js';
import {
  canNest, createSequence, deleteSequence, ensureSequences, newSequenceClip, newSequenceId,
  renameSequence, sequenceById, sequenceDuration, switchSequence, syncActiveSequence,
  timelineOf, validSequenceEntry,
} from './sequences.js';
import { clipDuration, edgeRate, hasCurve, holdSourceOffsetAt, pieceFrameHold, sliceCurve, sourceOffsetAt, speedAtSource, splitFrameHold, timelineOffsetAt, validFrameHold } from './speedCurve.js';
import { rollEdit, slipClip, slideClip, rateStretch } from './trimTools.js';
import {
  applyJCut, applyLCut, moveFx, pasteFxStack,
  panZoomPatch, setFxBypass, splitScreenPatches, trimLinkedAudio,
} from './gapB.js';
import { groupIdOf } from './groups.js';
import { beatGrid, clampBpm } from './beats.js';
import { DEFAULT_MIXER, busAudible, clampGainDb, isRole, roleOf, sanitizeMixer } from './mixer.js';
import { effectiveFps, nearestFrameRate, quantize } from './frames.js';
import { MARKER_COLORS, markerColorHex, markerColorId, markerNear } from './markers.js';

// Re-exported so existing `from './store.js'` import sites keep working;
// new code should import markers from './markers.js' directly.
export { MARKER_COLORS, markerColorHex, markerColorId, markerNear } from './markers.js';
import { cutBeforeFn, normalizeCutRanges } from './intervals.js';

// ids must never collide inside one project (clips, media, markers share one
// id space): a per-process counter + millisecond timestamp + random tail. The
// old 8-char random-only form had a real birthday-paradox surface at project
// scale (36^8 ≈ 2.8e12, ~1.8e-5 for 10k ids in one session).
let uidCounter = 0;
export const uid = () => `u${(uidCounter++).toString(36)}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export const MIN_CLIP = 0.1;

// The project format closest to a width x height picture, or null when its size is unknown.
export function ratioFor(w, h) {
  if (!w || !h) return null;
  const d = (r) => Math.abs(Math.log(w / h) - Math.log(RATIOS[r][0] / RATIOS[r][1]));
  return Object.keys(RATIOS).reduce((best, r) => (d(r) < d(best) ? r : best));
}

export function emptyProject() {
  return {
    // A stable identity for the per-project autosave store (electron/autosave.cjs): it is
    // born with the project, survives saves/loads (normalizeProject keeps a stored id and
    // mints one for older files), and keys the project's slot on the Home switchboard.
    id: uid(),
    name: 'Untitled', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
    // Multiple sequences (P2-02): the flat timeline fields below are ALWAYS
    // the active sequence's timeline; sequences[] holds every sequence's
    // snapshot (see src/sequences.js for the invariant).
    sequences: [], activeSequenceId: null,
    media: [], videoClips: [], overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    // Effects on the Effects track: a free pixel effect { id, kind: 'fx', fx, start, duration,
    // strength?, params?, region? } or a grade layer { id, kind: 'grade', start, duration,
    // grade?, filter?, filterIntensity?, adjust?, strength?, region? }. A grade layer grades
    // every picture clip under its span (pre-composite: each source separately, before
    // compositing; text and stickers are never graded) — see gradeLayerPasses in fx/apply.js.
    effectClips: [],
    // Ripple mode (P1-02): which tracks a ripple cut moves — 'main' (main
    // track only), 'linked' (+ captions and linked partners), 'all' (+ every
    // unlocked free-track clip). TL-02: linked ripple is opt-in only and
    // default-off — 'main' is the long-standing behaviour; a direct
    // cutRanges call with opts.rippleLinked maps to 'all' (every free
    // track moves with the picture). See RIPPLE_MODES / cutRanges.
    rippleMode: 'main',
    // Text clips are time-anchored overlays (e.g. captions), so they start with the magnet off.
    magnet: { video: true, overlay: false, audio: true, text: false },
    // Per-layer state (lock / hide / mute / solo), keyed "track:layer" — see layerStateOf.
    // Only layers that differ from the defaults get an entry. NOT part of undo history:
    // toggling a lock must never be an undoable document edit (industry standard).
    layerState: {},
    markers: [], // [{ id, time, label, color }] timeline flags — colour is a MARKER_COLORS id
    // AI-03 speaker names: { S1: 'Hamza', S2: 'Guest' } — labels for the
    // speaker ids stored on caption clips (transcript labelling). Empty =
    // the panel shows "Speaker 1", "Speaker 2", …
    speakers: {},
    beats: null, // { bpm, times: [seconds], offset, manual, source } — the soundtrack's beat grid (Beat cuts); snapping uses it too
    snapping: true, // drags snap to clip edges, the playhead and markers
    beatSnap: true, // P2-22: drags and the playhead also snap to the beat grid
    // P2-23 — track mixer: per-role bus gains in dB (smart defaults), master
    // gain, and per-bus mute / solo. See src/mixer.js.
    mixer: { ...DEFAULT_MIXER, muted: {}, solo: {} },
  };
}

// Older project files lack the newer fields.
export function normalizeProject(p) {
  const base = emptyProject();
  const out = {
    ...base, ...p,
    // Frame timebase (P1-04): the stored rate is snapped to the nearest
    // supported rate when it is within 0.02 fps of one — a hand-typed 29.97
    // becomes the exact rational 30000/1001, so the picker, the frame-step
    // keys and the export all agree on the same rate. Anything else (an
    // old integer, an odd rate like 48) is kept verbatim.
    fps: nearestFrameRate(p.fps) ?? (Number.isFinite(Number(p.fps)) && Number(p.fps) > 0 ? Number(p.fps) : 30),
    // Stickers (removed in R1, restored 10/10 step 3): clips referencing the bundled
    // sticker set survive loading again. Entries are sanitized to the clip shape the
    // lane, preview and export all read; anything malformed is dropped, never fatal.
    stickerClips: (Array.isArray(p.stickerClips) ? p.stickerClips : [])
      .filter((c) => c && typeof c.id === 'string' && typeof c.sticker === 'string')
      .map((c) => ({
        id: c.id, sticker: c.sticker,
        name: typeof c.name === 'string' ? c.name : 'Sticker',
        start: Math.max(0, Number(c.start) || 0),
        duration: Math.min(120, Math.max(0.2, Number(c.duration) || 3)),
        transform: c.transform && typeof c.transform === 'object' ? c.transform : { scale: 0.3, x: 0, y: 0 },
        opacity: typeof c.opacity === 'number' ? Math.min(1, Math.max(0, c.opacity)) : 1,
        w: Number(c.w) || 480, h: Number(c.h) || 480,
      })),
    overlayClips: (Array.isArray(p.overlayClips) ? p.overlayClips : []).map(sanitizeClipHold),
    // Frame holds (P1-50) are sanitized on load, like the sticker/effect
    // lists above: a stale hold never survives into the timeline.
    videoClips: (Array.isArray(p.videoClips) ? p.videoClips : []).map(sanitizeClipHold),
    // J/L trims (P1-03) are sanitized on load the same way: a negative or
    // non-finite lead/trail never survives into the timeline.
    audioClips: (Array.isArray(p.audioClips) ? p.audioClips : []).map(withSanitizedTrim),
    // P2-16 — effectClips are sanitized, not passed through raw: a grade layer
    // keeps only its grade payload (grade / filter / filterIntensity / adjust /
    // strength / region, all clamped), a free effect keeps its fx + params; an
    // entry with neither a known fx nor kind 'grade' is dropped, never fatal.
    effectClips: (Array.isArray(p.effectClips) ? p.effectClips : []).filter((c) => c && typeof c.id === 'string').map((c) => {
      const base = { id: c.id, start: Math.max(0, Number(c.start) || 0), duration: Math.min(120, Math.max(0.1, Number(c.duration) || 3)) };
      if (c.kind === 'grade') return {
        ...base, kind: 'grade', name: typeof c.name === 'string' ? c.name : 'Adjustment layer',
        grade: c.grade && typeof c.grade === 'object' ? c.grade : {},
        filter: typeof c.filter === 'string' ? c.filter : 'none',
        filterIntensity: typeof c.filterIntensity === 'number' ? Math.min(100, Math.max(0, c.filterIntensity)) : 100,
        adjust: c.adjust && typeof c.adjust === 'object' ? c.adjust : {},
        ...(typeof c.strength === 'number' ? { strength: Math.min(1, Math.max(0, c.strength)) } : {}),
        ...(c.region && typeof c.region === 'object' ? { region: c.region } : {}),
        ...(c.disabled ? { disabled: true } : {}),
      };
      return { ...base, kind: 'fx', fx: typeof c.fx === 'string' ? c.fx : '', ...(c.strength !== undefined ? { strength: c.strength } : {}), ...(c.params ? { params: c.params } : {}), ...(c.region ? { region: c.region } : {}), ...(Array.isArray(c.keys) ? { keys: c.keys.filter((k) => k && Number.isFinite(Number(k.t)) && Number.isFinite(Number(k.v))).map((k) => ({ t: Math.max(0, Number(k.t)), v: Math.min(1, Math.max(0, Number(k.v))) })) } : {}), ...(c.disabled ? { disabled: true } : {}) };
    }).filter((c) => c.kind === 'grade' || c.fx),
    magnet: { ...base.magnet, ...(p.magnet || {}) },
    markers: (Array.isArray(p.markers) ? p.markers : [])
      .filter((m) => m && Number.isFinite(Number(m.time)))
      .map((m, i) => ({ id: m.id || `mk${i}`, time: Math.max(0, Number(m.time)), label: typeof m.label === 'string' ? m.label : '', color: markerColorId(m.color) }))
      .sort((x, y) => x.time - y.time),
    beats: p.beats && Array.isArray(p.beats.times) && p.beats.times.length
      ? {
        bpm: p.beats.bpm || 0, times: p.beats.times,
        // P2-22: a manual grid keeps its offset + provenance through a reload.
        offset: Number.isFinite(Number(p.beats.offset)) ? Number(p.beats.offset) : 0,
        manual: !!p.beats.manual,
        source: typeof p.beats.source === 'string' ? p.beats.source : 'detected',
      } : null,
    snapping: p.snapping ?? true,
    beatSnap: p.beatSnap ?? true,
    // Ripple mode (P1-02): an unknown stored value falls back to 'main'.
    rippleMode: RIPPLE_MODES.includes(p.rippleMode) ? p.rippleMode : 'main',
    mixer: sanitizeMixer(p.mixer),
  };
  // Multiple sequences (P2-02): an old file with no sequences[] becomes one
  // default sequence holding its timeline; a file that has them keeps each
  // entry (sanitized). The flat fields are the active sequence's timeline
  // and WIN over a stale stored copy of that entry, so a save written
  // mid-edit can never lose the active timeline on reload.
  const stored = (Array.isArray(p.sequences) ? p.sequences : []).filter(validSequenceEntry);
  let sequences = stored.length
    ? stored.map((s) => ({ id: s.id, name: s.name, timeline: normalizeSequenceTimeline(s.timeline) }))
    : [{ id: newSequenceId(), name: 'Sequence 1', timeline: timelineOf(out) }];
  const activeId = sequences.some((s) => s.id === p.activeSequenceId) ? p.activeSequenceId : sequences[0].id;
  sequences = sequences.map((s) => (s.id === activeId ? { ...s, timeline: timelineOf(out) } : s));
  out.sequences = sequences;
  out.activeSequenceId = activeId;
  return out;
}

// Sanitizes one stored sequence timeline through the same normalizer the flat
// fields go through (a timeline is just the flat fields, so normalizing a
// merge of an empty project with it applies every clip sanitizer). The inner
// call's sequences are empty, so it builds a throwaway default entry and
// never recurses back here.
function normalizeSequenceTimeline(t) {
  if (!t || typeof t !== 'object') return timelineOf(emptyProject());
  return timelineOf(normalizeProject({ ...emptyProject(), ...t, sequences: [], activeSequenceId: null }));
}

export const isGap = (c) => !!c.gap;
export const newGap = (id, len) => ({ id, gap: true, in: 0, out: len, speed: 1 });

// Merges neighbouring gaps, drops empty ones and removes a trailing gap (nothing plays after it).
function normalizeGaps(list) {
  const out = [];
  for (const c of list) {
    if (c.gap) {
      const len = c.out - c.in;
      if (len < 0.02) continue;
      const last = out[out.length - 1];
      if (last && last.gap) {
        out[out.length - 1] = { ...last, out: last.out + len };
        continue;
      }
    }
    out.push(c);
  }
  while (out.length && out[out.length - 1].gap) out.pop();
  return out;
}

// Length of a clip on a free track (overlay / audio / text). Audio clips carry a
// speed like picture clips do (a detached clip follows its video's timing). All
// lengths go through the speed sampler (src/speedCurve.js): a clip with a speed
// curve lasts its curve integral; any other clip lasts (out - in) / speed, the
// arithmetic the app has always used.
export const freeLen = (track, c) => (track === 'audio' || track === 'overlay' ? clipDuration(c) : c.duration);

export const clipLen = (c) => clipDuration(c);

// Frame hold (P1-50): a stored hold that no longer fits its clip (stale
// at/duration after a load, a speed change, a trim) is normalized to the
// valid window or dropped — the use sites treat a missing hold as no hold,
// so a stale one can never freeze the wrong frames.
export function sanitizeClipHold(c) {
  if (!c || !c.frameHold) {
    if (c && 'frameHold' in c) { const n = { ...c }; delete n.frameHold; return n; }
    return c;
  }
  const h = validFrameHold(c);
  if (!h) { const n = { ...c }; delete n.frameHold; return n; }
  if (c.frameHold.at === h.at && c.frameHold.duration === h.duration) return c;
  return { ...c, frameHold: h };
}

// J-cuts / L-cuts (P1-03): the audio member of a linked pair may start
// before its picture (lead — a J-cut: you hear the next scene before you
// see it) or end after it (trail — an L-cut). The trims live on the AUDIO
// clip as timeline seconds; the clip's own start/in/out stay the
// authoritative window, so preview and export need no change — they play
// the window as stored. syncLinked keeps the window in step with the
// picture (see audioWindowForPair), and a direct audio trim is read back
// into lead/trail there instead of moving the picture.
export function audioTrimOf(c) {
  const t = c?.audioTrim;
  if (!t || typeof t !== 'object') return { lead: 0, trail: 0 };
  const lead = Number(t.lead);
  const trail = Number(t.trail);
  return {
    lead: Number.isFinite(lead) && lead > 0 ? lead : 0,
    trail: Number.isFinite(trail) && trail > 0 ? trail : 0,
  };
}
export function sanitizeAudioTrim(trim) {
  const { lead, trail } = audioTrimOf({ audioTrim: trim });
  return lead || trail ? { ...(lead ? { lead } : {}), ...(trail ? { trail } : {}) } : undefined;
}
function withSanitizedTrim(c) {
  if (!c || !('audioTrim' in c)) return c;
  const t = sanitizeAudioTrim(c.audioTrim);
  if (t && c.audioTrim.lead === t.lead && c.audioTrim.trail === t.trail) return c;
  const n = { ...c };
  if (t) n.audioTrim = t; else delete n.audioTrim;
  return n;
}

// The audio window a linked pair wants, from the picture window, the pair's
// base alignment (linkOff / linkInOff) and the J/L trims — clamped to the
// source media so a lead can never reveal source before 0 and a trail can
// never run past the end. Returns the window AND the trims as actually
// applied (a clamp shortens the trim, and the caller stores the shortened
// one so the UI shows what held).
export function audioWindowForPair(pic, picStart, aud, mediaDur) {
  const trim = audioTrimOf(aud);
  // The rates come from the PICTURE (the pair's speed): when a speed
  // change rides along, the audio's own rate is still the old one, and
  // the extension must be measured at the speed the pair is moving to.
  const rateIn = edgeRate(pic, true);
  const rateOut = edgeRate(pic, false);
  const linkOff = aud.linkOff || 0;
  const linkInOff = aud.linkInOff || 0;
  const baseIn = (pic.in || 0) + linkInOff;
  const baseOut = (pic.out ?? 0) + linkInOff;
  let lead = trim.lead;
  let trail = trim.trail;
  if (rateIn > 0) lead = Math.min(lead, Math.max(0, baseIn / rateIn));
  // ...and by the timeline itself: the audio can never start before 0.
  lead = Math.min(lead, Math.max(0, picStart + linkOff));
  if (Number.isFinite(mediaDur) && rateOut > 0) trail = Math.min(trail, Math.max(0, (mediaDur - baseOut) / rateOut));
  return {
    start: picStart + linkOff - lead,
    in: baseIn - lead * rateIn,
    out: baseOut + trail * rateOut,
    lead, trail,
  };
}

// Everything the UI needs about a linked pair, from either member: the
// picture clip + track, its timeline window, the audio clip, and the J/L
// trims. Null when the clip is not in a complete pair.
export function linkedPairInfo(p, track, clip) {
  if (!clip || !clip.linkId) return null;
  const partner = findLinkPartner(p, clip);
  if (!partner) return null;
  const isAudio = track === 'audio';
  const pic = isAudio ? partner.clip : clip;
  const picTrack = isAudio ? partner.track : track;
  const aud = isAudio ? clip : partner.clip;
  if (partner.track !== 'audio' && !isAudio) return null; // picture-picture is not a pair
  if (isAudio && partner.track === 'audio') return null;
  const start = picStart(p, picTrack, pic);
  if (start === null || start === undefined) return null;
  const len = picTrack === 'video' ? clipDuration(pic) : clipLen(pic);
  const { lead, trail } = audioTrimOf(aud);
  return { pic, picTrack, picStart: start, picEnd: start + len, aud, lead, trail };
}

// A trim re-bases a frame hold: a left-edge trim shifts the hold point by
// the removed length (clamped, dropping a hold that no longer fits); a
// right-edge trim only re-validates it against the new length.
function rebaseHoldAfterTrim(c, oldLen, newLen, edge) {
  if (!c.frameHold) return c;
  if (edge === 'left') {
    const d = oldLen - newLen;
    let at = c.frameHold.at - d;
    let dur = c.frameHold.duration;
    if (at < 0) { dur += at; at = 0; }
    if (dur <= 0.01 || at + dur > newLen + 1e-9) { const n = { ...c }; delete n.frameHold; return n; }
    return { ...c, frameHold: { at, duration: dur } };
  }
  return sanitizeClipHold(c);
}

// One clip patch application, shared by 'update' (and 'updateMany' through it).
// Two timing invariants live here so every writer gets them for free:
// - A constant-speed write replaces the timing model: a patch that sets `speed`
//   without mentioning `speedCurve` retires any curve the clip carries — the
//   constant controls (Speed dialog, inspector chips, template fills) rely on
//   this, and curve edits always write speedCurve explicitly.
// - A window write (in / out) on a ramped clip re-anchors its curve: the patch
//   keeps the slice of the curve that covers the new window, so direct writers
//   (inspector In/Out fields, timeline edge drags) can never leave a curve
//   pointing at source the clip no longer shows. Paths that compute their own
//   slice (split, trim, cut ranges) build clips directly and never come here.
export function applyClipPatch(c, patch) {
  const next = withSanitizedTrim({ ...c, ...patch });
  if (!patch) return sanitizeClipHold(next);
  if ('speed' in patch && !('speedCurve' in patch) && c.speedCurve) delete next.speedCurve;
  if (('in' in patch || 'out' in patch) && !('speedCurve' in patch) && hasCurve(c)) {
    const from = (patch.in !== undefined ? patch.in : c.in) - c.in;
    const to = (patch.out !== undefined ? patch.out : c.out) - c.in;
    next.speedCurve = sliceCurve(c, from, to);
  }
  return sanitizeClipHold(next);
}

// Layers: every clip of a free track sits on a layer, 0 being the one next to the main track.
// Clips of one layer never overlap; a clip that would is moved to the first free layer. A higher overlay, text or
// layer is drawn above a lower one. Layers stay when they become empty (project.layers counts them).
export const LAYERED = { overlay: 'overlayClips', text: 'textClips', audio: 'audioClips' };
export const layerOf = (c) => c.layer ?? 0;

export function layerCount(p, track) {
  const used = (p[LAYERED[track]] || []).reduce((n, c) => Math.max(n, layerOf(c) + 1), 1);
  return Math.max(used, p.layers?.[track] || 1);
}

// Display name of one layer: the user's rename (project.layerNames) or the lane's default.
const LANE_NAMES = { video: 'Main', overlay: 'Overlay', text: 'Text', sticker: 'Sticker', audio: 'Audio', effect: 'Effects' };
export function layerName(p, track, layer) {
  return (p.layerNames && p.layerNames[track] && p.layerNames[track][layer]) || `${LANE_NAMES[track] || track} ${layer + 1}`;
}

// ---- Layer state: lock / hide / mute / solo, one entry per layer ("track:layer") ----
// The main track is the single layer video:0; the Effects lane (not a layered lane in the
// model) is effect:0. Lanes whose clips can carry sound — and therefore answer to mute /
// solo — are video (its clips' own sound), overlay (picture clips with sound) and audio.
export const LAYER_STATE_DEFAULTS = { locked: false, hidden: false, muted: false, solo: false };
export const layerKey = (track, layer) => `${track}:${layer}`;
export function layerStateOf(p, track, layer) {
  return { ...LAYER_STATE_DEFAULTS, ...((p.layerState || {})[layerKey(track, layer)] || {}) };
}
export const isLayerLocked = (p, track, layer) => layerStateOf(p, track, layer).locked;
export const AUDIO_LANES = { video: true, overlay: true, audio: true };
// The layer a clip sits on: layered lanes read clip.layer; every other track has layer 0.
export const clipLayer = (track, c) => (LAYERED[track] ? layerOf(c) : 0);
export const clipLocked = (p, track, c) => !!c && isLayerLocked(p, track, clipLayer(track, c));
// removeMedia deletes every clip that uses the item, so it answers to the same lock as a
// delete: the first use of the item that sits on a locked layer, or null. The library UI
// names this layer when it refuses the removal.
export function lockedMediaUse(p, mediaId) {
  const lists = [['video', p.videoClips], ['overlay', p.overlayClips || []], ['audio', p.audioClips]];
  for (const [track, list] of lists) {
    for (const c of list) {
      if (c.mediaId === mediaId && clipLocked(p, track, c)) return { track, layer: clipLayer(track, c) };
    }
  }
  return null;
}
// True when any audio-capable layer is soloed (solo then decides what sounds at all).
export function anySolo(p) {
  const ls = p.layerState || {};
  return Object.entries(ls).some(([k, s]) => s && s.solo && AUDIO_LANES[k.split(':')[0]]);
}
// Does this layer's sound reach the mix? Mute silences it; once anything is soloed,
// only soloed layers sound.
export function layerSounds(p, track, layer) {
  const st = layerStateOf(p, track, layer);
  if (st.muted) return false;
  return !anySolo(p) || st.solo;
}

// Remaps the layerState keys of one track through fn(oldLayer) -> newLayer | null (drop),
// the same permutation a layer operation applies to the clips and their names.
function remapLayerState(p, track, fn) {
  const ls = p.layerState || {};
  const prefix = `${track}:`;
  if (!Object.keys(ls).some((k) => k.startsWith(prefix))) return p.layerState;
  const out = {};
  for (const [k, v] of Object.entries(ls)) {
    if (!k.startsWith(prefix)) { out[k] = v; continue; }
    const n = fn(Number(k.slice(prefix.length)));
    if (n !== null && n !== undefined) out[layerKey(track, n)] = v;
  }
  return out;
}

// True when [start, start + len) is free on that layer (the clip `exceptId` aside).
export function layerFree(p, track, layer, start, len, exceptId) {
  return !(p[LAYERED[track]] || []).some((x) => x.id !== exceptId && layerOf(x) === layer
    && x.start < start + len - 1e-6 && start < x.start + freeLen(track, x) - 1e-6);
}

// Gives every clip a layer where it fits, keeps the lists in drawing order (by layer) and the layer counts.
// Returns p itself when nothing changes. Old projects (no layers) get the rows they used to show.
function placeLayers(p) {
  let out = p;
  for (const [track, key] of Object.entries(LAYERED)) {
    const list = p[key] || [];
    const placed = []; // [layer][]{ start, end }
    const fits = (l, a, b) => !(placed[l] || []).some((r) => r.start < b - 1e-6 && a < r.end - 1e-6);
    const order = [...list].sort((a, b) => (a.layer === undefined) - (b.layer === undefined) || a.start - b.start);
    const layerById = {};
    for (const c of order) {
      const a = c.start;
      const b = c.start + freeLen(track, c);
      let l = layerOf(c);
      while (!fits(l, a, b)) l++;
      (placed[l] ||= []).push({ start: a, end: b });
      layerById[c.id] = l;
    }
    let changed = false;
    let next = list.map((c) => {
      if (c.layer === layerById[c.id]) return c;
      changed = true;
      return { ...c, layer: layerById[c.id] };
    });
    if (next.some((c, i) => i && layerOf(next[i - 1]) > layerOf(c))) {
      next = next.map((c, i) => [c, i]).sort((x, y) => layerOf(x[0]) - layerOf(y[0]) || x[1] - y[1]).map((x) => x[0]);
      changed = true;
    }
    const count = Math.max(placed.length, p.layers?.[track] || 1);
    if (changed) out = { ...out, [key]: next };
    if ((out.layers?.[track] || 1) !== count) out = { ...out, layers: { ...out.layers, [track]: count } };
  }
  return out;
}

// Transition length into clip i, limited to half of either neighbouring clip.
export function transitionDur(clips, i) {
  const t = clips[i]?.transition;
  if (!t || i === 0 || t.type === 'none') return 0;
  return Math.max(0, Math.min(t.duration, clipLen(clips[i]) / 2, clipLen(clips[i - 1]) / 2));
}

// TR-03: transition fit against its neighbours — the single source of truth
// for the boundary UI (Inspector Transition panel + ClipInspector) and the
// export clamp (transitionDur, which equals min(requested, max)). A transition
// can use at most half of each clip it joins, so:
//   ok      — the requested duration fits both neighbours as stored.
//   clamped — the requested duration exceeds what a neighbour allows; the
//             transition will play at `effective` instead of `requested`.
//   zero    — a neighbour is too short for any transition at all (max 0);
//             the transition is skipped on export.
//   none    — no transition on this clip.
export function transitionFit(clips, i) {
  const t = clips[i]?.transition;
  if (!t || i === 0 || t.type === 'none') return { state: 'none', requested: 0, max: 0, effective: 0, prevLen: 0, nextLen: 0 };
  const prevLen = clipLen(clips[i - 1]);
  const nextLen = clipLen(clips[i]);
  const max = Math.max(0, Math.min(prevLen, nextLen) / 2);
  const effective = Math.max(0, Math.min(t.duration, max));
  const state = effective <= 0 ? 'zero' : t.duration > max + 1e-9 ? 'clamped' : 'ok';
  return { state, requested: t.duration, max, effective, prevLen, nextLen };
}

// Clips overlap by the length of the transition into them (FFmpeg xfade).
export function videoLayout(videoClips) {
  let end = 0;
  return videoClips.map((c, i) => {
    const td = transitionDur(videoClips, i);
    const start = Math.max(0, end - td);
    const item = { clip: c, index: i, start, end: start + clipLen(c), trans: td };
    end = item.end;
    return item;
  });
}

export function projectDuration(p) {
  const v = videoLayout(p.videoClips);
  const ends = [v.length ? v[v.length - 1].end : 0];
  p.textClips.forEach((c) => ends.push(c.start + c.duration));
  p.audioClips.forEach((c) => ends.push(c.start + freeLen('audio', c)));
  (p.overlayClips || []).forEach((c) => ends.push(c.start + freeLen('overlay', c)));
  // P0-03: sticker and effect clips are duration-based (start + duration) like
  // text — leaving them out made a project whose last content is a sticker or
  // an effect report duration 0 / too short. exportDuration() below is
  // intentionally video-only and is NOT changed.
  (p.stickerClips || []).forEach((c) => ends.push((c.start || 0) + (c.duration || 0)));
  (p.effectClips || []).forEach((c) => ends.push((c.start || 0) + (c.duration || 0)));
  return Math.max(0, ...ends);
}

// Total duration of what gets exported (the video track drives the output length).
// This is THE shared duration basis for everything export-facing: it mirrors, step for
// step, the total electron/ffmpeg.cjs accumulates in buildExportArgs (each clip starts
// at the previous end minus its clamped transition overlap). The text rasterizer
// (src/exportText.js) and the Export dialog's Duration + size estimate both read this
// function — never projectDuration(), which also counts text/audio/overlay ends.
export function exportDuration(p) {
  // Mirror buildExportArgs exactly: it drops main-track clips whose media is
  // missing from the project (a clip left behind by a removed/lost file), so a
  // project carrying such a clip used to show a Duration longer than the
  // encode's own total — the % denominator. Filter the same way here.
  const mediaIds = new Set((p.media || []).map((m) => m.id));
  // A nested sequence clip has no mediaId of its own: it still occupies
  // exported time (flattenProject expands it before the encode).
  const clips = (p.videoClips || []).filter((c) => c.gap || c.sequenceId || mediaIds.has(c.mediaId));
  const v = videoLayout(clips);
  return v.length ? v[v.length - 1].end : 0;
}

export function videoClipAt(p, t) {
  const hits = videoLayout(p.videoClips).filter((l) => !l.clip.gap && t >= l.start && t < l.end);
  return hits[hits.length - 1] || null;
}

const TRACKS = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips', sticker: 'stickerClips' };

export const IMAGE_DEFAULT = 4;

export function newVideoClip(id, m) {
  return {
    id, mediaId: m.id, in: 0, out: m.type === 'image' ? IMAGE_DEFAULT : m.duration, speed: 1, volume: 1, muted: false,
    filter: 'none', adjust: {}, effects: [], transition: null,
    role: 'dialogue', // P2-23: picture clips carry dialogue by default
  };
}

// The "Original" format: the first picture on an empty main track sets the canvas shape (a tall phone
// video makes a 9:16 project), unless a format was picked by hand. The canvas fields that change, or {}.
export function canvasFor(p, m) {
  const first = !p.ratioLocked && !p.videoClips.some((c) => !c.gap);
  const ratio = first && ratioFor(m.width, m.height);
  return ratio && ratio !== p.ratio ? { ratio, ...sizeFor(ratio, p.resolution) } : {};
}

function reduceProjectInner(p, a) {
  switch (a.type) {
    case 'load':
      return normalizeProject(a.project);
    // Multiple sequences (P2-02): create/rename/delete/switch go through
    // src/sequences.js (create + switch are one undo step; a switch on its
    // own is made non-undoable in historyReducer below, like a selection).
    case 'createSequence':
      return createSequence(p, a.name);
    case 'renameSequence':
      return renameSequence(p, a.id, a.name);
    case 'deleteSequence':
      return deleteSequence(p, a.id);
    case 'switchSequence':
      return switchSequence(p, a.id);
    case 'addSequenceClip': {
      // A sequence as a nested clip on the main track, at the end (or
      // a.index). The insert guard refuses unknown sources, empty sources
      // and anything that would close a cycle; the UI pre-checks the same
      // and disables those entries, so this is a backstop, not the message.
      const source = sequenceById(ensureSequences(p), a.sequenceId);
      if (!source) return p;
      if (!canNest(p, a.sequenceId)) return p;
      const dur = sequenceDuration(p, a.sequenceId);
      if (dur < MIN_CLIP) return p;
      const clip = newSequenceClip(a.clipId, a.sequenceId, source.name, dur);
      const list = [...p.videoClips];
      list.splice(a.index ?? list.length, 0, clip);
      return { ...p, videoClips: list };
    }
    case 'applyPlan':
      // A reviewed FlowAI plan (P1-31): the whole planned document replaces the
      // present in ONE undo step — undoing returns to the exact pre-plan
      // project. Unlike 'load' (which keeps the trail for a reloaded document),
      // this pushes the present onto past, like any normal edit.
      return normalizeProject(a.project);
    case 'setProject':
      return { ...p, ...a.patch };
    case 'addMedia':
      return { ...p, media: [...p.media, ...a.items] };
    case 'renameMedia':
      // Display name only — the file path never changes, so clips, proxies
      // and relink state are untouched. A normal edit: undoable.
      return { ...p, media: p.media.map((m) => (m.id === a.id ? { ...m, name: a.name } : m)) };
    case 'removeMedia':
      return {
        ...p,
        media: p.media.filter((m) => m.id !== a.id),
        videoClips: p.videoClips.filter((c) => c.mediaId !== a.id),
        audioClips: p.audioClips.filter((c) => c.mediaId !== a.id),
        overlayClips: p.overlayClips.filter((c) => c.mediaId !== a.id),
      };
    case 'addToTimeline': {
      const m = p.media.find((x) => x.id === a.mediaId);
      if (!m) return p;
      if (m.type === 'video' || m.type === 'image') {
        const list = [...p.videoClips];
        // Source Monitor (gap-build B): a source in/out window honoured here.
        const clip = newVideoClip(a.clipId, m);
        if (m.type === 'video' && Number.isFinite(a.in) && Number.isFinite(a.out) && a.out - a.in >= MIN_CLIP) {
          clip.in = Math.max(0, a.in);
          clip.out = Math.min(m.duration || a.out, a.out);
        }
        list.splice(a.index ?? list.length, 0, clip);
        return { ...p, videoClips: list, ...canvasFor(p, m) };
      }
      return {
        ...p,
        audioClips: [...p.audioClips, { id: a.clipId, mediaId: m.id, start: a.at, in: 0, out: m.duration, volume: 1, fadeIn: 0, fadeOut: 0, role: 'music', ...(a.layer != null && { layer: a.layer }) }], // P2-23: audio clips carry music by default
      };
    }
    case 'addOverlayClip': {
      // Picture-in-picture: a video or photo above the main track, centred on the canvas at
      // half size by default (Hamza, 2026-11-03: a new overlay lands in the middle, never
      // dropped over a corner). x/y are frame fractions from the centre, so 0/0 is centred.
      const m = p.media.find((x) => x.id === a.mediaId);
      if (!m || m.type === 'audio') return p;
      const clip = { ...newVideoClip(a.clipId, m), start: Math.max(0, a.at), transform: { scale: 0.5, x: 0, y: 0 }, ...(a.layer != null && { layer: a.layer }) };
      return { ...p, overlayClips: [...p.overlayClips, clip] };
    }
    case 'addEffectClip': {
      // A free effect on the Effects track (3 s by default), or a grade layer
      // (kind 'grade': no fx, a grade payload instead — see gradeLayerPasses).
      const clip = a.kind === 'grade'
        ? { id: a.clipId, kind: 'grade', name: a.name || 'Adjustment layer', start: Math.max(0, a.at), duration: a.duration || 3, grade: a.grade || {}, filter: a.filter || 'none', filterIntensity: a.filterIntensity ?? 100, adjust: a.adjust || {} }
        : { id: a.clipId, kind: 'fx', fx: a.fx, start: Math.max(0, a.at), duration: a.duration || 3 };
      return { ...p, effectClips: [...p.effectClips, clip] };
    }
    case 'addText':
      return {
        ...p,
        textClips: [
          ...p.textClips,
          // Unset style keys fall back to TEXT_DEFAULTS in src/text/render.js.
          { id: a.clipId, text: 'Your text', start: a.at, duration: 3, y: 0.5, ...a.patch, ...(a.layer != null && { layer: a.layer }) },
        ],
      };
    case 'addGraphicTemplate':
      // Gap-build C: a grouped layer template (src/graphics/catalog.js) lands
      // as one dispatch — one undo step — with all parts sharing a groupId.
      return { ...p, textClips: [...p.textClips, ...(a.clips || [])] };
    case 'addSticker': {
      // Bundled sticker (10/10 step 3): a drawn PNG from shared/stickers/, centred at
      // 30% of the frame by default. The transform/opacity shape matches overlay clips,
      // so layerStyle (preview) and the layer builder (export) treat it identically.
      const clip = {
        id: a.clipId, sticker: a.sticker, name: a.name || 'Sticker',
        start: Math.max(0, a.at), duration: a.duration || 3,
        transform: { scale: 0.3, x: 0, y: 0 }, opacity: 1, w: a.w || 480, h: a.h || 480,
      };
      return { ...p, stickerClips: [...p.stickerClips, clip] };
    }
    case 'setAudioTrim': {
      // J/L-cut (P1-03): set the lead/trail of a linked audio clip and
      // rebuild its window from the picture + trims, clamped to the source
      // media. One undo step; the stored trims are the clamped ones.
      const aud = findClipIn(p, 'audio', a.id);
      if (!aud || !aud.linkId) return p;
      const info = linkedPairInfo(p, 'audio', aud);
      if (!info) return p;
      const mediaDur = (p.media || []).find((m) => m.id === aud.mediaId)?.duration;
      const want = audioWindowForPair(info.pic, info.picStart, { ...aud, audioTrim: { lead: a.lead ?? info.lead, trail: a.trail ?? info.trail } }, mediaDur);
      const trim = sanitizeAudioTrim({ lead: want.lead, trail: want.trail });
      return { ...p, audioClips: p.audioClips.map((c) => (c.id === a.id ? withSanitizedTrim({ ...c, start: want.start, in: want.in, out: want.out, ...(trim ? { audioTrim: trim } : { audioTrim: undefined }) }) : c)) };
    }
    case 'update': {
      const key = TRACKS[a.track];
      // Frame timebase (P1-04): a clip's timeline geometry — start and
      // duration — always lands on whole frames. Only those two fields are
      // quantized: in/out are SOURCE times (the media's own rate, not the
      // project's), and nested patches (keyframes, volKeys, fxTiming) carry
      // their own units. updateMany reduces through here, so multi-select
      // drags are covered too.
      const fps = effectiveFps(p);
      const patch = { ...a.patch };
      if (Number.isFinite(patch.start)) patch.start = Math.max(0, quantize(patch.start, fps));
      if (Number.isFinite(patch.duration)) patch.duration = Math.max(MIN_CLIP, quantize(patch.duration, fps));
      return { ...p, [key]: p[key].map((c) => (c.id === a.id ? applyClipPatch(c, patch) : c)) };
    }
    case 'addLayer':
      return { ...p, layers: { ...p.layers, [a.track]: layerCount(p, a.track) + 1 } };
    case 'removeLayer': {
      // Only an empty layer; the layers above it move down one — clips, names and layer
      // states all follow the same permutation.
      const key = LAYERED[a.track];
      if (!key || p[key].some((c) => layerOf(c) === a.layer) || layerCount(p, a.track) < 2) return p;
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      delete names[a.layer];
      for (const k of Object.keys(names).map(Number).sort((x, y) => x - y)) {
        if (k > a.layer) { names[k - 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, layers: { ...p.layers, [a.track]: layerCount(p, a.track) - 1 },
        [key]: p[key].map((c) => (layerOf(c) > a.layer ? { ...c, layer: layerOf(c) - 1 } : c)),
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (l === a.layer ? null : l > a.layer ? l - 1 : l)),
      };
    }
    case 'duplicateLayer': {
      // Layer context menu (item 13): deep-copy every clip of a layer onto a NEW layer placed
      // directly above it — no limit on how many times. Overlay/text draw higher layer
      // indexes above lower ones, so the copy takes layer+1 and higher layers shift up; audio
      // rows run the other way (layer 0 on top), so the copy takes the original's row and the
      // original (and everything below it) shifts down one. Layer names travel with their layer.
      // For the main track ('video', not a layered lane) the copy becomes a new TOP overlay
      // layer holding the same clips at the same times, as free-positioned overlay clips.
      if (a.track === 'video') {
        const target = layerCount(p, 'overlay');
        let i = 0;
        const copies = videoLayout(p.videoClips).filter((l) => !l.clip.gap).map((l) => {
          const copy = structuredClone(l.clip);
          copy.id = a.newIds[i++];
          copy.start = l.start;
          copy.layer = target;
          copy.transition = null;
          return copy;
        });
        if (!copies.length) return p;
        return { ...p, overlayClips: [...p.overlayClips, ...copies], layers: { ...p.layers, overlay: target + 1 } };
      }
      const key = LAYERED[a.track];
      if (!key) return p;
      const insertAt = a.track === 'audio' ? a.layer : a.layer + 1;
      let i = 0;
      const copies = p[key].filter((c) => layerOf(c) === a.layer).map((c) => {
        const copy = structuredClone(c);
        copy.id = a.newIds[i++];
        copy.layer = insertAt;
        return copy;
      });
      const shifted = p[key].map((c) => (layerOf(c) >= insertAt && !copies.some((x) => x.id === c.id) && (a.track === 'audio' || layerOf(c) !== a.layer)
        ? { ...c, layer: layerOf(c) + 1 } : c));
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      for (const k of Object.keys(names).map(Number).sort((x, y) => y - x)) {
        if (k >= insertAt && (a.track === 'audio' || k !== a.layer)) { names[k + 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, [key]: [...shifted, ...copies],
        layers: { ...p.layers, [a.track]: layerCount(p, a.track) + 1 },
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        // Layer states travel with their layers exactly like the names do; the fresh
        // copy layer starts from the defaults (no entry).
        layerState: remapLayerState(p, a.track, (l) => (l >= insertAt && (a.track === 'audio' || l !== a.layer) ? l + 1 : l)),
      };
    }
    case 'deleteLayer': {
      // Removes the layer AND its clips (unlike removeLayer, which only takes empty layers);
      // layers above move down one and their names follow. The last remaining layer is cleared
      // but kept, so a lane never drops below one layer. One dispatch = one undo step.
      if (a.track === 'video') return { ...p, videoClips: [] };
      const key = LAYERED[a.track];
      if (!key) return p;
      const rest = p[key].filter((c) => layerOf(c) !== a.layer)
        .map((c) => (layerOf(c) > a.layer ? { ...c, layer: layerOf(c) - 1 } : c));
      const names = { ...((p.layerNames || {})[a.track] || {}) };
      delete names[a.layer];
      for (const k of Object.keys(names).map(Number).sort((x, y) => x - y)) {
        if (k > a.layer) { names[k - 1] = names[k]; delete names[k]; }
      }
      return {
        ...p, [key]: rest,
        layers: { ...p.layers, [a.track]: Math.max(1, layerCount(p, a.track) - 1) },
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (l === a.layer ? null : l > a.layer ? l - 1 : l)),
      };
    }
    case 'moveLayer': {
      // Reorder (Stage C): layer `from` ends up at index `to`, the layers in between shift
      // by one. Clips, names and layer states are remapped through the one permutation, so
      // a single dispatch (one undo step) restores the exact prior order. The main track is
      // not in LAYERED and can never be reordered; overlay/text/audio reorder among
      // themselves (their layer 0 included — only 'video' is fixed).
      const key = LAYERED[a.track];
      if (!key) return p;
      const count = layerCount(p, a.track);
      const { from, to } = a;
      if (from === to || from < 0 || to < 0 || from >= count || to >= count) return p;
      const order = [...Array(count).keys()].filter((i) => i !== from);
      order.splice(to, 0, from); // order[newIndex] = oldIndex
      const perm = {};
      order.forEach((oldIdx, newIdx) => { perm[oldIdx] = newIdx; });
      const names = {};
      for (const [k, v] of Object.entries((p.layerNames || {})[a.track] || {})) {
        if (perm[Number(k)] !== undefined) names[perm[Number(k)]] = v;
      }
      return {
        ...p,
        [key]: p[key].map((c) => (perm[layerOf(c)] !== undefined && perm[layerOf(c)] !== layerOf(c) ? { ...c, layer: perm[layerOf(c)] } : c)),
        layerNames: { ...(p.layerNames || {}), [a.track]: names },
        layerState: remapLayerState(p, a.track, (l) => (perm[l] !== undefined ? perm[l] : l)),
      };
    }
    case 'insertAudioClip':
      // A fully-formed audio clip (Detach audio builds it in App: extracted file, timing, link).
      return { ...p, audioClips: [...p.audioClips, a.clip] };
    case 'renameLayer': {
      const forTrack = { ...((p.layerNames || {})[a.track] || {}) };
      if (a.name && a.name.trim()) forTrack[a.layer] = a.name.trim();
      else delete forTrack[a.layer];
      return { ...p, layerNames: { ...(p.layerNames || {}), [a.track]: forTrack } };
    }
    case 'updateMany':
      // Several clips changed together (one undo step): updates [{ track, id, patch }].
      return a.updates.reduce((q, u) => reduceProject(q, { type: 'update', ...u }), p);
    case 'proofreadCaptions': {
      // FB-25: the proofread dialog's edits, applied as one undo step.
      // Only caption text clips are touched; a patch's start/duration go
      // through the same frame quantisation as `update`, and a `words`
      // array (re-aligned by the dialog) replaces the clip's word timings.
      const fps = effectiveFps(p);
      return {
        ...p,
        textClips: p.textClips.map((c) => {
          const u = (a.patches || []).find((x) => x.id === c.id);
          if (!u || !c.caption) return c;
          const patch = { ...u.patch };
          if (Number.isFinite(patch.start)) patch.start = Math.max(0, quantize(patch.start, fps));
          if (Number.isFinite(patch.duration)) patch.duration = Math.max(0.2, quantize(patch.duration, fps));
          return { ...c, ...patch };
        }),
      };
    }
    case 'setMagnet': {
      const magnet = { ...p.magnet, [a.track]: a.on };
      // Turning the main-track magnet on closes every gap.
      if (a.track === 'video' && a.on) return { ...p, magnet, videoClips: p.videoClips.filter((c) => !c.gap) };
      return { ...p, magnet };
    }
    case 'delete': {
      const key = TRACKS[a.track];
      const c = p[key].find((x) => x.id === a.id);
      if (!c) return p;
      if (a.track === 'video') {
        // Deleting a gap, or deleting with the magnet on, closes the space; otherwise leave a gap behind.
        if (c.gap || p.magnet.video) return { ...p, videoClips: p.videoClips.filter((x) => x.id !== a.id) };
        const list = p.videoClips.map((x) => (x.id === a.id ? newGap(x.id, clipLen(x)) : x));
        return { ...p, videoClips: normalizeGaps(list) };
      }
      const rest = p[key].filter((x) => x.id !== a.id);
      if (!p.magnet[a.track]) return { ...p, [key]: rest };
      const len = freeLen(a.track, c);
      const end = c.start + len;
      const same = (x) => !LAYERED[a.track] || layerOf(x) === layerOf(c);
      return { ...p, [key]: rest.map((x) => (same(x) && x.start >= end - 1e-6 ? { ...x, start: Math.max(0, x.start - len) } : x)) };
    }
    case 'moveVideo': {
      const list = [...p.videoClips];
      const from = list.findIndex((c) => c.id === a.id);
      if (from < 0) return p;
      const [c] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(a.toIndex, list.length)), 0, c);
      return { ...p, videoClips: list };
    }
    case 'setCaptions': {
      // Replaces previous auto captions with new ones (one undo step).
      // Words keep their spoken timings (relative to the caption) for highlight / karaoke styles.
      const style = { y: 0.8, size: Math.round(Math.min(p.width, p.height) * 0.075), ...a.style };
      const caps = a.segments.map((s) => ({
        ...style,
        id: s.id,
        text: s.text,
        start: s.start,
        duration: Math.max(0.2, s.end - s.start),
        // AI-03: word confidence (local Whisper token probabilities) and
        // speaker labels (Deepgram diarization) ride into the clips, so the
        // transcript panel can review and label them. Absent = unknown.
        ...(s.speaker ? { speaker: s.speaker } : {}),
        words: (s.words || []).map((w) => ({ text: w.text, start: Math.max(0, w.start - s.start), end: Math.max(0, w.end - s.start), ...(Number.isFinite(w.conf) ? { conf: w.conf } : {}) })),
        caption: true,
      }));
      // Imported .srt subtitles (source: 'srt') are the user's own files: regenerating the
      // auto captions must not delete them, so only non-srt caption clips are replaced.
      return { ...p, textClips: [...p.textClips.filter((c) => !c.caption || c.source === 'srt'), ...caps] };
    }
    case 'importSrtCaptions': {
      // Subtitles parsed from an .srt file: exact file timings and text, styled with the
      // currently chosen caption template patch (a.style). One undo step for the whole file.
      const style = { y: 0.8, size: Math.round(Math.min(p.width, p.height) * 0.075), ...a.style };
      const caps = a.segments.map((s) => ({
        ...style,
        id: s.id,
        text: s.text,
        start: s.start,
        duration: Math.max(0.2, s.end - s.start),
        caption: true,
        source: 'srt',
      }));
      return { ...p, textClips: [...p.textClips, ...caps] };
    }
    case 'addTranslatedCaptions': {
      // Caption translation (v1.1.10): the translated lines land on their own
      // new text layer with the source captions' exact timings and styles —
      // the originals are untouched, and the whole layer is one undo step.
      const layer = Math.max(0, Math.floor(a.layer) || 0);
      const caps = (a.segments || []).map((s) => ({
        ...(s.style || {}),
        id: s.id,
        text: s.text,
        start: s.start,
        duration: Math.max(0.2, s.duration),
        caption: true,
        source: 'translation',
        lang: a.lang || '',
        layer,
      }));
      if (!caps.length) return p;
      return { ...p, textClips: [...p.textClips, ...caps] };
    }
    case 'removeSrtCaptions':
      return { ...p, textClips: p.textClips.filter((c) => c.source !== 'srt') };
    case 'styleSrtCaptions':
      // Style only the imported .srt subtitles (the Subtitles card's template grid).
      return { ...p, textClips: p.textClips.map((c) => (c.source === 'srt' ? { ...c, ...a.patch } : c)) };
    case 'styleCaptions':
      return { ...p, textClips: p.textClips.map((c) => (c.caption ? { ...c, ...a.patch } : c)) };
    case 'replaceCaptionText': {
      // Batch caption text editing (10/10 step 5, Filmora row 13's second
      // half): a literal find & replace across caption clips — imported .srt
      // subtitles, generated captions, or both — as ONE undo step. Timings
      // and styles are untouched; a no-match replace changes nothing.
      const find = typeof a.find === 'string' ? a.find : '';
      if (!find || find === a.replace) return p;
      const replace = typeof a.replace === 'string' ? a.replace : '';
      const inScope = (c) => (a.scope === 'srt' ? c.source === 'srt'
        : a.scope === 'captions' ? !!c.caption
        : a.scope === 'translation' ? c.source === 'translation'
        : c.source === 'srt' || !!c.caption || c.source === 'translation');
      let changed = false;
      const textClips = p.textClips.map((c) => {
        if (!inScope(c) || typeof c.text !== 'string' || !c.text.includes(find)) return c;
        changed = true;
        return { ...c, text: c.text.split(find).join(replace) };
      });
      return changed ? { ...p, textClips } : p;
    }
    case 'duplicate': {
      const key = TRACKS[a.track];
      const i = p[key].findIndex((c) => c.id === a.id);
      if (i < 0 || p[key][i].gap) return p;
      const c = p[key][i];
      const copy = { ...c, id: a.newId };
      // P2-03: a duplicate is an independent clip — it does not join the
      // original's group (otherwise selecting the copy would select the
      // original too). Split halves keep the group; duplicates do not.
      delete copy.groupId;
      if (a.track === 'video') copy.transition = null;
      else copy.start = c.start + freeLen(a.track, c);
      const list = [...p[key]];
      list.splice(i + 1, 0, copy);
      return { ...p, [key]: list };
    }
    case 'removeEffect': {
      // a.id: an effect object key (see effectObjects).
      const { track, clipId, fx } = parseEffectKey(a.id);
      const key = TRACKS[track];
      if (!key) return p;
      return { ...p, [key]: p[key].map((c) => {
        if (c.id !== clipId) return c;
        const fxRegions = { ...(c.fxRegions || {}) };
        delete fxRegions[fx]; // the region belongs to the effect instance; it goes with it
        const fxTiming = { ...(c.fxTiming || {}) };
        delete fxTiming[fx]; // …and so does the instance's timing window
        const fxStrength = { ...(c.fxStrength || {}) };
        delete fxStrength[fx]; // …and its strength: a stale entry would resurface as a
        // ghost value if the same effect were re-added later (Sprint 12 fix).
        const fxParams = { ...(c.fxParams || {}) };
        delete fxParams[fx]; // …and its per-effect parameters (§5), for the same reason.
        const fxKeys = { ...(c.fxKeys || {}) };
        delete fxKeys[fx]; // …and its intensity keyframes (P2-20), for the same reason.
        const fxBypass = { ...(c.fxBypass || {}) };
        delete fxBypass[fx]; // …and its bypass flag (FB-26).
        const fxSolo = { ...(c.fxSolo || {}) };
        delete fxSolo[fx]; // …and its solo flag (FB-26).
        return { ...c, effects: (c.effects || []).filter((e) => e !== fx), fxRegions, fxTiming, fxStrength, fxParams, fxKeys, fxBypass, fxSolo };
      }) };
    }
    case 'split':
      return splitLinked(p, a.track, a.id, a.t, a.newId);
    // ---- Gap-build Stream B -------------------------------------------------
    case 'bypassEffect': {
      // FX-01: toggle one effect's bypass (clip.fxBypass). The effect keeps
      // its settings; src/fx/apply.js skips it in preview and export alike.
      const { track, clipId, fx } = parseEffectKey(a.id);
      const key = TRACKS[track];
      if (!key) return p;
      return { ...p, [key]: p[key].map((c) => (c.id === clipId ? setFxBypass(c, fx, a.bypassed !== false) : c)) };
    }
    case 'moveEffect': {
      // FX-01: reorder one effect in the clip's stack (render order).
      const { track, clipId, fx } = parseEffectKey(a.id);
      const key = TRACKS[track];
      if (!key) return p;
      return { ...p, [key]: p[key].map((c) => (c.id === clipId ? moveFx(c, fx, a.dir || 0) : c)) };
    }
    case 'pasteFxStack': {
      // FX-01: replace a clip's whole effect stack with a copied one.
      const key = TRACKS[a.track];
      if (!key || !a.stack) return p;
      return { ...p, [key]: p[key].map((c) => (c.id === a.clipId ? pasteFxStack(c, a.stack) : c)) };
    }
    case 'jCut':
      // TL-03: the linked audio of clip a.id starts a.delta seconds early.
      return applyJCut(p, a.id, a.delta);
    case 'lCut':
      // TL-03: the linked audio of clip a.id runs a.delta seconds past the cut.
      return applyLCut(p, a.id, a.delta);
    case 'trimLinkedAudio':
      // TL-03: trim a linked audio clip's own window, video partner untouched.
      return trimLinkedAudio(p, a);
    case 'setFrameHold': {
      // P1-50: { at (source seconds), duration (timeline seconds) } or null.
      const key = TRACKS[a.track];
      if (!key) return p;
      const hold = a.hold && Number.isFinite(a.hold.at) && Number.isFinite(a.hold.duration)
        ? { at: a.hold.at, duration: Math.max(0.05, a.hold.duration) } : null;
      return { ...p, [key]: p[key].map((c) => (c.id === a.id ? { ...c, frameHold: hold } : c)) };
    }
    case 'setCaptionSpeaker': {
      // P1-32: speaker label on one caption clip.
      const speaker = typeof a.speaker === 'string' ? a.speaker.trim().slice(0, 40) : '';
      return { ...p, textClips: p.textClips.map((c) => (c.id === a.clipId ? { ...c, speaker: speaker || undefined } : c)) };
    }
    case 'setTranscriptSettings':
      // P1-33: project-level transcript settings (confidence threshold).
      return { ...p, transcript: { ...(p.transcript || {}), ...a.patch } };
    case 'applySplitScreen': {
      // Split Screen tool: two picture clips side by side / stacked.
      const patches = splitScreenPatches(p, a);
      if (!patches.length) return p;
      return patches.reduce((q, u) => reduceProject(q, { type: 'update', ...u }), p);
    }
    case 'setPanZoom': {
      // Pan-Zoom tool: adds the fx_panzoom effect with params spanning the clip.
      const key = TRACKS[a.track];
      if (!key) return p;
      return { ...p, [key]: p[key].map((c) => (c.id === a.id ? { ...c, ...panZoomPatch(c, a.panZoom || {}) } : c)) };
    }
    case 'qwTrim': {
      // Q/W trim (spec matrix): Q deletes everything before the playhead in
      // the clip, W deletes everything after it. Implemented as the store's
      // existing trimActions (split + delete one half); the track magnet is
      // the ripple — magnet on closes the space, magnet off leaves a gap
      // (video) / the clips stay put (free tracks). One dispatch, one undo step.
      const side = a.which === 'q' ? 'left' : a.which === 'w' ? 'right' : null;
      if (!side) return p;
      const newId = a.newId || uid();
      return trimActions(p, { track: a.track, id: a.id, t: a.t, side, newId })
        .reduce((acc, sub) => reduceProject(acc, sub), p);
    }
    case 'setTrimMode':
      // Q/W trim mode (spec matrix): the Timeline's trim tool reads this.
      return ['ripple', 'roll', 'slip', 'slide', 'qw'].includes(a.mode) ? { ...p, trimMode: a.mode } : p;
    case 'moveToOverlay': {
      // Main clip -> overlay track at time `at` (the main track closes up or keeps a gap, per its magnet).
      const c = p.videoClips.find((x) => x.id === a.id);
      if (!c || c.gap) return p;
      const rest = reduceProject(p, { type: 'delete', track: 'video', id: a.id });
      return { ...rest, overlayClips: [...rest.overlayClips, { ...c, start: Math.max(0, a.at), transition: null }] };
    }
    case 'moveToMain': {
      // Overlay clip -> main track at position `index`.
      const c = p.overlayClips.find((x) => x.id === a.id);
      if (!c) return p;
      const rest = reduceProject(p, { type: 'delete', track: 'overlay', id: a.id });
      const { start, ...clip } = c;
      const list = [...rest.videoClips];
      list.splice(Math.max(0, Math.min(a.index ?? list.length, list.length)), 0, { ...clip, transition: null });
      return { ...rest, videoClips: list };
    }
    case 'extractAudio': {
      // Extract the sound of a video clip onto the audio track as an INDEPENDENT clip
      // (same timing, same media, no linkId — unlike Detach audio, nothing stays in
      // sync afterwards) and mute the clip. The copy carries the clip's timing —
      // constant speed AND speed curve — so the sampler gives both clips the
      // same timeline length at any rate.
      const key = TRACKS[a.track];
      const c = key && p[key].find((x) => x.id === a.id);
      const m = c && p.media.find((x) => x.id === c.mediaId);
      if (!c || c.gap || !m || m.type !== 'video' || !m.hasAudio || c.muted) return p;
      const start = a.track === 'video' ? videoLayout(p.videoClips).find((l) => l.clip.id === c.id).start : c.start;
      // The copy carries the clip's whole gain model — volume, fades and
      // volume keyframes (same media file, so the keys' absolute source
      // times stay true) — so extracting never changes how the sound plays.
      const audio = { id: a.newId, mediaId: m.id, start, in: c.in, out: c.out, speed: c.speed || 1, ...(c.speedCurve ? { speedCurve: c.speedCurve } : {}), volume: c.volume ?? 1, fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, ...(c.volKeys ? { volKeys: c.volKeys } : {}), role: 'dialogue' }; // P2-23: extracted sound is the picture's dialogue
      return { ...p, [key]: p[key].map((x) => (x.id === c.id ? { ...x, muted: true } : x)), audioClips: [...p.audioClips, audio] };
    }
    case 'paste': {
      // A copied clip at time `at`: main clips are inserted where `at` falls, others start at `at`.
      const key = TRACKS[a.track];
      if (!key || !a.clip) return p;
      if (a.track === 'video') {
        const list = [...p.videoClips];
        const index = videoLayout(list).filter((l) => (l.start + l.end) / 2 < a.at).length;
        list.splice(index, 0, { ...a.clip, id: a.newId, transition: null });
        return { ...p, videoClips: list };
      }
      return { ...p, [key]: [...p[key], { ...a.clip, id: a.newId, start: Math.max(0, a.at) }] };
    }
    case 'cutRanges':
      // TL-02: a dispatched cut with rippleLinked is opt-in linked ripple
      // (every free track moves); default 'main' behaves exactly as
      // before. A project rippleMode of 'linked' is NOT mapped here —
      // rippleModeOf already honours it as partners-only 'linked', which
      // is distinct from TL-02's every-track ripple.
      return cutRanges(p, a.ranges, { rippleText: !!a.rippleText, rippleMode: a.rippleMode || p.rippleMode, rippleLinked: !!a.rippleLinked });
    case 'setRippleMode':
      return { ...p, rippleMode: RIPPLE_MODES.includes(a.mode) ? a.mode : 'main' };
    case 'cutFreeRanges':
      return cutFreeRanges(p, a.track, a.id, a.ranges);
    case 'addMarker':
      return { ...p, markers: [...p.markers, { id: a.id, time: Math.max(0, a.time), label: a.label || '', color: markerColorId(a.color) }].sort((x, y) => x.time - y.time) };
    case 'addMarkers': {
      // Bulk add (auto chapters, v1.1.11): the whole batch is one undo step.
      // A marker within half a second of an existing one (or of another in
      // the batch) is skipped — chapters never stack duplicates on re-runs.
      const kept = [];
      const taken = (p.markers || []).map((m) => m.time);
      for (const m of a.markers || []) {
        const t = Math.max(0, Number(m.time) || 0);
        if (taken.some((x) => Math.abs(x - t) < 0.5)) continue;
        taken.push(t);
        kept.push({ id: m.id, time: t, label: m.label || '', color: markerColorId(m.color) });
      }
      if (!kept.length) return p;
      return { ...p, markers: [...p.markers, ...kept].sort((x, y) => x.time - y.time) };
    }
    case 'removeMarker':
      return { ...p, markers: p.markers.filter((m) => m.id !== a.id) };
    case 'setMarkerColor': {
      // Colour per marker (10/10 step 5): only palette ids land; anything
      // else leaves the project untouched.
      if (!MARKER_COLORS.some((c) => c.id === a.color)) return p;
      return { ...p, markers: p.markers.map((m) => (m.id === a.id ? { ...m, color: a.color } : m)) };
    }
    case 'clearMarkers':
      return p.markers.length ? { ...p, markers: [] } : p;
    case 'removeMarkersInRange': {
      // Bulk delete (step 5): every marker inside [from, to) goes, in one
      // undo step — the in-clip counterpart of clearing the whole ruler.
      const from = Math.min(a.from || 0, a.to || 0);
      const to = Math.max(a.from || 0, a.to || 0);
      const next = p.markers.filter((m) => m.time < from || m.time >= to);
      return next.length === p.markers.length ? p : { ...p, markers: next };
    }
    case 'setBeats':
      // The soundtrack's beat grid (Beat cuts): { bpm, times } or null to clear it.
      return { ...p, beats: a.beats && Array.isArray(a.beats.times) && a.beats.times.length ? { bpm: a.beats.bpm || 0, times: [...a.beats.times].sort((x, y) => x - y), offset: Number.isFinite(Number(a.beats.offset)) ? Number(a.beats.offset) : 0, manual: !!a.beats.manual, source: typeof a.beats.source === 'string' ? a.beats.source : 'detected' } : null };
    case 'setBeatGrid': {
      // P2-22: manual tempo grid — the user names a BPM (and a first-beat
      // offset) and the grid is generated over the whole project. This is the
      // override for a mis-heard detection or a track with no audio to hear.
      const bpm = clampBpm(a.bpm);
      const offset = Math.min(1, Math.max(-1, Number(a.offset) || 0));
      const times = beatGrid(bpm, offset, 0, projectDuration(p));
      return { ...p, beats: times.length ? { bpm, times, offset, manual: true, source: 'manual' } : null };
    }
    case 'setBeatOffset': {
      // P2-22: nudge a grid's first beat without changing its tempo — the
      // grid regenerates from the stored BPM (detected or manual).
      if (!p.beats || !p.beats.bpm) return p;
      const offset = Math.min(1, Math.max(-1, Number(a.offset) || 0));
      const times = beatGrid(p.beats.bpm, offset, 0, projectDuration(p));
      return { ...p, beats: times.length ? { ...p.beats, times, offset } : null };
    }
    case 'setBeatSnap':
      // P2-22: beat snapping on/off (independent of the general snap toggle).
      return { ...p, beatSnap: !!a.on };
    case 'setClipRole': {
      // P2-23: assign an audio role to one clip (its bus). Unknown roles refuse.
      if (!isRole(a.role)) return p;
      const c = findClipIn(p, a.track, a.id);
      if (!c || c.gap) return p;
      return mapClip(p, a.track, a.id, (x) => ({ ...x, role: a.role }));
    }
    case 'setMixer': {
      // P2-23: mixer patch — gains (dB), master, muted / solo maps. Mute/solo
      // maps merge (one bus at a time); gains are clamped on the way in.
      const patch = a.patch || {};
      const cur = sanitizeMixer(p.mixer);
      const next = { ...cur };
      for (const r of ['dialogue', 'music', 'sfx', 'ambience', 'master']) {
        if (Number.isFinite(Number(patch[r]))) next[r] = clampGainDb(patch[r]);
      }
      for (const k of ['muted', 'solo']) {
        if (patch[k] && typeof patch[k] === 'object') next[k] = { ...cur[k], ...patch[k] };
      }
      return { ...p, mixer: sanitizeMixer(next) };
    }
    case 'rollEdit':
      // P2-01: move the edit point between two adjacent clips (total fixed).
      return rollEdit(p, a);
    case 'slipClip':
      // P2-01: move the source window inside the media (start/length fixed).
      return slipClip(p, a);
    case 'slideClip':
      // P2-01: move the clip; neighbours absorb it (total fixed).
      return slideClip(p, a);
    case 'rateStretch':
      // P2-01: change duration by changing speed; window fixed, pitch mode explicit.
      return rateStretch(p, a);
    case 'groupClips': {
      // P2-03: give every named clip the same groupId (one undo step). A clip
      // already in a group keeps its group unless a.groupId names another.
      const gid = a.groupId || uid();
      let out = p;
      for (const it of a.items || []) {
        const c = findClipIn(out, it.track, it.id);
        if (!c || c.gap) continue;
        if (groupIdOf(c) === gid) continue;
        out = mapClip(out, it.track, it.id, (x) => ({ ...x, groupId: gid }));
      }
      return out;
    }
    case 'ungroupClips': {
      // P2-03: dissolve the group of every named clip — naming one member
      // frees the whole group (ungrouping half a group would leave a
      // phantom group behind). Clips with no group are untouched.
      let out = p;
      const gids = new Set();
      for (const it of a.items || []) {
        const c = findClipIn(out, it.track, it.id);
        const g = c && groupIdOf(c);
        if (g) gids.add(g);
      }
      if (!gids.size) return p;
      const strip = (list) => (list || []).map((c) => (groupIdOf(c) && gids.has(groupIdOf(c)) ? (() => { const n = { ...c }; delete n.groupId; return n; })() : c));
      return {
        ...out,
        videoClips: strip(out.videoClips),
        overlayClips: strip(out.overlayClips),
        audioClips: strip(out.audioClips),
        textClips: strip(out.textClips),
        stickerClips: strip(out.stickerClips),
        effectClips: strip(out.effectClips),
      };
    }
    case 'splitAtBeats':
      return splitClipAtBeats(p, a.id, a.newIds || []);
    case 'splitAtTimes':
      return splitClipAtTimes(p, a.track || 'video', a.id, a.times || [], a.newIds || []);
    case 'insertClip':
      return insertClip(p, a);
    case 'moveRanges':
      return moveRanges(p, a.ranges, a.to);
    default:
      return p;
  }
}

// Every reduction funnels through here so a motion-tracking pin can never dangle: deleting a clip (or
// a whole layer of clips) or clearing a clip's track takes the pin off every follower that used it.
function reduceProject(p, a) {
  let next = reduceProjectInner(p, a);
  if (next === p) return next;
  // The active sequence entry mirrors the flat timeline after every
  // reduction (see src/sequences.js): saves and switches can never see a
  // stale active entry, and undo snapshots stay self-consistent.
  next = syncActiveSequence(next);
  if (a.type === 'delete') return cleanPins(next, new Set([a.id]));
  if (a.type === 'deleteLayer' || a.type === 'load') return cleanPins(next);
  if (a.type === 'update' && 'track' in (a.patch || {}) && !a.patch.track) return cleanPins(next);
  if (a.type === 'updateMany') return cleanPins(next);
  return next;
}

// Trims one edge of a clip. `delta` is how much that edge moves INTO the clip, in timeline seconds
// (positive shortens, negative extends). Always computed from the project at gesture start, so repeated
// pointer moves never accumulate. Main track (magnet off): the removed time becomes a gap, and extending
// uses up the neighbouring gap. Free tracks (magnet on): the trimmed clip keeps its start and later clips
// shift by the length change (ripple).
export function trimClip(p, { track, id, edge, delta }) {
  // Duration-adaptive presets (P2-11): a trim that shortens the clip rescales
  // its stored preset timing (anim in/out, text anims, transition) instead of
  // leaving long durations to be silently clamped at playback, and records
  // what could not be adapted on clip.adaptReport.
  const key = TRACKS[track];
  const before = p[key]?.find((c) => c.id === id);
  const lenOf = (c) => (track === 'video' || track === 'overlay' || track === 'audio' ? clipLen(c) : c.duration);
  const oldLen = before ? lenOf(before) : 0;
  const next = trimClipRaw(p, { track, id, edge, delta });
  if (next === p || !before) return next;
  const after = next[key]?.find((c) => c.id === id);
  if (!after) return next;
  const newLen = lenOf(after);
  if (Math.abs(newLen - oldLen) < 1e-6) return next;
  // A trim re-bases a frame hold (P1-50): the hold point moves with the
  // clip's local time, and a hold that no longer fits is dropped.
  const held = rebaseHoldAfterTrim(after, oldLen, newLen, edge);
  const heldNext = held === after ? next : { ...next, [key]: next[key].map((c) => (c.id === id ? held : c)) };
  const { patch } = adaptClipPresets(held, oldLen, newLen);
  if (!patch) return heldNext;
  return { ...heldNext, [key]: heldNext[key].map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

function trimClipRaw(p, { track, id, edge, delta }) {
  const key = TRACKS[track];
  const idx = p[key].findIndex((c) => c.id === id);
  if (idx < 0) return p;
  // Frame timebase (P1-04): the drag delta is in timeline seconds — snap it
  // to whole frames first, so a trim moves a clip edge by whole frames and
  // the ripple that follows keeps every later boundary on the grid. The
  // gap bookkeeping below derives everything from this delta, so it stays
  // consistent; the source window follows through the speed mapping.
  delta = quantize(delta, effectiveFps(p));
  const c = p[key][idx];

  if (track === 'video') {
    const list = [...p.videoClips];
    if (c.gap) {
      list[idx] = { ...c, out: Math.max(MIN_CLIP, c.out - delta) };
      return { ...p, videoClips: normalizeGaps(list) };
    }
    const m = p.media.find((x) => x.id === c.mediaId);
    if (hasCurve(c)) {
      // Speed-ramped clip: the dragged edge moves in TIMELINE seconds, the source
      // edge follows the curve integral (extending past an edge extrapolates at
      // that edge's rate), and the surviving window keeps its slice of the curve.
      // d stays the timeline delta the gap bookkeeping below expects.
      const maxOutC = !m || m.type === 'image' ? Infinity : m.duration;
      const span = c.out - c.in;
      const len = clipLen(c);
      let d;
      if (edge === 'left') {
        const prev = list[idx - 1];
        const avail = prev && prev.gap ? clipLen(prev) : 0;
        const maxOff = sourceOffsetAt(c, Math.max(0, len - MIN_CLIP));
        const want = delta >= 0 ? sourceOffsetAt(c, delta) : delta * speedAtSource(c, 0);
        let newIn = Math.max(0, Math.min(c.in + want, c.in + maxOff));
        d = Math.max(timelineOffsetAt(c, newIn - c.in), -avail);
        newIn = c.in + (d >= 0 ? sourceOffsetAt(c, d) : d * speedAtSource(c, 0));
        list[idx] = { ...c, in: newIn, speedCurve: sliceCurve(c, newIn - c.in, span) };
        if (d > 0) {
          if (prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + d };
          else list.splice(idx, 0, newGap(`${id}-gl`, d));
        } else if (d < 0 && prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + d };
      } else {
        const after = list[idx + 1];
        const avail = !after ? Infinity : after.gap ? clipLen(after) : 0;
        const edgeRate = speedAtSource(c, span);
        const targetLen = len - delta;
        let newSpan = targetLen <= len
          ? sourceOffsetAt(c, Math.max(MIN_CLIP, targetLen))
          : span + (targetLen - len) * edgeRate;
        newSpan = Math.min(newSpan, Math.max(0, maxOutC - c.in));
        const newDur = newSpan <= span ? timelineOffsetAt(c, newSpan) : len + (newSpan - span) / edgeRate;
        d = Math.max(len - newDur, -avail);
        newSpan = d >= 0 ? sourceOffsetAt(c, len - d) : span + (-d) * edgeRate;
        list[idx] = { ...c, out: c.in + newSpan, speedCurve: sliceCurve(c, 0, newSpan) };
        if (d > 0) {
          if (after && after.gap) list[idx + 1] = { ...after, out: after.out + d };
          else if (after) list.splice(idx + 1, 0, newGap(`${id}-gr`, d));
        } else if (d < 0 && after && after.gap) list[idx + 1] = { ...after, out: after.out + d };
      }
      return { ...p, videoClips: normalizeGaps(list) };
    }
    const sp = c.speed || 1;
    const maxOut = !m || m.type === 'image' ? Infinity : m.duration;
    let d;
    if (edge === 'left') {
      const prev = list[idx - 1];
      const avail = prev && prev.gap ? clipLen(prev) : 0;
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = Math.max((newIn - c.in) / sp, -avail);
      list[idx] = { ...c, in: c.in + d * sp };
      if (d > 0) {
        if (prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + d };
        else list.splice(idx, 0, newGap(`${id}-gl`, d));
      } else if (d < 0 && prev && prev.gap) list[idx - 1] = { ...prev, out: prev.out + d };
    } else {
      const after = list[idx + 1];
      const avail = !after ? Infinity : after.gap ? clipLen(after) : 0;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = Math.max((c.out - newOut) / sp, -avail);
      list[idx] = { ...c, out: c.out - d * sp };
      if (d > 0) {
        if (after && after.gap) list[idx + 1] = { ...after, out: after.out + d };
        else if (after) list.splice(idx + 1, 0, newGap(`${id}-gr`, d));
      } else if (d < 0 && after && after.gap) list[idx + 1] = { ...after, out: after.out + d };
    }
    return { ...p, videoClips: normalizeGaps(list) };
  }

  // Free tracks.
  const len = freeLen(track, c);
  const m = c.mediaId && p.media.find((x) => x.id === c.mediaId);
  let d;
  let next;
  if ((track === 'overlay' || track === 'audio') && hasCurve(c)) {
    // Speed-ramped clip: same integral mapping as the main track's curve trim —
    // the edge moves in timeline seconds, the source edge follows the curve,
    // and the surviving window keeps its slice. d is the timeline length change
    // the ripple below shifts later clips by.
    const span = c.out - c.in;
    const maxOut = track === 'overlay'
      ? (m && m.type === 'video' ? m.duration : Infinity)
      : (m ? m.duration : Infinity);
    if (edge === 'left') {
      const maxOff = sourceOffsetAt(c, Math.max(0, len - MIN_CLIP));
      const want = delta >= 0 ? sourceOffsetAt(c, delta) : delta * speedAtSource(c, 0);
      const newIn = Math.max(0, Math.min(c.in + want, c.in + maxOff));
      d = timelineOffsetAt(c, newIn - c.in);
      next = { ...c, in: newIn, speedCurve: sliceCurve(c, newIn - c.in, span) };
    } else {
      const edgeRate = speedAtSource(c, span);
      const targetLen = len - delta;
      let newSpan = targetLen <= len
        ? sourceOffsetAt(c, Math.max(MIN_CLIP, targetLen))
        : span + (targetLen - len) * edgeRate;
      newSpan = Math.min(newSpan, Math.max(0, maxOut - c.in));
      const newDur = newSpan <= span ? timelineOffsetAt(c, newSpan) : len + (newSpan - span) / edgeRate;
      d = len - newDur;
      next = { ...c, out: c.in + newSpan, speedCurve: sliceCurve(c, 0, newSpan) };
    }
  } else if (track === 'overlay') {
    // Same as audio, with speed (timeline seconds vs source seconds) and endless photos.
    const sp = c.speed || 1;
    if (edge === 'left') {
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = (newIn - c.in) / sp;
      next = { ...c, in: newIn };
    } else {
      const maxOut = m && m.type === 'video' ? m.duration : Infinity;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = (c.out - newOut) / sp;
      next = { ...c, out: newOut };
    }
  } else if (track === 'audio') {
    // delta arrives in timeline seconds; the source window moves by delta * speed, and the
    // ripple shift of later clips is the timeline difference again.
    const sp = c.speed || 1;
    if (edge === 'left') {
      const newIn = Math.max(0, Math.min(c.in + delta * sp, c.out - MIN_CLIP * sp));
      d = (newIn - c.in) / sp;
      next = { ...c, in: newIn };
    } else {
      const maxOut = m ? m.duration : Infinity;
      const newOut = Math.max(c.in + MIN_CLIP * sp, Math.min(c.out - delta * sp, maxOut));
      d = (c.out - newOut) / sp;
      next = { ...c, out: newOut };
    }
  } else {
    // Duration-based clips (text / effect / sticker): a right trim only
    // shortens the clip. A left trim moves the START later and shortens the
    // clip — the end is preserved — and frees space BEFORE the clip, so the
    // followers (which start at the preserved end) do not shift: d is 0 for
    // the ripple below. Before this fix the branch never moved `start`, so a
    // left trim shortened the clip from the wrong end (and the ripple then
    // dragged the followers onto the shortened tail).
    if (edge === 'left') {
      d = Math.min(Math.max(delta, -c.start), len - MIN_CLIP);
      next = { ...c, start: c.start + d, duration: len - d };
      d = 0;
    } else {
      d = Math.min(delta, len - MIN_CLIP);
      next = { ...c, duration: len - d };
    }
  }
  const oldEnd = c.start + len;
  const out = p[key].map((x) => {
    if (x.id === id) return next;
    if (p.magnet[track] && x.start >= oldEnd - 1e-6 && (!LAYERED[track] || layerOf(x) === layerOf(c))) return { ...x, start: Math.max(0, x.start - d) };
    return x;
  });
  return { ...p, [key]: out };
}

// Actions for "delete the part of a clip left (or right) of time t". The clip is split at t and one half is
// deleted through the normal delete, so the track magnet decides between closing the gap and leaving one.
// Returns [] when t is not inside the clip (or too close to its edge).
export function trimActions(p, { track, id, t, side, newId }) {
  // Frame timebase (P1-04): same cut quantization as splitAt — the split
  // this returns is the one that runs, so the guard below and the split
  // must agree on the same (quantized) time.
  t = quantize(t, effectiveFps(p));
  const key = TRACKS[track];
  const c = key && p[key].find((x) => x.id === id);
  if (!c || c.gap) return [];
  let start;
  let end;
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
    start = l.start;
    end = l.end;
  } else {
    start = c.start;
    end = c.start + freeLen(track, c);
  }
  if (t - start < MIN_CLIP || end - t < MIN_CLIP) return [];
  const actions = [{ type: 'split', track, id, t, newId }];
  // Delete-left on the main track: the split builds the surviving right half with
  // transition: null (correct for a plain split, whose right half starts mid-clip),
  // and the left half — the one carrying the incoming transition — is the one being
  // deleted. But after the ripple the remainder starts the clip, adjacent to the same
  // previous clip, so the transition belongs to it: hand it over, stored verbatim like
  // everywhere else. Its effective length is clamped at use time by transitionDur
  // (half of either neighbour), the same clamp the split/trim paths already rely on.
  // Delete-right keeps the original clip as the remainder, transition already in place.
  if (track === 'video' && side === 'left' && c.transition) {
    actions.push({ type: 'update', track: 'video', id: newId, patch: { transition: c.transition } });
  }
  actions.push({ type: 'delete', track, id: side === 'left' ? id : newId });
  return actions;
}

// One shared cut-range normalizer (P1-01): every cut path funnels its ranges
// through here, at the reducer boundary, so overlapping ranges can never
// double-count. The implementation lives in './intervals.js' (merged with
// TL-01: gap-e's normalizeRanges was the same algorithm under another name);
// store.js re-exports it so existing `from './store.js'` import sites keep
// working.
export { normalizeCutRanges } from './intervals.js';

// Ripple modes (P1-02): which tracks a ripple cut (cutRanges) moves.
// 'main' — the main track only (captions only when the caller asks via
// rippleText; the historical behaviour). 'linked' — the main track, the
// captions, and the audio/overlay partners linked to the cut video clips.
// 'all' — every unlocked free-track clip (overlays, audio, stickers,
// effect regions) is cut by the same ranges; locked clips stay put.
export const RIPPLE_MODES = ['main', 'linked', 'all'];
export const rippleModeOf = (p, opts = {}) =>
  (opts.rippleMode && RIPPLE_MODES.includes(opts.rippleMode) && opts.rippleMode)
  || (p && RIPPLE_MODES.includes(p.rippleMode) && p.rippleMode)
  || 'main';

// After a ripple cut, the pieces of a linked pair share the pair's original
// linkId — syncLinked only ever sees one entry per linkId (its map holds the
// last pair) and would rewrite the audio from the wrong piece. Re-pair the
// pieces by timeline order: piece i of the picture with piece i of the
// audio, a fresh linkId per pair, offsets recomputed from the pieces
// themselves. A piece with no counterpart becomes an independent clip.
// Untouched pairs re-pair to themselves (same id, same offsets), so this is
// safe to run over the whole project after any linked/all ripple cut.
function repairCutLinkIds(p) {
  const layout = videoLayout(p.videoClips);
  const picStartOf = (track, c) => (track === 'video'
    ? (layout.find((l) => l.clip.id === c.id)?.start ?? 0)
    : (c.start || 0));
  const groups = new Map();
  const add = (linkId, side, track, clip) => {
    if (!linkId) return;
    const g = groups.get(linkId) || { pics: [], auds: [] };
    if (side === 'pic') g.pics.push({ track, clip });
    else g.auds.push(clip);
    groups.set(linkId, g);
  };
  for (const c of layout.map((l) => l.clip)) add(c.linkId, 'pic', 'video', c);
  for (const c of [...(p.overlayClips || [])].sort((a, b) => (a.start || 0) - (b.start || 0))) add(c.linkId, 'pic', 'overlay', c);
  for (const c of [...(p.audioClips || [])].sort((a, b) => (a.start || 0) - (b.start || 0))) add(c.linkId, 'aud', 'audio', c);
  let out = p;
  const put = (track, id, patch) => {
    const key = TRACKS[track];
    out = { ...out, [key]: out[key].map((c) => (c.id === id ? { ...c, ...patch } : c)) };
  };
  for (const [linkId, g] of groups) {
    if (!g.pics.length || !g.auds.length) continue;
    const n = Math.min(g.pics.length, g.auds.length);
    for (let i = 0; i < n; i++) {
      const newId = i === 0 ? linkId : `${linkId}~cut${i}`;
      const pic = g.pics[i];
      const aud = g.auds[i];
      // The base alignment (linkOff / linkInOff) is translation-invariant:
      // a cut never changes it, so the pieces keep the inherited values.
      // The J/L trims (P1-03) ARE re-derived from the cut windows: how far
      // this audio piece starts before / ends after its own picture piece.
      // (Deriving the offsets from positions instead would bake the lead
      // into linkOff and double-count it on the next picture move.)
      const picStart0 = picStartOf(pic.track, pic.clip);
      const picLen = pic.track === 'video' ? clipDuration(pic.clip) : clipLen(pic.clip);
      const eps = (v) => (v > 1e-9 ? v : 0);
      const lead = eps(Math.max(0, picStart0 + (aud.linkOff || 0) - (aud.start || 0)));
      const trail = eps(Math.max(0, (aud.start || 0) + clipDuration(aud) - (picStart0 + picLen + (aud.linkOff || 0))));
      put(pic.track, pic.clip.id, { linkId: newId });
      put('audio', aud.id, { linkId: newId, audioTrim: sanitizeAudioTrim({ lead, trail }) });
    }
    for (let i = n; i < g.pics.length; i++) put(g.pics[i].track, g.pics[i].clip.id, { linkId: undefined, linkOff: undefined, linkInOff: undefined });
    for (let i = n; i < g.auds.length; i++) put('audio', g.auds[i].id, { linkId: undefined, linkOff: undefined, linkInOff: undefined, audioTrim: undefined });
  }
  return out;
}

// Subtract sorted, merged cut ranges from one [a, b) interval; returns the
// surviving pieces in the interval's own coordinates.
function subtractRanges(a, b, cuts) {
  let pieces = [[a, b]];
  for (const r of cuts) {
    pieces = pieces.flatMap(([x, y]) => {
      if (r.end <= x || r.start >= y) return [[x, y]];
      const keep = [];
      if (r.start > x) keep.push([x, r.start]);
      if (r.end < y) keep.push([r.end, y]);
      return keep;
    });
  }
  return pieces;
}

// Text clips after a ripple cut of the main track (transcript editing, v1.1.5):
// the cuts are subtracted from every text clip and everything later shifts
// earlier by the cut length before it, so captions stay locked to the picture
// they caption. A clip a cut passes through splits into pieces (ids derived
// like the video pieces); words that touch a cut are dropped, the survivors
// are re-based to their piece, and a word-timed clip's text is rebuilt from
// its remaining words — the same convention splitTimed uses.
function rippleTextClips(textClips, cuts) {
  // TL-01: cuts are normalized once here, so cutBefore never double-counts
  // an overlap (the old inline reduce summed each range independently).
  const cutBefore = cutBeforeFn(cuts);
  const out = [];
  for (const c of textClips) {
    const s = c.start;
    const e = c.start + c.duration;
    const pieces = subtractRanges(s, e, cuts).filter(([a, b]) => b - a >= 0.03);
    if (!pieces.length) continue;
    pieces.forEach(([a, b], i) => {
      const start = a - cutBefore(a);
      const clip = { ...c, id: i ? `${c.id}-r${i}` : c.id, start, duration: b - a };
      if (c.words && c.words.length) {
        const kept = c.words
          .map((w) => ({ ...w, absStart: s + w.start, absEnd: s + w.end }))
          .filter((w) => w.absStart >= a - 1e-6 && w.absEnd <= b + 1e-6
            && !cuts.some((r) => w.absStart < r.end - 1e-6 && w.absEnd > r.start + 1e-6));
        clip.words = kept.map((w) => ({ text: w.text, start: w.absStart - a, end: w.absEnd - a, ...(Number.isFinite(w.conf) ? { conf: w.conf } : {}) }));
        clip.text = kept.map((w) => w.text).join(' ');
      }
      out.push(clip);
    });
  }
  return out;
}

// Removes time ranges from the main track and closes the space (ripple). ranges: [{ start, end }] in timeline
// seconds. Only the main track is cut; music and overlays keep their own time. With
// opts.rippleText the text clips are cut and shifted along with the picture —
// the transcript-editing path, where captions must stay in sync with what they
// caption. Cut pieces get ids derived from the clip id so repeated cuts never collide.
export function cutRanges(p, ranges, opts = {}) {
  // TL-01: normalize FIRST — overlapping ranges merge, so the removed time
  // is counted once everywhere downstream (pieces, rippleTextClips, linked
  // ripple). Previously this only sorted, and cutBefore double-counted.
  const layout0 = videoLayout(p.videoClips);
  const total = layout0.length ? layout0[layout0.length - 1].end : 0;
  const cuts = normalizeCutRanges(ranges, total);
  if (!cuts.length) return p;
  // TL-02's opts.rippleLinked means "every free track moves with the
  // picture" — that is HEAD's 'all' mode (HEAD's 'linked' moves linked
  // partners only), so map it here.
  const mode = opts.rippleLinked ? 'all' : rippleModeOf(p, opts);
  const out = [];
  for (const l of layout0) {
    const c = l.clip;
    const pieces = subtractRanges(l.start, l.end, cuts);
    pieces.filter(([a, b]) => b - a >= 0.03).forEach(([a, b], i) => {
      const id = i ? `${c.id}-c${i}` : c.id;
      if (c.gap) out.push({ ...c, id, in: 0, out: b - a });
      else {
        // Timeline -> source through the sampler (constant * speed for plain
        // clips, the curve integral for ramped ones); each piece keeps the
        // slice of the curve that covers its own source window.
        const inOff = sourceOffsetAt(c, a - l.start);
        const outOff = sourceOffsetAt(c, b - l.start);
        // FB-24: in 'main' mode a split piece gets its own linkId (piece 0
        // keeps the pair's), so the linked audio partner can be rebuilt
        // piece for piece below instead of every piece claiming the same
        // pair. In 'linked'/'all' modes the pieces keep the original
        // linkId: repairCutLinkIds pairs them by that id, and suffixed ids
        // would strand each piece in its own group.
        const linkPatch = c.linkId && mode === 'main' ? { linkId: i ? `${c.linkId}-c${i}` : c.linkId } : {};
        out.push({ ...c, id, in: c.in + inOff, out: c.in + outOff, speedCurve: sliceCurve(c, inOff, outOff), transition: i ? null : c.transition, frameHold: pieceFrameHold(c.frameHold, a - l.start, b - l.start) || undefined, ...linkPatch });
      }
    });
  }
  const next = { ...p, videoClips: normalizeGaps(out) };
  if (mode !== 'main' || opts.rippleText) next.textClips = rippleTextClips(p.textClips, cuts);
  if (mode === 'main') {
  // FB-24: linked-track preservation. A detached-audio partner used to be
  // left whole while its picture was cut and rippled — the pair desynced
  // by exactly the removed time, and every video piece claimed the same
  // linkId. Now the partner is rebuilt from its picture's new pieces: one
  // audio piece per video piece, same start (plus linkOff), same source
  // window (plus linkInOff), same speed curve slice. A partner whose
  // picture vanished entirely (cut away to nothing) goes with it, and a
  // video piece with no audio overlap drops its link instead of dangling.
  // Unlinked audio clips are untouched: only the main track ripples.
  // (TL-02's linked ripple reaches here as mode 'all', not 'main', so the
  // free tracks below — not this rebuild — move them.)
  const linkedAudio = (p.audioClips || []).filter((a) => a.linkId);
  if (linkedAudio.length) {
    const newLayout = videoLayout(next.videoClips);
    const pieceStart = new Map(newLayout.map((l) => [l.clip.id, l.start]));
    const byOrigLink = new Map();
    for (const l of videoLayout(p.videoClips)) {
      if (!l.clip.linkId || l.clip.gap) continue;
      byOrigLink.set(l.clip.linkId, l.clip.id);
    }
    const rebuilt = [];
    let audioChanged = false;
    for (const a of p.audioClips || []) {
      if (!a.linkId || !byOrigLink.has(a.linkId)) { rebuilt.push(a); continue; }
      const origId = byOrigLink.get(a.linkId);
      // Pieces of this picture clip only: the id itself, or id-c<n>. A plain
      // prefix match would also catch a sibling clip from an earlier cut
      // (v1-c1 is not a piece of v1 when v1-c1 is itself a clip).
      const pieceRe = new RegExp(`^${origId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:-c\\d+)?$`);
      const picPieces = next.videoClips.filter((c) => pieceRe.test(c.id));
      const linkOff = a.linkOff || 0;
      const linkInOff = a.linkInOff || 0;
      const pieces = [];
      picPieces.forEach((vc, i) => {
        if (vc.gap) return;
        const start = pieceStart.get(vc.id);
        if (start == null) return;
        const ain = Math.max(a.in ?? 0, vc.in + linkInOff);
        const aout = Math.min(a.out ?? Infinity, vc.out + linkInOff);
        if (aout - ain < 0.03) return;
        pieces.push({
          ...a,
          id: i ? `${a.id}-c${i}` : a.id,
          linkId: i ? `${a.linkId}-c${i}` : a.linkId,
          start: start + linkOff,
          in: ain,
          out: aout,
          speed: vc.speed || 1,
          speedCurve: vc.speedCurve,
        });
      });
      if (!pieces.length) { audioChanged = true; continue; } // picture cut away: audio goes too
      // The video piece keeps its link only when it has an audio piece.
      const keptLinks = new Set(pieces.map((x) => x.linkId));
      picPieces.forEach((vc) => {
        if (vc.linkId && !keptLinks.has(vc.linkId)) {
          const hit = next.videoClips.find((c) => c.id === vc.id);
          if (hit) delete hit.linkId;
        }
      });
      if (pieces.length !== 1 || pieces[0].id !== a.id || pieces[0].start !== a.start
        || pieces[0].in !== a.in || pieces[0].out !== a.out) audioChanged = true;
      rebuilt.push(...pieces);
    }
    if (audioChanged) next.audioClips = rebuilt;
  }
  return next;
  }
  if (mode === 'linked') {
    // The audio/overlay partners linked to the cut video clips take the
    // same ranges, so a detached-audio pair stays in sync piece for piece.
    // A locked partner stays put (its picture still ripples — the pair is
    // repaired below, and the locked piece becomes independent).
    const partners = new Map();
    for (const l of layout0) {
      if (!cuts.some((r) => r.start < l.end - 1e-9 && r.end > l.start + 1e-9)) continue;
      const partner = findLinkPartner(p, l.clip);
      if (partner && !clipLocked(p, partner.track, partner.clip)) partners.set(`${partner.track}:${partner.clip.id}`, partner);
    }
    let q = next;
    for (const { track, clip } of partners.values()) q = rippleCutFree(q, track, clip.id, cuts);
    return repairCutLinkIds(q);
  }
  // 'all': every unlocked free-track clip is cut by the same ranges —
  // overlays, audio, stickers, effect regions. Locked clips (a locked music
  // layer, for instance) stay exactly where they were.
  let q = next;
  for (const track of ['overlay', 'audio', 'sticker', 'effect']) {
    const key = TRACKS[track];
    for (const c of [...(p[key] || [])]) {
      if (clipLocked(q, track, c)) continue;
      q = rippleCutFree(q, track, c.id, cuts);
    }
  }
  return repairCutLinkIds(q);
}

// Cut one free-track clip by timeline ranges and close the space — the
// cross-track ripple twin of cutFreeRanges. The subtraction is clipped to
// the clip's window, but the SHIFT uses the ORIGINAL ranges: the whole
// timeline closes up, so a clip after the cut moves by the full removed
// length, not just the part that overlapped it. (cutFreeRanges shifts by
// the clipped ranges, which is right for a standalone silence removal and
// wrong for a ripple.) A clip with no overlap still shifts when it sits
// after a cut; a clip fully inside the cut is removed.
function rippleCutFree(p, track, id, cuts) {
  const key = TRACKS[track];
  if (!key || track === 'video') return p;
  const list = p[key] || [];
  const c = list.find((x) => x.id === id);
  if (!c) return p;
  const cutBefore = (t) => cuts.reduce((n, r) => n + (t > r.start ? Math.max(0, Math.min(r.end, t) - r.start) : 0), 0);
  const shiftOnly = () => {
    const shift = cutBefore(c.start);
    if (shift <= 0) return p;
    return { ...p, [key]: list.map((x) => (x.id === id ? { ...x, start: c.start - shift } : x)) };
  };
  if (track === 'sticker' || track === 'effect') {
    const len = c.duration || 0;
    const clipped = cuts
      .map((r) => ({ start: Math.max(c.start, r.start), end: Math.min(c.start + len, r.end) }))
      .filter((r) => r.end - r.start > 0.01);
    if (!clipped.length) return shiftOnly();
    const pieces = subtractRanges(c.start, c.start + len, clipped).filter(([a, b]) => b - a >= 0.03);
    const next = pieces.map(([a, b], i) => ({ ...c, id: i ? `${c.id}-c${i}` : c.id, start: a - cutBefore(a), duration: b - a }));
    return { ...p, [key]: list.flatMap((x) => (x.id === id ? next : [x])) };
  }
  if (!Number.isFinite(c.in) || !Number.isFinite(c.out)) return p;
  const len = freeLen(track, c);
  const clipped = cuts
    .map((r) => ({ start: Math.max(c.start, r.start), end: Math.min(c.start + len, r.end) }))
    .filter((r) => r.end - r.start > 0.01);
  if (!clipped.length) return shiftOnly();
  const pieces = subtractRanges(c.start, c.start + len, clipped).filter(([a, b]) => b - a >= 0.03);
  const next = pieces.map(([a, b], i) => {
    const inOff = sourceOffsetAt(c, a - c.start);
    const outOff = sourceOffsetAt(c, b - c.start);
    return { ...c, id: i ? `${c.id}-c${i}` : c.id, start: a - cutBefore(a), in: c.in + inOff, out: c.in + outOff, speedCurve: sliceCurve(c, inOff, outOff), frameHold: pieceFrameHold(c.frameHold, a - c.start, b - c.start) || undefined };
  });
  return { ...p, [key]: list.flatMap((x) => (x.id === id ? next : [x])) };
}

// One free-track clip cut by the timeline ranges, closed up like the main
// track: pieces keep their source windows through the sampler (in/out
// clips) or their span directly (duration-based sticker / effect clips);
// pieces fully inside a cut disappear; later pieces shift earlier by the
// time removed before them. Pure — shared by cutRanges' linked ripple and
// cutFreeRanges' single-clip path.
export function rippleFreeTrackClips(list, cuts, track) {
  const norm = normalizeCutRanges(cuts);
  const cutBefore = cutBeforeFn(norm);
  const out = [];
  for (const c of list || []) {
    const len = track === 'sticker' || track === 'effect' ? (c.duration || 0) : freeLen(track, c);
    if (!Number.isFinite(len) || len <= 0) { out.push(c); continue; }
    const pieces = subtractRanges(c.start, c.start + len, norm).filter(([a, b]) => b - a >= 0.03);
    if (!pieces.length) continue; // clip lay entirely inside the cuts
    pieces.forEach(([a, b], i) => {
      const id = i ? `${c.id}-c${i}` : c.id;
      const start = a - cutBefore(a);
      if (track === 'sticker' || track === 'effect') {
        out.push({ ...c, id, start, duration: b - a });
      } else if (Number.isFinite(c.in) && Number.isFinite(c.out)) {
        const inOff = sourceOffsetAt(c, a - c.start);
        const outOff = sourceOffsetAt(c, b - c.start);
        out.push({ ...c, id, start, in: c.in + inOff, out: c.in + outOff, speedCurve: sliceCurve(c, inOff, outOff) });
      } else {
        // Text-like free clip without an in/out window: shift + shorten.
        out.push({ ...c, id, start, duration: b - a });
      }
    });
  }
  return out;
}

// Removes time ranges from ONE clip on a free track and closes the space
// inside that clip (10/10 step 4 — silence removal on a standalone audio
// clip): pieces keep their source windows through the sampler, later pieces
// shift earlier by the ranges removed before them, and the clip's total
// length shrinks by the removed total. Other clips are untouched — a free
// track has no shared sequence to ripple. ranges: [{ start, end }] in
// timeline seconds, clipped to the clip's window here.
export function cutFreeRanges(p, track, id, ranges) {
  const key = TRACKS[track];
  if (!key || track === 'video') return p;
  const list = p[key] || [];
  const c = list.find((x) => x.id === id);
  if (!c) return p;
  // Duration-based clips (sticker / effect) carry no in/out window: cut the
  // start/duration span directly. Before this, the finite-in/out guard below
  // returned the project unchanged — silence-removal on a sticker was a
  // silent no-op. (Text clips keep the old path: their words need retiming,
  // which is a separate design question, not a silent no-op fix.)
  if (track === 'sticker' || track === 'effect') {
    const len = c.duration || 0;
    const cuts = normalizeCutRanges(
      (ranges || []).map((r) => ({ start: Math.max(c.start, r.start), end: Math.min(c.start + len, r.end) })),
      c.start + len,
    );
    if (!cuts.length) return p;
    const cutBefore = cutBeforeFn(cuts);
    const pieces = subtractRanges(c.start, c.start + len, cuts).filter(([a, b]) => b - a >= 0.03);
    const next = pieces.map(([a, b], i) => ({ ...c, id: i ? `${c.id}-c${i}` : c.id, start: a - cutBefore(a), duration: b - a }));
    return { ...p, [key]: list.flatMap((x) => (x.id === id ? next : [x])) };
  }
  if (!Number.isFinite(c.in) || !Number.isFinite(c.out)) return p;
  const len = freeLen(track, c);
  const cuts = normalizeCutRanges(
    (ranges || []).map((r) => ({ start: Math.max(c.start, r.start), end: Math.min(c.start + len, r.end) })),
    c.start + len,
  );
  if (!cuts.length) return p;
  const cutBefore = cutBeforeFn(cuts);
  const pieces = subtractRanges(c.start, c.start + len, cuts).filter(([a, b]) => b - a >= 0.03);
  const next = pieces.map(([a, b], i) => {
    const inOff = sourceOffsetAt(c, a - c.start);
    const outOff = sourceOffsetAt(c, b - c.start);
    return { ...c, id: i ? `${c.id}-c${i}` : c.id, start: a - cutBefore(a), in: c.in + inOff, out: c.in + outOff, speedCurve: sliceCurve(c, inOff, outOff), frameHold: pieceFrameHold(c.frameHold, a - c.start, b - c.start) || undefined };
  });
  return { ...p, [key]: list.flatMap((x) => (x.id === id ? next : [x])) };
}

// ---- Insert editing (Sprint 10) ----
// An insert edit places a clip at time `at` on a track and pushes everything
// at or after `at` on that track/layer right by the clip's length — the
// ripple-insert half of the matrix's insert row (ripple delete already
// exists as the magnet behaviour). On the main track the sequential layout
// does the pushing: the clip straddling `at` is split there first (through
// the linked split, so a detached-audio partner splits with it) and the new
// clip is spliced in. On the free tracks the straddler on the target layer
// splits the same way, then every clip starting at or after `at` on that
// layer shifts by the inserted length. Linked pairs move together: a free
// partner of a shifted clip shifts with it, and an audio clip whose picture
// sits on the (positional) main track absorbs the shift into its linkOff,
// so the pair's sync invariant survives as data, not just by luck.

// The clips an insert at `at` on (track, layer) would split or shift — the
// lock guard refuses the edit when any of them sits on a locked layer.
export function insertAffected(p, track, layer, at) {
  const key = TRACKS[track];
  const out = [];
  if (!key || track === 'video' || !Number.isFinite(at)) return out;
  const inLayer = (c) => !LAYERED[track] || layerOf(c) === layer;
  const list = p[key] || [];
  const seen = new Set();
  const add = (trk, c) => {
    const k = `${trk}:${c.id}`;
    if (!seen.has(k)) { seen.add(k); out.push({ track: trk, clip: c }); }
  };
  const straddler = list.find((c) => inLayer(c) && at > c.start + MIN_CLIP && at < c.start + freeLen(track, c) - MIN_CLIP);
  if (straddler) {
    add(track, straddler);
    const partner = findLinkPartner(p, straddler);
    if (partner) add(partner.track, partner.clip);
  }
  for (const c of list) if (inLayer(c) && c.start >= at - 1e-6) add(track, c);
  for (const { clip: c } of [...out]) {
    if (!c.linkId) continue;
    const partner = findLinkPartner(p, c);
    if (partner && partner.track !== 'video') add(partner.track, partner.clip);
  }
  return out;
}

function insertClip(p, a) {
  const clip = a.clip;
  const at = a.at;
  if (!clip || !Number.isFinite(at) || at < 0) return p;
  if (a.track === 'video') {
    if (clip.gap) return p;
    let q = p;
    const hit = videoLayout(q.videoClips).find((l) => !l.clip.gap && at > l.start + MIN_CLIP && at < l.end - MIN_CLIP);
    if (hit) {
      q = splitLinked(q, 'video', hit.clip.id, at, a.splitId || `${clip.id}-s`);
      if (q === p) return p; // the split was refused: never insert half-heartedly
    }
    const layout1 = videoLayout(q.videoClips);
    let index = layout1.findIndex((l) => l.start >= at - 1e-6);
    if (index < 0) index = layout1.length;
    const list = [...q.videoClips];
    list.splice(index, 0, { ...clip, transition: null });
    return { ...q, videoClips: list };
  }
  const key = TRACKS[a.track];
  if (!key) return p;
  const len = freeLen(a.track, clip);
  if (!(len > 0)) return p;
  const layer = LAYERED[a.track] ? layerOf(clip) : 0;
  const inLayer = (c) => !LAYERED[a.track] || layerOf(c) === layer;
  let q = p;
  const straddler = (q[key] || []).find((c) => inLayer(c) && at > c.start + MIN_CLIP && at < c.start + freeLen(a.track, c) - MIN_CLIP);
  if (straddler) {
    q = splitLinked(q, a.track, straddler.id, at, a.splitId || `${clip.id}-s`);
    if (q === p) return p;
  }
  const shift = new Map();
  const add = (trk, c) => shift.set(`${trk}:${c.id}`, { track: trk, clip: c });
  for (const c of q[key] || []) if (inLayer(c) && c.start >= at - 1e-6) add(a.track, c);
  for (const { clip: c } of [...shift.values()]) {
    if (!c.linkId) continue;
    const partner = findLinkPartner(q, c);
    if (partner && partner.track !== 'video') add(partner.track, partner.clip);
  }
  // An audio member whose picture is on the main track shifts alone: its
  // linkOff absorbs the shift so start == picStart + linkOff still holds.
  const linkOffAdj = new Set();
  for (const { track: trk, clip: c } of shift.values()) {
    if (trk !== 'audio' || !c.linkId) continue;
    const partner = findLinkPartner(q, c);
    if (partner && partner.track === 'video') linkOffAdj.add(c.id);
  }
  let out = q;
  for (const trk of new Set([...shift.values()].map((s) => s.track))) {
    const k2 = TRACKS[trk];
    out = {
      ...out,
      [k2]: out[k2].map((c) => (shift.has(`${trk}:${c.id}`)
        ? { ...c, start: c.start + len, ...(linkOffAdj.has(c.id) ? { linkOff: (c.linkOff || 0) + len } : {}) }
        : c)),
    };
  }
  const placed = LAYERED[a.track] ? { ...clip, start: at, layer } : { ...clip, start: at };
  return { ...out, [key]: [...out[key], placed] };
}

// ---- Transcript move (Sprint 10) ----
// moveRanges reorders the main track: the given timeline ranges (a word or
// sentence selection, via src/transcript.js) are lifted out — the track
// closes up exactly like cutRanges — and re-inserted at `to` (a timeline
// time in the ORIGINAL coordinates), splitting the survivor that straddles
// the target when it falls mid-clip. Total duration never changes. Text
// clips travel with the picture the same way rippleTextClips keeps them
// locked on a cut: material inside the ranges moves into the inserted
// block (relative order and internal offsets preserved), material outside
// maps through the cut-and-insert point map, and a text clip spanning the
// insertion point splits there. One action = one undo step.
function textPiece(c, a, b, id, start) {
  const clip = { ...c, id, start, duration: b - a };
  if (c.words && c.words.length) {
    const s = c.start;
    const kept = c.words
      .map((w) => ({ ...w, absStart: s + w.start, absEnd: s + w.end }))
      .filter((w) => w.absStart >= a - 1e-6 && w.absEnd <= b + 1e-6);
    clip.words = kept.map((w) => ({ text: w.text, start: w.absStart - a, end: w.absEnd - a, ...(Number.isFinite(w.conf) ? { conf: w.conf } : {}) }));
    clip.text = kept.map((w) => w.text).join(' ');
  }
  return clip;
}

function moveTextClips(textClips, cuts, insertAt, blockLen) {
  const cutBefore = cutBeforeFn(cuts);
  const inBlock = (t) => insertAt + cutBefore(t); // compressed offset inside the moved block
  const out = [];
  for (const c of textClips) {
    const s = c.start;
    const e = c.start + c.duration;
    // Surviving pieces (outside the cuts), in survivor coordinates.
    subtractRanges(s, e, cuts).filter(([a, b]) => b - a >= 0.03).forEach(([a, b], i) => {
      const aS = a - cutBefore(a);
      const bS = b - cutBefore(b);
      const id = i ? `${c.id}-r${i}` : c.id;
      if (aS < insertAt - 1e-6 && bS > insertAt + 1e-6) {
        // The insertion point falls inside this piece: it splits there. The
        // second half's original-coordinate anchor is the point that maps
        // to insertAt (no cut contains it, by construction).
        let tStar = insertAt;
        for (const r of cuts) if (r.end <= tStar) tStar += r.end - r.start;
        out.push(textPiece(c, a, tStar, id, aS));
        out.push(textPiece(c, tStar, b, `${c.id}-r${i}s`, insertAt + blockLen));
      } else {
        const start = aS >= insertAt - 1e-6 ? aS + blockLen : aS;
        out.push(textPiece(c, a, b, id, start));
      }
    });
    // Moved pieces (inside the cuts) land in the inserted block.
    cuts
      .map((r) => [Math.max(s, r.start), Math.min(e, r.end)])
      .filter(([a, b]) => b - a >= 0.03)
      .forEach(([a, b], i) => out.push(textPiece(c, a, b, `${c.id}-m${i}`, inBlock(a))));
  }
  return out;
}

export function moveRanges(p, ranges, to) {
  if (!Number.isFinite(to)) return p;
  const layout = videoLayout(p.videoClips);
  const total = layout.length ? layout[layout.length - 1].end : 0;
  // TL-01: normalized, so blockLen counts an overlap once (it used to sum it).
  const cuts = normalizeCutRanges(ranges, total);
  if (!cuts.length) return p;
  const blockLen = cuts.reduce((n, r) => n + (r.end - r.start), 0);
  // Lift the pieces out (the same sampler-mapped construction cutRanges
  // uses, with move-derived ids so they can never collide with survivors).
  const pieces = [];
  for (const l of layout) {
    const c = l.clip;
    cuts
      .map((r) => [Math.max(l.start, r.start), Math.min(l.end, r.end)])
      .filter(([a, b]) => b - a >= 0.03)
      .forEach(([a, b], i) => {
        const id = `${c.id}-m${pieces.length}`;
        if (c.gap) pieces.push({ ...c, id, in: 0, out: b - a });
        else {
          const inOff = sourceOffsetAt(c, a - l.start);
          const outOff = sourceOffsetAt(c, b - l.start);
          pieces.push({ ...c, id, in: c.in + inOff, out: c.in + outOff, speedCurve: sliceCurve(c, inOff, outOff), transition: i ? null : c.transition, frameHold: pieceFrameHold(c.frameHold, a - l.start, b - l.start) || undefined });
        }
      });
  }
  if (!pieces.length) return p;
  const survivors = cutRanges(p, cuts);
  const cutBefore = cutBeforeFn(cuts);
  const target = Math.max(0, Math.min(Math.max(0, total - blockLen), to - cutBefore(to)));
  let q = survivors;
  const hit = videoLayout(q.videoClips).find((l) => !l.clip.gap && target > l.start + MIN_CLIP && target < l.end - MIN_CLIP);
  if (hit) {
    const q2 = splitLinked(q, 'video', hit.clip.id, target, `${hit.clip.id}-ms`);
    if (q2 !== q) q = q2;
  }
  const sl = videoLayout(q.videoClips);
  let index = sl.findIndex((l) => l.start >= target - 1e-6);
  if (index < 0) index = sl.length;
  const list = [...q.videoClips];
  list.splice(index, 0, ...pieces);
  return { ...q, videoClips: normalizeGaps(list), textClips: moveTextClips(p.textClips, cuts, target, blockLen) };
}

// After a split the In animation stays on the left part and the Out animation on the right one.
// Keyframes are in source time, so both parts keep them unchanged.
function splitAnim(anim, side) {
  if (!anim) return anim;
  const { in: a, out: b, ...rest } = anim;
  return side === 'left' ? { ...rest, ...(a ? { in: a } : {}) } : { ...rest, ...(b ? { out: b } : {}) };
}

function splitAt(p, track, id, t, newId) {
  // Frame timebase (P1-04): the cut lands on the nearest whole frame, so
  // the two halves share one exact boundary and a split-then-rejoin
  // round-trip has zero drift. The source cut follows through
  // sourceOffsetAt, as before.
  t = quantize(t, effectiveFps(p));
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
    if (!l || l.clip.gap || t - l.start < MIN_CLIP || l.end - t < MIN_CLIP) return p;
    const cutOff = sourceOffsetAt(l.clip, t - l.start);
    const cut = l.clip.in + cutOff;
    const span = l.clip.out - l.clip.in;
    const hold = splitFrameHold(l.clip.frameHold, t - l.start);
    const list = [];
    p.videoClips.forEach((c) => {
      if (c.id !== id) return list.push(c);
      list.push(
        { ...c, out: cut, speedCurve: sliceCurve(c, 0, cutOff), anim: splitAnim(c.anim, 'left'), frameHold: hold.left || undefined },
        { ...c, id: newId, in: cut, speedCurve: sliceCurve(c, cutOff, span), transition: null, anim: splitAnim(c.anim, 'right'), frameHold: hold.right || undefined },
      );
    });
    return { ...p, videoClips: list };
  }
  if (track === 'audio') {
    const c = p.audioClips.find((x) => x.id === id);
    const len = c ? freeLen('audio', c) : 0;
    if (!c || t - c.start < MIN_CLIP || c.start + len - t < MIN_CLIP) return p;
    const cutOff = sourceOffsetAt(c, t - c.start);
    const cut = c.in + cutOff;
    const span = c.out - c.in;
    return {
      ...p,
      audioClips: p.audioClips.flatMap((x) => (x.id !== id ? [x]
        : [{ ...x, out: cut, speedCurve: sliceCurve(x, 0, cutOff) }, { ...x, id: newId, start: t, in: cut, speedCurve: sliceCurve(x, cutOff, span) }])),
    };
  }
  if (track === 'overlay') {
    const c = p.overlayClips.find((x) => x.id === id);
    const len = c ? freeLen('overlay', c) : 0;
    if (!c || t - c.start < MIN_CLIP || c.start + len - t < MIN_CLIP) return p;
    const cutOff = sourceOffsetAt(c, t - c.start);
    const cut = c.in + cutOff;
    const span = c.out - c.in;
    const hold = splitFrameHold(c.frameHold, t - c.start);
    return {
      ...p,
      overlayClips: p.overlayClips.flatMap((x) => (x.id !== id ? [x]
        : [{ ...x, out: cut, speedCurve: sliceCurve(x, 0, cutOff), anim: splitAnim(x.anim, 'left'), frameHold: hold.left || undefined }, { ...x, id: newId, start: t, in: cut, speedCurve: sliceCurve(x, cutOff, span), anim: splitAnim(x.anim, 'right'), frameHold: hold.right || undefined }])),
    };
  }
  if (track === 'text' || track === 'effect' || track === 'sticker') {
    const key = TRACKS[track];
    const c = p[key].find((x) => x.id === id);
    if (!c || t - c.start < MIN_CLIP || c.start + c.duration - t < MIN_CLIP) return p;
    return {
      ...p,
      [key]: p[key].flatMap((x) => (x.id !== id ? [x] : splitTimed(x, t, newId))),
    };
  }
  return p;
}

// Splits a clip and, when it is linked (Detach audio) to a partner on the other kind of
// track, splits the partner at the same timeline moment. The left halves keep the link;
// the right halves form a new pair whose offsets are recomputed from the halves themselves,
// so the sync invariants (see syncLinked) hold for both pairs from the start.
function splitLinked(p, track, id, t, newId) {
  const out = splitAt(p, track, id, t, newId);
  if (out === p) return out;
  const src = findClipIn(p, track, id);
  if (!src || !src.linkId) return out;
  const partner = findLinkPartner(p, src);
  if (!partner) return out;
  const partnerNewId = `${newId}~l`;
  const out2 = splitAt(out, partner.track, partner.clip.id, t, partnerNewId);
  if (out2 === out) {
    // The partner could not be split (its range differs). When the split
    // clip is the AUDIO and t falls in its lead/trail extension (P1-03),
    // the half that still overlaps the picture keeps the link with the
    // trim shortened to the overlap; the half outside the picture becomes
    // independent. Otherwise the right half of the first split must not
    // stay linked to a whole partner — it becomes independent.
    if (track === 'audio') {
      const trim = audioTrimOf(src);
      const ps = picStart(p, partner.track, partner.clip);
      const pe = ps + (partner.track === 'video' ? clipDuration(partner.clip) : clipLen(partner.clip));
      const unlink = (c) => ({ ...c, linkId: undefined, linkOff: undefined, linkInOff: undefined, audioTrim: undefined });
      if (t < ps) {
        let res = mapClip(out, 'audio', id, unlink);
        res = mapClip(res, 'audio', newId, (c) => ({ ...c, audioTrim: sanitizeAudioTrim({ lead: ps + (src.linkOff || 0) - t, trail: trim.trail }) }));
        return res;
      }
      if (t > pe) {
        let res = mapClip(out, 'audio', id, (c) => ({ ...c, audioTrim: sanitizeAudioTrim({ lead: trim.lead, trail: t - (pe + (src.linkOff || 0)) }) }));
        res = mapClip(res, 'audio', newId, unlink);
        return res;
      }
    }
    return mapClip(out, track, newId, (c) => ({ ...c, linkId: undefined, linkOff: undefined, linkInOff: undefined }));
  }
  const linkId = `${src.linkId}~${newId}`;
  const picTrack = track === 'audio' ? partner.track : track;
  const picRight = findClipIn(out2, picTrack, track === 'audio' ? partnerNewId : newId);
  const audRight = findClipIn(out2, 'audio', track === 'audio' ? newId : partnerNewId);
  if (!picRight || !audRight) return out2;
  // The J/L trims split with the pair (P1-03): the left pair keeps the
  // lead, the right pair keeps the trail — the middle of the pair is
  // flush, so a later picture move never re-extends a cut edge.
  const trim = audioTrimOf(track === 'audio' ? src : partner.clip);
  const audLeftId = track === 'audio' ? id : partner.clip.id;
  let res = mapClip(out2, picTrack, picRight.id, (c) => ({ ...c, linkId }));
  res = mapClip(res, 'audio', audRight.id, (c) => ({
    ...c, linkId,
    linkOff: audRight.start - (picTrack === 'video'
      ? (videoLayout(res.videoClips).find((l) => l.clip.id === picRight.id)?.start ?? audRight.start)
      : picRight.start),
    linkInOff: audRight.in - picRight.in,
    audioTrim: sanitizeAudioTrim({ lead: 0, trail: trim.trail }),
  }));
  res = mapClip(res, 'audio', audLeftId, (c) => ({ ...c, audioTrim: sanitizeAudioTrim({ lead: trim.lead, trail: 0 }) }));
  return res;
}

// Splits ONE clip at every time in `times` inside it, on any track: the cuts
// walk in time order, each one splitting the piece that currently carries the
// rest of the clip, through the same linked split a manual cut uses — a
// detached-audio partner is cut at the same moments and the link invariants
// hold for every pair. Times too close to an edge (or to the previous cut)
// leave no sliver: splitAt itself refuses them, and the walk simply moves
// on. One reduction, so the whole multi-split is one undo step. newIds
// supplies one fresh id per potential cut; extras are ignored. This is the
// shared walker behind Beat cuts (splitClipAtBeats) and scene splitting
// (Sprint 10: the `scdet` pass's boundaries become ordinary splits here).
export function splitClipAtTimes(p, track, id, times, newIds) {
  if (!times || !times.length || !newIds || !newIds.length) return p;
  let start;
  let end;
  if (track === 'video') {
    const l0 = videoLayout(p.videoClips).find((x) => x.clip.id === id);
    if (!l0 || l0.clip.gap) return p;
    start = l0.start;
    end = l0.end;
  } else {
    const c = findClipIn(p, track, id);
    if (!c) return p;
    start = c.start;
    end = c.start + freeLen(track, c);
  }
  const inside = [...times].filter((t) => t > start && t < end).sort((a, b) => a - b);
  let out = p;
  let carrier = id;
  let n = 0;
  for (const t of inside) {
    if (n >= newIds.length) break;
    const next = splitLinked(out, track, carrier, t, newIds[n]);
    if (next !== out) {
      out = next;
      carrier = newIds[n];
      n++;
    }
  }
  return out;
}

// Splits ONE main-track clip at every beat of the project's beat grid inside it
// (Beat cuts, v1.1.9) — splitClipAtTimes over the beat times.
export function splitClipAtBeats(p, id, newIds) {
  const times = p.beats && Array.isArray(p.beats.times) ? p.beats.times : [];
  if (!times.length) return p;
  return splitClipAtTimes(p, 'video', id, times, newIds);
}

const CLIP_LISTS = { video: 'videoClips', overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips', sticker: 'stickerClips' };
export function findClipIn(p, track, id) {
  const key = CLIP_LISTS[track];
  return key ? (p[key] || []).find((c) => c.id === id) : undefined;
}
// The other member of a clip's link pair (a picture clip in video/overlay <-> an audio clip).
export function findLinkPartner(p, clip) {
  if (!clip || !clip.linkId) return null;
  for (const track of ['video', 'overlay', 'audio']) {
    const c = (p[CLIP_LISTS[track]] || []).find((x) => x.id !== clip.id && x.linkId === clip.linkId);
    if (c) return { track, clip: c };
  }
  return null;
}
function mapClip(p, track, id, fn) {
  const key = CLIP_LISTS[track];
  if (!key) return p;
  return { ...p, [key]: p[key].map((c) => (c.id === id ? fn(c) : c)) };
}

// Splits a text clip at timeline time t. Caption words go to the half they are spoken in.
function splitTimed(x, t, newId) {
  const cut = t - x.start;
  const a = { ...x, duration: cut };
  const b = { ...x, id: newId, start: t, duration: x.duration - cut };
  if (x.words && x.words.length) {
    const first = x.words.filter((w) => w.start < cut);
    const second = x.words.filter((w) => w.start >= cut).map((w) => ({ ...w, start: w.start - cut, end: w.end - cut }));
    a.words = first;
    b.words = second;
    a.text = first.map((w) => w.text).join(' ');
    b.text = second.map((w) => w.text).join(' ');
  }
  return [a, b];
}

// ---- Lock enforcement (Stage B) ----
// A locked layer's clips cannot be edited at all. The guard lives HERE, at the dispatch
// layer, so every path — pointer drags, menus, shortcuts, the assistant — is blocked the
// same way, not just the visible buttons. It returns true when the action must not run.
// Undo / redo are handled before this is consulted: restoring an earlier project always
// works, locked or not.
function actionLocked(p, a) {
  const clipOf = (track, id) => findClipIn(p, track, id);
  switch (a.type) {
    case 'update': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'setAudioTrim': return clipLocked(p, 'audio', clipOf('audio', a.id));
    case 'updateMany': return a.updates.some((u) => clipLocked(p, u.track, clipOf(u.track, u.id)));
    case 'proofreadCaptions': return (a.patches || []).some((u) => clipLocked(p, 'text', clipOf('text', u.id)));
    case 'delete':
    case 'duplicate':
    case 'split': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'splitAtBeats': return clipLocked(p, 'video', clipOf('video', a.id));
    case 'splitAtTimes': return clipLocked(p, a.track || 'video', clipOf(a.track || 'video', a.id));
    case 'insertClip': {
      if (a.track === 'video') return isLayerLocked(p, 'video', 0);
      const layer = LAYERED[a.track] ? layerOf(a.clip || {}) : 0;
      if (isLayerLocked(p, a.track, layer)) return true;
      return insertAffected(p, a.track, layer, a.at).some(({ track, clip }) => clipLocked(p, track, clip));
    }
    case 'moveRanges': return isLayerLocked(p, 'video', 0);
    case 'trimClip': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'rollEdit':
    case 'slipClip':
    case 'slideClip':
    case 'rateStretch': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'groupClips':
    case 'ungroupClips': return (a.items || []).some((it) => clipLocked(p, it.track, clipOf(it.track, it.id)));
    case 'setClipRole': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'paste': {
      if (a.track === 'video') return isLayerLocked(p, 'video', 0);
      return isLayerLocked(p, a.track, layerOf(a.clip || {}));
    }
    case 'moveVideo': return isLayerLocked(p, 'video', 0);
    case 'moveToOverlay': return isLayerLocked(p, 'video', 0);
    case 'moveToMain': return clipLocked(p, 'overlay', clipOf('overlay', a.id));
    case 'extractAudio': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'cutRanges': return isLayerLocked(p, 'video', 0);
    case 'cutFreeRanges': return clipLocked(p, a.track, clipOf(a.track, a.id));
    case 'removeEffect': {
      const { track, clipId } = parseEffectKey(a.id);
      return clipLocked(p, track, clipOf(track, clipId));
    }
    case 'removeLayer': return isLayerLocked(p, a.track, a.layer);
    case 'deleteLayer': return a.track !== 'video' && isLayerLocked(p, a.track, a.layer);
    case 'setCaptions':
    case 'importSrtCaptions': return isLayerLocked(p, 'text', 0);
    case 'addTranslatedCaptions': return isLayerLocked(p, 'text', Math.max(0, Math.floor(a.layer) || 0));
    case 'addEffectClip': return isLayerLocked(p, 'effect', 0);
    case 'insertAudioClip': return isLayerLocked(p, 'audio', layerOf(a.clip || {}));
    case 'addToTimeline': {
      const m = p.media.find((x) => x.id === a.mediaId);
      return !!m && m.type !== 'audio' && isLayerLocked(p, 'video', 0);
    }
    case 'addMedia':
      return false; // library-level operation with its own confirmation
    case 'removeMedia':
      // Deleting an item deletes every clip that uses it — refused while any of those
      // clips sits on a locked layer (the library flow names the layer to the user).
      return !!lockedMediaUse(p, a.id);
    default: return false;
  }
}

// Adds whose landing layer is only known after placeLayers has run (a clip dropped on a
// full layer is bumped to the next free one) are checked against the RESULT: if the new
// clip ended up on a locked layer, the whole action is reverted.
const PLACEMENT_CHECKED = { addToTimeline: 'clipId', addOverlayClip: 'clipId', addText: 'clipId', moveToOverlay: 'id', extractAudio: 'newId' };
function placementBlocked(before, after, a) {
  const idKey = PLACEMENT_CHECKED[a.type];
  if (!idKey || after === before) return false;
  const id = a[idKey];
  for (const track of ['video', 'overlay', 'text', 'audio']) {
    const c = findClipIn(after, track, id);
    if (c) return clipLocked(after, track, c);
  }
  return false;
}

// ---- Link sync (Detach audio pairs) ----
// A linked pair shares clip.linkId; the audio clip also carries linkOff (its start minus
// the picture clip's timeline start) and linkInOff (its source in-point minus the picture
// clip's). After ANY action, the side that did not change is rewritten from the side that
// did — so the pair selects / moves / trims / speeds together no matter which handle the
// user (or a split, or a reorder) touched. Runs inside historyReducer so every edit path
// is covered; returns the input object untouched when every invariant already holds.
function picStart(p, track, clip) {
  if (track === 'video') {
    const l = videoLayout(p.videoClips).find((x) => x.clip.id === clip.id);
    return l ? l.start : null;
  }
  return clip.start;
}
function linkPairs(p) {
  const byId = new Map();
  for (const track of ['video', 'overlay', 'audio']) {
    for (const c of p[CLIP_LISTS[track]] || []) {
      if (!c.linkId) continue;
      const pair = byId.get(c.linkId) || {};
      if (track === 'audio') pair.aud = { track, clip: c };
      else pair.pic = { track, clip: c };
      byId.set(c.linkId, pair);
    }
  }
  return byId;
}
function syncLinked(prev, next) {
  const before = linkPairs(prev);
  const after = linkPairs(next);
  if (!before.size && !after.size) return next;
  let out = next;
  const put = (track, id, patch) => { out = mapClip(out, track, id, (c) => ({ ...c, ...patch })); };
  for (const [linkId, pair] of after) {
    const was = before.get(linkId);
    if (!pair.pic || !pair.aud) {
      // A member was deleted: the survivor becomes a normal, independent clip — but only
      // when the pair was complete before (a pair being built by Detach must survive its
      // own intermediate steps).
      if (was && was.pic && was.aud) {
        const s = pair.pic || pair.aud;
        put(s.track, s.clip.id, { linkId: undefined, linkOff: undefined, linkInOff: undefined });
      }
      continue;
    }
    if (!was || !was.pic || !was.aud) continue; // a pair created by this action: already consistent
    const v = pair.pic.clip;
    const au = pair.aud.clip;
    const pv = was.pic.clip;
    const pa = was.aud.clip;
    const num = (c, f) => (f === 'speed' ? c.speed || 1 : c[f] || 0);
    // A speed curve is part of the pair's timing: it propagates verbatim (both
    // windows span the same source length and offsets are in-relative on both
    // sides, so the same points keep the pair in sync), and losing it on one
    // side loses it on the other.
    const vChanged = ['in', 'out', 'speed'].some((f) => num(v, f) !== num(pv, f))
      || pv.speedCurve !== v.speedCurve
      || picStart(prev, was.pic.track, pv) !== picStart(next, pair.pic.track, v);
    const aChanged = ['in', 'out', 'speed', 'start'].some((f) => num(au, f) !== num(pa, f))
      || pa.speedCurve !== au.speedCurve;
    if (vChanged) {
      // J/L trims (P1-03): the audio window extends past the picture by
      // lead/trail — the recompute goes through audioWindowForPair so a
      // picture move/trim/speed keeps the J/L offsets instead of snapping
      // the audio flush to the picture.
      const mediaDur = (next.media || []).find((m) => m.id === au.mediaId)?.duration;
      const want = audioWindowForPair(v, picStart(next, pair.pic.track, v), au, mediaDur);
      const patch = {};
      for (const f of ['start', 'in', 'out']) if (Math.abs(num(au, f) - want[f]) > 1e-9) patch[f] = want[f];
      if ((au.speed || 1) !== (v.speed || 1)) patch.speed = v.speed || 1;
      if (au.speedCurve !== v.speedCurve) patch.speedCurve = v.speedCurve;
      const { lead, trail } = audioTrimOf(au);
      if (want.lead !== lead || want.trail !== trail) patch.audioTrim = sanitizeAudioTrim({ lead: want.lead, trail: want.trail });
      if (Object.keys(patch).length && !isLayerLocked(next, 'audio', layerOf(au))) put('audio', au.id, patch);
    } else if (aChanged) {
      // The audio side changed. Three gestures, three answers:
      // - speed: propagates to the picture, and the audio window is
      //   rebuilt from the new picture window + trims (a speed change
      //   alone must never be misread as a trim: it changes the audio
      //   duration too). Speed wins over a trim in the same gesture.
      // - trim / drag of the audio edge (P1-03): the move is read back
      //   into lead/trail — the picture does NOT follow.
      // - slip (in/out changed, same window): propagates to the picture.
      const speedChanged = (v.speed || 1) !== (au.speed || 1) || v.speedCurve !== au.speedCurve;
      const picStart0 = picStart(next, pair.pic.track, v);
      if (speedChanged) {
        if (!clipLocked(next, pair.pic.track, v)) {
          const sp = {};
          if ((v.speed || 1) !== (au.speed || 1)) sp.speed = au.speed || 1;
          if (v.speedCurve !== au.speedCurve) sp.speedCurve = au.speedCurve;
          put(pair.pic.track, v.id, sp);
          const newPic = { ...v, ...sp };
          const mediaDur = (next.media || []).find((m) => m.id === au.mediaId)?.duration;
          const want = audioWindowForPair(newPic, picStart0, au, mediaDur);
          const wp = {};
          for (const f of ['start', 'in', 'out']) if (Math.abs(num(au, f) - want[f]) > 1e-9) wp[f] = want[f];
          if (Object.keys(wp).length && !isLayerLocked(next, 'audio', layerOf(au))) put('audio', au.id, wp);
        }
      } else if (Math.abs(clipDuration(au) - clipDuration(pa)) > 1e-9 || Math.abs((au.start || 0) - (pa.start || 0)) > 1e-9) {
        // Trim / drag of the audio edge (P1-03): an edge dragged OUTWARD
        // past the picture is a J/L offset — read back into lead/trail,
        // picture does not follow. But an edge trimmed INWARD (audio
        // shorter than the picture) cannot be a J/L offset: the picture
        // follows, as before (Stage D linked-trim contract). FB-04 dropped
        // the inward case and test-detach-audio caught it. Per side:
        // short -> picture follows (old mapping); long -> lead/trail.
        // Gap-b TL-03 exception: an INDEPENDENT linked-audio trim
        // (trimLinkedAudio sets linkTrimmed) never moves the picture — the
        // Stage D picture-follows rule applies only to plain trimClip
        // gestures. The flag is consumed here so the next plain trim is
        // judged by the Stage D contract again.
        const wantIn = (au.in || 0) - (au.linkInOff || 0);
        const wantOut = (au.out || 0) - (au.linkInOff || 0);
        const picPatch = {};
        if (!au.linkTrimmed) {
          if (wantIn > (v.in || 0) + 1e-9) picPatch.in = wantIn;
          if (wantOut < (v.out || 0) - 1e-9) picPatch.out = wantOut;
        }
        let picLen = pair.pic.track === 'video' ? clipDuration(v) : clipLen(v);
        if (Object.keys(picPatch).length && !clipLocked(next, pair.pic.track, v)) {
          put(pair.pic.track, v.id, picPatch);
          const nv = { ...v, ...picPatch };
          picLen = pair.pic.track === 'video' ? clipDuration(nv) : clipLen(nv);
        }
        const lead = Math.max(0, picStart0 + (au.linkOff || 0) - (au.start || 0));
        const trail = Math.max(0, (au.start || 0) + clipDuration(au) - (picStart0 + picLen + (au.linkOff || 0)));
        const { lead: oldLead, trail: oldTrail } = audioTrimOf(au);
        const audioPatch = {};
        if (lead !== oldLead || trail !== oldTrail) {
          const t = sanitizeAudioTrim({ lead, trail });
          audioPatch.audioTrim = t || undefined;
        }
        if (au.linkTrimmed) audioPatch.linkTrimmed = undefined;
        if (Object.keys(audioPatch).length && !isLayerLocked(next, 'audio', layerOf(au))) put('audio', au.id, audioPatch);
      } else {
        const patch = {};
        const wantIn = au.in - (au.linkInOff || 0);
        const wantOut = au.out - (au.linkInOff || 0);
        if ((v.in || 0) !== wantIn) patch.in = wantIn;
        if ((v.out || 0) !== wantOut) patch.out = wantOut;
        // The main track's start is positional, so a start change can only flow picture-wards
        // for overlay partners; for video partners it is the picture that leads.
        if (pair.pic.track === 'overlay') {
          const wantStart = au.start - (au.linkOff || 0);
          if ((v.start || 0) !== wantStart) patch.start = wantStart;
        }
        if (Object.keys(patch).length && !clipLocked(next, pair.pic.track, v)) put(pair.pic.track, v.id, patch);
      }
    }
  }
  return out;
}

// Layer state across undo / redo: toggles are not undoable, so the CURRENT states are
// carried over the restored project — but when the undone action was a layer permutation
// (reorder / duplicate / delete layer), the states must follow their LAYERS, not stick to
// the indices. The permutation is read off the clips themselves (each clip id's layer in
// the current project vs in the restored one); when it is consistent for a track, the
// carried keys of that track are remapped through it. (A state entry dropped by deleting
// its layer is not resurrected — toggles made after the snapshot always win.)
function followLayerState(cur, restored) {
  const ls = cur.layerState || {};
  if (!Object.keys(ls).length) return restored.layerState;
  let out = { ...ls };
  for (const track of Object.keys(LAYERED)) {
    const key = LAYERED[track];
    const curById = new Map((cur[key] || []).map((c) => [c.id, layerOf(c)]));
    const map = new Map(); // current layer -> restored layer
    let consistent = true;
    for (const c of restored[key] || []) {
      const lc = curById.get(c.id);
      if (lc === undefined) continue;
      const lr = layerOf(c);
      if (map.has(lc) && map.get(lc) !== lr) { consistent = false; break; }
      map.set(lc, lr);
    }
    if (!consistent || !map.size) continue;
    const prefix = `${track}:`;
    const next = {};
    for (const [k, v] of Object.entries(out)) {
      if (!k.startsWith(prefix)) { next[k] = v; continue; }
      const l = Number(k.slice(prefix.length));
      next[layerKey(track, map.has(l) ? map.get(l) : l)] = v;
    }
    out = next;
  }
  return out;
}

// History wrapper. Actions with `transient: true` (e.g. live drag updates) don't push undo steps;
// a 'commit' action records the state captured at drag start.
// Background thumbnails/waveforms arrive by file path; patch them into every history state so
// undo/redo never brings back a media item without its visuals.
function patchVisuals(p, a) {
  if (!p.media.some((m) => m.path === a.path)) return p;
  return { ...p, media: p.media.map((m) => (m.path === a.path ? { ...m, ...a.patch } : m)) };
}

// Relink: media items point at their new file after the user located moved media
// (a.updates: [{ id, path, ...probed fields }]). Generated pointers recorded against
// the old location (thumb/wave/proxy) are dropped — they regenerate for the new path
// through the usual visuals queue instead of risking a stale stand-in.
function patchRelink(p, a) {
  const byId = new Map((a.updates || []).map((u) => [u.id, u]));
  if (!p.media.some((m) => byId.has(m.id))) return p;
  return {
    ...p,
    media: p.media.map((m) => {
      const u = byId.get(m.id);
      if (!u) return m;
      const { id, verified, ...patch } = u;
      const next = { ...m, ...patch };
      for (const k of ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH', 'wave', 'proxy', 'lightProxy', 'proxies', 'remux']) delete next[k];
      // The new location was probed by the main process during pick/scan, so
      // the file exists again: the lost flag dies with the old path too.
      delete next.missing;
      return next;
    }),
  };
}

// P1-28 — mid-session relink: which of the just-found missing ids were NOT
// already flagged missing on the media items? Only those are "newly lost" and
// may open the relink dialog; files already flagged (load-time loss, or an
// earlier dismissed prompt) must not re-nag on every focus regain.
export function newlyMissingIds(miss, media) {
  const flagged = new Set((media || []).filter((m) => m.missing).map((m) => m.id));
  return (miss || []).filter((m) => !flagged.has(m.id));
}

// P1-54 — packaged-project missing-asset report: which timeline clips use
// each missing media file, so the relink dialog can say "used in 3 clips"
// instead of listing bare filenames (and an unused pool item is visibly not
// breaking the timeline). Returns { [mediaId]: [{ track, id, start, end }] }
// with timeline seconds from videoLayout for the main track and start +
// duration for the free tracks. Pure — no disk access.
export function missingClipRefs(project, missingIds) {
  const ids = new Set(missingIds || []);
  const out = {};
  if (!project || !ids.size) return out;
  const put = (id, ref) => { if (id && ids.has(id)) (out[id] = out[id] || []).push(ref); };
  // videoLayout returns entries { clip, index, start, end, trans } — the
  // clip itself lives under .clip.
  videoLayout(project.videoClips || []).forEach((l) => {
    const c = l.clip;
    if (!c || c.gap) return;
    put(c.mediaId, { track: 'video', id: c.id, start: l.start, end: l.end });
  });
  for (const c of project.overlayClips || []) put(c.mediaId, { track: 'overlay', id: c.id, start: c.start || 0, end: (c.start || 0) + (c.duration || 0) });
  for (const c of project.audioClips || []) put(c.mediaId, { track: 'audio', id: c.id, start: c.start || 0, end: (c.start || 0) + (c.duration || 0) });
  return out;
}

// Missing-media tracking (Part 3, 2026-11-10): media are reference-linked to
// real files on disk, so the store carries a `missing` flag per item — set
// from the main process's existence check (findMissingMedia) at load and at
// export start. Like a relink it patches every history state and is not an
// undo step: the flag describes the disk, not an edit. `merge` only ADDS
// flags (a scoped check, e.g. one clip's audio export); without it the id
// list is the complete truth and flags not in it are cleared (a file that
// came back renders normally again).
function patchMissing(p, a) {
  const ids = new Set(a.ids || []);
  if (!p.media.some((m) => (a.merge ? ids.has(m.id) && !m.missing : ids.has(m.id) !== !!m.missing))) return p;
  return {
    ...p,
    media: p.media.map((m) => {
      if (ids.has(m.id)) return m.missing ? m : { ...m, missing: true };
      if (a.merge || !m.missing) return m;
      const next = { ...m };
      delete next.missing;
      return next;
    }),
  };
}

function patchClipField(p, a) {
  const key = CLIP_LISTS[a.track];
  if (!key || !(p[key] || []).some((c) => c.id === a.id)) return p;
  return { ...p, [key]: p[key].map((c) => (c.id === a.id ? { ...c, [a.field]: a.value } : c)) };
}

export function historyReducer(state, a) {
  if (a.type === 'relinkMedia') {
    // A relink is a repair of where files live, not a creative edit: like mediaVisuals
    // it patches every history state and never becomes an undo step — undoing an edit
    // must not resurrect a path that no longer exists on disk.
    return {
      ...state,
      past: state.past.map((p) => patchRelink(p, a)),
      present: patchRelink(state.present, a),
      future: state.future.map((p) => patchRelink(p, a)),
      gestureStart: state.gestureStart && patchRelink(state.gestureStart, a),
    };
  }
  if (a.type === 'setMediaMissing') {
    // Same repair class as a relink: the lost flags describe the disk, not an
    // edit, so they patch every history state and never become an undo step.
    return {
      ...state,
      past: state.past.map((p) => patchMissing(p, a)),
      present: patchMissing(state.present, a),
      future: state.future.map((p) => patchMissing(p, a)),
      gestureStart: state.gestureStart && patchMissing(state.gestureStart, a),
    };
  }
  if (a.type === 'mediaVisuals') {
    return {
      ...state,
      past: state.past.map((p) => patchVisuals(p, a)),
      present: patchVisuals(state.present, a),
      future: state.future.map((p) => patchVisuals(p, a)),
      gestureStart: state.gestureStart && patchVisuals(state.gestureStart, a),
    };
  }
  if (a.type === 'clipDerivative') {
    // A background derivative render (the AudioFx preview file) lands on a clip without
    // becoming an undo step: like mediaVisuals, the pointer is patched into every history
    // state, and every consumer revalidates it against the clip's current settings
    // before use — so undoing an fx edit simply makes the render inert, never wrong.
    return {
      ...state,
      past: state.past.map((p) => patchClipField(p, a)),
      present: patchClipField(state.present, a),
      future: state.future.map((p) => patchClipField(p, a)),
      gestureStart: state.gestureStart && patchClipField(state.gestureStart, a),
    };
  }
  if (a.type === 'setLayerState') {
    // Lock / hide / mute / solo toggles are view-and-guard state, NOT document edits: they
    // never push an undo step, and undo / redo never change them (they are carried over
    // the restored project below, like mediaVisuals patches the visuals).
    const key = layerKey(a.track, a.layer);
    const cur = { ...layerStateOf(state.present, a.track, a.layer), ...a.patch };
    const layerState = { ...(state.present.layerState || {}) };
    if (!cur.locked && !cur.hidden && !cur.muted && !cur.solo) delete layerState[key];
    else layerState[key] = cur;
    if (JSON.stringify(layerState) === JSON.stringify(state.present.layerState || {})) return state;
    return { ...state, present: syncActiveSequence({ ...state.present, layerState }) };
  }
  // Switching sequences is navigation, not an edit: it never becomes an
  // undo step (undo after a switch undoes the last real edit, it does not
  // jump back to the other sequence), and it clears the redo branch like a
  // new edit branch — the snapshots after it belong to another timeline.
  if (a.type === 'switchSequence') {
    const next = reduceProject(state.present, a);
    if (next === state.present) return state;
    return { ...state, present: next, future: [], futureMeta: [] };
  }
  if (a.type === 'undo') {
    if (!state.past.length) return state;
    const restored = state.past[state.past.length - 1];
    const pastMeta = state.pastMeta || [];
    const futureMeta = state.futureMeta || [];
    return {
      past: state.past.slice(0, -1),
      pastMeta: pastMeta.slice(0, -1),
      present: syncActiveSequence({ ...restored, layerState: followLayerState(state.present, restored) }),
      // The undone edit (the last past entry) becomes the first redo entry.
      future: [state.present, ...state.future],
      futureMeta: [pastMeta[pastMeta.length - 1] || { type: 'edit', at: 0 }, ...futureMeta],
    };
  }
  if (a.type === 'redo') {
    if (!state.future.length) return state;
    const restored = state.future[0];
    const pastMeta = state.pastMeta || [];
    const futureMeta = state.futureMeta || [];
    return {
      past: [...state.past, state.present].slice(-100),
      pastMeta: [...pastMeta, futureMeta[0] || { type: 'edit', at: 0 }].slice(-100),
      present: syncActiveSequence({ ...restored, layerState: followLayerState(state.present, restored) }),
      future: state.future.slice(1),
      futureMeta: futureMeta.slice(1),
    };
  }
  // B-UX7 — redoTo: the redo mirror of undoTo. future[i] is the present
  // after i+1 redos, so restoring it moves the present plus the i earlier
  // redo states into the past, in order, with their metadata.
  if (a.type === 'redoTo') {
    const idx = Math.max(0, Math.floor(Number(a.index) || 0));
    if (!state.future.length || idx >= state.future.length) return state;
    const restored = state.future[idx];
    const pastMeta = state.pastMeta || [];
    const futureMeta = state.futureMeta || [];
    return {
      past: [...state.past, state.present, ...state.future.slice(0, idx)].slice(-100),
      // The new past entries are [old present, future[0..idx-1]] and the new
      // present is future[idx]; their creating edits are futureMeta[0..idx]
      // (futureMeta[i] is the edit that produced future[i]).
      pastMeta: [...pastMeta, ...futureMeta.slice(0, idx + 1)].slice(-100),
      present: syncActiveSequence({ ...restored, layerState: followLayerState(state.present, restored) }),
      future: state.future.slice(idx + 1),
      futureMeta: futureMeta.slice(idx + 1),
      gestureStart: null,
    };
  }
  // A-F9 — atomic rollback: jump the history back to the depth it had at `depth`
  // in ONE dispatch (refs sync on render, so a loop of single undos would read
  // stale lengths). past[d] is the present after d undoable steps, so restoring
  // it returns the document to exactly that point; the states after it become
  // the redo branch, in order, so the rolled-back run stays redoable.
  if (a.type === 'undoTo') {
    const depth = Math.max(0, Math.floor(Number(a.depth) || 0));
    if (state.past.length <= depth) return state;
    const restored = state.past[depth];
    const pastMeta = state.pastMeta || [];
    const futureMeta = state.futureMeta || [];
    return {
      past: state.past.slice(0, depth),
      pastMeta: pastMeta.slice(0, depth),
      present: syncActiveSequence({ ...restored, layerState: followLayerState(state.present, restored) }),
      // past[depth+1..] + the present become the redo branch, in order;
      // their creating edits are pastMeta[depth..] (the last one made the
      // present), followed by the old redo branch.
      future: [...state.past.slice(depth + 1), state.present, ...state.future],
      futureMeta: [...pastMeta.slice(depth), ...futureMeta],
      gestureStart: null,
    };
  }
  // Folds every undo step created since `from` (a past.length noted earlier) into one, so a whole AI request
  // can be undone with a single Undo.
  if (a.type === 'collapseHistory') {
    if (state.past.length <= a.from) return state;
    return { ...state, past: state.past.slice(0, a.from + 1), pastMeta: (state.pastMeta || []).slice(0, a.from + 1) };
  }
  if (a.type === 'beginGesture') return { ...state, gestureStart: state.present };
  if (a.type === 'endGesture') {
    const start = state.gestureStart;
    if (!start || start === state.present) return { ...state, gestureStart: null };
    return {
      past: [...state.past, start].slice(-100),
      pastMeta: [...(state.pastMeta || []), { type: 'gesture', at: Date.now() }].slice(-100),
      present: state.present, future: [], futureMeta: [], gestureStart: null,
    };
  }
  // Locked layers refuse edits before anything is computed (undo / redo returned above,
  // so history navigation is never blocked by a lock).
  if (actionLocked(state.present, a)) return state;
  // The trim tools (P2-01) are gesture edits like trimClip: computed from the
  // gesture-start project so repeated pointer moves never accumulate.
  const GESTURE_TRIMS = new Set(['trimClip', 'rollEdit', 'slipClip', 'slideClip', 'rateStretch']);
  let next = placeLayers(GESTURE_TRIMS.has(a.type)
    ? (a.type === 'trimClip' ? trimClip(state.gestureStart || state.present, a) : reduceProject(state.gestureStart || state.present, a))
    : reduceProject(state.present, a));
  if (next !== state.present && placementBlocked(state.present, next, a)) return state;
  // Main-mode ripple cuts (P1-02) cut the picture only: the linked audio
  // deliberately stays put (desynced by choice — the node test asserts
  // src stays [0,10]). syncLinked would otherwise "repair" it onto the
  // last picture piece (it keeps one entry per linkId, and a main-mode cut
  // leaves two picture pieces sharing L1), so it is skipped for exactly
  // this action. Nothing else changes in a main-mode cut, so no other
  // pair needs syncing here.
  const mainCut = a.type === 'cutRanges' && rippleModeOf(state.present, a) === 'main';
  if (next !== state.present && !mainCut) next = syncLinked(state.present, next);
  // trimClip bypasses reduceProject, so the active-entry mirror happens
  // here (reduceProject already did it for every other action).
  if (next !== state.present) next = syncActiveSequence(next);
  if (next === state.present) return state;
  if (a.type === 'load') {
    // Same document reloaded (autosave/snapshot restore, crash recovery, reopen):
    // the undo trail still describes this document, so keep it — redo is still
    // dropped, because the reloaded state starts a new branch. Switching to a
    // different project wipes the trail: past states belong to the old document
    // (a reframe copy mints a new id, so it correctly counts as a switch).
    const sameDoc = next.id && state.present.id && next.id === state.present.id;
    return sameDoc
      ? { past: state.past.slice(-100), pastMeta: (state.pastMeta || []).slice(-100), present: next, future: [], futureMeta: [], gestureStart: null }
      : { past: [], pastMeta: [], present: next, future: [], futureMeta: [], gestureStart: null };
  }
  if (a.transient || state.gestureStart) return { ...state, present: next };
  return {
    past: [...state.past, state.present].slice(-100),
    pastMeta: [...(state.pastMeta || []), { type: a.type, at: Date.now() }].slice(-100),
    present: next, future: [], futureMeta: [],
  };
}

// Playback quality: which copy of a video the player plays. 'full' is the original chain; the other
// levels play a scaled copy whose longest side is capped (electron/quality.cjs has the same math for
// the generator; the test suite asserts the two agree). The export always reads m.path.
export const PLAYBACK_QUALITIES = ['full', 'high', 'medium', 'low'];
export const QUALITY_MAX_SIDE = { high: 1280, medium: 960, low: 640 };
export const QUALITY_LABELS = { full: 'Full', high: 'High', medium: 'Medium', low: 'Low' };

let playbackQuality = 'full';
export const setPlaybackQuality = (q) => { playbackQuality = PLAYBACK_QUALITIES.includes(q) ? q : 'full'; };
export const getPlaybackQuality = () => playbackQuality;
// Legacy shims for readers that only knew the on/off proxy setting (on meant light copies).
export const setProxyPref = (on) => setPlaybackQuality(on ? 'medium' : 'full');
export const proxyPrefOn = () => playbackQuality !== 'full';

const evenPx = (n) => Math.max(2, Math.round(n / 2) * 2);
// The pixel size a level's copy of a video gets, or null when no copy is needed (see quality.cjs).
export function qualityTargetSize(width, height, quality) {
  const max = QUALITY_MAX_SIDE[quality];
  if (!max || !width || !height) return null;
  const long = Math.max(width, height);
  if (long <= max) return null;
  const s = max / long;
  return { width: evenPx(width * s), height: evenPx(height * s) };
}

// What state a media item's copy for `quality` is in:
// 'na' (level Full, not a video, or the source already fits the level), 'ready' (the level's own
// copy exists), 'fallback' (no copy yet: a smaller copy or the original plays meanwhile), 'failed'
// (generation failed; the main process retries it once per session, then leaves it).
export function levelCopyState(m, quality) {
  if (!m || m.type !== 'video' || quality === 'full') return 'na';
  const p = m.proxies && typeof m.proxies === 'object' ? m.proxies[quality] : undefined;
  if (typeof p === 'string') return 'ready';
  if (p === false) return 'failed';
  if (m.width && m.height && !qualityTargetSize(m.width, m.height, quality)) return 'na';
  return 'fallback';
}

// The file the player plays for `m` at an explicit quality level. Fallback order below Full: the
// level's own copy, then the closest smaller existing copy (a lower level's copy, or the legacy
// light copy — about medium-sized), then the preview proxy / the original.
export function previewPathFor(m, quality) {
  if (!m) return m;
  if (quality === 'full' || m.type !== 'video') return m.proxy || m.path;
  if (m.width && m.height && !qualityTargetSize(m.width, m.height, quality)) return m.proxy || m.path;
  const p = m.proxies && typeof m.proxies === 'object' ? m.proxies : {};
  if (typeof p[quality] === 'string') return p[quality];
  const smaller = quality === 'high' ? [p.medium, m.lightProxy, p.low] : quality === 'medium' ? [m.lightProxy, p.low] : [m.lightProxy];
  for (const c of smaller) if (typeof c === 'string' && c) return c;
  return m.proxy || m.path;
}
export const previewPath = (m, quality = playbackQuality) => previewPathFor(m, quality);

// Mirror of electron/ffmpeg.cjs needsProxy (scripts/test-preview-copies.mjs asserts the two
// agree over a fixture table): true when the player cannot be trusted to show this file
// directly — an undecodable codec/pixel format/profile, HDR, a picture above 1080p, or a
// container Chromium cannot be trusted to demux (QA audit #2, 2026-11-05, RC1) — so a
// preview copy is required before the stage can show the clip.
export const PREVIEW_HOSTILE_EXTS = ['mkv', 'avi', 'ts', 'm2ts', 'mts', 'flv', 'wmv', 'mpg', 'mpeg', 'vob', 'asf', 'divx', 'rm', 'rmvb'];
export function needsPreviewCopy(m) {
  if (!m || m.type !== 'video') return false;
  const ext = String(m.path || '').split('.').pop().toLowerCase();
  if (PREVIEW_HOSTILE_EXTS.includes(ext)) return true;
  const okCodec = ['h264', 'vp8', 'vp9', 'av1'].includes(m.vcodec);
  const okPix = ['yuv420p', 'yuvj420p'].includes(m.pixFmt);
  const big = (m.width || 0) * (m.height || 0) > 1920 * 1088;
  return !!m.hdr || !okCodec || !okPix || big || /high 10|4:2:2|4:4:4/i.test(m.profile || '');
}

// Player view zoom (session-only view state; never saved to the project, never touches export).
// `z` is relative to the Fit size, (x, y) the pan in screen px, `fit` marks the Fit menu choice.
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const FIT_VIEW = Object.freeze({ z: 1, x: 0, y: 0, fit: true });
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
export function clampPan(view, stageW, stageH) {
  const mx = Math.max(0, ((view.z - 1) * (stageW || 0)) / 2) + 60;
  const my = Math.max(0, ((view.z - 1) * (stageH || 0)) / 2) + 60;
  return { ...view, x: Math.min(mx, Math.max(-mx, view.x)), y: Math.min(my, Math.max(-my, view.y)) };
}
export function applyZoomChoice(view, choice, stageW, stageH) {
  if (choice === 'fit') return { ...FIT_VIEW };
  const z = clampZoom(choice / 100);
  if (z <= 1) return { z, x: 0, y: 0, fit: false };
  return clampPan({ z, x: view.x || 0, y: view.y || 0, fit: false }, stageW, stageH);
}
export function zoomByFactor(view, factor, stageW, stageH) {
  const z = clampZoom(view.z * factor);
  if (z <= 1) return { ...FIT_VIEW };
  return clampPan({ z, x: view.x || 0, y: view.y || 0, fit: false }, stageW, stageH);
}
// The CSS transform for the stage element: identity (undefined) at Fit, else centre-anchored
// pan + scale. Percentages in the zoom menu are z x 100 relative to the Fit size.
export function zoomTransform(view) {
  if (!view || (view.fit && view.z === 1 && !view.x && !view.y)) return undefined;
  return `translate(${Math.round(view.x || 0)}px, ${Math.round(view.y || 0)}px) scale(${view.z})`;
}

export function toFileUrl(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return 'file:///' + parts.map((s, i) => (i === 0 && /^[a-zA-Z]:$/.test(s) ? s : encodeURIComponent(s))).join('/');
}

export function formatTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

// Look and placement of a picture clip, for "Copy / paste attributes".
export const ATTRIBUTE_KEYS = ['filter', 'filterIntensity', 'adjust', 'grade', 'effects', 'transform', 'opacity', 'blend', 'chroma', 'mask', 'crop', 'customMask', 'bgRemove', 'enhance', 'speed', 'volume'];
export function pickAttributes(c) {
  // Checklist #15: deep-copy — the old shallow copy shared the source
  // clip's transform / filter / keyframe objects with the pasted clip, so
  // an edit to one silently moved the other. Every attribute value is
  // plain JSON data (see ATTRIBUTE_KEYS), so structuredClone is exact.
  return Object.fromEntries(ATTRIBUTE_KEYS.filter((k) => c[k] !== undefined).map((k) => [k, structuredClone(c[k])]));
}

// Checklist #5 — the patch that swaps a clip's media without losing its
// Checklist #18 — what a file must be to replace a clip (shared by the
// library list and the Upload picker): images carry no sound, so they are
// not offered for a linked clip (its audio partner would go silent), and a
// linked clip only takes video that has audio. Unprobed video (no duration)
// is not offered either.
export function replaceCompatible(mm, linked, isAudio) {
  if (!mm || mm.missing) return false;
  if (isAudio) return mm.type === 'audio' || (mm.type === 'video' && mm.hasAudio);
  if (mm.type === 'image') return !linked;
  if (mm.type === 'video') return !!mm.duration && (!linked || mm.hasAudio);
  return false;
}

// attributes: effects, transform, timing and position stay; only
// media-bound state goes (the speed curve re-anchors to the new source,
// a reversed render and an enhanced-audio render belong to the old file).
// Timing is preserved: the clip keeps its timeline span, using the first
// N seconds of the new source; a shorter new source shortens the clip
// (there is nothing else to play). Images hold their frame for the whole
// span, so an image replacement keeps the span exactly.
// Checklist #20 — a replace is a pure media swap: only the media changes.
// The clip keeps its trim (in/out), so a trimmed or split clip keeps its
// exact segment boundaries, and it keeps its speed ramp: the patch carries
// NO speedCurve key, so applyClipPatch slices the existing curve to the
// kept window — a no-op slice when in/out are unchanged. Position (start),
// transform, effects, filter, opacity, volume/mute and the AudioFx
// settings are not in the patch, so they already stay. What is still
// dropped, and why: reversed and enhance name renders of the OLD file (a
// reversed render, an enhanced-audio render) and cannot transfer to a new
// file. Two clamps, both honest: when the new file is shorter than the kept
// window the out-point moves to the end of the new file (the in-point
// stays, so the timeline span shrinks); when the old in-point is at or past
// the end of the new file there is no window to keep, so the clip falls
// back to the start of the new file, keeping the old timeline span when it
// fits. An image has no duration to clamp against (Infinity), so its
// in/out are always kept as-is.
export function replaceClipPatch(c, oldMedia, newMedia) {
  const oldIn = c.in || 0;
  const oldOut = c.out ?? (oldMedia?.type === 'image' ? IMAGE_DEFAULT : oldMedia?.duration ?? 0);
  const span = oldOut - oldIn;
  const newDur = newMedia.type === 'image' ? Infinity : (newMedia.duration || 0);
  let keptIn = oldIn;
  let keptOut = Math.min(oldOut, newDur);
  if (keptIn >= keptOut - 0.05) {
    keptIn = 0;
    keptOut = Math.max(0.05, Math.min(newDur, span));
  }
  return {
    mediaId: newMedia.id,
    in: keptIn,
    out: keptOut,
    reversed: null,
    enhance: undefined,
  };
}

// What plays and exports: deactivated main clips become gaps (black, silent), other deactivated clips are left out.
// Layer state applies here too — this is the one project both the preview and the export
// pipeline read, so a hidden layer vanishes from both and a muted / non-solo layer is
// silent in both: hidden picture layers are dropped (the main track leaves gaps), a
// silenced picture layer keeps its picture with clip.muted set, silenced audio clips go.
export function renderable(p) {
  const hasOff = [p.videoClips, p.overlayClips || [], p.audioClips, p.textClips, p.effectClips || []].some((l) => l.some((c) => c.disabled));
  const ls = p.layerState || {};
  const hasLayerFx = Object.values(ls).some((s) => s && (s.hidden || s.muted || s.solo));
  // P2-23: a muted / soloed bus also changes what renders, so it forces the
  // mapping below (a bus-silenced clip is stamped muted, like a layer-mute).
  const mx = p.mixer || {};
  const hasBusFx = Object.values(mx.muted || {}).some(Boolean) || Object.values(mx.solo || {}).some(Boolean);
  if (!hasOff && !hasLayerFx && !hasBusFx) return p;
  const hidden = (track, layer) => layerStateOf(p, track, layer).hidden;
  const kept = (track) => (l) => l.filter((c) => !c.disabled && !hidden(track, layerOf(c)));
  const busSilenced = (track, c) => !busAudible(p, roleOf(c, track));
  return {
    ...p,
    videoClips: p.videoClips.map((c) => (c.disabled || hidden('video', 0)
      ? { ...newGap(c.id, clipLen(c)), transition: c.transition }
      : ((!layerSounds(p, 'video', 0) || busSilenced('video', c)) && !c.muted ? { ...c, muted: true } : c))),
    overlayClips: kept('overlay')(p.overlayClips || [])
      .map((c) => ((!layerSounds(p, 'overlay', layerOf(c)) || busSilenced('overlay', c)) && !c.muted ? { ...c, muted: true } : c)),
    audioClips: (p.audioClips || []).filter((c) => !c.disabled && !hidden('audio', layerOf(c)) && layerSounds(p, 'audio', layerOf(c)) && !busSilenced('audio', c)),
    textClips: kept('text')(p.textClips),
    effectClips: (p.effectClips || []).filter((c) => !c.disabled && !hidden('effect', 0)),
  };
}

// The time window a clip-attached effect instance covers, in clip-local seconds
// (clip.fxTiming[fx] = { start, duration }); absent = the whole clip. Readers that
// know the clip's span clamp the window into it (effectObjects); the render paths
// gate on it directly, since they only ever visit times inside the clip.
export const fxTimingOf = (clip, fx) => {
  const w = clip?.fxTiming?.[fx];
  return w && w.duration > 0 ? { start: Math.max(0, w.start || 0), duration: w.duration } : null;
};
// The fxTiming map for a clip with one instance's window replaced. A window that
// covers the whole clip is stored as NO entry (absent = whole clip), so projects
// keep the shape they had before timing existed.
export const withFxTiming = (clip, fx, w, span) => {
  const next = { ...(clip.fxTiming || {}) };
  if (!w || (w.start <= 1e-9 && w.start + w.duration >= span - 1e-9)) delete next[fx];
  else next[fx] = { start: w.start, duration: w.duration };
  return next;
};

// Effects as timeline objects for the Effects lane: free effects (their own id, movable and trimmable) and
// effects applied to clips (key "<track>|<clipId>|<effectId>", spanning and following the clip — or the
// part of it the instance's timing window covers).
export function effectObjects(p) {
  const out = (p.effectClips || []).map((e) => ({ key: e.id, free: true, fx: e.fx, kind: e.kind || 'fx', start: e.start, duration: e.duration, clip: e }));
  const bound = (key, track, clipId, clip, fx, clipStart, span) => {
    const w = fxTimingOf(clip, fx);
    const start = w ? Math.min(w.start, span) : 0;
    const duration = w ? Math.max(0, Math.min(w.duration, span - start)) : span;
    return { key, track, clipId, fx, start: clipStart + start, duration };
  };
  for (const l of videoLayout(p.videoClips)) {
    if (l.clip.gap) continue;
    for (const fx of l.clip.effects || []) out.push(bound(`video|${l.clip.id}|${fx}`, 'video', l.clip.id, l.clip, fx, l.start, l.end - l.start));
  }
  for (const c of p.overlayClips || []) {
    for (const fx of c.effects || []) out.push(bound(`overlay|${c.id}|${fx}`, 'overlay', c.id, c, fx, c.start, freeLen('overlay', c)));
  }
  return out;
}
export const parseEffectKey = (key) => {
  const [track, clipId, fx] = String(key).split('|');
  return { track, clipId, fx };
};
