import React from 'react';
import { ShieldCheck, X } from '../icons.jsx';
import Button from '../ui/Button.jsx';
import { useT } from '../i18n/index.jsx';
import { AI_INVENTORY, internetBadge, keyBadge, placementBadge } from '../aiInventory.js';

// AI & privacy inventory (FB-23 / P1-32): every AI feature in one list,
// each labelled Local / Remote, Needs internet / Works offline, Needs an
// API key / No key — plus which provider it talks to, what that provider
// receives, and what it costs. The same table lives in
// docs/ai-labelling-inventory.md and src/aiInventory.js; the inventory
// test fails when a row is missing a field. Keys are stored encrypted in
// Settings and never leave the main process; provider error text is
// redacted before it reaches this screen.
export default function AiInventoryDialog({ onClose }) {
  const t = useT();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ai-inventory-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal bridge-modal">
        <div className="modal-icon"><ShieldCheck size={24} /></div>
        <h3 id="ai-inventory-title">{t('ai.inventoryTitle')}</h3>
        <p className="muted">{t('ai.inventoryNote')}</p>
        <p className="muted small">{t('ai.inventoryCosts')}</p>
        <div className="history-list">
          {AI_INVENTORY.map((row) => (
            <div key={row.id} className="history-row bridge-row">
              <div className="history-info">
                <span className="history-when">{t(row.feature)} · <span className="muted">{t(row.where)}</span></span>
                <span className="bridge-diff-line">
                  <b>{t(placementBadge(row))}</b>{' · '}{t(internetBadge(row))}{' · '}{t(keyBadge(row))}
                </span>
                <span className="bridge-diff-line">{t('ai.inventoryProvider', { provider: t(row.provider) })}</span>
                <span className="bridge-diff-line">{t('ai.inventoryReceives', { what: t(row.receives) })}</span>
                <span className="bridge-diff-line">{t('ai.inventoryCost', { cost: t(row.cost) })}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="muted small">{t('ai.inventoryKeys')}</p>
        <div className="modal-actions">
          <Button variant="primary" onClick={onClose}><X size={13} /> {t('common.close')}</Button>
        </div>
      </div>
    </div>
  );
}
