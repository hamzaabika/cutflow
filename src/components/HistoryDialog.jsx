import React, { useEffect, useState } from 'react';
import { History, RotateCcw } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { getLanguage, useT } from '../i18n/index.jsx';

// Project Backups: the snapshots the main process recorded for this project —
// every explicit save, throttled auto-saves, the timed auto-backups taken while
// editing (10/10 step 4), and a restore point taken before each restore.
// Restoring loads the snapshot like a project open; App records the current
// state first, so a restore can itself be undone from this same list.
const SOURCE_LABELS = {
  save: 'dlg.src.save',
  'save-as': 'dlg.src.saveAs',
  autosave: 'dlg.src.autosave',
  slot: 'dlg.src.autosave',
  'auto-backup': 'dlg.src.autoBackup',
  'agent-bridge': 'dlg.src.agentBridge',
  'restore-point': 'dlg.src.restorePoint',
  snapshot: 'dlg.src.snapshot',
};
const WHEN_LOCALES = { en: 'en-GB', fr: 'fr-FR', ar: 'ar' };

const fmtWhen = (ts) => {
  try {
    return new Date(ts).toLocaleString(WHEN_LOCALES[getLanguage()] || 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};
const fmtSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

export default function HistoryDialog({ projectId, projectName, onRestore, onClose }) {
  const t = useT();
  const [entries, setEntries] = useState(null); // null = loading
  useEffect(() => {
    let live = true;
    window.api.versionsList?.(projectId)
      .then((list) => { if (live) setEntries(Array.isArray(list) ? list : []); })
      .catch(() => { if (live) setEntries([]); });
    return () => { live = false; };
  }, [projectId]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal">
        <div className="modal-icon"><History size={24} /></div>
        <h3 id="history-title">{t('dlg.backupsTitle', { name: String(projectName || t('common.untitled')).slice(0, 60) })}</h3>
        <p className="muted">{t('dlg.backupsNote')}</p>
        {entries === null && <p className="muted">{t('dlg.loading')}</p>}
        {entries !== null && entries.length === 0 && (
          <p className="muted">{t('dlg.noBackups')}</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="history-list">
            {entries.map((e, i) => (
              <div key={e.file} className="history-row">
                <div className="history-info">
                  <span className="history-when">{fmtWhen(e.savedAt)}{i === 0 ? t('dlg.latest') : ''}</span>
                  <span className="history-meta muted">
                    {t(SOURCE_LABELS[e.source] || 'dlg.src.snapshot')} · {fmtSize(e.bytes || 0)}
                    {e.boundFile ? ` · ${baseName(e.boundFile)}` : ''}
                  </span>
                </div>
                <Button variant="ghost" disabled={i === 0} title={i === 0 ? t('dlg.restoreTitleLatest') : t('dlg.restoreTitle')}
                  onClick={() => onRestore(e)}>
                  <RotateCcw size={13} /> {t('dlg.restore')}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}>{t('dlg.done')}</Button>
        </div>
      </div>
    </div>
  );
}
