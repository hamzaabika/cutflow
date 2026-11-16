import React from 'react';
import { Bot, Check, CircleAlert, Trash2 } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { useT } from '../i18n/index.jsx';

// Plan review (P1-31, non-destructive AI editing): the steps FlowAI proposes,
// listed BEFORE anything touches the real project. Each step can be switched
// off (the plan recomputes from the original project), Apply swaps the whole
// planned document in as one undo step, Discard drops the plan entirely.
// The dialog shows before/after numbers and the structural diff — the same
// shape as the bridge draft review — not a rendered frame: frame-level
// before/after still needs a safe preview-override path (open remainder).
const LIST_LABELS = {
  videoClips: 'dlg.list.video', overlayClips: 'dlg.list.overlay', textClips: 'dlg.list.text', audioClips: 'dlg.list.audio', effectClips: 'dlg.list.effect',
};
const clip = (s, n = 90) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

function diffLines(t, diff) {
  if (!diff) return [];
  const lines = [];
  for (const [key, label] of Object.entries(LIST_LABELS)) {
    const c = diff.lists?.[key];
    if (!c) continue;
    const parts = [];
    if (c.added) parts.push(t('dlg.added', { count: c.added }));
    if (c.removed) parts.push(t('dlg.removed', { count: c.removed }));
    if (c.changed) parts.push(t('dlg.changed', { count: c.changed }));
    if (parts.length) lines.push(`${t(label)}: ${parts.join(', ')}`);
  }
  if (Math.abs((diff.durationAfter || 0) - (diff.durationBefore || 0)) > 0.05) {
    lines.push(t('dlg.durationLine', { from: diff.durationBefore.toFixed(1), to: diff.durationAfter.toFixed(1) }));
  }
  if (diff.nameChanged) lines.push(t('dlg.nameLine', { from: clip(diff.nameChanged.from, 40), to: clip(diff.nameChanged.to, 40) }));
  return lines;
}

export default function PlanReviewDialog({ plan, busy, onToggleStep, onApply, onDiscard, onClose }) {
  const t = useT();
  if (!plan) return null;
  const steps = plan.steps || [];
  const enabledOk = steps.filter((s) => s.enabled && s.ok);
  const lines = diffLines(t, plan.diff);
  const noChanges = plan.diff && !plan.diff.added && !plan.diff.removed && !plan.diff.changed && !plan.diff.nameChanged;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="plan-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal bridge-modal">
        <div className="modal-icon"><Bot size={24} /></div>
        <h3 id="plan-title">{t('ai.planTitle')}</h3>
        <p className="muted">{t('ai.planNote')}</p>
        {plan.partial && (
          <p className="bridge-stale"><CircleAlert size={13} /> {t('ai.planPartial', { error: plan.error || '' })}</p>
        )}
        {plan.stale && (
          <p className="bridge-stale"><CircleAlert size={13} /> {t('ai.planStale')}</p>
        )}
        <div className="history-list">
          <div className="history-row bridge-row">
            <div className="history-info">
              <span className="history-when">{t('ai.planDuration', { from: (plan.diff?.durationBefore ?? 0).toFixed(1), to: (plan.diff?.durationAfter ?? 0).toFixed(1) })}</span>
              {lines.map((l, i) => <span key={i} className="bridge-diff-line">{l}</span>)}
              {(plan.diff?.captionText || []).slice(0, 4).map((c, i) => (
                <span key={`ct${i}`} className="bridge-diff-line">{t('dlg.captionLine', { from: clip(c.from), to: clip(c.to) })}</span>
              ))}
              {noChanges && <span className="bridge-diff-line">{t('ai.planNoChanges')}</span>}
            </div>
          </div>
          {steps.map((s, i) => (
            <div key={i} className="history-row bridge-row">
              <div className="history-info">
                <label className="plan-step-check">
                  <input type="checkbox" checked={!!s.enabled} disabled={busy}
                    onChange={() => onToggleStep?.(i)} aria-label={s.label} />
                  <span className="history-when">{s.label}</span>
                </label>
                <span className="bridge-diff-line">
                  {s.ok
                    ? (s.summary || t('ai.planStepDone'))
                    : <><CircleAlert size={13} /> {t('ai.planStepFailed', { error: s.error || s.summaryError || '' })}</>}
                </span>
                {s.ok && Math.abs((s.durationAfter ?? 0) - (s.durationBefore ?? 0)) > 0.05 && (
                  <span className="bridge-diff-line muted">
                    {t('ai.planStepDuration', { from: (s.durationBefore ?? 0).toFixed(1), to: (s.durationAfter ?? 0).toFixed(1) })}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
        {busy && <p className="muted">{t('ai.planRecomputing')}</p>}
        <div className="modal-actions">
          <Button variant="ghost" onClick={onDiscard} disabled={busy}>
            <Trash2 size={13} /> {t('ai.planDiscard')}
          </Button>
          <Button variant="primary" onClick={onApply} disabled={busy || !enabledOk.length || plan.stale}>
            <Check size={13} /> {t(enabledOk.length === 1 ? 'ai.planApplyOne' : 'ai.planApply', { count: enabledOk.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}
