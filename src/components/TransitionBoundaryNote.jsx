// Boundary notice for a transition (FB-12 · P1-09): the engine silently
// clamps a too-long transition at use time, so the inspector says so out
// loud instead — shortened to the fitting length, or an error with a way out
// (shorten to fit / remove) when nothing fits. Renders nothing when the
// requested duration fits.
import React from 'react';
import { useT } from '../i18n/index.jsx';

export default function TransitionBoundaryNote({ boundary, onShorten, onRemove }) {
  const t = useT();
  if (!boundary || boundary.status === 'ok') return null;
  if (boundary.status === 'clamped') {
    return (
      <div className="info" role="status">
        {t('insp.trBoundClamped', { effective: boundary.effective.toFixed(2) })}
        <div className="row-btns">
          <button type="button" className="btn btn-sm" onClick={onShorten}>
            {t('insp.trBoundShorten', { effective: boundary.effective.toFixed(2) })}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="info" role="alert">
      {boundary.status === 'zero-handle' ? t('insp.trBoundZero') : t('insp.trBoundFirst')}
      <div className="row-btns">
        <button type="button" className="btn btn-sm" onClick={onRemove}>{t('insp.trBoundRemove')}</button>
      </div>
    </div>
  );
}
