// Neon Pop Duo: timing math, seeded offsets, RTL segmentation, short-clip
// compression, and the static-frame plug-in the exporter relies on.
// Pure logic (src/text/duo.js + src/text/staticFrame.js) — no DOM, no app.
import assert from 'node:assert/strict';
import {
  DEFAULT_DUO, resolveDuo, duoTiming, duoSettledAt, graphemes, wordsOf, isRtl,
  splitDuoText, wordGraphemeStarts, seededFloat, easeDuo, dropBounceDy, mulberry32,
} from '../src/text/duo.js';
import * as duoMod from '../src/text/duo.js';
import { TEXT_TEMPLATES } from '../src/text/catalog.js';
import { clipStaticSignature } from '../src/text/staticFrame.js';

const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- The catalog entry -------------------------------------------------------
const duo = TEXT_TEMPLATES.find((t) => t.id === 'neon-pop-duo');
assert.ok(duo, 'neon-pop-duo exists in the catalog');
assert.equal(duo.name, 'Neon Pop Duo');
assert.equal(duo.cat, 'Captions');
assert.equal(duo.caption, true);
assert.equal(duo.patch.text, 'Bezaf dyal lmgharba\nMachi Professionnel');
assert.equal(duo.patch.y, 0.6);
assert.equal(duo.patch.duration, 3);
assert.ok(duo.patch.duo !== undefined, 'patch carries a duo spec');
assert.equal(duo.patch.animIn.id, 'none');
assert.equal(duo.patch.animOut.id, 'none');

// --- Timing: the 3 s sample --------------------------------------------------
// Line 1 "Bezaf dyal lmgharba" = 3 words; line 2 "Machi Professionnel" = 19
// graphemes (18 letters + 1 space). Counts come from the real strings
// (wordsOf / graphemes), not hand-counted. Defaults: stagger 120, enter 280,
// startDelay 150, char 35, charDur 200, holdEnd 120.
const spec = resolveDuo(duo.patch.duo);
const n1 = wordsOf('Bezaf dyal lmgharba').length;
const n2 = graphemes('Machi Professionnel').length;
assert.equal(n1, 3, 'line 1 is 3 words');
assert.equal(n2, 19, 'line 2 is 19 graphemes');
const T = duoTiming(spec, n1, n2, spec.line2.charMs, 3000);
assert.equal(T.scale, 1, 'the 3 s sample needs no compression');
assert.ok(approx(T.line1End, 520), `line 1 ends at 520 ms, got ${T.line1End}`);
assert.ok(approx(T.line2Start, 670), `line 2 starts at 670 ms, got ${T.line2Start}`);
assert.ok(approx(T.line2End, 1500), `line 2 ends at 1500 ms, got ${T.line2End}`);
assert.ok(approx(T.exitStart, 2880), `exit starts at 2880 ms, got ${T.exitStart}`);
assert.ok(approx(T.exitDur, 100));

// --- Short-clip compression --------------------------------------------------
const short = duoTiming(spec, 4, 18, spec.line2.charMs, 1200);
assert.ok(short.scale < 1 && short.scale >= 0.1, `compression scale in [0.1, 1), got ${short.scale}`);
assert.ok(short.line2End <= 1200 - 120 - 300 + 1e-6, `line 2 finishes >=300 ms before the exit, got ${short.line2End}`);
// A 1 s clip still compresses (floor 0.1) instead of overflowing the exit.
const tiny = duoTiming(spec, 5, 20, spec.line2.charMs, 1000);
assert.ok(tiny.scale >= 0.1, `compression floor holds, got ${tiny.scale}`);
// Line 1 alone (no line 2) compresses its stagger the same way.
const solo = duoTiming(spec, 6, 0, spec.line2.charMs, 900);
assert.ok(solo.line1End <= 900 - 120 - 300 + 1e-6, `line-1-only finishes in time, got ${solo.line1End}`);
// Speed multiplies: 2x halves the stagger and the typing step.
const fast = duoTiming({ ...spec, speed: 2 }, 4, 18, spec.line2.charMs, 3000);
assert.ok(approx(fast.stagger, 60), `2x stagger is 60 ms, got ${fast.stagger}`);
assert.ok(approx(fast.step, 17.5), `2x char step is 17.5 ms, got ${fast.step}`);

// --- Seeded baseline float ---------------------------------------------------
const a = seededFloat(7, 0);
const b = seededFloat(7, 0);
assert.equal(a, b, 'same seed + word index gives the same offset (deterministic)');
assert.ok(a >= -0.18 && a <= 0.18, `offset inside [-0.18em, +0.18em], got ${a}`);
const offsets = [0, 1, 2, 3].map((i) => seededFloat(7, i));
assert.equal(new Set(offsets).size, 4, 'different words float differently');
assert.equal(mulberry32(7)(), mulberry32(7)(), 'mulberry32 is deterministic');
assert.notEqual(mulberry32(7)(), mulberry32(8)(), 'different seeds differ');

// --- Easing ------------------------------------------------------------------
assert.equal(easeDuo(0), 0);
assert.equal(easeDuo(1), 1);
let prev = 0;
for (let i = 1; i <= 10; i++) {
  const v = easeDuo(i / 10);
  assert.ok(v >= prev && v <= 1, `easeDuo is monotonic, got ${v} after ${prev}`);
  prev = v;
}

// --- Segmentation / RTL ------------------------------------------------------
assert.deepEqual(graphemes('بزاف'), ['ب', 'ز', 'ا', 'ف']);
assert.deepEqual(wordsOf('بزاف ديال المغاربة'), ['بزاف', 'ديال', 'المغاربة']);
assert.equal(isRtl('بزاف ديال المغاربة'), true);
assert.equal(isRtl('Bezaf dyal lmgharba'), false);
assert.equal(isRtl('Mli kanet 3andi 18ans'), false);
const ar = splitDuoText('بزاف ديال المغاربة\nمشي بروفيسيونال');
assert.equal(ar.line1, 'بزاف ديال المغاربة');
assert.equal(ar.line2, 'مشي بروفيسيونال');
const one = splitDuoText('Bezaf dyal lmgharba');
assert.equal(one.line1, 'Bezaf dyal lmgharba');
assert.equal(one.line2, '');
assert.deepEqual(wordGraphemeStarts('Machi Professionnel'), [0, 6]);
assert.deepEqual(wordGraphemeStarts('بزاف ديال'), [0, 5]);
// Arabic line 2 animates per word, never per letter: 2 words, not 15 graphemes.
assert.equal(wordsOf(ar.line2).length, 2);
assert.ok(graphemes(ar.line2).length > 2);

// --- Spec resolution ---------------------------------------------------------
const merged = resolveDuo({ speed: 1.5, line1: { stagger: 200 } });
assert.equal(merged.speed, 1.5);
assert.equal(merged.line1.stagger, 200);
assert.equal(merged.line1.enterDur, DEFAULT_DUO.line1.enterDur, 'untouched sub-values keep defaults');
assert.equal(merged.line2.charMs, DEFAULT_DUO.line2.charMs);
assert.equal(merged.rtl.font1, 'cairomed');
assert.equal(merged.rtl.bold1, false, 'Arabic line 1 is Medium, not bold');
assert.equal(merged.rtl.bold2, true, 'Arabic line 2 is Bold');

// --- Bounce variant ----------------------------------------------------------
// The original stays bounce-off; the clone turns it on, everything else equal.
assert.equal(resolveDuo(duo.patch.duo).bounce, false, 'original has bounce off');
const bnc = TEXT_TEMPLATES.find((t) => t.id === 'neon-pop-duo-bounce');
assert.ok(bnc, 'neon-pop-duo-bounce exists in the catalog');
assert.equal(bnc.name, 'Neon Pop Duo Bounce');
assert.equal(bnc.cat, 'Captions');
assert.equal(bnc.caption, true);
assert.equal(bnc.patch.text, duo.patch.text, 'same sample text');
assert.equal(bnc.patch.y, duo.patch.y);
assert.equal(bnc.patch.duration, duo.patch.duration);
assert.equal(resolveDuo(bnc.patch.duo).bounce, true, 'clone has bounce on');
assert.equal(resolveDuo(bnc.patch.duo).speed, DEFAULT_DUO.speed, 'clone keeps default speed');
assert.equal(resolveDuo(bnc.patch.duo).line1.stagger, DEFAULT_DUO.line1.stagger, 'clone keeps default stagger');
// Bounce is a curve change, never a timing change: the clone's schedule is
// identical to the original's.
const bspec = resolveDuo(bnc.patch.duo);
const Tb = duoTiming(bspec, n1, n2, bspec.line2.charMs, 3000);
assert.equal(Tb.scale, 1);
assert.ok(approx(Tb.line1End, 520), `bounce line 1 ends at 520 ms, got ${Tb.line1End}`);
assert.ok(approx(Tb.line2End, 1500), `bounce line 2 ends at 1500 ms, got ${Tb.line2End}`);
assert.ok(approx(Tb.exitStart, 2880));
// Drop tokens: 0.55 em above the line, 300 ms fall + 250 ms bounce = 550 ms.
assert.equal(bspec.line1.dropHeight, 0.55, 'drop height is 0.55 em');
assert.equal(bspec.line1.dropVar, 0.1, 'drop height varies ±0.1 em');
assert.equal(bspec.line1.dropFallDur, 300, 'fall is 300 ms');
assert.equal(bspec.line1.dropBounceDur, 250, 'bounce is 250 ms');
assert.ok(approx(Tb.dropDur, 550), `bounce drop window is 550 ms, got ${Tb.dropDur}`);
assert.ok(approx(Tb.dropFallFrac, 300 / 550), `fall share is 300/550, got ${Tb.dropFallFrac}`);

// --- Drop-bounce curve -------------------------------------------------------
// The old scale pop and sine dip are gone: bounceScale / bounceFloatDy /
// easeOutBack no longer exist in duo.js — the word TRAVELS down into place,
// it never pops in place.
assert.equal(duoMod.bounceScale, undefined, 'bounceScale (the scale pop) is removed');
assert.equal(duoMod.bounceFloatDy, undefined, 'bounceFloatDy (the sine dip) is removed');
assert.equal(duoMod.easeOutBack, undefined, 'easeOutBack is removed with the old bounce');
// dropBounceDy: starts at the drop height above the baseline (negative dy),
// falls with gravity to 0, bounces once below (+0.08 em), rebounds above
// (−0.03 em), settles exactly at 0. No scale: the renderer holds scale 1.0
// in bounce mode (verified live — a scale pop would widen the word ~8%).
const fallFrac = 300 / 550;
assert.ok(approx(dropBounceDy(0, -0.55), -0.55), 'drop starts 0.55 em above the baseline');
assert.ok(approx(dropBounceDy(fallFrac, -0.55), 0, 1e-9), 'drop lands exactly on the baseline');
// Mid-fall the word is still above the line and moving down (ease-in: the
// first half of the fall covers less than half the height).
const midFall = dropBounceDy(fallFrac / 2, -0.55);
assert.ok(midFall < -0.4 && midFall > -0.55, `mid-fall still above the line, got ${midFall.toFixed(4)}`);
// Bounce peak: +0.08 em below the baseline; rebound: −0.03 em above it.
let peakDy = -Infinity, peakQ = 0, troughDy = Infinity, troughQ = 0;
for (let i = 0; i <= 1000; i++) {
  const q = fallFrac + (i / 1000) * (1 - fallFrac);
  const v = dropBounceDy(q, -0.55);
  if (v > peakDy) { peakDy = v; peakQ = q; }
  if (v < troughDy) { troughDy = v; troughQ = q; }
}
assert.ok(peakDy > 0.075 && peakDy < 0.085, `bounce overshoot is +0.08 em, got ${peakDy.toFixed(4)} at q = ${peakQ.toFixed(3)}`);
assert.ok(troughDy < -0.025 && troughDy > -0.035, `bounce rebound is −0.03 em, got ${troughDy.toFixed(4)} at q = ${troughQ.toFixed(3)}`);
assert.ok(peakQ < troughQ, 'overshoot comes before the rebound');
assert.ok(approx(dropBounceDy(1, -0.55), 0, 1e-9), 'drop-bounce settles exactly at 0');
// One bounce only: after landing the word never overshoots past +0.08 em or
// rebounds past −0.03 em — no second bounce, no oscillation.
for (let i = 0; i <= 200; i++) {
  const q = fallFrac + (i / 200) * (1 - fallFrac);
  const v = dropBounceDy(q, -0.55);
  assert.ok(v <= 0.081 && v >= -0.031, `one bounce only at q = ${q.toFixed(3)}, got ${v.toFixed(4)}`);
}
// The plain entry (original preset) never overshoots: 0.92 + 0.08 * easeDuo
// stays in [0.92, 1] — only the bounce variant drops, and it never scales.
for (let i = 0; i <= 100; i++) {
  const plain = 0.92 + 0.08 * easeDuo(i / 100);
  assert.ok(plain >= 0.92 && plain <= 1.0, `plain scale stays in [0.92, 1], got ${plain} at ${i / 100}`);
}
// Every seeded word of the real preset starts well above the line
// (drop height 0.55 ± 0.1 em) and lands on it.
for (let i = 0; i < 10; i++) {
  const startEm = -(bspec.line1.dropHeight + seededFloat(7, i, bspec.line1.dropVar));
  assert.ok(startEm < -0.4 && startEm >= -0.65, `word ${i} starts above the line, got ${startEm.toFixed(4)}`);
  assert.ok(approx(dropBounceDy(0, startEm), startEm), `word ${i} starts at its drop height`);
  assert.ok(approx(dropBounceDy(1, startEm), 0, 1e-9), `word ${i} settles at 0`);
}

// --- Static-frame plug-in ----------------------------------------------------
// The same duo clip: moving during the entries, settled in the hold window,
// moving again once the exit starts — so the exporter never reuses a stale frame.
const clip = {
  id: 'duo-test', text: 'Bezaf dyal lmgharba\nMachi Professionnel',
  start: 0, duration: 3, template: 'neon-pop-duo', ...duo.patch,
};
assert.equal(clipStaticSignature(clip, 0.2), null, 'entering line 1 is not static');
assert.equal(clipStaticSignature(clip, 1.0), null, 'typing line 2 is not static');
assert.ok(clipStaticSignature(clip, 2.0), 'hold window is static');
assert.equal(clipStaticSignature(clip, 2.95), null, 'exit is not static');
// A plain clip with no anims is still static in its middle (unchanged behaviour).
assert.ok(clipStaticSignature({ id: 'plain', text: 'Hi', duration: 3, animIn: { id: 'none', dur: 0 }, animOut: { id: 'none', dur: 0 } }, 1.5));

console.log('neon-pop-duo ok (timing, seeded float, RTL segmentation, compression, static-frame, bounce)');
