// CC-06 Animated graphics: the pure graphic logic (src/text/graphic.js),
// the 10 named templates in the catalog, the renderer wiring
// (source-checked, the same way test-textanim.mjs proves animState cases
// exist), and the static-frame rules the exporter relies on (time-driven
// kinds are never static; the rest settle with their entrance).
// Live preview/export proof lives in the CDP verification run, not here.
// Run: node scripts/test-cc06-graphics.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GRAPHIC_KINDS, TIME_DRIVEN_KINDS, DEFAULT_GRAPHIC, resolveGraphic,
  parseEndNumber, parseTimerSeconds, formatTimer, formatNumber, countValue,
  ringFraction, timerRemaining, splitGraphicText,
} from '../src/text/graphic.js';
import { TEXT_TEMPLATES, TEMPLATE_CATEGORIES } from '../src/text/catalog.js';
import { clipStaticSignature } from '../src/text/staticFrame.js';

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const renderSrc = fs.readFileSync(new URL('../src/text/render.js', import.meta.url), 'utf8');

// --- Spec resolution ---------------------------------------------------------
assert.equal(DEFAULT_GRAPHIC.kind, 'title', 'default graphic kind is title');
assert.deepEqual(resolveGraphic({ kind: 'number', from: 5 }).arrow, DEFAULT_GRAPHIC.arrow,
  'resolveGraphic keeps the default arrow when only the kind changes');
assert.equal(resolveGraphic({ kind: 'callout', arrow: { dx: 0.3 } }).arrow.dy, DEFAULT_GRAPHIC.arrow.dy,
  'resolveGraphic merges the arrow one level deep');
assert.equal(resolveGraphic({ kind: 'timer', seconds: 30 }).seconds, 30, 'a timer override wins');
assert.equal(resolveGraphic(null).kind, 'title', 'a null spec resolves to defaults');
assert.ok(GRAPHIC_KINDS.includes('ring') && GRAPHIC_KINDS.includes('twoline'), 'all 10 kinds are known');
assert.deepEqual([...TIME_DRIVEN_KINDS].sort(), ['number', 'ring', 'timer'], 'number/ring/timer are the time-driven kinds');

// --- Number parsing / formatting (Kinetic Number) ----------------------------
assert.equal(parseEndNumber('1,250', 100), 1250, '"1,250" parses to 1250');
assert.equal(parseEndNumber('$99', 100), 99, '"$99" parses to 99');
assert.equal(parseEndNumber('12.5', 100), 12.5, 'decimals survive the parse');
assert.equal(parseEndNumber('no digits here', 100), 100, 'text with no number falls back');
assert.equal(formatNumber(1250, 0, '', ''), '1,250', 'whole numbers get separators');
assert.equal(formatNumber(99.5, 1, '', ''), '99.5', 'one decimal formats cleanly');
assert.equal(formatNumber(12, 0, '$', ''), '$12', 'a prefix wraps the number');
assert.equal(countValue(0, 100, 0), 0, 'the count starts at `from`');
assert.equal(countValue(0, 100, 1), 100, 'the count ends at `to`');
assert.ok(approx(countValue(0, 100, 0.5), 87.5), `the count eases out (mid = ${countValue(0, 100, 0.5)})`);
assert.equal(countValue(50, 150, 1), 150, 'a non-zero `from` counts up from there');

// --- Timer parsing / formatting (Timer Countdown) ----------------------------
assert.equal(parseTimerSeconds('1:30', 10), 90, '"1:30" is 90 seconds');
assert.equal(parseTimerSeconds('0:10', 10), 10, '"0:10" is 10 seconds');
assert.equal(parseTimerSeconds('45', 10), 45, 'a plain number is seconds');
assert.equal(parseTimerSeconds('soon', 10), 10, 'unparseable text falls back to the spec');
assert.equal(formatTimer(10), '0:10', '10 s formats as 0:10');
assert.equal(formatTimer(65), '1:05', '65 s formats as 1:05');
assert.equal(formatTimer(0), '0:00', '0 s formats as 0:00');
assert.equal(formatTimer(59.2), '1:00', 'a part-second rounds up, never early to 0:00');
assert.equal(timerRemaining(10, 3), 7, '7 s left after 3 s');
assert.equal(timerRemaining(10, 12), 0, 'the timer clamps at zero past its duration');

// --- Ring + two-line helpers --------------------------------------------------
assert.equal(ringFraction(0, 3), 0, 'the ring starts empty');
assert.equal(ringFraction(1.5, 3), 0.5, 'the ring is half full halfway');
assert.equal(ringFraction(3, 3), 1, 'the ring is full at the end');
assert.equal(ringFraction(9, 3), 1, 'the ring never overfills');
assert.deepEqual(splitGraphicText('Big ideas\nSmall steps'), { line1: 'Big ideas', line2: 'Small steps' },
  'two-line text splits on the newline');
assert.deepEqual(splitGraphicText('Only one line'), { line1: 'Only one line', line2: '' },
  'a single line has no line 2');

// --- The 10 named templates ---------------------------------------------------
const EXPECTED = [
  ['gfx-minimal-title', 'Minimal Title', 'title'],
  ['gfx-editorial-third', 'Editorial Lower Third', 'lowerThird'],
  ['gfx-rounded-label', 'Rounded Label', 'label'],
  ['gfx-outline-label', 'Outline Label', 'label'],
  ['gfx-callout-arrow', 'Callout Arrow', 'callout'],
  ['gfx-kinetic-number', 'Kinetic Number', 'number'],
  ['gfx-progress-ring', 'Progress Ring', 'ring'],
  ['gfx-timer-countdown', 'Timer Countdown', 'timer'],
  ['gfx-text-box-pop', 'Text Box Pop', 'boxpop'],
  ['gfx-two-line-scale', 'Two-Line Scale Reveal', 'twoline'],
];
const gfx = TEXT_TEMPLATES.filter((t) => t.id.startsWith('gfx-'));
assert.equal(gfx.length, 10, `10 animated graphics (got ${gfx.length})`);
assert.ok(TEMPLATE_CATEGORIES.includes('Graphics'), 'Graphics is a browse category');
for (const [id, name, kind] of EXPECTED) {
  const t = TEXT_TEMPLATES.find((x) => x.id === id);
  assert.ok(t, `${id} exists`);
  assert.equal(t.name, name, `${id} is named "${name}"`);
  assert.equal(t.cat, 'Graphics', `${id} browses under Graphics`);
  assert.ok((t.tags || []).includes('Graphics'), `${id} is tagged Graphics`);
  assert.ok(t.patch.graphic, `${id} carries a graphic spec`);
  assert.equal(t.patch.graphic.kind, kind, `${id} is a ${kind} graphic`);
  assert.ok(GRAPHIC_KINDS.includes(t.patch.graphic.kind), `${id} kind is known`);
  assert.ok(t.patch.font, `${id} sets a font`);
}
// The text stays editable: the number counts to the value in its text, the
// timer counts down from the duration in its text, the ring's label is its
// text, and the rest render their text directly.
const num = TEXT_TEMPLATES.find((t) => t.id === 'gfx-kinetic-number');
assert.equal(parseEndNumber(num.patch.text, 100), 1250, 'Kinetic Number counts to the 1,250 in its text');
const tim = TEXT_TEMPLATES.find((t) => t.id === 'gfx-timer-countdown');
assert.equal(parseTimerSeconds(tim.patch.text, 10), 10, 'Timer Countdown counts down from the 0:10 in its text');
const third = TEXT_TEMPLATES.find((t) => t.id === 'gfx-editorial-third');
assert.equal(splitGraphicText(third.patch.text).line1, 'Your Name', 'the lower third has an editable name line');
assert.equal(splitGraphicText(third.patch.text).line2, 'Your Role', 'the lower third has an editable role line');
// No graphic ships audio: the spec has no SFX field and no template names one.
for (const t of gfx) {
  assert.ok(!('sfx' in (t.patch.graphic || {})), `${t.id} carries no SFX`);
  assert.ok(!/whoosh|pop-sound|sfx/i.test(t.name), `${t.id} names no sound`);
}

// --- Renderer wiring (source) -------------------------------------------------
assert.ok(renderSrc.includes('function drawGraphicClip'), 'render.js has the graphic draw path');
assert.ok(renderSrc.includes('if (st.graphic) {'), 'drawTextClip dispatches to the graphic path');
for (const kind of GRAPHIC_KINDS) {
  assert.ok(renderSrc.includes(`g.kind === '${kind}'`), `drawGraphicClip handles '${kind}'`);
}
assert.ok(renderSrc.includes("resolveGraphic(s.graphic)"), 'resolveStyle merges the graphic spec');
assert.ok(renderSrc.includes('paintGraphicRun'), 'graphics paint whole words via the shared layout');
assert.ok(renderSrc.includes('textReducedMotion()'), 'the graphic path honours Reduce Motion');

// --- Static-frame behaviour ---------------------------------------------------
const settled = (kind) => ({
  id: 'g1', duration: 3, text: 'Hello', animIn: { id: 'fade', dur: 0.3 },
  animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none' }, graphic: { kind },
});
for (const kind of ['number', 'timer', 'ring']) {
  assert.equal(clipStaticSignature(settled(kind), 1.5), null, `${kind} is never static mid-clip`);
}
for (const kind of ['title', 'lowerThird', 'label', 'callout', 'boxpop', 'twoline']) {
  assert.ok(clipStaticSignature(settled(kind), 1.5) !== null, `${kind} settles like a normal text clip`);
  assert.equal(clipStaticSignature(settled(kind), 0.1), null, `${kind} is not static mid-entrance`);
}

console.log('test-cc06-graphics ok (10 graphics, time-driven values, static-frame rules, text stays editable)');
