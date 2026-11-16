// Voice repair (FB-08, P1-17): the repair layer over a clip's sound —
// click removal, broadband denoise strength, mains-hum notch. It is an
// additive first layer (repair the source, then Clean Voice, then the
// clip's own audioFx) and never replaces volume, fades, Voice Enhance or
// audioFx. The monitor plays the original media against the repaired
// derivative, so the repair is heard before/after, not assumed.
import React, { useState } from 'react';
import { useT } from '../i18n/index.jsx';
import KitToggle from '../ui/Toggle.jsx';
import { toFileUrl } from '../store.js';
import { normalizeRepair } from '../fx/audioFxChain.js';
import { audioFxPathOf } from '../fx/audioFxPreview.js';

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

export default function VoiceRepairControls({ clip, media, set }) {
  const t = useT();
  const r = normalizeRepair(clip.repair);
  const [monitor, setMonitor] = useState('cleaned');
  const derivative = audioFxPathOf(clip, media);
  const setRepair = (patch) => set({ repair: { ...r, ...patch } });
  return (
    <div className="afx">
      <label className="field row">
        <span>{t('repair.on')}</span>
        <KitToggle checked={r.on} aria-label={t('repair.on')}
          onChange={(e) => setRepair({ on: e.target.checked })} />
      </label>
      {r.on && (
        <>
          <Row label={t('repair.declick')}>
            <KitToggle checked={r.declick} aria-label={t('repair.declick')}
              onChange={(e) => setRepair({ declick: e.target.checked })} />
          </Row>
          <Row label={t('repair.denoise')}>
            <Range value={r.denoise} min={0} max={1} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`}
              aria={t('repair.denoise')} onChange={(denoise) => setRepair({ denoise })} />
          </Row>
          <Row label={t('repair.hum')}>
            <select aria-label={t('repair.hum')} value={r.hum} onChange={(e) => setRepair({ hum: e.target.value })}>
              <option value="off">{t('repair.humOff')}</option>
              <option value="50">{t('repair.hum50')}</option>
              <option value="60">{t('repair.hum60')}</option>
              <option value="auto">{t('repair.humAuto')}</option>
            </select>
          </Row>
          <div className="afx-apply-modes" role="group" aria-label={t('repair.monitor')}>
            <button type="button" className={`afx-mode ${monitor === 'original' ? 'on' : ''}`}
              aria-pressed={monitor === 'original'} onClick={() => setMonitor('original')}>{t('repair.monitorOriginal')}</button>
            <button type="button" className={`afx-mode ${monitor === 'cleaned' ? 'on' : ''}`}
              aria-pressed={monitor === 'cleaned'} onClick={() => setMonitor('cleaned')}>{t('repair.monitorCleaned')}</button>
          </div>
          {monitor === 'original' && media?.path && (
            <audio controls preload="metadata" src={toFileUrl(media.path)} style={{ width: '100%' }} />
          )}
          {monitor === 'cleaned' && derivative && (
            <audio controls preload="metadata" src={toFileUrl(derivative)} style={{ width: '100%' }} />
          )}
          {monitor === 'cleaned' && !derivative && (
            <div className="afx-note">{t('repair.noRender')}</div>
          )}
        </>
      )}
    </div>
  );
}
