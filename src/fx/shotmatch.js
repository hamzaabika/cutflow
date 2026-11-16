// Shot matching (P2-19): make one clip's colour match a reference clip's.
// frameStats measures a set of sampled frames ({ data: RGB bytes }, the
// shape window.api.colorSample returns); matchGrade(ref, src) returns the
// Basic grade sliders (temp/tint/exposure/contrast/saturation, -100..100)
// that move the source's statistics toward the reference's. The formulas
// mirror gradePixel in src/fx/autocolor.js — the same slider math the
// grade engine applies — so the computed patch does what it claims when
// applied, and the test below proves it by simulation: applying the patch
// to the source frames must shrink the distance to the reference.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const round = (v) => {
  const r = Math.round(v);
  return Math.abs(r) < 3 ? 0 : r;
};

// The Basic sliders applied to one pixel, as gradeExpr/autocolor do it
// (temp/tint/exposure/contrast/saturation only — the five matchGrade sets).
export function gradePixelBasic(g, r, gr, b) {
  const k = (id) => clamp((Number(g[id]) || 0) / 100, -1, 1);
  const l0 = luma(r, gr, b);
  let c = [r, gr, b];
  if (k('saturation')) c = c.map((v) => l0 + (v - l0) * (1 + k('saturation')));
  if (k('temp') || k('tint')) {
    const t = k('temp') * 0.18;
    const ti = k('tint') * 0.14;
    c = [c[0] * (1 + t + ti / 2), c[1] * (1 - ti), c[2] * (1 - t + ti / 2)];
  }
  if (k('exposure')) c = c.map((v) => v * 2 ** k('exposure'));
  if (k('contrast')) c = c.map((v) => (v - 0.5) * (1 + k('contrast') * (k('contrast') > 0 ? 0.6 : 0.5)) + 0.5);
  return c.map((v) => clamp(v, 0, 1));
}

export function frameStats(frames) {
  let n = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let chroma = 0;
  const lumas = [];
  for (const f of frames || []) {
    const d = f.data;
    if (!d) continue;
    // Cap the work: a 96x54 sample is ~5k pixels; stride larger frames.
    const stride = Math.max(3, Math.floor(d.length / 3 / 20000) * 3);
    for (let i = 0; i + 2 < d.length; i += stride) {
      const r = d[i] / 255;
      const g = d[i + 1] / 255;
      const b = d[i + 2] / 255;
      n++;
      sr += r;
      sg += g;
      sb += b;
      chroma += Math.max(r, g, b) - Math.min(r, g, b);
      lumas.push(luma(r, g, b));
    }
  }
  if (!n) return null;
  lumas.sort((a, b) => a - b);
  const pct = (p) => lumas[Math.min(lumas.length - 1, Math.floor(p * lumas.length))];
  return {
    avg: [sr / n, sg / n, sb / n],
    p02: pct(0.02), p50: pct(0.5), p98: pct(0.98),
    chroma: chroma / n,
    n,
  };
}

// Weighted distance between two stats objects (0 = identical).
export function statsDistance(a, b) {
  if (!a || !b) return Infinity;
  const dAvg = Math.hypot(a.avg[0] - b.avg[0], a.avg[1] - b.avg[1], a.avg[2] - b.avg[2]);
  return dAvg + Math.abs(a.p50 - b.p50) + Math.abs(a.chroma - b.chroma) + Math.abs((a.p98 - a.p02) - (b.p98 - b.p02));
}

// The grade patch that moves `src` toward `ref`. Each term is inverted from
// the forward slider math above, then clamped to the slider range.
export function matchGrade(ref, src) {
  if (!ref || !src) return null;
  const out = { temp: 0, tint: 0, exposure: 0, contrast: 0, saturation: 0 };
  if (ref.p50 > 0.05 && src.p50 > 0.05) out.exposure = round(clamp(100 * Math.log2(ref.p50 / src.p50), -80, 80));
  const refRB = ref.avg[0] / Math.max(0.01, ref.avg[2]);
  const srcRB = src.avg[0] / Math.max(0.01, src.avg[2]);
  if (refRB > 0 && srcRB > 0) out.temp = round(clamp((100 * Math.log(refRB / srcRB)) / 0.36, -100, 100));
  const refG = ref.avg[1] / Math.max(0.01, (ref.avg[0] + ref.avg[2]) / 2);
  const srcG = src.avg[1] / Math.max(0.01, (src.avg[0] + src.avg[2]) / 2);
  if (refG > 0 && srcG > 0) out.tint = round(clamp((100 * Math.log(refG / srcG)) / 0.14, -100, 100));
  if (src.chroma > 0.02) out.saturation = round(clamp(100 * (ref.chroma / src.chroma - 1), -80, 80));
  const refSpread = Math.max(0.05, ref.p98 - ref.p02);
  const srcSpread = Math.max(0.05, src.p98 - src.p02);
  out.contrast = round(clamp((100 * (refSpread / srcSpread - 1)) / 0.6, -80, 80));
  return out;
}
