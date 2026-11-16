// Canvas text renderer shared by the preview and the export, so both look identical.
// Coordinates are project pixels (e.g. 1280x720); callers scale the context for the preview.
import { cssFont } from '../fonts.js';
import { gravityBounceValue, springPhysicsValue } from '../fx/easing.js';
import { INHERENT_UNIT_ANIMS, effectiveUnit, isAnimUnit, unitProgress } from './units.js';
import { pinOffsetAt } from '../track.js';
import {
  DEFAULT_DUO, resolveDuo, duoTiming, graphemes, wordsOf, isRtl, splitDuoText,
  wordGraphemeStarts, seededFloat, easeDuo, dropBounceDy, lerp, lerpColor, rgbaArr,
} from './duo.js';
import { flickerEnvelope, wordFlickerAlpha } from './flicker.js';
import {
  resolveGraphic, countValue, formatNumber, formatTimer, parseEndNumber,
  parseTimerSeconds, ringFraction, splitGraphicText, timerRemaining,
} from './graphic.js';
import { RTL_RE as RTL, bidiVisualOrder, splitTrailingPunct } from './bidi.js';

export const TEXT_DEFAULTS = {
  text: '',
  font: 'montserrat',
  size: 64,
  bold: true,
  italic: false,
  underline: false,
  uppercase: false,
  color: '#ffffff',
  color2: '#ff4fd8',
  glowColor: '#ff2bd6',
  letterSpacing: 0,
  lineHeight: 1.15,
  align: 'center',
  maxWidth: 0.86,
  x: 0.5,
  y: 0.85,
  rotation: 0, // degrees
  opacity: 1,
  stroke: { width: 6, color: '#000000' },
  shadow: { on: true, color: '#000000', blur: 10, x: 0, y: 4, opacity: 0.7 },
  bg: { on: false, color: '#000000', opacity: 0.6, radius: 14, padding: 0.3, mode: 'block' },
  effect: 'none',
  bubble: 'none',
  bubbleColor: '#ffffff',
  // 3D extrusion (P3-05, scoped): text layers only — no 3D layers, no camera
  // orbit. depth = how far the sides extend (px steps), bevel = how many of
  // the layers nearest the face carry the light rim, light = the direction
  // the light comes FROM in degrees (screen coords, y down; 225 = top-left,
  // so the sides extend down-right), tiltX/tiltY = a small lean of the whole
  // clip (cosine squash, deterministic — preview and export agree).
  extrude: { on: false, depth: 12, bevel: 3, light: 225, tiltX: 0, tiltY: 0 },
  highlight: { mode: 'none', color: '#ffd400', bg: '#7c3aed' },
  animIn: { id: 'fade', dur: 0.3, unit: 'whole' },
  animOut: { id: 'fade', dur: 0.25, unit: 'whole' },
  animLoop: { id: 'none', speed: 1 },
  // Neon Pop Duo: a two-line caption with per-line styles and sequencing (see
  // src/text/duo.js). null for every other template; when set, drawTextClip
  // hands the whole clip to drawDuoClip and the animIn/animOut above stay 'none'.
  duo: null,
  // Animated graphics (CC-06, see src/text/graphic.js): a `graphic` spec
  // ({ kind, ... }) hands the clip to drawGraphicClip, the duo pattern for
  // titles / lower thirds / counters / rings / timers. null otherwise.
  graphic: null,
};

const NESTED = ['stroke', 'shadow', 'bg', 'highlight', 'animIn', 'animOut', 'animLoop', 'extrude'];
const LEGACY_ANIM = { fade: 'fade', pop: 'pop', slideup: 'slideUp', none: 'none' };
// Substitute glyphs for the Decode animation (no easily confused pairs: no I/L/O, no 0/1).
const DECODE_GLYPHS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789#$%&@?!';

// Merges a clip with the defaults and upgrades text clips saved by older versions.
export function resolveStyle(clip) {
  const s = { ...TEXT_DEFAULTS, ...clip };
  if (clip.stroke === undefined && clip.outline !== undefined) {
    s.stroke = { width: clip.outline ? Math.max(2, Math.round((clip.size || 48) / 20)) : 0, color: '#000000' };
  }
  if (clip.bg === undefined && clip.box) {
    s.bg = { on: true, color: clip.boxColor || '#000000', opacity: 0.7, radius: 6, padding: 0.25, mode: 'block' };
  }
  if (clip.animIn === undefined && clip.anim !== undefined) {
    const id = LEGACY_ANIM[clip.anim] || 'none';
    s.animIn = { id, dur: 0.4 };
    s.animOut = { id: id === 'none' ? 'none' : 'fade', dur: 0.4 };
  }
  if (clip.font === 'arialbd') {
    s.font = 'arial';
    s.bold = true;
  }
  NESTED.forEach((k) => {
    s[k] = { ...TEXT_DEFAULTS[k], ...(s[k] || {}) };
  });
  // The duo spec merges one level deeper than the flat patches (line1/line2
  // sub-objects keep their defaults when a variant overrides one value).
  if (s.duo) s.duo = resolveDuo(s.duo);
  // Same for the graphic spec (CC-06): kind + per-kind values, defaults kept
  // for whatever the template does not override.
  if (s.graphic) s.graphic = resolveGraphic(s.graphic);
  // Unknown or missing animation units fall back to animating the whole text at once.
  if (!isAnimUnit(s.animIn.unit)) s.animIn.unit = 'whole';
  if (!isAnimUnit(s.animOut.unit)) s.animOut.unit = 'whole';
  return s;
}

// Reduce Motion / Flashing (P2-39): the flag lives in ./reducedMotion.js
// (import-free, so the accessibility settings can set it without the font
// chain); flicker and glitch motion degrade to plain fades while it is on —
// in preview AND export, which share this renderer.
import { setTextReducedMotion, textReducedMotion } from './reducedMotion.js';
export { setTextReducedMotion };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const easeBounce = (t) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};
// Slow at both ends: the "smooth" slide feel (long glide, gentle landing).
const easeInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
// Overshoots and settles with decaying ripples, like a spring.
const easeOutElastic = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);

export function rgba(hex, a = 1) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// 3D extrusion helpers (P3-05): a hex colour scaled by a light factor
// (0.45 = deep shade, 1.18 = lit bevel rim), and the direction the extruded
// sides extend — away from the light, one unit step per depth layer.
export function shadeHex(hex, f) {
  const n = parseInt(String(hex || '#000000').replace('#', ''), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
export function extrudeVector(st) {
  const a = (((st.extrude && st.extrude.light) ?? 225) * Math.PI) / 180;
  return { x: -Math.cos(a), y: -Math.sin(a) };
}
export function extrudeDepth(st) {
  if (!st.extrude || !st.extrude.on) return 0;
  const d = Math.round(st.extrude.depth || 0);
  return d <= 0 ? 0 : Math.min(40, d);
}

// ---------- Layout ----------

export function layout(ctx, st, text, W) {
  ctx.font = cssFont(st.font, st.size, st.bold, st.italic);
  const rtlText = RTL.test(text);
  // RTL text never takes letter-spacing (see src/text/bidi.js); the
  // canvas direction matches the paragraph so mixed-content words measure
  // and paint in the right order.
  ctx.letterSpacing = rtlText ? '0px' : `${st.letterSpacing || 0}px`;
  ctx.direction = rtlText ? 'rtl' : 'ltr';
  const space = ctx.measureText(' ').width;
  const maxW = Math.max(st.size * 2, st.maxWidth * W);
  const lines = [];
  let idx = 0;
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let cur = [];
    let w = 0;
    for (const word of words) {
      const ww = ctx.measureText(word).width;
      // A single Latin word wider than the line (a long URL / product name)
      // is broken into grapheme chunks that fit, instead of overflowing the
      // safe zone. Arabic words are never broken mid-word — that would
      // destroy their joining — the shrink-to-fit in responsiveMeasure (and
      // the duo's minScale shrink) handles those. Chunks share the word's
      // logical index, so caption word timings and highlight counts are
      // unchanged by the break.
      if (ww > maxW && !RTL.test(word)) {
        const chunks = [];
        let chunk = '';
        for (const g of graphemes(word)) {
          if (chunk && ctx.measureText(chunk + g).width > maxW) { chunks.push(chunk); chunk = ''; }
          chunk += g;
        }
        if (chunk) chunks.push(chunk);
        for (const chunkText of chunks) {
          const cw = ctx.measureText(chunkText).width;
          if (cur.length && w + space + cw > maxW) {
            lines.push({ words: cur, width: w });
            cur = [];
            w = 0;
          }
          w += cur.length ? space + cw : cw;
          cur.push({ text: chunkText, w: cw, i: idx });
        }
        idx++;
        continue;
      }
      if (cur.length && w + space + ww > maxW) {
        lines.push({ words: cur, width: w });
        cur = [];
        w = 0;
      }
      w += cur.length ? space + ww : ww;
      cur.push({ text: word, w: ww, i: idx++ });
    }
    lines.push({ words: cur, width: w });
  }
  const lineH = st.size * st.lineHeight;
  const height = lines.length * lineH;
  const rtl = RTL.test(text);
  // B-UX9: trailing punctuation glued to the last word of an RTL paragraph
  // belongs to the paragraph end, not to that word — "مرحبا Cutflow 2026!"
  // must end with the ! at the far left, the way the browser's own bidi
  // lays it out, not glued to the 2026 mid-line. Split it off the last
  // word of the last line so bidiVisualOrder gives it its own
  // paragraph-direction run; the split is RTL-only (in an LTR paragraph
  // the punctuation already lands at the line end). The punctuation
  // shares its word's index, so caption timings and highlights treat it
  // as part of that word.
  if (rtl && lines.length) {
    const lastLine = lines[lines.length - 1];
    const wd = lastLine.words[lastLine.words.length - 1];
    const split = wd && splitTrailingPunct(wd.text);
    if (split) {
      wd.text = split.core;
      wd.w = ctx.measureText(split.core).width;
      lastLine.words.push({ text: split.punct, w: ctx.measureText(split.punct).width, i: wd.i });
      lastLine.width = lastLine.words.reduce((s, w) => s + w.w, 0) + space * (lastLine.words.length - 1);
    }
  }
  const width = Math.max(0, ...lines.map((l) => l.width));
  lines.forEach((l, li) => {
    l.y = -height / 2 + lineH * (li + 0.5);
    const x0 = st.align === 'left' ? -width / 2 : st.align === 'right' ? width / 2 - l.width : -l.width / 2;
    l.x = x0;
    let x = x0;
    bidiVisualOrder(l.words, rtl).forEach((wd) => {
      wd.x = x;
      x += wd.w + space;
    });
  });
  return { lines, width, height, lineH, count: idx, rtl };
}

// Word timings relative to the clip: auto-caption timings when they match, otherwise an even split.
function wordTimes(st, n) {
  if (st.words && st.words.length === n) return st.words;
  const d = st.duration / Math.max(1, n);
  return Array.from({ length: n }, (_, i) => ({ start: i * d, end: (i + 1) * d }));
}

function activeIndex(times, lt) {
  let a = -1;
  for (let i = 0; i < times.length; i++) if (times[i].start <= lt) a = i;
  return a;
}

// ---------- Animations ----------

const IDENTITY = () => ({ alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, blur: 0, hue: 0, glitch: 0, ls: 0, unit: null });

// p: 0 → hidden/start, 1 → fully shown. `out` mirrors the motion direction for exit animations.
function animState(id, p, st, W, H, out) {
  const s = IDENTITY();
  const e = easeOut(p);
  const sign = out ? -1 : 1;
  const size = st.size;
  switch (id) {
    case 'fade': s.alpha = p; break;
    case 'pop': s.sx = s.sy = 0.3 + 0.7 * easeBack(p); s.alpha = clamp01(p * 3); break;
    case 'zoomIn': s.sx = s.sy = 1.8 - 0.8 * e; s.alpha = p; break;
    case 'zoomOut': s.sx = s.sy = 0.2 + 0.8 * e; s.alpha = p; break;
    case 'slideUp': s.dy = sign * (1 - e) * size * 1.4; s.alpha = clamp01(p * 2); break;
    case 'slideDown': s.dy = -sign * (1 - e) * size * 1.4; s.alpha = clamp01(p * 2); break;
    case 'slideLeft': s.dx = sign * (1 - e) * W * 0.25; s.alpha = clamp01(p * 2); break;
    case 'slideRight': s.dx = -sign * (1 - e) * W * 0.25; s.alpha = clamp01(p * 2); break;
    case 'blurIn': s.blur = (1 - e) * size * 0.35; s.alpha = p; break;
    case 'drop': s.dy = -(1 - easeBounce(p)) * H * 0.35; s.alpha = clamp01(p * 4); break;
    // P3-06 physics text: a real damped spring (overshoots and settles) and
    // a real gravity bounce (falls, impacts, rebounds, lands) — the same
    // solvers as the keyframe physics easings, so text and clip motion agree.
    case 'springSettle': { const e = springPhysicsValue(p); s.sx = s.sy = 0.6 + 0.4 * e; s.dy = sign * (1 - e) * size * 0.6; s.alpha = clamp01(p * 2); break; }
    case 'gravityDrop': { const e = gravityBounceValue(p); s.dy = -(1 - e) * H * 0.35; s.alpha = clamp01(p * 4); break; }
    case 'rotateIn': s.rot = sign * (1 - e) * -0.7; s.sx = s.sy = 0.5 + 0.5 * e; s.alpha = p; break;
    case 'stretch': s.sx = Math.max(0.001, e); s.alpha = clamp01(p * 2); break;
    case 'flip': s.sy = Math.max(0.001, e); s.alpha = clamp01(p * 2); break;
    case 'flicker': s.alpha = textReducedMotion() ? p : p >= 1 ? 1 : (Math.sin(p * 70) > 0 ? 1 : 0.1) * Math.max(0.3, p); break;
    // CC-03 safe flicker: the envelope (weak uneven pulses early, smooth hold
    // after) instead of the rapid strobe above. Reduce Motion / Flashing
    // degrades it to a plain fade — no flashing at all.
    case 'flickerSoft': s.alpha = textReducedMotion() ? p : flickerEnvelope(p); break;
    // CC-03 RGB split reveal: a hard channel split + sideways wobble that
    // decays as the text settles. Reduced motion: plain fade.
    case 'rgbGlitch': if (textReducedMotion()) { s.alpha = clamp01(p * 3); break; } s.dx = (1 - p) * Math.sin(p * 110) * size * 0.5; s.glitch = 1 - p; s.alpha = clamp01(p * 2.5); break;
    case 'glitchIn': if (textReducedMotion()) { s.alpha = clamp01(p * 3); break; } s.dx = (1 - p) * Math.sin(p * 90) * size * 0.4; s.glitch = 1 - p; s.alpha = clamp01(p * 3); break;
    case 'typewriter': s.unit = { kind: 'char', reveal: p }; break;
    case 'wordPop': s.unit = { kind: 'wordpop', reveal: p }; break;
    case 'wordRise': s.unit = { kind: 'wordrise', reveal: p }; break;
    case 'wordSpin': s.unit = { kind: 'wordspin', reveal: p }; break;
    case 'waveIn': s.unit = { kind: 'charwave', reveal: p }; break;
    // Smooth slides: sine ease at both ends, shorter travel than the plain slides, soft alpha ramp.
    case 'slideUpSmooth': s.dy = sign * (1 - easeInOut(p)) * size * 1.1; s.alpha = clamp01(p * 1.6); break;
    case 'slideDownSmooth': s.dy = -sign * (1 - easeInOut(p)) * size * 1.1; s.alpha = clamp01(p * 1.6); break;
    case 'slideLeftSmooth': s.dx = sign * (1 - easeInOut(p)) * W * 0.18; s.alpha = clamp01(p * 1.6); break;
    case 'slideRightSmooth': s.dx = -sign * (1 - easeInOut(p)) * W * 0.18; s.alpha = clamp01(p * 1.6); break;
    // Slides that arrive (or leave) out of focus.
    case 'slideUpBlur': s.dy = sign * (1 - e) * size * 1.2; s.blur = (1 - e) * size * 0.3; s.alpha = clamp01(p * 2); break;
    case 'slideDownBlur': s.dy = -sign * (1 - e) * size * 1.2; s.blur = (1 - e) * size * 0.3; s.alpha = clamp01(p * 2); break;
    case 'slideLeftBlur': s.dx = sign * (1 - e) * W * 0.25; s.blur = (1 - e) * size * 0.3; s.alpha = clamp01(p * 2); break;
    case 'slideRightBlur': s.dx = -sign * (1 - e) * W * 0.25; s.blur = (1 - e) * size * 0.3; s.alpha = clamp01(p * 2); break;
    case 'zoomBlur': s.sx = s.sy = 1.6 - 0.6 * e; s.blur = (1 - e) * size * 0.32; s.alpha = p; break;
    case 'blurPop': s.sx = s.sy = 0.3 + 0.7 * easeBack(p); s.blur = (1 - e) * size * 0.22; s.alpha = clamp01(p * 3); break;
    case 'softFade': s.alpha = p; s.blur = (1 - e) * size * 0.12; break;
    case 'elasticPop': s.sx = s.sy = Math.max(0.01, 0.25 + 0.75 * easeOutElastic(p)); s.alpha = clamp01(p * 3); break;
    case 'bounceUp': s.dy = (1 - easeBounce(p)) * size * 1.3; s.alpha = clamp01(p * 4); break;
    case 'flipSide': s.sx = Math.max(0.001, e); s.alpha = clamp01(p * 2); break;
    case 'tiltIn': s.rot = sign * (1 - e) * -0.22; s.dx = sign * (1 - e) * size * 0.3; s.alpha = p; break;
    case 'spinIn': s.rot = sign * (1 - e) * -2.0; s.sx = s.sy = 0.5 + 0.5 * e; s.alpha = p; break;
    // Letters start spread apart and settle into their normal tracking.
    case 'trackingIn': s.ls = (1 - e) * size * 0.45; s.alpha = clamp01(p * 1.5); break;
    // The Smooth set: full-duration sine-eased fade+travel combos (alpha rides the whole animation,
    // unlike the plain slides whose alpha saturates early), a long glide, an overshoot settle,
    // scale+tracking together, growth from true zero at the center, and slide with rotation.
    case 'fadeUp': s.dy = sign * (1 - easeInOut(p)) * size * 0.9; s.alpha = easeInOut(p); break;
    case 'fadeDown': s.dy = -sign * (1 - easeInOut(p)) * size * 0.9; s.alpha = easeInOut(p); break;
    case 'fadeLeft': s.dx = sign * (1 - easeInOut(p)) * W * 0.16; s.alpha = easeInOut(p); break;
    case 'fadeRight': s.dx = -sign * (1 - easeInOut(p)) * W * 0.16; s.alpha = easeInOut(p); break;
    case 'glideUp': s.dy = sign * (1 - easeInOut(p)) * size * 2.2; s.alpha = easeInOut(p); break;
    case 'settleUp': s.dy = sign * (1 - easeBack(p)) * size * 0.9; s.alpha = clamp01(p * 2); break;
    case 'scaleTrack': s.sx = s.sy = 0.72 + 0.28 * e; s.ls = (1 - e) * size * 0.4; s.alpha = clamp01(p * 1.5); break;
    case 'growCenter': s.sx = s.sy = Math.max(0.001, e); s.blur = (1 - e) * size * 0.15; s.alpha = p; break;
    case 'slideRotate': s.dy = sign * (1 - easeInOut(p)) * size * 0.8; s.rot = sign * (1 - easeInOut(p)) * -0.3; s.alpha = clamp01(p * 1.8); break;
    // Per-character smooth staggers and the decode scramble: inherent unit kinds (the per-char paint
    // loop below plays them); the whole-layer alpha keeps RTL text — never split into chars — fading.
    case 'charSlideUp': s.unit = { kind: 'charslide', dir: 1, reveal: p }; s.alpha = clamp01(p * 2); break;
    case 'charSlideDown': s.unit = { kind: 'charslide', dir: -1, reveal: p }; s.alpha = clamp01(p * 2); break;
    case 'charFade': s.unit = { kind: 'charfade', reveal: p }; s.alpha = clamp01(p * 1.6); break;
    case 'decode': s.unit = { kind: 'decode', reveal: p }; s.alpha = clamp01(p * 1.6); break;
    // Per-character flicker (§8 of the Animation Composer analysis): each letter blinks on and off
    // (about 3 frames on, 1 off) until its window completes, then locks in solid — the whole word
    // stutters into place instead of fading. Deterministic per letter, so preview and export agree.
    case 'charFlicker': s.unit = { kind: 'charflicker', reveal: p }; s.alpha = clamp01(p * 1.6); break;
    // CC-03 unit reveals: the scan sweeps word by word and the word flicker
    // blinks word by word — both play per word in the loop below, never per
    // character, so Arabic words stay whole and correctly shaped. The block
    // alpha stays 1: the units carry the visibility.
    case 'scan': s.unit = { kind: 'wordscan', reveal: p }; break;
    case 'wordFlicker': s.unit = { kind: 'wordflicker', reveal: p }; break;
    // Gap-build C (CSV rows 14/17/56): a line-by-line clip-mask reveal (each line is
    // uncovered left-to-right in reading order, a hard mask edge — no fade), a light
    // sweep (a bright band travels across the words, lighting each as it passes),
    // and a character scatter (letters fly out along deterministic per-letter
    // directions; as an exit p runs 1 -> 0 so the scatter grows, as an entrance
    // p runs 0 -> 1 so the letters assemble from scattered positions).
    case 'maskedLineReveal': s.unit = { kind: 'maskline', reveal: p }; s.alpha = clamp01(p * 1.6); break;
    case 'lightSweepReveal': s.unit = { kind: 'lightsweep', reveal: p }; s.alpha = clamp01(p * 1.6); break;
    case 'charScatter': s.unit = { kind: 'charscatter', reveal: p }; break;
    default: break;
  }
  return s;
}

function loopState(id, t, st) {
  const s = IDENTITY();
  const size = st.size;
  const TAU = Math.PI * 2;
  switch (id) {
    case 'pulse': s.sx = s.sy = 1 + 0.05 * Math.sin(t * TAU * 1.2); break;
    case 'heartbeat': s.sx = s.sy = 1 + 0.14 * Math.max(0, Math.sin(t * TAU * 1.3)) ** 8; break;
    case 'float': s.dy = Math.sin(t * TAU * 0.5) * size * 0.12; break;
    case 'swing': s.rot = Math.sin(t * TAU * 0.7) * 0.08; break;
    case 'shake': s.dx = Math.sin(t * 73) * size * 0.05; s.dy = Math.cos(t * 61) * size * 0.05; break;
    case 'jelly': s.sx = 1 + 0.07 * Math.sin(t * 8); s.sy = 1 - 0.07 * Math.sin(t * 8); break;
    case 'blink': s.alpha = Math.sin(t * TAU * 1.2) > -0.6 ? 1 : 0.2; break;
    case 'rainbow': s.hue = (t * 140) % 360; break;
    case 'glitch': s.glitch = Math.sin(t * 13) > 0.8 ? 1 : 0; s.dx = s.glitch * Math.sin(t * 97) * size * 0.08; break;
    case 'wave': s.unit = { kind: 'wave', t }; break;
    // Gap-build C (CSV rows 43/44): a bright band loops across the text once per
    // cycle (period 1 s at speed 1), and a gentle per-letter sine bob — same
    // wave shape as 'wave' at a slower rate and a third of the amplitude.
    case 'lightsweep': s.unit = { kind: 'lightsweeploop', t }; break;
    case 'typeOsc': s.unit = { kind: 'typeosc', t }; break;
    case 'tracking': s.ls = Math.sin(t * TAU * 0.5) * size * 0.08; break;
    default: break;
  }
  return s;
}

function combine(a, b) {
  return {
    alpha: a.alpha * b.alpha, dx: a.dx + b.dx, dy: a.dy + b.dy, sx: a.sx * b.sx, sy: a.sy * b.sy,
    rot: a.rot + b.rot, blur: a.blur + b.blur, hue: a.hue + b.hue, glitch: Math.max(a.glitch, b.glitch),
    ls: (a.ls || 0) + (b.ls || 0),
    units: [...(a.units || (a.unit ? [a.unit] : [])), ...(b.unit ? [b.unit] : [])],
  };
}

// ---------- Painting ----------

function gradientFor(ctx, st, extent) {
  const h = st.size * 0.5;
  // Horizontal gradients run left to right across the text (the Pinterest showreel's red-to-violet
  // words); the extent is the text width in the clip's local space, centred on the anchor.
  // gradientH is a two-stop run (colour to colour2); gradientMid peaks in the middle and returns
  // to the base colour at both ends (a gradient word sandwiched between solid words).
  if (st.effect === 'gradientH' || st.effect === 'gradientMid') {
    const x0 = extent ? extent.x0 : -h;
    const x1 = extent ? extent.x1 : h;
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    if (st.effect === 'gradientMid') {
      g.addColorStop(0, st.color);
      g.addColorStop(0.5, st.color2);
      g.addColorStop(1, st.color);
    } else {
      g.addColorStop(0, st.color);
      g.addColorStop(1, st.color2);
    }
    return g;
  }
  const g = ctx.createLinearGradient(0, -h, 0, h);
  const stops = {
    gradient: [st.color, st.color2],
    chrome: ['#ffffff', '#c9d1dc', '#7d8796', '#f4f6f8'],
    fire: ['#fff6a8', st.color || '#ffb300', st.color2 || '#ff3b0a'],
    ice: ['#ffffff', st.color || '#d8f6ff', st.color2 || '#4fc3ff'],
  }[st.effect];
  if (!stops) return null;
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

// Paints one run of text (left edge at x, vertical middle at y) with the clip's effect stack.
function paintText(ctx, st, str, x, y, fill, glitchAmt) {
  const size = st.size;
  const eff = st.effect;
  const sw = st.stroke.width;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  // 3D extrusion (P3-05): the sides are painted first, farthest layer first
  // so nearer layers cover them, stepping away from the light one pixel per
  // layer. Shade runs dark at the back to near-face at the front; the
  // `bevel` layers nearest the face carry a lit rim instead — the chamfer
  // highlight. The face itself is painted below, exactly on (x, y), so the
  // text keeps its measured position and the extrusion only extends outward.
  // No shadow on the side layers (it would smear across the whole stack),
  // and the block is deterministic — same pixels in preview and export.
  const depth = extrudeDepth(st);
  if (depth > 0) {
    const { x: dx, y: dy } = extrudeVector(st);
    const bevel = Math.min(depth, Math.max(0, Math.round(st.extrude.bevel || 0)));
    const base = st.color || '#ffffff';
    const strokeBase = st.stroke.color || '#000000';
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    for (let k = depth; k >= 1; k--) {
      const f = k <= bevel ? 1.18 : 0.45 + 0.4 * (1 - k / depth);
      ctx.fillStyle = shadeHex(base, f);
      if (sw > 0) {
        ctx.lineWidth = sw * 2;
        ctx.strokeStyle = shadeHex(strokeBase, k <= bevel ? 1.1 : 0.6);
        ctx.strokeText(str, x + dx * k, y + dy * k);
      }
      ctx.fillText(str, x + dx * k, y + dy * k);
    }
    ctx.restore();
  }
  if (eff === 'shadow3d') {
    ctx.fillStyle = st.color2 || '#000000';
    const depth = Math.max(2, Math.round(size * 0.1));
    for (let k = depth; k > 0; k--) {
      if (sw > 0) {
        ctx.lineWidth = sw * 2;
        ctx.strokeStyle = st.stroke.color;
        ctx.strokeText(str, x + k * 0.6, y + k);
      }
      ctx.fillText(str, x + k * 0.6, y + k);
    }
  }
  if (eff === 'retro') {
    ctx.fillStyle = st.color2 || '#ff5f6d';
    ctx.fillText(str, x + size * 0.07, y + size * 0.07);
  }
  const g = glitchAmt || (eff === 'glitch' ? 0.6 : 0);
  if (g > 0) {
    const d = size * 0.06 * g + 1;
    ctx.save();
    ctx.globalAlpha *= 0.85;
    ctx.fillStyle = '#ff1f5a';
    ctx.fillText(str, x - d, y);
    ctx.fillStyle = '#16e0ff';
    ctx.fillText(str, x + d, y);
    ctx.restore();
  }
  if (eff === 'double') {
    ctx.lineWidth = (sw + size * 0.12) * 2;
    ctx.strokeStyle = st.color2 || '#ffffff';
    ctx.strokeText(str, x, y);
  }
  const glow = eff === 'neon' || eff === 'glow' || eff === 'fire' || eff === 'ice';
  const setShadow = () => {
    if (glow) {
      ctx.shadowColor = st.glowColor || st.color;
      ctx.shadowBlur = size * (eff === 'neon' ? 0.55 : 0.35);
      ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    } else if (st.shadow.on || eff === 'soft') {
      ctx.shadowColor = rgba(st.shadow.color, st.shadow.opacity);
      ctx.shadowBlur = eff === 'soft' ? Math.max(st.shadow.blur, size * 0.35) : st.shadow.blur;
      ctx.shadowOffsetX = st.shadow.x;
      ctx.shadowOffsetY = st.shadow.y;
    }
  };
  const clearShadow = () => {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  };
  setShadow();
  if (sw > 0 || eff === 'hollow') {
    ctx.lineWidth = (sw || Math.max(2, size / 25)) * 2;
    ctx.strokeStyle = eff === 'hollow' && !sw ? fill : st.stroke.color;
    ctx.strokeText(str, x, y);
    if (!glow) clearShadow();
  }
  if (eff !== 'hollow') {
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
    if (glow) ctx.fillText(str, x, y);
  }
  clearShadow();
  if (eff === 'emboss') {
    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(str, x - size * 0.02, y - size * 0.02);
    ctx.restore();
  }
  if (st.underline) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y + size * 0.42, ctx.measureText(str).width, Math.max(2, size * 0.06));
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function drawBubble(ctx, st, L) {
  const size = st.size;
  const px = size * 0.45;
  const py = size * 0.3;
  const x = -L.width / 2 - px;
  const y = -L.height / 2 - py;
  const w = L.width + px * 2;
  const h = L.height + py * 2;
  const c = st.bubbleColor;
  ctx.save();
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  switch (st.bubble) {
    case 'rounded': roundRect(ctx, x, y, w, h, size * 0.3); ctx.fill(); break;
    case 'pill': roundRect(ctx, x - px * 0.3, y, w + px * 0.6, h, h / 2); ctx.fill(); break;
    case 'speech':
      roundRect(ctx, x, y, w, h, size * 0.35); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + w * 0.18, y + h - 1); ctx.lineTo(x + w * 0.1, y + h + size * 0.55); ctx.lineTo(x + w * 0.34, y + h - 1); ctx.fill();
      break;
    case 'thought':
      roundRect(ctx, x, y, w, h, h * 0.45); ctx.fill();
      [[0.16, 0.32, 0.22], [0.08, 0.62, 0.12]].forEach(([fx, fy, r]) => {
        ctx.beginPath(); ctx.arc(x + w * fx, y + h + size * fy, size * r, 0, Math.PI * 2); ctx.fill();
      });
      break;
    case 'tag':
      ctx.beginPath(); ctx.moveTo(x - h * 0.45, 0); ctx.lineTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(x - h * 0.12, 0, size * 0.09, 0, Math.PI * 2); ctx.fill();
      break;
    case 'ribbon': {
      const n = h * 0.35;
      ctx.beginPath(); ctx.moveTo(x - n * 1.6, y); ctx.lineTo(x + w + n * 1.6, y); ctx.lineTo(x + w + n * 0.6, 0); ctx.lineTo(x + w + n * 1.6, y + h);
      ctx.lineTo(x - n * 1.6, y + h); ctx.lineTo(x - n * 0.6, 0); ctx.closePath(); ctx.fill();
      break;
    }
    case 'sticky':
      ctx.rotate(-0.03);
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.12;
      ctx.fillRect(x - px * 0.3, y - py * 0.5, w + px * 0.6, h + py);
      break;
    case 'frame': ctx.lineWidth = Math.max(2, size * 0.06); ctx.strokeRect(x, y, w, h); break;
    case 'marker':
      ctx.globalAlpha *= 0.9; ctx.beginPath();
      ctx.moveTo(x + size * 0.1, y + h * 0.35); ctx.lineTo(x + w, y + h * 0.3); ctx.lineTo(x + w - size * 0.1, y + h * 0.95); ctx.lineTo(x, y + h * 0.98); ctx.closePath(); ctx.fill();
      break;
    case 'underline': roundRect(ctx, x + px * 0.5, y + h - py * 0.6, w - px, size * 0.14, size * 0.07); ctx.fill(); break;
    case 'brackets': {
      const a = size * 0.35;
      ctx.lineWidth = Math.max(2, size * 0.07); ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(x + a, y); ctx.lineTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + a, y + h);
      ctx.moveTo(x + w - a, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - a, y + h);
      ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.restore();
}

function drawBackground(ctx, st, L) {
  const b = st.bg;
  const pad = st.size * b.padding;
  ctx.save();
  ctx.fillStyle = rgba(b.color, b.opacity);
  if (b.mode === 'line') {
    L.lines.forEach((l) => {
      if (!l.words.length) return;
      roundRect(ctx, l.x - pad, l.y - L.lineH / 2 - pad * 0.15, l.width + pad * 2, L.lineH + pad * 0.3, b.radius);
      ctx.fill();
    });
  } else {
    roundRect(ctx, -L.width / 2 - pad, -L.height / 2 - pad * 0.6, L.width + pad * 2, L.height + pad * 1.2, b.radius);
    ctx.fill();
  }
  ctx.restore();
}

// Is the clip on screen at timeline time t?
// ---- Responsive titles & graphics (P2-13) ----
// Pure aspect / safe-zone math lives in ./responsive.js (no canvas or font
// imports, so node tests can use it); this file adds the pieces that need
// the resolved style and the measured layout.
import { aspectKey, aspectPositionOf, responsiveTitle } from './responsive.js';
export { aspectKey, aspectPositionOf, responsiveTitle, SAFE_ZONES } from './responsive.js';
// The title's position for this aspect: a per-aspect override stored on the
// clip (clip.responsive = { '9:16': { x, y }, ... }, written by dragging the
// title or its inspector sliders) wins; otherwise the clip's base x/y.
export function aspectPosition(clip, W, H) {
  return aspectPositionOf(resolveStyle(clip), clip.responsive, W, H);
}
// Measure a style, then return the same style adjusted to its aspect (size
// shrunk to fit the safe zone, position clamped into it). The caller draws
// with the returned style, so preview and export agree by construction.
export function responsiveMeasure(ctx, clip, st, text, W, H, pinOff = null) {
  const pos = aspectPosition(clip, W, H);
  const ex = pos.x + (pinOff ? pinOff.dx : 0);
  const ey = pos.y + (pinOff ? pinOff.dy : 0);
  const L0 = layout(ctx, st, text, W);
  const resp = responsiveTitle(ex, ey, W, H, { w: L0.width, h: L0.height });
  const st2 = resp.scale < 1 ? { ...st, size: st.size * resp.scale } : st;
  const L = resp.scale < 1 ? layout(ctx, st2, text, W) : L0;
  // The style carries the clamped centre minus the pin offset (the renderer
  // adds the pin back at draw time, landing exactly on the clamped centre).
  return { st: { ...st2, x: resp.cx / W - (pinOff ? pinOff.dx : 0), y: resp.cy / H - (pinOff ? pinOff.dy : 0) }, L };
}

// Box of a text clip in project pixels, without its animation: { cx, cy, w, h, rot } (degrees). Used by the
// player's move / resize / rotate handles.
let measureCtx = null;
export function textBox(clip, W, H) {
  const st = resolveStyle(clip);
  // A graphic clip's box is its vector size, not its (often empty) text.
  if (st.graphic && st.graphic.kind) {
    const pos = aspectPosition(clip, W, H);
    const { w, h } = graphicSize(st.graphic, st, W, H);
    return { cx: pos.x * W, cy: pos.y * H, w, h, rot: st.rotation || 0 };
  }
  const text = st.uppercase ? (st.text || '').toLocaleUpperCase() : st.text || '';
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const { st: stR, L } = responsiveMeasure(measureCtx, clip, st, text.trim() ? text : ' ', W, H);
  const pad = stR.size * 0.18 + (stR.stroke.width || 0) / 2 + (stR.bg.on ? stR.size * (stR.bg.padding || 0) : 0);
  return { cx: stR.x * W, cy: stR.y * H, w: L.width + pad * 2, h: L.height + pad, rot: stR.rotation || 0 };
}

export function textVisible(clip, t) {
  return t >= clip.start && t < clip.start + clip.duration;
}

// Draws a text clip at local time lt (seconds since clip start) onto ctx (project pixel space W x H).
// ---------- Neon Pop Duo ----------

// Per-line paint style for a duo paragraph (layout() + paintText() read these).
// The duo overrides stroke/shadow/effect/bubble/bg: the glow is painted per
// unit below, not by the shared style machinery.
function duoLineStyle(st, duo, lineIdx, rtl, size) {
  const spec = lineIdx === 0 ? duo.line1 : duo.line2;
  return {
    ...st,
    font: rtl ? (lineIdx === 0 ? duo.rtl.font1 : duo.rtl.font2) : spec.font,
    // Arabic never takes italic; line 1 is Medium (bold1 false), line 2 Bold.
    bold: rtl ? (lineIdx === 0 ? duo.rtl.bold1 : duo.rtl.bold2) : spec.bold,
    italic: rtl ? false : spec.italic,
    size,
    color: spec.color,
    // RTL lines never take letter-spacing: it breaks Arabic joining (see
    // src/text/bidi.js). Latin keeps the duo's tight tracking.
    letterSpacing: rtl ? 0 : spec.letterSpacing * size,
    lineHeight: spec.lineHeight,
    maxWidth: duo.layout.maxWidth,
    stroke: { width: 0, color: '#000000' },
    shadow: { on: false, color: '#000000', blur: 0, x: 0, y: 0, opacity: 0 },
    effect: 'none',
    // The duo paints its own per-unit glow; extrusion stays off here so the
    // two-line sequencer is never double-styled (P3-05 scope: plain text).
    extrude: { on: false },
    bubble: 'none',
    bg: { on: false },
    align: 'center',
  };
}

// One pure draw path for the duo: same (time, text, tokens) gives identical
// pixels in preview and in export (both go through drawTextLayer).
function drawDuoClip(ctx, clip, st, lt, W, H, pinOff = null) {
  const duo = st.duo;
  const D = st.duration * 1000;
  const tMs = lt * 1000;
  if (tMs < 0 || tMs >= D) return;
  const { line1, line2 } = splitDuoText(st.text);
  if (!line1 && !line2) return;
  const rtl1 = isRtl(line1);
  const rtl2 = isRtl(line2);
  const size1 = duo.line1.sizeRel * W;
  const size2 = size1 * duo.line2.sizeRel;
  let st1 = duoLineStyle(st, duo, 0, rtl1, size1);
  let st2 = duoLineStyle(st, duo, 1, rtl2, size2);
  const maxW = duo.layout.maxWidth * W;
  let L1 = line1 ? layout(ctx, st1, line1, W) : null;
  let L2 = line2 ? layout(ctx, st2, line2, W) : null;
  // A single long word can overflow the wrap: shrink the whole block (both
  // lines together, down to the floor) and re-lay out once.
  const widest = Math.max(L1 ? L1.width : 0, L2 ? L2.width : 0);
  if (widest > maxW) {
    const shrink = Math.max(duo.layout.minScale, maxW / widest);
    st1 = { ...st1, size: size1 * shrink };
    st2 = { ...st2, size: size2 * shrink };
    L1 = line1 ? layout(ctx, st1, line1, W) : null;
    L2 = line2 ? layout(ctx, st2, line2, W) : null;
  }
  const s1 = L1 ? st1.size : size1;

  // Timing: line-2 units are graphemes for Latin, words for RTL.
  const n1 = wordsOf(line1).length;
  const step2 = rtl2 ? duo.line2.wordMs : duo.line2.charMs;
  const n2 = line2 ? (rtl2 ? wordsOf(line2).length : graphemes(line2).length) : 0;
  const T = duoTiming(duo, n1, n2, step2, D);

  // Exit: both lines together, starting holdEnd before the clip end.
  let exitA = 1;
  if (tMs >= T.exitStart) {
    exitA = duo.hardCut ? 0 : clamp01(1 - (tMs - T.exitStart) / T.exitDur);
  }
  if (exitA <= 0.001) return;

  // Block geometry: centred horizontally, block centre at the clip's y —
  // clamped into this aspect's safe zone (P2-13), using the real block box.
  const gap = duo.layout.lineGap * s1;
  const totalH = (L1 ? L1.height : 0) + (L2 ? gap + L2.height : 0);
  const pos = aspectPosition(clip, W, H);
  const resp = responsiveTitle(pos.x + (pinOff ? pinOff.dx : 0), pos.y + (pinOff ? pinOff.dy : 0), W, H, { w: Math.max(L1 ? L1.width : 0, L2 ? L2.width : 0), h: totalH });
  const cx = resp.cx;
  const cy = resp.cy;
  let topY = cy - totalH / 2;

  // Glow for one entering unit: entry colour cooling to the resting glow.
  // glowP is 0 at the unit's start, 1 once the glow has settled.
  const unitGlow = (spec, glowDur, tMs, start, first) => {
    const glowP = clamp01((tMs - start) / glowDur);
    const [gr, gg, gb] = lerpColor(spec.enterGlow.color, spec.restGlow.color, glowP);
    const intensity = first ? lerp(spec.firstGlow || 1, 1, glowP) : 1;
    return {
      blur: Math.max(0, lerp(spec.enterGlow.blur, spec.restGlow.blur, glowP) * intensity * duo.glowScale),
      color: rgbaArr([gr, gg, gb], Math.min(1, lerp(1, spec.restGlow.alpha, glowP) * duo.glowScale)),
    };
  };
  const glowShadow = (g) => ({ on: true, color: g.color, blur: g.blur, x: 0, y: 0, opacity: 1 });

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // --- Line 1: word by word, neon blur-in, seeded baseline float. ---
  if (L1) {
    const spec = duo.line1;
    const y0 = topY + L1.height / 2;
    for (const line of L1.lines) {
      for (const wd of line.words) {
        const i = wd.i;
        const start = i * T.stagger;
        const p = clamp01((tMs - start) / T.enterDur);
        if (p <= 0) continue;
        const e = easeDuo(p);
        const alpha = e * exitA;
        if (alpha <= 0.001) continue;
        const g = unitGlow(spec, T.glowDur1, tMs, start, i === 0);
        const floatP = clamp01((tMs - start) / T.floatDur);
        // Drop-bounce (duo.bounce): the word drops from ABOVE the baseline
        // with gravity, lands on it, bounces once (below, rebound, settle) —
        // and the scale stays 1.0 through the whole entry: no pop-up, the
        // word TRAVELS down into place (dropBounceDy). The seeded drop
        // height varies ±dropVar per word, but every word starts well above
        // the line. Same 120 ms stagger and 280 ms opacity/blur window as
        // the plain entry; the drop itself runs 550 ms (300 fall + 250 bounce).
        const dy = duo.bounce
          ? dropBounceDy(clamp01((tMs - start) / T.dropDur), -(spec.dropHeight + seededFloat(duo.seed, i, spec.dropVar)), T.dropFallFrac) * s1
          : seededFloat(duo.seed, i, spec.floatAmp) * s1 * (1 - easeDuo(floatP));
        const sc = duo.bounce ? 1 : 0.92 + 0.08 * e;
        const blur = duo.lightMode ? 0 : (1 - e) * 10;
        ctx.save();
        ctx.translate(cx + wd.x + wd.w / 2, y0 + line.y + dy);
        ctx.scale(sc, sc);
        ctx.globalAlpha = alpha;
        ctx.font = cssFont(st1.font, st1.size, st1.bold, st1.italic);
        ctx.letterSpacing = `${st1.letterSpacing}px`;
        ctx.direction = rtl1 ? 'rtl' : 'ltr';
        if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
        paintText(ctx, { ...st1, shadow: glowShadow(g) }, wd.text, -wd.w / 2, 0, spec.color, 0);
        ctx.restore();
      }
    }
    topY += L1.height + gap;
  }

  // --- Line 2: Latin per char (typed), RTL per word. ---
  if (L2) {
    const spec = duo.line2;
    const y0 = topY + L2.height / 2;
    if (rtl2) {
      for (const line of L2.lines) {
        for (const wd of line.words) {
          const j = wd.i;
          const start = T.line2Start + j * T.step;
          const p = clamp01((tMs - start) / T.charDur);
          if (p <= 0) continue;
          const e = easeDuo(p);
          const alpha = e * exitA;
          if (alpha <= 0.001) continue;
          const g = unitGlow(spec, T.glowDur2, tMs, start, false);
          const blur = duo.lightMode ? 0 : (1 - e) * 6;
          ctx.save();
          ctx.translate(cx + wd.x + wd.w / 2, y0 + line.y);
          ctx.globalAlpha = alpha;
          ctx.font = cssFont(st2.font, st2.size, st2.bold, st2.italic);
          ctx.letterSpacing = `${st2.letterSpacing}px`;
          ctx.direction = 'rtl';
          if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
          paintText(ctx, { ...st2, shadow: glowShadow(g) }, wd.text, -wd.w / 2, 0, spec.color, 0);
          ctx.restore();
        }
      }
    } else {
      const starts = wordGraphemeStarts(line2);
      for (const line of L2.lines) {
        for (const wd of line.words) {
          const chars = graphemes(wd.text);
          ctx.font = cssFont(st2.font, st2.size, st2.bold, st2.italic);
          ctx.letterSpacing = `${st2.letterSpacing}px`;
          // Prefix widths keep kerning: char k sits at the width of the
          // k graphemes before it.
          const px = [0];
          for (let k = 0; k < chars.length; k++) {
            px.push(ctx.measureText(chars.slice(0, k + 1).join('')).width);
          }
          for (let k = 0; k < chars.length; k++) {
            const gi = starts[wd.i] + k;
            const start = T.line2Start + gi * T.step;
            const p = clamp01((tMs - start) / T.charDur);
            if (p <= 0) continue;
            const e = easeDuo(p);
            const alpha = e * exitA;
            if (alpha <= 0.001) continue;
            const g = unitGlow(spec, T.glowDur2, tMs, start, false);
            const blur = duo.lightMode ? 0 : (1 - e) * 6;
            ctx.save();
            ctx.translate(cx + wd.x + px[k], y0 + line.y);
            ctx.globalAlpha = alpha;
            ctx.font = cssFont(st2.font, st2.size, st2.bold, st2.italic);
            ctx.letterSpacing = `${st2.letterSpacing}px`;
            ctx.direction = 'ltr';
            if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
            paintText(ctx, { ...st2, shadow: glowShadow(g) }, chars[k], 0, 0, spec.color, 0);
            ctx.restore();
          }
        }
      }
    }
  }
  ctx.restore();
}

// Vector-graphics kinds (gap-c): grouped layer-template parts.
const VECTOR_GRAPHIC_KINDS = new Set(['panel', 'credits', 'stroke-draw-on', 'progress-ring',
  'number-counter', 'countdown-timer', 'progress-bar', 'pointer-highlight', 'kinetic-dot-grid']);

// ---------- Vector graphics (Gap-build C, CSV §5.3) ----------
// A text clip with `graphic: { kind, ...params }` renders a procedural vector
// graphic instead of text — the same drawTextClip the preview and the export
// share, so a graphic that plays in the panel plays identically in the
// exported file. The clip keeps its text style (font/colour/size/anim): the
// shapes use it, and a graphic template is a GROUP of these clips (one per
// part, sharing a groupId — see src/graphics/catalog.js), so every part stays
// individually editable, keyframeable, undoable and saveable like any clip.
function graphicSize(g, st, W, H) {
  const size = st.size;
  switch (g.kind) {
    case 'panel': return { w: g.w ?? (g.wFrac ? g.wFrac * W : size * 8), h: g.h ?? (g.hFrac ? g.hFrac * H : size * 2.2) };
    case 'progress-ring': { const d = size * (g.radius ?? 1.1) * 2; return { w: d, h: d }; }
    case 'progress-bar': return { w: (g.width ?? 0.6) * W, h: size * (g.height ?? 0.5) };
    case 'number-counter':
    case 'countdown-timer': return { w: size * 3.6, h: size * 1.4 };
    case 'pointer-highlight': { const d = size * (g.radius ?? 0.9) * 2.8; return { w: d, h: d }; }
    case 'kinetic-dot-grid': {
      const gap = size * (g.spacing ?? 1.1);
      return { w: ((g.cols ?? 7) - 1) * gap + size * 0.3, h: ((g.rows ?? 4) - 1) * gap + size * 0.3 };
    }
    case 'stroke-draw-on': return { w: size * 2.6, h: size * 2.2 };
    case 'credits': return { w: W * 0.8, h: H * 0.7 };
    default: return { w: size * 2, h: size * 2 };
  }
}

// The number a counter / countdown clip shows at local time lt.
function graphicValue(g, st, lt) {
  const dur = Math.max(0.01, st.duration || 3);
  const p = g.progress != null ? clamp01(g.progress) : clamp01(lt / dur);
  if (g.kind === 'countdown-timer') {
    const total = g.seconds ?? 10;
    const rem = Math.max(0, total * (1 - p));
    if (g.format === 'mmss') {
      const total = Math.round(rem);
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    return String(Math.ceil(rem));
  }
  const v = (g.from ?? 0) + ((g.to ?? 100) - (g.from ?? 0)) * easeInOut(p);
  const dec = g.decimals ?? 0;
  const num = dec > 0 ? v.toFixed(dec) : String(Math.round(v));
  const shown = g.commas ? Number(num).toLocaleString('en-US') : num;
  return `${g.prefix ?? ''}${shown}${g.suffix ?? ''}`;
}

// Sampled points of a stroke-draw shape, in size units around the centre.
function strokeDrawPoints(kind, size) {
  if (kind === 'circle') {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const a = -Math.PI / 2 + (i / 64) * Math.PI * 2;
      pts.push([Math.cos(a) * size * 0.9, Math.sin(a) * size * 0.9]);
    }
    return pts;
  }
  if (kind === 'underline') {
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const x = -size * 1.2 + (i / 48) * size * 2.4;
      pts.push([x, Math.sin((i / 48) * Math.PI * 3) * size * 0.08]);
    }
    return pts;
  }
  // checkmark (default): two straight strokes, sampled along their length.
  const seg = [[-size, size * 0.15], [-size * 0.3, size * 0.85], [size * 1.1, -size * 0.75]];
  const pts = [];
  for (let s = 0; s < seg.length - 1; s++) {
    const [x0, y0] = seg[s];
    const [x1, y1] = seg[s + 1];
    const n = s === 0 ? 16 : 32;
    for (let i = 0; i < n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  }
  pts.push(seg[seg.length - 1]);
  return pts;
}


// ---------- Animated graphics (CC-06) ----------

// Paints every word of a measured layout at its laid-out position (the
// layout already ran bidi ordering, so mixed Arabic+Latin words land in
// visual order and Arabic words stay whole — never split into characters).
function paintGraphicRun(ctx, st, L, fill, glitchAmt = 0) {
  ctx.font = cssFont(st.font, st.size, st.bold, st.italic);
  // RTL text never takes letter-spacing: it breaks Arabic joining.
  ctx.letterSpacing = L.rtl ? '0px' : `${st.letterSpacing || 0}px`;
  ctx.direction = L.rtl ? 'rtl' : 'ltr';
  for (const line of L.lines) {
    for (const wd of line.words) paintText(ctx, st, wd.text, wd.x, line.y, fill, glitchAmt);
  }
}

// One pure draw path for a graphic clip: same (time, text, spec) gives
// identical pixels in preview and in export (both go through drawTextLayer).
// The block In/Out/Loop motion is the shared animState machinery, so the
// static-frame skip's settled logic (animIn.dur / animOut.dur) stays valid:
// every internal reveal below is driven by pIn and settles exactly when the
// entrance ends. Time-driven kinds (number / ring / timer) never settle —
// staticFrame returns null for them. Reduced motion settles internal
// reveals instantly and keeps only the fade; the counted values themselves
// are content, not motion, so a counting number / ticking timer keeps
// counting.
function drawGraphicClip(ctx, clip, st, lt, W, H, pinOff = null) {
  const g = st.graphic;
  // Vector-graphics kinds (gap-c grouped templates) render through the
  // vector renderer below; the CC-06 kinds render through this body.
  // The two kind namespaces are disjoint (CC-06: title/lowerThird/label/
  // callout/number/timer/ring/boxpop/twoline; vector: panel/credits/
  // stroke-draw-on/progress-ring/number-counter/countdown-timer/progress-bar/
  // pointer-highlight/kinetic-dot-grid).
  if (VECTOR_GRAPHIC_KINDS.has(g?.kind)) return drawVectorGraphicClip(ctx, clip, st, lt, W, H, pinOff);
  const dur = st.duration;
  if (lt < 0 || lt >= dur) return;
  const pIn = st.animIn.dur > 0 ? clamp01(lt / st.animIn.dur) : 1;
  const pOut = st.animOut.dur > 0 ? clamp01((dur - lt) / st.animOut.dur) : 1;
  const rm = textReducedMotion();
  const pInEff = rm ? 1 : pIn; // internal reveals settle instantly under reduced motion
  let A = combine(animState(st.animIn.id, pIn, st, W, H, false), animState(st.animOut.id, pOut, st, W, H, true));
  A = combine(A, loopState(st.animLoop.id, lt * (st.animLoop.speed || 1), st));
  if (A.alpha <= 0.001) return;
  const text = st.text || '';
  // What gets measured for the safe-zone fit: the displayed value for the
  // counting kinds, the label for the ring, the text itself otherwise.
  let display = text;
  if (g.kind === 'number') {
    const to = parseEndNumber(text, 100);
    display = formatNumber(countValue(g.from, to, clamp01(lt / dur)), g.decimals, g.prefix, g.suffix);
  } else if (g.kind === 'timer') {
    display = formatTimer(timerRemaining(parseTimerSeconds(text, g.seconds), lt));
  }
  const { st: stR, L } = responsiveMeasure(ctx, clip, st, display, W, H, pinOff);

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.direction = L.rtl ? 'rtl' : 'ltr';
  ctx.translate((stR.x + (pinOff ? pinOff.dx : 0)) * W + A.dx, (stR.y + (pinOff ? pinOff.dy : 0)) * H + A.dy);
  if (stR.rotation) ctx.rotate((stR.rotation * Math.PI) / 180);
  if (A.rot) ctx.rotate(A.rot);
  ctx.scale(A.sx, A.sy);
  ctx.globalAlpha *= A.alpha * clamp01(stR.opacity ?? 1);
  const filters = [];
  if (A.blur > 0.3) filters.push(`blur(${A.blur.toFixed(1)}px)`);
  if (A.hue) filters.push(`hue-rotate(${A.hue.toFixed(0)}deg)`);
  if (filters.length) ctx.filter = filters.join(' ');
  const fill = gradientFor(ctx, stR, { x0: -L.width / 2, x1: L.width / 2 }) || stR.color;
  const size = stR.size;

  if (g.kind === 'title') {
    // Minimal Title: the text, then a thin rule that draws in underneath.
    paintGraphicRun(ctx, stR, L, fill, A.glitch);
    if (g.rule) {
      const rw = Math.max(0, L.width * easeOut(pInEff));
      const rh = Math.max(2, size * 0.045);
      ctx.save();
      ctx.fillStyle = g.ruleColor;
      ctx.fillRect(-rw / 2, L.height / 2 + size * 0.35, rw, rh);
      ctx.restore();
    }
  } else if (g.kind === 'lowerThird') {
    // Editorial Lower Third: name over role, left-anchored at the clip's
    // position, with an accent bar at the left edge that grows in.
    const { line1, line2 } = splitGraphicText(text);
    const st2 = { ...stR, size: size * 0.62, bold: false };
    const L1 = layout(ctx, stR, line1 || ' ', W);
    const L2 = line2 ? layout(ctx, st2, line2, W) : null;
    const gap = size * 0.3;
    const totalH = L1.height + (L2 ? gap + L2.height : 0);
    const blockW = Math.max(L1.width, L2 ? L2.width : 0);
    const y1 = -totalH / 2 + L1.height / 2;
    const y2 = L2 ? totalH / 2 - L2.height / 2 : 0;
    ctx.save();
    ctx.translate(blockW / 2, 0); // origin at the block's left edge
    const barW = Math.max(2, size * 0.12);
    const barH = totalH * easeOut(pInEff);
    ctx.save();
    ctx.fillStyle = g.accent;
    ctx.fillRect(-size * 0.35 - barW, -totalH / 2, barW, Math.max(0, barH));
    ctx.restore();
    ctx.save();
    ctx.translate(0, y1);
    paintGraphicRun(ctx, stR, L1, fill, A.glitch);
    ctx.restore();
    if (L2) {
      ctx.save();
      ctx.translate(0, y2);
      paintGraphicRun(ctx, st2, L2, stR.color2 || stR.color, A.glitch);
      ctx.restore();
    }
    ctx.restore();
  } else if (g.kind === 'label') {
    // Rounded Label: the text on a bubble that pops in around it.
    // Outline Label: the hollow text inside a frame that fades in.
    const pad = size * 0.45;
    const w = L.width + pad * 2;
    const h = L.height + pad * 1.2;
    if (g.shape === 'rounded') {
      const s = rm ? 1 : 0.6 + 0.4 * easeBack(pInEff);
      ctx.save();
      ctx.scale(s, s);
      ctx.fillStyle = g.fill;
      roundRect(ctx, -w / 2, -h / 2, w, h, size * 0.3);
      ctx.fill();
      paintGraphicRun(ctx, stR, L, fill, A.glitch);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalAlpha *= pInEff;
      ctx.strokeStyle = g.frame;
      ctx.lineWidth = Math.max(2, size * 0.06);
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
      paintGraphicRun(ctx, stR, L, fill, A.glitch);
    }
  } else if (g.kind === 'callout') {
    // Callout Arrow: the text, plus an arrow that draws in from the text's
    // bottom-right corner toward the spec's target point.
    paintGraphicRun(ctx, stR, L, fill, A.glitch);
    const e = easeOut(pInEff);
    if (e > 0.02) {
      const sx = L.width / 2 + size * 0.1;
      const sy = L.height / 2 + size * 0.1;
      const ex = sx + g.arrow.dx * W;
      const ey = sy + g.arrow.dy * H;
      const hx = sx + (ex - sx) * e;
      const hy = sy + (ey - sy) * e;
      const ang = Math.atan2(ey - sy, ex - sx);
      const head = size * 0.22;
      ctx.save();
      ctx.strokeStyle = g.color;
      ctx.fillStyle = g.color;
      ctx.lineWidth = Math.max(3, size * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - head * Math.cos(ang - 0.42), hy - head * Math.sin(ang - 0.42));
      ctx.lineTo(hx - head * Math.cos(ang + 0.42), hy - head * Math.sin(ang + 0.42));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (g.kind === 'number' || g.kind === 'timer') {
    // Kinetic Number / Timer Countdown: the computed value is the text.
    paintGraphicRun(ctx, stR, L, fill, A.glitch);
  } else if (g.kind === 'ring') {
    // Progress Ring: the arc fills with clip progress; the live percent
    // sits in the middle and the clip text is the label underneath.
    const r = size * 1.1;
    const frac = ringFraction(lt, dur);
    const lw = Math.max(2, size * 0.12);
    ctx.save();
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.strokeStyle = g.track;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    if (frac > 0.001) {
      ctx.strokeStyle = g.color;
      ctx.beginPath();
      ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    const pct = `${Math.round(frac * 100)}%`;
    const LP = layout(ctx, stR, pct, W);
    paintGraphicRun(ctx, stR, LP, fill, A.glitch);
    if (text.trim()) {
      const LL = layout(ctx, { ...stR, size: size * 0.42, bold: false }, text, W);
      ctx.save();
      ctx.translate(0, r + size * 0.55);
      paintGraphicRun(ctx, { ...stR, size: size * 0.42, bold: false }, LL, fill, A.glitch);
      ctx.restore();
    }
  } else if (g.kind === 'boxpop') {
    // Text Box Pop: the box pops in first, the text fades in just after it.
    const pad = size * 0.5;
    const w = L.width + pad * 2;
    const h = L.height + pad * 1.2;
    const s = rm ? 1 : 0.55 + 0.45 * easeBack(pInEff);
    ctx.save();
    ctx.scale(s, s);
    ctx.fillStyle = g.fill;
    roundRect(ctx, -w / 2, -h / 2, w, h, g.radius);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha *= rm ? 1 : clamp01((pInEff - 0.25) / 0.5);
    paintGraphicRun(ctx, stR, L, fill, A.glitch);
    ctx.restore();
  } else if (g.kind === 'twoline') {
    // Two-Line Scale Reveal: line 1 scales in, then line 2 follows.
    const { line1, line2 } = splitGraphicText(text);
    const st2 = { ...stR, size: size * g.line2Scale };
    const L1 = layout(ctx, stR, line1 || ' ', W);
    const L2 = line2 ? layout(ctx, st2, line2, W) : null;
    const gap = size * 0.3;
    const totalH = L1.height + (L2 ? gap + L2.height : 0);
    const y1 = -totalH / 2 + L1.height / 2;
    const y2 = L2 ? totalH / 2 - L2.height / 2 : 0;
    const s1 = rm ? 1 : 0.8 + 0.2 * easeOut(clamp01(pInEff / 0.55));
    ctx.save();
    ctx.translate(0, y1);
    ctx.scale(s1, s1);
    paintGraphicRun(ctx, stR, L1, fill, A.glitch);
    ctx.restore();
    if (L2) {
      // Line 2 follows line 1: it is invisible until 45% of the entrance,
      // then scales in (0.8 -> 1) while fading in — so the second line
      // genuinely ARRIVES late instead of sitting visible from frame one.
      const s2 = rm ? 1 : 0.8 + 0.2 * easeOut(clamp01((pInEff - 0.45) / 0.55));
      ctx.save();
      ctx.globalAlpha *= rm ? 1 : clamp01((pInEff - 0.45) / 0.25);
      ctx.translate(0, y2);
      ctx.scale(s2, s2);
      paintGraphicRun(ctx, st2, L2, stR.color2 || stR.color, A.glitch);
      ctx.restore();
    }
  } else {
    // Unknown kind: fall back to plain text — never a blank frame.
    paintGraphicRun(ctx, stR, L, fill, A.glitch);
  }
  ctx.restore();
}

function drawVectorGraphicClip(ctx, clip, st, lt, W, H, pinOff) {
  const g = st.graphic;
  const dur = clip.duration || 3;
  const pIn = st.animIn.dur > 0 ? clamp01(lt / st.animIn.dur) : 1;
  const pOut = st.animOut.dur > 0 ? clamp01((dur - lt) / st.animOut.dur) : 1;
  const A = combine(combine(animState(st.animIn.id, pIn, st, W, H, false), animState(st.animOut.id, pOut, st, W, H, true)),
    loopState(st.animLoop.id, lt * (st.animLoop.speed || 1), st));
  if (A.alpha <= 0.001) return;
  const pos = aspectPosition(clip, W, H);
  const size = st.size;
  const col = g.color || st.color || '#ffffff';
  const prog = g.progress != null ? clamp01(g.progress) : clamp01(lt / Math.max(0.01, dur));
  ctx.save();
  ctx.translate(pos.x * W + (pinOff ? pinOff.dx : 0) * W + A.dx, pos.y * H + (pinOff ? pinOff.dy : 0) * H + A.dy);
  if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180);
  if (A.rot) ctx.rotate(A.rot);
  ctx.scale(A.sx, A.sy);
  ctx.globalAlpha *= A.alpha * clamp01(st.opacity ?? 1);
  const filters = [];
  if (A.blur > 0.3) filters.push(`blur(${A.blur.toFixed(1)}px)`);
  if (A.hue) filters.push(`hue-rotate(${A.hue.toFixed(0)}deg)`);
  if (filters.length) ctx.filter = filters.join(' ');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (g.kind) {
    case 'panel': {
      const { w, h } = graphicSize(g, st, W, H);
      ctx.fillStyle = rgba(g.bgColor || col, g.opacity ?? 0.9);
      roundRect(ctx, -w / 2, -h / 2, w, h, g.radius ?? size * 0.25);
      ctx.fill();
      break;
    }
    case 'progress-ring': {
      const R = size * (g.radius ?? 1.1);
      const lw = size * (g.stroke ?? 0.16);
      ctx.lineCap = 'round';
      ctx.lineWidth = lw;
      ctx.strokeStyle = g.trackColor || 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
      if (g.label !== false) {
        ctx.font = cssFont(st.font, size * 0.45, st.bold, st.italic);
        ctx.fillStyle = col;
        ctx.fillText(g.label ?? `${Math.round(prog * 100)}%`, 0, 0);
      }
      break;
    }
    case 'progress-bar': {
      const { w: tw, h: bh } = graphicSize(g, st, W, H);
      ctx.fillStyle = g.trackColor || 'rgba(255,255,255,0.25)';
      roundRect(ctx, -tw / 2, -bh / 2, tw, bh, bh / 2);
      ctx.fill();
      ctx.save();
      roundRect(ctx, -tw / 2, -bh / 2, tw, bh, bh / 2);
      ctx.clip();
      ctx.fillStyle = col;
      ctx.fillRect(-tw / 2, -bh / 2, Math.max(0, tw * prog), bh);
      ctx.restore();
      if (g.label !== false) {
        ctx.font = cssFont(st.font, size * 0.5, st.bold, st.italic);
        ctx.fillStyle = col;
        ctx.textAlign = 'left';
        ctx.fillText(g.label ?? `${Math.round(prog * 100)}%`, tw / 2 + size * 0.4, 0);
      }
      break;
    }
    case 'number-counter':
    case 'countdown-timer': {
      const str = graphicValue(g, st, lt);
      ctx.font = cssFont(st.font, size, st.bold, st.italic);
      const w = ctx.measureText(str).width;
      paintText(ctx, st, str, -w / 2, 0, col, 0);
      break;
    }
    case 'pointer-highlight': {
      const R = size * (g.radius ?? 0.9);
      const pulse = 1 + 0.08 * Math.sin(lt * Math.PI * 2 * 1.2);
      ctx.lineWidth = size * 0.08;
      ctx.strokeStyle = rgba(col, 0.25);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.35, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, R * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, size * 0.16, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'kinetic-dot-grid': {
      const gap = size * (g.spacing ?? 1.1);
      const cols = g.cols ?? 7;
      const rows = g.rows ?? 4;
      const w = (cols - 1) * gap;
      const h = (rows - 1) * gap;
      const baseAlpha = ctx.globalAlpha;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const ph = lt * Math.PI * 2 * 0.8 + (i + j) * 0.6;
          const s = 0.7 + 0.3 * Math.sin(ph);
          ctx.globalAlpha = baseAlpha * (0.55 + 0.45 * Math.max(0, Math.sin(ph)));
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(-w / 2 + i * gap, -h / 2 + j * gap, size * 0.09 * s, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = baseAlpha;
      break;
    }
    case 'stroke-draw-on': {
      const pts = strokeDrawPoints(g.shape || 'checkmark', size);
      let total = 0;
      const segLen = [];
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        segLen.push(d); total += d;
      }
      const target = prog * total;
      ctx.strokeStyle = col;
      ctx.lineWidth = size * (g.stroke ?? 0.12);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      let done = 0;
      for (let i = 1; i < pts.length && done < target; i++) {
        const d = segLen[i - 1];
        if (done + d <= target) { ctx.lineTo(pts[i][0], pts[i][1]); done += d; }
        else {
          const f = (target - done) / Math.max(0.001, d);
          ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
          done = target;
        }
      }
      ctx.stroke();
      break;
    }
    case 'credits': {
      const lines = (st.text || '').split('\n').filter(Boolean);
      const lineH = size * 1.3;
      const speed = g.speed ?? size * 0.9; // px per second
      const scroll = lt * speed;
      ctx.font = cssFont(st.font, size, st.bold, st.italic);
      ctx.fillStyle = col;
      lines.forEach((line, i) => {
        const y = H * 0.32 - scroll + i * lineH;
        if (Math.abs(y) > H * 0.45) return;
        const fade = clamp01((H * 0.45 - Math.abs(y)) / (H * 0.1));
        ctx.save();
        ctx.globalAlpha *= fade;
        ctx.fillText(line, 0, y);
        ctx.restore();
      });
      break;
    }
    default: break;
  }
  ctx.restore();
}

export function drawTextClip(ctx, clip, lt, W, H, pinOff = null) {
  let st = resolveStyle(clip);
  // A graphic clip renders vector shapes instead of text (see drawGraphicClip);
  // the clip still carries the text style (font/colour/anim) the shapes use.
  if (st.graphic && st.graphic.kind) { drawGraphicClip(ctx, clip, st, lt, W, H, pinOff); return; }
  let text = st.text || '';
  if (st.uppercase) text = text.toLocaleUpperCase();
  // A graphic clip is drawn by its own renderer (CC-06, the duo pattern);
  // the single-style path below never sees it. It goes before the empty-text
  // guard: a timer / number renders its computed value even with no text.
  // The uppercased text travels with the style (the clip itself is untouched).
  if (st.graphic) {
    drawGraphicClip(ctx, clip, { ...st, text }, lt, W, H, pinOff);
    return;
  }
  const allWords = text.split(/\s+/).filter(Boolean);
  if (!allWords.length) return;
  const times = wordTimes(st, allWords.length);
  const active = activeIndex(times, lt);
  const hl = st.highlight;
  let shownText = text;
  let indexOffset = 0;
  if (hl.mode === 'single') {
    if (active < 0) return;
    shownText = allWords[active];
    indexOffset = active;
  }

  // Responsive titles (P2-13): the shown text is fitted into this aspect's
  // safe zone (shrunk, and its per-aspect position clamped into it) before
  // any animation state is derived, so the whole draw below — layout, word
  // effects, bubble, background — uses the adjusted style, in preview and
  // export alike. Duo clips measure their own two-line block and clamp
  // inside drawDuoClip instead.
  if (!st.duo) st = responsiveMeasure(ctx, clip, st, shownText, W, H, pinOff).st;
  // A duo clip is drawn by its own sequencer (two lines, different styles and
  // timing); the single-style path below never sees it.
  if (st.duo) {
    drawDuoClip(ctx, clip, st, lt, W, H, pinOff);
    return;
  }

  const dur = st.duration;
  const pIn = st.animIn.dur > 0 ? clamp01(lt / st.animIn.dur) : 1;
  const pOut = st.animOut.dur > 0 ? clamp01((dur - lt) / st.animOut.dur) : 1;
  // Unit mode (src/text/units.js): a slot set to animate word by word or letter by letter contributes
  // nothing but its letter-tracking to the whole-block state — tracking is a property of the shared
  // layout, so it still settles globally — and its motion is replayed per unit in the word loop below,
  // each unit animating around its own position. Presets that already animate per unit on their own
  // (typewriter, word and wave presets) ignore the setting entirely.
  const perUnit = (slot) => slot.unit !== 'whole' && slot.id !== 'none' && !INHERENT_UNIT_ANIMS.has(slot.id);
  const blockOf = (slot, p, out) => {
    const s = animState(slot.id, p, st, W, H, out);
    return perUnit(slot) ? { ...IDENTITY(), ls: s.ls } : s;
  };
  let A = combine(blockOf(st.animIn, pIn, false), blockOf(st.animOut, pOut, true));
  A = combine(A, loopState(st.animLoop.id, lt * (st.animLoop.speed || 1), st));
  if (A.alpha <= 0.001) return;

  ctx.save();
  // Animated letter tracking (Tracking In / Out) widens the layout itself, so it is applied to the style the
  // layout is measured with; the player and the export share this function, so both agree.
  const stl = A.ls ? { ...st, letterSpacing: (st.letterSpacing || 0) + A.ls } : st;
  const L = layout(ctx, stl, shownText, W);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.direction = L.rtl ? 'rtl' : 'ltr'; // mixed-content words paint in the paragraph's direction
  ctx.translate((st.x + (pinOff ? pinOff.dx : 0)) * W + A.dx, (st.y + (pinOff ? pinOff.dy : 0)) * H + A.dy);
  if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180);
  if (A.rot) ctx.rotate(A.rot);
  // 3D tilt (P3-05): a small lean of the whole clip — cosine squash on each
  // axis, so ±45° reads as a tilt without ever flipping or mirroring text.
  if (st.extrude && st.extrude.on && (st.extrude.tiltX || st.extrude.tiltY)) {
    const tx = Math.max(-45, Math.min(45, st.extrude.tiltX || 0)) * Math.PI / 180;
    const ty = Math.max(-45, Math.min(45, st.extrude.tiltY || 0)) * Math.PI / 180;
    ctx.transform(Math.cos(ty), 0, 0, Math.cos(tx), 0, 0);
  }
  ctx.scale(A.sx, A.sy);
  ctx.globalAlpha *= A.alpha * clamp01(st.opacity ?? 1);
  const filters = [];
  if (A.blur > 0.3) filters.push(`blur(${A.blur.toFixed(1)}px)`);
  if (A.hue) filters.push(`hue-rotate(${A.hue.toFixed(0)}deg)`);
  if (filters.length) ctx.filter = filters.join(' ');

  if (st.bubble !== 'none') drawBubble(ctx, st, L);
  if (st.bg.on) drawBackground(ctx, st, L);

  const baseFill = gradientFor(ctx, st, { x0: -L.width / 2, x1: L.width / 2 }) || st.color;
  const totalChars = allWords.reduce((n, w) => n + [...w].length, 0);
  const nWords = allWords.length;
  // Phrase highlight: a box spanning a whole word range (from/to; a negative index
  // counts from the end), appearing once the phrase has fully revealed and staying
  // for the rest of the clip — the end-state of a quote, not a per-word flash.
  let phrase = null;
  let phraseDone = false;
  if (hl.mode === 'phrase' && hl.from !== undefined && hl.to !== undefined) {
    const from = hl.from < 0 ? nWords + hl.from : hl.from;
    const to = hl.to < 0 ? nWords + hl.to : hl.to;
    phrase = { from: Math.max(0, from), to: Math.min(nWords - 1, to) };
    phraseDone = pIn * nWords >= phrase.to + 1;
  }
  let charBase = 0;
  // Characters before each word, for character-level animations.
  const charsBefore = [];
  allWords.forEach((w, i) => {
    charsBefore[i] = charBase;
    charBase += [...w].length;
  });

  // Per-unit animation support: the effective granularity of each slot ('char' falls back to 'word'
  // for RTL text, whose letters must stay joined), the staggered state of one unit, and accumulators
  // that fold an In and an Out unit state into the transforms of a single word or letter.
  const effIn = perUnit(st.animIn) ? effectiveUnit(st.animIn.unit, L.rtl) : 'whole';
  const effOut = perUnit(st.animOut) ? effectiveUnit(st.animOut.unit, L.rtl) : 'whole';
  const unitStateFor = (slot, eff, i, gi, out) => {
    const p = out ? pOut : pIn;
    const lp = eff === 'char' ? unitProgress(p, gi, totalChars, out) : unitProgress(p, i, nWords, out);
    return animState(slot.id, lp, st, W, H, out);
  };
  const newAcc = () => ({ alpha: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, blur: 0, glitch: 0 });
  const addUnit = (acc, u) => {
    acc.alpha *= u.alpha; acc.dx += u.dx; acc.dy += u.dy;
    acc.sx *= u.sx; acc.sy *= u.sy; acc.rot += u.rot;
    acc.blur = Math.max(acc.blur, u.blur); acc.glitch = Math.max(acc.glitch, u.glitch);
  };
  // A unit's own blur replaces the clip-level canvas filter while it is painted; rebuild the filter so
  // the block blur and hue are not lost underneath it.
  const unitFilter = (blur) => {
    const parts = [];
    const b = A.blur + blur;
    if (b > 0.3) parts.push(`blur(${b.toFixed(1)}px)`);
    if (A.hue) parts.push(`hue-rotate(${A.hue.toFixed(0)}deg)`);
    return parts.join(' ');
  };

  for (let li = 0; li < L.lines.length; li++) {
    const line = L.lines[li];
    // CC-03: one scan bar per line, at the first not-yet-revealed word.
    let scanHeadDrawn = false;
    // The phrase box is drawn once per line, behind the words on that line, so a
    // phrase reads as one continuous band even where it wraps.
    if (phraseDone && phrase) {
      const pw = line.words.filter((wd) => { const i = wd.i + indexOffset; return i >= phrase.from && i <= phrase.to; });
      if (pw.length) {
        const pad = st.size * 0.14;
        const bx0 = Math.min(...pw.map((wd) => wd.x)) - pad;
        const bx1 = Math.max(...pw.map((wd) => wd.x + wd.w)) + pad;
        ctx.save();
        ctx.fillStyle = hl.bg;
        roundRect(ctx, bx0, line.y - L.lineH * 0.48, bx1 - bx0, L.lineH * 0.96, st.size * 0.16);
        ctx.fill();
        ctx.restore();
      }
    }
    for (const wd of line.words) {
      const i = wd.i + indexOffset;
      let alpha = 1;
      let scale = 1;
      let dy = 0;
      let wordBlur = 0; // a word-pop's blur-to-sharp: set by the wordpop unit below
      let wordRot = 0; // a word-spin's rotation: set by the wordspin unit below
      let fill = baseFill;
      let visibleChars = Infinity;
      let edgeAlpha = 1; // the half-revealed character of a typewriter reveal fades in instead of popping
      let charWave = null;
      let charFx = null; // charslide / charfade / decode: per-char effects played by the loop below
      let maskLine = null; // masked-line reveal: { reveal } — the clip fraction is computed per word below
      let maskClip = 0; // visible fraction of this word under the mask (0 = hidden, 1 = fully shown)
      let arriving = false; // this word is mid-arrival (a wordpop/wordrise window in flight)
      let scanBar = false; // CC-03: this word is the scan head — the first not-yet-revealed word

      for (const u of A.units) {
        if (u.kind === 'char') {
          const f = u.reveal * totalChars - charsBefore[i];
          const fl = Math.floor(f + 1e-4);
          if (fl < visibleChars) { visibleChars = fl; edgeAlpha = 1; }
          if (fl === visibleChars && f - fl > 0.001 && f - fl < 1) edgeAlpha = Math.min(edgeAlpha, f - fl);
        } else if (u.kind === 'maskline') {
          maskLine = { reveal: u.reveal };
        } else if (u.kind === 'lightsweep') {
          // A bright band travels across the words: words behind the band are
          // shown, the word under the band is lit white, words ahead are hidden.
          const local = clamp01(u.reveal * nWords - i);
          if (local <= 0) alpha = 0;
          else {
            alpha *= clamp01(local * 1.5);
            if (local < 1) fill = '#ffffff';
          }
        } else if (u.kind === 'lightsweeploop') {
          // The looping band: each word lights up as the band (one cycle per
          // second at speed 1) passes its centre across the whole block.
          const frac = (wd.x + wd.w / 2 + L.width / 2) / Math.max(1, L.width);
          const band = ((u.t % 1) + 1) % 1;
          let d = Math.abs(frac - band); d = Math.min(d, 1 - d);
          const glow = Math.exp(-(d * d) / (2 * 0.09 * 0.09));
          if (glow > 0.45) { fill = '#ffffff'; scale *= 1 + 0.06 * glow; }
        } else if (u.kind === 'typeosc') {
          charWave = { t: u.t, gentle: true };
        } else if (u.kind === 'wordpop' || u.kind === 'wordrise' || u.kind === 'wordspin') {
          const local = clamp01(u.reveal * nWords - i);
          if (local > 0 && local < 1) arriving = true;
          if (local <= 0) alpha = 0;
          if (u.kind === 'wordpop') {
            scale *= 0.4 + 0.6 * easeBack(local);
            // The pop lands out of focus and sharpens as it settles (the video-2
            // caption motion): blur is strongest at the start of the word's window.
            wordBlur = Math.max(wordBlur, (1 - easeOut(local)) * st.size * 0.22);
          }
          else if (u.kind === 'wordspin') {
            // Scales up while rotating into place (the scale-rotation caption):
            // a word spins in from ~20 degrees and settles straight.
            scale *= 0.4 + 0.6 * easeBack(local);
            wordRot = (1 - easeOut(local)) * 0.35;
            alpha *= local;
          }
          else { dy += (1 - easeOut(local)) * st.size * 0.6; alpha *= local; }
        } else if (u.kind === 'charwave') {
          charWave = { reveal: u.reveal };
        } else if (u.kind === 'charslide' || u.kind === 'charfade' || u.kind === 'decode' || u.kind === 'charflicker' || u.kind === 'charscatter') {
          charFx = { kind: u.kind, dir: u.dir || 1, reveal: u.reveal };
        } else if (u.kind === 'wordscan') {
          // CC-03 Character Scan: words reveal one by one in reading order
          // (logical index, so RTL reveals right-to-left); the first hidden
          // word carries the scan bar, drawn just below before the skip.
          const local = clamp01(u.reveal * nWords - i);
          if (local <= 0) { alpha = 0; scanBar = true; }
          else alpha *= clamp01(local * 1.4);
        } else if (u.kind === 'wordflicker') {
          // CC-03 Word Flicker: each word blinks (seeded, deterministic)
          // through its window, then locks in solid. Reduced motion skips
          // the blink and fades the word in (see src/text/flicker.js).
          const local = clamp01(u.reveal * nWords - i);
          if (local <= 0) alpha = 0;
          else alpha *= wordFlickerAlpha(local, i, textReducedMotion());
        } else if (u.kind === 'wave') {
          charWave = { t: u.t };
        }
      }
      // Word-granularity unit motion for this word (letter slots apply further down, per character).
      const wAcc = newAcc();
      if (effIn === 'word') addUnit(wAcc, unitStateFor(st.animIn, effIn, i, 0, false));
      if (effOut === 'word') addUnit(wAcc, unitStateFor(st.animOut, effOut, i, 0, true));
      if (alpha * wAcc.alpha <= 0 || visibleChars <= 0) {
        // CC-03: the scan head — a thin bar at the leading edge of the first
        // hidden word (left edge LTR, right edge RTL), drawn even though the
        // word itself is skipped. The clip-level alpha already applies.
        if (scanBar && !scanHeadDrawn) {
          scanHeadDrawn = true;
          const bw = Math.max(2, st.size * 0.05);
          ctx.save();
          ctx.globalAlpha *= 0.9;
          ctx.fillStyle = st.color || '#ffffff';
          ctx.fillRect(L.rtl ? wd.x + wd.w : wd.x - bw, line.y - L.lineH / 2, bw, L.lineH);
          ctx.restore();
        }
        continue;
      }
      alpha *= wAcc.alpha;
      // Masked-line reveal: the sweep crosses one line at a time (reveal * line
      // count selects the line, the fraction across it selects the word's cut).
      if (maskLine) {
        const f = clamp01(maskLine.reveal * L.lines.length - li);
        const sweepX = line.x + f * line.width;
        maskClip = clamp01((sweepX - wd.x) / Math.max(1, wd.w));
        if (maskClip <= 0) continue;
      }

      // Caption highlight of the spoken word.
      const isActive = i === active;
      const lt0 = times[i] || { start: 0, end: 0 };
      // A highlight palette cycles one colour per word (hl.colors[i]); a single
      // hl.color is the fallback and the colour the inspector edits.
      const hlColor = Array.isArray(hl.colors) ? hl.colors[i % hl.colors.length] : hl.color;
      if (hl.mode === 'reveal') {
        if (lt0.start > lt) continue;
        scale *= 0.7 + 0.3 * easeBack(clamp01((lt - lt0.start) / 0.15));
      } else if (hl.mode === 'single') {
        scale *= 0.7 + 0.3 * easeBack(clamp01((lt - lt0.start) / 0.12));
      } else if (isActive && (hl.mode === 'color' || hl.mode === 'scale' || hl.mode === 'box' || hl.mode === 'marker')) {
        fill = hlColor;
        if (hl.mode === 'scale') scale *= 1.14;
      } else if (hl.mode === 'arrive' && arriving) {
        // The word currently arriving (its wordpop/wordrise window in flight) takes the highlight
        // colour and settles back to the base colour once it lands — the pink flash on arrival in
        // the Pinterest showreel, where the spoken-word clock would lag the stagger.
        fill = hlColor;
      } else if (hl.mode === 'phrase' && phraseDone && i >= phrase.from && i <= phrase.to) {
        // The phrase box is on: its words keep the highlight colour (gold on red).
        fill = hl.color;
      } else if (hl.mode === 'karaoke' && lt0.end <= lt) {
        fill = hlColor;
      }

      ctx.save();
      ctx.translate(wd.x + wd.w / 2 + wAcc.dx, line.y + dy + wAcc.dy);
      if (wAcc.rot) ctx.rotate(wAcc.rot);
      if (wordRot) ctx.rotate(wordRot);
      ctx.scale(scale * wAcc.sx, scale * wAcc.sy);
      ctx.globalAlpha *= alpha;
      const totalBlur = Math.max(wAcc.blur, wordBlur);
      if (totalBlur > 0.3) ctx.filter = unitFilter(totalBlur);
      const x0 = -wd.w / 2;
      // The mask edge is a hard clip on the word (the mask, not a fade).
      if (maskClip > 0 && maskClip < 1) {
        const rx = L.rtl ? x0 + wd.w * (1 - maskClip) : x0;
        ctx.beginPath(); ctx.rect(rx - 1, -L.lineH, wd.w * maskClip + 2, L.lineH * 2); ctx.clip();
      }
      if (isActive && (hl.mode === 'box' || hl.mode === 'marker')) {
        ctx.save();
        ctx.fillStyle = hl.bg;
        const pad = st.size * 0.14;
        if (hl.mode === 'box') roundRect(ctx, x0 - pad, -L.lineH * 0.48, wd.w + pad * 2, L.lineH * 0.96, st.size * 0.16);
        else {
          ctx.beginPath();
          ctx.moveTo(x0 - pad, -st.size * 0.12); ctx.lineTo(x0 + wd.w + pad, -st.size * 0.2);
          ctx.lineTo(x0 + wd.w + pad * 0.6, st.size * 0.45); ctx.lineTo(x0 - pad * 0.6, st.size * 0.5); ctx.closePath();
        }
        ctx.fill();
        ctx.restore();
      }

      const chars = [...wd.text];
      const charUnits = effIn === 'char' || effOut === 'char';
      const perChar = !L.rtl && (charWave || charFx || visibleChars < chars.length || charUnits);
      let cursorX = null; // end of the last revealed character, for a typewriter cursor
      if (!perChar) {
        paintText(ctx, st, wd.text, x0, 0, fill, Math.max(A.glitch, wAcc.glitch));
        cursorX = wd.w / 2;
      } else {
        let cx = x0;
        for (let c = 0; c < chars.length && c <= visibleChars; c++) {
          if (c === visibleChars && edgeAlpha >= 1) break;
          const charAlpha = c === visibleChars ? edgeAlpha : 1;
          const ch = chars[c];
          const cw = ctx.measureText(ch).width;
          let cy = 0;
          let ca = 1;
          let chDx = 0; // character scatter: per-letter sideways drift
          let glyph = ch; // the decode scramble paints a substitute glyph until the char locks in
          if (charWave) {
            const gi = charsBefore[i] + c;
            if (charWave.gentle) cy = Math.sin(charWave.t * Math.PI + gi * 0.45) * st.size * 0.05;
            else if (charWave.t !== undefined) cy = Math.sin(charWave.t * 6 + gi * 0.55) * st.size * 0.12;
            else {
              const local = clamp01(charWave.reveal * totalChars * 1.2 - gi);
              cy = (1 - easeOut(local)) * st.size * 0.7;
              ca = local;
            }
          }
          if (charFx) {
            const gi = charsBefore[i] + c;
            const local = clamp01(charFx.reveal * totalChars * 1.2 - gi);
            if (charFx.kind === 'charslide') {
              cy += charFx.dir * (1 - easeInOut(local)) * st.size * 0.85;
              ca *= clamp01(local * 1.7);
            } else if (charFx.kind === 'charfade') {
              ca *= easeInOut(local);
            } else if (charFx.kind === 'decode' && local < 1) {
              // A genuine scramble: the substitute cycles deterministically with the (quantized)
              // progress — same frame in preview and export — until this char's window completes.
              const stepN = Math.floor(charFx.reveal * 28);
              const hsh = (((gi + 1) * 2654435761) ^ ((stepN + 1) * 40503)) >>> 0;
              glyph = DECODE_GLYPHS[hsh % DECODE_GLYPHS.length];
              ca *= 0.3 + 0.7 * local;
            } else if (charFx.kind === 'charflicker' && local < 1) {
              // Per-character flicker: the letter blinks on and off on a fixed 3-on-1-off duty
              // cycle while its window runs, then locks in solid. The step is quantized (same
              // hash pattern as decode) so the blink is identical in preview and export.
              // Reduced motion: no blink — the letter just fades in.
              const stepN = Math.floor(charFx.reveal * 28);
              const hsh = (((gi + 1) * 2654435761) ^ ((stepN + 1) * 40503)) >>> 0;
              ca *= (0.3 + 0.7 * local) * (textReducedMotion() || (hsh % 4) !== 0 ? 1 : 0.15);
            } else if (charFx.kind === 'charscatter') {
              // Character scatter: each letter drifts away from its home along a
              // deterministic per-letter direction (same hash as decode, so the
              // directions agree in preview and export) and fades as it goes.
              // scatter = 1 - reveal: 0 assembled, 1 fully scattered.
              const s = 1 - charFx.reveal;
              const hsh = (((gi + 1) * 2654435761) ^ 0x9e3779b9) >>> 0;
              const ang = (hsh % 360) * (Math.PI / 180);
              const dist = s * st.size * 1.1;
              chDx += Math.cos(ang) * dist;
              cy += Math.sin(ang) * dist;
              ca *= 1 - s * 0.9;
            }
          }
          // Letter-granularity unit motion, around this letter's own position (Latin text only —
          // perChar is never entered for RTL, where 'char' already degraded to 'word').
          let cAcc = null;
          if (charUnits) {
            const gi = charsBefore[i] + c;
            cAcc = newAcc();
            if (effIn === 'char') addUnit(cAcc, unitStateFor(st.animIn, effIn, i, gi, false));
            if (effOut === 'char') addUnit(cAcc, unitStateFor(st.animOut, effOut, i, gi, true));
            if (cAcc.alpha <= 0) { cx += cw; continue; }
          }
          if (ca > 0 && charAlpha > 0) {
            ctx.save();
            ctx.globalAlpha *= ca * charAlpha * (cAcc ? cAcc.alpha : 1);
            // A typewriter letter lands out of focus and sharpens as it settles (the Pinterest
            // showreel's blur-to-sharp typing): the edge character carries a blur that fades
            // with its alpha. Only the edge character is affected; settled letters stay sharp.
            const edgeBlur = c === visibleChars ? (1 - edgeAlpha) * st.size * 0.3 : 0;
            if (cAcc) {
              ctx.translate(cx + cw / 2 + cAcc.dx + chDx, cy + cAcc.dy);
              if (cAcc.rot) ctx.rotate(cAcc.rot);
              ctx.scale(cAcc.sx, cAcc.sy);
              if (cAcc.blur + edgeBlur > 0.3) ctx.filter = unitFilter(wAcc.blur + cAcc.blur + edgeBlur);
              paintText(ctx, st, glyph, -cw / 2, 0, fill, Math.max(A.glitch, wAcc.glitch, cAcc.glitch));
            } else {
              if (edgeBlur > 0.3) ctx.filter = unitFilter(totalBlur + edgeBlur);
              paintText(ctx, st, glyph, cx + chDx, cy, fill, A.glitch);
            }
            ctx.restore();
          }
          cx += cw;
        }
        cursorX = cx;
      }

      // A blinking typewriter cursor (the Pinterest URL beat): a vertical bar after the last
      // revealed character, following the typing point while the word types in and sitting at
      // the end once the text is complete. Blinks at 1 Hz on the clip's local time.
      if (st.cursor && cursorX !== null) {
        const isTypingWord = visibleChars > 0 && visibleChars < chars.length;
        const isLastWordDone = i === nWords - 1 && visibleChars >= chars.length;
        if ((isTypingWord || isLastWordDone) && Math.floor(lt * 2) % 2 === 0) {
          ctx.save();
          ctx.fillStyle = st.cursor.color || '#E25AB1';
          const cw = Math.max(2, st.size * 0.1);
          const ch = L.lineH * 0.85;
          ctx.fillRect(cursorX - cw / 2, -ch / 2, cw, ch);
          ctx.restore();
        }
      }

      if (hl.mode === 'karaoke' && isActive && lt0.end > lt0.start) {
        const prog = clamp01((lt - lt0.start) / (lt0.end - lt0.start));
        ctx.save();
        ctx.beginPath();
        // The color sweeps the way the word reads: from the right for Arabic and Hebrew.
        if (L.rtl) ctx.rect(x0 + wd.w * (1 - prog), -L.lineH, wd.w * prog + st.size * 0.3, L.lineH * 2);
        else ctx.rect(x0 - st.size * 0.3, -L.lineH, st.size * 0.3 + wd.w * prog, L.lineH * 2);
        ctx.clip();
        paintText(ctx, { ...st, shadow: { ...st.shadow, on: false } }, wd.text, x0, 0, hl.color, 0);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

// Draws every text clip visible at timeline time t (bottom to top in track order). Takes the whole
// project (not just the text clips) because a text clip pinned to a motion track (clip.pin) needs the
// tracked clip to compute its offset — the preview and the export call this same function, so a pinned
// text sits at the same place in both.
export function drawTextLayer(ctx, project, t, W, H) {
  for (const c of project.textClips) {
    if (!textVisible(c, t)) continue;
    const off = c.pin ? pinOffsetAt(project, { track: 'text', clip: c }, t) : null;
    drawTextClip(ctx, c, t - c.start, W, H, off);
  }
}

