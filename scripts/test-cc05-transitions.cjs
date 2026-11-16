// CC-05 true transitions: Smooth Push Right, Directional Blur Reveal,
// RGB Split Cut, Bloom Flash — plus verification (not rebuilds) of Smooth
// Push Left and Luma Wipe softness. Pins, per transition, on the CPU
// reference renderer (src/fx/run.js, the same expression engine the preview
// and the export share):
//   first frame is exactly A, last frame exactly B, mid frame carries the
//   named look; then one real export per new transition family proves the
//   export carries the same progression (segment == reference, export ==
//   segment at the exact frame index, the test-transition-parity §2 pattern).
// Usage: node scripts/test-cc05-transitions.cjs
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
const JSTART = 2 - TD;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { runTransition } = await import('../src/fx/run.js');
  const { fxTransition } = await import('../src/fx/catalog.js');
  const { TRANSITIONS } = await import('../src/effects.js');
  const { transitionExpr, mergeTrParams } = await import('../src/fx/params.js');
  const { easeValue } = await import('../src/fx/easing.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cc05-'));
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
    for (let o = 0; o + size <= raw.length; o += size) frames.push(Buffer.from(raw.subarray(o, o + size)));
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
  const meanLum = (f) => {
    let s = 0;
    for (let i = 0; i < f.length; i += 4) s += 0.299 * f[i] + 0.587 * f[i + 1] + 0.114 * f[i + 2];
    return s / (f.length / 4);
  };
  const frame = (a, b, P, exprSrc) => {
    const out = new Uint8ClampedArray(W * H * 4);
    runTransition(a, b, out, W, H, P, exprSrc);
    return out;
  };
  // Solid red / solid blue frames (decoded, so the reference is the real media).
  const redF = decodeFrames(aRed, 0, 0.1)[0];
  const bluF = decodeFrames(bBlu, 0, 0.1)[0];
  // Two DISTINCT test charts (same geometry, rotated channels — NOT inverses:
  // an inverted pair makes any linear blur cancel out of a crossfade, and the
  // lavfi gradients source has near-constant luma, which starves the luma
  // wipe's metric). The charts carry sharp edges in both axes, so directional
  // blur, channel split and wipe softness are all measurable.
  const chart = (hue) => {
    const src = new Uint8ClampedArray(W * H * 4);
    const cell = Math.round(W / 16);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r = 40 + x * 0.9 + y * 0.35, g = 200 - x * 0.55 + y * 0.45, b = 90 + y * 1.2 - x * 0.25;
      const blob = Math.max(0, 1 - Math.hypot(x - W / 4, y - H * 0.3) / (W / 5));
      r += blob * 120; g += blob * 40; b -= blob * 30;
      if (x >= W * 0.58) { const c = ((x - W * 0.58) / cell | 0) + (y / cell | 0); if (c % 2) { r = 235; g = 30; b = 60; } else { r = 25; g = 210; b = 225; } }
      if (y >= H * 0.7 && y < H * 0.85) { const s = (x / (W / 24) | 0) % 2; r = s ? 245 : 35; g = s ? 225 : 45; b = s ? 60 : 190; }
      const ch = [r, g, b];
      src[i] = Math.max(0, Math.min(255, ch[hue % 3]));
      src[i + 1] = Math.max(0, Math.min(255, ch[(hue + 1) % 3]));
      src[i + 2] = Math.max(0, Math.min(255, ch[(hue + 2) % 3]));
      src[i + 3] = 255;
    }
    return src;
  };
  const chA = chart(0);
  const chB = chart(1);
  // The CPU-reference sections use the deterministic charts, not decoded
  // lavfi gradients: the gradients source re-randomises every run (its seed
  // option does not stabilise the output), which made the rgb-split metric
  // swing 0.15–1.19 against a 0.5 bar. The ga/gb media files are still
  // generated above — the export section needs real media.
  const gradA = chA;
  const gradB = chB;
  // Plain crossfade model (alpha 255 — runTransition always writes opaque).
  const cross = (a, b, P) => {
    const out = Buffer.alloc(W * H * 4);
    for (let i = 0; i < out.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) out[i + ch] = Math.round(a[i + ch] * (1 - P) + b[i + ch] * P);
      out[i + 3] = 255;
    }
    return out;
  };

  // ---- 0) Catalogue: the four new transitions, count 119 -> 123 ----
  // 130 on the merged tree: 123 after CC-05, +1 Card Flip (gap-b), +6 gap-c.
  ok(TRANSITIONS.length === 130, `transition catalogue totals 130 entries (got ${TRANSITIONS.length})`);
  for (const [id, name] of [['fx_pushsmoothright', 'Smooth Push Right'], ['fx_blurreveal', 'Directional Blur Reveal'],
    ['fx_rgbsplitcut', 'RGB Split Cut'], ['fx_bloomflash', 'Bloom Flash']]) {
    const t = fxTransition(id);
    const listed = TRANSITIONS.find((x) => x.id === id);
    ok(!!t && listed && listed.fx === true && listed.name === name, `'${name}' (${id}) is a shared-engine transition`);
  }

  // ---- 1) First / last frame exactness for all four (solids), mid-frame
  // distinctness on the charts (a channel split / blur is invisible on flat
  // colour, so solids cannot prove the mid frame).
  for (const id of ['fx_pushsmoothright', 'fx_blurreveal', 'fx_rgbsplitcut', 'fx_bloomflash']) {
    const expr = transitionExpr({ type: id });
    ok(meanDiff(frame(redF, bluF, 0, expr), redF) === 0, `${id}: P=0 is exactly A`);
    ok(meanDiff(frame(redF, bluF, 1, expr), bluF) === 0, `${id}: P=1 is exactly B`);
    const mid = frame(chA, chB, 0.5, expr);
    ok(meanDiff(mid, chA) > 1 && meanDiff(mid, chB) > 1, `${id}: mid frame is neither A nor B`);
  }

  // ---- 2) Smooth Push Right: a rightward slide, B entering from the left ----
  {
    const expr = transitionExpr({ type: 'fx_pushsmoothright' });
    const mid = frame(redF, bluF, 0.5, expr);
    let bLeft = 0; let bRight = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      const isB = mid[i + 2] > 150 && mid[i] < 80;
      if (x < W / 2 && isB) bLeft++;
      if (x >= W / 2 && isB) bRight++;
    }
    console.log(`push-right mid: B pixels left half ${bLeft}, right half ${bRight}`);
    ok(bLeft > bRight * 4, 'push-right mid: B has entered from the left (left half mostly B)');
    // The blur is velocity-coupled: each clip is motion-blurred along the
    // travel (the seam itself stays hard by construction — the blur never
    // crosses it). On textured content the mid frame is far from the same
    // slide with no blur; on solids the two agree exactly.
    const hardExpr = 'st(0, smooth(0, 1, P)); st(1, W*ld(0)); if(gte(X, ld(1)), A(X-ld(1), Y), B(X+W-ld(1), Y))';
    const dBlur = meanDiff(frame(chA, chB, 0.5, expr), frame(chA, chB, 0.5, hardExpr));
    console.log(`push-right mid vs unblurred slide: ${dBlur.toFixed(3)}`);
    ok(dBlur > 1, `push-right mid: velocity blur is present (${dBlur.toFixed(3)} vs the unblurred slide)`);
    // It mirrors Smooth Push Left: the two mid frames are horizontal mirrors.
    const leftExpr = transitionExpr({ type: 'fx_pushsmooth' });
    const midL = frame(redF, bluF, 0.5, leftExpr);
    let mirrorDiff = 0; let n = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = (y * W + x) * 4; const b = (y * W + (W - 1 - x)) * 4;
      for (let ch = 0; ch < 3; ch++) { mirrorDiff += Math.abs(mid[a + ch] - midL[b + ch]); n++; }
    }
    mirrorDiff /= n;
    console.log(`push-right vs mirrored push-left mid: ${mirrorDiff.toFixed(3)}`);
    ok(mirrorDiff < 6, `push-right mid mirrors push-left mid (${mirrorDiff.toFixed(3)})`);
  }

  // ---- 3) Directional Blur Reveal: blur peaks mid-way, crossfade underneath ----
  {
    const expr = transitionExpr({ type: 'fx_blurreveal' });
    // On the charts the blur is measurable: mid frame vs a plain crossfade model.
    const mid = frame(chA, chB, 0.5, expr);
    const dCross = meanDiff(mid, cross(chA, chB, 0.5));
    console.log(`blur-reveal mid vs plain crossfade: ${dCross.toFixed(3)}`);
    ok(dCross > 1.5, `blur-reveal mid is blurred, not a plain crossfade (${dCross.toFixed(3)})`);
    // Direction matters: horizontal / vertical / diagonal render differently.
    const renders = {};
    for (const angle of ['horizontal', 'vertical', 'diagonal']) {
      renders[angle] = frame(chA, chB, 0.5, transitionExpr({ type: 'fx_blurreveal', params: { angle } }));
    }
    ok(meanDiff(renders.horizontal, renders.vertical) > 0.5
      && meanDiff(renders.horizontal, renders.diagonal) > 0.5
      && meanDiff(renders.vertical, renders.diagonal) > 0.5, 'blur-reveal: the three directions render differently');
    // Blur amount matters; blur 0 is a plain crossfade.
    const zero = frame(chA, chB, 0.5, transitionExpr({ type: 'fx_blurreveal', params: { blur: 0 } }));
    ok(meanDiff(zero, cross(chA, chB, 0.5)) <= 0.5, 'blur-reveal: blur 0 degrades to a plain crossfade');
    // An unknown direction falls back to the default. (B-F05 generics ride
    // along — strength/softness/motionBlur at defaults — so the check is on
    // the fallback values, not exact object equality.)
    const fb = mergeTrParams('fx_blurreveal', { angle: 'sideways' });
    ok(fb.angle === 'horizontal' && fb.blur === 0.6,
      'blur-reveal: an unknown direction falls back to the default');
  }

  // ---- 4) RGB Split Cut: hard cut, deterministic channel split at the cut ----
  {
    const expr = transitionExpr({ type: 'fx_rgbsplitcut' });
    // The green channel is never displaced (C(1,0,-1) shifts R/B only): before
    // the cut it equals A's green, after it B's green — a hard cut, no blend.
    const pre = frame(gradA, gradB, 0.25, expr);
    const post = frame(gradA, gradB, 0.75, expr);
    let gPre = 0; let gPost = 0;
    for (let i = 1; i < pre.length; i += 4) { gPre += Math.abs(pre[i] - gradA[i]); gPost += Math.abs(post[i] - gradB[i]); }
    gPre /= (W * H); gPost /= (W * H);
    console.log(`rgb-split-cut: green-channel error pre-cut ${gPre.toFixed(3)}, post-cut ${gPost.toFixed(3)}`);
    ok(gPre <= 0.5 && gPost <= 0.5, 'rgb-split-cut: green channel is exactly A before / B after the cut (hard cut)');
    // The split itself is visible near the cut: R and B disagree with the
    // undisplaced picture at P=0.49, and vanish at the ends.
    const near = frame(gradA, gradB, 0.49, expr);
    ok(meanDiff(near, gradA) > 0.5, `rgb-split-cut: channel split visible just before the cut (${meanDiff(near, gradA).toFixed(3)})`);
    // Deterministic: no hash anywhere in the expression, same P twice identical.
    const again = frame(gradA, gradB, 0.49, expr);
    ok(meanDiff(near, again) === 0, 'rgb-split-cut: same P renders identically (deterministic)');
    ok(!expr.includes('hash'), 'rgb-split-cut: expression carries no randomness');
    // Split amount matters.
    const wide = frame(gradA, gradB, 0.49, transitionExpr({ type: 'fx_rgbsplitcut', params: { split: 1 } }));
    const narrow = frame(gradA, gradB, 0.49, transitionExpr({ type: 'fx_rgbsplitcut', params: { split: 0 } }));
    ok(meanDiff(wide, gradA) > meanDiff(narrow, gradA), 'rgb-split-cut: split amount moves the render');
  }

  // ---- 5) Bloom Flash: glow + warm flash peak mid-way, zero at the ends ----
  {
    const expr = transitionExpr({ type: 'fx_bloomflash' });
    const mid = frame(gradA, gradB, 0.5, expr);
    const lumMid = meanLum(mid);
    const lumEnds = (meanLum(gradA) + meanLum(gradB)) / 2;
    console.log(`bloom-flash mid luminance ${lumMid.toFixed(1)} vs ends mean ${lumEnds.toFixed(1)}`);
    ok(lumMid > lumEnds + 5, `bloom-flash mid is lifted by the flash (${lumMid.toFixed(1)} > ${lumEnds.toFixed(1)})`);
    // The lift is warm: red gains more than blue at mid.
    const m = meanRGB(mid);
    const e = meanRGB(gradA).map((v, ch) => (v + meanRGB(gradB)[ch]) / 2);
    ok((m[0] - e[0]) > (m[2] - e[2]), 'bloom-flash mid lift is warm (red gains over blue)');
    // Intensity matters; 0 is a plain blend.
    const flat = frame(chA, chB, 0.5, transitionExpr({ type: 'fx_bloomflash', params: { intensity: 0 } }));
    ok(meanDiff(flat, cross(chA, chB, 0.5)) <= 0.5, 'bloom-flash: intensity 0 degrades to a plain blend');
  }

  // ---- 6) VERIFY (not rebuild): Smooth Push Left + Luma Wipe softness ----
  {
    const expr = transitionExpr({ type: 'fx_pushsmooth' });
    ok(meanDiff(frame(redF, bluF, 0, expr), redF) === 0, 'push-left: P=0 is exactly A');
    ok(meanDiff(frame(redF, bluF, 1, expr), bluF) === 0, 'push-left: P=1 is exactly B');
    const mid = frame(redF, bluF, 0.5, expr);
    let bRight = 0; let bLeft = 0;
    for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
      const i = (y * W + x) * 4;
      const isB = mid[i + 2] > 150 && mid[i] < 80;
      if (x >= W / 2 && isB) bRight++;
      if (x < W / 2 && isB) bLeft++;
    }
    ok(bRight > bLeft * 4, 'push-left mid: B has entered from the right (verified working)');
    const luma = transitionExpr({ type: 'fx_lumawipe' });
    ok(meanDiff(frame(gradA, gradB, 0, luma), gradA) === 0, 'luma-wipe: P=0 is exactly A');
    ok(meanDiff(frame(gradA, gradB, 1, luma), gradB) === 0, 'luma-wipe: P=1 is exactly B');
    // Softness: with the default feather the mid frame carries a soft band of
    // intermediate-luma pixels; with feather 0 the edge is hard. Measured on
    // the charts — the lavfi gradients source has near-constant luma, so its
    // metric spans 0.008 and the band is empty there (a property of luma
    // wipes, not of the feather).
    const soft = frame(chA, chB, 0.5, luma);
    const hard = frame(chA, chB, 0.5, transitionExpr({ type: 'fx_lumawipe', params: { feather: 0 } }));
    const softBand = (f, A, B) => {
      let n = 0;
      for (let i = 0; i < f.length; i += 4) {
        const l = 0.299 * f[i] + 0.587 * f[i + 1] + 0.114 * f[i + 2];
        const la = 0.299 * A[i] + 0.587 * A[i + 1] + 0.114 * A[i + 2];
        const lb = 0.299 * B[i] + 0.587 * B[i + 1] + 0.114 * B[i + 2];
        if (Math.abs(l - la) > 8 && Math.abs(l - lb) > 8) n++;
      }
      return n;
    };
    console.log(`luma-wipe mid: soft-band pixels feathered ${softBand(soft, chA, chB)}, hard ${softBand(hard, chA, chB)}`);
    ok(softBand(soft, chA, chB) > softBand(hard, chA, chB) * 2 && softBand(soft, chA, chB) > 200,
      'luma-wipe: feather softens the edge (verified working)');
  }

  // ---- 7) Real exports: segment == reference, export == segment ----
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportPair = async (tag, aId, bId, type, fxSegments, params) => {
    const project = {
      name: 'cc05', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [
        { ...base, id: 'c1', mediaId: aId, in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: bId, in: 0, out: 2, transition: { type, duration: TD, ...(params ? { params } : {}) } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
      ...(fxSegments ? { fxSegments } : {}),
    };
    const out = path.join(dir, `out-${tag}.mp4`);
    await runExport(project, out, null).promise;
    return out;
  };
  const junction = (file) => decodeFrames(file, JSTART, TD);
  const pAt = (k) => k / FPS / TD;
  for (const [id, aId, bId] of [['fx_blurreveal', 'ga', 'gb'], ['fx_bloomflash', 'ra', 'rb'], ['fx_rgbsplitcut', 'ra', 'rb'], ['fx_pushsmoothright', 'ra', 'rb']]) {
    const t = fxTransition(id);
    const framesA = decodeFrames(aId === 'ra' ? aRed : aGr, 2 - TD, TD);
    const framesB = decodeFrames(bId === 'rb' ? bBlu : bGr, 0, TD);
    const segFrames = Math.max(1, Math.round(TD * FPS));
    const seg = path.join(dir, `seg-${id}.mkv`);
    const enc = spawn(ffmpegPath, segmentEncoderArgs(seg, W, H, FPS), { windowsHide: true });
    const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`segment encoder ${c}`)))); enc.on('error', rej); });
    enc.stdin.on('error', () => {});
    const refs = [];
    for (let k = 0; k < segFrames; k++) {
      const out = new Uint8ClampedArray(W * H * 4);
      runTransition(framesA[Math.min(k, framesA.length - 1)], framesB[Math.min(k, framesB.length - 1)], out, W, H,
        easeValue(undefined, k / FPS / TD), transitionExpr({ type: id }));
      refs.push(Buffer.from(out));
      if (!enc.stdin.write(Buffer.from(out))) await new Promise((r) => enc.stdin.once('drain', r));
    }
    enc.stdin.end();
    await done;
    const segDecoded = decodeFrames(seg, 0, TD);
    let worstSeg = 0;
    for (const k of [3, 8, 13]) worstSeg = Math.max(worstSeg, meanDiff(segDecoded[k], refs[k]));
    console.log(`${id}: segment vs engine reference, worst frame diff ${worstSeg.toFixed(3)}`);
    ok(worstSeg <= 1.5, `${id}: rendered segment matches the engine reference within 1.5`);
    const out = await exportPair(`fx-${id}`, aId, bId, id, { c2: seg });
    const expFrames = junction(out);
    let worstMean = 0;
    for (let k = 0; k < 18; k++) {
      const em = meanRGB(expFrames[k]);
      const sm = meanRGB(segDecoded[Math.min(k, segDecoded.length - 1)]);
      worstMean = Math.max(worstMean, Math.max(...em.map((v, ch) => Math.abs(v - sm[ch]))));
    }
    console.log(`${id}: export vs segment frame means, worst channel diff at exact index ${worstMean.toFixed(2)}`);
    ok(worstMean <= 6, `${id}: export carries the segment's progression (worst mean diff ${worstMean.toFixed(2)} <= 6)`);
    void pAt;
  }

  if (fails.length) { console.error(`CC05 TRANSITIONS FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('CC05 TRANSITIONS OK — 4 new true transitions (first/mid/last + export), push-left + luma-wipe verified working');
})().catch((e) => { console.error('CC05 TRANSITIONS FAIL:', e.message); process.exit(1); });
