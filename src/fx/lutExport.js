// LUT export (spec matrix): a clip's grade -> a .cube file.
// The reverse of loading a LUT: the grade's POINTWISE transforms are baked
// into a 3D lattice by evaluating the same math gradeExpr() (src/fx/grade.js)
// uses, in JavaScript, at every lattice point. Mirrored exactly: saturation,
// temp/tint, exposure, contrast, highlight/shadow/whites/blacks/brilliance
// tones, fade, and the master + per-channel curves (via curveFn).
// NOT baked (and named in the file header): HSL shifts, sharpen/clarity
// (spatial — a 3D LUT cannot express them), vignette and particles (spatial /
// animated). A grade using only those still exports, but the .cube is the
// identity for them — the header says so.
import { DEFAULT_GRADE, curveFn, CURVE_CHANNELS, IDENTITY_CURVE } from './grade.js';

const curveOn = (pts) => Array.isArray(pts) && pts.length >= 2 && pts.some(([x, y]) => Math.abs(x - y) > 1e-4);
const curvesOn = (curves) => CURVE_CHANNELS.some((c) => curveOn(curves?.[c]));

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function gradeToCube(grade, size = 17) {
  const g = { ...DEFAULT_GRADE, ...(grade || {}) };
  const k = (id) => Math.max(-1, Math.min(1, (Number(g[id]) || 0) / 100));
  const curves = g.curves || {};
  const masterFn = curvesOn(curves) && curves.master ? curveFn(curves.master) : null;
  const chFn = ['r', 'g', 'b'].map((c) => (curves[c] ? curveFn(curves[c]) : null));
  const skipped = [];
  if (g.hsl && Object.values(g.hsl).some((v) => v && (v.h || v.s || v.l))) skipped.push('HSL shifts');
  if (k('sharpen') > 0) skipped.push('sharpen');
  if (k('clarity') > 0) skipped.push('clarity');
  if (k('vignette')) skipped.push('vignette');
  if (k('particles') > 0) skipped.push('particles');
  const lum = (r, gr, b) => 0.2126 * r + 0.7152 * gr + 0.0722 * b;
  const map = ([r, gr, b]) => {
    let [R, G, B] = [r, gr, b];
    const L = lum(R, G, B);
    if (k('saturation')) { const f = 1 + k('saturation'); R = L + (R - L) * f; G = L + (G - L) * f; B = L + (B - L) * f; }
    if (k('temp') || k('tint')) {
      const t = k('temp') * 0.18;
      const ti = k('tint') * 0.14;
      R *= 1 + t + ti / 2; G *= 1 - ti; B *= 1 - t + ti / 2;
    }
    if (k('exposure')) { const f = 2 ** k('exposure'); R *= f; G *= f; B *= f; }
    if (k('contrast')) { const f = 1 + k('contrast') * (k('contrast') > 0 ? 0.6 : 0.5); R = (R - 0.5) * f + 0.5; G = (G - 0.5) * f + 0.5; B = (B - 0.5) * f + 0.5; }
    const toneBase = k('highlight') * 0.25 * smooth(0.45, 1, L)
      + k('shadow') * 0.25 * (1 - smooth(0, 0.55, L))
      + k('whites') * 0.18 * smooth(0.7, 1, L)
      + k('blacks') * 0.15 * (1 - smooth(0, 0.3, L));
    // Brilliance (gradeExpr): mid-tones up, per channel — (1 - channel).
    const br = k('brilliance') * 0.6 * L * (1 - L);
    R += toneBase + br * (1 - R); G += toneBase + br * (1 - G); B += toneBase + br * (1 - B);
    if (k('fade') > 0) { const f = 1 - k('fade') * 0.3; R = R * f + k('fade') * 0.13; G = G * f + k('fade') * 0.13; B = B * f + k('fade') * 0.13; }
    if (masterFn) { R = masterFn(clamp01(R)); G = masterFn(clamp01(G)); B = masterFn(clamp01(B)); }
    if (chFn.some(Boolean)) {
      R = chFn[0] ? chFn[0](clamp01(R)) : R;
      G = chFn[1] ? chFn[1](clamp01(G)) : G;
      B = chFn[2] ? chFn[2](clamp01(B)) : B;
    }
    return [clamp01(R), clamp01(G), clamp01(B)];
  };
  const out = ['# Cutflow grade export — pointwise grade baked to a 3D LUT'];
  if (skipped.length) out.push(`# NOT baked (spatial/animated, a 3D LUT cannot express them): ${skipped.join(', ')}`);
  out.push(`LUT_3D_SIZE ${size}`, '');
  for (let b = 0; b < size; b++) {
    for (let gr = 0; gr < size; gr++) {
      for (let r = 0; r < size; r++) {
        const [R, G, B] = map([r / (size - 1), gr / (size - 1), b / (size - 1)]);
        out.push(`${R.toFixed(5)} ${G.toFixed(5)} ${B.toFixed(5)}`);
      }
    }
  }
  return out.join('\n') + '\n';
}
