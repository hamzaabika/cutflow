// Accessibility settings (P2-39, UX-07): Reduce Motion + Reduce Flashing.
// Pure resolution + application: an explicit stored choice wins; unset
// follows the OS prefers-reduced-motion media query. Applied as classes on
// <html> (CSS stills UI animation / hides the flash overlay) and as a flag
// in the shared text renderer (flicker/glitch motion degrades to fades in
// both preview and export, so the two never disagree).

import { setTextReducedMotion } from './text/reducedMotion.js';

export function resolveAccessibility(settings) {
  const osReduced = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduceMotion = settings && settings.reduceMotion != null ? settings.reduceMotion === true : osReduced;
  const reduceFlashing = settings && settings.reduceFlashing != null ? settings.reduceFlashing === true : osReduced;
  return { reduceMotion, reduceFlashing };
}

export function applyAccessibilitySettings(settings) {
  const { reduceMotion, reduceFlashing } = resolveAccessibility(settings);
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
    document.documentElement.classList.toggle('reduce-flashing', reduceFlashing);
  }
  setTextReducedMotion(reduceMotion || reduceFlashing);
  return { reduceMotion, reduceFlashing };
}
