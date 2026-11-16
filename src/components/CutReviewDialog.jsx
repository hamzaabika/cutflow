import React, { useMemo, useState } from 'react';
import { Scissors } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { useT } from '../i18n/index.jsx';
import { acceptedRanges, applyThreshold } from '../aiCutConfidence.js';

// Cut review (FB-24 / P1-33): AI-proposed cuts are never applied blind.
// Each row shows the cut's time range, kind, confidence and reason; the
// user accepts or rejects cuts one by one (or by confidence threshold) and
// only the accepted ones are applied, as one undo step. The dialog says
// plainly that a linked audio track is cut with the picture — the store
// preserves linked pairs through cutRanges, it does not leave them behind.
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;

export default function CutReviewDialog({ title, note, cuts, onApply, onCancel }) {
  const t = useT();
  const [minConf, setMinConf] = useState(0);
  const [accepted, setAccepted] = useState(() => new Set((cuts || []).map((_, i) => i)));
  const shown = useMemo(() => applyThreshold(cuts || [], minConf), [cuts, minConf]);
  if (!cuts) return null;
  const acceptedCuts = (cuts || []).filter((c, i) => accepted.has(i));
  const toggle = (i) => setAccepted((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const apply = () => onApply?.(acceptedRanges(acceptedCuts), acceptedCuts);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cut-review-title"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel?.()}>
      <div className="modal bridge-modal">
        <div className="modal-icon"><Scissors size={24} /></div>
        <h3 id="cut-review-title">{title || t('cuts.reviewTitle')}</h3>
        <p className="muted">{note || t('cuts.reviewNote')}</p>
        <p className="muted small">{t('cuts.linkedNote')}</p>
        <label className="field">
          <span>{t('cuts.minConfidence', { pct: Math.round(minConf * 100) })}</span>
          <input type="range" min="0" max="0.9" step="0.1" value={minConf} aria-label={t('cuts.minConfidenceAria')}
            onChange={(e) => setMinConf(Number(e.target.value))} />
        </label>
        <div className="history-list">
          {shown.map((c) => {
            const i = (cuts || []).indexOf(c);
            const pct = Math.round((c.confidence ?? 0) * 100);
            return (
              <div key={i} className="history-row bridge-row">
                <div className="history-info">
                  <label className="plan-step-check">
                    <input type="checkbox" checked={accepted.has(i)} onChange={() => toggle(i)}
                      aria-label={t('cuts.acceptAria', { from: fmt(c.start), to: fmt(c.end) })} />
                    <span className="history-when">{fmt(c.start)} – {fmt(c.end)} · {(c.end - c.start).toFixed(1)}s · {t(`cuts.kind.${c.kind}`)}</span>
                  </label>
                  <span className="bridge-diff-line">{c.reason || ''}</span>
                  <span className="bridge-diff-line" aria-label={t('cuts.confidenceAria', { pct })}>
                    {t('cuts.confidence', { pct })}
                    <span className="progress xjob-bar" aria-hidden="true" style={{ display: 'inline-block', width: 90, verticalAlign: 'middle', marginLeft: 8 }}>
                      <span style={{ display: 'block', width: `${pct}%` }} />
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
          {!shown.length && <p className="muted small">{t('cuts.noneAbove')}</p>}
        </div>
        <div className="modal-actions">
          <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={apply} disabled={!acceptedCuts.length}>
            <Scissors size={13} /> {t(acceptedCuts.length === 1 ? 'cuts.applyOne' : 'cuts.apply', { count: acceptedCuts.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}
