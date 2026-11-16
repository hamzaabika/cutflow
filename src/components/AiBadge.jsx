// The AI badge (B-F14): a small pill that says, next to an AI feature,
// whether it runs locally or needs the network / an API key. The label is
// translated; the title spells out what it means (nothing leaves the PC
// vs. audio/text is sent to the provider).
import React from 'react';
import { useT } from '../i18n/index.jsx';

export default function AiBadge({ kind = 'api', className = '' }) {
  const t = useT();
  const k = kind === 'local' || kind === 'internet' ? kind : 'api';
  return (
    <span className={`ai-badge ai-badge--${k} ${className}`} title={t(`ai.badge.${k}Title`)}>{t(`ai.badge.${k}`)}</span>
  );
}
