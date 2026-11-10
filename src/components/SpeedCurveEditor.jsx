import React, { useRef, useState } from 'react';
import { Trash2 } from '../icons.jsx';
import { formatTime } from '../store.js';
import {
  CURVE_MAX_SPEED, CURVE_MIN_SPEED, SPEED_PRESETS, averageSpeed, clipDuration,
  hasCurve, normalizePoints, presetPoints, speedAtSource, timelineOffsetAt,
} from '../speedCurve.js';
import NumBox from './NumBox.jsx';

// Speed curve editor (Inspector ▸ Speed): the clip's playback rate drawn as a
// graph over its SOURCE window — x is source seconds from the clip's in-point,
// y is the rate on a log scale. Points drag freely (the store's gesture wrapper
// makes a whole drag one undo step), a double-click on the graph adds a point,
// and the presets seed honest ramps from the clip's constant rate. The data is
// clip.speedCurve; src/speedCurve.js is the only place it is interpreted, and
// the preview and the export read the same map, so what is drawn here is what
// plays and what renders.

const W = 264;
const H = 106;
const PX0 = 10;
const PX1 = 254;
const PY0 = 10;
const PY1 = 86;
const LOG_MIN = Math.log(CURVE_MIN_SPEED);
const LOG_MAX = Math.log(CURVE_MAX_SPEED);
const X = (t, span) => PX0 + (span > 0 ? t / span : 0) * (PX1 - PX0);
const Y = (s) => PY1 - ((Math.log(Math.min(CURVE_MAX_SPEED, Math.max(CURVE_MIN_SPEED, s))) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (PY1 - PY0);
const speedFromY = (y) => Math.exp(LOG_MIN + ((PY1 - y) / (PY1 - PY0)) * (LOG_MAX - LOG_MIN));
const round2 = (v) => Math.round(v * 100) / 100;

export default function SpeedCurveEditor({ clip, set, dispatch }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null); // index into points while dragging
  const [sel, setSel] = useState(null); // index into the stored points
  const span = Math.max(0, (clip.out || 0) - (clip.in || 0));
  const base = clip.speed || 1;
  const curved = hasCurve(clip);
  const points = curved ? normalizePoints(clip.speedCurve.points, span) : [];
  const dur = clipDuration(clip);

  const commit = (pts) => set({ speedCurve: { points: normalizePoints(pts, span) } });

  const applyPreset = (preset) => {
    setSel(null);
    set({ speedCurve: { points: presetPoints(preset, span, base) } });
  };

  const seedFlat = () => {
    const pts = [{ t: 0, speed: base }, { t: span / 2, speed: base }, { t: span, speed: base }];
    setSel(1);
    commit(pts);
  };

  const removeCurve = () => {
    setSel(null);
    // Keep the timeline length the curve produced: the constant rate that
    // preserves it replaces the curve (one undo step, like every edit here).
    set({ speedCurve: undefined, speed: Math.round(averageSpeed(clip) * 1000) / 1000 });
  };

  const fromEvent = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    return { t: (fx * W - PX0) / (PX1 - PX0) * span, s: speedFromY(fy * H) };
  };

  const startDrag = (i) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    setSel(i);
    // The drag works on the point list as it was when the pointer went down
    // (the RegionOverlay pattern): indices stay stable for the whole gesture,
    // values come from the pointer position, and the store's gesture wrapper
    // folds every move into the one undo step endGesture records.
    const work = points.map((p) => ({ ...p }));
    dragRef.current = work;
    dispatch({ type: 'beginGesture' });
    const move = (ev) => {
      const pos = fromEvent(ev);
      if (!pos || !work[i]) return;
      const prev = work[i - 1];
      const next = work[i + 1];
      const isEnd = i === 0 || i === work.length - 1;
      const t = isEnd
        ? work[i].t
        : Math.min((next ? next.t : span) - 0.02, Math.max((prev ? prev.t : 0) + 0.02, pos.t));
      work[i] = { t, speed: round2(Math.min(CURVE_MAX_SPEED, Math.max(CURVE_MIN_SPEED, pos.s))) };
      set({ speedCurve: { points: work.map((p) => ({ ...p })) } });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      dragRef.current = null;
      commit(work); // settle collinear points the drag may have created
      dispatch({ type: 'endGesture' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addPoint = (e) => {
    const pos = fromEvent(e);
    if (!pos || pos.t <= 0.01 || pos.t >= span - 0.01) return;
    const pts = [...points, { t: Math.round(pos.t * 1000) / 1000, speed: round2(speedAtSource(clip, pos.t)) }];
    const next = normalizePoints(pts, span);
    setSel(next.findIndex((p) => Math.abs(p.t - pos.t) < 0.01));
    commit(next);
  };

  const deleteSel = () => {
    if (sel == null || points.length <= 2) return;
    commit(points.filter((_, i) => i !== sel));
    setSel(null);
  };

  if (!curved) {
    return (
      <div className="sc-editor">
        <p className="dim small">Constant {base}×. Add a curve to vary the speed inside the clip — the sound follows the same curve.</p>
        <div className="chips">
          {SPEED_PRESETS.map((p) => (
            <button key={p.id} className="chip" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <button className="chip" onClick={seedFlat}>Custom curve…</button>
        </div>
      </div>
    );
  }

  // The drawn line runs through the stored points plus the sampler's effective
  // endpoints, so the graph shows exactly the rate the clip plays at.
  const linePts = [{ t: 0, speed: speedAtSource(clip, 0) }, ...points, { t: span, speed: speedAtSource(clip, span) }]
    .filter((p, i, a) => i === 0 || Math.abs(p.t - a[i - 1].t) > 1e-6);
  const path = linePts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t, span).toFixed(1)},${Y(p.speed).toFixed(1)}`).join(' ');
  const fill = `${path} L${X(span, span).toFixed(1)},${PY1} L${PX0},${PY1} Z`;
  const selPt = sel != null ? points[sel] : null;

  return (
    <div className="sc-editor">
      <svg ref={svgRef} className="sc-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Speed curve"
        onDoubleClick={addPoint}>
        <line x1={PX0} x2={PX1} y1={Y(1)} y2={Y(1)} className="sc-grid" />
        <text x={PX1} y={Y(1) - 3} className="sc-axis" textAnchor="end">1×</text>
        <path d={fill} className="sc-fill" />
        <path d={path} className="sc-line" fill="none" />
        {points.map((p, i) => (
          <circle key={i} cx={X(p.t, span)} cy={Y(p.speed)} r={i === sel ? 5 : 4}
            className={`sc-pt ${i === sel ? 'on' : ''}`} onPointerDown={startDrag(i)} />
        ))}
        <text x={PX0} y={H - 2} className="sc-axis">source {formatTime(span)}</text>
        <text x={PX1} y={H - 2} className="sc-axis" textAnchor="end">plays in {formatTime(dur)}</text>
      </svg>
      <div className="chips">
        {SPEED_PRESETS.map((p) => (
          <button key={p.id} className="chip" onClick={() => applyPreset(p)}>{p.label}</button>
        ))}
      </div>
      {selPt ? (
        <div className="sc-readout">
          <span className="dim small">
            At source {selPt.t.toFixed(2)} s · timeline {timelineOffsetAt(clip, selPt.t).toFixed(2)} s
          </span>
          <NumBox label="Speed" suffix="×" step={0.05} min={CURVE_MIN_SPEED} max={CURVE_MAX_SPEED} precision={2}
            value={selPt.speed} ariaLabel="Point speed"
            onDragStart={() => dispatch({ type: 'beginGesture' })}
            onDragEnd={() => dispatch({ type: 'endGesture' })}
            onChange={(v) => {
              const next = points.map((p, i) => (i === sel ? { ...p, speed: v } : p));
              commit(next);
            }} />
          <button className="icon-btn sm" aria-label="Delete point" title="Delete point"
            disabled={points.length <= 2} onClick={deleteSel}><Trash2 size={13} /></button>
        </div>
      ) : (
        <p className="dim small">Drag the points to shape the ramp. Double-click the graph to add a point.</p>
      )}
      <div className="row">
        <button className="btn btn-sm btn-ghost" onClick={removeCurve}>Remove curve (keeps the duration)</button>
      </div>
      <p className="dim small">Preview and export read this same curve; the clip's sound is retimed with it.{clip.linkId ? ' The linked partner follows.' : ''}</p>
    </div>
  );
}
