import React, { useState } from 'react';
import { useT } from '../i18n/index.jsx';

// Checklist #11 — New colour matte (Premiere-style): pick a solid colour;
// the matte is generated at project size and lands on the main track at
// the playhead. "New black video" skips this dialog (plain #000000).
const PRESETS = ['#000000', '#ffffff', '#e5484d', '#46a758', '#3e63dd', '#f5d90a'];
export default function ColorMatteDialog({ initialColor = '#e5484d', onConfirm, onCancel }) {
  const t = useT();
  const [color, setColor] = useState(initialColor);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="matte-title">
      <div className="modal matte-modal">
        <h3 id="matte-title">{t('matte.title')}</h3>
        <p className="muted">{t('matte.note')}</p>
        <div className="matte-row">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('matte.color')} />
          <code>{color}</code>
        </div>
        <div className="matte-swatches">
          {PRESETS.map((c) => (
            <button key={c} type="button" className={`matte-swatch ${c === color ? 'on' : ''}`} style={{ background: c }} title={c} aria-label={c} onClick={() => setColor(c)} />
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={() => onConfirm(color)}>{t('matte.add')}</button>
          <button className="btn" onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  );
}
