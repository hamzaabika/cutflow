import React, { useCallback, useEffect, useRef, useState } from 'react';
import Tabs from '../ui/Tabs.jsx';
import { TABS } from './LeftPanel.jsx';
import { ChevronsRight } from '../icons.jsx';

// The library rail across the TOP OF THE LIBRARY COLUMN (10/10 step 5, geometry
// corrected by Hamza 2026-11-10 with the CapCut reference): the categories sit
// above the library panel only — the strip ENDS where the player begins, the
// player and inspector rise to the top beside it. Icon above label, drawn in
// Cutflow's own CONSOLE language (flat, hairline seams, violet only as the
// active signal). The rail is pure navigation: it carries the same TABS the
// old left dock carried, in the same order, and LeftPanel below renders
// whichever panel is active. Collapsing the library (Ctrl+1) collapses the
// whole column, rail included — the strip belongs to the panel it navigates.
//
// The strip never shows everything in one row (Hamza, 2026-11-10, with the
// reference screenshot): the tabs are wide enough that the strip overflows
// at laptop widths, and a double-chevron "»" pages through the rest. There
// is NO left arrow (his follow-up review the same day): the tabs are
// narrower now, and wheel/trackpad scrolling still moves the strip both
// ways natively. The "»" disables when nothing is left to reveal.
//
// The "»" is the strip's final IN-FLOW element (his screenshot review later
// that day): it renders inside the scroll row itself, sticky to the row's
// right edge so tabs slide under it — it no longer sits as a wrap-level
// sibling in the column's top-right corner, where App's absolutely
// positioned panel-hide button (‹, top: 6px at panes.left − 30) landed on
// top of its cell and the two read as a stacked pair. The wrap reserves a
// 30px gutter at its right end (styles.css .toprail-wrap) so that corner
// carries the collapse ‹ alone.
export default function TopRail({ tab, setTab }) {
  const active = TABS.some((t) => t.id === tab) ? tab : 'media';
  const navRef = useRef(null);
  const [canRight, setCanRight] = useState(false);
  const measure = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    measure();
    const el = navRef.current;
    if (!el) return undefined;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [measure]);
  const nudge = (dir) => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(220, el.clientWidth - 72), behavior: 'smooth' });
  };
  return (
    <div className="toprail-wrap">
      <Tabs tabs={TABS} active={active} onChange={setTab} ariaLabel="Library"
        navClassName="toprail" btnClassName="toprail-btn" iconSize={18}
        navRef={navRef} onScroll={measure}
        trailing={(
          <button type="button" className="toprail-arrow" aria-label="More tabs"
            disabled={!canRight} onClick={() => nudge(1)}>
            <ChevronsRight size={18} />
          </button>
        )} />
    </div>
  );
}
