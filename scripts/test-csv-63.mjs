// CSV §6.3 partials built in Stream E — the two genuinely missing, small,
// in-scope items (see ~/workspace/cutflow-audit-20261115/gap-e-csv-63.md):
//   1. Text "Continuous" loop 'tracking' (slow tracking shift) — the loop
//      picker + engine had pulse/float/swing/... but no letter-spacing loop.
//   2. Library & UX "hover-scrub-thumbnail" — FxThumb autoplayed on hover
//      but a horizontal move across the tile never scrubbed the preview.
// The tracking loop is verified at the real renderer (drawTextClip) with a
// stub canvas context; the scrub is a DOM-pointer behaviour, so it gets a
// static wiring check here and a live CDP check in the verification pass.
// Usage: node scripts/test-csv-63.mjs
import assert from 'assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register('./css-stub-loader.mjs', import.meta.url);

const { ANIM_LOOP } = await import('../src/text/catalog.js');
const { drawTextClip } = await import('../src/text/render.js');

const ok = (c, m) => assert.ok(c, m);

// --- 1. tracking loop -------------------------------------------------------
const loopIds = ANIM_LOOP.map((x) => x.id);
ok(loopIds.includes('tracking'), 'ANIM_LOOP offers a Tracking loop');
ok(loopIds.includes('pulse') && loopIds.includes('float'), 'the older loops are still there');
assert.equal(new Set(loopIds).size, loopIds.length, 'no duplicate loop ids');

class StubCtx {
  constructor() {
    this.calls = [];
    this._font = '16px sans-serif';
    this.fillStyle = '#fff'; this.strokeStyle = '#000'; this.globalAlpha = 1;
    this.textAlign = 'left'; this.textBaseline = 'alphabetic'; this.direction = 'ltr';
    this.letterSpacing = '0px'; this.shadowBlur = 0; this.filter = 'none';
    this.lineWidth = 1;
    this._tx = 0; this._ty = 0; this._stack = [];
  }
  set font(v) { this._font = String(v); }
  get font() { return this._font; }
  _size() { const m = /(\d+(?:\.\d+)?)px/.exec(this._font || ''); return m ? Number(m[1]) : 16; }
  measureText(s) { return { width: String(s).length * this._size() * 0.6 }; }
  fillText(text, x, y) { this.calls.push({ text: String(text), ls: this.letterSpacing, kind: 'fill' }); }
  strokeText(text, x, y) { this.calls.push({ text: String(text), ls: this.letterSpacing, kind: 'stroke' }); }
  createLinearGradient() { return { addColorStop() {} }; }
  save() { this._stack.push([this._tx, this._ty]); }
  restore() { const s = this._stack.pop(); if (s) { this._tx = s[0]; this._ty = s[1]; } }
  translate(x, y) { this._tx += x; this._ty += y; }
  scale() {} rotate() {}
  beginPath() {} closePath() {} fill() {} stroke() {} clip() {}
  fillRect() {} strokeRect() {} clearRect() {} setTransform() {}
  arc() {} moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {}
  roundRect() {} drawImage() {} setLineDash() {} resetTransform() {}
}

const base = {
  id: 't1', text: 'Hello world', start: 0, duration: 3, size: 100, font: 'montserrat',
  color: '#ffffff', animIn: { id: 'fade', dur: 0.35 }, animOut: { id: 'fade', dur: 0.25 },
  animLoop: { id: 'tracking', speed: 1 },
};
const lsAt = (clip, lt) => {
  const ctx = new StubCtx();
  drawTextClip(ctx, clip, lt, 1080, 1920);
  const fills = ctx.calls.filter((c) => c.kind === 'fill');
  ok(fills.length > 0, `lt=${lt}: the clip draws`);
  const vals = fills.map((c) => parseFloat(c.ls));
  ok(vals.every((v) => Math.abs(v - vals[0]) < 0.001), `lt=${lt}: one tracking value across the clip`);
  return vals[0];
};
// sin(lt * TAU * 0.5) * size * 0.08: lt=2 -> 0, lt=0.5 -> +8, lt=1.5 -> -8 (size 100).
// (lt=0 draws nothing: the fade-in alpha is 0 there, so the full-cycle point stands in.)
assert.ok(Math.abs(lsAt(base, 2)) < 0.01, 'tracking loop returns to normal tracking after one cycle');
assert.ok(Math.abs(lsAt(base, 0.5) - 8) < 0.01, `tracking loop peaks at +8px mid-cycle (got ${lsAt(base, 0.5)})`);
assert.ok(Math.abs(lsAt(base, 1.5) + 8) < 0.01, 'tracking loop swings to -8px the other way');
assert.ok(Math.abs(lsAt({ ...base, animLoop: { id: 'none', speed: 1 } }, 0.5)) < 0.01,
  'no loop means no tracking change (control)');
assert.ok(Math.abs(lsAt({ ...base, animLoop: { id: 'tracking', speed: 2 } }, 0.25) - 8) < 0.01,
  'loop speed doubles the cycle rate');

// --- 2. hover scrub ----------------------------------------------------------
const src = readFileSync(new URL('../src/fx/previews.jsx', import.meta.url), 'utf8');
ok(src.includes("tile.addEventListener('pointermove', onMove)"), 'FxThumbLive listens for pointermove on the tile');
ok(src.includes('0.04'), 'a dead zone keeps ordinary hover jitter on autoplay');
ok(src.includes('Math.min(1, Math.max(0, x))'), 'scrub x maps to transition progress 0..1');
ok(src.includes('x * 4'), 'scrub x maps across the effect 4 s loop');
ok(src.includes("tile.removeEventListener('pointermove', onMove)"), 'the scrub listener is removed on unmount');
ok(src.includes('scrubbing = true'), 'a deliberate move switches from autoplay to scrub');

console.log('test-csv-63 PASS');
