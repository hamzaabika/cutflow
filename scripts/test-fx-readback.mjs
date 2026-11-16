// Gap-build Stream E — PF-04 GPU-readback reduction: readback scratch
// buffers are reused across frames instead of allocating two w*h*4 buffers
// per frame. Run: node scripts/test-fx-readback.mjs
import assert from 'node:assert/strict';
import { FxGL, flipRowsInto } from '../src/fx/gl.js';

// Minimal WebGL2 stub: every method is a no-op except readPixels (fills the
// target) and the compile/link status queries (report success). Constants
// are never inspected by the stubbed calls, so plain functions suffice.
const readPixelsCalls = { n: 0 };
const makeGl = () => new Proxy({}, {
  get(_t, prop) {
    if (prop === 'readPixels') return (...a) => { readPixelsCalls.n++; const px = a[6]; if (px) px.fill(7); };
    if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
    if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return () => '';
    if (prop === 'getUniformLocation' || prop === 'getAttribLocation') return () => ({});
    if (prop === 'createShader' || prop === 'createProgram' || prop === 'createTexture' ||
        prop === 'createFramebuffer' || prop === 'createBuffer') return () => ({});
    if (typeof prop === 'string') return () => {};
    return undefined;
  },
});
const makeCanvas = () => ({
  width: 0, height: 0,
  addEventListener() {},
  getContext: () => makeGl(),
});
globalThis.document = { createElement: () => makeCanvas() };

// ---------- flipRowsInto: same picture as the old flipRows, into a target ----------
{
  // 2x2 frame, bottom row first: [B0 B1 | T0 T1] -> top row first [T0 T1 | B0 B1]
  const px = new Uint8Array([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255]);
  const out = new Uint8Array(16);
  assert.strictEqual(flipRowsInto(px, 2, 2, out), out, 'flipRowsInto returns the target buffer');
  assert.deepEqual([...out], [3, 0, 0, 255, 4, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255], 'rows flip top<->bottom');
}

// ---------- read(): one scratch pair serves every frame ----------
const gl = new FxGL();
const W = 1920, H = 1080;
const a = gl.read(W, H);
const b = gl.read(W, H);
assert.equal(a === b, true, 'consecutive reads return the SAME buffer (no per-frame allocation)');
assert.equal(a.length, W * H * 4, 'read buffer holds a full RGBA frame');
assert.equal(a[0], 7, 'readPixels data lands in the returned buffer (stub filled 7)');
assert.deepEqual(gl.readbackStats(), { frames: 2, bytes: 2 * W * H * 4, scratchBytes: W * H * 4 },
  'readback stats count frames + bytes moved + the single scratch allocation');
assert.equal(readPixelsCalls.n, 2, 'one readPixels per read()');

// A bigger frame grows the scratch once (identity changes at the growth);
// a smaller frame then reuses the grown buffer.
const big = gl.read(3840, 2160);
assert.equal(gl.readbackStats().scratchBytes, 3840 * 2160 * 4, 'scratch grows to the biggest frame seen');
assert.equal(big === a, false, 'growing the scratch replaces the buffer (one-off, by design)');
const c = gl.read(640, 360);
assert.equal(c === big, true, 'a smaller frame reuses the same (grown) buffer — still no allocation');

// ---------- effects(): the intermediate pass reuses the same scratch ----------
readPixelsCalls.n = 0;
gl.effects({ data: new Uint8Array(W * H * 4) }, W, H, [
  { expr: 'S(X, Y)', T: 0 },
  { expr: 'S(X, Y)', T: 0 },
]);
assert.equal(readPixelsCalls.n, 1, 'a 2-pass chain reads back once, for the intermediate pass only');
assert.equal(gl.readbackStats().scratchBytes, 3840 * 2160 * 4, 'effects() did not allocate a second scratch pair');
assert.equal(gl.readbackStats().frames, 4, 'effects() readback does not count as an export read()');

// ---------- allocation profile: 60 frames at 1080p allocate ~nothing ----------
{
  const heap0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 60; i++) gl.read(W, H);
  globalThis.gc?.();
  const heap1 = process.memoryUsage().heapUsed;
  const growthMB = (heap1 - heap0) / 2 ** 20;
  console.log(`  60x read(1920x1080): heap delta ${growthMB.toFixed(2)} MB (old code: 2 x 8.3 MB per frame = ~995 MB over 60 frames)`);
  assert.ok(growthMB < 5, `60 readbacks must not grow the heap by more than 5 MB (got ${growthMB.toFixed(2)} MB)`);
}

console.log('test-fx-readback: PASS');
