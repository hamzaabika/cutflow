// Track mixer (P2-23, AU-09) — Dialogue / Music / SFX / Ambience buses
// plus the master bus: gain in dB, mute and solo per bus. Pops over the
// timeline toolbar. Levels apply in preview (element volume) and export
// (bus volume filters + master stage) through src/mixer.js.
import React from 'react';
import { useT } from '../i18n/index.jsx';
import { AUDIO_ROLES, ROLE_NAMES, mixerOf, roleGainDb, masterGainDb } from '../mixer.js';

export default function MixerPanel({ project, dispatch, onClose }) {
  const t = useT();
  const mixer = mixerOf(project);
  const set = (patch) => dispatch({ type: 'setMixer', patch });
  const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;
  return (
    <div className="tl-popover mixer" role="dialog" aria-label={t('mixer.title')}>
      <div className="tl-pop-head">
        <span>{t('mixer.title')}</span>
        <button type="button" className="tl-pop-x" aria-label={t('mixer.close')} onClick={onClose}>×</button>
      </div>
      {AUDIO_ROLES.map((role) => (
        <div key={role} className="mix-row">
          <span className="mix-name">{ROLE_NAMES[role]}</span>
          <input type="range" min={-60} max={12} step={1} value={roleGainDb(project, role)}
            aria-label={t('mixer.busGain', { name: ROLE_NAMES[role] })}
            onChange={(e) => set({ [role]: Number(e.target.value) })} />
          <span className="mix-val">{db(roleGainDb(project, role))}</span>
          <button type="button" className={`mix-ms ${mixer.muted[role] ? 'on' : ''}`} aria-pressed={!!mixer.muted[role]}
            title={t('mixer.mute', { name: ROLE_NAMES[role] })}
            onClick={() => set({ muted: { [role]: !mixer.muted[role] } })}>M</button>
          <button type="button" className={`mix-ms ${mixer.solo[role] ? 'on' : ''}`} aria-pressed={!!mixer.solo[role]}
            title={t('mixer.solo', { name: ROLE_NAMES[role] })}
            onClick={() => set({ solo: { [role]: !mixer.solo[role] } })}>S</button>
        </div>
      ))}
      <div className="mix-row master">
        <span className="mix-name">{t('mixer.master')}</span>
        <input type="range" min={-60} max={12} step={1} value={masterGainDb(project)}
          aria-label={t('mixer.masterGain')}
          onChange={(e) => set({ master: Number(e.target.value) })} />
        <span className="mix-val">{db(masterGainDb(project))}</span>
        <span className="mix-ms-spacer" />
        <span className="mix-ms-spacer" />
      </div>
      <div className="tl-pop-note">{t('mixer.note')}</div>
    </div>
  );
}
