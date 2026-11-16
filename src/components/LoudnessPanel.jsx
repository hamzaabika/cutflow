// Live LUFS panel (B-F19): the timeline's loudness as a real EBU R128
// measurement, not a peak meter. The main process renders the timeline's
// mixed audio and runs ebur128 over it; the panel draws the momentary
// loudness curve, the export target line, and the playhead — the readout
// follows playback (the curve is measured, the playhead is live). Click the
// graph to seek. Analyse runs on open and on Re-analyse; edits after that
// need a re-analyse (the button says so).
import React, { useEffect, useRef, useState } from 'react';
import { Gauge, RefreshCw } from '../icons.jsx';
import { sampleAt } from '../loudnessReport.js';
import { useT } from '../i18n/index.jsx';

const fmt1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '—');

export default function LoudnessPanel({ project, time, duration, targetI, onSeek, onClose }) {
  const t = useT();
  const [curve, setCurve] = useState(null);
  const [state, setState] = useState('idle'); // idle | analysing | error | empty
  const [error, setError] = useState('');
  const canvasRef = useRef(null);
  const runRef = useRef(0);

  const analyse = async () => {
    const run = ++runRef.current;
    setState('analysing');
    setError('');
    try {
      const res = await window.api.loudnessCurve(project);
      if (run !== runRef.current) return;
      if (!res || !res.ok) throw new Error(res?.error || 'loudnessCurve failed');
      if (!res.curve) { setCurve(null); setState('empty'); return; }
      setCurve(res.curve);
      setState('done');
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e.message || String(e));
      setState('error');
    }
  };
  useEffect(() => { analyse(); return () => { runRef.current++; }; }); // eslint-disable-line react-hooks/exhaustive-deps

  const at = sampleAt(curve, time);
  const dur = Math.max(duration || 0, curve?.duration || 0, 0.1);

  // The graph: momentary loudness (M) over time, the export target as a
  // dashed line, the playhead as a solid line. Scale -60..0 LUFS.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !curve) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const padL = 34;
    const padR = 8;
    const padT = 8;
    const padB = 18;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const yOf = (lufs) => padT + (1 - Math.min(1, Math.max(0, (lufs + 60) / 60))) * plotH;
    const xOf = (s) => padL + (s / dur) * plotW;
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillStyle = '#8b8fa3';
    for (const lv of [0, -14, -23, -40, -60]) g.fillText(lv === 0 ? '0' : `${lv}`, padL - 5, yOf(lv) + 3);
    g.textAlign = 'center';
    for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
      const s = dur * frac;
      g.fillText(`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`, xOf(s), H - 5);
    }
    // Target line (the export's loudness target, when mastering is on).
    if (Number.isFinite(targetI)) {
      g.strokeStyle = '#e8b13c';
      g.setLineDash([5, 4]);
      g.beginPath();
      g.moveTo(padL, yOf(targetI));
      g.lineTo(W - padR, yOf(targetI));
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'left';
      g.fillStyle = '#e8b13c';
      g.fillText(`${t('lufs.target')} ${fmt1(targetI)}`, padL + 4, yOf(targetI) - 4);
    }
    // Momentary curve.
    g.strokeStyle = '#35c26e';
    g.lineWidth = 1.5;
    g.beginPath();
    let started = false;
    for (const s of curve.samples) {
      if (s.m == null) continue;
      const x = xOf(s.t);
      const y = yOf(s.m);
      if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
    }
    g.stroke();
    // Playhead.
    g.strokeStyle = '#e8e9f2';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(xOf(time), padT);
    g.lineTo(xOf(time), H - padB);
    g.stroke();
  }, [curve, time, dur, targetI, t]);

  const seekFromClick = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !curve || !onSeek) return;
    const rect = canvas.getBoundingClientRect();
    const padL = 34;
    const padR = 8;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left - padL) / (rect.width - padL - padR)));
    onSeek(frac * dur);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('lufs.title')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card lufs-dialog">
        <div className="modal-head">
          <h2><Gauge size={16} /> {t('lufs.title')}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>✕</button>
        </div>
        <p className="dim small">{t('lufs.intro')}</p>
        <div className="lufs-readout" aria-live="polite">
          <span>{t('lufs.momentary')}: <strong>{at && at.m != null ? `${fmt1(at.m)} LUFS` : '—'}</strong></span>
          <span>{t('lufs.shortTerm')}: <strong>{at && at.s != null ? `${fmt1(at.s)} LUFS` : '—'}</strong></span>
          <span>{t('lufs.integrated')}: <strong>{curve ? `${fmt1(curve.integrated)} LUFS` : '—'}</strong></span>
          <span>{t('lufs.truePeak')}: <strong>{curve ? `${fmt1(curve.truePeak)} dBTP` : '—'}</strong></span>
        </div>
        {state === 'analysing' && <p className="dim small">{t('lufs.analysing')}</p>}
        {state === 'error' && <p className="dim small" role="alert">{t('lufs.error', { e: error })}</p>}
        {state === 'empty' && <p className="dim small">{t('lufs.empty')}</p>}
        {curve && (
          <canvas ref={canvasRef} className="lufs-graph" height={180} onClick={seekFromClick}
            role="img" aria-label={t('lufs.graphAria')} />
        )}
        <div className="lufs-foot">
          <button type="button" className="btn btn-sm" onClick={analyse} disabled={state === 'analysing'}>
            <RefreshCw size={13} /> {t('lufs.reanalyse')}
          </button>
          <span className="dim small">{t('lufs.staleNote')}</span>
        </div>
      </div>
    </div>
  );
}
