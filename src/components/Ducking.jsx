// Standalone music ducking (FB-07, P1-12): the music clip's own ducking
// under dialogue — amount, fade, sensitivity — plus its duck keyframes.
// Hosted on audio-track clips (Inspector + ClipInspector audio tab). The
// keyframes shown are the ones the export will render: derived from the
// live dialogue spans, or the clip's manual duckKeys once the user pins
// them by dragging a gain (Regenerate re-derives, Clear goes back to derived).
import React from 'react';
import { useT } from '../i18n/index.jsx';
import KitToggle from '../ui/Toggle.jsx';
import { videoLayout } from '../store.js';
import { normalizeDuck, dialogueSpans, duckKeysFromSpans, duckDisplayPoints } from '../fx/ducking.js';

const Row = ({ label, children }) => (
  <div className="afx-row">
    <span className="afx-label">{label}</span>
    <span className="afx-ctl">{children}</span>
  </div>
);
const Range = ({ value, min, max, step = 1, fmt, onChange, aria }) => (
  <>
    <input type="range" min={min} max={max} step={step} value={value} aria-label={aria || 'value'}
      onChange={(e) => onChange(Number(e.target.value))} />
    <span className="afx-val">{fmt ? fmt(value) : value}</span>
  </>
);

export default function DuckingControls({ clip, project, set }) {
  const t = useT();
  const d = normalizeDuck(clip.duck);
  const videoStart = (id) => videoLayout(project.videoClips).find((l) => l.clip.id === id)?.start;
  const spans = dialogueSpans(project.videoClips, project.audioClips, videoStart)
    .filter((s) => s.id !== clip.id);
  const points = duckDisplayPoints(clip, spans);
  const manual = Array.isArray(clip.duckKeys) && clip.duckKeys.length > 0;
  const setDuck = (patch) => set({ duck: { ...d, ...patch } });
  const setKeyGain = (tSrc, v) => {
    const keys = (manual ? clip.duckKeys : duckKeysFromSpans(spans, clip, d))
      .map((p) => (Math.abs(p.t - tSrc) < 0.001 ? { ...p, v: Math.min(1, Math.max(0.05, Math.round(v * 100) / 100)) } : p));
    set({ duckKeys: keys });
  };
  return (
    <div className="afx">
      <label className="field row">
        <span>{t('duck.title')}</span>
        <KitToggle checked={d.on} aria-label={t('duck.title')}
          onChange={(e) => setDuck({ on: e.target.checked })} />
      </label>
      {d.on && (
        <>
          <Row label={t('duck.amount')}>
            <Range value={d.to} min={0.05} max={0.9} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
              aria={t('duck.amount')} onChange={(to) => setDuck({ to })} />
          </Row>
          <Row label={t('duck.fade')}>
            <Range value={d.fade} min={0.05} max={1} step={0.05} fmt={(v) => `${v.toFixed(2)}s`}
              aria={t('duck.fade')} onChange={(fade) => setDuck({ fade })} />
          </Row>
          <Row label={t('duck.sensitivity')}>
            <Range value={d.sensitivity} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
              aria={t('duck.sensitivity')} onChange={(sensitivity) => setDuck({ sensitivity })} />
          </Row>
          <div className="afx-group-title">{t('duck.keys')}</div>
          {!spans.length && !points.length && <div className="afx-note">{t('duck.noSpans')}</div>}
          {points.map((p) => (
            <Row key={p.t} label={`@${p.lt.toFixed(2)}s`}>
              <Range value={p.v} min={0.05} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
                aria={t('duck.keyGainAria')} onChange={(v) => setKeyGain(p.t, v)} />
            </Row>
          ))}
          <div className="afx-note">{manual ? t('duck.manual') : t('duck.derived')}</div>
          {manual && (
            <div className="afx-applied">
              <button type="button" className="btn btn-sm" onClick={() => set({ duckKeys: duckKeysFromSpans(spans, clip, d) })}>{t('duck.regenerate')}</button>
              <button type="button" className="btn btn-sm" onClick={() => set({ duckKeys: [] })}>{t('duck.clearManual')}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
