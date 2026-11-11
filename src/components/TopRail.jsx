import React, { useCallback, useEffect, useRef, useState } from 'react';
import Tabs from '../ui/Tabs.jsx';
import { TABS } from './LeftPanel.jsx';
import { ChevronLeft, ChevronRight } from '../icons.jsx';
import { useT } from '../i18n/index.jsx';

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
// at laptop widths, so scroll buttons page through the rest. That day's
// review first settled on a lone forward "»" with NO left arrow — reversed
// the same night by Hamza's screenshot of the strip (Transitions … Forge)
// and his order that the missing back button be restored: an explicit
// LEFT + RIGHT pair (‹ ›), each rendered only while content hides on
// its own side — at the strip's start the ‹ is absent entirely, at the
// far end the › is, mid-scroll both show. The pair first shipped
// grouped in one sticky cell at the strip's right edge (257beac).
// Hamza rejected the grouping the same night — "the left button goes
// on the left, the right button goes on the right" — so the buttons
// now sit at OPPOSITE ends of the strip: ‹ pinned to the physical left
// end (seam on its right), › pinned to the physical right end (seam on
// its left), each pointing at the content hidden on its own side.
// Wheel/trackpad scrolling still moves the strip both ways natively.
//
// The buttons are overlays on the wrap, absolutely pinned to its
// physical ends (the next one just inside the wrap's right gutter), and
// the nav takes matching end padding while a button shows so the
// first / last tab rests clear of it; the rest of the time tabs scroll
// under the opaque cells. The wrap reserves a 30px gutter at its right
// end (styles.css .toprail-wrap) so the corner beyond the › carries
// App's absolutely positioned panel-hide ‹ (top: 6px at
// panes.left − 30) alone — no stacking. In-row sticky cells were tried
// first for the ends: they hold in LTR, but in the RTL scroller
// Chromium does not hold a sticky element at its physical end — the
// buttons drifted with the content (measured in the 2026-11-11 CDP
// drive) — so the ends are absolute insets, physical by construction.
//
// Direction: the strip follows the document direction (it is NOT one of
// the dir="ltr" islands). In the Arabic RTL layout the overflow extends
// LEFTWARD and Chromium reports scrollLeft in a negative range (0 at the
// start → −max at the end). The buttons keep their physical ends and
// chevron directions in both layouts; the measurements and the nudge
// normalise by the computed direction, so a button always pages toward
// the side its chevron points to — in RTL the left-end button borrows
// the end-side measurement, because that is where its hidden content is.
export default function TopRail({ tab, setTab }) {
  const t = useT();
  const tabs = TABS.map((tb) => (tb.sep ? tb : { ...tb, name: t(`panel.tab.${tb.id}`) }));
  const active = TABS.some((x) => x.id === tab) ? tab : 'media';
  const navRef = useRef(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [rtl, setRtl] = useState(false);
  const measure = useCallback(() => {
    const el = navRef.current;
    if (!el) return;
    // Distance scrolled from the strip's start, direction-normalised: in
    // RTL Chromium's scrollLeft runs 0 → −max, so negate it there before
    // comparing against the two ends.
    const isRtl = getComputedStyle(el).direction === 'rtl';
    const max = el.scrollWidth - el.clientWidth;
    const fromStart = isRtl ? -el.scrollLeft : el.scrollLeft;
    setRtl(isRtl);
    setCanLeft(fromStart > 2);
    setCanRight(fromStart < max - 2);
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
  // The end measurements depend on the direction and on the tab labels'
  // widths, both of which change with the UI language: re-measure after
  // every render, not only on scroll/resize, so a language switch settles
  // the buttons' visibility at once.
  useEffect(() => { measure(); });
  const nudge = (dir) => {
    const el = navRef.current;
    if (!el) return;
    // dir is logical: +1 pages toward the strip's end, −1 back toward its
    // start. The physical scrollBy delta flips sign in RTL, where
    // scrollLeft decreases toward the end.
    const step = Math.max(220, el.clientWidth - 72);
    const delta = (getComputedStyle(el).direction === 'rtl' ? -dir : dir) * step;
    el.scrollBy({ left: delta, behavior: 'smooth' });
  };
  // side is physical: −1 for the left-end button, +1 for the right-end
  // one. The logical direction flips in RTL, where the strip's end (and
  // its overflow) sits on the left.
  const nudgeSide = (side) => {
    const el = navRef.current;
    if (!el) return;
    nudge(getComputedStyle(el).direction === 'rtl' ? -side : side);
  };
  // Visibility follows the hidden content, not a disabled state (Hamza):
  // a button renders only while content hides on the side its chevron
  // points to, and the strip reclaims the freed cell when it goes. In
  // LTR the left side hides start-side content; in RTL the left side is
  // where the end-side overflow hides, so each button borrows the other
  // side's measurement there.
  const showPrev = rtl ? canRight : canLeft;
  const showNext = rtl ? canLeft : canRight;
  // The buttons are overlays pinned to the wrap's physical ends — prev
  // at left:0, next just inside the right gutter (styles.css, the
  // "Toprail end arrows" block) — and the wrap flags has-prev / has-next
  // so the nav takes matching end padding while a button shows: the
  // first / last tab rests clear of its button, and tabs scroll under
  // the opaque cells the rest of the time. (In-row sticky cells were
  // tried first: they hold in LTR, but in the RTL scroller Chromium
  // does not hold a sticky element at its physical end — the buttons
  // drifted with the content, measured in the 2026-11-11 CDP drive.
  // Absolute insets are physical by construction in both directions.)
  return (
    <div className={`toprail-wrap${showPrev ? ' has-prev' : ''}${showNext ? ' has-next' : ''}`}>
      <Tabs tabs={tabs} active={active} onChange={setTab} ariaLabel={t('panel.library')}
        navClassName="toprail" btnClassName="toprail-btn" iconSize={18}
        navRef={navRef} onScroll={measure} />
      {showPrev && (
        <div className="toprail-end toprail-end-prev">
          <button type="button" className="toprail-arrow" aria-label={t('panel.media.prevTabs')}
            onClick={() => nudgeSide(-1)}>
            <ChevronLeft size={18} />
          </button>
        </div>
      )}
      {showNext && (
        <div className="toprail-end toprail-end-next">
          <button type="button" className="toprail-arrow" aria-label={t('panel.media.nextTabs')}
            onClick={() => nudgeSide(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
