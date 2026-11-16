// True morph cut (P3-03), pure-node suite: the flow analysis, the quality
// score, the fallback decisions, and the CPU reference warp. The WebGL
// shader (same maths) is covered by the live suite test-p3b-live.mjs and
// the export suite test-morph-cut-export.cjs.
// Usage: node scripts/test-morph-cut.mjs
import assert from 'node:assert/strict';
import { analyseMorph, analyseRawPair, renderMorphCPU, flowTextureData, sampleFlow, MORPH_GRID_W, MORPH_GRID_H } from '../src/fx/morph.js';
import { transitionExpr } from '../src/fx/params.js';
import { fxTransition } from '../src/fx/catalog.js';

const W = 320;
const H = 180;
const frame = (fn) => {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = fn(x, y);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  return d;
};
// A textured gradient (the texture is what block matching locks onto) with
// an optional bright disc. Disc centre in frame fractions.
const shot = (dx = 0.35, dy = 0.5, disc = true) => frame((x, y) => {
  const u = x / W; const v = y / H;
  const tex = 28 * Math.sin(u * 40) * Math.sin(v * 34) + 14 * Math.sin(u * 91 + v * 57);
  let r = 60 + 120 * u + tex; let g = 70 + 90 * v + tex; let b = 110 + 60 * (1 - u) + tex;
  if (disc) {
    const ddx = (u - dx) * W; const ddy = (v - dy) * H;
    if (ddx * ddx + ddy * ddy < 28 * 28) { r = 240; g = 220; b = 60; }
  }
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
});
const noise = (seed) => frame((x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
  const n = (s - Math.floor(s)) * 255;
  return [n, (n * 0.7) % 255, (n * 1.3) % 255];
});
const meanAbs = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return s / (a.length / 4) / 3;
};

// ---- Registry: morph cut is a real engine transition now, not an adaptation ----
const morph = fxTransition('fx_morphcut');
assert.ok(morph, 'fx_morphcut resolves in the FX registry');
assert.equal(morph.morph, true, 'fx_morphcut is flagged morph');
assert.ok(morph.params?.some((p) => p.key === 'strength'), 'morph exposes a strength param');
assert.equal(transitionExpr({ type: 'fx_morphcut' }), transitionExpr({ type: 'dissolve' }),
  'transitionExpr for morph is the dissolve FALLBACK expression');
import { CATALOG135 } from '../src/fx/catalog135.js';
const entry = CATALOG135.find((e) => e.slug === 'morph-cut');
assert.ok(entry && entry.status === 'implemented' && entry.engineId === 'fx_morphcut',
  `catalog135 morph-cut is implemented -> fx_morphcut (got ${entry?.status} -> ${entry?.engineId})`);

// ---- Similar shots: a small shift morphs, flow points along the shift ----
const A = shot(0.35, 0.5);
const B = shot(0.42, 0.5); // disc moves +7% of the width
const sim = analyseMorph(A, B, W, H);
assert.ok(!sim.fallback && sim.reason === 'ok', `similar shots morph (score ${sim.score.toFixed(3)}, coverage ${sim.coverage.toFixed(2)})`);
assert.ok(sim.score > 0.6, `similar-shot score high (${sim.score.toFixed(3)})`);
// Flow in the disc's region points along the shift (the disc moved +7% of
// the width); the strongest flow anywhere is close to that shift.
let fxSum = 0; let fxN = 0; let fxMax = 0;
for (let by = 3; by <= 5; by++) {
  for (let bx = 4; bx <= 8; bx++) {
    const k = (by * MORPH_GRID_W + bx) * 2;
    fxSum += sim.flow[k]; fxN++;
    fxMax = Math.max(fxMax, sim.flow[k]);
  }
}
assert.ok(fxSum / fxN > 0.02, `flow follows the shift in the disc region (mean fx ${(fxSum / fxN).toFixed(3)})`);
assert.ok(fxMax > 0.04, `strongest flow near the +0.07 shift (max fx ${fxMax.toFixed(3)})`);

// ---- The CPU warp: endpoints exact, mid-frame is a warp not a dissolve ----
const out0 = new Uint8Array(W * H * 4);
const out1 = new Uint8Array(W * H * 4);
const outMid = new Uint8Array(W * H * 4);
renderMorphCPU(A, B, out0, W, H, 0, sim.flow, sim.gw, sim.gh, 1);
renderMorphCPU(A, B, out1, W, H, 1, sim.flow, sim.gw, sim.gh, 1);
renderMorphCPU(A, B, outMid, W, H, 0.5, sim.flow, sim.gw, sim.gh, 1);
assert.ok(meanAbs(out0, A) < 0.6, `P=0 is A (diff ${meanAbs(out0, A).toFixed(3)})`);
assert.ok(meanAbs(out1, B) < 0.6, `P=1 is B (diff ${meanAbs(out1, B).toFixed(3)})`);
const dissolveMid = new Uint8Array(W * H * 4);
for (let i = 0; i < A.length; i++) dissolveMid[i] = Math.round(A[i] * 0.5 + B[i] * 0.5);
const warpVsDissolve = meanAbs(outMid, dissolveMid);
assert.ok(warpVsDissolve > 2, `mid morph is a warp, not a dissolve (vs dissolve ${warpVsDissolve.toFixed(2)})`);
// The warp signature is strongest where the motion is: in the disc region
// the mid morph must differ sharply from a plain dissolve.
const regionDiff = (a, b, x0, y0, x1, y1) => {
  let s = 0; let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; for (let c = 0; c < 3; c++) s += Math.abs(a[i + c] - b[i + c]); n++; }
  return s / n / 3;
};
const regionWarp = regionDiff(outMid, dissolveMid, 80, 54, 176, 126);
assert.ok(regionWarp > 8, `disc-region warp vs dissolve ${regionWarp.toFixed(2)}`);
assert.ok(meanAbs(outMid, A) > 3 && meanAbs(outMid, B) > 3, 'mid morph differs from both endpoints');
// Strength 0 collapses to a plain crossfade.
const outFlat = new Uint8Array(W * H * 4);
renderMorphCPU(A, B, outFlat, W, H, 0.5, sim.flow, sim.gw, sim.gh, 0);
assert.ok(meanAbs(outFlat, dissolveMid) < 0.6, `strength 0 is a crossfade (diff ${meanAbs(outFlat, dissolveMid).toFixed(3)})`);
// Identical frames: score 1, no warp, render is the frame itself.
const same = analyseMorph(A, A, W, H);
assert.ok(!same.fallback && same.score > 0.95, `identical frames score ~1 (${same.score.toFixed(3)})`);
const outSame = new Uint8Array(W * H * 4);
renderMorphCPU(A, A, outSame, W, H, 0.5, same.flow, same.gw, same.gh, 1);
assert.ok(meanAbs(outSame, A) < 0.6, 'identical frames morph to themselves');

// ---- Dissimilar shots fall back to dissolve, honestly ----
const dis = analyseMorph(A, noise(3), W, H);
assert.ok(dis.fallback && dis.reason === 'dissimilar', `noise vs shot falls back dissimilar (score ${dis.score.toFixed(3)})`);
// A genuinely different scene (inverted gradient, different texture phase,
// disc elsewhere) also falls back.
const other = frame((x, y) => {
  const u = x / W; const v = y / H;
  const tex = 30 * Math.sin(u * 17 + 2) * Math.sin(v * 61 + 1);
  return [Math.max(0, Math.min(255, 200 - 140 * u + tex)), Math.max(0, Math.min(255, 40 + 60 * v + tex)), Math.max(0, Math.min(255, 90 + 90 * u + tex))];
});
const dis2 = analyseMorph(A, other, W, H);
assert.ok(dis2.fallback && dis2.reason === 'dissimilar', `different scene falls back dissimilar (score ${dis2.score.toFixed(3)})`);

// ---- Fast face-zone motion falls back (face-motion guard) ----
// A rigid translation is what the warp is for, so the guard fires on what a
// warp cannot do: the face moves past the search edge (no correspondence —
// incoherent flow / unmatched face zone) or in incoherent directions.
// Face-zone disc jumps +14% of the width (past the ±12 px search radius)
// while the rest of the shot is static: the overall score stays high, the
// face zone cannot be matched, the guard fires.
const faceA = shot(0.45, 0.3);
const faceB = shot(0.45 + 0.14, 0.3);
const fast = analyseMorph(faceA, faceB, W, H);
assert.ok(fast.score > 0.45, `fast-face pair still scores (${fast.score.toFixed(3)}) — the guard, not dissimilarity, must fire`);
assert.ok(fast.fallback && fast.reason === 'fast-motion',
  `face past the search edge falls back fast-motion (faceCoverage ${fast.faceCoverage.toFixed(2)}, incoherence ${fast.centralIncoherence.toFixed(2)}, reason ${fast.reason})`);
// Incoherent face-zone motion (two discs moving opposite ways, ±4 px) also falls back.
const discPair = (dx1, dx2) => frame((x, y) => {
  const u = x / W; const v = y / H;
  const tex = 28 * Math.sin(u * 40) * Math.sin(v * 34) + 14 * Math.sin(u * 91 + v * 57);
  let r = 60 + 120 * u + tex; let g = 70 + 90 * v + tex; let b = 110 + 60 * (1 - u) + tex;
  for (const [cx, s] of [[0.35, dx1], [0.6, dx2]]) {
    const ddx = (u - (cx + s)) * W; const ddy = (v - 0.3) * H;
    if (ddx * ddx + ddy * ddy < 22 * 22) { r = 240; g = 220; b = 60; }
  }
  return [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
});
const inco = analyseMorph(discPair(0, 0), discPair(0.042, -0.042), W, H);
assert.ok(inco.fallback && inco.reason === 'fast-motion',
  `incoherent face-zone motion falls back fast-motion (centralMag ${inco.centralMag.toFixed(3)}, incoherence ${inco.centralIncoherence.toFixed(2)}, reason ${inco.reason})`);
// A slow face-zone move does NOT fall back.
const slow = analyseMorph(shot(0.45, 0.3), shot(0.47, 0.3), W, H);
assert.ok(!slow.fallback, `slow face-zone move morphs (reason ${slow.reason}, centralMag ${slow.centralMag.toFixed(3)})`);

// ---- Analysis failure falls back ----
const bad = analyseMorph(null, B, W, H);
assert.ok(bad.fallback && bad.reason === 'analysis-failed', 'null frame fails safe to fallback');

// ---- A failed analysis is never cached (P3B live run): a transient bad
// read (undecoded frames) must not poison the pair for preview + export.
const poisonKey = 'cache-poison-test';
const first = analyseRawPair(null, null, W, H, poisonKey);
assert.ok(first.fallback && first.reason === 'analysis-failed', 'first (failed) analysis reports analysis-failed');
const second = analyseRawPair(A, B, W, H, poisonKey);
assert.ok(!second.fallback && second.score > 0.6, `failed analysis not cached — the good pair still morphs (score ${second.score.toFixed(3)})`);
const third = analyseRawPair(null, null, W, H, poisonKey);
assert.ok(!third.fallback && third.score > 0.6, 'a good analysis stays cached once stored');

// ---- Flow texture round-trip ----
const tex = flowTextureData(sim.flow, sim.gw, sim.gh);
assert.equal(tex.data.length, sim.gw * sim.gh * 4, 'flow texture size');
const [rfx] = sampleFlow(sim.flow, sim.gw, sim.gh, 0.4, 0.5);
const k = (2 * sim.gw + 5) * 4;
const decoded = ((tex.data[k] - 128) / 127) * 0.25;
assert.ok(Math.abs(decoded - sim.flow[(2 * sim.gw + 5) * 2]) < 0.005, 'flow texture encodes the flow');
assert.ok(Number.isFinite(rfx), 'sampleFlow returns finite values');

console.log(`morph-cut OK — similar score ${sim.score.toFixed(3)} (flow follows shift), warp-vs-dissolve ${warpVsDissolve.toFixed(2)} global / ${regionWarp.toFixed(2)} in the disc region, dissimilar/fast-motion/failed all fall back`);
