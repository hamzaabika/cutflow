import React, { useEffect, useState } from 'react';
import { History, RotateCcw } from '../icons.jsx';
import Button from '../ui/Button.jsx';

// Project Backups: the snapshots the main process recorded for this project —
// every explicit save, throttled auto-saves, the timed auto-backups taken while
// editing (10/10 step 4), and a restore point taken before each restore.
// Restoring loads the snapshot like a project open; App records the current
// state first, so a restore can itself be undone from this same list.
const SOURCE_LABELS = {
  save: 'Saved',
  'save-as': 'Saved as',
  autosave: 'Auto-saved',
  slot: 'Auto-saved',
  'auto-backup': 'Auto backup',
  'agent-bridge': 'Agent draft accepted',
  'restore-point': 'Before a restore',
  snapshot: 'Snapshot',
};

const fmtWhen = (ts) => {
  try {
    return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};
const fmtSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

export default function HistoryDialog({ projectId, projectName, onRestore, onClose }) {
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
        <h3 id="history-title">Project backups — {String(projectName || 'Untitled').slice(0, 60)}</h3>
        <p className="muted">
          Earlier states of this project, newest first: your saves, plus automatic backups
          Cutflow takes while you edit. Restoring one keeps your current state in this list,
          so you can always come back.
        </p>
        {entries === null && <p className="muted">Loading…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="muted">No backups yet — one is recorded whenever the project is saved, and automatically while you edit.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="history-list">
            {entries.map((e, i) => (
              <div key={e.file} className="history-row">
                <div className="history-info">
                  <span className="history-when">{fmtWhen(e.savedAt)}{i === 0 ? ' · latest' : ''}</span>
                  <span className="history-meta muted">
                    {SOURCE_LABELS[e.source] || 'Snapshot'} · {fmtSize(e.bytes || 0)}
                    {e.boundFile ? ` · ${baseName(e.boundFile)}` : ''}
                  </span>
                </div>
                <Button variant="ghost" disabled={i === 0} title={i === 0 ? 'This is the latest recorded state' : 'Restore this version'}
                  onClick={() => onRestore(e)}>
                  <RotateCcw size={13} /> Restore
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
