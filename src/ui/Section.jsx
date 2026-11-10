import React, { useCallback, useState } from 'react';
import { ChevronDown } from '../icons.jsx';

// Collapsible inspector sections (R3): every section/card in the properties
// panel can be folded away, and the choice is remembered on this PC — the
// stored set holds only the COLLAPSED ids (absence = open), so a section the
// user has never touched renders exactly as it did before this existed.
// Storage is best-effort: a blocked/full localStorage just loses persistence,
// never the toggle itself.

const KEY = 'clipcraft.sections.v1';

function loadCollapsed() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function saveCollapsed(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* persistence is a convenience */ }
}

// [open, toggle] for one section id. Ids are namespaced by surface at the
// call site ("video:transform", "text:fill", "fx:region"…).
export function useSectionOpen(id) {
  const [open, setOpen] = useState(() => !loadCollapsed().has(id));
  const toggle = useCallback(() => {
    setOpen((was) => {
      const set = loadCollapsed();
      if (was) set.add(id); else set.delete(id);
      saveCollapsed(set);
      return !was;
    });
  }, [id]);
  return [open, toggle];
}

// The one chevron button every collapsible head carries.
export function SectionChevron({ open, onToggle, label }) {
  return (
    <button type="button" className={`icon-btn sm section-chev ${open ? 'open' : ''}`}
      aria-expanded={open} aria-label={label} title={label} onClick={onToggle}>
      <ChevronDown size={14} />
    </button>
  );
}

// The inspector's card (the .insp-card surface), collapsible: a head row with
// the micro-label title, an optional right-hand control (the card's own
// enable switch, say) and the chevron; the body keeps the card's field rhythm.
// Without an id the card renders as the plain, always-open card it replaces.
export function InspCard({ id, title, right = null, className = '', children }) {
  const [open, toggle] = useSectionOpen(id || '\0static');
  if (!id) return <div className={`insp-card ${className}`}>{title && <div className="insp-card-title">{title}</div>}{children}</div>;
  return (
    <div className={`insp-card collapsible ${open ? '' : 'collapsed'} ${className}`}>
      <div className="insp-card-head">
        <span className="insp-card-title">{title}</span>
        {right}
        <SectionChevron open={open} onToggle={toggle} label={`${open ? 'Collapse' : 'Expand'} ${title}`} />
      </div>
      <div className="insp-card-body">{children}</div>
    </div>
  );
}
