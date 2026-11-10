import React, { useEffect } from 'react';
import { Info, X } from '../icons.jsx';
import { KEY_ACTIONS, formatChord, getCurrentKeymap } from '../keymap.js';

// Keyboard shortcuts reference — the list that used to sit at the bottom of the
// inspector, now opened from the TopBar Menu (Hamza's UI review, 2026-11-10:
// the inspector keeps project settings only). The chords are read from the
// user's keymap at render time, so the dialog never advertises a key that
// does something else.
export default function ShortcutsDialog({ onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts-modal">
        <button className="icon-btn about-close" aria-label="Close" onClick={onClose}><X size={16} /></button>
        <h3 id="shortcuts-title" className="shortcuts-title"><Info size={15} aria-hidden="true" /> Keyboard shortcuts</h3>
        <dl className="shortcuts-list">
          {KEY_ACTIONS.map((a) => {
            const list = getCurrentKeymap().bindings[a.id] || [];
            return (
              <React.Fragment key={a.id}>
                <dt>{list.length ? list.map((c) => <kbd key={c}>{formatChord(c).replaceAll('+', ' ')}</kbd>) : <span className="muted">—</span>}</dt>
                <dd>{a.label}</dd>
              </React.Fragment>
            );
          })}
          <dt><kbd>Ctrl</kbd> + wheel</dt><dd>Zoom the timeline</dd>
        </dl>
        <p className="shortcuts-hint">Change any of these in Settings &gt; Keyboard.</p>
      </div>
    </div>
  );
}
