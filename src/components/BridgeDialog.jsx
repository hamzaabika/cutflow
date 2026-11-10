import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Check, Trash2 } from '../icons.jsx';
import Button from '../ui/Button.jsx';

// Agent drafts: the shadow drafts external agent tools proposed through the
// local bridge (Settings > Agent bridge). Nothing here is in the project yet —
// Accept applies a draft (App flushes the current state first, main commits it
// through the transactional save, and the pre-accept state is kept in the
// version history); Discard drops the copy and leaves the project untouched.
// A draft made before the user's latest edits is stale: accepting it is
// refused rather than overwriting newer work, and the row says so.
const LIST_LABELS = {
  videoClips: 'video', overlayClips: 'overlay', textClips: 'text/caption', audioClips: 'audio', effectClips: 'effect',
};

const fmtWhen = (ts) => {
  try {
    return new Date(ts).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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
    if (c.added) parts.push(`${c.added} added`);
    if (c.removed) parts.push(`${c.removed} removed`);
    if (c.changed) parts.push(`${c.changed} changed`);
    if (parts.length) lines.push(`${label}: ${parts.join(', ')}`);
  }
  if (Math.abs((diff.durationAfter || 0) - (diff.durationBefore || 0)) > 0.05) {
    lines.push(`duration: ${diff.durationBefore.toFixed(1)}s → ${diff.durationAfter.toFixed(1)}s`);
  }
  if (diff.nameChanged) lines.push(`project name: “${clip(diff.nameChanged.from, 40)}” → “${clip(diff.nameChanged.to, 40)}”`);
  return lines;
}

export default function BridgeDialog({ projectId, projectName, onAccept, onDiscard, onClose }) {
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
    if (r?.ok) { setNotes((n) => ({ ...n, [shadow.id]: 'Applied.' })); load(); return; }
    setNotes((n) => ({
      ...n,
      [shadow.id]: r?.conflict
        ? 'Not applied: the project changed after this draft was made, so applying it would overwrite newer work. Discard it and let the agent make a fresh draft.'
        : `Not applied: ${r?.error || 'something went wrong.'}`,
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
        <h3 id="bridge-title">Agent drafts — {String(projectName || 'Untitled').slice(0, 60)}</h3>
        <p className="muted">
          Edits proposed by agent tools through the local bridge. They are not in your project yet:
          Accept applies a draft, Discard drops it. Your current state is kept in the version
          history whenever a draft is applied.
        </p>
        {entries === null && <p className="muted">Loading…</p>}
        {entries !== null && entries.length === 0 && (
          <p className="muted">No drafts are waiting. When an agent tool proposes an edit, it appears here for review.</p>
        )}
        {entries !== null && entries.length > 0 && (
          <div className="history-list">
            {entries.map((s) => {
              const lines = diffLines(s.diff);
              const noChanges = s.diff && !s.diff.added && !s.diff.removed && !s.diff.changed && !s.diff.nameChanged;
              return (
                <div key={s.id} className="history-row bridge-row">
                  <div className="history-info">
                    <span className="history-when">{fmtWhen(s.createdAt)} · from {s.client || 'an agent tool'}</span>
                    <span className="history-meta muted">
                      based on revision {s.baseRevision}{s.liveRevision != null && s.liveRevision !== s.baseRevision ? ` · the project is now at revision ${s.liveRevision}` : ''}
                      {s.ops?.length ? ` · ${s.ops.length} edit${s.ops.length === 1 ? '' : 's'}` : ''}
                    </span>
                    {lines.map((l, i) => <span key={i} className="bridge-diff-line">{l}</span>)}
                    {(s.diff?.captionText || []).slice(0, 4).map((c, i) => (
                      <span key={`ct${i}`} className="bridge-diff-line">caption: “{clip(c.from)}” → “{clip(c.to)}”</span>
                    ))}
                    {noChanges && <span className="bridge-diff-line">No changes yet — the draft matches your project.</span>}
                    {s.stale && <span className="bridge-stale">Stale: the project changed after this draft was made.</span>}
                    {notes[s.id] && <span className="bridge-stale">{notes[s.id]}</span>}
                  </div>
                  <div className="bridge-actions">
                    <Button variant="ghost" onClick={() => accept(s)} title="Apply this draft to the project">
                      <Check size={13} /> Accept
                    </Button>
                    <Button variant="ghost" onClick={() => discard(s)} title="Drop this draft; the project stays as it is">
                      <Trash2 size={13} /> Discard
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
