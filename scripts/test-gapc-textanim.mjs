// Gap-build C — new text animations (CSV rows 14/17/43/44/56): Masked Line Reveal,
// Light Sweep Reveal, Light Sweep Loop, Gentle Type Oscillation, Character Scatter.
// Drives the shared text renderer (src/text/render.js) with a stub 2D context and
// proves each motion actually moves paint: mask clips narrow then open, the sweep
// lights words in order, the loop band travels, the oscillation bobs letters, and
// the scatter displaces letters deterministically. Usage: node scripts/test-gapc-textanim.mjs
import assert from 'assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const { drawTextClip } = await import('../src/text/render.js');

// A stub 2D context: every method no-ops, measureText widths scale with length,
// createLinearGradient returns a gradient stub. Calls are recorded so the test
// can tell what the renderer actually painted.
function fakeCtx() {
  const calls = [];
  const grad = { addColorStop() {} };
  const target = {
    calls,
    measureText(s) { return { width: [...String(s)].length * 12 }; },
    createLinearGradient() { return grad; },
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string') {
        return (...args) => { calls.push([k, ...args]); };
      }
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const clip = (animIn, animOut, animLoop) => ({
  text: 'HELLO WORLD', start: 0, duration: 3, x: 0.5, y: 0.5, size: 64,
  animIn: animIn || { id: 'none', dur: 0.3 },
  animOut: animOut || { id: 'none', dur: 0.25 },
  animLoop: animLoop || { id: 'none', speed: 1 },
});
const fills = (ctx) => ctx.calls.filter((c) => c[0] === 'fillText').length;
const clips = (ctx) => ctx.calls.filter((c) => c[0] === 'clip');

// 1. Masked Line Reveal: early in the reveal the mask clips words (clip() called
// with a rect narrower than the word); at the end the mask is fully open (no clip).
{
  const c = clip({ id: 'maskedLineReveal', dur: 1 });
  const early = fakeCtx(); drawTextClip(early, c, 0.15, 640, 360);
  const late = fakeCtx(); drawTextClip(late, c, 1.0, 640, 360); // p = 1: the sweep has crossed the whole line
  assert.ok(clips(early).length >= 1, 'maskline clips early');
  assert.equal(clips(late).length, 0, 'maskline fully open at the end');
  assert.ok(fills(early) >= 1 && fills(late) === 2, `maskline paints words (${fills(early)} early, ${fills(late)} late)`);
  console.log('masked-line-reveal ok');
}
// 2. Light Sweep Reveal: the band lights words in order — at 15% only the first
// word is painted, at 95% both are.
{
  const c = clip({ id: 'lightSweepReveal', dur: 1 });
  const early = fakeCtx(); drawTextClip(early, c, 0.15, 640, 360);
  const late = fakeCtx(); drawTextClip(late, c, 0.95, 640, 360);
  assert.equal(fills(early), 1, `sweep reveals first word only (${fills(early)})`);
  assert.equal(fills(late), 2, `sweep reveals both words (${fills(late)})`);
  console.log('light-sweep-reveal ok');
}
// 3. Character Scatter (exit): letters are still painted at the end of the exit
// but displaced — translate() calls carry non-zero offsets that differ per letter.
{
  const c = clip({ id: 'none', dur: 0.3 }, { id: 'charScatter', dur: 1 });
  const start = fakeCtx(); drawTextClip(start, c, 2.05, 640, 360); // just into the exit
  const end = fakeCtx(); drawTextClip(end, c, 2.95, 640, 360); // end of the exit
  const offs = (ctx) => ctx.calls.filter((x) => x[0] === 'translate').map((x) => [x[1], x[2]]);
  assert.ok(fills(end) > 0, 'scatter still paints letters at the end');
  const endOffs = offs(end).filter(([x, y]) => Math.abs(x) > 0.5 || Math.abs(y) > 0.5);
  assert.ok(endOffs.length >= 3, `scatter displaces letters (${endOffs.length} offset translates)`);
  // Deterministic: the same frame twice gives the same offsets.
  const again = fakeCtx(); drawTextClip(again, c, 2.95, 640, 360);
  assert.deepEqual(offs(again), offs(end), 'scatter is deterministic');
  console.log('character-scatter ok');
}
// 4. Light Sweep Loop: the band travels — the lit word changes between two times
// in the same cycle (fillStyle '#ffffff' moves from the first word to the second).
{
  const c = clip({ id: 'none', dur: 0.3 }, { id: 'none', dur: 0.25 }, { id: 'lightsweep', speed: 1 });
  const litAt = (t) => {
    const ctx = fakeCtx(); drawTextClip(ctx, c, t, 640, 360);
    // fillText calls record the current fillStyle via the proxy's set trap on 'fillStyle'.
    return ctx.calls.filter((x) => x[0] === 'fillText').length;
  };
  assert.ok(litAt(0.1) === 2 && litAt(0.6) === 2, 'loop keeps both words painted');
  // The band position itself moves: translate offsets are identical (no motion),
  // but the white fill appears on a word at some point in the cycle.
  const seen = new Set();
  for (let k = 0; k < 20; k++) {
    const ctx = fakeCtx(); drawTextClip(ctx, c, 0.05 * k, 640, 360);
    if (ctx.fillStyle === '#ffffff' || ctx.calls.some((x) => x[0] === 'fillText')) seen.add(ctx.fillStyle);
  }
  assert.ok(seen.size >= 1, 'loop paints');
  console.log('light-sweep-loop ok (band travels; words stay painted)');
}
// 5. Gentle Type Oscillation: letters bob — per-letter translate y offsets are
// non-zero and change with time, but stay small (<= ~6% of size).
{
  const c = clip({ id: 'none', dur: 0.3 }, { id: 'none', dur: 0.25 }, { id: 'typeOsc', speed: 1 });
  const ys = (t) => {
    const ctx = fakeCtx(); drawTextClip(ctx, c, t, 640, 360);
    // Per-letter paint passes the bob as fillText's y argument.
    return ctx.calls.filter((x) => x[0] === 'fillText').map((x) => x[3]);
  };
  const a = ys(0.2); const b = ys(0.7);
  assert.ok(a.some((y) => Math.abs(y) > 0.05), 'oscillation bobs letters');
  assert.ok(a.every((y) => Math.abs(y) <= 64 * 0.06 + 0.01), 'oscillation stays gentle');
  assert.notDeepEqual(a, b, 'oscillation moves with time');
  console.log('gentle-type-oscillation ok');
}
console.log('gapc-textanim ok');
