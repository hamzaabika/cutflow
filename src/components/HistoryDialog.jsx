import React, { useEffect, useState } from 'react';
import { History, RotateCcw, Pencil } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { getLanguage, useT } from '../i18n/index.jsx';

// Project Backups: the snapshots the main process recorded for this project —
// every explicit save, throttled auto-saves, the timed auto-backups taken while
// editing (10/10 step 4), and a restore point taken before each restore.
// Restoring loads the snapshot like a project open; App records the current
// state first, so a restore can itself be undone from this same list.
//
// P1-48 — named versions, comparison, selective restoration:
// - "Save current as a named version" records the live project as a snapshot
//   with a name (source 'snapshot'); any snapshot can be renamed in place.
// - Tick two versions (or the live project + one version) to compare them:
//   the main process diffs the two documents into a textual summary — title,
//   duration, per-track clip counts with media added/removed — never a pixel diff.
// - Expanding a version shows its tracks and clips; restoring can take the
//   whole version or only the ticked tracks/clips (App merges the choice into
//   the live project through versions:selective). The store already caps the
//   list at CAP snapshots, so named versions cannot bloat the project.
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
const TRACKS = ['video', 'overlay', 'text', 'audio', 'sticker', 'effect'];
const WHEN_LOCALES = { en: 'en-GB', fr: 'fr-FR', ar: 'ar' };

const fmtWhen = (ts) => {
  try {
    return new Date(ts).toLocaleString(WHEN_LOCALES[getLanguage()] || 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};
const fmtSize = (bytes) => (bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const fmtDur = (s) => `${(Number(s) || 0).toFixed(1)}`; // dlg.durationLine adds the 's'
const baseName = (p) => String(p || '').split(/[\\/]/).pop();

export default function HistoryDialog({ projectId, projectName, currentProject, onRestore, onRestorePartial, onCreateNamed, onClose }) {
  const t = useT();
  const [entries, setEntries] = useState(null); // null = loading
  const [nameInput, setNameInput] = useState('');
  const [renaming, setRenaming] = useState(null); // file being renamed
  const [renameInput, setRenameInput] = useState('');
  const [compareSel, setCompareSel] = useState([]); // up to 2 files ('__current__' = live project)
  const [diff, setDiff] = useState(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [expanded, setExpanded] = useState(null); // file expanded for selective restore
  const [summary, setSummary] = useState(null);
  const [selTracks, setSelTracks] = useState([]);
  const [selClips, setSelClips] = useState([]); // 'track:id'
  const [openTrack, setOpenTrack] = useState(null);

  const liveJson = currentProject ? JSON.stringify(currentProject) : null;
  const reload = () => {
    window.api.versionsList?.(projectId)
      .then((list) => setEntries(Array.isArray(list) ? list : []))
      .catch(() => setEntries([]));
  };
  useEffect(reload, [projectId]);

  const toggleCompare = (file) => {
    setCompareSel((prev) => {
      if (prev.includes(file)) return prev.filter((f) => f !== file);
      return [...prev.slice(-1), file];
    });
    setDiff(null);
  };
  useEffect(() => {
    if (compareSel.length !== 2) { setDiff(null); return; }
    let live = true;
    setDiffBusy(true);
    window.api.versionsDiff?.(projectId, compareSel[0], compareSel[1], liveJson)
      .then((d) => { if (live) setDiff(d); })
      .catch(() => { if (live) setDiff(null); })
      .finally(() => { if (live) setDiffBusy(false); });
    return () => { live = false; };
    // liveJson changes with every keystroke-scale edit; the diff is for the
    // two versions as selected, so only the selection re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareSel, projectId]);

  const expand = (entry) => {
    if (expanded === entry.file) { setExpanded(null); setSummary(null); return; }
    setExpanded(entry.file);
    setSummary(null);
    setSelTracks([]);
    setSelClips([]);
    setOpenTrack(null);
    window.api.versionsSummary?.(projectId, entry.file)
      .then((s) => setSummary(s))
      .catch(() => setSummary(null));
  };

  const toggleTrack = (key) => {
    setSelTracks((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };
  const toggleClip = (key, id) => {
    const k = `${key}:${id}`;
    setSelClips((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };
  const selection = () => ({
    tracks: selTracks,
    clips: selClips.map((k) => { const [track, ...rest] = k.split(':'); return { track, id: rest.join(':') }; }),
  });
  const selCount = selTracks.length + selClips.length;

  const createNamed = async () => {
    const name = nameInput.trim();
    if (!name || !onCreateNamed) return;
    const ok = await onCreateNamed(name);
    if (ok !== false) { setNameInput(''); reload(); }
  };
  const saveRename = async (entry) => {
    const name = renameInput.trim();
    if (!name) { setRenaming(null); return; }
    await window.api.versionsRename?.(projectId, entry.file, name);
    setRenaming(null);
    reload();
  };

  const labelFor = (file) => {
    if (file === '__current__') return t('dlg.currentVersion');
    const e = (entries || []).find((x) => x.file === file);
    return e?.name || fmtWhen(e?.savedAt) || file;
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal history-modal">
        <div className="modal-icon"><History size={24} /></div>
        <h3 id="history-title">{t('dlg.backupsTitle', { name: String(projectName || t('common.untitled')).slice(0, 60) })}</h3>
        <p className="muted">{t('dlg.backupsNote')}</p>
        {onCreateNamed && (
          <div className="history-named-row">
            <input className="history-name-input" value={nameInput} maxLength={80}
              placeholder={t('dlg.versionNamePlaceholder')}
              aria-label={t('dlg.versionNamePlaceholder')}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createNamed(); }} />
            <Button variant="ghost" disabled={!nameInput.trim()} onClick={createNamed}>{t('dlg.saveNamedVersion')}</Button>
          </div>
        )}
        {entries === null && <p className="muted">{t('dlg.loading')}</p>}
        {entries !== null && entries.length === 0 && !currentProject && (
          <p className="muted">{t('dlg.noBackups')}</p>
        )}
        {entries !== null && (entries.length > 0 || currentProject) && (
          <p className="muted">{t('dlg.compareHint')}</p>
        )}
        {entries !== null && (entries.length > 0 || currentProject) && (
          <div className="history-list">
            {currentProject && (
              <div className="history-row history-current-row">
                <input type="checkbox" aria-label={t('dlg.compareWith', { name: t('dlg.currentVersion') })}
                  checked={compareSel.includes('__current__')} onChange={() => toggleCompare('__current__')} />
                <div className="history-info">
                  <span className="history-when">{t('dlg.currentVersion')}</span>
                  <span className="history-meta muted">{t('dlg.currentVersionNote')}</span>
                </div>
              </div>
            )}
            {entries.map((e, i) => {
              const isOpen = expanded === e.file;
              return (
                <div key={e.file} className="history-row-wrap">
                  <div className="history-row">
                    <input type="checkbox" aria-label={t('dlg.compareWith', { name: e.name || fmtWhen(e.savedAt) })}
                      checked={compareSel.includes(e.file)} onChange={() => toggleCompare(e.file)} />
                    <div className="history-info">
                      {renaming === e.file ? (
                        <span className="history-rename-row">
                          <input className="history-name-input" value={renameInput} maxLength={80}
                            autoFocus aria-label={t('dlg.versionNamePlaceholder')}
                            onChange={(ev) => setRenameInput(ev.target.value)}
                            onKeyDown={(ev) => { if (ev.key === 'Enter') saveRename(e); if (ev.key === 'Escape') setRenaming(null); }} />
                          <Button variant="ghost" onClick={() => saveRename(e)}>{t('dlg.save')}</Button>
                        </span>
                      ) : (
                        <button type="button" className="history-name-btn" onClick={() => onRestorePartial && expand(e)}
                          title={onRestorePartial ? t('dlg.expandTitle') : undefined}>
                          <span className="history-when">{e.name || fmtWhen(e.savedAt)}{i === 0 ? t('dlg.latest') : ''}</span>
                        </button>
                      )}
                      <span className="history-meta muted">
                        {e.name ? `${fmtWhen(e.savedAt)} · ` : ''}{t(SOURCE_LABELS[e.source] || 'dlg.src.snapshot')} · {fmtSize(e.bytes || 0)}
                        {e.boundFile ? ` · ${baseName(e.boundFile)}` : ''}
                      </span>
                    </div>
                    <Button variant="ghost" aria-label={t('dlg.renameVersion')}
                      onClick={() => { setRenaming(e.file); setRenameInput(e.name || ''); }}>
                      <Pencil size={13} /> {t('dlg.rename')}
                    </Button>
                    <Button variant="ghost" disabled={i === 0} title={i === 0 ? t('dlg.restoreTitleLatest') : t('dlg.restoreTitle')}
                      onClick={() => onRestore(e)}>
                      <RotateCcw size={13} /> {t('dlg.restore')}
                    </Button>
                  </div>
                  {isOpen && onRestorePartial && (
                    <div className="history-select">
                      {!summary && <p className="muted">{t('dlg.loading')}</p>}
                      {summary && (
                        <>
                          <p className="muted">{t('dlg.selectiveNote')}</p>
                          {TRACKS.map((key) => {
                            const tr = summary.tracks[key] || { count: 0, clips: [] };
                            if (!tr.count) return null;
                            return (
                              <div key={key} className="history-track">
                                <label className="history-track-row">
                                  <input type="checkbox" checked={selTracks.includes(key)} onChange={() => toggleTrack(key)} />
                                  <span>{t(`dlg.list.${key}`)} · {tr.count}</span>
                                  <button type="button" className="history-clips-toggle"
                                    onClick={(ev) => { ev.preventDefault(); setOpenTrack(openTrack === key ? null : key); }}>
                                    {openTrack === key ? t('dlg.hideClips') : t('dlg.showClips')}
                                  </button>
                                </label>
                                {openTrack === key && tr.clips.map((c) => (
                                  <label key={c.id || c.label} className="history-clip-row">
                                    <input type="checkbox" disabled={selTracks.includes(key)}
                                      checked={selClips.includes(`${key}:${c.id}`)}
                                      onChange={() => toggleClip(key, c.id)} />
                                    <span>{c.label || c.id}</span>
                                  </label>
                                ))}
                              </div>
                            );
                          })}
                          <div className="history-select-actions">
                            <Button variant="ghost" disabled={selCount === 0}
                              onClick={() => onRestorePartial(e, selection())}>
                              {t('dlg.restoreSelected', { count: selCount })}
                            </Button>
                            <Button variant="ghost" onClick={() => onRestore(e)}>{t('dlg.restoreWhole')}</Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {compareSel.length === 2 && (
          <div className="history-diff" role="status">
            <b>{t('dlg.comparing', { a: labelFor(compareSel[0]), b: labelFor(compareSel[1]) })}</b>
            {diffBusy && <p className="muted">{t('dlg.loading')}</p>}
            {!diffBusy && diff && (
              <>
                {diff.title && <p>{t('dlg.nameLine', { from: diff.title.from || t('common.untitled'), to: diff.title.to || t('common.untitled') })}</p>}
                <p>{t('dlg.durationLine', { from: fmtDur(diff.duration.from), to: fmtDur(diff.duration.to) })}</p>
                {TRACKS.map((key) => {
                  const tr = diff.tracks[key];
                  if (!tr || (tr.before === tr.after && !tr.added.length && !tr.removed.length)) return null;
                  return (
                    <p key={key}>
                      {t(`dlg.list.${key}`)}: {tr.before} → {tr.after}
                      {tr.added.length ? ` · ${t('dlg.added', { count: tr.added.length })} (${tr.added.slice(0, 3).join(', ')})` : ''}
                      {tr.removed.length ? ` · ${t('dlg.removed', { count: tr.removed.length })} (${tr.removed.slice(0, 3).join(', ')})` : ''}
                    </p>
                  );
                })}
                {diff.mediaAdded.length > 0 && <p>{t('dlg.mediaAdded', { names: diff.mediaAdded.slice(0, 3).join(', ') })}</p>}
                {diff.mediaRemoved.length > 0 && <p>{t('dlg.mediaRemoved', { names: diff.mediaRemoved.slice(0, 3).join(', ') })}</p>}
                {!diff.title && diff.duration.delta === 0 && !diff.mediaAdded.length && !diff.mediaRemoved.length
                  && TRACKS.every((key) => diff.tracks[key].before === diff.tracks[key].after && !diff.tracks[key].added.length && !diff.tracks[key].removed.length)
                  && <p className="muted">{t('dlg.noDiff')}</p>}
              </>
            )}
            {!diffBusy && !diff && <p className="muted">{t('dlg.diffFailed')}</p>}
            <Button variant="ghost" onClick={() => setCompareSel([])}>{t('dlg.clearCompare')}</Button>
          </div>
        )}
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}>{t('dlg.done')}</Button>
        </div>
      </div>
    </div>
  );
}
