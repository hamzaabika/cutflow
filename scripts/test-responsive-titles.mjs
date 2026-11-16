// Responsive Titles & Graphics (P2-13): a title reflows across 16:9 /
// 9:16 / 1:1 with safe zones respected, and positions are stored per aspect.
// The pure math lives in src/text/responsive.js (the renderer in
// src/text/render.js applies it after measuring the title box).
import assert from 'node:assert';
import fs from 'node:fs';
import { aspectKey, aspectPositionOf, responsiveTitle, SAFE_ZONES } from '../src/text/responsive.js';

assert.strictEqual(aspectKey(1280, 720), '16:9', '1280x720 is 16:9');
assert.strictEqual(aspectKey(720, 1280), '9:16', '720x1280 is 9:16');
assert.strictEqual(aspectKey(1080, 1080), '1:1', '1080x1080 is 1:1');
assert.strictEqual(aspectKey(800, 600), 'other', '800x600 is other');

// A title parked on the bottom edge is pulled into the safe zone.
const box = { w: 400, h: 60 };
const low169 = responsiveTitle(0.5, 0.98, 1280, 720, box);
assert.ok(low169.cy + box.h / 2 <= (1 - SAFE_ZONES['16:9'].b) * 720 + 1e-9, `16:9 bottom clamped (cy=${low169.cy})`);
assert.ok(low169.cy < 0.98 * 720, '16:9 title moved up');
const low916 = responsiveTitle(0.5, 0.98, 720, 1280, box);
assert.ok(low916.cy + box.h / 2 <= (1 - SAFE_ZONES['9:16'].b) * 1280 + 1e-9, `9:16 bottom clamped harder (cy=${low916.cy})`);
// A title on the left edge is pulled in, too.
const left = responsiveTitle(0.02, 0.5, 1280, 720, box);
assert.ok(left.cx - box.w / 2 >= SAFE_ZONES['16:9'].l * 1280 - 1e-9, 'left edge clamped');
// A box wider than the safe width shrinks to fit (never below the floor).
const wide = responsiveTitle(0.5, 0.5, 1280, 720, { w: 1400, h: 60 });
assert.ok(Math.abs(wide.scale - (0.9 * 1280) / 1400) < 1e-9, `wide box shrinks (scale=${wide.scale})`);
assert.ok(wide.cx - 1400 * wide.scale / 2 >= SAFE_ZONES['16:9'].l * 1280 - 1e-9, 'shrunk box sits inside the zone');
const huge = responsiveTitle(0.5, 0.5, 1280, 720, { w: 10000, h: 60 });
assert.strictEqual(huge.scale, 0.3, 'shrink floor is 0.3');

// Per-aspect positions: the override wins for its aspect, the base elsewhere.
const responsive = { '9:16': { x: 0.5, y: 0.7 } };
assert.deepStrictEqual(aspectPositionOf({ x: 0.5, y: 0.85 }, responsive, 720, 1280), { x: 0.5, y: 0.7 }, '9:16 override wins');
assert.deepStrictEqual(aspectPositionOf({ x: 0.5, y: 0.85 }, responsive, 1280, 720), { x: 0.5, y: 0.85 }, '16:9 falls back to base');
assert.deepStrictEqual(aspectPositionOf({ x: 0.3, y: 0.4 }, undefined, 720, 1280), { x: 0.3, y: 0.4 }, 'no overrides -> base');

// The renderer wires the same math: render.js re-exports the pure helpers
// and applies them in responsiveMeasure / drawTextClip / textBox.
const renderSrc = fs.readFileSync(new URL('../src/text/render.js', import.meta.url), 'utf8');
assert.ok(renderSrc.includes('responsiveMeasure(ctx, clip, st, shownText, W, H, pinOff)'), 'drawTextClip measures responsively');
assert.ok(renderSrc.includes('aspectPosition(clip, W, H)') && renderSrc.includes('responsiveTitle('), 'duo block clamps into the safe zone');
assert.ok(renderSrc.includes('responsiveMeasure(measureCtx'), 'textBox measures responsively');

console.log('test-responsive-titles: PASS');
