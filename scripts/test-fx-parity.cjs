// Sprint 6 parity proof — clip.adjust and the six classic effects.
// Before this sprint a plain clip's look had THREE engines: CSS filters in the preview,
// FFmpeg look-filter approximations in the export (eq with the brightness halved,
// boxblur scaled differently, noise=alls=18, vignette=PI/4), and shader forms used only
// when an instance carried a region / timing window / strength. The preview also lost
// the look entirely whenever its canvas path drew the clip (CSS on the hidden media
// element never reaches the canvas). The unification gives every look ONE engine: the
// shader passes of pixelPasses (src/fx/adjust.js for adjust, TRACK_CLASSIC for the
// classics), drawn by the preview's WebGL, the export's effects pass and the CPU
// reference of the same expression language.
//
// This suite pins, with numbers:
//   1. adjustExpr implements the CSS filter semantics the settings were authored
//      against (independent JS implementation of brightness/contrast/saturate/
//      hue-rotate), so the unified engine keeps the preview's promised meaning.
//   2. adjust blur uses the historical export radius scaling round(px * W / 640) with
//      the classic 9-tap kernel.
//   3. Routing: an adjust-only or classic-only clip now HAS shader passes and is
//      claimed by the effects pass (clipHasPixelFx); pass order is adjust first.
//   4. The export graph paints no look itself any more (no eq / hue / boxblur /
//      noise / vignette / hflip / vflip in buildExportArgs output).
//   5. Rendered parity: frames rendered through the passes (the fx-pass override
//      file) match the CPU reference within 1.5 mean abs, and the final export
//      matches the override within codec tolerance (3) — for adjust and for every
//      classic effect, plain (untimed, unregioned, full strength) instances included.
//      Sprint 9 tightened the tolerance from 5: the segment store's BT.601 colour
//      shift and the export's silent 25 fps re-grid (see test-transition-parity's
//      header) used to put the export 3.6–4.9 off the reference; measured after
//      the fix, adjust reads ~0.8–0.9 and the classics ~0.8–1.9 (grain worst;
//      small run-to-run variance from the encoder's threading).
// Usage: node scripts/test-fx-parity.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport, buildExportArgs } = require('../electron/ffmpeg.cjs');
const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const LEN = 1.2;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { runEffect } = await import('../src/fx/run.js');
  const { pixelPasses, clipHasPixelFx } = await import('../src/fx/apply.js');
  const { adjustExpr, hasAdjust } = await import('../src/fx/adjust.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxparity-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const grad = path.join(dir, 'grad.mp4'); // smooth colour gradients: colour math exercised, codec-friendly
  const det = path.join(dir, 'det.mp4'); // detailed pattern for blur / pixel / grain
  gen(['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', grad]);
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', det]);
  const media = [];
  for (const [id, p] of [['mg', grad], ['md', det]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });

  const decodeFrames = (file, from, len) => {
    const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
    const size = W * H * 4;
    const frames = [];
    for (let o = 0; o + size <= raw.length; o += size) frames.push(Buffer.from(raw.subarray(o, o + size)));
    return frames;
  };
  const meanDiff = (f1, f2) => {
    let s = 0;
    const n = Math.min(f1.length, f2.length);
    for (let i = 0; i < n; i++) s += Math.abs(f1[i] - f2[i]);
    return s / n;
  };
  const applyPasses = (frame, passes, lt) => {
    let cur = frame;
    for (const p of passes) {
      const out = new Uint8ClampedArray(W * H * 4);
      runEffect(cur, out, W, H, lt, p.expr);
      cur = Buffer.from(out);
    }
    return cur;
  };

  // ---- 1) adjustExpr == the CSS filter mathematics (independent implementation) ----
  const cssAdjust = (frame, a) => {
    const out = Buffer.alloc(frame.length);
    const co = Math.cos((a.hue * Math.PI) / 180);
    const si = Math.sin((a.hue * Math.PI) / 180);
    const s = a.saturation;
    const sat = [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    const hueM = [
      [0.213 + 0.787 * co - 0.213 * si, 0.715 - 0.715 * co - 0.715 * si, 0.072 - 0.072 * co + 0.928 * si],
      [0.213 - 0.213 * co + 0.143 * si, 0.715 + 0.285 * co + 0.140 * si, 0.072 - 0.072 * co - 0.283 * si],
      [0.213 - 0.213 * co - 0.787 * si, 0.715 - 0.715 * co + 0.715 * si, 0.072 + 0.928 * co + 0.072 * si],
    ];
    for (let i = 0; i < frame.length; i += 4) {
      let rgb = [frame[i] / 255, frame[i + 1] / 255, frame[i + 2] / 255];
      rgb = rgb.map((v) => v * (1 + a.brightness));
      rgb = rgb.map((v) => (v - 0.5) * a.contrast + 0.5);
      rgb = sat.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
      rgb = hueM.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
      for (let ch = 0; ch < 3; ch++) out[i + ch] = Math.round(Math.min(1, Math.max(0, rgb[ch])) * 255);
      out[i + 3] = frame[i + 3];
    }
    return out;
  };
  const adjSet = { brightness: 0.2, contrast: 1.3, saturation: 0.6, hue: 40, blur: 0 };
  const gFrame = decodeFrames(grad, 0.5, 0.04)[0];
  const viaExpr = applyPasses(gFrame, [{ expr: adjustExpr(adjSet) }], 0);
  const viaCss = cssAdjust(gFrame, adjSet);
  const dCss = meanDiff(viaExpr, viaCss);
  console.log(`adjust expression vs CSS reference: mean abs diff ${dCss.toFixed(3)}`);
  ok(dCss <= 1.5, 'adjustExpr matches the CSS filter semantics within 1.5 mean abs');

  // ---- 2) adjust blur: 9-tap kernel, radius round(px * W / 640) ----
  const dFrame = decodeFrames(det, 0.5, 0.04)[0];
  const jsBlur = (frame, r) => {
    const out = Buffer.alloc(frame.length);
    const at = (x, y, ch) => frame[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + ch];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let ch = 0; ch < 3; ch++) {
      const v = (at(x, y, ch) * 2 + at(x + r, y, ch) + at(x - r, y, ch) + at(x, y + r, ch) + at(x, y - r, ch)
        + at(x + r, y + r, ch) + at(x - r, y - r, ch) + at(x + r, y - r, ch) + at(x - r, y + r, ch)) / 10;
      out[(y * W + x) * 4 + ch] = Math.round(v);
    }
    for (let i = 3; i < frame.length; i += 4) out[i] = 255;
    return out;
  };
  const blurExprOut = applyPasses(dFrame, [{ expr: adjustExpr({ blur: 10 }) }], 0);
  const dBlur = meanDiff(blurExprOut, jsBlur(dFrame, Math.round(10 * W / 640)));
  console.log(`adjust blur (10px at W=320, radius 5) vs JS kernel: mean abs diff ${dBlur.toFixed(3)}`);
  ok(dBlur <= 1.5, 'adjust blur is the 9-tap kernel at radius round(px * W / 640)');

  // ---- 3) Routing + order ----
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const projOf = (clip) => ({
    name: 'fxparity', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
    videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  ok(!hasAdjust({ adjust: {} }) && adjustExpr({}) === null, 'default adjust: no pass, no expression');
  const adjClip = { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN, adjust: { ...adjSet } };
  ok(clipHasPixelFx(projOf(adjClip), adjClip), 'an adjust-only clip is claimed by the effects pass');
  const withFx = { ...adjClip, effects: ['grain'] };
  const ordered = pixelPasses(projOf(withFx), withFx, 0, 0.5);
  ok(ordered.length === 2 && ordered[0].expr === adjustExpr(adjSet), 'pass order: adjust first, effects after');
  for (const id of ['blur', 'grain', 'vignette', 'pixel', 'mirror', 'flipv']) {
    const c = { ...base, id: 'c1', mediaId: 'md', in: 0, out: LEN, effects: [id] };
    ok(clipHasPixelFx(projOf(c), c) && pixelPasses(projOf(c), c, 0, 0.5).length === 1, `plain classic '${id}': exactly one shader pass, claimed by the fx pass`);
  }

  // ---- 4) The export graph paints no look itself ----
  const lookClip = { ...base, id: 'c1', mediaId: 'md', in: 0, out: LEN, adjust: { brightness: 0.3, contrast: 1.2, saturation: 0.5, hue: 30, blur: 4 }, effects: ['blur', 'grain', 'vignette', 'pixel', 'mirror', 'flipv'] };
  const graph = buildExportArgs(projOf(lookClip), path.join(dir, 'x.mp4')).args.join(' ');
  for (const legacy of ['eq=', 'hue=h=', 'boxblur', 'noise=alls', 'vignette=', 'hflip', 'vflip']) {
    ok(!graph.includes(legacy), `export graph contains no legacy look filter '${legacy}'`);
  }

  // ---- 5) Rendered parity: CPU reference vs fx-pass override vs final export ----
  const renderOverride = async (clip, srcFile) => {
    const proj = projOf(clip);
    const frames = decodeFrames(srcFile, clip.in, LEN);
    const out = path.join(dir, `ov-${clip.id}-${Math.random().toString(36).slice(2, 8)}.mkv`);
    // The app's shared segment recipe (electron/fxjobs.cjs segmentEncoderArgs).
    const enc = spawn(ffmpegPath, segmentEncoderArgs(out, W, H, FPS), { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`override encoder ${c}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    const n = Math.round(LEN * FPS);
    for (let k = 0; k < n; k++) {
      const f = frames[Math.min(k, frames.length - 1)];
      const passes = pixelPasses(proj, clip, 0, k / FPS);
      const drawn = passes.length ? applyPasses(f, passes, k / FPS) : f;
      if (!enc.stdin.write(Buffer.from(drawn))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    return { file: out, frames };
  };
  const frameAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 24 });

  const cases = [
    ['adjust (all five settings)', { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN, adjust: { brightness: 0.15, contrast: 1.25, saturation: 0.7, hue: 35, blur: 3 } }, grad],
    ...['blur', 'grain', 'vignette', 'pixel', 'mirror', 'flipv'].map((id) => [`classic ${id}`, { ...base, id: 'c1', mediaId: 'md', in: 0, out: LEN, effects: [id] }, det]),
  ];
  const midK = Math.floor(LEN * FPS / 2);
  for (const [name, clip, srcFile] of cases) {
    // Stage 1 — the fx-pass override vs the CPU reference, on the case's own content
    // (detailed testsrc2 for the classics: the harshest input).
    const { file, frames } = await renderOverride(clip, srcFile);
    const proj = projOf(clip);
    const expected = applyPasses(frames[midK], pixelPasses(proj, clip, 0, midK / FPS), midK / FPS);
    const dOv = meanDiff(frameAt(file, midK / FPS), expected);
    console.log(`${name}: override vs CPU ${dOv.toFixed(3)}`);
    ok(dOv <= 1.5, `${name}: fx-pass override matches the CPU reference within 1.5`);
    // Stage 2 — the final export vs the CPU reference. Run on the smooth gradients
    // source: on testsrc2 the x264 stage alone costs ~7 mean abs against ANY lossless
    // reference (measured on a pure mirror flip, whose correct answer is exact), which
    // would drown the parity signal; smooth content isolates the encode (<= ~2) while
    // every look still changes the picture measurably (presence guard below).
    const gClip = { ...clip, mediaId: 'mg' };
    const g = await renderOverride(gClip, grad);
    const gProj = projOf(gClip);
    const gExpected = applyPasses(g.frames[midK], pixelPasses(gProj, gClip, 0, midK / FPS), midK / FPS);
    // The baked project, exactly as src/fxExport.js produces it: look stripped, override in place.
    const baked = { ...gProj, videoClips: [{ ...gClip, adjust: {}, effects: [], videoOverride: { file: g.file, start: 0, end: LEN } }] };
    const outFile = path.join(dir, `out-${name.replace(/[^a-z0-9]+/gi, '_')}.mp4`);
    await runExport(baked, outFile, null).promise;
    const expFrame = frameAt(outFile, midK / FPS);
    const dExp = meanDiff(expFrame, gExpected);
    const dPresence = meanDiff(expFrame, g.frames[midK]);
    console.log(`${name}: export vs CPU ${dExp.toFixed(3)}, export vs unprocessed source ${dPresence.toFixed(3)}`);
    ok(dExp <= 3, `${name}: final export matches the CPU reference within codec tolerance 3`);
    // Presence guard threshold recalibrated 0.8 → 0.5 (R4 battery, 2026-11-10): the 0.8 was set
    // while the segment store's untagged BT.601 conversion (fixed in Sprint 9) inflated every
    // export-vs-source difference — blur measured 2.21/2.49 in the Sprint 7/8 batteries on that
    // bug's colour shift alone. Post-fix, blur's true presence on this smooth-gradients source is
    // 0.735–0.875 across runs (encoder threading moves it), while a silently dropped look would
    // measure ≈0 (encode noise only). 0.5 stays far above the dropped floor and below the true
    // range; the binding parity proof is dExp above, which sits at 0.72–0.85 for this case.
    ok(dPresence > 0.5, `${name}: the look is measurably present in the export (not silently dropped)`);
  }

  if (fails.length) { console.error(`FX PARITY FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('FX PARITY OK — one engine for adjust + classics; preview expression == export picture');
})().catch((e) => { console.error('FX PARITY FAIL:', e.message); process.exit(1); });
