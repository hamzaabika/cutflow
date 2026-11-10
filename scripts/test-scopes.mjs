// Scopes correctness (Sprint 11, parity-matrix §9 row).
//   - The panel's four traces are computed by src/scopesMath.js from the
//     sampled frame; this suite pins those computations against synthetic
//     fixtures whose traces are known analytically (solid colours, colour
//     bars, a luma gradient).
//   - The "graded frame differs from the source frame" acceptance is the
//     same statement in fixture form: a brightness/contrast-graded copy of
//     a fixture must move the waveform and the histogram in the graded
//     direction. The panel samples the post-grade element (the displayed
//     slot's keyed canvas / the transition canvas) — pickScopeSource is
//     the rule that chooses it, and the wiring checks pin the panel to it.
import fs from 'node:fs';

const sm = await import('../src/scopesMath.js');
const { histogramBins, waveformLuma, channelPlanes, vectorPoints, vectorUV, pickScopeSource, pickSlotIndex } = sm;

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// Fixture builders: RGBA buffers, alpha 255.
const frame = (w, h, px) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = px(x, y);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
};
const solid = (w, h, rgb) => frame(w, h, () => rgb);
const BARS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]; // R G B Y
const bars = (w, h) => frame(w, h, (x) => BARS[Math.min(3, Math.floor(x / (w / 4)))]);

// --- Histogram ---------------------------------------------------------------------
{
  const { bins, max } = histogramBins(solid(8, 4, [255, 0, 0]));
  ok(bins[0][255] === 32 && bins[1][0] === 32 && bins[2][0] === 32 && max === 32,
    'histogram: solid red puts all 32 pixels in R255 / G0 / B0');
  const sum = bins.reduce((s, b) => s + b.reduce((x, y) => x + y, 0), 0);
  ok(sum === 96, 'histogram: every pixel counted exactly once per channel');
  const bb = histogramBins(bars(16, 4)).bins;
  ok(bb[0][255] === 32 && bb[1][255] === 32 && bb[2][255] === 16,
    'histogram: colour bars split as expected (R in red+yellow, G in green+yellow, B in blue)');
}

// --- Waveform ------------------------------------------------------------------------
{
  const red = waveformLuma(solid(8, 4, [255, 0, 0]));
  ok([...red].every((v) => near(v, 0.2126, 1e-5)), 'waveform: solid red is a flat trace at luma 0.2126');
  const grad = waveformLuma(frame(16, 2, (x) => { const v = Math.round((255 * x) / 15); return [v, v, v]; }));
  let mono = true;
  for (let x = 1; x < 16; x++) if (!(grad[x] > grad[x - 1])) mono = false;
  ok(mono && near(grad[0], 0, 1e-6) && near(grad[15], 1, 1e-5), 'waveform: a grey ramp rises strictly from 0 to 1 across the columns');
  const barLuma = waveformLuma(bars(16, 2));
  ok(near(barLuma[0], 0.2126, 1e-5) && near(barLuma[4], 0.7152, 1e-5) && near(barLuma[8], 0.0722, 1e-5) && near(barLuma[12], 0.9278, 1e-4),
    'waveform: bar lumas match Rec.601 weights (R .2126, G .7152, B .0722, Y .9278)');
}

// --- Parade ----------------------------------------------------------------------------
{
  const planes = channelPlanes(solid(4, 2, [10, 128, 250]));
  ok(planes.every((p, c) => [...p].every((v) => near(v, [10, 128, 250][c] / 255, 1e-6))),
    'parade: channel planes carry the raw channel values, normalised');
}

// --- Vectorscope -------------------------------------------------------------------------
{
  const expected = {
    red: vectorUV(255, 0, 0), green: vectorUV(0, 255, 0), blue: vectorUV(0, 0, 255), yellow: vectorUV(255, 255, 0),
  };
  ok(near(expected.red[0], -0.14713, 1e-9) && near(expected.red[1], 0.615, 1e-9)
    && near(expected.yellow[0], -0.43599, 1e-9) && near(expected.yellow[1], 0.10001, 1e-9)
    && near(expected.blue[0], 0.436, 1e-9) && near(expected.blue[1], -0.10001, 1e-9),
  'vectorscope: analytic UV for the primaries (R -0.147/0.615, Y -0.436/0.100, B 0.436/-0.100)');
  const pts = vectorPoints(bars(16, 4));
  const uniq = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (!uniq.some(([u, v]) => near(u, pts[i], 1e-6) && near(v, pts[i + 1], 1e-6))) uniq.push([pts[i], pts[i + 1]]);
  }
  ok(uniq.length === 4 && Object.values(expected).every(([u, v]) => uniq.some(([a, b]) => near(a, u, 1e-4) && near(b, v, 1e-4))),
    `vectorscope: colour bars produce exactly the four analytic points (got ${uniq.length})`);
  const grey = vectorPoints(solid(4, 4, [128, 128, 128]));
  // The rounded BT.601 coefficients sum to 0.00001, so grey sits ~5e-6 off
  // centre — the tolerance states that, it does not hide a real offset.
  ok([...grey].every((v) => near(v, 0, 1e-4)), 'vectorscope: neutral grey sits at the centre within the coefficients\' rounding (no chroma)');
}

// --- Graded frame vs source frame ---------------------------------------------------------
{
  const src = frame(32, 8, (x) => { const v = 40 + Math.round((80 * x) / 31); return [v, v, v]; });
  const graded = frame(32, 8, (x) => { const v = Math.min(255, Math.round((40 + (80 * x) / 31) * 1.8 + 10)); return [v, v, v]; });
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const centroid = (data) => {
    const { bins } = histogramBins(data);
    let s = 0; let n = 0;
    for (let i = 0; i < 256; i++) { s += i * bins[0][i]; n += bins[0][i]; }
    return s / n;
  };
  ok(mean(waveformLuma(graded)) > mean(waveformLuma(src)) + 0.2,
    'graded vs source: the graded copy\'s waveform sits clearly higher (scopes must read the graded frame)');
  ok(centroid(graded) > centroid(src) + 50,
    'graded vs source: the graded copy\'s histogram centroid shifts right by the grade');
}

// --- Which element gets sampled ----------------------------------------------------------------
{
  ok(pickScopeSource({ transition: true, slots: [{ visible: true, z: 2, processed: false }] }) === 'transition',
    'source pick: during a shader transition, the transition canvas is the frame');
  ok(pickScopeSource({ transition: false, slots: [{ visible: true, z: 1, processed: false }, { visible: true, z: 2, processed: true }] }) === 'keyed',
    'source pick: the top slot\'s keyed canvas (post-grade) wins over the raw source below');
  ok(pickScopeSource({ transition: false, slots: [{ visible: true, z: 2, processed: false }, { visible: true, z: 1, processed: true }] }) === 'source',
    'source pick: an unprocessed top slot is sampled at its media element');
  ok(pickScopeSource({ transition: false, slots: [{ visible: false, z: 2, processed: true }, { visible: true, z: 1, processed: false }] }) === 'source',
    'source pick: a hidden slot is never sampled');
  ok(pickScopeSource({ transition: false, slots: [{ visible: false, z: 1, processed: true }] }) === null,
    'source pick: nothing visible -> nothing sampled (the panel keeps its last frame)');
  ok(pickSlotIndex([{ visible: true, z: 1 }, { visible: true, z: 1 }]) === 1, 'source pick: equal z goes to the later slot (paint order)');
}

// --- Wiring ---------------------------------------------------------------------------------------
{
  const scopes = fs.readFileSync(new URL('../src/components/Scopes.jsx', import.meta.url), 'utf8');
  ok(!scopes.includes("querySelector('.stage video')"), 'wiring: the panel no longer samples the raw source <video>');
  ok(scopes.includes('pickScopeSource') && scopes.includes('fx-transition') && scopes.includes('canvas.keyed'),
    'wiring: the panel samples via pickScopeSource (keyed canvas / transition canvas)');
  ok(scopes.includes('lastDataRef'), 'wiring: the last good frame is retained (no blank frame on a mode switch)');
  ok(scopes.includes('histogramBins') && scopes.includes('waveformLuma') && scopes.includes('vectorPoints'),
    'wiring: the traces come from the shared scopesMath functions this suite verifies');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nSCOPES OK');
process.exit(fails.length ? 1 : 0);
