import React, { useEffect, useState } from 'react';
import Button from '../ui/Button.jsx';
import { Sparkles } from '../icons.jsx';
import { useT } from '../i18n/index.jsx';

// AI Enhance (Real-ESRGAN, local): pick a model and a scale for the chosen
// video, then Start hands the work to the export-jobs queue — the dialog is
// only a form, like the export dialog; progress and cancel live in the tray.
const MODEL_IDS = ['realistic', 'animation', 'fast'];
const MODEL_KEYS = { realistic: 'enhance.modelRealistic', animation: 'enhance.modelAnimation', fast: 'enhance.modelFast' };

export default function EnhanceDialog({ name, onStart, onClose }) {
  const t = useT();
  const [model, setModel] = useState('realistic');
  const [scale, setScale] = useState(2);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="enhance-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-icon"><Sparkles size={24} /></div>
        <h3 id="enhance-title">{t('enhance.title')}</h3>
        <p className="muted">{t('enhance.intro')}</p>
        {name && <p className="enhance-target" title={name}>{name}</p>}
        <div className="enhance-field">
          <span className="enhance-label">{t('enhance.model')}</span>
          <div className="seg-tabs small" role="radiogroup" aria-label={t('enhance.model')}>
            {MODEL_IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={model === id}
                className={model === id ? 'on' : ''} onClick={() => setModel(id)}>{t(MODEL_KEYS[id])}</button>
            ))}
          </div>
        </div>
        <div className="enhance-field">
          <span className="enhance-label">{t('enhance.scale')}</span>
          <div className="seg-tabs small" role="radiogroup" aria-label={t('enhance.scale')}>
            {[2, 4].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scale === s}
                className={scale === s ? 'on' : ''} onClick={() => setScale(s)}>{s}x</button>
            ))}
          </div>
        </div>
        <p className="muted">{t('enhance.note')}</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={() => onStart({ model, scale })}>{t('enhance.start')}</Button>
        </div>
      </div>
    </div>
  );
}
