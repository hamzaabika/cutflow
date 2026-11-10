import React from 'react';

// The kit's tab bar: a <nav> of tab buttons in the stylesheet's .tab-btn
// geometry (the dock's .dock-btn pairing is the default dress). Each tab is
// { id, name, icon } — the icon is a lucide-style component rendered at the
// caller's size. An entry of { sep: true } renders a thin divider instead of a
// button (the dock uses one to group workspace-level tools under the library
// categories). Selection is fully controlled: `active` in, onChange(id) out.
// navRef / onScroll exist for the dock's overflow measurement; other surfaces
// can ignore them. `trailing` renders extra content inside the nav after the
// last tab (the library rail's sticky "more tabs" arrow). DOM and classes
// match what surfaces wrote by hand, so the .tab-btn styles (and anything
// keyed on them) apply unchanged.
export default function Tabs({
  tabs, active, onChange, ariaLabel,
  navClassName = 'dock tabbar', btnClassName = 'dock-btn tab-btn',
  iconSize = 19, iconStrokeWidth = 1.8, navRef, onScroll, trailing,
}) {
  return (
    <nav className={navClassName} aria-label={ariaLabel} ref={navRef} onScroll={onScroll}>
      {tabs.map((t, i) => {
        if (t.sep) return <div key={`sep-${i}`} className="dock-sep" role="separator" aria-hidden="true" />;
        const Icon = t.icon;
        const on = active === t.id;
        return (
          <button key={t.id} className={`${btnClassName} ${on ? 'active' : ''}`} onClick={() => onChange(t.id)}
            aria-pressed={on} title={t.name}>
            {Icon && <Icon size={iconSize} strokeWidth={iconStrokeWidth} aria-hidden="true" />}
            <span>{t.name}</span>
          </button>
        );
      })}
      {trailing}
    </nav>
  );
}
