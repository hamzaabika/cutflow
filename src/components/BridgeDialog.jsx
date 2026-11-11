import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Trash2 } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { getLanguage, tr, useT } from '../i18n/index.jsx';

// Agent drafts: the shadow drafts external agent tools proposed through the
// local bridge (Settings > Agent bridge). Nothing here is in the project yet —
// Accept applies a draft (App flushes the current state first, main commits it
// through the transactional save, and the pre-accept state is kept in the
// version history); Discard drops the copy and leaves the project untouched.
// A draft made before the user's latest edits is stale: accepting it is
// refused rather than overwriting newer work, and the row says so.
const LIST_LABELS = {
  videoClips: 'dlg.list.video', overlayClips: 'dlg.list.overlay', textClips: 'dlg.list.text', audioClips: 'dlg.list.audio', effectClips: 'dlg.list.effect',
};
const WHEN_LOCALES = { en: 'en-GB', fr: 'fr-FR', ar: 'ar' };

const fmtWhen = (ts) => {
  try {
    return new Date(ts).toLocaleString(WHEN_LOCALES[getLanguage()] || 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};
const clip = (s, n = 90) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

function diffLines(diff) {
  if (!diff) return [];
  const lines = [];
  for (const [key, label] of Object.entries(LIST_LABELS)) {
    const c = diff.lists?.[key];
    if (!c) continue;
    const parts = [];
    if (c.added) parts.push(tr('dlg.added', { count: c.added }));
    if (c.removed) parts.push(tr('dlg.removed', { count: c.removed }));
    if (c.changed) parts.push(tr('dlg.changed', { count: c.changed }));
    if (parts.length) lines.push(`${tr(label)}: ${parts.join(', ')}`);
  }
  if (Math.abs((diff.durationAfter || 0) - (diff.durationBefore || 0)) > 0.05) {
    lines.push(tr('dlg.durationLine', { from: diff.durationBefore.toFixed(1), to: diff.durationAfter.toFixed(1) }));
  }
  if (diff.nameChanged) lines.push(tr('dlg.nameLine', { from: clip(diff.nameChanged.from, 40), to: clip(diff.nameChanged.to, 40) }));
  return lines;
}

export default function BridgeDialog({ projectId, projectName, onAccept, onDiscard, onClose }) {
  const t = useT();
  const [entries, setEntries] = useState(null); // null = loading
  const [notes, setNotes] = useState({}); // shadowId -> message after an action

  const load = useCallback(() => {
    window.api.bridgeListShadows?.()
      .then((list) => setEntries((Array.isArray(list) ? list : []).filter((s) => s.projectId === projectId && s.status === 'pending')))
      .catch(() => setEntries([]));
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000); // an agent may propose while this is open
    return () => clearInterval(t);
  }, [load]);

  const accept = async (shadow) => {
    const r = await onAccept(shadow);
    if (r?.ok) { setNotes((n) => ({ ...n, [shadow.id]: t('dlg.applied') })); load(); return; }
    setNotes((n) => ({
      ...n,
      [shadow.id]: r?.conflict
        ? t('dlg.conflictNote')
        : t('dlg.notApplied', { error: r?.error || t('dlg.wentWrong') }),
    }));
    load();
  };
  const discard = async (shadow) => {
    await onDiscard(shadow.id);
    load();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bridge-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bridge-modal">
        <div className="modal-icon"><Bot size={24} /></div>
        <h3 id="bridge-title">{t('dlg.draftsTitle', { name: String(projectName || t('common.untitled')).slice(0, 60) })}</h3>
        <p className="muted">{t('dlg.draftsNote')}</p>
        {entries === null && <p className="muted">{t('dlg.loading')}</p>}
        {entries !== null && entries.length === 0 && (
          <p className="muted">{t('dlg.noDrafts')}</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="history-list">
            {entries.map((s) => {
              const lines = diffLines(s.diff);
              const noChanges = s.diff && !s.diff.added && !s.diff.removed && !s.diff.changed && !s.diff.nameChanged;
              return (
                <div key={s.id} className="history-row bridge-row">
                  <div className="history-info">
                    <span className="history-when">{fmtWhen(s.createdAt)} · {t('dlg.fromAgent', { client: s.client || t('dlg.anAgentTool') })}</span>
                    <span className="history-meta muted">
                      {t('dlg.basedOn', { rev: s.baseRevision })}{s.liveRevision != null && s.liveRevision !== s.baseRevision ? t('dlg.nowAtRevision', { rev: s.liveRevision }) : ''}
                      {s.ops?.length ? t(s.ops.length === 1 ? 'dlg.editsCountOne' : 'dlg.editsCount', { count: s.ops.length }) : ''}
                    </span>
                    {lines.map((l, i) => <span key={i} className="bridge-diff-line">{l}</span>)}
                    {(s.diff?.captionText || []).slice(0, 4).map((c, i) => (
                      <span key={`ct${i}`} className="bridge-diff-line">{t('dlg.captionLine', { from: clip(c.from), to: clip(c.to) })}</span>
                    ))}
                    {noChanges && <span className="bridge-diff-line">{t('dlg.noChanges')}</span>}
                    {s.stale && <span className="bridge-stale">{t('dlg.stale')}</span>}
                    {notes[s.id] && <span className="bridge-stale">{notes[s.id]}</span>}
                  </div>
                  <div className="bridge-actions">
                    <Button variant="ghost" onClick={() => accept(s)} title={t('dlg.acceptTitle')}>
                      <Check size={13} /> {t('dlg.accept')}
                    </Button>
                    <Button variant="ghost" onClick={() => discard(s)} title={t('dlg.discardTitle')}>
                      <Trash2 size={13} /> {t('dlg.discard')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}>{t('dlg.done')}</Button>
        </div>
      </div>
    </div>
  );
}
