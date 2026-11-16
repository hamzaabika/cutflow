// Auto-reframe options (P2-42, AI-06): the manual override surface for the
// vertical copy. Follow faces is the default; Centre crop is the static
// alternative when tracking is wrong; "Keep text safe" fits (never crops)
// any clip that carries timeline text when no face was found on it, so
// burned-in text and on-screen graphics survive. The choice is remembered
// on this PC. After the copy is made, every clip's transform stays editable
// in the editor — the per-clip manual override.
import React, { useState } from 'react';
import { useT } from '../i18n/index.jsx';
import AiBadge from './AiBadge.jsx';

export const REFRAME_KEY = 'clipcraft.reframe.v1';

export function loadReframePrefs() {
  try {
    const v = JSON.parse(localStorage.getItem(REFRAME_KEY) || 'null');
    if (v && typeof v === 'object') {
      return {
        mode: v.mode === 'center' ? 'center' : 'face',
        textSafe: v.textSafe !== false,
      };
    }
  } catch { /* defaults */ }
  return { mode: 'face', textSafe: true };
}

export function saveReframePrefs(prefs) {
  try { localStorage.setItem(REFRAME_KEY, JSON.stringify(prefs)); } catch { /* not saved */ }
}

export default function ReframeDialog({ onConfirm, onClose }) {
  const t = useT();
  const [prefs, setPrefs] = useState(loadReframePrefs);
  const confirm = () => {
    saveReframePrefs(prefs);
    onConfirm(prefs);
  };
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="reframe-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal seq-modal">
        <h3 id="reframe-title">{t('reframe.title')} <AiBadge kind="local" /></h3>
        <p className="muted">{t('reframe.note')}</p>
        <div className="field" role="radiogroup" aria-label={t('reframe.modeAria')}>
          <label className="field row">
            <input type="radio" name="reframe-mode" checked={prefs.mode === 'face'} onChange={() => setPrefs((p) => ({ ...p, mode: 'face' }))} />
            <span>{t('reframe.face')}<small className="muted"> {t('reframe.faceNote')}</small></span>
          </label>
          <label className="field row">
            <input type="radio" name="reframe-mode" checked={prefs.mode === 'center'} onChange={() => setPrefs((p) => ({ ...p, mode: 'center' }))} />
            <span>{t('reframe.center')}<small className="muted"> {t('reframe.centerNote')}</small></span>
          </label>
        </div>
        <label className="field row">
          <input type="checkbox" checked={prefs.textSafe} onChange={(e) => setPrefs((p) => ({ ...p, textSafe: e.target.checked }))} />
          <span>{t('reframe.textSafe')}<small className="muted"> {t('reframe.textSafeNote')}</small></span>
        </label>
        <div className="modal-actions seq-actions">
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={confirm}>{t('reframe.make')}</button>
        </div>
      </div>
    </div>
  );
}
