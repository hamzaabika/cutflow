// Reduced-motion flag for the shared text renderer (P2-39, UX-07). Pure
// and import-free, so both the renderer and the accessibility settings can
// share it without dragging the font/CSS import chain into Node tests.
let reducedMotion = false;
export function setTextReducedMotion(on) { reducedMotion = on === true; }
export function textReducedMotion() { return reducedMotion; }
