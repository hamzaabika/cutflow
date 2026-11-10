// Generates the library tiles' still thumbnails (10/10 step 5): every pixel
// effect, engine + classic transition, filter look and bundled LUT is rendered
// ONCE, here, by the app's own machinery — the CPU reference renderer
// (src/fx/run.js, the same expression engine the preview and the export parity
// suites use) over one standard sample frame pair (the bundled preview photos
// p1015/p1025, cover-cropped) — and cached as compact JPEGs in
// public/fxthumbs/. The renderer (src/fx/thumbIndex.js) maps each catalogue id
// to its still; FxThumb/LookThumb paint the still and keep the live canvas
// only for hover animation (FxThumb) and for content with no still.
//
// What has NO still, by design:
//   · overlay effects — they are 2D canvas paintings (ov.draw(ctx)), not pixel
//     expressions; there is no headless rasteriser for them in the repo, and
//     their live canvas IS a real render of the effect, not a placeholder.
//   · user-imported LUTs (paths, not bundled files) — LookThumb renders those
//     live through the GL pass as before.
//
// The classic transitions (fade/wipe/slide) and the six basic effects
// (mirror/flipv/blur/pixel/vignette/grain) are buffer operations here with the
// same geometry the canvas preview draws (src/fx/previews.jsx).
//
// Usage: node scripts/gen-fx-thumbs.mjs   (re-running reproduces the same set)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..');
const ff = require('../electron/ffmpeg.cjs');
const { runEffect, runTransition } = await import('../src/fx/run.js');
const { PIXEL_EFFECTS, OVERLAY_EFFECTS, FX_TRANSITIONS } = await import('../src/fx/catalog.js');
const { EFFECTS, TRANSITIONS, FILTERS } = await import('../src/effects.js');
const { filterExpr } = await import('../src/fx/filters.js');
const { BUNDLED_LUTS, parseCube } = await import('../src/fx/lut.js');

const W = 192;
const H = 108;
const OUT_DIR = path.join(root, 'public', 'fxthumbs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const decode = (file) => execFileSync(ff.ffmpegPath, [
  '-hide_banner', '-loglevel', 'error', '-i', path.join(root, 'public', 'preview', file),
  '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
  '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-',
], { maxBuffer: 1 << 28 });
const A = decode('p1015.jpg');
const B = decode('p1025.jpg');
if (A.length !== W * H * 4 || B.length !== W * H * 4) throw new Error('sample frame decode failed');

const encode = (buf, name) => {
  execFileSync(ff.ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
    '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', '-q:v', '4', '-y', path.join(OUT_DIR, name),
  ], { input: Buffer.from(buf) });
};

const manifest = {};
const put = (key, name, buf) => { encode(buf, name); manifest[key] = `./fxthumbs/${name}`; };
const out = new Uint8Array(W * H * 4);
const px = (buf, x, y) => (y * W + x) * 4;
const clampI = (v, m) => Math.min(m - 1, Math.max(0, Math.trunc(v)));

// ---- Pixel effects: the real expression at the still's T (0.9 s, as the tile) ----
for (const e of PIXEL_EFFECTS) {
  runEffect(A, out, W, H, 0.9, e.expr);
  put(`effect:${e.id}`, `fx-${e.id}.jpg`, out);
}

// ---- The six basic effects: the canvas preview's own operations, on buffers ----
const rnd = (n) => { const s = Math.sin(n * 91.345 + 12.7) * 43758.5453; return s - Math.floor(s); };
const basics = {
  mirror() { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = px(A, W - 1 - x, y); const d = px(out, x, y); for (let c = 0; c < 4; c++) out[d + c] = A[s + c]; } },
  flipv() { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const s = px(A, x, H - 1 - y); const d = px(out, x, y); for (let c = 0; c < 4; c++) out[d + c] = A[s + c]; } },
  blur() {
    const R = 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let n = 0; const acc = [0, 0, 0];
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const s = px(A, clampI(x + dx, W), clampI(y + dy, H));
        for (let c = 0; c < 3; c++) acc[c] += A[s + c];
        n++;
      }
      const d = px(out, x, y);
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(acc[c] / n);
      out[d + 3] = 255;
    }
  },
  pixel() {
    const block = Math.max(2, Math.round(W / 12));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = px(A, Math.floor(x / block) * block, Math.floor(y / block) * block);
      const d = px(out, x, y);
      for (let c = 0; c < 4; c++) out[d + c] = A[s + c];
    }
  },
  vignette() {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = px(out, x, y); const s = px(A, x, y);
      const dist = Math.hypot(x - W / 2, y - H / 2) / (W * 0.62);
      const f = dist <= 0.4 ? 1 : Math.max(0.15, 1 - 0.85 * Math.min(1, (dist - 0.4) / 0.6));
      for (let c = 0; c < 3; c++) out[d + c] = Math.round(A[s + c] * f);
      out[d + 3] = 255;
    }
  },
  grain() {
    const f = Math.floor(0.9 * 24);
    for (let i = 0; i < A.length; i += 4) {
      const n = (rnd(i * 0.13 + f * 7.7) - 0.5) * 50;
      for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.max(0, A[i + c] + n));
      out[i + 3] = 255;
    }
  },
};
const pixelIds = new Set(PIXEL_EFFECTS.map((e) => e.id));
const overlayIds = new Set(OVERLAY_EFFECTS.map((e) => e.id));
for (const e of EFFECTS) {
  if (pixelIds.has(e.id) || overlayIds.has(e.id)) continue;
  if (!basics[e.id]) throw new Error(`basic effect ${e.id} has no buffer implementation in the generator`);
  basics[e.id]();
  put(`effect:${e.id}`, `fx-${e.id}.jpg`, out);
}

// ---- Transitions: engine expressions at the still's P; classics as buffers ----
for (const t of FX_TRANSITIONS) {
  const P = /^fade(black|white)$/.test(t.id) ? 0.3 : 0.5;
  runTransition(A, B, out, W, H, P, t.expr);
  put(`transition:${t.id}`, `tr-${t.id}.jpg`, out);
}
const blendPx = (x, y, srcBuf, sx, sy) => {
  const s = px(srcBuf, clampI(sx, W), clampI(sy, H));
  const d = px(out, x, y);
  for (let c = 0; c < 4; c++) out[d + c] = srcBuf[s + c];
};
const classics = {
  fade(p) { for (let i = 0; i < A.length; i++) out[i] = Math.round(A[i] * (1 - p) + B[i] * p); },
  wipeleft(p) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) blendPx(x, y, x >= W * (1 - p) ? B : A, x, y); },
  wiperight(p) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) blendPx(x, y, x < W * p ? B : A, x, y); },
  slideleft(p) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x < W * (1 - p)) blendPx(x, y, A, x + W * p, y); else blendPx(x, y, B, x - W * (1 - p), y); } },
  slideright(p) { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x >= W * p) blendPx(x, y, A, x - W * p, y); else blendPx(x, y, B, x + W * (1 - p), y); } },
};
const fxTrIds = new Set(FX_TRANSITIONS.map((t) => t.id));
for (const t of TRANSITIONS) {
  if (fxTrIds.has(t.id)) continue;
  if (!classics[t.id]) throw new Error(`classic transition ${t.id} has no buffer implementation in the generator`);
  classics[t.id](0.5);
  put(`transition:${t.id}`, `tr-${t.id}.jpg`, out);
}

// ---- Filter looks: the filter's own expression over the sample frame ----
for (const f of FILTERS) {
  const e = filterExpr({ filter: f.id });
  if (e) { runEffect(A, out, W, H, 0.5, e); put(`filter:${f.id}`, `flt-${f.id}.jpg`, out); }
  else put(`filter:${f.id}`, `flt-${f.id}.jpg`, A); // 'none' — the plain frame IS its preview
}

// ---- Bundled LUTs: trilinear sampling of the parsed cube over the frame ----
const sampleLut = (lut, r, g, b) => {
  const S = lut.size;
  const d = lut.data;
  const fx = r * (S - 1); const fy = g * (S - 1); const fz = b * (S - 1);
  const x0 = Math.min(S - 2, Math.floor(fx)); const y0 = Math.min(S - 2, Math.floor(fy)); const z0 = Math.min(S - 2, Math.floor(fz));
  const xf = fx - x0; const yf = fy - y0; const zf = fz - z0;
  const res = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    let v = 0;
    for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
      const wgt = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
      v += wgt * d[(((y0 + dy) * S + (z0 + dz)) * S + (x0 + dx)) * 4 + c];
    }
    res[c] = v;
  }
  return res;
};
for (const l of BUNDLED_LUTS) {
  const lut = parseCube(fs.readFileSync(path.join(root, 'shared', 'luts', l.file), 'utf8'));
  for (let i = 0; i < A.length; i += 4) {
    const [r, g, b] = sampleLut(lut, A[i] / 255, A[i + 1] / 255, A[i + 2] / 255);
    out[i] = Math.round(r); out[i + 1] = Math.round(g); out[i + 2] = Math.round(b); out[i + 3] = 255;
  }
  put(`lut:${l.file}`, `lut-${l.file.replace(/\.cube$/, '')}.jpg`, out);
}

// ---- The index the renderer reads ----
const keys = Object.keys(manifest).sort();
const body = keys.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(manifest[k])},`).join('\n');
fs.writeFileSync(path.join(root, 'src', 'fx', 'thumbIndex.js'),
  `// GENERATED by scripts/gen-fx-thumbs.mjs — do not hand-edit.\n`
  + `// Still thumbnails for the library grids: each entry is a real render of\n`
  + `// Cutflow's own effect / transition / filter / LUT over the standard sample\n`
  + `// frame, produced by the app's CPU reference renderer at generation time.\n`
  + `// Overlay effects are absent on purpose (2D canvas paintings — their tile\n`
  + `// stays the live canvas, which is itself a real render).\n`
  + `export const FX_THUMB = {\n${body}\n};\n`);
const bytes = keys.reduce((a, k) => a + fs.statSync(path.join(root, 'public', manifest[k].replace('./', ''))).size, 0);
console.log(`fx thumbs: ${keys.length} stills (${keys.filter((k) => k.startsWith('effect:')).length} effects, ${keys.filter((k) => k.startsWith('transition:')).length} transitions, ${keys.filter((k) => k.startsWith('filter:')).length} filters, ${keys.filter((k) => k.startsWith('lut:')).length} LUTs), ${(bytes / 1024).toFixed(0)} KB total`);
