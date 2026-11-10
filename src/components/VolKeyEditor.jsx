import React, { useRef, useState } from 'react';
import { Trash2 } from '../icons.jsx';
import { formatTime } from '../store.js';
import { sourceOffsetAt } from '../speedCurve.js';
import {
  hasVolKeys, normalizeVolKeys, upsertVolKey, volKeyLocalPoints, volumeAt,
} from '../volKeys.js';
import NumBox from './NumBox.jsx';

// Volume keyframe editor (Inspector ▸ Audio, Sprint 10): the clip's gain
// ride drawn over its TIMELINE length — x is seconds from the clip's start,
// y is gain 0..2 (linear). Points drag freely (the store's gesture wrapper
// makes a whole drag one undo step), a double-click on the graph adds a
// point at the gain the clip currently has there, and the same points ride
// on the timeline's volume line. The data is clip.volKeys; src/volKeys.js
// is the only place it is interpreted, and the preview and the export read
// the same trace (clipGainAt / volkeys.cjs), so what is drawn here is what
// plays and what renders. Fades are separate sliders — they multiply after
// this curve, in preview and export alike.

const W = 264;
const H = 106;
const PX0 = 10;
const PX1 = 254;
const PY0 = 10;
const PY1 = 86;
const X = (lt, len) => PX0 + (len > 0 ? lt / len : 0) * (PX1 - PX0);
const Y = (v) => PY1 - (Math.min(2, Math.max(0, v)) / 2) * (PY1 - PY0);
const round2 = (v) => Math.round(v * 100) / 100;

export default function VolKeyEditor({ clip, len, set, dispatch, playheadLt = null }) {
  const svgRef = useRef(null);
  const [sel, setSel] = useState(null); // index into the local points
  const keyed = hasVolKeys(clip);
  const points = keyed ? volKeyLocalPoints(clip) : []; // [{ t (source), lt, v }]
  const base = clip.volume ?? 1;

  const commitLocal = (localPts) => {
    const volKeys = localPts.map((p) => ({ t: (clip.in || 0) + sourceOffsetAt(clip, Math.min(len, Math.max(0, p.lt))), v: p.v }));
    set({ volKeys: normalizeVolKeys({ ...clip, volKeys }) });
  };

  const seed = () => {
    let keys = upsertVolKey(clip, 0, base);
    keys = upsertVolKey({ ...clip, volKeys: keys }, len, base);
    set({ volKeys: keys });
    setSel(null);
  };

  const addAtPlayhead = () => {
    if (playheadLt == null || playheadLt < 0 || playheadLt > len) return;
    const keys = upsertVolKey(clip, playheadLt, volumeAt(clip, playheadLt));
    set({ volKeys: keys });
  };

  const removeAll = () => { setSel(null); set({ volKeys: undefined }); };

  const fromEvent = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    return {
      lt: ((fx * W - PX0) / (PX1 - PX0)) * len,
      v: 2 * (1 - (fy * H - PY0) / (PY1 - PY0)),
    };
  };

  const startDrag = (i) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    setSel(i);
    const work = points.map((p) => ({ ...p }));
    dispatch({ type: 'beginGesture' });
    const move = (ev) => {
      const pos = fromEvent(ev);
      if (!pos || !work[i]) return;
      const prev = work[i - 1];
      const next = work[i + 1];
      const isEnd = i === 0 || i === work.length - 1;
      const lt = isEnd
        ? work[i].lt
        : Math.min((next ? next.lt : len) - 0.02, Math.max((prev ? prev.lt : 0) + 0.02, pos.lt));
      work[i] = { ...work[i], lt, v: round2(Math.min(2, Math.max(0, pos.v))) };
      commitLocal(work);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dispatch({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addPoint = (e) => {
    const pos = fromEvent(e);
    if (!pos || pos.lt <= 0.01 || pos.lt >= len - 0.01) return;
    const keys = upsertVolKey(clip, Math.round(pos.lt * 1000) / 1000, round2(Math.min(2, Math.max(0, pos.v))));
    set({ volKeys: keys });
  };

  const deleteSel = () => {
    if (sel == null) return;
    commitLocal(points.filter((_, i) => i !== sel));
    setSel(null);
  };

  if (!keyed) {
    return (
      <div className="sc-editor">
        <p className="dim small">Flat at {Math.round(base * 100)}%. Add volume keyframes to ride the level inside the clip — a dip under speech, a swell into a chorus.</p>
        <div className="chips">
          <button className="chip" onClick={seed}>Add keyframes</button>
          {playheadLt != null && playheadLt >= 0 && playheadLt <= len && (
            <button className="chip" onClick={addAtPlayhead}>Add at playhead</button>
          )}
        </div>
      </div>
    );
  }

  const linePts = [{ lt: 0, v: volumeAt(clip, 0) }, ...points, { lt: len, v: volumeAt(clip, len) }]
    .filter((p, i, a) => i === 0 || Math.abs(p.lt - a[i - 1].lt) > 1e-6);
  const path = linePts.map((p, i) => `${i ? 'L' : 'M'}${X(p.lt, len).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const fill = `${path} L${X(len, len).toFixed(1)},${PY1} L${PX0},${PY1} Z`;
  const selPt = sel != null ? points[sel] : null;

  return (
    <div className="sc-editor">
      <svg ref={svgRef} className="sc-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Volume keyframes"
        onDoubleClick={addPoint}>
        <line x1={PX0} x2={PX1} y1={Y(1)} y2={Y(1)} className="sc-grid" />
        <text x={PX1} y={Y(1) - 3} className="sc-axis" textAnchor="end">100%</text>
        <path d={fill} className="sc-fill" />
        <path d={path} className="sc-line" fill="none" />
        {points.map((p, i) => (
          <circle key={p.t} cx={X(p.lt, len)} cy={Y(p.v)} r={i === sel ? 5 : 4}
            className={`sc-pt ${i === sel ? 'on' : ''}`} onPointerDown={startDrag(i)} />
        ))}
        <text x={PX0} y={H - 2} className="sc-axis">clip {formatTime(len)}</text>
        <text x={PX1} y={H - 2} className="sc-axis" textAnchor="end">gain 0–200%</text>
      </svg>
      {selPt ? (
        <div className="sc-readout">
          <span className="dim small">At {selPt.lt.toFixed(2)} s into the clip</span>
          <NumBox label="Gain" suffix="%" step={5} min={0} max={200} precision={0}
            value={Math.round(selPt.v * 100)} ariaLabel="Point gain percent"
            onDragStart={() => dispatch({ type: 'beginGesture' })}
            onDragEnd={() => dispatch({ type: 'endGesture' })}
            onChange={(v) => commitLocal(points.map((p, i) => (i === sel ? { ...p, v: v / 100 } : p)))} />
          <button className="icon-btn sm" aria-label="Delete point" title="Delete point" onClick={deleteSel}><Trash2 size={13} /></button>
        </div>
      ) : (
        <p className="dim small">Drag the points to shape the ride. Double-click the graph to add a point.</p>
      )}
      <div className="row">
        {playheadLt != null && playheadLt >= 0 && playheadLt <= len && (
          <button className="btn btn-sm btn-ghost" onClick={addAtPlayhead}>Add at playhead</button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={removeAll}>Remove all keyframes</button>
      </div>
      <p className="dim small">Preview and export read this same curve; the fades below multiply after it.</p>
    </div>
  );
}
