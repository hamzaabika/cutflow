// 3D text extrusion (P3-05, scoped): the renderer paints shaded side layers
// stepping away from the light, a lit bevel rim nearest the face, and the
// face itself exactly on its measured position — plus a small whole-clip
// tilt. All of it is deterministic (no time input), so preview and export
// agree by construction; the live test compares their pixels for real.
// Usage: node scripts/test-text-extrude.mjs
import assert from 'assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const { drawTextClip, resolveStyle, shadeHex, extrudeVector, extrudeDepth } = await import('../src/text/render.js');

const ok = (c, m) => assert.ok(c, m);
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// Stub canvas context: measureText widths scale with the current font size,
// fill/stroke calls are recorded with the fillStyle in force at the time,
// and transform() calls are recorded verbatim.
class StubCtx {
  constructor() {
    this.calls = [];
    this.transforms = [];
    this._font = '16px sans-serif';
    this.fillStyle = '#fff'; this.strokeStyle = '#000'; this.globalAlpha = 1;
    this.textAlign = 'left'; this.textBaseline = 'alphabetic'; this.direction = 'ltr';
    this.letterSpacing = '0px'; this.shadowBlur = 0; this.filter = 'none';
    this.lineWidth = 1; this.shadowColor = 'transparent'; this.shadowOffsetX = 0; this.shadowOffsetY = 0;
    this._tx = 0; this._ty = 0; this._stack = [];
  }
  set font(v) { this._font = String(v); }
  get font() { return this._font; }
  _size() { const m = /(\d+(?:\.\d+)?)px/.exec(this._font || ''); return m ? Number(m[1]) : 16; }
  measureText(s) { return { width: String(s).length * this._size() * 0.6 }; }
  fillText(text, x, y) { this.calls.push({ text: String(text), x: x + this._tx, y: y + this._ty, fillStyle: this.fillStyle, kind: 'fill' }); }
  strokeText(text, x, y) { this.calls.push({ text: String(text), x: x + this._tx, y: y + this._ty, fillStyle: this.strokeStyle, kind: 'stroke' }); }
  createLinearGradient() { return { addColorStop() {} }; }
  save() { this._stack.push([this._tx, this._ty]); }
  restore() { const s = this._stack.pop(); if (s) { this._tx = s[0]; this._ty = s[1]; } }
  translate(x, y) { this._tx += x; this._ty += y; }
  scale() {} rotate() {}
  transform(a, b, c, d, e, f) { this.transforms.push([a, b, c, d, e, f]); }
  beginPath() {} closePath() {} fill() {} stroke() {} clip() {}
  fillRect() {} strokeRect() {} clearRect() {} setTransform() {}
  arc() {} moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {}
  roundRect() {} drawImage() {} setLineDash() {} resetTransform() {}
}

const W = 1280; const H = 720;
const base = {
  id: 't1', text: 'HELLO WORLD', start: 0, duration: 4,
  font: 'montserrat', size: 64, color: '#ff0000', effect: 'none',
  stroke: { width: 0, color: '#000000' },
  animIn: { id: 'none', dur: 0.3, unit: 'whole' },
  animOut: { id: 'none', dur: 0.25, unit: 'whole' },
  animLoop: { id: 'none', speed: 1 },
  x: 0.5, y: 0.5,
};

// --- helpers ---------------------------------------------------------------
assert.equal(shadeHex('#ffffff', 0.5), 'rgb(128,128,128)', 'shade halves white');
assert.equal(shadeHex('#ff0000', 1.18), 'rgb(255,0,0)', 'shade clamps at 255');
assert.equal(shadeHex('#808080', 0.5), 'rgb(64,64,64)', 'shade halves grey');
{
  const v = extrudeVector({ extrude: { light: 225 } });
  ok(approx(v.x, Math.SQRT1_2) && approx(v.y, Math.SQRT1_2), 'light 225 (top-left) extrudes down-right');
  const v2 = extrudeVector({ extrude: { light: 45 } });
  ok(approx(v2.x, -Math.SQRT1_2) && approx(v2.y, -Math.SQRT1_2), 'light 45 extrudes up-left');
  const v3 = extrudeVector({ extrude: { light: 0 } });
  ok(approx(v3.x, -1) && approx(v3.y, 0), 'light 0 extrudes straight left');
}
assert.equal(extrudeDepth({ extrude: { on: false, depth: 12 } }), 0, 'off means no depth');
assert.equal(extrudeDepth({ extrude: { on: true, depth: 100 } }), 40, 'depth clamps at 40');
assert.equal(extrudeDepth({ extrude: { on: true, depth: 0 } }), 0, 'depth 0 means no extrusion');

// --- defaults: a legacy clip without extrude keeps rendering flat ----------
{
  const st = resolveStyle({ ...base });
  assert.deepEqual(st.extrude, { on: false, depth: 12, bevel: 3, light: 225, tiltX: 0, tiltY: 0 }, 'legacy clip gets flat defaults');
  const st2 = resolveStyle({ ...base, extrude: { on: true } });
  assert.equal(st2.extrude.depth, 12, 'a partial extrude patch keeps the other defaults');
  assert.equal(st2.extrude.light, 225, 'a partial extrude patch keeps the light default');
}

// --- extrude off: exactly one face fill per word, no tilt ------------------
{
  const ctx = new StubCtx();
  drawTextClip(ctx, resolveStyle({ ...base }), 2, W, H);
  const fills = ctx.calls.filter((c) => c.kind === 'fill');
  assert.equal(fills.length, 2, 'flat: one fill per word');
  assert.equal(ctx.transforms.length, 0, 'flat: no tilt transform');
  ok(fills.every((f) => f.fillStyle === '#ff0000'), 'flat: face paints in the clip colour');
}

// --- extrude on: side layers + face, shading, bevel rim --------------------
{
  const ctx = new StubCtx();
  const clip = resolveStyle({ ...base, extrude: { on: true, depth: 12, bevel: 3, light: 225, tiltX: 0, tiltY: 0 } });
  drawTextClip(ctx, clip, 2, W, H);
  const fills = ctx.calls.filter((c) => c.kind === 'fill');
  // 2 words x (12 side layers + 1 face).
  assert.equal(fills.length, 26, 'extruded: depth side layers + face per word');
  for (const word of ['HELLO', 'WORLD']) {
    const calls = fills.filter((c) => c.text === word);
    assert.equal(calls.length, 13, `${word}: 12 sides + face`);
    const face = calls[calls.length - 1];
    assert.equal(face.fillStyle, '#ff0000', `${word}: the face is last, in the clip colour`);
    // Side layers step away from the light (down-right for light 225) and
    // the farthest one is the most offset.
    const sides = calls.slice(0, 12);
    const far = sides[0];
    ok(approx(far.x - face.x, 12 * Math.SQRT1_2, 0.01) && approx(far.y - face.y, 12 * Math.SQRT1_2, 0.01),
      `${word}: farthest side sits depth steps down-right of the face`);
    const near = sides[sides.length - 1];
    ok(approx(near.x - face.x, Math.SQRT1_2, 0.01) && approx(near.y - face.y, Math.SQRT1_2, 0.01),
      `${word}: nearest side sits one step from the face`);
    // Offsets shrink monotonically towards the face.
    for (let i = 1; i < sides.length; i++) {
      ok(sides[i].x - face.x < sides[i - 1].x - face.x + 1e-9, `${word}: side offsets shrink towards the face`);
    }
    // Shading: side layers are darker than the face; the bevel rim (the
    // 3 layers nearest the face) is brighter than the deepest side.
    const lum = (s) => {
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(s);
      return m ? (+m[1] + +m[2] + +m[3]) / 3 : 255;
    };
    ok(lum(far.fillStyle) < lum(face.fillStyle), `${word}: deepest side is darker than the face`);
    ok(lum(near.fillStyle) > lum(far.fillStyle), `${word}: bevel rim is lit brighter than the back`);
    ok(sides.every((s) => s.fillStyle.startsWith('rgb(')), `${word}: sides are shaded, not flat`);
  }
  assert.equal(ctx.transforms.length, 0, 'no tilt requested: no transform');
}

// --- light direction flips the extrusion ------------------------------------
{
  const ctx = new StubCtx();
  drawTextClip(ctx, resolveStyle({ ...base, extrude: { on: true, depth: 4, bevel: 0, light: 45, tiltX: 0, tiltY: 0 } }), 2, W, H);
  const calls = ctx.calls.filter((c) => c.kind === 'fill' && c.text === 'HELLO');
  const face = calls[calls.length - 1];
  const far = calls[0];
  ok(far.x < face.x && far.y < face.y, 'light 45: sides extend up-left of the face');
}

// --- tilt: a cosine squash on each axis, clamped at ±45° --------------------
{
  const ctx = new StubCtx();
  drawTextClip(ctx, resolveStyle({ ...base, extrude: { on: true, depth: 4, bevel: 0, light: 225, tiltX: 30, tiltY: -20 } }), 2, W, H);
  assert.equal(ctx.transforms.length, 1, 'tilt applies one transform');
  const [a, b, c, d] = ctx.transforms[0];
  ok(approx(a, Math.cos((-20 * Math.PI) / 180)) && approx(d, Math.cos((30 * Math.PI) / 180)) && b === 0 && c === 0,
    'tilt is a pure axis squash (no shear, no mirror)');
  const ctx2 = new StubCtx();
  drawTextClip(ctx2, resolveStyle({ ...base, extrude: { on: true, depth: 4, bevel: 0, light: 225, tiltX: 90, tiltY: 0 } }), 2, W, H);
  ok(approx(ctx2.transforms[0][3], Math.cos((45 * Math.PI) / 180)), 'tiltX clamps at 45°');
}

console.log('TEXT-EXTRUDE OK');
