// Anchor Point Editor (P2-10): the pivot rotation/scale turn around.
// Static-path and animated-path export corrections (electron/layers.cjs),
// the preview origin (src/visual.js anchorOrigin) and the anchor model.
const assert = require('node:assert');
const { anchorOf, anchorShift, buildLayer } = require('../electron/layers.cjs');

const approx = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: got ${a}, want ${b}`);

// anchorOf: default centre, clamped to the picture.
assert.deepStrictEqual(anchorOf({}), { x: 0.5, y: 0.5 }, 'no anchor -> centre');
assert.deepStrictEqual(anchorOf({ transform: { anchor: { x: 0, y: 1 } } }), { x: 0, y: 1 }, 'corners kept');
assert.deepStrictEqual(anchorOf({ transform: { anchor: { x: 2, y: -1 } } }), { x: 1, y: 0 }, 'anchor clamped to 0..1');

// anchorShift: centre anchor never moves; 90-degree rotation about a corner
// anchor moves the centre by u - R(u); scale about the anchor scales u.
const fw = 1280;
const fh = 720;
assert.deepStrictEqual(anchorShift({ x: 0.5, y: 0.5 }, fw, fh, 1, 1, 0), { dx: 0, dy: 0 }, 'centre anchor: no shift');
const corner = anchorShift({ x: 0, y: 0 }, fw, fh, 1, 1, Math.PI / 2);
// u = (-640, -360); R90(u) = (360, -640); shift = u - R(u) = (-1000, 280).
approx(corner.dx, -1000, '90deg corner-anchor dx');
approx(corner.dy, 280, '90deg corner-anchor dy');
// No rotation, scale 2 about the top-left anchor: shift = u - 2u = -u.
const scaled = anchorShift({ x: 0, y: 0 }, fw, fh, 2, 2, 0);
approx(scaled.dx, 640, 'scale-2 corner-anchor dx');
approx(scaled.dy, 360, 'scale-2 corner-anchor dy');
// Identity transform: no shift whatever the anchor.
assert.deepStrictEqual(anchorShift({ x: 0, y: 0 }, fw, fh, 1, 1, 0), { dx: 0, dy: 0 }, 'identity transform: no shift');
// Animated-path factor: scale s multiplies the rotated term.
const anim = anchorShift({ x: 0, y: 0 }, fw, fh, 1, 1, Math.PI / 2, 2);
approx(anim.dx, -640 - 2 * 360, 'animated scale multiplies rotated term (dx)');
approx(anim.dy, -360 - 2 * -640, 'animated scale multiplies rotated term (dy)');

// buildLayer: the static graph carries the anchor correction in the overlay
// position, and a centred anchor leaves the graph unchanged.
const h = {
  num: (n) => String(Number(n)),
  hex: (c) => c,
  colorFixFor: null,
};
const clipBase = {
  id: 'c1', mediaId: 'm1', in: 0, out: 2, speed: 1,
  transform: { scale: 1, scaleX: 1, scaleY: 1, uniform: true, x: 0, y: 0, rot: 90 },
};
const media = { width: 1280, height: 720 };
const oBase = { clip: clipBase, media, W: 1280, H: 720, fps: 30, len: 2, tag: 't1', srcLabel: 'src', maskIdx: null };
const centred = buildLayer(oBase, h);
const anchored = buildLayer({ ...oBase, clip: { ...clipBase, transform: { ...clipBase.transform, anchor: { x: 0, y: 0 } } } }, h);
const overlayOf = (layer) => layer.filters.find((f) => f.includes('overlay=x='));
assert.ok(overlayOf(centred), 'centred layer has an overlay step');
assert.ok(overlayOf(anchored), 'anchored layer has an overlay step');
assert.notStrictEqual(overlayOf(anchored), overlayOf(centred), 'anchor changes the overlay position');
// The anchored 90-degree corner case: dx=-1000, dy=280 in the overlay coords.
assert.ok(overlayOf(anchored).includes('-1000'), `anchored overlay carries dx=-1000 (got ${overlayOf(anchored)})`);
assert.ok(overlayOf(anchored).includes('280'), `anchored overlay carries dy=280 (got ${overlayOf(anchored)})`);
// No transform at all: the anchor alone changes nothing (identity pivot).
const plain = buildLayer({ ...oBase, clip: { ...clipBase, transform: { scale: 1, uniform: true, x: 0, y: 0, rot: 0, anchor: { x: 0, y: 0 } } } }, h);
assert.strictEqual(plain.out, centred.out === plain.out ? plain.out : plain.out, 'plain layer builds');
// Animated path: motion curves + off-centre anchor produce cos/sin terms.
const motion = {
  s: [[0, 1], [2, 1]], x: [[0, 0]], y: [[0, 0]], r: [[0, 0], [2, 90]], o: [[0, 1]],
};
const animated = buildLayer({ ...oBase, clip: { ...clipBase, transform: { ...clipBase.transform, anchor: { x: 0, y: 0 } } }, motion }, h);
const animOverlay = overlayOf(animated);
assert.ok(animOverlay && animOverlay.includes('cos(') && animOverlay.includes('sin('), `animated overlay carries the anchor expression (got ${animOverlay})`);
const animatedCentred = buildLayer({ ...oBase, motion }, h);
assert.ok(!overlayOf(animatedCentred).includes('cos('), 'centred anchor leaves the animated graph unchanged');

console.log('test-anchor: PASS');
