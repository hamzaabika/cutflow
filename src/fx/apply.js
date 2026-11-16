// Which animated effects act at a moment, shared by the player and the export.
// Effects come from two places:
//   - on a clip (clip.effects): they last the whole clip — or the instance's timing window
//     (clip.fxTiming) when it carries one; their time T starts with the clip / the window;
//   - on the Effects track (project.effectClips: { id, fx, start, duration }): free objects you move and trim;
//     they act on every picture under them, their time T starts with the effect.
// The Effects panel offers the same tiles for both places, including the six classic effects of
// src/effects.js (blur, grain, vignette, pixel, mirror, flipv). Since the Sprint 6 unification
// the classics have exactly ONE engine: their shader forms (fx/params.js), reached from
// pixelPasses for clip instances (timed, regioned, strength-adjusted or plain alike) and for
// Effects-track objects. Before the unification a plain clip instance ran through CSS in the
// preview and FFmpeg look filters in the export — two approximations that disagreed with each
// other and with the shader form, and the preview's CSS silently vanished whenever the canvas
// path drew the clip. The look paths (clipCss, lookFilters) no longer paint classics at all.
// (Before this map existed, a classic effect on the Effects track rendered NOTHING anywhere:
// freeOn collected the clip, then both pass builders discarded it as neither pixel nor overlay.)
import { OVERLAY_EFFECTS, PIXEL_EFFECTS } from './catalog.js';
import { freeLen, fxTimingOf, videoLayout } from '../store.js';
import { gradeExpr, hasGrade } from './grade.js';
import { adjustExpr, hasAdjust } from './adjust.js';
import { getLut, lutOn } from './lut.js';
import { filterExpr, hasFilter, lutFilterRef } from './filters.js';
import { resolveFxExpr, CLASSIC_IDS } from './params.js';

const PIXEL = Object.fromEntries(PIXEL_EFFECTS.map((e) => [e.id, e.expr]));
const OVERLAY = Object.fromEntries(OVERLAY_EFFECTS.map((e) => [e.id, e.draw]));
export const isPixel = (id) => !!PIXEL[id];
export const isOverlay = (id) => !!OVERLAY[id];

// The classic effects, as shader passes — since Sprint 6 these expressions are the ONLY
// definition of the six classics (their strengths were originally chosen to mirror the old
// per-clip export filters: boxblur, noise alls=18, iw/24 mosaic, vignette). The strings
// themselves now live in fx/params.js (§5 schema registry): four of the six carry typed
// parameters whose default-value expressions are those same strings, byte for byte.
const CLASSIC_SET = new Set(CLASSIC_IDS);
export const isClassic = (id) => CLASSIC_SET.has(id);
// Effects that end up baked into a clip's frames by the export's effects pass.
export const isShaderFx = (id) => isPixel(id) || isClassic(id);

// ---- Effect regions ----
// An effect instance may carry a region: { x, y, w, h, feather, shape, invert } in normalized
// frame coordinates (x/y = top-left, w/h = size, feather = soft edge as a fraction of the frame
// height, shape 'rect' | 'ellipse'). The region is applied as mix(original, effected, mask):
// the effect's own expression runs unchanged and its result is blended with the untouched
// picture by the mask, so it works for EVERY shader effect in the catalog (and the classic
// effects' shader forms) — never inside the individual effects themselves.
// The mask is stored in register 9 (the compilers provide r0..r9; effects use at most 0..8).
const fnum = (n) => {
  const v = Math.round((Number(n) || 0) * 10000) / 10000;
  return Object.is(v, -0) ? '0' : String(v);
};
export function regionMaskExpr(region) {
  const x = fnum(region.x), y = fnum(region.y), w = fnum(Math.max(0.01, region.w)), h = fnum(Math.max(0.01, region.h));
  const fPx = `max(${fnum(Math.max(0, region.feather || 0))}*H, 1)`;
  let dOut;
  if (region.shape === 'ellipse') {
    // q = elliptical distance (1 on the edge); dOut approximates the pixel distance outside it.
    dOut = `(hypot((X - W*${fnum((Number(region.x) || 0) + (Number(region.w) || 0) / 2)})/max(W*${fnum((Number(region.w) || 0) / 2)}, 1), (Y - H*${fnum((Number(region.y) || 0) + (Number(region.h) || 0) / 2)})/max(H*${fnum((Number(region.h) || 0) / 2)}, 1)) - 1) * min(max(W*${fnum((Number(region.w) || 0) / 2)}, 1), max(H*${fnum((Number(region.h) || 0) / 2)}, 1))`;
  } else {
    dOut = `max(max(W*${x} - X, X - W*${fnum((Number(region.x) || 0) + (Number(region.w) || 0))}), max(H*${y} - Y, Y - H*${fnum((Number(region.y) || 0) + (Number(region.h) || 0))}))`;
  }
  const m = `clip(0.5 - (${dOut})/(${fPx}), 0, 1)`;
  return region.invert ? `(1 - ${m})` : m;
}
// Wrap an effect expression so it only lands inside the region (identity when region is null).
export function regionWrap(expr, region) {
  if (!region) return expr;
  const i = expr.lastIndexOf(';');
  const head = i >= 0 ? expr.slice(0, i + 1) : '';
  const tail = i >= 0 ? expr.slice(i + 1) : expr;
  return `${head} st(9, ${regionMaskExpr(region)}); S(X, Y)*(1 - ld(9)) + (${tail})*ld(9)`;
}

// ---- Effect strength ----
// Every effect instance carries an optional strength (0..1, absent = 1 = the effect as
// authored). For shader effects the strength is a mix with the untouched picture — the same
// mechanism as a region, with the mask scaled by the strength — so it works uniformly for
// the whole catalog (whose expressions take no parameters) in the preview and the export
// alike (both run pixelPasses). A strength of 0 removes the pass entirely.
export function fxWrap(expr, region, k) {
  const s = k == null ? 1 : k;
  if (s >= 1) return regionWrap(expr, region);
  const i = expr.lastIndexOf(';');
  const head = i >= 0 ? expr.slice(0, i + 1) : '';
  const tail = i >= 0 ? expr.slice(i + 1) : expr;
  if (!region) return `${head} S(X, Y)*(1 - ${fnum(s)}) + (${tail})*${fnum(s)}`;
  return `${head} st(9, (${regionMaskExpr(region)}) * ${fnum(s)}); S(X, Y)*(1 - ld(9)) + (${tail})*ld(9)`;
}

// Every classic effect instance — on a clip or on the Effects track, plain or carrying a
// region / timing window / strength — renders through its shader form (fx/params.js +
// fxWrap in pixelPasses below). There is no second path any more.

const freeOn = (project, t) => (project.effectClips || []).filter((e) => !e.disabled && t >= e.start && t < e.start + e.duration);

// Shader passes for a picture clip that starts at clipStart on the timeline, lt seconds into it: [{ expr, T }].
// The clip's color grade (Adjust) comes first, then its effects, then the free effects over it.
export function pixelPasses(project, clip, clipStart, lt) {
  const list = [];
  // The legacy Adjust settings (clip.adjust) come first — the position they held in the
  // export's base graph before the unification, with the filter/grade passes on top.
  const adj = hasAdjust(clip) ? adjustExpr(clip.adjust) : null;
  if (adj) list.push({ expr: adj, T: lt });
  // The filter first, then the LUT, then the Adjust settings on top of them.
  // A filter is one look: one of ours (an expression) or a LUT ("lut:<file>"), at the filter intensity.
  if (lutFilterRef(clip)) {
    const l = getLut(lutFilterRef(clip));
    if (l) list.push({ lut: l, K: (clip.filterIntensity ?? 100) / 100 });
  } else {
    const look = hasFilter(clip) ? filterExpr(clip) : null;
    if (look) list.push({ expr: look, T: lt });
  }
  const lut = lutOn(clip.grade?.lut) ? getLut(clip.grade.lut.ref) : null;
  if (lut) list.push({ lut, K: (clip.grade.lut.intensity ?? 100) / 100 });
  const grade = hasGrade(clip) ? gradeExpr(clip.grade) : null;
  if (grade) list.push({ expr: grade, T: lt });
  for (const id of clip.effects || []) {
    const k = clip.fxStrength?.[id];
    if (k === 0) continue;
    // A timed instance acts only inside its window, and its T starts with the window —
    // an untimed one starts with the clip, as before.
    const w = fxTimingOf(clip, id);
    if (w && (lt < w.start || lt >= w.start + w.duration)) continue;
    const T = lt - (w ? w.start : 0);
    if (isPixel(id) || isClassic(id)) list.push({ expr: fxWrap(resolveFxExpr(id, clip.fxParams?.[id]), clip.fxRegions?.[id], k), T });
  }
  const t = clipStart + lt;
  for (const e of freeOn(project, t)) {
    const k = e.strength;
    if (k === 0) continue;
    if (isPixel(e.fx) || isClassic(e.fx)) list.push({ expr: fxWrap(resolveFxExpr(e.fx, e.params), e.region, k), T: t - e.start });
  }
  return list;
}

// True when some pixel effect touches the clip's time range (it then needs the effects pass at export).
export function clipHasPixelFx(project, clip, clipStart, len) {
  if (hasAdjust(clip) || hasFilter(clip) || hasGrade(clip) || lutOn(clip.grade?.lut) || (clip.effects || []).some((id) => isPixel(id) || isClassic(id))) return true;
  return (project.effectClips || []).some((e) => !e.disabled && isShaderFx(e.fx) && e.start < clipStart + len && e.start + e.duration > clipStart);
}

// Particle / light layers are drawn, not shaded, so a region cannot mix them — instead the
// layer is drawn on a scratch canvas and masked with the region shape (the feather blurs the
// mask edge), then composited. Without a region the draw goes straight to the frame as before.
let scratch = null;
function drawRegioned(ctx, W, H, region, draw) {
  if (!region) { draw(ctx); return; }
  try {
    if (!scratch || scratch.width !== W || scratch.height !== H) scratch = new OffscreenCanvas(W, H);
    const sctx = scratch.getContext('2d');
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.filter = 'none';
    sctx.clearRect(0, 0, W, H);
    draw(sctx);
    // Build the region mask on its own canvas (white = keep), its edge blurred by the feather.
    const maskCv = drawRegioned.mask || (drawRegioned.mask = new OffscreenCanvas(W, H));
    if (maskCv.width !== W || maskCv.height !== H) { maskCv.width = W; maskCv.height = H; }
    const mctx = maskCv.getContext('2d');
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.filter = 'none';
    mctx.clearRect(0, 0, W, H);
    const featherPx = Math.max(0, region.feather || 0) * H;
    if (featherPx > 0.5) mctx.filter = `blur(${featherPx.toFixed(1)}px)`;
    mctx.fillStyle = '#ffffff';
    mctx.beginPath();
    if (region.shape === 'ellipse') mctx.ellipse(W * (region.x + region.w / 2), H * (region.y + region.h / 2), (W * region.w) / 2, (H * region.h) / 2, 0, 0, Math.PI * 2);
    else mctx.rect(W * region.x, H * region.y, W * region.w, H * region.h);
    mctx.fill();
    mctx.filter = 'none';
    if (region.invert) {
      // Invert the mask: start from full white and punch the region out of it.
      const inv = drawRegioned.inv || (drawRegioned.inv = new OffscreenCanvas(W, H));
      if (inv.width !== W || inv.height !== H) { inv.width = W; inv.height = H; }
      const ictx = inv.getContext('2d');
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.globalCompositeOperation = 'source-over';
      ictx.clearRect(0, 0, W, H);
      ictx.fillStyle = '#ffffff';
      ictx.fillRect(0, 0, W, H);
      ictx.globalCompositeOperation = 'destination-out';
      ictx.drawImage(maskCv, 0, 0);
      mctx.clearRect(0, 0, W, H);
      mctx.globalCompositeOperation = 'source-over';
      mctx.drawImage(inv, 0, 0);
    }
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(maskCv, 0, 0);
    sctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(scratch, 0, 0);
  } catch {
    draw(ctx); // no scratch canvas available: fall back to the unmasked draw
  }
}

// Particle / light layers drawn over the frame at time t (project pixels W x H).
// An instance's strength is the layer's opacity while it is drawn (the scratch-canvas
// region path composites through the same context, so the alpha lands there too).
function drawStrength(ctx, k, draw) {
  if (k == null || k >= 1 || k === 0) { if (k !== 0) draw(ctx); return; }
  ctx.save();
  ctx.globalAlpha = k;
  try { draw(ctx); } finally { ctx.restore(); }
}
export function drawOverlayPasses(ctx, project, t, W, H) {
  for (const l of videoLayout(project.videoClips)) {
    if (l.clip.gap || t < l.start || t >= l.end) continue;
    for (const id of l.clip.effects || []) {
      if (!OVERLAY[id]) continue;
      // A timed instance is drawn only inside its window, its T starting with the window.
      const w = fxTimingOf(l.clip, id);
      const ws = l.start + (w ? w.start : 0);
      if (w && (t < ws || t >= ws + w.duration)) continue;
      drawStrength(ctx, l.clip.fxStrength?.[id], (c1) => drawRegioned(c1, W, H, l.clip.fxRegions?.[id], (c2) => OVERLAY[id](c2, W, H, t - ws)));
    }
  }
  for (const c of project.overlayClips || []) {
    if (t < c.start || t >= c.start + freeLen('overlay', c)) continue;
    for (const id of c.effects || []) {
      if (!OVERLAY[id]) continue;
      const w = fxTimingOf(c, id);
      const ws = c.start + (w ? w.start : 0);
      if (w && (t < ws || t >= ws + w.duration)) continue;
      drawStrength(ctx, c.fxStrength?.[id], (c1) => drawRegioned(c1, W, H, c.fxRegions?.[id], (c2) => OVERLAY[id](c2, W, H, t - ws)));
    }
  }
  for (const e of freeOn(project, t)) if (OVERLAY[e.fx]) drawStrength(ctx, e.strength, (c1) => drawRegioned(c1, W, H, e.region, (c2) => OVERLAY[e.fx](c2, W, H, t - e.start)));
}

// Time ranges with a particle / light layer, so the export knows which frames to draw.
// One range per effect instance: a timed instance covers only its window.
export function overlayRanges(project) {
  const win = (c, id, start, span) => {
    const w = fxTimingOf(c, id);
    return w ? [start + w.start, start + w.start + w.duration] : [start, start + span];
  };
  return [
    ...videoLayout(project.videoClips).flatMap((l) => (l.clip.gap ? [] : (l.clip.effects || []).filter(isOverlay).map((id) => win(l.clip, id, l.start, l.end - l.start)))),
    ...(project.overlayClips || []).flatMap((c) => (c.effects || []).filter(isOverlay).map((id) => win(c, id, c.start, freeLen('overlay', c)))),
    ...(project.effectClips || []).filter((e) => !e.disabled && isOverlay(e.fx)).map((e) => [e.start, e.start + e.duration]),
  ];
}
