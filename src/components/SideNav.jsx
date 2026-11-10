import React, { useState } from 'react';
import { ChevronDown } from '../icons.jsx';

// Category column on the left of a library tab: plain items, actions (e.g. Import) and groups that
// fold open (Music > Vlog, Funny…). items: [{ id, label, icon, action, count, children: [{ id, label, count }] }].
// `count` (10/10 step 5) renders as a quiet right-aligned figure — the library taxonomy carries
// per-category counts so a big library reads as navigable, not just long.
export default function SideNav({ items, value, onChange, label = 'Categories' }) {
  const groupOf = (v) => items.find((it) => it.children && it.children.some((c) => c.id === v))?.id;
  // One group open at a time, so the column stays short.
  const [openId, setOpenId] = useState(() => groupOf(value) || null);
  const toggle = (id) => setOpenId((cur) => (cur === id ? null : id));
  return (
    <nav className="side-nav" aria-label={label}>
      {items.map((it) => {
        const Icon = it.icon;
        if (it.children) {
          const isOpen = openId === it.id;
          const inside = groupOf(value) === it.id;
          return (
            <div key={it.id} className="side-group">
              <button className={`side-btn group ${inside ? 'inside' : ''}`} aria-expanded={isOpen} title={it.label}
                onClick={() => {
                  // Opening a group shows its first category.
                  if (!isOpen && !inside) onChange(it.children[0].id);
                  toggle(it.id);
                }}>
                {Icon && <Icon size={14} />}<span>{it.label}</span>{it.count != null && <span className="side-count">{it.count}</span>}<ChevronDown size={14} className="side-chev" />
              </button>
              {isOpen && (
                <div className="side-children">
                  {it.children.map((c) => (
                    <button key={c.id} className={`side-btn child ${value === c.id ? 'on' : ''}`} aria-current={value === c.id ? 'true' : undefined} title={c.label}
                      onClick={() => onChange(c.id)}><span>{c.label}</span>{c.count != null && <span className="side-count">{c.count}</span>}</button>
                  ))}
                </div>
              )}
            </div>
          );
        }
        return (
          <button key={it.id} className={`side-btn ${!it.action && value === it.id ? 'on' : ''}`} aria-current={!it.action && value === it.id ? 'true' : undefined} title={it.label}
            onClick={() => (it.action ? it.action() : onChange(it.id))}>
            {Icon && <Icon size={14} />}<span>{it.label}</span>{it.count != null && <span className="side-count">{it.count}</span>}
          </button>
        );
      })}
    </nav>
  );
}

// A library tab: optional category column + scrolling content.
export function TabFrame({ nav, children }) {
  return (
    <div className={`tab-frame ${nav ? 'with-nav' : ''}`}>
      {nav}
      <div className="tab-content">{children}</div>
    </div>
  );
}
