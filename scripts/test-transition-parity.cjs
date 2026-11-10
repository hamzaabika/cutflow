// Sprint 6 — the native-xfade parity row, resolved with measurements.
// The preview draws the nine classic transitions two ways: five through CSS shapes
// (transitionStyles in Preview.jsx) that the export renders with FFmpeg's xfade, and
// the rest through the shared expression engine. Whether xfade's maths equals the
// CSS shapes was an open "Needs Investigation" row. Measured on the bundled FFmpeg
// (320x180, frames sampled across the junction):
//
//   fade        xfade is a linear blend with mix factor = progress.        MATCHES
//   wipeleft    B revealed from the right, boundary at (1-p)*W, area = p.  MATCHES
//   wiperight   mirror image of wipeleft.                                  MATCHES
//   slideleft   two-element translate geometry identical to the CSS.       MATCHES
//   slideright  mirror image.                                              MATCHES
//   dissolve    xfade is a per-pixel DITHER (pure-A fraction ~= 1-p, pure-B
//               ~= p, zero blended pixels); the CSS drew a plain blend.    DIVERGED
//   fadeblack   xfade dips on an S-curve: fully black by p ~= 0.17, black
//               hold to ~= 0.33, then B rises non-linearly; the CSS dips in
//               two LINEAR halves (A*(1-2p), then B*(2p-1)).               DIVERGED
//   fadewhite   same S-curve toward white; fully white by p ~= 0.2.        DIVERGED
//   circleopen  xfade is a SOFT radial cosine blend (at p=0.5 the blend
//               factor is 0.5+0.5*cos(pi*d) over the half-diagonal); the
//               CSS is a hard circle of radius p*75%.                      DIVERGED
//
// Verdict: the five matching types stay native (section 1 pins them against the
// real export). The four divergent types moved into the shared engine
// (FX_TRANSITIONS in src/fx/catalog.js): one expression defines them in the
// preview and the export, reproducing the preview's documented shapes — for
// dissolve, the true dither (the CSS blend was indistinguishable from Crossfade;
// xfade's own dither proves the intended look). Section 2 pins the engine parity
// exactly at the segment stage (the artefact the effects pass produces) and at
// the export stage.
//
// Sprint 9 closed the two segment-pipeline softnesses this suite used to
// tolerate (lag window 2 frames, channel-mean tolerance 22):
//   * Colour: segments were stored RGB->ffv1/yuv444p with swscale's DEFAULT
//     (BT.601) matrix and no colour tags, while the export graph tags its
//     output BT.709 — saturated channel means sat up to ~19 off. The store now
//     converts and tags explicitly BT.709 (electron/fxjobs.cjs
//     segmentEncoderArgs, shared by this suite instead of an inline copy).
//   * Alignment: the export file itself was silently re-gridded — the
//     assembled graph's final link carries no frame rate the FFmpeg CLI can
//     read, so its output vsync fell back to 25 fps and re-timed every frame
//     (a 30 fps project came out as a 25 fps file). buildExportArgs now pins
//     the output rate, and the junction frames align at the exact index.
// Measured after the fix (this suite, section 2b): worst channel-mean diff
// 1.08–3.00 at lag 0, so section 2b now pins the exact frame index with a
// tolerance of 6. Section 3 pins the raw xfade behaviours above as the
// investigation record, so the verdict stays checkable.
// Usage: node scripts/test-transition-parity.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const TD = 0.6;
const JSTART = 2 - TD; // junction start (s) in the joined export; first junction frame index = 42
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { runTransition } = await import('../src/fx/run.js');
  const { fxTransition } = await import('../src/fx/catalog.js');
  const { TRANSITIONS } = await import('../src/effects.js');
  const { easeValue } = await import('../src/fx/easing.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-trparity-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const aRed = path.join(dir, 'a-red.mp4');
  const bBlu = path.join(dir, 'b-blu.mp4');
  const aGr = path.join(dir, 'a-grad.mp4');
  const bGr = path.join(dir, 'b-grad.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=0xC81E1E:size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', aRed]);
  gen(['-f', 'lavfi', '-i', `color=c=0x1E1EC8:size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', bBlu]);
  gen(['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', aGr]);
  gen(['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=${FPS}:duration=2:c0=0x102060:c1=0xE0E040:c2=0x40C080:c3=0x8020A0`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', bGr]);
  const media = [];
  for (const [id, p] of [['ra', aRed], ['rb', bBlu], ['ga', aGr], ['gb', bGr]]) media.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });

  const decodeFrames = (file, from, len) => {
    const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
    const size = W * H * 4;
    const frames = [];
    for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
    return frames;
  };
  const meanDiff = (f1, f2) => {
    let s = 0;
    const n = Math.min(f1.length, f2.length);
    for (let i = 0; i < n; i++) s += Math.abs(f1[i] - f2[i]);
    return s / n;
  };
  const meanRGB = (f) => {
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < f.length; i += 4) { r += f[i]; g += f[i + 1]; b += f[i + 2]; }
    const n = f.length / 4;
    return [r / n, g / n, b / n];
  };
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportPair = async (tag, aId, bId, type, fxSegments) => {
    const project = {
      name: 'trparity', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [
        { ...base, id: 'c1', mediaId: aId, in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: bId, in: 0, out: 2, transition: { type, duration: TD } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
      ...(fxSegments ? { fxSegments } : {}),
    };
    const out = path.join(dir, `out-${tag}.mp4`);
    await runExport(project, out, null).promise;
    return out;
  };
  const junction = (file) => decodeFrames(file, JSTART, TD); // 18 frames
  // xfade evaluates progress at each frame's START timestamp, so junction frame k
  // shows p = k / FPS / TD (verified: wipe boundaries land within ~1px of it, while
  // the frame-centre assumption is off by exactly half a frame = ~9px at W=320).
  const pAt = (k) => k / FPS / TD;

  // ---- 1) The five native types: real xfade exports vs the preview's CSS shapes ----
  // fade: on solids the export frame's mean colour is the linear blend (1-p)*A + p*B.
  {
    const out = await exportPair('native-fade', 'ra', 'rb', 'fade', null);
    // Reference colours from the export itself (a pure-A frame before the junction, a
    // pure-B frame after it), so the blend law is isolated from decode-path colour
    // shifts between the suite's decoder and the export's chain (~14 on saturated red).
    const allFrames = decodeFrames(out, 0, 3.4);
    const A = meanRGB(allFrames[30]);
    const B = meanRGB(allFrames[90]);
    let worst = 0;
    for (const k of [3, 8, 13]) {
      const p = pAt(k);
      const m = meanRGB(junction(out)[k]);
      const exp = A.map((v, ch) => (1 - p) * v + p * B[ch]);
      const d = Math.max(...m.map((v, ch) => Math.abs(v - exp[ch])));
      worst = Math.max(worst, d);
      console.log(`native fade frame ${k} (p=${p.toFixed(2)}): mean colour vs blend model, max channel diff ${d.toFixed(2)}`);
    }
    ok(worst <= 8, `native 'fade': xfade export is the preview's linear blend (worst channel diff ${worst.toFixed(2)} <= 8)`);
    ok(!fxTransition('fade'), "'fade' stays native (no engine transition under its id)");
  }
  // wipes: on solids the B area fraction is p and the boundary sits at (1-p)*W / p*W.
  for (const [type, fromLeft] of [['wipeleft', false], ['wiperight', true]]) {
    const out = await exportPair(`native-${type}`, 'ra', 'rb', type, null);
    let worstFrac = 0;
    let worstEdge = 0;
    for (const k of [3, 8, 13]) {
      const p = pAt(k);
      const f = junction(out)[k];
      let bCount = 0;
      let edgeSum = 0;
      let rows = 0;
      for (let y = 0; y < H; y += 6) {
        let first = -1;
        let last = -1;
        for (let x = 0; x < W; x++) {
          const i = (y * W + x) * 4;
          const isB = f[i + 2] > 150 && f[i] < 80;
          if (isB) { bCount += 6; if (first < 0) first = x; last = x; }
        }
        if (first >= 0) { edgeSum += fromLeft ? last + 1 : first; rows++; }
      }
      const frac = bCount / (W * H);
      const edge = rows ? edgeSum / rows : 0;
      const expEdge = fromLeft ? p * W : (1 - p) * W;
      worstFrac = Math.max(worstFrac, Math.abs(frac - p));
      worstEdge = Math.max(worstEdge, Math.abs(edge - expEdge));
      console.log(`native ${type} frame ${k} (p=${p.toFixed(2)}): B fraction ${frac.toFixed(3)} (expect ${p.toFixed(2)}), boundary ${edge.toFixed(1)}px (expect ${expEdge.toFixed(1)})`);
    }
    ok(worstFrac <= 0.06 && worstEdge <= 4, `native '${type}': xfade export matches the preview wipe (fraction err ${worstFrac.toFixed(3)}, boundary err ${worstEdge.toFixed(1)}px)`);
    ok(!fxTransition(type), `'${type}' stays native`);
  }
  // slides: model-compare on the slow gradients pair (the CSS two-element translate
  // geometry), allowing the junction frame a +-1 frame alignment window.
  {
    const aFrames = decodeFrames(aGr, 0, 2);
    const bFrames = decodeFrames(bGr, 0, 2);
    const slideModel = (type, p, fa, fb) => {
      const out = Buffer.alloc(W * H * 4);
      const sample = (f, x, y) => (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let src; let si;
          if (type === 'slideleft') { if (x < (1 - p) * W) { src = fa; si = sample(fa, x + p * W, y); } else { src = fb; si = sample(fb, x - (1 - p) * W, y); } }
          else { if (x >= p * W) { src = fa; si = sample(fa, x - p * W, y); } else { src = fb; si = sample(fb, x + (1 - p) * W, y); } }
          const o = (y * W + x) * 4;
          out[o] = src[si]; out[o + 1] = src[si + 1]; out[o + 2] = src[si + 2]; out[o + 3] = 255;
        }
      }
      return out;
    };
    for (const type of ['slideleft', 'slideright']) {
      const out = await exportPair(`native-${type}`, 'ga', 'gb', type, null);
      const frames = junction(out);
      let worst = Infinity;
      for (const k of [3, 8, 13]) {
        let best = Infinity;
        for (const dk of [-1, 0, 1]) {
          const kk = k + dk;
          const p = pAt(kk);
          const fa = aFrames[Math.min(aFrames.length - 1, Math.round((JSTART + kk / FPS) * FPS))];
          const fb = bFrames[Math.min(bFrames.length - 1, kk)];
          best = Math.min(best, meanDiff(frames[k], slideModel(type, p, fa, fb)));
        }
        worst = Math.min(worst === Infinity ? best : worst, best);
        console.log(`native ${type} frame ${k}: export vs slide model (best alignment) ${best.toFixed(3)}`);
        ok(best <= 10, `native '${type}' frame ${k}: xfade export matches the preview slide geometry within 10`);
      }
      ok(!fxTransition(type), `'${type}' stays native`);
    }
  }

  // ---- 2) The four unified types: ONE engine definition, segment == reference ----
  const previewSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Preview.jsx'), 'utf8');
  const segFramesA = decodeFrames(aRed, 2 - TD, TD);
  const segFramesB = decodeFrames(bBlu, 0, TD);
  const renderSegment = async (id) => {
    const t = fxTransition(id);
    const frames = Math.max(1, Math.round(TD * FPS));
    const seg = path.join(dir, `seg-${id}.mkv`);
    // The app's shared segment recipe (electron/fxjobs.cjs segmentEncoderArgs) —
    // before Sprint 9 this suite copied the args inline and measured its own copy.
    const enc = spawn(ffmpegPath, segmentEncoderArgs(seg, W, H, FPS), { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`segment encoder ${c}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    const refs = [];
    for (let k = 0; k < frames; k++) {
      const out = new Uint8ClampedArray(W * H * 4);
      runTransition(segFramesA[Math.min(k, segFramesA.length - 1)], segFramesB[Math.min(k, segFramesB.length - 1)], out, W, H, easeValue(undefined, k / FPS / TD), t.expr);
      refs.push(Buffer.from(out));
      if (!enc.stdin.write(Buffer.from(out))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    return { seg, refs };
  };
  for (const type of ['dissolve', 'fadeblack', 'fadewhite', 'circleopen']) {
    const entry = TRANSITIONS.find((t) => t.id === type);
    ok(!!fxTransition(type) && entry && entry.fx === true, `'${type}' is a shared-engine transition now`);
    ok(!previewSrc.includes(`case '${type}'`), `'${type}' has no CSS shape left in the preview (single definition)`);
    const { seg, refs } = await renderSegment(type);
    // (a) The segment artefact vs the CPU reference of the same expression: exact.
    const segFrames = decodeFrames(seg, 0, TD);
    let worstSeg = 0;
    for (const k of [3, 8, 13]) worstSeg = Math.max(worstSeg, meanDiff(segFrames[k], refs[k]));
    console.log(`unified ${type}: segment vs engine reference, worst frame diff ${worstSeg.toFixed(3)}`);
    ok(worstSeg <= 1.5, `unified '${type}': rendered segment matches the engine reference within 1.5`);
    // (b) The final export vs the segment: same progression of frame mean
    // colours at the EXACT frame index. Sprint 9 closed the two softnesses
    // that used to force a lag window and a loose tolerance here (see the
    // header): measured worst diff after the fix is 3.00, pinned at 6.
    const out = await exportPair(`fx-${type}`, 'ra', 'rb', type, { c2: seg });
    const expFrames = junction(out);
    let worstMean = 0;
    for (let k = 0; k < 18; k++) {
      const em = meanRGB(expFrames[k]);
      const sm = meanRGB(segFrames[Math.min(k, segFrames.length - 1)]);
      worstMean = Math.max(worstMean, Math.max(...em.map((v, ch) => Math.abs(v - sm[ch]))));
    }
    console.log(`unified ${type}: export vs segment frame means, worst channel diff at exact index ${worstMean.toFixed(2)}`);
    ok(worstMean <= 6, `unified '${type}': export carries the segment's progression (worst mean diff ${worstMean.toFixed(2)} <= 6)`);
  }
  // 71 through Sprint 11; Sprint 12 grew the studio set by four originals
  // (Clock Wipe, Band Wipe, Zoom Through, Spin Fall) — the pin moves WITH the
  // catalogue on purpose: it exists to catch accidental loss, not growth.
  // 75 through Sprint 12; 111 after the 10/10 step-3 library growth (+36 GROWTH_TRANSITIONS).
  ok(TRANSITIONS.length === 111, `transition catalogue totals 111 entries (got ${TRANSITIONS.length})`);

  // ---- 3) Investigation record: what raw xfade ACTUALLY does with the four ----
  const xfadeRaw = (type, p) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error',
    '-i', aRed, '-i', bBlu,
    '-filter_complex', `[0:v]settb=1/${FPS}[x0];[1:v]settb=1/${FPS}[x1];[x0][x1]xfade=transition=${type}:duration=${TD}:offset=${JSTART},format=rgb24[v]`,
    '-map', '[v]', '-ss', String(JSTART + p * TD), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
  { maxBuffer: 1 << 24 });
  const classify = (buf) => {
    let pureA = 0; let pureB = 0; let blend = 0; let lum = 0;
    for (let i = 0; i < buf.length; i += 3) {
      const r = buf[i]; const b = buf[i + 2];
      lum += (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      if (r > 150 && b < 80) pureA++;
      else if (b > 150 && r < 80) pureB++;
      else blend++;
    }
    const n = buf.length / 3;
    return { pureA: pureA / n, pureB: pureB / n, blend: blend / n, lum: lum / n };
  };
  const dis = classify(xfadeRaw('dissolve', 0.5));
  console.log(`record: xfade dissolve @0.5 -> pureA ${dis.pureA.toFixed(2)}, pureB ${dis.pureB.toFixed(2)}, blended ${dis.blend.toFixed(2)}`);
  ok(dis.pureA > 0.3 && dis.pureB > 0.3 && dis.blend < 0.35, 'record: xfade dissolve is a dither, not the blend the CSS drew');
  const fb = classify(xfadeRaw('fadeblack', 0.25));
  console.log(`record: xfade fadeblack @0.25 -> mean luminance ${fb.lum.toFixed(1)} (the preview's linear dip would read ~half of A's ~87)`);
  ok(fb.lum < 20, 'record: xfade fadeblack is already near-black at p=0.25 (S-curve dip, not two linear halves)');
  const co = classify(xfadeRaw('circleopen', 0.5));
  console.log(`record: xfade circleopen @0.5 -> blended fraction ${co.blend.toFixed(2)} (a hard circle would blend ~0)`);
  ok(co.blend > 0.25, 'record: xfade circleopen is a soft radial blend, not the preview hard circle (which would blend < 0.05)');

  if (fails.length) { console.error(`TRANSITION PARITY FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('TRANSITION PARITY OK — 5 native types pinned to xfade, 4 divergent types unified in the shared engine');
})().catch((e) => { console.error('TRANSITION PARITY FAIL:', e.message); process.exit(1); });
