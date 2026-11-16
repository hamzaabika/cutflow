import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, AudioLines, AudioWaveform, BetweenHorizontalStart, Copy, CopyPlus, Eye, EyeOff, Film, Flag, GripVertical, Layers, Link2, Lock, LockOpen, Magnet, Mic, MoreHorizontal, MousePointer2, Music, Pencil, Plus, Scissors, Slice, Sticker,
  Sparkles, Split, Square, StretchHorizontal, Trash2, Type, Undo2, Unlink, Volume2, VolumeX, Redo2, X, ZoomIn, ZoomOut, Captions, FxGlyph,
} from '../icons.jsx';
import { LAYERED, MARKER_COLORS, MIN_CLIP, clipLayer, effectObjects, formatTime, freeLen, isLayerLocked, layerCount, layerFree, layerOf, layerStateOf, markerColorHex, toFileUrl, trimActions, uid, videoClipAt, videoLayout, withFxTiming } from '../store.js';
import { clipDuration, hasCurve, sourceOffsetAt, speedAtSource } from '../speedCurve.js';
import { clipGainAt, hasVolKeys, removeVolKey, upsertVolKey, volKeyLocalPoints } from '../volKeys.js';
import { animById, animOf, keyTimes, moveKeys } from '../anim.js';
import { beatSplitTarget, beatsOf, formatBpm } from '../beats.js';
import { filterName } from '../fx/filters.js';
import { EFFECTS, TRANSITIONS } from '../effects.js';
import { FILTERS } from '../effects.js';
import { activeDrag, isFiles, isInternal, laneFor, readPayload } from '../dnd.js';
import { followScrollTarget, interpolateTime, playheadX } from '../playbackClock.js';
import AudioMeter from './AudioMeter.jsx';
import ContextMenu from './ContextMenu.jsx';
import { bindingHint, getCurrentKeymap } from '../keymap.js';
import { tr, useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';

// Toolbar hint suffix for an action, from the CURRENT keymap — a remapped
// action's button advertises its real key, an unbound one none at all.
const keyHint = (id) => {
  const h = bindingHint(getCurrentKeymap(), id);
  return h ? ` (${h})` : '';
};

const HEADER = 224; // lane-head width: the layer name gets the room — the control cluster hides until hover/active (Hamza's screenshot review, 2026-11-10)
const HEAD_TITLE_H = 0; // lane heads have no title strip (merged into the first layer row — Hamza's UI review, 2026-11-10); layer rows and bands start at the lane's top edge
const ROW = 34; // height of one stacked row on the Effects / Text tracks
const ROW_H = { overlay: 44, audio: 40 }; // taller layers for pictures and waveforms
const rowOf = (lane) => ROW_H[lane] || ROW;
// Overlay and text layers are shown above the main track, so their layer 0 is the bottom row; audio
// layers are below it, layer 0 on top.
const ABOVE = { overlay: true, text: true };
const rowToLayer = (lane, row, count) => (ABOVE[lane] ? count - 1 - row : row);

// Overlapping clips on a free track get their own row (first row that is free at the clip's start).
function stackRows(clips) {
  const ends = [];
  const rows = {};
  [...clips].sort((a, b) => a.start - b.start).forEach((c) => {
    let r = ends.findIndex((e) => e <= c.start + 1e-6);
    if (r < 0) {
      r = ends.length;
      ends.push(0);
    }
    ends[r] = c.start + c.duration;
    rows[c.id] = r;
  });
  return { rows, count: Math.max(1, ends.length) };
}
// Lane rows render top-to-bottom in this order. Stickers sit above Overlay to
// match the render order: stickers composite over overlay clips in both the
// preview and the export (Hamza's order, 2026-11-10).
const LANES = [
  { id: 'effect', name: 'Effects', icon: Sparkles, noMagnet: true },
  { id: 'text', name: 'Text', icon: Type },
  { id: 'sticker', name: 'Stickers', icon: Sticker },
  { id: 'overlay', name: 'Overlay', icon: Layers },
  { id: 'video', name: 'Main', icon: Film, main: true },
  { id: 'audio', name: 'Audio', icon: Music },
];

export default function Timeline({
  project, time, duration, selection, onSelect, onSeek, dispatch, onSplit, onDelete, onDuplicate,
  onDropItem, onDropFiles, canUndo, canRedo, tool, setTool, onTrimSide, onMarker, recorder, onToggleRecord, onClipMenu, overlay, onAddText, clockRef, playing,
  onDetach, detachOk, onLinkToggle, linkMode, onDetectBeats, onSplitBeats, silenceMarks, onScrubStart,
}) {
  const t = useT();
  // Layer display name: the user's rename (stored, never translated) or the
  // localised lane default ("Text 1" → «النص 1» / "Texte 1"). store.layerName
  // stays English for data/tests; the UI always renders through this.
  const dispLayerName = (track, layer) => (project.layerNames && project.layerNames[track] && project.layerNames[track][layer]) || `${t('lane.' + track)} ${layer + 1}`;
  const [pps, setPps] = useState(60); // pixels per second (zoom)
  const [insertMode, setInsertMode] = useState(false); // Sprint 10: drops ripple-insert instead of placing
  const [drop, setDrop] = useState(null); // { lane, time, index, clipId }
  const [snapAt, setSnapAt] = useState(null); // timeline time of the active snap guide
  const [trimHud, setTrimHud] = useState(null); // { x, text } readout chip while an edge is dragged
  const playheadRef = useRef(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  const timeRef = useRef(time);
  timeRef.current = time;
  const ppsRef = useRef(pps);
  ppsRef.current = pps;
  const [razorAt, setRazorAt] = useState(null); // where the razor would cut (hover guide)
  const [layerMenu, setLayerMenu] = useState(null); // { x, y, track, layer } — layer (track) header menu, item 13
  const [markerMenu, setMarkerMenu] = useState(null); // { x, y, marker } — marker colour / bulk-delete menu (step 5)
  const [renaming, setRenaming] = useState(null); // { track, layer, draft } — inline layer rename
  // Right-click on a lane header: the layer under the pointer (header rows share the lane's
  // geometry), or the main track itself for the Main lane.
  const openLayerMenu = (e, lane) => {
    e.preventDefault();
    let layer = 0;
    if (LAYERED[lane]) {
      const count = layerCount(project, lane);
      const rect = e.currentTarget.getBoundingClientRect();
      const row = Math.floor((e.clientY - rect.top - HEAD_TITLE_H) / rowOf(lane));
      layer = rowToLayer(lane, Math.max(0, Math.min(count - 1, row)), count);
    }
    setLayerMenu({ x: e.clientX, y: e.clientY, track: lane, layer });
  };
  // Layer state toggles dispatch setLayerState: applied by the history reducer WITHOUT an
  // undo step (a lock is not a document edit), and undo never reverts them.
  const setLayer = (track, layer, patch) => dispatch({ type: 'setLayerState', track, layer, patch });
  const layerMenuItems = (m) => {
    const st = layerStateOf(project, m.track, m.layer);
    const name = dispLayerName(m.track, m.layer);
    const audioCap = m.track === 'audio' || m.track === 'video' || m.track === 'overlay';
    const items = [
      { label: st.locked ? t('tl.unlockLayer', { name }) : t('tl.lockLayer', { name }), icon: st.locked ? LockOpen : Lock,
        onClick: () => setLayer(m.track, m.layer, { locked: !st.locked }) },
      { label: st.hidden ? t('tl.showLayer', { name }) : t('tl.hideLayer', { name }), icon: st.hidden ? Eye : EyeOff,
        onClick: () => setLayer(m.track, m.layer, { hidden: !st.hidden }) },
    ];
    if (audioCap) {
      items.push(
        { label: st.muted ? t('tl.unmuteLayer', { name }) : t('tl.muteLayer', { name }), icon: st.muted ? Volume2 : VolumeX,
          onClick: () => setLayer(m.track, m.layer, { muted: !st.muted }) },
        { label: st.solo ? t('tl.soloOff', { name }) : t('tl.soloLayer', { name }), icon: AudioLines,
          onClick: () => setLayer(m.track, m.layer, { solo: !st.solo }) },
      );
    }
    if (m.track === 'effect') return items; // the Effects lane is one row: state toggles only
    const srcCount = m.track === 'video'
      ? project.videoClips.filter((c) => !c.gap).length
      : project[LAYERED[m.track]].filter((c) => layerOf(c) === m.layer).length;
    items.push('sep',
      { label: t('tl.duplicateLayer', { name }), icon: CopyPlus,
        onClick: () => dispatch({ type: 'duplicateLayer', track: m.track, layer: m.layer, newIds: Array.from({ length: srcCount }, () => uid()) }) },
      { label: t('tl.renameLayer'), icon: Pencil,
        onClick: () => setRenaming({ track: m.track, layer: m.layer, draft: dispLayerName(m.track, m.layer) }) },
      'sep',
      { label: t('tl.deleteLayer'), icon: Trash2, disabled: st.locked, hint: t('tl.unlockFirst'),
        onClick: () => dispatch({ type: 'deleteLayer', track: m.track, layer: m.layer }) });
    // Lane-level actions that lived on the old title strip (merged into the
    // first layer row in Hamza's 2026-11-10 UI review): adding a layer. Same
    // handler the strip's button called. The per-lane magnet entries were
    // removed in the P4 structure pass — snapping is ONE global toggle in the
    // timeline toolbar (the Magnet button); the store keeps its per-track
    // ripple defaults (text stays un-magnetised so captions keep timing).
    const laneDef = LANES.find((l) => l.id === m.track);
    const extras = [];
    if (LAYERED[m.track]) {
      extras.push(m.track === 'text' && onAddText
        ? { label: t('tl.addTextAtPlayhead'), icon: Plus, onClick: () => onAddText({ text: 'Add text' }) }
        : { label: t('tl.addLayer', { lane: t('tl.lane.' + m.track) }), icon: Plus, onClick: () => dispatch({ type: 'addLayer', track: m.track }) });
    }
    if (extras.length) items.push('sep', ...extras);
    return items;
  };
  // ---- Reorder layers by dragging a header row (Stage C) ----
  const [layerDrag, setLayerDrag] = useState(null); // { track, overRow } while a header row is dragged
  const startLayerDrag = (e, lane, layer) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const count = layerCount(project, lane);
    const fromRow = ABOVE[lane] ? count - 1 - layer : layer;
    const stackEl = e.currentTarget.closest('.tl-layer-stack');
    let overRow = fromRow;
    setLayerDrag({ track: lane, overRow });
    const move = (ev) => {
      if (!stackEl) return;
      const r = stackEl.getBoundingClientRect();
      overRow = Math.max(0, Math.min(count - 1, Math.floor((ev.clientY - r.top) / rowOf(lane))));
      setLayerDrag({ track: lane, overRow });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLayerDrag(null);
      if (overRow !== fromRow) dispatch({ type: 'moveLayer', track: lane, from: layer, to: rowToLayer(lane, overRow, count) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // One header control row per layer: lock, visibility, mute + solo on
  // sound-carrying lanes, and the layer menu — the reference's pattern in our
  // icon language. Rows line up with the layer bands in the lane body. The
  // FIRST row of each lane is the merged header (Hamza's UI review,
  // 2026-11-10): it also carries the lane icon beside the layer name, so a
  // lane no longer spends a second strip repeating its group name.
  const layerCtlRow = (lane, layer, displayRow, headIcon) => {
    const st = layerStateOf(project, lane, layer);
    const audioCap = lane === 'audio' || lane === 'video' || lane === 'overlay';
    const name = dispLayerName(lane, layer);
    const HeadIcon = headIcon;
    const dragHere = layerDrag && layerDrag.track === lane && layerDrag.overRow === displayRow;
    return (
      <div key={layer} className={`tl-layer-row ${st.locked ? 'locked' : ''} ${st.hidden ? 'is-hidden' : ''} ${dragHere ? 'drop-hint' : ''}`}
        style={{ height: rowOf(lane) }}>
        {LAYERED[lane] && layerCount(project, lane) > 1 ? (
          <span className="tl-grip" role="button" aria-label={t('tl.reorderLayer', { name })} title={t('tl.dragToReorder')}
            onPointerDown={(e) => startLayerDrag(e, lane, layer)}><GripVertical size={11} /></span>
        ) : (
          <span className="tl-grip-slot" aria-hidden="true" />
        )}
        {renaming && renaming.track === lane && renaming.layer === layer && !LAYERED[lane]
          ? layerRenameInput(lane, layer)
          : (
            <span className="tl-layer-name" title={name}>
              {HeadIcon && <HeadIcon size={13} aria-hidden="true" className="tl-icon" />}
              <span className="tl-layer-text">{name}</span>
            </span>
          )}
        <span className="tl-ctls">
        <button className={`tl-ctl ${st.locked ? 'on lock' : ''}`} aria-pressed={st.locked}
          aria-label={t('tl.layerAria', { action: st.locked ? t('tl.unlockShort') : t('tl.lockShort'), name })} title={st.locked ? t('tl.unlockLayerTitle') : t('tl.lockLayerTitle')}
          onClick={() => setLayer(lane, layer, { locked: !st.locked })}>{st.locked ? <Lock size={12} /> : <LockOpen size={12} />}</button>
        <button className={`tl-ctl ${st.hidden ? 'on hide' : ''}`} aria-pressed={st.hidden}
          aria-label={t('tl.layerAria', { action: st.hidden ? t('tl.showShort') : t('tl.hideShort'), name })} title={st.hidden ? t('tl.showLayerTitle') : t('tl.hideLayerTitle')}
          onClick={() => setLayer(lane, layer, { hidden: !st.hidden })}>{st.hidden ? <EyeOff size={12} /> : <Eye size={12} />}</button>
        {audioCap ? (
          <button className={`tl-ctl ${st.muted ? 'on mute' : ''}`} aria-pressed={st.muted}
            aria-label={t('tl.layerAria', { action: st.muted ? t('tl.unmuteShort') : t('tl.muteShort'), name })} title={st.muted ? t('tl.unmuteLayerTitle') : t('tl.muteLayerTitle')}
            onClick={() => setLayer(lane, layer, { muted: !st.muted })}>{st.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>
        ) : (
          <span className="tl-ctl-slot" aria-hidden="true" />
        )}
        {audioCap ? (
          <button className={`tl-ctl solo ${st.solo ? 'on' : ''}`} aria-pressed={st.solo}
            aria-label={t('tl.soloLayer', { name })} title={st.solo ? t('tl.soloOffTitle') : t('tl.soloTitle')}
            onClick={() => setLayer(lane, layer, { solo: !st.solo })}>S</button>
        ) : (
          <span className="tl-ctl-slot" aria-hidden="true" />
        )}
        <button className="tl-ctl" aria-label={t('tl.layerMenuFor', { name })} title={t('tl.layerMenu')}
          onClick={(e) => setLayerMenu({ x: e.clientX, y: e.clientY, track: lane, layer })}><MoreHorizontal size={12} /></button>
        </span>
      </div>
    );
  };
  // The layers of a lane in display order (top row first), as control rows for the head.
  // The top row gets the lane's icon: it is the lane's one header row.
  const layerCtlRows = (l) => {
    const lane = l.id;
    if (!LAYERED[lane]) return [layerCtlRow(lane, 0, 0, l.icon)];
    const count = layerCount(project, lane);
    return Array.from({ length: count }, (_, row) => layerCtlRow(lane, rowToLayer(lane, row, count), row, row === 0 ? l.icon : null));
  };
  // The inline rename field (a plain render helper, not a component, so the input keeps focus
  // across keystrokes). Enter/blur commits, Esc cancels; an empty name restores the default.
  const layerRenameInput = (track, layer) => (
    <input className="layer-rename" autoFocus value={renaming.draft} aria-label={t('tl.layerName')}
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { dispatch({ type: 'renameLayer', track, layer, name: renaming.draft }); setRenaming(null); }
        if (e.key === 'Escape') setRenaming(null);
      }}
      onBlur={() => { dispatch({ type: 'renameLayer', track, layer, name: renaming.draft }); setRenaming(null); }} />
  );
  const markers = project.markers || [];
  const beats = beatsOf(project);
  const magnet = project.magnet || {};
  const scrollRef = useRef(null);
  const mediaById = Object.fromEntries(project.media.map((m) => [m.id, m]));
  const layout = videoLayout(project.videoClips);
  // Room after the last clip is a fixed width in pixels, so zooming out to fit does not leave a huge empty tail.
  const width = Math.max(duration * pps + 600, 900);
  const overlays = project.overlayClips || [];
  const empty = !project.videoClips.length && !overlays.length && !project.audioClips.length && !project.textClips.length;

  const timeFromEvent = (e) => {
    const rect = scrollRef.current.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left - HEADER + scrollRef.current.scrollLeft) / pps);
  };

  // Layer at a height on a layered lane; one past the last (a new layer) just outside its rows.
  const layerAtY = (lane, laneEl, y) => {
    const count = layerCount(project, lane);
    const row = Math.floor((y - laneEl.getBoundingClientRect().top - 4 - HEAD_TITLE_H) / rowOf(lane));
    if (ABOVE[lane] ? row < 0 : row >= count) return count;
    return rowToLayer(lane, Math.max(0, Math.min(count - 1, row)), count);
  };

  // ---- Drop from the asset panels / Explorer ----
  const dropInfo = (e) => {
    const t = timeFromEvent(e);
    const laneEl = e.target.closest?.('[data-lane]');
    const overLane = laneEl?.dataset.lane;
    const lane = isFiles(e) && !isInternal(e) ? 'files' : laneFor(activeDrag());
    if (!lane) return null;
    // The layer under the pointer, for what lands on that lane's own kind of clips.
    const at = LAYERED[overLane] ? { layerLane: overLane, layer: layerAtY(overLane, laneEl, e.clientY) } : {};
    // Videos and photos dropped on the Overlay lane become picture-in-picture clips.
    if ((lane === 'video' || lane === 'files') && overLane === 'overlay') return { lane: 'overlay', time: t, insert: insertMode, ...at };
    const info = { lane, time: t, insert: insertMode, ...at };
    if (lane === 'video' || lane === 'files') {
      info.index = layout.filter((l) => (l.start + l.end) / 2 < t).length;
      info.at = info.index < layout.length ? layout[info.index].start : layout.length ? layout[layout.length - 1].end : 0;
    }
    if (lane === 'clip') {
      // An effect dropped on the Effects lane becomes a free effect there.
      if (activeDrag()?.kind === 'effect' && overLane === 'effect') return { lane: 'effect', time: t, insert: insertMode };
      if (overLane !== 'video') return { lane, time: t, insert: insertMode };
      const hit = layout.filter((l) => t >= l.start && t < l.end).pop();
      if (hit) info.clipId = hit.clip.id;
    }
    return info;
  };

  const onDragOver = (e) => {
    if (!isInternal(e) && !isFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const info = dropInfo(e);
    e.dataTransfer.dropEffect = info && (info.lane !== 'clip' || info.clipId) ? 'copy' : 'none';
    setDrop(info);
  };

  const onDrop = (e) => {
    const info = dropInfo(e);
    setDrop(null);
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    if (info.lane === 'files') onDropFiles([...e.dataTransfer.files], info);
    else onDropItem(readPayload(e), info);
  };

  // ---- Pointer editing ----
  // Generic pointer drag: calls onMove(deltaSeconds, event) until release, wrapped in one undo step.
  const drag = (e, onMove, onEnd) => {
    e.stopPropagation();
    e.preventDefault();
    const x0 = e.clientX;
    dispatch({ type: 'beginGesture' });
    const move = (ev) => onMove((ev.clientX - x0) / pps, ev);
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onEnd?.(ev); // inside the gesture, so a move to another track is part of the same undo step
      dispatch({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drag a keyframe diamond along its clip (all the properties keyed at that moment move together).
  // Lands on whole frames and snaps to the playhead; a click without moving puts the playhead on it.
  const startKeyDrag = (e, track, clip, t, length, start) => {
    if (e.button !== 0) return;
    if (trackLocked(track, clip)) return;
    const fps = project.fps || 30;
    let moved = false;
    drag(e, (d) => {
      if (!moved && Math.abs(d * pps) < 3) return;
      moved = true;
      let to = clamp(Math.round((t + d) * fps) / fps, 0, length);
      if (project.snapping && Math.abs((start + to - time) * pps) < 6) to = clamp(time - start, 0, length);
      setSnapAt(Math.abs(start + to - time) < 1e-6 ? time : null);
      dispatch({ type: 'update', track, id: clip.id, patch: moveKeys(clip, t, to, fps) });
    }, () => {
      setSnapAt(null);
      if (!moved) onSeek(start + t);
    });
  };

  // Volume keyframe drag (Sprint 10): a point on a clip's volume line drags
  // in time (horizontal) and gain (vertical, read off the line's own box).
  // Every move recomputes from the gesture-start clip — the generic drag
  // wrapper folds the whole drag into one undo step, exactly like the
  // keyframe-diamond drags. A double-click on a point removes it (wired in
  // VolLine); points are added in the inspector's volume editor.
  const startVolDrag = (e, track, clip, key, len) => {
    if (e.button !== 0) return;
    if (trackLocked(track, clip)) return;
    const svg = e.currentTarget.closest('svg');
    const base = removeVolKey(clip, key.t, 0.05);
    const baseClip = base ? { ...clip, volKeys: base } : clip;
    drag(e, (d, ev) => {
      const lt = clamp(key.lt + d, 0, len);
      let v = key.v;
      if (svg) {
        const r = svg.getBoundingClientRect();
        if (r.height > 0) v = clamp(2 * (1 - (ev.clientY - r.top) / r.height), 0, 2);
      }
      dispatch({ type: 'update', track, id: clip.id, patch: { volKeys: upsertVolKey(baseClip, lt, Math.round(v * 100) / 100) } });
    });
  };

  // Snapping: pull a dragged clip's start or end (or a razor cut) to a nearby edge: other clips, markers,
  // beat markers (when a beat grid is on the project), the playhead, zero. Every caller gates on
  // project.snapping, so the beats join snapping exactly while the toggle is on.
  const edgeTimes = (excludeId) => {
    const edges = [0, time, ...markers.map((m) => m.time), ...beats];
    layout.forEach((l) => edges.push(l.start, l.end));
    project.audioClips.forEach((c) => c.id !== excludeId && edges.push(c.start, c.start + freeLen('audio', c)));
    project.textClips.forEach((c) => c.id !== excludeId && edges.push(c.start, c.start + c.duration));
      (project.effectClips || []).forEach((c) => c.id !== excludeId && edges.push(c.start, c.start + c.duration));
    overlays.forEach((c) => c.id !== excludeId && edges.push(c.start, c.start + freeLen('overlay', c)));
    return edges;
  };
  const snapMove = (start, len, excludeId) => {
    const thr = 10 / pps;
    let best = null;
    for (const e of edgeTimes(excludeId)) {
      for (const pos of [start, start + len]) {
        const dd = e - pos;
        if (Math.abs(dd) < thr && (!best || Math.abs(dd) < Math.abs(best.dd))) best = { dd, at: e };
      }
    }
    return best ? { start: Math.max(0, start + best.dd), at: best.at } : { start, at: null };
  };
  const snapPoint = (t) => {
    const thr = 10 / pps;
    let best = t;
    for (const e of edgeTimes(null)) if (Math.abs(e - t) < thr && Math.abs(e - t) < Math.abs(best - t) + (best === t ? thr : 0)) best = e;
    return best;
  };

  // Where a clip starts and how long it is, per track — the same expressions the lanes render with.
  const TRACK_ARRAY = { text: 'textClips', effect: 'effectClips', audio: 'audioClips', overlay: 'overlayClips', sticker: 'stickerClips' };
  const clipSpan = (p, track, id) => {
    if (track === 'video') {
      const l = videoLayout(p.videoClips).find((x) => x.clip.id === id);
      return l ? { start: l.start, len: l.end - l.start } : null;
    }
    if (track === 'effect' && String(id).includes('|')) {
      // A clip-attached effect object: its span is the window its bar covers.
      const o = effectObjects(p).find((x) => x.key === id);
      return o ? { start: o.start, len: o.duration } : null;
    }
    const c = (p[TRACK_ARRAY[track]] || []).find((x) => x.id === id);
    if (!c) return null;
    if (track === 'audio') return { start: c.start, len: freeLen('audio', c) };
    if (track === 'overlay') return { start: c.start, len: freeLen('overlay', c) };
    return { start: c.start, len: c.duration };
  };

  // Trim wrapper: while an edge is dragged, the preview/playhead follows the edge being
  // trimmed and a readout chip shows the edge time + the clip's resulting length; the snap
  // guide lights when the edge lands on a snap target (playhead, neighbour, marker, zero).
  // The drag itself — values, clamping, undo — is exactly the existing handler.
  const trimAware = (track, clip, mode, onMove) => (d, ev) => {
    onMove(d, ev);
    const span = clipSpan(projectRef.current, track, clip.id);
    if (!span) return;
    const edgeTime = mode === 'left' ? span.start : span.start + span.len;
    onSeek(edgeTime);
    setTrimHud({ x: playheadX(edgeTime, pps, HEADER), text: `${formatTime(edgeTime)} · ${span.len.toFixed(2)}s` });
    if (projectRef.current.snapping) {
      const targets = edgeTimes(clip.id).filter((e) => Math.abs(e - span.start) > 1e-9 && Math.abs(e - (span.start + span.len)) > 1e-9);
      const hit = targets.find((e) => Math.abs(e - edgeTime) * pps < 2);
      setSnapAt(hit ?? null);
    }
  };
  const endTrim = (onEnd) => (ev) => { setTrimHud(null); setSnapAt(null); onEnd?.(ev); };

  // Locked layers refuse every pointer edit (the reducer guard is the backstop; the UI
  // never starts a gesture it knows will be refused).
  const trackLocked = (track, clip) => isLayerLocked(project, track, clipLayer(track, clip));

  // Razor tool: a click on a clip cuts it at the pointer.
  const razorSplit = (e, track, clip) => {
    e.stopPropagation();
    e.preventDefault();
    if (trackLocked(track, clip)) return;
    const raw = timeFromEvent(e);
    dispatch({ type: 'split', track, id: clip.id, t: project.snapping ? snapPoint(raw) : raw, newId: uid() });
    onSelect(null);
  };

  const scrub = (e) => {
    // Checklist #4: scrubbing while playing never landed — the playback
    // clock re-asserted the old position every frame and clobbered the
    // seek. Pause first (Premiere-like); the user presses play again.
    if (onScrubStart) onScrubStart();
    onSelect(null);
    onSeek(timeFromEvent(e));
    const move = (ev) => onSeek(timeFromEvent(ev));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Box selection: drag on an empty part of the tracks to select every clip the box touches (Ctrl / Shift keeps
  // the clips already selected). A plain click still moves the playhead and clears the selection.
  const [box, setBox] = useState(null); // { x, y, w, h } in timeline content pixels
  const contentRef = useRef(null);
  const startBox = (e) => {
    if (e.button !== 0 || tool === 'razor') return scrub(e);
    e.preventDefault();
    const keep = e.ctrlKey || e.shiftKey || e.metaKey;
    const base = keep && selection ? (selection.items || [{ track: selection.track, id: selection.id }]) : [];
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const rectOf = (ev) => ({ left: Math.min(x0, ev.clientX), right: Math.max(x0, ev.clientX), top: Math.min(y0, ev.clientY), bottom: Math.max(y0, ev.clientY) });
    const move = (ev) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      moved = true;
      const r = rectOf(ev);
      const c = contentRef.current.getBoundingClientRect();
      setBox({ x: r.left - c.left, y: r.top - c.top, w: r.right - r.left, h: r.bottom - r.top });
      const hit = [...contentRef.current.querySelectorAll('[data-sel-id]')].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
      }).map((el) => ({ track: el.dataset.selTrack, id: el.dataset.selId }));
      const items = [...base];
      hit.forEach((h) => { if (!items.some((x) => x.track === h.track && x.id === h.id)) items.push(h); });
      onSelect(makeSelection(items));
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      if (!moved) {
        if (!keep) onSelect(null);
        onSeek(timeFromEvent(ev));
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const laneAt = (ev) => document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-lane]')?.dataset.lane;

  const startVideoDrag = (e, clip, mode) => {
    if (tool === 'razor') return razorSplit(e, 'video', clip);
    if (isLayerLocked(project, 'video', 0)) return;
    onSelect({ track: 'video', id: clip.id });
    if (clip.gap) {
      // Gaps only resize (and cannot be moved).
      if (mode === 'move') return;
      drag(e, trimAware('video', clip, mode, (d) => dispatch({ type: 'trimClip', track: 'video', id: clip.id, edge: mode, delta: mode === 'left' ? d : -d })), endTrim());
      return;
    }
    const media = mediaById[clip.mediaId];
    const isImage = media.type === 'image';
    const o = { ...clip };
    const sp = clip.speed || 1;
    const grab = timeFromEvent(e) - (layout.find((l) => l.clip.id === clip.id)?.start ?? 0);
    let toOverlay = null; // time where the clip lands when dropped on the Overlay lane
    const videoMove = (d, ev) => {
      if (mode === 'move' && laneAt(ev) === 'overlay') {
        // Dragged up onto the Overlay lane: show where it will land.
        toOverlay = Math.max(0, timeFromEvent(ev) - grab);
        setDrop({ lane: 'overlay', time: toOverlay });
        return;
      }
      if (toOverlay !== null) { toOverlay = null; setDrop(null); }
      if (mode === 'left' || (!magnet.video && mode !== 'move')) {
        // Left edge (either magnet state) and every magnet-off trim go through trimClip:
        // it anchors the edge that is NOT dragged — a left trim keeps the clip's right edge
        // fixed, moves the start and advances the source in-offset by the same delta (the
        // frame under any fixed timeline point does not change), and the removed head
        // becomes a gap before the clip. (This branch used to patch `in` alone for the
        // magnet-on left edge: the start stayed put, the right edge rushed in and the
        // content slipped — the clip collapsed instead of trimming.)
        dispatch({ type: 'trimClip', track: 'video', id: clip.id, edge: mode, delta: mode === 'left' ? d : -d });
      } else if (mode === 'right') {
        if (hasCurve(o)) {
          // Ramped clip: the edge tracks the pointer in timeline seconds; the
          // new source end is the curve integral of the target length (past the
          // current end it extrapolates at the tail rate). The store slices
          // the curve to the new window.
          const lay = layout.find((l) => l.clip.id === clip.id);
          const curLen = lay ? lay.end - lay.start : 0;
          const target = Math.max(MIN_CLIP, curLen + d);
          const span = o.out - o.in;
          const newSpan = target <= curLen ? sourceOffsetAt(o, target) : span + (target - curLen) * speedAtSource(o, span);
          dispatch({ type: 'update', track: 'video', id: clip.id, patch: { out: clamp(o.in + newSpan, o.in + sourceOffsetAt(o, MIN_CLIP), isImage ? 3600 : media.duration) } });
        } else {
          dispatch({ type: 'update', track: 'video', id: clip.id, patch: { out: clamp(o.out + d * sp, o.in + MIN_CLIP * sp, isImage ? 3600 : media.duration) } });
        }
      } else {
        // Reorder on the magnetic main track: drop index from the pointer position among the other clips.
        const others = videoLayout(project.videoClips.filter((c) => c.id !== clip.id));
        const pos = timeFromEvent(ev);
        const toIndex = others.filter((l) => (l.start + l.end) / 2 < pos).length;
        dispatch({ type: 'moveVideo', id: clip.id, toIndex });
      }
    };
    const videoEnd = () => {
      if (toOverlay === null) return;
      setDrop(null);
      dispatch({ type: 'moveToOverlay', id: clip.id, at: toOverlay });
      onSelect({ track: 'overlay', id: clip.id });
    };
    if (mode === 'move') drag(e, videoMove, videoEnd);
    else drag(e, trimAware('video', clip, mode, videoMove), endTrim(videoEnd));
  };

  const startFreeDrag = (e, track, clip, mode) => {
    if (tool === 'razor') return razorSplit(e, track, clip);
    if (trackLocked(track, clip)) return;
    // Moving one clip of a multiple selection moves every selected clip off the main track by the same time.
    // Members on locked layers stay behind (their updates would be refused anyway).
    const group = mode === 'move' && selection?.items && isSelected(selection, track, clip.id)
      ? selection.items.map((it) => ({ ...it, clip: findFree(it) })).filter((it) => it.clip && !trackLocked(it.track, it.clip)) : null;
    if (group && group.length > 1) {
      const minStart = Math.min(...group.map((g) => g.clip.start));
      drag(e, (d) => {
        const dd = Math.max(-minStart, d);
        group.forEach((g) => dispatch({ type: 'update', track: g.track, id: g.id, patch: { start: g.clip.start + dd } }));
      });
      return;
    }
    onSelect({ track, id: clip.id });
    const o = { ...clip };
    let toMain = null; // overlay clip dragged down onto the main track: insert index
    const freeMove = (d, ev) => {
      if (track === 'overlay' && mode === 'move' && laneAt(ev) === 'video') {
        const t = timeFromEvent(ev);
        toMain = layout.filter((l) => (l.start + l.end) / 2 < t).length;
        setDrop({ lane: 'video', time: t, at: toMain < layout.length ? layout[toMain].start : layout.length ? layout[layout.length - 1].end : 0 });
        return;
      }
      if (toMain !== null) { toMain = null; setDrop(null); }
      if (mode === 'move') {
        let start = Math.max(0, o.start + d);
        if (project.snapping) {
          const r = snapMove(start, freeLen(track, o), clip.id);
          setSnapAt(r.at);
          start = r.start;
        }
        const patch = { start };
        // Up or down to another layer of the same lane (or a new one past the last), when the clip fits there.
        const laneEl = LAYERED[track] && scrollRef.current?.querySelector(`[data-lane="${track}"]`);
        if (laneEl) {
          const want = layerAtY(track, laneEl, ev.clientY);
          if (want !== layerOf(o) && layerFree(project, track, want, start, freeLen(track, o), clip.id)) {
            patch.layer = want;
            o.layer = want;
          }
        }
        dispatch({ type: 'update', track, id: clip.id, patch });
        return;
      }
      if (magnet[track]) {
        // Magnet on: trimming closes up the space (later clips shift with the edit).
        dispatch({ type: 'trimClip', track, id: clip.id, edge: mode, delta: mode === 'left' ? d : -d });
        return;
      }
      if (project.snapping && (track === 'text' || track === 'effect')) {
        // Duration-based clips: pull the dragged edge onto a snap target, like moves do.
        const edge0 = mode === 'left' ? o.start + d : o.start + o.duration + d;
        const snapped = snapPoint(edge0);
        if (snapped !== edge0) { d += snapped - edge0; setSnapAt(snapped); }
      }
      let patch;
      if (track === 'text' || track === 'effect') {
        if (mode === 'left') {
          const start = clamp(o.start + d, 0, o.start + o.duration - MIN_CLIP);
          patch = { start, duration: o.start + o.duration - start };
        } else patch = { duration: Math.max(MIN_CLIP, o.duration + d) };
      } else {
        // Audio and overlay clips: timeline seconds times speed give source seconds; photos have no end.
        const sp = o.speed || 1;
        const m = mediaById[o.mediaId];
        const len = m?.type === 'image' ? Infinity : m?.duration ?? o.out;
        if (hasCurve(o)) {
          // Ramped clip: convert through the curve integral (edge rates when
          // extending); the store slices the curve to the new window.
          const lenT = freeLen(track, o);
          const span = o.out - o.in;
          if (mode === 'left') {
            const dd = clamp(d, -Math.min(o.in / speedAtSource(o, 0), o.start), lenT - MIN_CLIP);
            const srcDelta = dd >= 0 ? sourceOffsetAt(o, dd) : dd * speedAtSource(o, 0);
            patch = { in: o.in + srcDelta, start: o.start + dd };
          } else {
            const target = Math.max(MIN_CLIP, lenT + d);
            const newSpan = target <= lenT ? sourceOffsetAt(o, target) : span + (target - lenT) * speedAtSource(o, span);
            patch = { out: clamp(o.in + newSpan, o.in + sourceOffsetAt(o, MIN_CLIP), len) };
          }
        } else if (mode === 'left') {
          const dd = clamp(d, -Math.min(o.in / sp, o.start), (o.out - o.in) / sp - MIN_CLIP);
          patch = { in: o.in + dd * sp, start: o.start + dd };
        } else patch = { out: clamp(o.out + d * sp, o.in + MIN_CLIP * sp, len) };
      }
      dispatch({ type: 'update', track, id: clip.id, patch });
    };
    const freeEnd = () => {
      setSnapAt(null);
      if (toMain === null) return;
      setDrop(null);
      dispatch({ type: 'moveToMain', id: clip.id, index: toMain });
      onSelect({ track: 'video', id: clip.id });
    };
    if (mode === 'move') drag(e, freeMove, freeEnd);
    else drag(e, trimAware(track, clip, mode, freeMove), endTrim(freeEnd));
  };

  // A clip-attached (bound) effect follows its clip, so its bar cannot be moved on its
  // own — 'move' only selects the instance, as before. The edge handles trim the window
  // of the clip the effect runs over: the same gesture machinery as a free effect's trim
  // (snap, HUD, one undo step), writing clip.fxTiming — clip-local seconds, so the
  // window follows the clip when the clip moves, exactly as the bar does. (Before this,
  // the bound onDown swallowed edge drags whole: the handles rendered but did nothing.)
  const startBoundDrag = (e, o, mode) => {
    const lay = o.track === 'video' ? layout.find((l) => l.clip.id === o.clipId) : null;
    const hostClip = o.track === 'video' ? lay?.clip : (project.overlayClips || []).find((c) => c.id === o.clipId);
    if (!hostClip) return;
    if (trackLocked('effect', hostClip) || trackLocked(o.track, hostClip)) return;
    e.stopPropagation();
    onSelect({ track: 'effect', id: o.key });
    if (mode === 'move' || tool === 'razor') return;
    const clipStart = o.track === 'video' ? lay.start : hostClip.start;
    const span = o.track === 'video' ? lay.end - lay.start : freeLen('overlay', hostClip);
    const off0 = o.start - clipStart; // the window as rendered — already clamped to the span
    const dur0 = o.duration;
    const boundMove = (d) => {
      if (project.snapping) {
        // Duration-based trims pull the dragged edge onto a snap target, like free ones do.
        const edge0 = mode === 'left' ? o.start + d : o.start + o.duration + d;
        const snapped = snapPoint(edge0);
        if (snapped !== edge0) { d += snapped - edge0; setSnapAt(snapped); }
      }
      let start = off0;
      let duration = dur0;
      if (mode === 'left') {
        start = clamp(off0 + d, 0, off0 + dur0 - MIN_CLIP);
        duration = off0 + dur0 - start;
      } else {
        duration = clamp(dur0 + d, MIN_CLIP, span - off0);
      }
      dispatch({ type: 'update', track: o.track, id: o.clipId, patch: { fxTiming: withFxTiming(hostClip, o.fx, { start, duration }, span) } });
    };
    drag(e, trimAware('effect', { id: o.key }, mode, boundMove), endTrim());
  };

  // Zoom keeping one moment of the timeline under the same spot on screen (the mouse for Ctrl + wheel, the
  // playhead for the zoom buttons and slider). The scroll is fixed after the new width is laid out.
  const zoomAnchor = useRef(null);
  const zoomTo = (next, at, x) => {
    const el = scrollRef.current;
    const n = clamp(next, 2, 300);
    if (el) {
      const t = at ?? time;
      zoomAnchor.current = { t, x: x ?? t * pps - el.scrollLeft };
    }
    setPps(n);
  };
  useLayoutEffect(() => {
    const a = zoomAnchor.current;
    const el = scrollRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, a.t * pps - a.x);
  }, [pps]);

  // The playhead is painted from the shared playback clock on rAF, straight to the DOM:
  // it glides at display rate (interpolated from the media anchor) even when React renders
  // drop frames, and its x comes from the same playheadX mapping as the ruler and clips.
  // While playing it also keeps itself in view (followScrollTarget never fights a manual
  // scroll that keeps the playhead visible).
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const el = playheadRef.current;
      const sc = scrollRef.current;
      if (!el) return;
      const c = clockRef?.current;
      const t = c?.playing ? interpolateTime(c.time, c.stamp, performance.now(), c.rate || 1) : timeRef.current;
      const x = playheadX(t, ppsRef.current, HEADER);
      el.style.transform = `translateX(${x}px)`;
      if (c?.playing && sc) {
        const target = followScrollTarget(x, sc.scrollLeft, sc.clientWidth, HEADER);
        if (target !== null && Math.abs(target - sc.scrollLeft) > 2) sc.scrollTo({ left: target, behavior: 'smooth' });
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mouse wheel: Ctrl + wheel (or a touchpad pinch) zooms around the mouse, Shift + wheel scrolls
  // left / right. A plain wheel keeps scrolling the tracks up and down.
  const wheelState = useRef({});
  wheelState.current = { pps, zoomTo };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); // also stops the window from zooming
        const { pps: cur, zoomTo: zoom } = wheelState.current;
        const r = el.getBoundingClientRect();
        const x = Math.max(0, e.clientX - r.left - HEADER);
        const t = (x + el.scrollLeft) / cur;
        zoom(cur * Math.exp(-e.deltaY * unit * 0.002), t, x);
      } else if (e.shiftKey) {
        e.preventDefault();
        el.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * unit;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Zoom so the whole project fits the visible timeline.
  const fit = () => {
    const w = (scrollRef.current?.clientWidth || 900) - HEADER - 32;
    setPps(clamp(w / Math.max(duration, 1), 2, 300));
    scrollRef.current?.scrollTo({ left: 0 });
  };

  const markerEls = markers.map((m) => (
    <button key={m.id} className="marker" style={{ left: m.time * pps, color: markerColorHex(m.color) }} aria-label={t('tl.markerAt', { time: formatTime(m.time) })}
      title={`${t('tl.marker', { time: formatTime(m.time) })}${m.label ? ` · ${m.label}` : ''}\n${t('tl.markerHint')}`}
      onPointerDown={(e) => e.stopPropagation()} onClick={() => onSeek(m.time)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMarkerMenu({ x: e.clientX, y: e.clientY, marker: m }); }}
      onDoubleClick={() => dispatch({ type: 'removeMarker', id: m.id })}>
      <Flag size={11} fill="currentColor" />
    </button>
  ));

  // Marker menu (step 5): colour per marker, plus bulk delete — one marker,
  // the markers inside the selected clip, or every marker on the ruler.
  const markerMenuItems = (mm) => {
    const m = mm.marker;
    const items = MARKER_COLORS.map((c) => ({
      label: `${(m.color || 'amber') === c.id ? '✓ ' : ''}${t('tl.colour', { name: c.name })}`,
      onClick: () => dispatch({ type: 'setMarkerColor', id: m.id, color: c.id }),
    }));
    items.push('sep', { label: t('tl.removeMarker'), onClick: () => dispatch({ type: 'removeMarker', id: m.id }) });
    const selClip = selection && !selection.items
      ? (project.videoClips || []).find((c) => selection.track === 'video' && c.id === selection.id)
        || (project.overlayClips || []).find((c) => selection.track === 'overlay' && c.id === selection.id)
        || (project.textClips || []).find((c) => selection.track === 'text' && c.id === selection.id)
        || (project.audioClips || []).find((c) => selection.track === 'audio' && c.id === selection.id)
      : null;
    if (selClip) {
      const end = selClip.start + (selection.track === 'video' ? (selClip.out - selClip.in) / (selClip.speed || 1) : selClip.duration || 0);
      items.push({
        label: t('tl.removeMarkersInClip'),
        onClick: () => dispatch({ type: 'removeMarkersInRange', from: selClip.start, to: end }),
      });
    }
    items.push({ label: t('tl.removeAllMarkers', { count: markers.length }), onClick: () => dispatch({ type: 'clearMarkers' }) });
    return items;
  };

  // Beat markers: a small violet diamond low in the ruler per beat of the grid —
  // visual only (not buttons): clicking the ruler still scrubs, and the grid is
  // cleared from the toolbar, not beat by beat.
  const beatEls = beats.map((t, i) => (
    <div key={`beat-${i}`} className="beat-tick" style={{ left: t * pps }} title={tr('tl.beat', { time: formatTime(t) })} />
  ));

  // Ruler ticks: pick a step that keeps labels ~90px apart.
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * pps >= 90) || 120;
  const ticks = [];
  for (let t = 0; t * pps < width; t += step) ticks.push(t);
  // Minor ticks at a fifth of the label step — only once the majors sit far
  // enough apart that the fifths stay readable (and the node count sane):
  // scrubbing against a bare ruler between labels was guesswork at deep zoom.
  const minorTicks = step * pps >= 180
    ? ticks.flatMap((t) => [1, 2, 3, 4].map((k) => t + (k * step) / 5)).filter((t) => t * pps < width)
    : [];

  // A selected clip that lives on a free track (everything but the main track), with its current values.
  const findFree = (it) => {
    const key = { overlay: 'overlayClips', text: 'textClips', audio: 'audioClips', effect: 'effectClips', sticker: 'stickerClips' }[it.track];
    return key ? (project[key] || []).find((c) => c.id === it.id) : null;
  };
  const laneClass = (id) => `tl-lane ${drop && (drop.lane === id || (drop.lane === 'files' && id === 'video')) ? 'drop-target' : ''}`;
  // Several clips selected (box selection, Ctrl + click): selection.items lists them all; selection.track / id is
  // the first one, shown in the properties panel.
  const toggleSel = (track, id) => {
    const items = selection ? (selection.items || [{ track: selection.track, id: selection.id }]) : [];
    const has = items.some((x) => x.track === track && x.id === id);
    onSelect(makeSelection(has ? items.filter((x) => !(x.track === track && x.id === id)) : [...items, { track, id }]));
  };
  // Silence marks awaiting confirmation (10/10 step 4): App holds the
  // detected ranges in TIMELINE seconds for one clip; a clip renders the
  // slice of them that falls inside its own window, in clip-relative
  // seconds for the Clip overlay.
  const marksFor = (clipId, start, length) => {
    if (!silenceMarks || silenceMarks.id !== clipId) return null;
    const rel = (silenceMarks.ranges || [])
      .map((r) => ({ start: Math.max(0, r.start - start), end: Math.min(length, r.end - start) }))
      .filter((r) => r.end > r.start);
    return rel.length ? rel : null;
  };

  const common = { pps, selection, onMenu: onClipMenu, onToggle: toggleSel,
    layerStateFor: (track, clip) => layerStateOf(project, track, clipLayer(track, clip)) };
  // The filter of a picture clip as a chip on the clip, removable from the timeline.
  const lookTags = (track, clip) => {
    if (!clip.filter || clip.filter === 'none') return null;
    const name = filterName(clip.filter);
    return [{ key: 'filter', label: name, title: t('tl.filterTitle', { name }), onRemove: () => dispatch({ type: 'update', track, id: clip.id, patch: { filter: 'none' } }) }];
  };
  const fxObjects = effectObjects(project);
  // Rows of a layered lane: one per layer, empty ones included.
  const layerRows = (lane, clips) => {
    const count = layerCount(project, lane);
    const rows = {};
    clips.forEach((c) => { rows[c.id] = rowToLayer(lane, layerOf(c), count); });
    return { rows, count };
  };
  const stacks = {
    sticker: stackRows((project.stickerClips || []).map((c) => ({ id: c.id, start: c.start, duration: c.duration }))),
    effect: stackRows(fxObjects.map((o) => ({ id: o.key, start: o.start, duration: o.duration }))),
    text: layerRows('text', project.textClips),
    overlay: layerRows('overlay', overlays),
    audio: layerRows('audio', project.audioClips),
  };
  const rowHeight = (id) => (stacks[id] ? Math.max(46, HEAD_TITLE_H + stacks[id].count * rowOf(id) + 8) : undefined);
  // The layers of a lane as faint bands; an empty one can be removed. Locked bands get the
  // diagonal treatment, hidden ones fade back — the state is readable without the header.
  const layerBands = (lane) => {
    if (!LAYERED[lane]) return null;
    const { count } = stacks[lane];
    const clips = project[LAYERED[lane]];
    return Array.from({ length: count }, (_, row) => {
      const layer = rowToLayer(lane, row, count);
      const empty = !clips.some((c) => layerOf(c) === layer);
      const st = layerStateOf(project, lane, layer);
      return (
        <div key={`band-${row}`} className={`layer-band ${st.locked ? 'locked' : ''} ${st.hidden ? 'is-hidden' : ''}`} style={{ top: HEAD_TITLE_H + row * rowOf(lane), height: rowOf(lane) - 4 }}>
          {empty && count > 1 && (
            <button className="layer-remove" title={t('tl.removeEmptyLayer')} aria-label={t('tl.removeEmptyLayer')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); dispatch({ type: 'removeLayer', track: lane, layer }); }}><X size={11} /></button>
          )}
          {renaming && renaming.track === lane && renaming.layer === layer
            ? layerRenameInput(lane, layer)
            : (count > 1 || (project.layerNames && project.layerNames[lane] && project.layerNames[lane][layer])) && (
              <span className="layer-band-name">{dispLayerName(lane, layer)}</span>
            )}
        </div>
      );
    });
  };

  const renderLane = (id) => {
    if (id === 'effect') {
      // One bar per effect applied to a clip; it follows the clip. Select it to see it in the panel, Delete removes it.
      return fxObjects.map((o) => {
        const e = EFFECTS.find((x) => x.id === o.fx);
        return (
          <Clip {...common} key={o.key} track={o.free ? 'effect free' : 'effect bound'} selTrack="effect" clip={o.free ? o.clip : { id: o.key }}
            start={o.start} length={o.duration} row={stacks.effect.rows[o.key]}
            icon={<span className="clip-emoji"><FxGlyph group={e?.group} size={12} /></span>} label={o.free ? e?.name || o.fx : `${e?.name || o.fx} · ${t('tl.onClip')}`}
            onDown={o.free ? (ev, mode) => startFreeDrag(ev, 'effect', o.clip, mode)
              : (ev, mode) => startBoundDrag(ev, o, mode)} />
        );
      });
    }
    if (id === 'overlay') {
      return overlays.map((c) => {
        const m = mediaById[c.mediaId];
        const len = freeLen('overlay', c);
        return (
          <Clip {...common} key={c.id} track="overlay" clip={c} start={c.start} length={len} row={stacks.overlay.rows[c.id]} rowH={rowOf('overlay')}
            icon={<Layers size={12} />} label={m?.name ?? '?'} lost={!!m?.missing} tags={lookTags('overlay', c)} onDown={(e, mode) => startFreeDrag(e, 'overlay', c, mode)}
            onKeyDrag={(e, t) => startKeyDrag(e, 'overlay', c, t, len, c.start)}>
            <Filmstrip m={m} clip={c} width={len * pps} pps={pps} />
            {(hasVolKeys(c) || c.fadeIn > 0 || c.fadeOut > 0) && !c.muted && m?.hasAudio && (
              <VolLine clip={c} len={len} pps={pps}
                onDragPoint={(e, k) => startVolDrag(e, 'overlay', c, k, len)}
                onRemovePoint={(k) => { const keys = removeVolKey(c, k.t, 0.05); if (keys) dispatch({ type: 'update', track: 'overlay', id: c.id, patch: { volKeys: keys } }); }} />
            )}
          </Clip>
        );
      });
    }
    if (id === 'sticker') {
      // Bundled stickers (10/10 step 3): free clips like text — drag moves, edges trim,
      // the generic update/delete/duplicate actions resolve through TRACKS.
      return (project.stickerClips || []).map((c) => (
        <Clip {...common} key={c.id} track="sticker" clip={c} start={c.start} length={c.duration} row={stacks.sticker.rows[c.id]}
          icon={<Sticker size={12} />} label={c.name || t('tl.stickerClip')}
          onDown={(e, mode) => startFreeDrag(e, 'sticker', c, mode)} />
      ));
    }
    if (id === 'text') {
      return project.textClips.map((c) => (
        <Clip {...common} key={c.id} track={c.caption ? 'text caption' : 'text'} selTrack="text" clip={c} start={c.start} length={c.duration} row={stacks.text.rows[c.id]}
          icon={c.caption ? <Captions size={12} /> : <Type size={12} />} label={c.text}
          onDown={(e, mode) => startFreeDrag(e, 'text', c, mode)} />
      ));
    }
    if (id === 'video') {
      return (
        <>
          {layout.map((l) => {
            if (l.clip.gap) {
              return (
                <Clip {...common} key={l.clip.id} track="video gap" selTrack="video" clip={l.clip} start={l.start} length={l.end - l.start}
                  label={t('tl.gap')} onDown={(e, mode) => startVideoDrag(e, l.clip, mode)} />
              );
            }
            const m = mediaById[l.clip.mediaId];
            const sp = l.clip.speed || 1;
            return (
              <Clip {...common} key={l.clip.id} track="video" clip={l.clip} start={l.start} length={l.end - l.start}
                marks={marksFor(l.clip.id, l.start, l.end - l.start)}
                label={videoLabel(l.clip, m)} lost={!!m?.missing} dropHere={drop?.clipId === l.clip.id} tags={lookTags('video', l.clip)}
                onDown={(e, mode) => startVideoDrag(e, l.clip, mode)}
                onKeyDrag={(e, t) => startKeyDrag(e, 'video', l.clip, t, l.end - l.start, l.start)}>
                <Filmstrip m={m} clip={l.clip} width={(l.end - l.start) * pps} pps={pps} />
                {m?.wave && !l.clip.muted && <ClipWave m={m} clip={l.clip} pps={pps} />}
                {(hasVolKeys(l.clip) || l.clip.fadeIn > 0 || l.clip.fadeOut > 0) && !l.clip.muted && m?.hasAudio && (
                  <VolLine clip={l.clip} len={l.end - l.start} pps={pps}
                    onDragPoint={(e, k) => startVolDrag(e, 'video', l.clip, k, l.end - l.start)}
                    onRemovePoint={(k) => { const keys = removeVolKey(l.clip, k.t, 0.05); if (keys) dispatch({ type: 'update', track: 'video', id: l.clip.id, patch: { volKeys: keys } }); }} />
                )}
              </Clip>
            );
          })}
          {layout.filter((l) => l.trans > 0).map((l) => {
            const sel = selection?.track === 'transition' && selection.id === l.clip.id;
            const def = TRANSITIONS.find((t) => t.id === l.clip.transition.type);
            return (
              <button key={'tr' + l.clip.id} className={`tr-pill ${sel ? 'on' : ''}`}
                style={{ left: l.start * pps }}
                title={t('tl.transitionTitle', { name: def ? libName('tr', def.id, def.name) : l.clip.transition.type, dur: l.trans.toFixed(1) })}
                aria-label={t('tl.transition', { name: def ? libName('tr', def.id, def.name) : l.clip.transition.type })} aria-pressed={sel}
                onPointerDown={(e) => { e.stopPropagation(); onSelect({ track: 'transition', id: l.clip.id }); }}>
                <ArrowLeftRight size={11} />
              </button>
            );
          })}
          {drop && (drop.lane === 'video' || drop.lane === 'files') && (
            <div className="insert-line" style={{ left: drop.at * pps }} />
          )}
        </>
      );
    }
    return project.audioClips.map((c) => {
      const m = mediaById[c.mediaId];
      // Under a speed curve the strip is painted by WaveStrip (sampler-warped);
      // the single linear background below stays for every other clip.
      const warped = hasCurve(c) && m?.wave && m.duration > 0;
      const bg = !warped && m?.wave ? {
        backgroundImage: `url("${toFileUrl(m.wave)}")`, backgroundRepeat: 'no-repeat',
        backgroundSize: `${(m.duration / (c.speed || 1)) * pps}px 70%`, backgroundPosition: `${(-c.in / (c.speed || 1)) * pps}px center`,
      } : null;
      return (
        <Clip {...common} key={c.id} track="audio" clip={c} start={c.start} length={freeLen('audio', c)} bg={bg} row={stacks.audio.rows[c.id]} rowH={rowOf('audio')}
          marks={marksFor(c.id, c.start, freeLen('audio', c))}
          icon={<Music size={12} />} label={m?.name ?? '?'} lost={!!m?.missing} onDown={(e, mode) => startFreeDrag(e, 'audio', c, mode)}>
          {warped && <WaveStrip m={m} clip={c} len={freeLen('audio', c)} pps={pps} />}
          {!c.muted && (
            <VolLine clip={c} len={freeLen('audio', c)} pps={pps}
              onDragPoint={(e, k) => startVolDrag(e, 'audio', c, k, freeLen('audio', c))}
              onRemovePoint={(k) => { const keys = removeVolKey(c, k.t, 0.05); if (keys) dispatch({ type: 'update', track: 'audio', id: c.id, patch: { volKeys: keys } }); }} />
          )}
        </Clip>
      );
    });
  };

  // Toolbar availability mirrors App's shortcut handlers exactly — same target resolution
  // (selection first, then the main-track clip under the playhead) and the same trimActions
  // builder — so a button is enabled only when its shortcut would actually do something.
  const trimTargets = [];
  if (selection) trimTargets.push(selection);
  const underPlayhead = videoClipAt(project, time);
  if (underPlayhead && !(selection && selection.id === underPlayhead.clip.id)) trimTargets.push({ track: 'video', id: underPlayhead.clip.id });
  const canTrim = (side) => trimTargets.some((tgt) => trimActions(project, { track: tgt.track, id: tgt.id, t: time, side, newId: tgt.id }).length > 0);
  const canSplit = !!(selection || underPlayhead);
  // Beat cuts: the clip Split at beats would cut (selection first, then the clip
  // under the playhead — the same targeting as the split button), or null.
  const beatTarget = beats.length ? beatSplitTarget(project, time, selection) : null;

  return (
    <section className="timeline" dir="ltr" aria-label={t('tl.timeline')}>
      <div className="tl-main">
      {overlay}
      <div className="tl-toolbar">
        <div className="tool-group">
          <div className="seg-icons" role="group" aria-label={t('tl.groupTool')}>
            <IconBtn label={`${t('tl.toolSelect')}${keyHint('toolSelect')}`} active={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={16} /></IconBtn>
            <IconBtn label={`${t('tl.toolRazor')}${keyHint('toolRazor')}`} active={tool === 'razor'} onClick={() => setTool('razor')}><Slice size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('tl.groupHistory')}>
            <IconBtn label={`${t('tl.undo')}${keyHint('undo')}`} onClick={() => dispatch({ type: 'undo' })} disabled={!canUndo}><Undo2 size={16} /></IconBtn>
            <IconBtn label={`${t('tl.redo')}${keyHint('redo')}`} onClick={() => dispatch({ type: 'redo' })} disabled={!canRedo}><Redo2 size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('tl.groupEdit')}>
            <IconBtn label={`${t('tl.split')}${keyHint('split')}`} onClick={onSplit} disabled={!canSplit}><Scissors size={16} /></IconBtn>
            <IconBtn label={`${t('tl.trimLeft')}${keyHint('trimLeft')}`} onClick={() => onTrimSide('left')} disabled={!canTrim('left')}><ArrowLeftToLine size={16} /></IconBtn>
            <IconBtn label={`${t('tl.trimRight')}${keyHint('trimRight')}`} onClick={() => onTrimSide('right')} disabled={!canTrim('right')}><ArrowRightToLine size={16} /></IconBtn>
            <IconBtn label={`${t('tl.duplicate')}${keyHint('duplicate')}`} onClick={onDuplicate} disabled={!selection}><Copy size={16} /></IconBtn>
            <IconBtn label={`${t('tl.delete')}${keyHint('remove')}`} onClick={onDelete} disabled={!selection}><Trash2 size={16} /></IconBtn>
          </div>
          {(detachOk || linkMode) && (
            <div className="tool-cluster" role="group" aria-label={t('tl.groupLink')}>
              {detachOk && <IconBtn label={t('tl.detachAudio')} onClick={onDetach}><AudioLines size={16} /></IconBtn>}
              {linkMode === 'unlink' && <IconBtn label={t('tl.unlink')} onClick={onLinkToggle}><Unlink size={16} /></IconBtn>}
              {linkMode === 'link' && <IconBtn label={t('tl.link')} onClick={onLinkToggle}><Link2 size={16} /></IconBtn>}
            </div>
          )}
          <div className="tool-cluster" role="group" aria-label={t('tl.groupMark')}>
            <IconBtn label={`${t('tl.markerBtn')}${keyHint('marker')}${t('tl.markerBtnHint')}`} onClick={onMarker}><Flag size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('tl.groupBeats')}>
            <IconBtn label={beats.length ? t('tl.beatsAgain', { bpm: formatBpm(project.beats.bpm) }) : t('tl.beatsDetect')}
              active={beats.length > 0} onClick={onDetectBeats}><AudioWaveform size={16} /></IconBtn>
            {beats.length > 0 && <span className="beat-bpm" title={t(beats.length === 1 ? 'tl.beatsTempoOne' : 'tl.beatsTempo', { bpm: formatBpm(project.beats.bpm), count: beats.length })}>{formatBpm(project.beats.bpm)}</span>}
            <IconBtn label={beatTarget ? t('tl.splitBeats', { count: beatTarget.times.length }) : t('tl.splitBeatsOff')}
              onClick={onSplitBeats} disabled={!beatTarget}><Split size={16} /></IconBtn>
            {beats.length > 0 && (
              <IconBtn label={t('tl.clearBeats')} onClick={() => dispatch({ type: 'setBeats', beats: null })}><X size={16} /></IconBtn>
            )}
          </div>
        </div>
        <div className="tool-group">
          <div className="tool-cluster" role="group" aria-label={t('tl.groupRecordSnap')}>
          {recorder.recording ? (
            <button className="rec-pill" onClick={onToggleRecord} aria-pressed="true"
              title={t('tl.stopRecTitle')}>
              <span className="rec-dot" aria-hidden="true" />
              <Square size={12} fill="currentColor" aria-hidden="true" />
              <span className="rec-stop-label">{t('tl.stop')}</span>
              <span className="rec-time">{formatTime(recorder.seconds).slice(0, 5)}</span>
              <RecMeter analyserRef={recorder.analyserRef} />
            </button>
          ) : (
            <button className="rec-btn" onClick={onToggleRecord}
              aria-pressed="false" title={t('tl.recTitle')}>
              <Mic size={15} />
            </button>
          )}
          <IconBtn label={project.snapping ? t('tl.snappingOn') : t('tl.snappingOff')} active={project.snapping}
            onClick={() => dispatch({ type: 'setProject', patch: { snapping: !project.snapping }, transient: true })}><Magnet size={16} /></IconBtn>
          <IconBtn label={insertMode ? t('tl.insertOn') : t('tl.insertOff')} active={insertMode}
            onClick={() => setInsertMode((v) => !v)}><BetweenHorizontalStart size={16} /></IconBtn>
          </div>
          <div className="tool-cluster" role="group" aria-label={t('tl.groupView')}>
            <IconBtn label={t('tl.fit')} onClick={fit}><StretchHorizontal size={16} /></IconBtn>
            <IconBtn label={t('tl.zoomOut')} onClick={() => zoomTo(pps / 1.4)}><ZoomOut size={16} /></IconBtn>
            <input className="zoom" type="range" min="2" max="300" value={pps} aria-label={t('tl.zoomTimeline')}
              title={t('tl.zoomHint')} onChange={(e) => zoomTo(Number(e.target.value))} />
            <IconBtn label={t('tl.zoomIn')} onClick={() => zoomTo(pps * 1.4)}><ZoomIn size={16} /></IconBtn>
          </div>
        </div>
      </div>
      <div className={`tl-scroll ${tool === 'razor' ? 'razor' : ''}`} ref={scrollRef}
        onPointerMove={(e) => { if (tool === 'razor') { const t = timeFromEvent(e); setRazorAt(project.snapping ? snapPoint(t) : t); } }}
        onPointerLeave={() => setRazorAt(null)}
        onDragOver={onDragOver} onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setDrop(null);
      }} onDrop={onDrop}>
        <div className="tl-content" ref={contentRef} style={{ width: width + HEADER }}>
          {box && <div className="select-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
          <div className="tl-row ruler" onPointerDown={scrub}>
            <div className="tl-head" />
            <div className="tl-ruler">
              {markerEls}
              {beatEls}
              {minorTicks.map((t) => (
                <div key={`minor-${t}`} className="tick minor" style={{ left: t * pps }} />
              ))}
              {ticks.map((t) => (
                <div key={t} className="tick" style={{ left: t * pps }}><span>{formatTime(t).slice(0, 5)}</span></div>
              ))}
            </div>
          </div>

          {LANES.filter((l) => l.id !== 'effect' || fxObjects.length || activeDrag()?.kind === 'effect').map((l) => {
            return (
              <div key={l.id} className={`tl-row ${l.main ? 'main' : ''}`} style={{ height: rowHeight(l.id) }}>
                <div className="tl-head" data-lane={l.id}
                  onContextMenu={(LAYERED[l.id] || l.id === 'video' || l.id === 'effect') ? (e) => openLayerMenu(e, l.id) : undefined}>
                  {/* One header row per layer, no title strip (Hamza's UI review,
                      2026-11-10): the first row carries the lane icon + the layer
                      name + the lock/eye/solo/menu controls. Add-layer and the
                      lane magnet live in the layer menu now (layerMenuItems). */}
                  <div className="tl-layer-stack">
                    {layerCtlRows(l)}
                  </div>
                </div>
                <div className={laneClass(l.id)} data-lane={l.id} onPointerDown={startBox}>
                  {layerBands(l.id)}
                  {renderLane(l.id)}
                  {l.main && empty && (
                    <div className="lane-empty"><Film size={16} /> {t('tl.dragMediaHere')}</div>
                  )}
                </div>
              </div>
            );
          })}

          {markers.map((m) => <div key={m.id} className="marker-line" style={{ left: HEADER + m.time * pps, background: `${markerColorHex(m.color)}73` }} />)}
          {beats.map((t, i) => <div key={`beatline-${i}`} className="beat-line" style={{ left: HEADER + t * pps }} />)}
          {tool === 'razor' && razorAt != null && <div className="razor-line" style={{ left: HEADER + razorAt * pps }} />}
          {tool === 'razor' && razorAt != null && <div className="razor-time" style={{ left: HEADER + razorAt * pps }}>{formatTime(razorAt)}</div>}
          {snapAt != null && <div className="snap-line" style={{ left: HEADER + snapAt * pps }} />}
          {trimHud && <div className="trim-hud" style={{ left: trimHud.x }}>{trimHud.text}</div>}
          <div className="playhead" ref={playheadRef} />
          {drop && drop.time != null && drop.lane !== 'clip' && (
            <div className="drop-time" style={{ left: HEADER + (drop.at ?? drop.time) * pps }}>{formatTime(drop.at ?? drop.time)}</div>
          )}
        </div>
      </div>
      </div>
      <AudioMeter active={playing} />
      {layerMenu && <ContextMenu x={layerMenu.x} y={layerMenu.y} items={layerMenuItems(layerMenu)}
        onClose={() => setLayerMenu(null)} label={t('tl.layerMenu')} />}
      {markerMenu && <ContextMenu x={markerMenu.x} y={markerMenu.y} items={markerMenuItems(markerMenu)}
        onClose={() => setMarkerMenu(null)} label={t('tl.markerMenu')} />}
    </section>
  );
}

function IconBtn({ label, children, active, ...rest }) {
  return <button className={`icon-btn ${active ? 'active' : ''}`} aria-label={label} aria-pressed={active === undefined ? undefined : !!active} title={label} {...rest}>{children}</button>;
}

// Live microphone level for the recording pill: an AnalyserNode tapped off the recorder's
// own stream, read on rAF and painted straight to the fill element (no React state churn).
function RecMeter({ analyserRef }) {
  const fillRef = useRef(null);
  useEffect(() => {
    let raf = 0;
    const data = new Uint8Array(256);
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const an = analyserRef?.current;
      const el = fillRef.current;
      if (!an || !el) return;
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      el.style.width = `${Math.min(100, Math.round(rms * 280))}%`;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [analyserRef]);
  return <span className="rec-meter" aria-hidden="true"><span className="rec-meter-fill" ref={fillRef} /></span>;
}

function Clip({ pps, selection, track, selTrack, clip, start, length, label, icon, bg, dropHere, onDown, row, rowH = ROW, children, onMenu, onToggle, tags, onKeyDrag, layerStateFor, marks, lost }) {
  const st = selTrack || track;
  const selected = isSelected(selection, st, clip.id);
  const lst = layerStateFor ? layerStateFor(st, clip) : null;
  const stacked = row !== undefined ? { top: HEAD_TITLE_H + row * rowH, bottom: 'auto', height: rowH - 4 } : null;
  return (
    <div className={`clip ${track} ${selected ? 'selected' : ''} ${dropHere ? 'drop-here' : ''} ${clip.disabled ? 'off' : ''} ${lst?.locked ? 'locked' : ''} ${lst?.hidden ? 'layer-hidden' : ''} ${lost ? 'lost' : ''}`}
      style={{ left: start * pps, width: Math.max(6, length * pps), ...stacked }}
      data-sel-track={st} data-sel-id={clip.id}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Ctrl / Shift + click adds the clip to the selection (or takes it out).
        if ((e.ctrlKey || e.shiftKey || e.metaKey) && onToggle) { e.stopPropagation(); onToggle(st, clip.id); return; }
        onDown(e, 'move');
      }} title={lost ? tr('tl.clipNotFound', { label }) : clip.disabled ? tr('tl.clipDeactivated', { label }) : label}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu?.(e, st, clip); }}>
      {bg && <div className="clip-bg" style={bg} />}
      {children}
      {marks && marks.map((mk, i) => (
        <div key={i} className="silence-range" title={tr('tl.silenceTitle')}
          style={{ left: `${(mk.start / length) * 100}%`, width: `${Math.max(1.5, ((mk.end - mk.start) / length) * 100)}%` }} />
      ))}
      <div className="handle left" onPointerDown={(e) => e.button === 0 && onDown(e, 'left')} />
      <span className="clip-label">{icon}<bdi>{label}</bdi>{lost && <span className="clip-lost-tag">{tr('tl.mediaNotFound')}</span>}
      {tags?.length > 0 && (
        <span className="clip-tags">
          {tags.map((t) => (
            <span key={t.key} className="clip-tag" title={t.title}>
              {t.label}
              <button type="button" aria-label={tr('tl.removeX', { label: t.label })} title={tr('tl.removeX', { label: t.label })}
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); t.onRemove(); }}>×</button>
            </span>
          ))}
        </span>
      )}
      </span>
      {(track === 'video' || track === 'overlay') && (clip.anim || clip.keyframes) && <ClipMotion clip={clip} length={length} pps={pps} selected={selected} onKeyDrag={onKeyDrag} />}
      <div className="handle right" onPointerDown={(e) => e.button === 0 && onDown(e, 'right')} />
    </div>
  );
}

// Animations as bands at the clip's start / end (or along it for a Combo), and the keyframes of the selected
// clip as diamonds.
function ClipMotion({ clip, length, pps, selected, onKeyDrag }) {
  const a = animOf(clip, length);
  const times = selected ? keyTimes(clip).filter((t) => t >= -1e-6 && t <= length + 1e-6) : [];
  return (
    <>
      {a.in && <div className="anim-band in" style={{ width: a.in.duration * pps }} title={tr('tl.animIn', { name: animById('in', a.in.type).name })} />}
      {a.out && <div className="anim-band out" style={{ width: a.out.duration * pps }} title={tr('tl.animOut', { name: animById('out', a.out.type).name })} />}
      {a.combo && <div className="anim-band combo" title={tr('tl.animCombo', { name: animById('combo', a.combo.type).name })} />}
      {times.map((t) => (
        <span key={t} className="kf-dot" style={{ left: t * pps }} title={tr('tl.keyframeTitle')}
          onPointerDown={(e) => { e.stopPropagation(); onKeyDrag?.(e, t); }} />
      ))}
    </>
  );
}

const THUMB_H = 50; // filmstrip height inside a main-track clip
const MAX_TILES = 400;

// Filmstrip: thumbnails at their real aspect ratio, each showing the frame at its
// position on the timeline (follows trim, speed and zoom). Uses the sprite from makeVisuals.
function Filmstrip({ m, clip, width, pps }) {
  if (!m) return null;
  // Lost source (Part 3, 2026-11-10): no cached frames stand in for a file
  // that is gone — the strip renders as the red lost hatch instead.
  if (m.missing) return <div className="filmstrip lost" />;
  // Thumbnails show the source frame as-is. They used to approximate the clip's Adjust
  // settings / classic effects with a CSS filter, but that approximation was a second,
  // divergent look engine (Sprint 6 removed it): the stage preview and the export are
  // the surfaces that promise the look, and both draw it through the shader passes.
  if (m.type === 'image') {
    return <div className="filmstrip" style={{ backgroundImage: `url("${toFileUrl(m.path)}")`, backgroundSize: `auto ${THUMB_H}px`, backgroundRepeat: 'repeat-x' }} />;
  }
  if (!m.thumb || !m.thumbCount) return <div className="filmstrip loading" />;
  const tileW = (THUMB_H * m.thumbW) / m.thumbH;
  const n = Math.min(MAX_TILES, Math.ceil(width / tileW));
  const url = `url("${toFileUrl(m.thumb)}")`;
  const tiles = [];
  for (let k = 0; k < n; k++) {
    const x = k * tileW;
    const t = clip.in + sourceOffsetAt(clip, (x + tileW / 2) / pps);
    const idx = Math.max(0, Math.min(m.thumbCount - 1, Math.floor(t / m.thumbInterval)));
    tiles.push(
      <div key={k} className="tile-frame" style={{
        left: x, width: tileW, backgroundImage: url,
        backgroundSize: `${m.thumbCount * tileW}px ${THUMB_H}px`, backgroundPosition: `${-idx * tileW}px 0`,
      }} />
    );
  }
  return <div className="filmstrip">{tiles}</div>;
}

// A waveform strip warped by the clip's speed curve. The single background
// strip every clip used to get maps source time linearly; under a curve that
// misplaces where sounds fall (the Sprint 4 approximation, documented there).
// The strip is cut into segments and each segment paints its own slice of
// the media waveform scaled through the shared sampler — sourceOffsetAt is
// the same map the playhead, the filmstrip tiles and the export consume, so
// the strip now agrees with all three. Display only: nothing here feeds
// playback or export.
const WAVE_SEG_PX = 56; // target segment width on screen
const WAVE_SEG_MAX = 48; // and never more segments than this per strip
function WaveStrip({ m, clip, len, pps }) {
  const n = Math.max(1, Math.min(WAVE_SEG_MAX, Math.ceil((len * pps) / WAVE_SEG_PX)));
  const segs = [];
  for (let j = 0; j < n; j++) {
    const t0 = (len * j) / n;
    const t1 = (len * (j + 1)) / n;
    const s0 = clip.in + sourceOffsetAt(clip, t0);
    const s1 = clip.in + sourceOffsetAt(clip, t1);
    if (!(s1 > s0)) continue;
    const pxPerSrc = ((t1 - t0) * pps) / (s1 - s0); // px per source second inside this segment
    segs.push(
      <div key={j} className="wave-seg" style={{
        left: t0 * pps, width: (t1 - t0) * pps,
        backgroundImage: `url("${toFileUrl(m.wave)}")`,
        backgroundSize: `${m.duration * pxPerSrc}px 100%`,
        backgroundPosition: `${-s0 * pxPerSrc}px 0`,
      }} />
    );
  }
  return <div className="wave-strip">{segs}</div>;
}

// The volume line on a sounding clip (Sprint 10): the clip's effective gain
// trace — volume keyframes (or plain volume) times the fade envelope, the
// src/volKeys.js clipGainAt the preview plays and the export renders — drawn
// across the clip's foot. Keyframe points ride on it: drag one to move it in
// time and gain (one undo step), double-click one to remove it. The line
// itself never takes pointer events, so every existing clip gesture keeps
// the surface; only the points are grabbable.
function VolLine({ clip, len, pps, onDragPoint, onRemovePoint }) {
  if (!(len > 0)) return null;
  const H = 30;
  const W = Math.max(2, len * pps);
  const Y = (g) => H - (Math.min(2, Math.max(0, g)) / 2) * (H - 4) - 2;
  const keys = volKeyLocalPoints(clip).filter((k) => k.lt >= -1e-6 && k.lt <= len + 1e-6);
  const samples = [];
  const N = 24;
  for (let i = 0; i <= N; i++) samples.push((len * i) / N);
  for (const k of keys) samples.push(Math.min(len, Math.max(0, k.lt)));
  samples.sort((a, b) => a - b);
  const path = samples
    .map((lt, i) => `${i ? 'L' : 'M'}${(lt * pps).toFixed(1)},${Y(clipGainAt(clip, lt, len)).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="vol-line" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <path d={path} className="vol-line-path" />
      {keys.map((k) => (
        <circle key={k.t} cx={Math.min(len, Math.max(0, k.lt)) * pps} cy={Y(clipGainAt(clip, k.lt, len))} r={3.4}
          className="vol-key" role="button" aria-label={tr('tl.volKeyAria', { pct: Math.round(k.v * 100) })}
          onPointerDown={(e) => onDragPoint(e, k)}
          onDoubleClick={(e) => { e.stopPropagation(); onRemovePoint(k); }}>
          <title>{tr('tl.volKeyTitle')}</title>
        </circle>
      ))}
    </svg>
  );
}

// Audio waveform strip under a video clip (follows trim and speed).
function ClipWave({ m, clip, pps }) {
  if (hasCurve(clip) && m.duration > 0) {
    return (
      <div className="clip-wave">
        <WaveStrip m={m} clip={clip} len={clipDuration(clip)} pps={pps} />
      </div>
    );
  }
  const sp = clip.speed || 1;
  return (
    <div className="clip-wave" style={{
      backgroundImage: `url("${toFileUrl(m.wave)}")`, backgroundRepeat: 'no-repeat',
      backgroundSize: `${(m.duration / sp) * pps}px 100%`, backgroundPosition: `${(-clip.in / sp) * pps}px 0`,
    }} />
  );
}

function videoLabel(clip, m) {
  const tags = [];
  if (hasCurve(clip)) tags.push(tr('tl.speedCurve'));
  else if ((clip.speed || 1) !== 1) tags.push(`${clip.speed}×`);
  if (clip.effects?.length) tags.push(tr(clip.effects.length > 1 ? 'tl.effectsOther' : 'tl.effectsOne', { count: clip.effects.length }));
  if (clip.muted) tags.push(tr('tl.mutedTag'));
  return [m?.name ?? '?', ...tags].join(' · ');
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Selection helpers: one clip { track, id }, several { track, id, items: [{ track, id }] }.
export function isSelected(selection, track, id) {
  if (!selection) return false;
  if (selection.items) return selection.items.some((x) => x.track === track && x.id === id);
  return selection.track === track && selection.id === id;
}
export function makeSelection(items) {
  if (!items.length) return null;
  if (items.length === 1) return { ...items[0] };
  return { ...items[0], items };
}
