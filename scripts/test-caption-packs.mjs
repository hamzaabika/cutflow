// Caption style packs (P2-43): a pack applies to any transcript, the
// transcript data stays independent from the styling, and Arabic captions
// are tested for RTL punctuation / line breaking / overlap — at the real
// renderer (src/text/render.js drawTextClip) with a stub canvas context.
// Usage: node scripts/test-caption-packs.mjs
import assert from 'assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const { CAPTION_PACKS, captionPackById, captionPackPatch, applyCaptionPack, packIsArabicSafe } = await import('../src/text/captionPacks.js');
const { drawTextClip, resolveStyle } = await import('../src/text/render.js');

const ok = (c, m) => assert.ok(c, m);

// --- the packs ---------------------------------------------------------------
assert.equal(CAPTION_PACKS.length, 5, 'five caption style packs');
for (const p of CAPTION_PACKS) {
  const patch = captionPackPatch(p.id);
  ok(patch && typeof patch === 'object', `${p.id}: a patch resolves`);
  ok(!('text' in patch) && !('words' in patch) && !('start' in patch) && !('duration' in patch),
    `${p.id}: the patch carries no transcript data`);
  ok((patch.lineHeight || 0) >= 1.15, `${p.id}: line spacing keeps stacked lines apart`);
  ok((patch.maxWidth || 0) <= 0.9, `${p.id}: lines stay inside the frame width`);
}
assert.equal(captionPackPatch('nope'), null, 'an unknown pack resolves to nothing');
assert.equal(applyCaptionPack(null, 'pack-word-pop'), null, 'no clip -> no apply');
assert.equal(applyCaptionPack({ text: 'x' }, 'nope'), null, 'an unknown pack applies to nothing');

// --- transcript independence: English ----------------------------------------
const enClip = {
  id: 'cap1', text: 'Hello world, this is a test', caption: true, source: 'srt',
  start: 1.5, duration: 3,
  words: [
    { text: 'Hello', start: 0, end: 0.5 }, { text: 'world,', start: 0.5, end: 1 },
    { text: 'this', start: 1, end: 1.5 }, { text: 'is', start: 1.5, end: 2 },
    { text: 'a', start: 2, end: 2.5 }, { text: 'test', start: 2.5, end: 3 },
  ],
  template: 'cap-classic', font: 'montserrat',
};
for (const p of CAPTION_PACKS) {
  const out = applyCaptionPack(enClip, p.id);
  ok(out, `${p.id} applies`);
  assert.deepEqual(out.text, enClip.text, `${p.id}: text unchanged`);
  assert.deepEqual(out.words, enClip.words, `${p.id}: word timings unchanged`);
  assert.equal(out.start, enClip.start, `${p.id}: start unchanged`);
  assert.equal(out.duration, enClip.duration, `${p.id}: duration unchanged`);
  assert.equal(out.caption, true, `${p.id}: still a caption`);
  ok(out.font && out.highlight, `${p.id}: a style actually lands`);
  // Re-applying a different pack never loses the transcript either.
  const out2 = applyCaptionPack(out, 'pack-fade-reveal');
  assert.deepEqual(out2.words, enClip.words, `${p.id} -> fade-reveal: words survive a second pack`);
}

// --- Arabic: transcript independence + pack safety ---------------------------
const arClip = {
  id: 'cap2', text: 'صُنع بواسطة Cutflow، وهذا رائع!', caption: true, source: 'srt',
  start: 0.5, duration: 4,
  words: [
    { text: 'صُنع', start: 0, end: 0.8 }, { text: 'بواسطة', start: 0.8, end: 1.6 },
    { text: 'Cutflow،', start: 1.6, end: 2.4 }, { text: 'وهذا', start: 2.4, end: 3.2 },
    { text: 'رائع!', start: 3.2, end: 4 },
  ],
  template: 'cap-arabic', font: 'cairo',
};
const ar = applyCaptionPack(arClip, 'pack-arabic-safe');
assert.deepEqual(ar.text, arClip.text, 'arabic-safe: text unchanged (incl. Latin name + Arabic comma)');
assert.deepEqual(ar.words, arClip.words, 'arabic-safe: word timings unchanged');
assert.equal(ar.uppercase, false, 'arabic-safe: no uppercasing');
assert.equal(ar.font, 'tajawal', 'arabic-safe: an Arabic font');
assert.equal(ar.italic, false, 'arabic-safe: Arabic never takes italic');
ok((ar.lineHeight || 0) >= 1.3, 'arabic-safe: generous line spacing');
ok(packIsArabicSafe('pack-arabic-safe'), 'arabic-safe reports Arabic-safe');
ok(!packIsArabicSafe('pack-word-pop'), 'word-pop is honest about not being Arabic-safe (uppercase template)');
ok(!packIsArabicSafe('nope'), 'an unknown pack is not Arabic-safe');

// --- Real render: Arabic caption through drawTextClip ------------------------
// A stub canvas context: measureText widths scale with the current font
// size, fillText calls are recorded with their positions.
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
  fillText(text, x, y) { this.calls.push({ text: String(text), x: x + this._tx, y: y + this._ty, w: this.measureText(text).width, kind: 'fill' }); }
  strokeText(text, x, y) { this.calls.push({ text: String(text), x: x + this._tx, y: y + this._ty, w: this.measureText(text).width, kind: 'stroke' }); }
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
const W = 1080; const H = 1920;
// A long Arabic line that must wrap: two lines, no overlap, RTL order.
const longAr = {
  ...arClip,
  text: 'هذا فيديو طويل جداً عن صناعة المحتوى بالدارجة المغربية واللغة العربية',
  words: undefined, // even split: timings are not the point here
  duration: 6,
};
const applied = applyCaptionPack(longAr, 'pack-arabic-safe');
const ctx = new StubCtx();
drawTextClip(ctx, applied, 1, W, H);
const fills = ctx.calls.filter((c) => c.kind === 'fill');
ok(fills.length > 0, 'the Arabic caption draws words');
// Every word of the text is drawn (split into words by the renderer).
const drawn = fills.map((c) => c.text).join(' ');
for (const w of longAr.text.split(/\s+/)) ok(drawn.includes(w), `word "${w}" is drawn`);
// No two words on the same line overlap: x-intervals (by measured width)
// are disjoint within each y row.
const rows = {};
for (const c of fills) {
  const key = Math.round(c.y);
  (rows[key] = rows[key] || []).push(c);
}
for (const [y, row] of Object.entries(rows)) {
  const spans = row.map((c) => ({ x0: c.x, x1: c.x + (c.w || 0), text: c.text })).sort((a, b) => a.x0 - b.x0);
  for (let i = 1; i < spans.length; i++) {
    ok(spans[i].x0 >= spans[i - 1].x1 - 1, `row y=${y}: "${spans[i - 1].text}" and "${spans[i].text}" do not overlap`);
  }
}
// RTL: the first word in reading order is drawn rightmost (largest x) on
// its line, and the line is flagged RTL by the layout.
const firstRow = rows[Math.min(...Object.keys(rows).map(Number))];
const firstWord = firstRow.reduce((a, b) => (a.x > b.x ? a : b));
ok(firstWord.text === longAr.text.split(/\s+/)[0], `RTL: the first word "${longAr.text.split(/\s+/)[0]}" sits rightmost (got "${firstWord.text}")`);
// Two lines: the long text wraps instead of running off the frame.
ok(Object.keys(rows).length >= 2, `long Arabic caption wraps to ${Object.keys(rows).length} lines`);
// Line spacing: rows are at least one line-height apart (no vertical overlap).
const ys = Object.keys(rows).map(Number).sort((a, b) => a - b);
const st = resolveStyle(applied);
for (let i = 1; i < ys.length; i++) ok(ys[i] - ys[i - 1] >= st.size * 1.15 - 1, 'stacked lines are a full line-height apart');

// The same render check on the English pack: words drawn, no overlap.
{
  const ctx2 = new StubCtx();
  const en2 = applyCaptionPack({ ...enClip, text: 'Hello world this is a very long English caption that must wrap nicely', duration: 6, words: undefined }, 'pack-word-pop');
  drawTextClip(ctx2, en2, 1, W, H);
  const f2 = ctx2.calls.filter((c) => c.kind === 'fill');
  ok(f2.length > 0, 'the English pack draws words');
  const rows2 = {};
  for (const c of f2) (rows2[Math.round(c.y)] = rows2[Math.round(c.y)] || []).push(c);
  ok(Object.keys(rows2).length >= 2, 'long English caption wraps too');
}

console.log('CAPTION-PACKS OK');
