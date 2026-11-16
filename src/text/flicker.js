// Safe-flicker envelope + word-flicker alpha (CC-03). Pure and DOM-free, so
// node tests can exercise it directly and preview/export agree by construction
// (both go through src/text/render.js, which calls these same functions).
//
// The envelope is the restrained default the spec asks for: the clip starts
// dark, shows a few uneven WEAK pulses early (never above ~0.42 alpha, never
// a full on/off flash), then settles into a smooth hold at full brightness.
// It is a pure function of progress p — deterministic, no clock, no random
// seed — so the same frame renders identically in preview and in export.
// Under Reduce Motion / Reduce Flashing the renderer does not call it at all:
// flicker presets degrade to a plain fade (see render.js animState).

export const clamp01 = (v) => Math.max(0, Math.min(1, v));

const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Three uneven weak pulses early in the animation (centres / widths / heights
// in progress units). The tallest peaks at 0.40 alpha; the gaps between them
// keep the flash rate near ~3 Hz over a ~1 s entrance — slow and dim, never
// the rapid full-screen strobing the old 'flicker' anim does. The last pulse
// has decayed to ~0 by the time the hold starts (p = 0.35), so the envelope
// never dips once the hold begins.
const PULSES = [
  [0.09, 0.028, 0.26],
  [0.2, 0.024, 0.4],
  [0.26, 0.024, 0.22],
];

export function flickerEnvelope(p) {
  const c = clamp01(p);
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  // The settled hold: nothing before 35% of the entrance, full by 75%.
  const hold = smoothstep(0.35, 0.75, c);
  let pulses = 0;
  for (const [ctr, w, a] of PULSES) {
    const d = (c - ctr) / w;
    pulses += a * Math.exp(-(d * d) / 2);
  }
  return clamp01(Math.max(hold, pulses));
}

// Highest alpha the envelope reaches before the hold starts (p < 0.35).
// Tests pin this below 0.5 so a future edit cannot silently turn the early
// pulses into full flashes.
export function flickerEarlyPeak() {
  let peak = 0;
  for (let i = 0; i <= 350; i++) peak = Math.max(peak, flickerEnvelope(i / 1000));
  return peak;
}

// Deterministic per-word blink for the wordFlicker unit: the word fades up
// through its window, blinking off on one step in four (same hash pattern as
// the decode/charFlicker scramble, so preview and export agree). Reduced
// motion skips the blink and just fades the word in.
export function wordFlickerAlpha(local, wordIndex, reducedMotion) {
  const l = clamp01(local);
  if (l <= 0) return 0;
  if (l >= 1) return 1;
  if (reducedMotion) return clamp01(l * 1.5);
  const stepN = Math.floor(l * 20);
  const hsh = (((wordIndex + 1) * 2654435761) ^ ((stepN + 1) * 40503)) >>> 0;
  const blink = hsh % 4 === 0 ? 0.15 : 1;
  return (0.3 + 0.7 * l) * blink;
}
