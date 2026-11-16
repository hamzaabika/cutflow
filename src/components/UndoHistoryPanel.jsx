// Visible undo history (B-UX7): the undo trail as a list — every undoable
// step with its action and time, the current state, and the redoable steps
// below it. Clicking a past step jumps there in one dispatch (undoTo);
// clicking a redo step jumps forward (redoTo). Steps created before
// metadata existed (pastMeta missing) render as a plain Edit.
import React from 'react';
import { History, RotateCcw, Redo2 } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { getLanguage, useT } from '../i18n/index.jsx';

// Action type -> translated label. Unknown types fall back to the raw type,
// prettified, so a new action never renders blank.
export function historyLabel(t, type) {
  const key = `uh.act.${type}`;
  const label = t(key);
  if (label !== key) return label;
  return String(type || 'edit').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

const WHEN_LOCALES = { en: 'en-GB', fr: 'fr-FR', ar: 'ar' };
export function fmtHistoryWhen(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString(WHEN_LOCALES[getLanguage()] || 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return ''; }
}

export default function UndoHistoryPanel({ history, dispatch, onClose }) {
  const t = useT();
  const past = history.past || [];
  const future = history.future || [];
  const pastMeta = history.pastMeta || [];
  const futureMeta = history.futureMeta || [];
  const metaFor = (meta, i) => meta[i] || { type: 'edit', at: 0 };

  // Newest first: past[j] is the present after j steps, so the newest undo
  // step is the last past entry; clicking it restores past[j] (undoTo j).
  const rows = [];
  for (let j = past.length - 1; j >= 0; j--) {
    rows.push({ kind: 'past', index: j, meta: metaFor(pastMeta, j) });
  }
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('uh.title')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card uh-dialog">
        <div className="modal-head">
          <h2><History size={16} /> {t('uh.title')}</h2>
          <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={onClose}>✕</button>
        </div>
        <p className="dim small">{t('uh.intro')}</p>
        {past.length === 0 && future.length === 0 && (
          <p className="dim small">{t('uh.empty')}</p>
        )}
        <ul className="uh-list">
          {rows.map(({ index, meta }) => (
            <li key={`past-${index}`}>
              <button type="button" className="uh-row" onClick={() => { dispatch({ type: 'undoTo', depth: index }); onClose(); }}
                title={t('uh.undoTo', { label: historyLabel(t, meta.type) })}>
                <RotateCcw size={13} />
                <span className="uh-label">{historyLabel(t, meta.type)}</span>
                <span className="dim small">{fmtHistoryWhen(meta.at)}</span>
              </button>
            </li>
          ))}
          <li className="uh-current" aria-current="true">
            <span className="uh-row uh-row--current">
              <span className="uh-dot" />
              <span className="uh-label">{t('uh.current')}</span>
              <span className="dim small">{t('uh.steps', { n: past.length })}</span>
            </span>
          </li>
          {future.map((_, k) => {
            const meta = metaFor(futureMeta, k);
            return (
              <li key={`future-${k}`}>
                <button type="button" className="uh-row uh-row--future" onClick={() => { dispatch({ type: 'redoTo', index: k }); onClose(); }}
                  title={t('uh.redoTo', { label: historyLabel(t, meta.type) })}>
                  <Redo2 size={13} />
                  <span className="uh-label">{historyLabel(t, meta.type)}</span>
                  <span className="dim small">{fmtHistoryWhen(meta.at)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="row-btns">
          <Button disabled={past.length === 0} onClick={() => { dispatch({ type: 'undo' }); onClose(); }}>{t('tl.undo')}</Button>
          <Button disabled={future.length === 0} onClick={() => { dispatch({ type: 'redo' }); onClose(); }}>{t('tl.redo')}</Button>
        </div>
      </div>
    </div>
  );
}
