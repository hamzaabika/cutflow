import { useCallback, useEffect, useState } from 'react';

// Panel sizes: drag the borders between the left panel, the player, the properties panel and the
// timeline. Sizes are remembered on this PC (per-user convenience only) and kept valid when the window shrinks.
//
// Panel collapse (10/10 step 4, closing the R1 deferral): either side panel can be
// collapsed to a slim rail (COLLAPSED_W px — a chevron button that brings it back),
// which hands its whole width to the player. The collapsed state persists in the
// same storage key as the sizes, per user, exactly like the R3 section folds
// (localStorage `clipcraft.layout`, absence = expanded, so pre-collapse stored
// values load expanded). Collapsing never changes the stored SIZE: expanding
// restores the panel at the width it had.
const KEY = 'clipcraft.layout';
const GAP = 6;
export const MIN = { left: 240, right: 240, player: 320, top: 220, bottom: 150 };
export const COLLAPSED_W = 26;
const TOPBAR = 48;

const defaults = () => ({ left: 460, right: 330, bottom: Math.round(window.innerHeight * 0.38) });

// Validate a stored value into { sizes, collapsed }, or null when it is not a
// usable layout (torn write, hand-edited, older shape). Sizes must all be
// finite numbers; the collapsed flags are read strictly (only literal true
// collapses), so a corrupt flag can cost a fold, never a panel.
export function parseLayoutValue(v) {
  if (!v || typeof v !== 'object') return null;
  if (![v.left, v.right, v.bottom].every((n) => Number.isFinite(n))) return null;
  return {
    sizes: { left: v.left, right: v.right, bottom: v.bottom },
    collapsed: { left: !!(v.collapsed && v.collapsed.left === true), right: !!(v.collapsed && v.collapsed.right === true) },
  };
}

export function serializeLayout(sizes, collapsed) {
  return { ...sizes, collapsed: { left: !!collapsed.left, right: !!collapsed.right } };
}

// The widths the workspace grid actually uses: a collapsed panel contributes
// its rail, an expanded one its (clamped) size. The player takes the rest, so
// collapsing is a real workspace gain, not a hidden panel behind a full column.
export function effectiveWidths(sizes, collapsed) {
  return {
    left: collapsed.left ? COLLAPSED_W : sizes.left,
    right: collapsed.right ? COLLAPSED_W : sizes.right,
  };
}

function load() {
  try {
    const parsed = parseLayoutValue(JSON.parse(localStorage.getItem(KEY) || 'null'));
    if (parsed) return parsed;
  } catch {
    // no storage: defaults
  }
  return { sizes: defaults(), collapsed: { left: false, right: false } };
}

// Keeps every panel at least its minimum size for a window of W x H.
export function clampLayout(l, W = window.innerWidth, H = window.innerHeight) {
  const room = W - 2 * GAP - 2 * GAP - MIN.player; // what the two side panels may take together
  let left = Math.max(MIN.left, Math.min(l.left, Math.min(760, room - MIN.right)));
  let right = Math.max(MIN.right, Math.min(l.right, Math.min(620, room - left)));
  if (left + right > room) left = Math.max(MIN.left, room - right);
  const bottom = Math.max(MIN.bottom, Math.min(l.bottom, H - TOPBAR - GAP * 3 - MIN.top));
  return { left: Math.round(left), right: Math.round(right), bottom: Math.round(bottom) };
}

export function useLayout() {
  const [stored, setStored] = useState(load);
  const layout = stored.sizes;
  const collapsed = stored.collapsed;
  const setLayout = useCallback((next) => {
    setStored((s) => ({ ...s, sizes: typeof next === 'function' ? next(s.sizes) : next }));
  }, []);
  const [, setSize] = useState(0);

  useEffect(() => {
    const onResize = () => setSize((n) => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(serializeLayout(layout, collapsed)));
    } catch {
      // not saved: fine
    }
  }, [layout, collapsed]);

  // Collapse or expand one side panel ('left' | 'right'). The stored size is
  // untouched: the panel comes back at the width it had.
  const toggle = useCallback((which) => {
    if (which !== 'left' && which !== 'right') return;
    setStored((s) => ({ ...s, collapsed: { ...s.collapsed, [which]: !s.collapsed[which] } }));
  }, []);

  // Starts dragging one border. which: 'left' | 'right' | 'bottom'.
  const startDrag = useCallback((which, e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const start = clampLayout(layout);
    document.body.classList.add(which === 'bottom' ? 'resizing-row' : 'resizing-col');
    const move = (ev) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      const next = { ...start };
      // A side panel grows only into the player, never into the other side panel.
      const room = window.innerWidth - 4 * GAP - MIN.player;
      if (which === 'left') next.left = Math.min(start.left + dx, room - start.right);
      if (which === 'right') next.right = Math.min(start.right - dx, room - start.left);
      if (which === 'bottom') next.bottom = start.bottom - dy;
      setLayout(clampLayout(next));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-row', 'resizing-col');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [layout]);

  const reset = useCallback((which) => {
    setLayout((l) => clampLayout({ ...l, [which]: defaults()[which] }));
  }, []);

  // Arrow keys on a focused border move it by 16 px.
  const nudge = useCallback((which, e) => {
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: -step, ArrowRight: step, ArrowUp: -step, ArrowDown: step }[e.key];
    if (d === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    setLayout((l) => clampLayout({
      ...l,
      ...(which === 'left' ? { left: l.left + d } : which === 'right' ? { right: l.right - d } : { bottom: l.bottom - d }),
    }));
  }, []);

  return { layout: clampLayout(layout), collapsed, toggle, startDrag, reset, nudge };
}
