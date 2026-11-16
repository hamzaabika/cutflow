// Sequence tab switcher (P2-02) — the strip above the timeline toolbar.
// Create / rename (double-click) / delete / switch sequences, and insert
// another sequence as a nested clip on the main track at the playhead.
// Entries that would close a cycle, or an empty sequence, are shown disabled
// with the reason — the reducer refuses them too, this is the message.
import React, { useState } from 'react';
import { Film, Plus, X } from '../icons.jsx';
import { canNest, sequenceDuration, sequenceUsedBy } from '../sequences.js';
import { formatTime } from '../store.js';
import { useT } from '../i18n/index.jsx';

export default function SequenceTabs({ project, dispatch, onSelect, onInsertSequence }) {
  const t = useT();
  const sequences = project.sequences || [];
  const activeId = project.activeSequenceId;
  const [renaming, setRenaming] = useState(null); // sequence id being renamed
  const [renameVal, setRenameVal] = useState('');
  const [insertOpen, setInsertOpen] = useState(false);

  const commitRename = (id) => {
    if (renaming !== id) return;
    setRenaming(null);
    if (renameVal.trim()) dispatch({ type: 'renameSequence', id, name: renameVal.trim() });
  };

  const tryDelete = (seq) => {
    if (sequences.length < 2) return;
    if (sequenceUsedBy(project, seq.id).length) return;
    if (!window.confirm(t('seqs.deleteConfirm', { name: seq.name }))) return;
    dispatch({ type: 'deleteSequence', id: seq.id });
  };

  return (
    <div className="seq-tabs" role="tablist" aria-label={t('seqs.tabs')}>
      <div className="seq-tabs-scroll">
      {sequences.map((seq) => {
        const active = seq.id === activeId;
        const inUse = sequenceUsedBy(project, seq.id).length > 0;
        const deleteTitle = sequences.length < 2
          ? t('seqs.deleteLast')
          : inUse ? t('seqs.deleteInUse', { name: seq.name }) : t('seqs.delete');
        return (
          <div key={seq.id} className={`seq-tab ${active ? 'active' : ''}`} role="tab" aria-selected={active}>
            {renaming === seq.id ? (
              <input className="seq-rename" autoFocus value={renameVal}
                aria-label={t('seqs.rename')}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => commitRename(seq.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(seq.id);
                  if (e.key === 'Escape') setRenaming(null);
                }} />
            ) : (
              <button type="button" className="seq-tab-btn"
                title={t('seqs.renameTitle')}
                onClick={() => { dispatch({ type: 'switchSequence', id: seq.id }); onSelect && onSelect(null); }}
                onDoubleClick={() => { setRenaming(seq.id); setRenameVal(seq.name); }}>
                <Film size={12} />
                <span className="seq-tab-name">{seq.name}</span>
                <span className="seq-tab-dur">{formatTime(sequenceDuration(project, seq.id))}</span>
              </button>
            )}
            {sequences.length > 1 && (
              <button type="button" className="seq-tab-del" aria-label={t('seqs.delete')} title={deleteTitle}
                disabled={sequences.length < 2 || inUse}
                onClick={(e) => { e.stopPropagation(); tryDelete(seq); }}>
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className="seq-tab-add" title={t('seqs.newTitle')} aria-label={t('seqs.new')}
        onClick={() => { dispatch({ type: 'createSequence' }); onSelect && onSelect(null); }}>
        <Plus size={14} /> {t('seqs.new')}
      </button>
      </div>
      <div className="seq-insert">
        <button type="button" className="seq-insert-btn" title={t('seqs.insertClipTitle')}
          aria-expanded={insertOpen} onClick={() => setInsertOpen((v) => !v)}>
          {t('seqs.insertClip')}
        </button>
        {insertOpen && (
          <div className="seq-insert-menu" role="menu">
            <div className="seq-insert-head">{t('seqs.insertMenuTitle')}</div>
            {sequences.filter((s) => s.id !== activeId).map((s) => {
              const dur = sequenceDuration(project, s.id);
              const blocked = !canNest(project, s.id);
              const disabled = blocked || dur < 0.1;
              const reason = blocked ? t('seqs.cycleBlocked') : dur < 0.1 ? t('seqs.emptySource') : '';
              return (
                <button key={s.id} type="button" role="menuitem" className="seq-insert-item"
                  disabled={disabled} title={reason || s.name}
                  onClick={() => { setInsertOpen(false); onInsertSequence(s.id); }}>
                  <span>{s.name}</span>
                  <span className="seq-insert-dur">{disabled ? reason : formatTime(dur)}</span>
                </button>
              );
            })}
            {sequences.filter((s) => s.id !== activeId).length === 0 && (
              <div className="seq-insert-empty">{t('seqs.insertNone')}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
