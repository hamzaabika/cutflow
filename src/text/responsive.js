// Responsive titles & graphics (P2-13): pure aspect / safe-zone math, with
// no canvas or font imports so node tests can use it directly. The renderer
// (src/text/render.js) measures the title box and applies these numbers.
export function aspectKey(W, H) {
  if (!W || !H) return 'other';
  const r = W / H;
  if (r >= 1.7) return '16:9';
  if (r <= 0.6) return '9:16';
  if (r >= 0.9 && r <= 1.1) return '1:1';
  return 'other';
}
// Safe zones (fractions of the frame the title must stay inside): title-safe
// margins, with extra headroom on vertical video (notch on top, UI at the
// bottom) where captions and buttons cover the edges.
export const SAFE_ZONES = {
  '16:9': { l: 0.05, r: 0.05, t: 0.08, b: 0.08 },
  '9:16': { l: 0.06, r: 0.06, t: 0.10, b: 0.14 },
  '1:1': { l: 0.06, r: 0.06, t: 0.06, b: 0.06 },
  other: { l: 0.05, r: 0.05, t: 0.05, b: 0.05 },
};
// The title's position for this aspect: a per-aspect override
// (clip.responsive = { '9:16': { x, y }, ... }) wins; otherwise the base
// x/y from the resolved style.
export function aspectPositionOf(style, responsive, W, H) {
  const over = responsive?.[aspectKey(W, H)];
  return over ? { x: over.x ?? style.x, y: over.y ?? style.y } : { x: style.x, y: style.y };
}
// Action-safe is the looser broadcast zone: half the title-safe margins
// (floored at 2%), so the two rectangles stay proportional per aspect and
// the action rectangle always contains the title rectangle.
export function actionSafeZone(W, H) {
  const zone = SAFE_ZONES[aspectKey(W, H)] || SAFE_ZONES.other;
  const half = (v) => Math.max(0.02, v * 0.5);
  return { l: half(zone.l), r: half(zone.r), t: half(zone.t), b: half(zone.b) };
}
// Pixel rect of a safe zone inside a W x H frame: { x, y, w, h }.
export function safeZoneRect(zone, W, H) {
  return { x: zone.l * W, y: zone.t * H, w: (1 - zone.l - zone.r) * W, h: (1 - zone.t - zone.b) * H };
}
// Fit a title box into the aspect's safe zone: returns the centre in project
// pixels and a size scale (1 = unchanged, smaller = shrunk to fit).
export function responsiveTitle(x, y, W, H, box) {
  const zone = SAFE_ZONES[aspectKey(W, H)] || SAFE_ZONES.other;
  if (!box || box.w <= 0 || box.h <= 0) return { cx: x * W, cy: y * H, scale: 1 };
  const safeW = Math.max(1, (1 - zone.l - zone.r) * W);
  const safeH = Math.max(1, (1 - zone.t - zone.b) * H);
  let scale = 1;
  if (box.w > safeW) scale = Math.min(scale, safeW / box.w);
  if (box.h > safeH) scale = Math.min(scale, safeH / box.h);
  scale = Math.max(0.3, scale);
  const w = box.w * scale;
  const h = box.h * scale;
  const cx = Math.min(Math.max(x * W, zone.l * W + w / 2), (1 - zone.r) * W - w / 2);
  const cy = Math.min(Math.max(y * H, zone.t * H + h / 2), (1 - zone.b) * H - h / 2);
  return { cx, cy, scale };
}
