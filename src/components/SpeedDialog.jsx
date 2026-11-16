import React, { useState } from 'react';
import { Gauge } from '../icons.jsx';
import { formatTime } from '../store.js';
import { clipDuration, hasCurve } from '../speedCurve.js';
import { useT } from '../i18n/index.jsx';

// Speed / Duration for one clip (clip menu): the clip's constant speed, edited either as
// a percentage or as the timeline duration it should end up with. This is NOT speed
// ramping — the whole clip plays at the one rate, exactly like the inspector's Speed tab.
// A linked audio partner follows automatically (the store keeps pairs in sync).
// A clip WITH a speed curve: applying here replaces the curve with the constant rate
// (the store enforces it); the duration field starts from the curve's real duration.
const PRESETS = [25, 50, 75, 100, 125, 150, 200, 400];
// Speed range 0.1–100x (spec matrix) + named presets from src/gapB.js.
const clampSpeed = (s) => Math.min(100, Math.max(0.1, s));
const NAMED_PRESETS = [
  { id: 'montage', label: 'Montage', pct: 400 },
  { id: 'hero', label: 'Hero', pct: 50 },
  { id: 'bullet', label: 'Bullet', pct: 1000 },
];

export default function SpeedDialog({ clip, name, onApply, onClose }) {
  const t = useT();
  const sourceLen = (clip.out - clip.in); // seconds of source the clip plays
  const curved = hasCurve(clip);
  const cur = clip.speed || 1;
  const [pct, setPct] = useState(Math.round(cur * 100));
  const [dur, setDur] = useState((curved ? clipDuration(clip) : sourceLen / cur).toFixed(2));
  const speed = clampSpeed((Number(pct) || 100) / 100);

  const setFromPct = (v) => {
    setPct(v);
    const s = clampSpeed((Number(v) || 100) / 100);
    setDur((sourceLen / s).toFixed(2));
  };
  const setFromDur = (v) => {
    setDur(v);
    const d = Number(v);
    if (d > 0.01) setPct(Math.round((sourceLen / d) * 100));
  };

  return (
    <div className="modal-backdrop close-backdrop" role="dialog" aria-modal="true" aria-label={t('spd.speedDuration')}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-icon"><Gauge size={26} /></div>
        <h3>{t('spd.title')}</h3>
        <p className="muted">{name}</p>
        <div className="speed-presets" role="group" aria-label={t('spd.presets')}>
          {PRESETS.map((p) => (
            <button key={p} className={`chip ${Number(pct) === p ? 'on' : ''}`} onClick={() => setFromPct(p)}>{p}%</button>
          ))}
        </div>
        <div className="speed-presets" role="group" aria-label="Named speed presets">
          {NAMED_PRESETS.map((p) => (
            <button key={p.id} className={`chip ${Number(pct) === p.pct ? 'on' : ''}`} title={`${p.label} — ${p.pct / 100}×`} onClick={() => setFromPct(p.pct)}>{p.label} {p.pct / 100}×</button>
          ))}
        </div>
        <label className="field">
          <span>{t('spd.speedPct')}</span>
          <input type="number" min="10" max="10000" step="5" value={pct} aria-label={t('spd.speedPercent')}
            onChange={(e) => setFromPct(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('spd.durationLabel')}</span>
          <input type="number" min="0.1" step="0.1" value={dur} aria-label={t('spd.durationSeconds')}
            onChange={(e) => setFromDur(e.target.value)} />
        </label>
        <p className="muted">
          {t('spd.sourceUsed', { a: formatTime(sourceLen), b: formatTime(sourceLen / speed) })}
          {clip.linkId ? t('spd.linkedFollows') : ''}
        </p>
        {curved && (
          <p className="muted">{t('spd.curveNote')}</p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => { onApply(speed); onClose(); }}>{t('spd.apply')}</button>
        </div>
      </div>
    </div>
  );
}
