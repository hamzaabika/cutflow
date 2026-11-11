import React, { useEffect } from 'react';
import { useT } from '../i18n/index.jsx';

// First-run welcome (B3, 2026-11-01 — replaces the multi-step onboarding tour):
// ONE card on a dimmed editor backdrop — the Cutflow logo, a greeting, one line,
// and a single "Start creating" button. It shows exactly once, on the first entry
// into a project (App owns the trigger and the persisted seen flag, unchanged from
// the tour's semantics); dismissing it ends the first-run flow — nothing follows it.
export default function WelcomeCard({ onClose }) {
  const t = useT();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="welcome-root" role="dialog" aria-modal="true" aria-label={t('welcome.aria')}>
      <div className="welcome-dim" />
      <div className="welcome-card">
        <span className="welcome-halo"><img src="./logo.png" alt="" draggable={false} /></span>
        <h3>{t('welcome.title')}</h3>
        <p>{t('welcome.text')}</p>
        <button className="btn btn-primary welcome-go" autoFocus onClick={onClose}>{t('welcome.start')}</button>
      </div>
    </div>
  );
}
