import React, { useEffect, useRef } from 'react';
import { Save } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { useT } from '../i18n/index.jsx';

// Asked when the window closes with a project that never had a file. onChoice('save' | 'discard' | 'cancel').
// Enter saves, Escape cancels.
export default function CloseDialog({ name, onChoice }) {
  const t = useT();
  const saveBtn = useRef(null);
  useEffect(() => {
    saveBtn.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onChoice('cancel'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoice]);
  return (
    <div className="modal-backdrop close-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="close-title" aria-describedby="close-text"
      onMouseDown={(e) => e.target === e.currentTarget && onChoice('cancel')}>
      <div className="modal close-modal">
        <div className="modal-icon"><Save size={24} /></div>
        <h3 id="close-title">{t('close.title', { name: String(name || t('common.untitled')).slice(0, 80) })}</h3>
        <p id="close-text" className="muted">{t('close.text')}</p>
        <div className="modal-actions">
          <Button variant="ghost" onClick={() => onChoice('cancel')}>{t('common.cancel')}</Button>
          <Button onClick={() => onChoice('discard')}>{t('close.dontSave')}</Button>
          <Button ref={saveBtn} variant="primary" onClick={() => onChoice('save')}><Save size={14} /> {t('common.save')}</Button>
        </div>
      </div>
    </div>
  );
}
