import React, { useEffect } from 'react';
import { Info, X } from '../icons.jsx';
import { KEY_ACTIONS, formatChord, getCurrentKeymap } from '../keymap.js';
import { useT } from '../i18n/index.jsx';

// Keyboard shortcuts reference — the list that used to sit at the bottom of the
// inspector, now opened from the TopBar Menu (Hamza's UI review, 2026-11-10:
// the inspector keeps project settings only). The chords are read from the
// user's keymap at render time, so the dialog never advertises a key that
// does something else.
export default function ShortcutsDialog({ onClose }) {
  const t = useT();
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-modal">
        <button className="icon-btn about-close" aria-label={t('common.close')} onClick={onClose}><X size={16} /></button>
        <h3 id="shortcuts-title" className="shortcuts-title"><Info size={15} aria-hidden="true" /> {t('topbar.shortcuts')}</h3>
        <dl className="shortcuts-list">
          {KEY_ACTIONS.map((a) => {
            const list = getCurrentKeymap().bindings[a.id] || [];
            return (
              <React.Fragment key={a.id}>
                <dt>{list.length ? list.map((c) => <kbd key={c}>{formatChord(c).replaceAll('+', ' ')}</kbd>) : <span className="muted">—</span>}</dt>
                <dd>{t(`keymap.${a.id}`)}</dd>
              </React.Fragment>
            );
          })}
          <dt><kbd>Ctrl</kbd> + wheel</dt><dd>{t('shortcuts.zoomTimeline')}</dd>
        </dl>
        <p className="shortcuts-hint">{t('shortcuts.hint')}</p>
      </div>
    </div>
  );
}
