// P1-51 (FB-32): preview safe zones — the math. The toggles themselves are
// UI state (verified live in test-safe-zones-live.mjs); here the shared
// SAFE_ZONES math is pinned: title-safe rects sit inside the frame, the
// action-safe rect contains the title-safe rect, and 9:16 gets the extra
// headroom the responsive-titles work already encodes.
// Usage: node scripts/test-safe-zones.mjs
import assert from 'node:assert/strict';
import { SAFE_ZONES, actionSafeZone, aspectKey, safeZoneRect } from '../src/text/responsive.js';

const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: |${a} - ${b}| > ${tol}`);
const inside = (r, W, H, msg) => {
  assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W + 1e-9 && r.y + r.h <= H + 1e-9, msg);
  assert.ok(r.w > 0 && r.h > 0, `${msg} (non-empty)`);
};
const contains = (outer, inner, msg) => {
  assert.ok(outer.x <= inner.x + 1e-9 && outer.y <= inner.y + 1e-9
    && outer.x + outer.w >= inner.x + inner.w - 1e-9 && outer.y + outer.h >= inner.y + inner.h - 1e-9, msg);
};

for (const [W, H] of [[1920, 1080], [1080, 1920], [1080, 1080], [800, 600]]) {
  const key = aspectKey(W, H);
  const title = safeZoneRect(SAFE_ZONES[key] || SAFE_ZONES.other, W, H);
  const action = safeZoneRect(actionSafeZone(W, H), W, H);
  inside(title, W, H, `${key} title-safe inside the frame`);
  inside(action, W, H, `${key} action-safe inside the frame`);
  contains(action, title, `${key} action-safe contains title-safe`);
}
// 9:16 title-safe: 6% sides, 10% top, 14% bottom (notch + UI headroom).
const v = safeZoneRect(SAFE_ZONES['9:16'], 1080, 1920);
approx(v.x, 64.8, 1e-9, '9:16 title-safe left');
approx(v.y, 192, 1e-9, '9:16 title-safe top');
approx(v.w, 950.4, 1e-9, '9:16 title-safe width');
approx(v.h, 1459.2, 1e-9, '9:16 title-safe height');
// 16:9 title-safe: 5% sides, 8% top/bottom.
const w = safeZoneRect(SAFE_ZONES['16:9'], 1920, 1080);
approx(w.x, 96, 1e-9, '16:9 title-safe left');
approx(w.y, 86.4, 1e-9, '16:9 title-safe top');
// Action-safe is the looser zone: half the title margins, floored at 2%.
const a = actionSafeZone(1080, 1920);
approx(a.l, 0.03, 1e-9, '9:16 action-safe left is half the title margin');
approx(a.b, 0.07, 1e-9, '9:16 action-safe bottom is half the title margin');
const a16 = actionSafeZone(1920, 1080);
approx(a16.l, 0.025, 1e-9, '16:9 action-safe left is half the title margin');

console.log('ALL PASS');
