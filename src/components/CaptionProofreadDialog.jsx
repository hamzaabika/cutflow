// Caption proofreading dialog (FB-25 / P1-34): one row per caption clip —
// editable text, speaker label and start/end times, with flags for a
// missing sentence-final punctuation mark and for a token that looks like
// a mistyped proper noun. Applying writes every changed row in a single
// undo step (store action `proofreadCaptions`); word timings are
// re-aligned to the edited text so karaoke survives a one-word fix.
import React, { useMemo, useState } from 'react';
import { useT } from '../i18n/index.jsx';
import { captionRows, nameFlags, punctuationFlag, realignWords, DEFAULT_NAMES } from '../proofread.js';

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export default function CaptionProofreadDialog({ project, onApply, onClose }) {
  const t = useT();
  const rows = useMemo(() => captionRows(project), [project]);
  const [edits, setEdits] = useState({}); // id -> { text, speaker, start, end }
  const [names, setNames] = useState(DEFAULT_NAMES.join(', '));
  const nameList = useMemo(() => names.split(',').map((s) => s.trim()).filter(Boolean), [names]);
  const speakers = useMemo(() => [...new Set(rows.map((r) => r.speaker).filter(Boolean))], [rows]);

  const edit = (id) => edits[id] || {};
  const set = (id, patch) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const row = (r) => ({ text: edit(r.id).text ?? r.text, speaker: edit(r.id).speaker ?? r.speaker, start: edit(r.id).start ?? r.start, end: edit(r.id).end ?? r.end });

  const changed = rows.filter((r) => {
    const e = edit(r.id);
    return (e.text != null && e.text !== r.text) || (e.speaker != null && e.speaker !== r.speaker)
      || (e.start != null && Math.abs(e.start - r.start) > 0.001) || (e.end != null && Math.abs(e.end - r.end) > 0.001);
  });

  const apply = () => {
    const patches = changed.map((r) => {
      const e = row(r);
      const textChanged = e.text !== r.text;
      return {
        id: r.id,
        patch: {
          text: e.text,
          speaker: e.speaker || undefined,
          start: Math.max(0, e.start),
          duration: Math.max(0.2, e.end - Math.max(0, e.start)),
          // A text edit re-aligns the word timings instead of dropping
          // them; an unchanged text keeps its timings untouched.
          ...(textChanged ? { words: realignWords(r.words, r.text, e.text) } : {}),
        },
      };
    });
    onApply(patches);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('proofread.title')}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bridge-modal proofread-modal">
        <h3>{t('proofread.title')}</h3>
        <p className="muted small">{t('proofread.help')}</p>
        <label className="proofread-names">
          {t('proofread.namesLabel')}
          <input value={names} onChange={(e) => setNames(e.target.value)} />
        </label>
        <div className="proofread-rows">
          {rows.map((r) => {
            const e = row(r);
            const punct = punctuationFlag(e.text);
            const namesHit = nameFlags(e.text, nameList);
            return (
              <div key={r.id} className="proofread-row">
                <div className="proofread-times">
                  <input type="number" step="0.1" min="0" value={e.start.toFixed(1)} aria-label={t('proofread.start')}
                    onChange={(ev) => set(r.id, { start: Number(ev.target.value) || 0 })} />
                  <span>–</span>
                  <input type="number" step="0.1" min="0" value={e.end.toFixed(1)} aria-label={t('proofread.end')}
                    onChange={(ev) => set(r.id, { end: Number(ev.target.value) || 0 })} />
                  <span className="muted small">{fmt(r.start)}</span>
                </div>
                <input className="proofread-speaker" value={e.speaker} placeholder={t('proofread.speakerPh')}
                  list="proofread-speakers" aria-label={t('proofread.speaker')}
                  onChange={(ev) => set(r.id, { speaker: ev.target.value })} />
                <datalist id="proofread-speakers">{speakers.map((s) => <option key={s} value={s} />)}</datalist>
                <textarea className="proofread-text" value={e.text} dir="auto" rows={2} aria-label={t('proofread.text')}
                  onChange={(ev) => set(r.id, { text: ev.target.value })} />
                <div className="proofread-flags">
                  {punct && <span className="proofread-flag">{t('proofread.missingEnd')}</span>}
                  {namesHit.map((h) => (
                    <span key={h.token} className="proofread-flag">
                      {t('proofread.nameMaybe', { token: h.token, name: h.suggest })}
                      {' '}
                      <button type="button" className="btn btn-sm btn-ghost"
                        onClick={() => set(r.id, { text: e.text.split(/\s+/).map((w) => (w.replace(/[.,!?؟،;:…()«»"']/g, '') === h.token ? h.suggest : w)).join(' ') })}>
                        {t('proofread.useName', { name: h.suggest })}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
          {!rows.length && <p className="muted">{t('proofread.empty')}</p>}
        </div>
        <div className="modal-actions">
          <span className="muted small">{t('proofread.changed', { n: changed.length })}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn" disabled={!changed.length} onClick={apply}>{t('proofread.apply')}</button>
        </div>
      </div>
    </div>
  );
}
