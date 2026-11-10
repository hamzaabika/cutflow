// The legacy per-clip Adjust settings (clip.adjust: brightness / contrast / saturation / hue / blur),
// as ONE expression in the shared effect language — the Sprint 6 unification.
//
// Before this module the same five numbers had three interpretations: CSS filters in the
// preview (src/effects.js clipCss), FFmpeg eq/hue/boxblur approximations in the export's
// look filters, and nothing at all when the preview's canvas path was active (CSS on the
// hidden media element never reaches the drawn canvas, so an adjusted clip under any
// shader effect silently lost its adjustment in the preview). Now clip.adjust is a pass
// in pixelPasses (src/fx/apply.js) like every other look: the preview's WebGL, the
// export's effects pass and the CPU reference all evaluate this one expression, so the
// preview frame and the exported frame are the same picture by construction.
//
// The canonical interpretation is the one the preview always promised (the CSS filter
// semantics the settings were authored against):
//   brightness b in [-1, 1]  -> channel * (1 + b)
//   contrast   c in [0, 2]   -> (channel - 0.5) * c + 0.5          (after brightness)
//   saturation s in [0, 3]   -> the CSS/SVG saturate() matrix (luma weights 0.213/0.715/0.072)
//   hue        h in degrees  -> the CSS/SVG hueRotate() matrix
//   blur       px in [0, 20] -> a 9-tap box blur of radius round(blur * W / 640) — the
//                               scaling the old export used, now applied to the source
//                               BEFORE the colour stages. That order is exact, not an
//                               approximation: every colour stage above is an affine
//                               map, and affine maps commute with a normalised box
//                               blur, so blur-then-colour == colour-then-blur (the
//                               CSS list order) bit-for-bit up to rounding.

import { DEFAULT_ADJUST } from '../effects.js';

export const ADJUST_DEFAULTS = DEFAULT_ADJUST;

export const adjustOf = (clip) => ({ ...ADJUST_DEFAULTS, ...(clip?.adjust || {}) });

export function hasAdjust(clip) {
  const a = adjustOf(clip);
  return a.brightness !== 0 || a.contrast !== 1 || a.saturation !== 1 || a.hue !== 0 || a.blur !== 0;
}

const n = (v) => {
  const s = Number(v.toFixed(5)).toString();
  return s.includes('e') ? Number(v).toFixed(6) : s;
};

// One channel's blurred source sample (register 0 holds the radius while taps are read).
const tapAvg = (F) => `(${F}(X, Y)*2 + ${F}(X+ld(0), Y) + ${F}(X-ld(0), Y) + ${F}(X, Y+ld(0)) + ${F}(X, Y-ld(0)) + ${F}(X+ld(0), Y+ld(0)) + ${F}(X-ld(0), Y-ld(0)) + ${F}(X+ld(0), Y-ld(0)) + ${F}(X-ld(0), Y+ld(0)))/10`;

// The adjust pass expression, or null when every setting is at its default.
export function adjustExpr(adjust) {
  const a = { ...ADJUST_DEFAULTS, ...(adjust || {}) };
  if (a.brightness === 0 && a.contrast === 1 && a.saturation === 1 && a.hue === 0 && a.blur === 0) return null;
  const steps = [];
  if (a.blur > 0) {
    // Radius in source pixels, the old export's W/640 scaling of the stored px value.
    steps.push(`st(0, max(1, floor(${n(a.blur)} * W / 640 + 0.5)))`);
    steps.push(`st(5, ${tapAvg('PR')})`, `st(6, ${tapAvg('PG')})`, `st(7, ${tapAvg('PB')})`);
  } else {
    steps.push('st(5, PR(X, Y))', 'st(6, PG(X, Y))', 'st(7, PB(X, Y))');
  }
  let R = 'ld(5)/255';
  let G = 'ld(6)/255';
  let B = 'ld(7)/255';
  if (a.brightness !== 0) {
    const f = n(1 + a.brightness);
    R = `(${R})*${f}`; G = `(${G})*${f}`; B = `(${B})*${f}`;
  }
  if (a.contrast !== 1) {
    const f = n(a.contrast);
    R = `((${R}) - 0.5)*${f} + 0.5`; G = `((${G}) - 0.5)*${f} + 0.5`; B = `((${B}) - 0.5)*${f} + 0.5`;
  }
  if (a.saturation !== 1) {
    const s = a.saturation;
    const m = [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    const mix = (row) => `${n(row[0])}*(${R}) + ${n(row[1])}*(${G}) + ${n(row[2])}*(${B})`;
    [R, G, B] = [mix(m[0]), mix(m[1]), mix(m[2])];
  }
  if (a.hue !== 0) {
    const rad = (a.hue * Math.PI) / 180;
    const co = Math.cos(rad);
    const si = Math.sin(rad);
    const m = [
      [0.213 + 0.787 * co - 0.213 * si, 0.715 - 0.715 * co - 0.715 * si, 0.072 - 0.072 * co + 0.928 * si],
      [0.213 - 0.213 * co + 0.143 * si, 0.715 + 0.285 * co + 0.140 * si, 0.072 - 0.072 * co - 0.283 * si],
      [0.213 - 0.213 * co - 0.787 * si, 0.715 - 0.715 * co + 0.715 * si, 0.072 + 0.928 * co + 0.072 * si],
    ];
    const mix = (row) => `${n(row[0])}*(${R}) + ${n(row[1])}*(${G}) + ${n(row[2])}*(${B})`;
    [R, G, B] = [mix(m[0]), mix(m[1]), mix(m[2])];
  }
  steps.push(`st(0, C(${R}, ${G}, ${B}))`);
  steps.push('clip(ld(0), 0, 1) * 255');
  return steps.join('; ');
}
