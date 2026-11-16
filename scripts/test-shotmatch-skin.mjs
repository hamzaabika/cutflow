// Colour management, advanced (P2-19): skin-tone controls + shot matching
// across two clips. Scopes on the graded output are already the panel's
// behaviour (src/components/Scopes.jsx samples the displayed slot's keyed
// canvas / transition canvas) and are pinned by scripts/test-scopes.mjs —
// this suite covers the two missing pieces.
// Usage: node scripts/test-shotmatch-skin.mjs
import assert from 'assert/strict';

const { isSkinPixel, rgbToHsl, skinPatch, skinOf, skinStats } = await import('../src/fx/skin.js');
const { frameStats, gradePixelBasic, matchGrade, statsDistance } = await import('../src/fx/shotmatch.js');

const ok = (c, m) => assert.ok(c, m);

// --- skin detection ----------------------------------------------------------
ok(isSkinPixel(0.85, 0.6, 0.45), 'a warm tan pixel is skin');
ok(isSkinPixel(0.55, 0.35, 0.25), 'a darker skin tone is skin');
ok(!isSkinPixel(0.1, 0.5, 0.9), 'blue is not skin');
ok(!isSkinPixel(0.9, 0.9, 0.9), 'near-white is not skin');
ok(!isSkinPixel(0.05, 0.05, 0.05), 'near-black is not skin');
const hsl = rgbToHsl(0.85, 0.6, 0.45);
ok(hsl.h > 8 && hsl.h < 48, `skin hue ${hsl.h.toFixed(1)} sits in the 8-48 band`);

// --- skin patch: a front-end for grade.hsl.orange ----------------------------
assert.deepEqual(skinPatch({ saturation: 20, hue: -5, lightness: 10 }),
  { hsl: { orange: { h: -5, s: 20, l: 10 } } }, 'skin patch writes the orange HSL band');
assert.deepEqual(skinPatch({ saturation: 500 }), { hsl: { orange: { h: 0, s: 100, l: 0 } } }, 'skin values clamp to +-100');
assert.deepEqual(skinOf({ hsl: { orange: { s: 20, h: -5, l: 10 } } }), { saturation: 20, hue: -5, lightness: 10 }, 'skinOf reads the band back');
assert.deepEqual(skinOf({}), { saturation: 0, hue: 0, lightness: 0 }, 'an untouched grade has no skin adjustment');

// --- skin stats: a frame that is half skin -----------------------------------
{
  const d = new Uint8Array(6 * 3);
  for (let i = 0; i < 3; i++) { d[i * 3] = 217; d[i * 3 + 1] = 153; d[i * 3 + 2] = 115; } // skin
  for (let i = 3; i < 6; i++) { d[i * 3] = 20; d[i * 3 + 1] = 100; d[i * 3 + 2] = 220; } // blue
  const s = skinStats([{ data: d }]);
  ok(Math.abs(s.share - 0.5) < 0.01, 'half the frame is skin');
  ok(Math.abs(s.mean[0] - 217 / 255) < 0.01, 'skin mean colour is the skin pixels');
  assert.equal(skinStats([{ data: new Uint8Array([20, 100, 220, 20, 100, 220]) }]), null, 'no skin pixels -> null');
}

// --- shot matching: synthetic frames ------------------------------------------
// A frame builder: RGB triplets from a per-pixel function.
const frame = (n, fn) => {
  const d = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = fn(i / n);
    d[i * 3] = Math.round(r * 255); d[i * 3 + 1] = Math.round(g * 255); d[i * 3 + 2] = Math.round(b * 255);
  }
  return { data: d };
};
// Reference: warm, bright, colourful. Source: the same scene graded cold,
// dark and desaturated (via the forward slider math, so the match must
// invert it).
const scene = (p) => {
  const base = 0.25 + 0.5 * p; // a luma ramp so p50/spread are meaningful
  return [base * 1.15, base * 0.75, base * 0.55]; // warm and colourful
};
const refFrames = [frame(2000, scene)];
const srcFrames = [frame(2000, (p) => {
  const [r, g, b] = scene(p);
  return gradePixelBasic({ temp: -40, exposure: -35, saturation: -50 }, r, g, b);
})];
const ref = frameStats(refFrames);
const src = frameStats(srcFrames);
ok(ref && src, 'stats measure both frames');
ok(statsDistance(ref, src) > 0.05, `source starts far from reference (${statsDistance(ref, src).toFixed(3)})`);
const patch = matchGrade(ref, src);
ok(patch, 'a patch is produced');
ok(patch.temp > 0, `match warms the cold source (temp ${patch.temp})`);
ok(patch.exposure > 0, `match brightens the dark source (exposure ${patch.exposure})`);
ok(patch.saturation > 0, `match re-saturates the flat source (saturation ${patch.saturation})`);
for (const v of Object.values(patch)) ok(v >= -100 && v <= 100, 'patch values stay in slider range');
// Applying the patch to the source must move it closer to the reference.
const fixed = [frame(2000, (p) => {
  const [r, g, b] = scene(p);
  const cold = gradePixelBasic({ temp: -40, exposure: -35, saturation: -50 }, r, g, b);
  return gradePixelBasic(patch, ...cold);
})];
const dBefore = statsDistance(ref, src);
const dAfter = statsDistance(ref, frameStats(fixed));
ok(dAfter < dBefore, `matched frame is closer to the reference (${dBefore.toFixed(3)} -> ${dAfter.toFixed(3)})`);
// Identical clips match to (near) zero.
const zero = matchGrade(ref, ref);
assert.deepEqual(zero, { temp: 0, tint: 0, exposure: 0, contrast: 0, saturation: 0 }, 'identical shots need no correction');
assert.equal(matchGrade(null, src), null, 'no reference -> no patch');
assert.equal(frameStats([]), null, 'no frames -> no stats');

console.log('SHOTMATCH-SKIN OK');
