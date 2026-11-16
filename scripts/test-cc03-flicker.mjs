// CC-03 Text Flicker, Digital Decode & Word/Character Animations.
// The safe-flicker envelope (pure, src/text/flicker.js), the 13 named
// presets in the catalog, the renderer wiring (source-checked, the same way
// test-textanim.mjs proves animState cases exist), and the Arabic-safety
// rules: character motion never splits joined script — Arabic falls back to
// word-level units, and the per-character paint loop never runs for RTL.
// Live preview/export proof lives in the CDP verification run, not here.
// Run: node scripts/test-cc03-flicker.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { flickerEnvelope, flickerEarlyPeak, wordFlickerAlpha } from '../src/text/flicker.js';
import { TEXT_TEMPLATES, ANIM_IN, ANIM_OUT } from '../src/text/catalog.js';
import { INHERENT_UNIT_ANIMS, effectiveUnit } from '../src/text/units.js';
import { clipStaticSignature } from '../src/text/staticFrame.js';

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const renderSrc = fs.readFileSync(new URL('../src/text/render.js', import.meta.url), 'utf8');

// --- The safe-flicker envelope ----------------------------------------------
assert.equal(flickerEnvelope(0), 0, 'envelope starts dark');
assert.equal(flickerEnvelope(1), 1, 'envelope ends at full brightness');
assert.equal(flickerEnvelope(0), flickerEnvelope(0), 'envelope is deterministic');
// The early pulses are weak: nothing before the hold starts (p < 0.35)
// reaches even half brightness — no full on/off flash, ever.
const earlyPeak = flickerEarlyPeak();
assert.ok(earlyPeak > 0.2 && earlyPeak < 0.5, `early pulses are weak but present (peak ${earlyPeak.toFixed(3)})`);
assert.ok(flickerEnvelope(0.2) > 0.2, `a pulse is visible mid-entrance (got ${flickerEnvelope(0.2).toFixed(3)})`);
// The hold: smooth ramp 0.35 -> 0.75, then full; monotone once it starts.
assert.ok(flickerEnvelope(0.6) > 0.6, `hold is well up by p=0.6 (got ${flickerEnvelope(0.6).toFixed(3)})`);
assert.equal(flickerEnvelope(0.8), 1, 'hold is full by p=0.8');
let prev = flickerEnvelope(0.35);
for (let i = 36; i <= 100; i++) {
  const v = flickerEnvelope(i / 100);
  assert.ok(v >= prev - 1e-9, `envelope never dips after the hold starts (p=${i / 100}, ${prev.toFixed(3)} -> ${v.toFixed(3)})`);
  prev = v;
}

// --- The per-word flicker alpha ---------------------------------------------
assert.equal(wordFlickerAlpha(0, 0, false), 0, 'word flicker starts hidden');
assert.equal(wordFlickerAlpha(1, 0, false), 1, 'word flicker ends solid');
assert.equal(wordFlickerAlpha(0.5, 3, true), 0.75, 'reduced motion fades the word in, no blink');
for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
  assert.equal(wordFlickerAlpha(0.5, i, true), 0.75, `reduced motion is blink-free for word ${i}`);
  const a = wordFlickerAlpha(0.5, i, false);
  assert.ok(a >= 0 && a <= 1, `word ${i} alpha in range (got ${a})`);
  assert.equal(a, wordFlickerAlpha(0.5, i, false), `word ${i} blink is deterministic`);
}
const blinked = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].some((i) => wordFlickerAlpha(0.5, i, false) < 0.4);
assert.ok(blinked, 'at least one word blinks off mid-window (the flicker reads)');

// --- The 13 named presets ----------------------------------------------------
const EXPECTED = [
  ['flk-soft-neon', 'Soft Neon Flicker'],
  ['flk-startup-neon', 'Startup Neon'],
  ['flk-flicker-reveal', 'Flicker Reveal'],
  ['flk-flicker-out', 'Flicker Out'],
  ['flk-digital-decode', 'Digital Decode'],
  ['flk-terminal-resolve', 'Terminal Resolve'],
  ['flk-signal-error', 'Signal Error'],
  ['flk-rgb-glitch', 'RGB Glitch Reveal'],
  ['flk-char-scan', 'Character Scan'],
  ['flk-word-flicker', 'Word Flicker'],
  ['flk-electric-subtitle', 'Electric Subtitle'],
  ['flk-gentle-pulse', 'Gentle Pulse'],
  ['flk-slow-neon', 'Slow Staggered Neon'],
];
const flk = TEXT_TEMPLATES.filter((t) => t.id.startsWith('flk-'));
assert.equal(flk.length, 13, `13 flicker/decode presets (got ${flk.length})`);
for (const [id, name] of EXPECTED) {
  const t = TEXT_TEMPLATES.find((x) => x.id === id);
  assert.ok(t, `${id} exists`);
  assert.equal(t.name, name, `${id} is named "${name}"`);
  assert.ok(t.patch.font, `${id} sets a font`);
  assert.ok(t.patch.animIn && t.patch.animOut, `${id} sets In + Out`);
}
// The four new renderer ids are registered on both sides of the catalog.
for (const id of ['flickerSoft', 'rgbGlitch', 'scan', 'wordFlicker']) {
  assert.ok(ANIM_IN.some((a) => a.id === id), `${id} is an In animation`);
  assert.ok(ANIM_OUT.some((a) => a.id === id), `${id} is an Out animation`);
}
// The scan and the word flicker are unit kinds: the renderer plays them per
// word, and a unit choice on them is meaningless (like typewriter/wordPop).
for (const id of ['scan', 'wordFlicker']) {
  assert.ok(INHERENT_UNIT_ANIMS.has(id), `${id} is an inherent unit anim`);
}
// Slow Staggered Neon staggers the envelope word by word via the unit slot.
const slow = TEXT_TEMPLATES.find((t) => t.id === 'flk-slow-neon');
assert.equal(slow.patch.animIn.unit, 'word', 'Slow Staggered Neon animates per word');
assert.ok(slow.patch.animIn.dur >= 1.5, `Slow Staggered Neon takes its time (${slow.patch.animIn.dur}s)`);

// --- Renderer wiring (source) ------------------------------------------------
const animStateSrc = renderSrc.slice(renderSrc.indexOf('function animState'), renderSrc.indexOf('function loopState'));
for (const id of ['flickerSoft', 'rgbGlitch', 'scan', 'wordFlicker']) {
  assert.ok(animStateSrc.includes(`case '${id}'`), `animState implements '${id}'`);
}
assert.ok(animStateSrc.includes('textReducedMotion() ? p : flickerEnvelope(p)'),
  'flickerSoft degrades to a plain fade under Reduce Motion/Flashing');
assert.ok(animStateSrc.includes("case 'rgbGlitch'"), 'rgbGlitch has a renderer case');
assert.ok(renderSrc.includes("u.kind === 'wordscan'"), 'the word loop plays the scan unit');
assert.ok(renderSrc.includes("u.kind === 'wordflicker'"), 'the word loop plays the word-flicker unit');
assert.ok((renderSrc.match(/u\.reveal \* nWords - i/g) || []).length >= 3,
  'wordscan/wordflicker stagger per word index, like the word presets');

// --- Arabic safety -----------------------------------------------------------
// 'char' on RTL text degrades to 'word' (units.js); the per-character paint
// loop never runs for an RTL paragraph (render.js perChar gate); the new
// units address whole words by index, never characters.
assert.equal(effectiveUnit('char', true), 'word', "char unit degrades to word for RTL text");
assert.equal(effectiveUnit('char', false), 'char', 'char unit stays char for Latin text');
assert.ok(renderSrc.includes('const perChar = !L.rtl'), 'the per-character loop is gated on non-RTL text');
assert.ok(renderSrc.includes("if (!perChar) {"), 'RTL words paint whole, never per character');
// A mixed Arabic+Latin line with diacritics is still a word list for the
// renderer: the scan/flicker units index words, so no code-point loop can
// break a join or split a tashkeel mark off its letter.
const mixed = 'النجاحُ يبدأ بِخُطوة Cutflow Pro';
assert.equal(mixed.split(/\s+/).filter(Boolean).length, 5, 'the mixed line is 5 whole words');

// --- Static-frame behaviour --------------------------------------------------
const flick = { id: 'f1', duration: 3, text: 'Hello world', animIn: { id: 'flickerSoft', dur: 1.2 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none' } };
assert.equal(clipStaticSignature(flick, 0.5), null, 'mid-entrance is not static');
assert.ok(clipStaticSignature(flick, 2) !== null, 'settled flicker is static (hold = one frame)');
const wf = { id: 'f2', duration: 3, text: 'Hello world', animIn: { id: 'wordFlicker', dur: 0.9 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none' } };
assert.equal(clipStaticSignature(wf, 0.4), null, 'mid word-flicker is not static');
assert.ok(clipStaticSignature(wf, 2) !== null, 'settled word-flicker is static');

console.log(`test-cc03-flicker ok (envelope peak ${earlyPeak.toFixed(3)}, 13 presets, 4 renderer anims, Arabic word-level fallback)`);
