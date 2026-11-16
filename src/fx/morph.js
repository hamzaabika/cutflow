// True morph cut (P3-03): frame-to-frame morph analysis between the last frame
// of clip A and the first frame of clip B, plus the warp that renders it.
//
// This is a REAL warp, not a relabelled dissolve. Analysis is block matching
// (optical-flow style, pure JS, no native binary, no cloud): both boundary
// frames are reduced to luma at 128x72, each 8x8 block of A is matched against B
// in a +/-12 px window, and the winning displacements form a flow grid. The
// renderer warps A forward along the flow and B backward along it while
// crossfading, so a feature that moved between the shots visibly travels
// instead of ghosting through.
//
// Quality + fallback: every analysis carries a score (mean per-block match
// quality, 0..1) and a fallback decision. Dissimilar shots fall back to the
// dissolve expression; fast or incoherent motion in the face zone (upper
// central frame, where a talking head sits — there is no face detector
// bundled, so the guard is an explicit motion proxy, not a face claim) falls
// back rather than warping a face. A failed analysis falls back too. The
// fallback is reported, never silent: renderMorphFrame returns the decision
// and the Transition panel shows it (see getMorphReport).
//
// The flow grid is shared by the preview (Preview.jsx), the export
// (fxExport.js) and the tile renderer (fx/previews.jsx) through the cache
// below, keyed by the clip pair — so all three render the same warp.

import { mergeTrParams, transitionExpr } from './params.js';
import { fxStrengthAt, sanitizeFxKeys } from './fxKeys.js';

// Working resolution for the analysis (luma) and the flow grid.
export const MORPH_WORK_W = 128;
export const MORPH_WORK_H = 72;
export const MORPH_GRID_W = 16;
export const MORPH_GRID_H = 9;
const BLOCK_W = MORPH_WORK_W / MORPH_GRID_W; // 8
const BLOCK_H = MORPH_WORK_H / MORPH_GRID_H; // 8
const SEARCH_R = 12; // working px either way (±0.094 of the frame width)
const MATCH_Q = 0.35; // per-block quality at/above which a block counts as matched
const SCORE_FALLBACK = 0.45; // below this the shots are too dissimilar to morph
// Face-zone guard, measured on the RAW flow (before smoothing dilutes it):
// a coherent translation is exactly what the warp handles, so magnitude
// alone never trips it below the search edge (0.085 ~ 11 working px);
// incoherent motion (turning / shaking) at moderate magnitude does, as does
// a face zone that mostly cannot be matched at all (the face moved away).
const FACE_MAG_EDGE = 0.085;
const FACE_MAG_SOFT = 0.03;
const FACE_INCOHERENCE = 0.45;
const FACE_COVERAGE_MIN = 0.5;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Nearest-sampled luma at the working resolution (both frames get the same
// mapping, so any aspect distortion cancels in the comparison).
function toLuma(data, w, h) {
  const out = new Float32Array(MORPH_WORK_W * MORPH_WORK_H);
  for (let y = 0; y < MORPH_WORK_H; y++) {
    const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / MORPH_WORK_H));
    for (let x = 0; x < MORPH_WORK_W; x++) {
      const sx = Math.min(w - 1, Math.floor((x + 0.5) * w / MORPH_WORK_W));
      const i = (sy * w + sx) * 4;
      out[y * MORPH_WORK_W + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
  }
  return out;
}

// Mean absolute luma difference of block (bx,by) of A against B shifted by (dx,dy).
// Every pixel of the block is sampled: sparse sampling lets a random frame
// win by chance (the best of 441 candidates over 20 samples is far below the
// true mean difference), which would score noise as matchable.
function blockSad(a, b, bx, by, dx, dy) {
  const x0 = Math.round(bx * BLOCK_W);
  const y0 = Math.round(by * BLOCK_H);
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y0 + BLOCK_H; y++) {
    for (let x = x0; x < x0 + BLOCK_W; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= MORPH_WORK_W || ty >= MORPH_WORK_H) continue;
      sum += Math.abs(a[y * MORPH_WORK_W + x] - b[ty * MORPH_WORK_W + tx]);
      n++;
    }
  }
  return n ? sum / n / 255 : 1; // 0 = identical, ~0.33 = unrelated
}

// Analyse two RGBA frames (Uint8Array, w x h x 4). Pure function, no DOM.
const failedResult = () => ({ score: 0, coverage: 0, fallback: true, reason: 'analysis-failed', flow: new Float32Array(MORPH_GRID_W * MORPH_GRID_H * 2), gw: MORPH_GRID_W, gh: MORPH_GRID_H, meanAbsDiff: 1, centralMag: 0, centralIncoherence: 1, faceCoverage: 0 });
export function analyseMorph(a, b, w, h) {
  if (!a || !b || !w || !h || a.length < w * h * 4 || b.length < w * h * 4) {
    return failedResult();
  }
  const la = toLuma(a, w, h);
  const lb = toLuma(b, w, h);
  const gw = MORPH_GRID_W;
  const gh = MORPH_GRID_H;
  const flow = new Float32Array(gw * gh * 2);
  const matched = new Uint8Array(gw * gh);
  let qSum = 0;
  let matchedCount = 0;
  let absSum = 0;
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      let best = Infinity;
      let bestDx = 0;
      let bestDy = 0;
      for (let dy = -SEARCH_R; dy <= SEARCH_R; dy++) {
        for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
          const s = blockSad(la, lb, bx, by, dx, dy);
          // Ties (a flat block matches anywhere) break toward the SMALLEST
          // displacement — otherwise a still frame reports a phantom flow
          // from whichever corner the scan order hits first.
          if (s < best - 1e-6 || (Math.abs(s - best) <= 1e-6 && Math.abs(dx) + Math.abs(dy) < Math.abs(bestDx) + Math.abs(bestDy))) {
            best = s; bestDx = dx; bestDy = dy;
          }
        }
      }
      // Match quality from the best SAD. Calibrated on decoded footage
      // (2026-11-15): the same shot 0.2-1 s apart matches at SAD 0.008-0.02,
      // unrelated frames at 0.13-0.15 — the 0.08 knee sits in the gap, so a
      // q >= 0.35 match means SAD <= 0.052, a real correspondence.
      const q = 1 - Math.min(1, best / 0.08);
      const k = by * gw + bx;
      absSum += best;
      if (q >= MATCH_Q) {
        matched[k] = 1;
        matchedCount++;
        qSum += q;
        // Flow in frame fractions (working px / working size).
        flow[k * 2] = bestDx / MORPH_WORK_W;
        flow[k * 2 + 1] = bestDy / MORPH_WORK_H;
      }
    }
  }
  const total = gw * gh;
  const coverage = matchedCount / total;
  // Unmatched blocks count 0: the score is the mean match quality over the whole frame.
  const score = qSum / total;
  const meanAbsDiff = absSum / total;

  // Face-motion guard, on the RAW flow (before the fill/smooth below dilutes
  // it): the face zone is the upper-central frame (x 25-75%, y 0-58% — rows
  // 0..5 of 9). The metric looks at the MOVING blocks only (a static
  // background must not dilute it): centralMag is the MEDIAN of face-zone
  // flow magnitudes (the median, not the top quartile — the largest flows are
  // exactly the periodic-texture aliasing outliers), incoherence is 1 minus
  // the resultant length of their unit directions. A rigid translation —
  // however fast — is what the warp is for, so magnitude alone trips only at
  // the search edge; what trips the guard is incoherent motion, or a face
  // zone that mostly cannot be matched at all (the face moved away / turned).
  const moving = [];
  let faceMatched = 0;
  const faceTotal = 6 * 8;
  for (let by = 0; by <= 5; by++) {
    for (let bx = 4; bx <= 11; bx++) {
      const k = by * gw + bx;
      if (!matched[k]) continue;
      faceMatched++;
      const fx = flow[k * 2]; const fy = flow[k * 2 + 1];
      const m = Math.hypot(fx, fy);
      if (m > 0.01) moving.push([fx, fy, m]);
    }
  }
  const mags = moving.map((v) => v[2]).sort((p, q) => p - q);
  const centralMag = mags.length ? mags[Math.floor(mags.length / 2)] : 0;
  let ux = 0; let uy = 0;
  for (const [fx, fy, m] of moving) { ux += fx / m; uy += fy / m; }
  const resultant = moving.length ? Math.hypot(ux, uy) / moving.length : 0;
  const centralIncoherence = 1 - resultant;
  const faceCoverage = faceMatched / faceTotal;

  let fallback = false;
  let reason = 'ok';
  if (score < SCORE_FALLBACK || coverage < 0.5) { fallback = true; reason = 'dissimilar'; }
  else if (faceCoverage < FACE_COVERAGE_MIN) { fallback = true; reason = 'fast-motion'; }
  else if (moving.length >= 4 && (centralMag > FACE_MAG_EDGE || (centralMag > FACE_MAG_SOFT && centralIncoherence > FACE_INCOHERENCE))) {
    fallback = true; reason = 'fast-motion';
  }

  // Fill unmatched blocks from matched neighbours, then one 3x3 smoothing
  // pass so the warp has no block seams.
  for (let pass = 0; pass < 2; pass++) {
    const src = Float32Array.from(flow);
    for (let by = 0; by < gh; by++) {
      for (let bx = 0; bx < gw; bx++) {
        const k = by * gw + bx;
        if (pass === 0 && matched[k]) continue;
        let sx = 0; let sy = 0; let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = bx + dx; const ny = by + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const nk = ny * gw + nx;
            if (pass === 0 && !matched[nk]) continue;
            sx += src[nk * 2]; sy += src[nk * 2 + 1]; n++;
          }
        }
        if (n) { flow[k * 2] = sx / n; flow[k * 2 + 1] = sy / n; }
      }
    }
  }

  return { score, coverage, fallback, reason, flow, gw, gh, meanAbsDiff, centralMag, centralIncoherence, faceCoverage };
}

// Bilinear sample of the flow grid at normalized coords (u,v in 0..1).
export function sampleFlow(flow, gw, gh, u, v) {
  const x = Math.min(1, Math.max(0, u)) * (gw - 1);
  const y = Math.min(1, Math.max(0, v)) * (gh - 1);
  const x0 = Math.min(gw - 2, Math.floor(x)); const y0 = Math.min(gh - 2, Math.floor(y));
  const fx = x - x0; const fy = y - y0;
  const at = (bx, by) => { const k = (by * gw + bx) * 2; return [flow[k], flow[k + 1]]; };
  const a = at(x0, y0); const b = at(x0 + 1, y0); const c = at(x0, y0 + 1); const d = at(x0 + 1, y0 + 1);
  return [
    a[0] * (1 - fx) * (1 - fy) + b[0] * fx * (1 - fy) + c[0] * (1 - fx) * fy + d[0] * fx * fy,
    a[1] * (1 - fx) * (1 - fy) + b[1] * fx * (1 - fy) + c[1] * (1 - fx) * fy + d[1] * fx * fy,
  ];
}

// The CPU reference renderer for the morph: warp A forward by P*flow and B
// backward by (1-P)*flow, then crossfade. P=0 is exactly A, P=1 exactly B.
// `out` is a Uint8Array/Uint8ClampedArray of w*h*4; flow is in frame fractions.
export function renderMorphCPU(a, b, out, w, h, P, flow, gw, gh, strength = 1) {
  const sample = (src, x, y) => {
    const cx = Math.min(w - 1, Math.max(0, x));
    const cy = Math.min(h - 1, Math.max(0, y));
    const x0 = Math.min(w - 2, Math.floor(cx)); const y0 = Math.min(h - 2, Math.floor(cy));
    const fx = cx - x0; const fy = cy - y0;
    const o = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v00 = src[(y0 * w + x0) * 4 + c]; const v10 = src[(y0 * w + x0 + 1) * 4 + c];
      const v01 = src[((y0 + 1) * w + x0) * 4 + c]; const v11 = src[((y0 + 1) * w + x0 + 1) * 4 + c];
      o[c] = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
    }
    return o;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [fx, fy] = sampleFlow(flow, gw, gh, (x + 0.5) / w, (y + 0.5) / h);
      const ca = sample(a, x - P * fx * w * strength, y - P * fy * h * strength);
      const cb = sample(b, x + (1 - P) * fx * w * strength, y + (1 - P) * fy * h * strength);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(ca[c] * (1 - P) + cb[c] * P);
      out[o + 3] = 255;
    }
  }
  return out;
}

// Encode a flow grid as an RGBA8 texture for the GLSL morph shader:
// R/G hold the flow in frame fractions, mapped from [-0.25, 0.25] to [0, 255].
export function flowTextureData(flow, gw, gh) {
  const data = new Uint8Array(gw * gh * 4);
  for (let k = 0; k < gw * gh; k++) {
    data[k * 4] = Math.round(Math.min(255, Math.max(0, 128 + (flow[k * 2] / 0.25) * 127)));
    data[k * 4 + 1] = Math.round(Math.min(255, Math.max(0, 128 + (flow[k * 2 + 1] / 0.25) * 127)));
    data[k * 4 + 2] = 0;
    data[k * 4 + 3] = 255;
  }
  return { data, width: gw, height: gh };
}

// ---- Cache + reporting -------------------------------------------------
// One analysis per clip pair: the preview, the export and the tile renderer
// all render the same warp for the same pair. Bounded (8 entries, oldest out).
const cache = new Map();
const reports = new Map();
const cachePut = (map, key, value) => {
  if (map.size >= 8) map.delete(map.keys().next().value);
  map.set(key, value);
};
export function analyseRawPair(a, b, w, h, key) {
  if (key && cache.has(key)) return cache.get(key);
  const r = analyseMorph(a, b, w, h);
  // A failed analysis is never cached: it may be a transient (undecoded
  // frames, a short read), and caching it would poison every later render
  // of the pair — preview and export share this cache, so one bad read
  // once made the export dissolve a morphable pair too (P3B live run).
  if (key && r.reason !== 'analysis-failed') cachePut(cache, key, r);
  return r;
}
// A frame whose luma barely varies is not a frame at all in practice: the
// preview fills an unready slot with the project background (black), so its
// first redraw analyses black — which scores 0 as "dissimilar" and, cached,
// locks the pair into a dissolve forever. Such frames analyse as failed and
// are never cached; the next redraw (videos decoded) re-analyses for real.
const blankRange = (data) => {
  let mn = Infinity; let mx = -Infinity;
  for (let i = 0; i < data.length; i += 64) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (l < mn) mn = l; if (l > mx) mx = l;
  }
  return mx - mn;
};
// Browser only: analyse two canvases (preview frames / sample photos).
export function analyseCanvasPair(aCv, bCv, key) {
  if (key && cache.has(key)) return cache.get(key);
  const cv = document.createElement('canvas');
  cv.width = MORPH_WORK_W; cv.height = MORPH_WORK_H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const grab = (src) => {
    ctx.drawImage(src, 0, 0, MORPH_WORK_W, MORPH_WORK_H);
    return ctx.getImageData(0, 0, MORPH_WORK_W, MORPH_WORK_H).data;
  };
  const ga = grab(aCv); const gb = grab(bCv);
  if (blankRange(ga) < 4 || blankRange(gb) < 4) return failedResult();
  const r = analyseMorph(ga, gb, MORPH_WORK_W, MORPH_WORK_H);
  if (key && r.reason !== 'analysis-failed') cachePut(cache, key, r);
  return r;
}
export function morphCacheKey(aId, bId) { return `${aId || '?'}>${bId || '?'}`; }
export function setMorphReport(key, report) { if (key) cachePut(reports, key, report); }
export function getMorphReport(key) { return (key && reports.get(key)) || null; }

// FB-11: the morph warp strength at transition progress P (0..1). The static
// tr.params.strength is the base; tr.strengthKeys (transition-local seconds,
// edited in TransitionInspector) keyframe it — linearly interpolated, holding
// the first/last value outside the keys. Preview and export both render
// through renderMorphFrame below, so keyframed strength has parity by
// construction. No keys = exactly the old static strength.
export function transitionStrengthAt(tr, P) {
  const m = mergeTrParams('fx_morphcut', tr && tr.params);
  const base = Number.isFinite(m.strength) ? m.strength : 1;
  const keys = tr && Array.isArray(tr.strengthKeys) ? tr.strengthKeys : null;
  if (!keys || !keys.length) return base;
  const dur = Number(tr.duration) || 0.8;
  return fxStrengthAt(sanitizeFxKeys(keys, dur), Math.min(Math.max(0, P), 1) * dur, base);
}

// Render one morph frame through the shared WebGL renderer (gl = fxGL()).
// Falls back to the dissolve expression when the analysis says so, and
// returns the decision so callers (preview / export / inspector) can report
// it honestly. `a`/`b` are canvas/image sources or { data } RGBA buffers.
export function renderMorphFrame(gl, a, b, w, h, P, analysis, tr, reportKey) {
  const strength = transitionStrengthAt(tr, P);
  const report = {
    score: analysis.score, coverage: analysis.coverage, fallback: analysis.fallback,
    reason: analysis.reason, centralMag: analysis.centralMag, strength,
    rendered: analysis.fallback ? 'dissolve' : 'morph', usedFallback: analysis.fallback, at: Date.now(),
  };
  if (reportKey) setMorphReport(reportKey, report);
  if (analysis.fallback) {
    gl.transition(a, b, w, h, P, transitionExpr(tr));
  } else {
    gl.morph(a, b, w, h, P, flowTextureData(analysis.flow, analysis.gw, analysis.gh), strength);
  }
  return report;
}
