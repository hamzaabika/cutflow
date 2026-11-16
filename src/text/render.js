// Canvas text renderer shared by the preview and the export, so both look identical.
// Coordinates are project pixels (e.g. 1280x720); callers scale the context for the preview.
import { cssFont } from '../fonts.js';
import { INHERENT_UNIT_ANIMS, effectiveUnit, isAnimUnit, unitProgress } from './units.js';
import { pinOffsetAt } from '../track.js';
import {
  DEFAULT_DUO, resolveDuo, duoTiming, graphemes, wordsOf, isRtl, splitDuoText,
  wordGraphemeStarts, seededFloat, easeDuo, dropBounceDy, lerp, lerpColor, rgbaArr,
} from './duo.js';

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
  highlight: { mode: 'none', color: '#ffd400', bg: '#7c3aed' },
  animIn: { id: 'fade', dur: 0.3, unit: 'whole' },
  animOut: { id: 'fade', dur: 0.25, unit: 'whole' },
  animLoop: { id: 'none', speed: 1 },
  // Neon Pop Duo: a two-line caption with per-line styles and sequencing (see
  // src/text/duo.js). null for every other template; when set, drawTextClip
  // hands the whole clip to drawDuoClip and the animIn/animOut above stay 'none'.
  duo: null,
};

const NESTED = ['stroke', 'shadow', 'bg', 'highlight', 'animIn', 'animOut', 'animLoop'];
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
  // Unknown or missing animation units fall back to animating the whole text at once.
  if (!isAnimUnit(s.animIn.unit)) s.animIn.unit = 'whole';
  if (!isAnimUnit(s.animOut.unit)) s.animOut.unit = 'whole';
  return s;
}

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
const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

export function rgba(hex, a = 1) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- Layout ----------

function layout(ctx, st, text, W) {
  ctx.font = cssFont(st.font, st.size, st.bold, st.italic);
  ctx.letterSpacing = `${st.letterSpacing || 0}px`;
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
  const width = Math.max(0, ...lines.map((l) => l.width));
  const height = lines.length * lineH;
  const rtl = RTL.test(text);
  lines.forEach((l, li) => {
    l.y = -height / 2 + lineH * (li + 0.5);
    const x0 = st.align === 'left' ? -width / 2 : st.align === 'right' ? width / 2 - l.width : -l.width / 2;
    l.x = x0;
    let x = x0;
    (rtl ? [...l.words].reverse() : l.words).forEach((wd) => {
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
    case 'rotateIn': s.rot = sign * (1 - e) * -0.7; s.sx = s.sy = 0.5 + 0.5 * e; s.alpha = p; break;
    case 'stretch': s.sx = Math.max(0.001, e); s.alpha = clamp01(p * 2); break;
    case 'flip': s.sy = Math.max(0.001, e); s.alpha = clamp01(p * 2); break;
    case 'flicker': s.alpha = p >= 1 ? 1 : (Math.sin(p * 70) > 0 ? 1 : 0.1) * Math.max(0.3, p); break;
    case 'glitchIn': s.dx = (1 - p) * Math.sin(p * 90) * size * 0.4; s.glitch = 1 - p; s.alpha = clamp01(p * 3); break;
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
// Box of a text clip in project pixels, without its animation: { cx, cy, w, h, rot } (degrees). Used by the
// player's move / resize / rotate handles.
let measureCtx = null;
export function textBox(clip, W, H) {
  const st = resolveStyle(clip);
  const text = st.uppercase ? (st.text || '').toLocaleUpperCase() : st.text || '';
  measureCtx ||= document.createElement('canvas').getContext('2d');
  const L = layout(measureCtx, st, text.trim() ? text : ' ', W);
  const pad = st.size * 0.18 + (st.stroke.width || 0) / 2 + (st.bg.on ? st.size * (st.bg.padding || 0) : 0);
  return { cx: st.x * W, cy: st.y * H, w: L.width + pad * 2, h: L.height + pad, rot: st.rotation || 0 };
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
    letterSpacing: spec.letterSpacing * size,
    lineHeight: spec.lineHeight,
    maxWidth: duo.layout.maxWidth,
    stroke: { width: 0, color: '#000000' },
    shadow: { on: false, color: '#000000', blur: 0, x: 0, y: 0, opacity: 0 },
    effect: 'none',
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

  // Block geometry: centred horizontally, block centre at the clip's y.
  const gap = duo.layout.lineGap * s1;
  const totalH = (L1 ? L1.height : 0) + (L2 ? gap + L2.height : 0);
  const cx = (st.x + (pinOff ? pinOff.dx : 0)) * W;
  const cy = (st.y + (pinOff ? pinOff.dy : 0)) * H;
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

export function drawTextClip(ctx, clip, lt, W, H, pinOff = null) {
  const st = resolveStyle(clip);
  // A duo clip is drawn by its own sequencer (two lines, different styles and
  // timing); the single-style path below never sees it.
  if (st.duo) {
    drawDuoClip(ctx, clip, st, lt, W, H, pinOff);
    return;
  }
  let text = st.text || '';
  if (st.uppercase) text = text.toLocaleUpperCase();
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
  ctx.translate((st.x + (pinOff ? pinOff.dx : 0)) * W + A.dx, (st.y + (pinOff ? pinOff.dy : 0)) * H + A.dy);
  if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180);
  if (A.rot) ctx.rotate(A.rot);
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

  for (const line of L.lines) {
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
      let arriving = false; // this word is mid-arrival (a wordpop/wordrise window in flight)

      for (const u of A.units) {
        if (u.kind === 'char') {
          const f = u.reveal * totalChars - charsBefore[i];
          const fl = Math.floor(f + 1e-4);
          if (fl < visibleChars) { visibleChars = fl; edgeAlpha = 1; }
          if (fl === visibleChars && f - fl > 0.001 && f - fl < 1) edgeAlpha = Math.min(edgeAlpha, f - fl);
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
        } else if (u.kind === 'charslide' || u.kind === 'charfade' || u.kind === 'decode' || u.kind === 'charflicker') {
          charFx = { kind: u.kind, dir: u.dir || 1, reveal: u.reveal };
        } else if (u.kind === 'wave') {
          charWave = { t: u.t };
        }
      }
      // Word-granularity unit motion for this word (letter slots apply further down, per character).
      const wAcc = newAcc();
      if (effIn === 'word') addUnit(wAcc, unitStateFor(st.animIn, effIn, i, 0, false));
      if (effOut === 'word') addUnit(wAcc, unitStateFor(st.animOut, effOut, i, 0, true));
      if (alpha * wAcc.alpha <= 0 || visibleChars <= 0) continue;
      alpha *= wAcc.alpha;

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
          let glyph = ch; // the decode scramble paints a substitute glyph until the char locks in
          if (charWave) {
            const gi = charsBefore[i] + c;
            if (charWave.t !== undefined) cy = Math.sin(charWave.t * 6 + gi * 0.55) * st.size * 0.12;
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
              const stepN = Math.floor(charFx.reveal * 28);
              const hsh = (((gi + 1) * 2654435761) ^ ((stepN + 1) * 40503)) >>> 0;
              ca *= (0.3 + 0.7 * local) * ((hsh % 4) !== 0 ? 1 : 0.15);
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
              ctx.translate(cx + cw / 2 + cAcc.dx, cy + cAcc.dy);
              if (cAcc.rot) ctx.rotate(cAcc.rot);
              ctx.scale(cAcc.sx, cAcc.sy);
              if (cAcc.blur + edgeBlur > 0.3) ctx.filter = unitFilter(wAcc.blur + cAcc.blur + edgeBlur);
              paintText(ctx, st, glyph, -cw / 2, 0, fill, Math.max(A.glitch, wAcc.glitch, cAcc.glitch));
            } else {
              if (edgeBlur > 0.3) ctx.filter = unitFilter(totalBlur + edgeBlur);
              paintText(ctx, st, glyph, cx, cy, fill, A.glitch);
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
