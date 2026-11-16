// Timeline lane overlays, split out of src/components/Timeline.jsx by the
// A-F7 module-size guard. Both are pure render components: they take their
// clip, geometry and callbacks as props and own no timeline state.
import { clipGainAt, volKeyLocalPoints } from '../volKeys.js';
import { tr } from '../i18n/index.jsx';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Fade handles (AU-03): a triangle at each top corner of an audio clip —
// drag it sideways (or nudge it with the arrow keys) to set that fade's
// length. The handle sits on the fade's inner edge once the fade exists,
// and on the clip edge while the fade is zero, so a fade is always one
// drag away. Rendered for every sounding clip, not just ones that already
// have a fade or volume keys.
export function FadeHandles({ clip, len, pps, onDragFade, onKeyFade }) {
  if (!(len > 0)) return null;
  const W = Math.max(2, len * pps);
  const fi = Math.max(0, clip.fadeIn || 0);
  const fo = Math.max(0, clip.fadeOut || 0);
  const inX = clamp(Math.min(fi, len) * pps - 6, 0, W - 12);
  const outX = clamp(Math.max(0, len - Math.min(fo, len)) * pps - 6, 0, W - 12);
  return (
    <>
      <button type="button" className={`fade-handle fade-in ${fi > 0 ? 'on' : ''}`} style={{ left: inX }}
        title={tr('tl.fadeInTitle', { s: fi.toFixed(1) })} aria-label={tr('tl.fadeInAria', { s: fi.toFixed(1) })}
        onPointerDown={(e) => onDragFade(e, 'in')} onKeyDown={(e) => onKeyFade(e, 'in')} />
      <button type="button" className={`fade-handle fade-out ${fo > 0 ? 'on' : ''}`} style={{ left: outX }}
        title={tr('tl.fadeOutTitle', { s: fo.toFixed(1) })} aria-label={tr('tl.fadeOutAria', { s: fo.toFixed(1) })}
        onPointerDown={(e) => onDragFade(e, 'out')} onKeyDown={(e) => onKeyFade(e, 'out')} />
    </>
  );
}

// The volume line on a sounding clip (Sprint 10): the clip's effective gain
// trace — volume keyframes (or plain volume) times the fade envelope, the
// src/volKeys.js clipGainAt the preview plays and the export renders — drawn
// across the clip's foot. Keyframe points ride on it: drag one to move it in
// time and gain (one undo step), double-click one to remove it. FB-09: the
// fade-in/out handles ride on it too — squares at the fade boundaries (the
// clip edges when the fade is 0, so a fade can be created by dragging in).
// A fade handle drags horizontally only and writes clip.fadeIn/fadeOut (one
// undo step, clamped so the two fades never overlap); double-click clears
// that fade. The line itself never takes pointer events, so every existing
// clip gesture keeps the surface; only the points and handles are grabbable.
export function VolLine({ clip, len, pps, onDragPoint, onRemovePoint, onDragFade, onClearFade }) {
  if (!(len > 0)) return null;
  const H = 30;
  const W = Math.max(2, len * pps);
  const Y = (g) => H - (Math.min(2, Math.max(0, g)) / 2) * (H - 4) - 2;
  const keys = volKeyLocalPoints(clip).filter((k) => k.lt >= -1e-6 && k.lt <= len + 1e-6);
  const fi = Math.min(Math.max(0, clip.fadeIn || 0), len);
  const fo = Math.min(Math.max(0, clip.fadeOut || 0), len);
  const samples = [];
  const N = 24;
  for (let i = 0; i <= N; i++) samples.push((len * i) / N);
  for (const k of keys) samples.push(Math.min(len, Math.max(0, k.lt)));
  samples.sort((a, b) => a - b);
  const path = samples
    .map((lt, i) => `${i ? 'L' : 'M'}${(lt * pps).toFixed(1)},${Y(clipGainAt(clip, lt, len)).toFixed(1)}`)
    .join(' ');
  const fadeHandle = (which, t) => {
    const x = Math.min(len, Math.max(0, t)) * pps;
    const y = Y(clipGainAt(clip, t, len));
    const sec = (which === 'in' ? fi : fo).toFixed(2);
    return (
      <rect key={`fade-${which}`} x={x - 4} y={y - 4} width={8} height={8}
        className="vol-fade-handle" role="button"
        aria-label={tr(which === 'in' ? 'tl.fadeInHandleAria' : 'tl.fadeOutHandleAria', { sec })}
        onPointerDown={(e) => onDragFade?.(e, which)}
        onDoubleClick={(e) => { e.stopPropagation(); onClearFade?.(which); }}>
        <title>{tr(which === 'in' ? 'tl.fadeInHandleTitle' : 'tl.fadeOutHandleTitle')}</title>
      </rect>
    );
  };
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
      {fadeHandle('in', fi)}
      {fadeHandle('out', len - fo)}
    </svg>
  );
}
