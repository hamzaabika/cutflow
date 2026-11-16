// Skin-tone controls (P2-19): skin lives in the orange HSL band, so the
// skin sliders are a focused front-end for grade.hsl.orange — the same
// engine the preview and the export already share (gradeExpr), so a skin
// adjustment can never diverge between them. Skin detection (hue 8–48°,
// saturation > 0.18, mid luma) is used by shot matching to weight skin
// pixels when it measures a frame.

export const SKIN_HUE_MIN = 8;
export const SKIN_HUE_MAX = 48;
export const SKIN_SAT_MIN = 0.18;

const clamp100 = (v) => Math.max(-100, Math.min(100, Math.round(Number(v) || 0)));

// RGB (0..1) -> HSL hue in degrees + saturation (0..1) + lightness.
export function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (mx === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

export function isSkinPixel(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  return h >= SKIN_HUE_MIN && h <= SKIN_HUE_MAX && s > SKIN_SAT_MIN && l > 0.12 && l < 0.92;
}

// The grade patch a skin adjustment makes: { hsl: { orange: { h, s, l } } }.
// Values are the HSL-panel ranges (-100..100); absent keys stay 0.
export function skinPatch({ saturation = 0, hue = 0, lightness = 0 } = {}) {
  const o = { h: clamp100(hue), s: clamp100(saturation), l: clamp100(lightness) };
  if (!o.h && !o.s && !o.l) return { hsl: { orange: { h: 0, s: 0, l: 0 } } };
  return { hsl: { orange: o } };
}

// The current skin values out of a clip grade (0 when untouched).
export function skinOf(grade) {
  const o = grade?.hsl?.orange || {};
  return { saturation: Number(o.s) || 0, hue: Number(o.h) || 0, lightness: Number(o.l) || 0 };
}

// Skin statistics of sampled frames ({ data: RGB bytes }): share of skin
// pixels and their mean colour, or null when no skin is visible.
export function skinStats(frames) {
  let n = 0;
  let skin = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const f of frames || []) {
    const d = f.data;
    if (!d) continue;
    for (let i = 0; i + 2 < d.length; i += 3) {
      n++;
      const pr = d[i] / 255;
      const pg = d[i + 1] / 255;
      const pb = d[i + 2] / 255;
      if (isSkinPixel(pr, pg, pb)) {
        skin++;
        r += pr;
        g += pg;
        b += pb;
      }
    }
  }
  if (!skin) return null;
  return { share: skin / Math.max(1, n), mean: [r / skin, g / skin, b / skin] };
}
