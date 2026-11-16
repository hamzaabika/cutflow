import React, { useRef, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import { libName } from '../i18n/libNames.js';
import { Trash2 } from '../icons.jsx';
import { alignKeys, baseAt, cloneKeys, copyKeyframes, copyMotion, getKeyframeClipboard, getMotionClipboard, KEY_PROPS, localTime, mirrorKeys, moveKey, pasteKeyframes, pasteMotion, randomizeKeys, removeKeys, reverseKeys, setKey, shiftKeys } from '../anim.js';

// Keyframe graph (Inspector ▸ Video ▸ Keyframe graph): the selected picture clip's transform /
// opacity keyframes drawn as value-over-time curves — one property lane at a time. The drawn
// line is sampled from baseAt, so it shows the TRUE eased motion (including the segment easing
// the CurveEditor sets), not straight lines between points. Points drag in time and value
// (the store's gesture wrapper makes a whole drag one undo step); Shift-click selects several
// points and drags them together; double-click on empty space adds a keyframe there; Delete
// removes the selection. All edits go through anim.js (setKey / moveKey / removeKeys), so the
// preview and the export (motionCurves samples the same stateAt) agree by construction.

const W = 264;
const H = 110;
const PX0 = 8;
const PX1 = 256;
const PY0 = 8;
const PY1 = 92;

const PROPS = {
  scale: { min: 0, max: 2, fmt: (v) => `${Math.round(v * 100)}%` },
  x: { min: -0.5, max: 0.5, fmt: (v, Wd) => `${Math.round(v * Wd)}px` },
  y: { min: -0.5, max: 0.5, fmt: (v, _Wd, Ht) => `${Math.round(v * Ht)}px` },
  rot: { min: -180, max: 180, fmt: (v) => `${Math.round(v)}°` },
  opacity: { min: 0, max: 1, fmt: (v) => `${Math.round(v * 100)}%` },
};
const PROP_LABEL = { scale: 'lib.prop.scale', x: 'X', y: 'Y', rot: 'lib.prop.rotation', opacity: 'lib.prop.opacity' };
const propLabel = (p) => (PROP_LABEL[p].startsWith('lib.') ? libName('prop', p, p) : PROP_LABEL[p]);

export default function KeyframeGraph({ clip, len, fps, W: Wd, H: Ht, lt, set, dispatch }) {
  const t = useT();
  const svgRef = useRef(null);
  const [prop, setProp] = useState(() => KEY_PROPS.find((p) => clip.keyframes?.[p]?.length) || 'scale');
  const [sel, setSel] = useState([]);
  const length = Math.max(0.01, len || 0);
  const def = PROPS[prop];
  const keys = [...(clip.keyframes?.[prop] || [])].sort((a, b) => a.t - b.t);
  const pts = keys.map((k) => ({ lt: localTime(clip, k.t), v: k.v, e: k.e }));
  let lo = def.min;
  let hi = def.max;
  for (const k of keys) { lo = Math.min(lo, k.v); hi = Math.max(hi, k.v); }
  const pad = Math.max((hi - lo) * 0.15, 1e-6);
  lo -= pad;
  hi += pad;
  const X = (ltv) => PX0 + (Math.min(length, Math.max(0, ltv)) / length) * (PX1 - PX0);
  const Y = (v) => PY1 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (PY1 - PY0);
  const vFromY = (y) => lo + ((PY1 - y) / (PY1 - PY0)) * (hi - lo);
  const fmt = (v) => def.fmt(v, Wd, Ht);

  // The true motion: sample baseAt across the clip so eased segments draw as curves.
  const N = 80;
  const curve = Array.from({ length: N + 1 }, (_, i) => {
    const ltv = (i / N) * length;
    return `${i ? 'L' : 'M'}${X(ltv).toFixed(1)},${Y(baseAt(clip, ltv)[prop]).toFixed(1)}`;
  }).join(' ');

  const fromEvent = (e) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return null;
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    return {
      lt: Math.min(length, Math.max(0, ((fx * W - PX0) / (PX1 - PX0)) * length)),
      v: Math.min(hi, Math.max(lo, vFromY(fy * H))),
    };
  };

  const startDrag = (i) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    const next = e.shiftKey ? (sel.includes(i) ? sel : [...sel, i]) : [i];
    setSel(next);
    const anchor = fromEvent(e);
    if (!anchor) return;
    // Snapshot the dragged points; neighbours that stay put bound each point's travel so
    // keys cannot cross each other mid-drag.
    const work0 = next.map((j) => ({ ...pts[j] }));
    const bounds = next.map((j) => {
      const prev = [...pts.slice(0, j)].reverse().find((_, k) => !next.includes(j - 1 - k));
      const after = pts.slice(j + 1).find((_, k) => !next.includes(j + 1 + k));
      return { lo: prev ? prev.lt + 0.02 : 0, hi: after ? after.lt - 0.02 : length };
    });
    dispatch({ type: 'beginGesture' });
    const move = (ev) => {
      const pos = fromEvent(ev);
      if (!pos) return;
      const dt = pos.lt - anchor.lt;
      const dv = pos.v - anchor.v;
      let work = clip;
      next.forEach((j, k) => {
        const nlt = Math.min(bounds[k].hi, Math.max(bounds[k].lo, work0[k].lt + dt));
        const nv = Math.min(hi, Math.max(lo, work0[k].v + dv));
        work = { ...work, ...moveKey(work, prop, work0[k].lt, nlt, nv, fps) };
      });
      set({ keyframes: work.keyframes });
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
    if (!pos) return;
    set(setKey(clip, prop, pos.lt, pos.v, fps));
    const after = [...pts, { lt: pos.lt, v: pos.v }].sort((a, b) => a.lt - b.lt);
    setSel([after.findIndex((p) => Math.abs(p.lt - pos.lt) < 1e-6)]);
  };

  const deleteSel = () => {
    if (!sel.length) return;
    let work = clip;
    let patch = {};
    for (const j of sel) {
      const p = removeKeys(work, [prop], pts[j].lt, fps);
      patch = { ...patch, ...p };
      work = { ...work, ...p };
    }
    set(patch);
    setSel([]);
  };

  const selPt = sel.length ? pts[sel[0]] : null;
  // Keyframe actions (P2-08): bulk edits on the current lane, or on all
  // properties when "All" is on. Each is one dispatch = one undo step.
  const [scopeAll, setScopeAll] = useState(false);
  const [actMsg, setActMsg] = useState('');
  const actProps = scopeAll ? KEY_PROPS : [prop];
  const doAct = (label, fn) => {
    const patch = fn();
    if (!patch) { setActMsg(t('prim.kfNothing', { label })); return; }
    set(patch);
    setActMsg(label);
  };
  const canPaste = !!getKeyframeClipboard();
  const actBtn = (label, title, onClick, disabled = false) => (
    <button key={label} type="button" className="chip" title={title} disabled={disabled} onClick={onClick}>{label}</button>
  );
  return (
    <div className="kg-editor" onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); deleteSel(); } }}>
      <div className="kg-actions" role="group" aria-label={t('prim.kfActions')}>
        <span className="dim small">{t('prim.kfActionsLabel')}</span>
        <button type="button" className={`chip ${scopeAll ? '' : 'on'}`} title={t('prim.kfLaneOnly')} onClick={() => setScopeAll(false)}>{propLabel(prop)}</button>
        <button type="button" className={`chip ${scopeAll ? 'on' : ''}`} title={t('prim.kfAllProps')} onClick={() => setScopeAll(true)}>{t('prim.kfAll')}</button>
        {actBtn(t('prim.kfCopy'), t('prim.kfCopyTitle'), () => { const d = copyKeyframes(clip, actProps); setActMsg(d ? t('prim.kfCopied') : t('prim.kfCopyEmpty')); })}
        {actBtn(t('prim.kfPaste'), t('prim.kfPasteTitle'), () => doAct(t('prim.kfPasted'), () => pasteKeyframes(clip, getKeyframeClipboard(), lt ?? 0)), !canPaste)}
        {actBtn(t('prim.kfCopyMotion'), t('prim.kfCopyMotionTitle'), () => { const d = copyMotion(clip); setActMsg(d ? t('prim.kfMotionCopied') : t('prim.kfCopyEmpty')); })}
        {actBtn(t('prim.kfPasteMotion'), t('prim.kfPasteMotionTitle'), () => doAct(t('prim.kfMotionPasted'), () => pasteMotion(clip, getMotionClipboard(), lt ?? 0)), !getMotionClipboard())}
        {actBtn(t('prim.kfMirror'), t('prim.kfMirrorTitle'), () => doAct(t('prim.kfMirrored'), () => mirrorKeys(clip, actProps)))}
        {actBtn(t('prim.kfReverse'), t('prim.kfReverseTitle'), () => doAct(t('prim.kfReversed'), () => reverseKeys(clip, actProps)))}
        {actBtn(t('prim.kfClone'), t('prim.kfCloneTitle'), () => doAct(t('prim.kfCloned'), () => cloneKeys(clip, actProps, 0.5)))}
        {actBtn(t('prim.kfShiftBack'), t('prim.kfShiftBackTitle'), () => doAct(t('prim.kfShiftedBack'), () => shiftKeys(clip, actProps, -0.1)))}
        {actBtn(t('prim.kfShiftFwd'), t('prim.kfShiftFwdTitle'), () => doAct(t('prim.kfShiftedFwd'), () => shiftKeys(clip, actProps, 0.1)))}
        {actBtn(t('prim.kfRandomize'), t('prim.kfRandomizeTitle'), () => doAct(t('prim.kfRandomized'), () => randomizeKeys(clip, actProps, 0.3, 7)))}
        {actBtn(t('prim.kfAlign'), t('prim.kfAlignTitle'), () => doAct(t('prim.kfAligned'), () => alignKeys(clip, actProps, lt ?? 0)))}
        {actMsg && <span className="dim small" role="status">{actMsg}</span>}
      </div>
      <div className="chips" role="tablist" aria-label={t('ci.keyGraph')}>
        {KEY_PROPS.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={prop === p} className={`chip ${prop === p ? 'on' : ''} ${!(clip.keyframes?.[p]?.length) ? 'dim' : ''}`}
            onClick={() => { setProp(p); setSel([]); }}>{propLabel(p)}</button>
        ))}
      </div>
      <svg ref={svgRef} className="kg-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('ci.keyGraph')}
        onDoubleClick={addPoint} tabIndex={0}>
        <line x1={PX0} x2={PX1} y1={Y(0)} y2={Y(0)} className="kg-grid" />
        {lt !== null && lt !== undefined && (
          <line x1={X(lt)} x2={X(lt)} y1={PY0} y2={PY1} className="kg-playhead" />
        )}
        <path d={curve} className="kg-line" fill="none" />
        {pts.map((p, i) => (
          <circle key={i} cx={X(p.lt)} cy={Y(p.v)} r={sel.includes(i) ? 5 : 4}
            className={`kg-pt ${sel.includes(i) ? 'on' : ''}`} onPointerDown={startDrag(i)} />
        ))}
        <text x={PX0} y={H - 2} className="kg-axis">0s</text>
        <text x={PX1} y={H - 2} className="kg-axis" textAnchor="end">{length.toFixed(1)}s</text>
      </svg>
      {selPt ? (
        <div className="kg-readout">
          <span className="dim small">{propLabel(prop)} · {selPt.lt.toFixed(2)}s · {fmt(selPt.v)}{sel.length > 1 ? ` · ${t('ci.keyGraphSel', { n: sel.length })}` : ''}</span>
          <button type="button" className="icon-btn sm" aria-label={t('ci.keyGraphDelete')} title={t('ci.keyGraphDelete')} onClick={deleteSel}>
            <Trash2 size={13} />
          </button>
        </div>
      ) : (
        <p className="dim small">{t('ci.keyGraphNote')}</p>
      )}
    </div>
  );
}
