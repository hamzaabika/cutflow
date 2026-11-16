import React, { useState } from 'react';
import { FolderOpen, Link2, Unlink } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { useT } from '../i18n/index.jsx';

// Media relink: the project opened, but some source files are not where the project
// remembers them (moved, renamed, another drive). Each missing file can be located by
// hand, or the user points at the folder the media moved to and matching files are
// found by name and verified in the main process (duration/size must agree with what
// the project remembers — a same-name stranger is never silently accepted).
// onApply(updates) receives [{ id, path, ...probed fields }] for the store's
// relinkMedia action; skipping leaves the clips in place, still missing.
// `context="export"` is the export guard (Part 3 addendum, 2026-11-10): the
// same surface, but closing it cancels the export it was blocking.
export default function RelinkDialog({ items, onApply, onClose, context, closeLabel }) {
  const t = useT();
  const [found, setFound] = useState({}); // id -> { path, verified, ...patch }
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const missing = (items || []).filter((m) => !found[m.id]);

  const scanFolder = async () => {
    if (!missing.length || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await window.api.relinkScanFolder(missing);
      if (!res) return; // cancelled
      const next = { ...found };
      for (const m of res.matches || []) {
        const { id, ...patch } = m;
        next[id] = patch;
      }
      setFound(next);
      const parts = [];
      if (res.matches?.length) parts.push(t(res.matches.length === 1 ? 'rl.filesMatchedOne' : 'rl.filesMatched', { count: res.matches.length }));
      if (res.ambiguous?.length) parts.push(t(res.ambiguous.length === 1 ? 'rl.verifyAmbiguous' : 'rl.verifyAmbiguousMany', { count: res.ambiguous.length }));
      if (res.unmatched?.length) parts.push(t('rl.notFound', { count: res.unmatched.length }));
      setNote(parts.join(' ') || t('rl.noMatch'));
    } finally {
      setBusy(false);
    }
  };

  const locate = async (item) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await window.api.relinkPickFile(item);
      if (res?.path) {
        const { id, ...patch } = res;
        setFound((f) => ({ ...f, [item.id]: patch }));
      }
    } finally {
      setBusy(false);
    }
  };

  const foundCount = Object.keys(found).length;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="relink-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal relink-modal">
        <div className="modal-icon"><Unlink size={24} /></div>
        <h3 id="relink-title">{t('rl.title')}</h3>
        <p className="muted">{t('rl.note')}</p>
        {context === 'export' && (
          <p className="muted">{t('rl.exportNote')}</p>
        )}
        <div className="relink-list">
          {(items || []).map((m) => {
            const f = found[m.id];
            return (
              <div key={m.id} className="relink-row">
                <div className="relink-info">
                  <span className="relink-name" title={m.path}>{m.name}</span>
                  <span className="relink-path muted" title={f ? f.path : m.path}>
                    {f ? t('rl.nowPath', { path: f.path }) : t('rl.wasPath', { path: m.path })}
                  </span>
                  {f && f.verified === false && (
                    <span className="relink-warn">{t('rl.warn')}</span>
                  )}
                </div>
                {f
                  ? <span className="relink-done"><Link2 size={13} /> {t('rl.linked')}</span>
                  : <Button variant="ghost" disabled={busy} onClick={() => locate(m)}>{t('rl.locate')}</Button>}
              </div>
            );
          })}
        </div>
        {note && <p className="muted" role="status">{note}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>{closeLabel || t('rl.skip')}</Button>
          <Button disabled={busy || !missing.length} onClick={scanFolder}><FolderOpen size={14} /> {t('rl.chooseFolder')}</Button>
          <Button variant="primary" disabled={!foundCount}
            onClick={() => onApply(Object.entries(found).map(([id, patch]) => ({ id, ...patch })))}>
            {foundCount ? t(foundCount === 1 ? 'rl.relinkFilesOne' : 'rl.relinkFiles', { count: foundCount }) : t('rl.relinkFiles', { count: 0 })}
          </Button>
        </div>
      </div>
    </div>
  );
}
