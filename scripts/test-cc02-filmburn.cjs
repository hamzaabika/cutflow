// CC-02 Procedural Film Burn & Light Leaks (effect) + CC-09c halation &
// gate-weave toggles. Pins:
//   1. Placement + hard rules: ONE effect entry, right after fx_vhstrack in
//      PIXEL_EFFECTS; it is NOT the removed fx_filmburn transition (that id,
//      fx_lightleak and the other 18 removed transition ids stay absent).
//   2. Schema: 11 params incl. the two toggles; merge resolves true/1/'true'
//      and false/0 the same way, and an amount is inert while its toggle is off.
//   3. The 12 starter presets: schema-valid bundles, each rendering distinctly
//      from the default and from each other.
//   4. Determinism: same seed + same T renders byte-identical frames (twice,
//      and across two exports); different seeds differ; the effect is animated
//      (T moves it) yet pause/resume-safe (a pure function of T).
//   5. Aspects: square / vertical / wide render with no unfilled edges.
//   6. Pass builder: clip-bound and free Effects-track instances reach
//      pixelPasses; the export carries the effect (baked-override pattern from
//      test-fx-parity — headless runExport takes pre-baked segments, as the
//      app's fxExport.js produces them).
// Usage: node scripts/test-cc02-filmburn.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const LEN = 2;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { runEffect } = await import('../src/fx/run.js');
  const { PIXEL_EFFECTS, FX_TRANSITIONS } = await import('../src/fx/catalog.js');
  const { fxSchema, fxDefaults, mergeFxParams, resolveFxExpr, fxPresets, pruneFxParams } = await import('../src/fx/params.js');
  const { pixelPasses, clipHasPixelFx } = await import('../src/fx/apply.js');
  const { normalizeProject } = await import('../src/store.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cc02-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const grad = path.join(dir, 'grad.mp4');
  gen(['-f', 'lavfi', '-i', `gradients=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', grad]);
  const media = [{ id: 'mg', path: grad, name: 'grad.mp4', ...(await probe(grad)) }];

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
  // Rich asymmetric test chart (same family as test-effects-library): smooth
  // correlated regions + sharp edges, so small translations/noise stay visible.
  const chart = (w, h) => {
    const src = new Uint8ClampedArray(w * h * 4);
    const cell = Math.round(w / 16);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 40 + x * 0.9 + y * 0.35, g = 200 - x * 0.55 + y * 0.45, b = 90 + y * 1.2 - x * 0.25;
      const blob = Math.max(0, 1 - Math.hypot(x - w / 4, y - h * 0.3) / (w / 5));
      r += blob * 120; g += blob * 40; b -= blob * 30;
      if (x >= w * 0.58) { const c = ((x - w * 0.58) / cell | 0) + (y / cell | 0); if (c % 2) { r = 235; g = 30; b = 60; } else { r = 25; g = 210; b = 225; } }
      if (y >= h * 0.7 && y < h * 0.85) { const s = (x / (w / 24) | 0) % 2; r = s ? 245 : 35; g = s ? 225 : 45; b = s ? 60 : 190; }
      src[i] = Math.max(0, Math.min(255, r)); src[i + 1] = Math.max(0, Math.min(255, g)); src[i + 2] = Math.max(0, Math.min(255, b)); src[i + 3] = 255;
    }
    return src;
  };
  const src = chart(W, H);
  const render = (expr, T = 0.6, w = W, h = H, s = src) => {
    const out = new Uint8ClampedArray(w * h * 4);
    runEffect(s, out, w, h, T, expr);
    return out;
  };

  // ---- 1) Placement + hard rules ----
  const ids = PIXEL_EFFECTS.map((e) => e.id);
  const vhsIdx = ids.indexOf('fx_vhstrack');
  const burnIdx = ids.indexOf('fx_burnleak');
  ok(vhsIdx >= 0 && burnIdx === vhsIdx + 1, `fx_burnleak sits right after fx_vhstrack in PIXEL_EFFECTS (at ${burnIdx})`);
  ok(new Set(ids).size === ids.length, 'pixel effect ids unique');
  const REMOVED = ['fx_filmburn', 'fx_lightleak', 'fx_flash', 'fx_tricolour', 'fx_vhstracking', 'fx_zoomspin',
    'fx_zoomrotatein', 'fx_zoomrotshake', 'fx_shakeblur', 'fx_zoommosaic', 'fx_shakedistort', 'fx_rollright',
    'fx_rolldown', 'fx_split', 'fx_tvstatic', 'fx_fanwipe', 'fx_elasticcircle', 'fx_zoomtwirl', 'fx_panrotate'];
  const trIds = new Set(FX_TRANSITIONS.map((t) => t.id));
  for (const id of REMOVED) {
    ok(!ids.includes(id), `removed id '${id}' is not a pixel effect`);
    ok(!trIds.has(id), `removed transition '${id}' stays removed`);
  }
  const entry = PIXEL_EFFECTS[burnIdx];
  ok(entry.name === 'Film Burn & Light Leak', `effect name is '${entry.name}'`);

  // ---- 2) Schema + toggles ----
  const schema = fxSchema('fx_burnleak');
  ok(schema.length === 11, `schema has 11 params (got ${schema.length})`);
  for (const p of schema) {
    ok(p.min < p.max && p.def >= p.min && p.def <= p.max && p.step > 0, `param ${p.key}: ranges sane`);
  }
  const hal = schema.find((p) => p.key === 'halation');
  const weave = schema.find((p) => p.key === 'gateWeave');
  ok(hal?.type === 'toggle' && weave?.type === 'toggle', 'halation + gateWeave are toggle params');
  ok(mergeFxParams('fx_burnleak', { halation: true }).halation === true
    && mergeFxParams('fx_burnleak', { halation: 1 }).halation === true
    && mergeFxParams('fx_burnleak', { halation: 'true' }).halation === true, 'toggle merge: true/1/"true" all on');
  ok(mergeFxParams('fx_burnleak', { halation: false }).halation === false
    && mergeFxParams('fx_burnleak', { halation: 0 }).halation === false
    && mergeFxParams('fx_burnleak', {}).halation === false, 'toggle merge: false/0/absent all off');
  ok(resolveFxExpr('fx_burnleak') === entry.expr, 'default resolution === catalog expr');
  ok(resolveFxExpr('fx_burnleak', fxDefaults('fx_burnleak')) === entry.expr, 'explicit defaults === catalog expr');
  // An amount is inert while its toggle is off (pinned, not assumed).
  const offA = resolveFxExpr('fx_burnleak', { halationAmt: 0 });
  const offB = resolveFxExpr('fx_burnleak', { halationAmt: 1 });
  ok(offA === offB, 'halation amount changes nothing while halation is off');
  ok(resolveFxExpr('fx_burnleak', { weaveAmt: 0 }) === resolveFxExpr('fx_burnleak', { weaveAmt: 1 }),
    'weave amount changes nothing while gate weave is off');

  // ---- 3) The 12 starter presets ----
  const presets = fxPresets('fx_burnleak');
  ok(presets && presets.length === 12, `12 starter presets (got ${presets?.length})`);
  ok(new Set(presets.map((p) => p.id)).size === 12, 'preset ids unique');
  ok(new Set(presets.map((p) => p.name)).size === 12, 'preset names unique');
  const schemaKeys = new Set(schema.map((p) => p.key));
  const defRender = render(entry.expr, 0.6);
  const presetRenders = [];
  for (const pr of presets) {
    for (const [k, v] of Object.entries(pr.params)) {
      ok(schemaKeys.has(k), `preset ${pr.id}: '${k}' is a schema key`);
      const p = schema.find((x) => x.key === k);
      if (p.type !== 'toggle') ok(v >= p.min && v <= p.max, `preset ${pr.id}: ${k}=${v} in range`);
    }
    const expr = resolveFxExpr('fx_burnleak', pr.params);
    ok(expr !== entry.expr, `preset ${pr.id}: resolves to a non-default expression`);
    const out = render(expr, 0.6);
    const d = meanDiff(out, defRender);
    console.log(`preset ${pr.id}: vs default mean abs diff ${d.toFixed(3)}`);
    ok(d > 0.35, `preset ${pr.id}: visibly distinct from the default (${d.toFixed(3)})`);
    presetRenders.push([pr.id, out]);
    const pruned = pruneFxParams('fx_burnleak', pr.params);
    ok(Object.keys(pruned).length > 0 && Object.keys(pruned).length <= Object.keys(pr.params).length,
      `preset ${pr.id}: prunes to a sparse stored form (${Object.keys(pruned).length} keys)`);
  }
  let minPair = Infinity; let minPairName = '';
  for (let i = 0; i < presetRenders.length; i++) for (let j = i + 1; j < presetRenders.length; j++) {
    const d = meanDiff(presetRenders[i][1], presetRenders[j][1]);
    if (d < minPair) { minPair = d; minPairName = `${presetRenders[i][0]} vs ${presetRenders[j][0]}`; }
  }
  console.log(`presets: closest pair ${minPairName} at ${minPair.toFixed(3)}`);
  ok(minPair > 0.35, `no preset is a rename of another (closest pair ${minPairName} ${minPair.toFixed(3)})`);

  // ---- 4) Determinism + animation ----
  const t06a = render(entry.expr, 0.6);
  const t06b = render(entry.expr, 0.6);
  ok(meanDiff(t06a, t06b) === 0, 'same seed + same T renders byte-identical frames');
  const t15 = render(entry.expr, 1.5);
  ok(meanDiff(t06a, t15) > 0.5, `the burn moves with time (T=0.6 vs 1.5 diff ${meanDiff(t06a, t15).toFixed(3)})`);
  const seed2 = render(resolveFxExpr('fx_burnleak', { seed: 2 }), 0.6);
  ok(meanDiff(t06a, seed2) > 0.5, `seed 2 renders differently from seed 1 (${meanDiff(t06a, seed2).toFixed(3)})`);
  ok(meanDiff(t06a, src) > 1.0, `the default burn visibly changes the picture (${meanDiff(t06a, src).toFixed(3)})`);

  // ---- 5) Aspects: square / vertical / wide, no unfilled edges ----
  for (const [w, h, label] of [[108, 108, 'square'], [108, 192, 'vertical'], [192, 108, 'wide']]) {
    const s = chart(w, h);
    const out = render(entry.expr, 0.6, w, h, s);
    const d = meanDiff(out, s);
    // No unfilled edge: the border rows/cols carry picture (not a flat fill).
    const border = [];
    for (let x = 0; x < w; x++) { border.push(out[x * 4], out[((h - 1) * w + x) * 4]); }
    for (let y = 0; y < h; y++) { border.push(out[(y * w) * 4], out[(y * w + w - 1) * 4]); }
    const spread = Math.max(...border) - Math.min(...border);
    console.log(`${label} ${w}x${h}: vs source ${d.toFixed(3)}, border value spread ${spread}`);
    ok(d > 1.0 && spread > 10, `${label} ${w}x${h}: burn present, edges filled (diff ${d.toFixed(2)}, border spread ${spread})`);
  }

  // ---- 6) CC-09c: the toggles visibly change the render ----
  const dHal = meanDiff(render(resolveFxExpr('fx_burnleak', { halation: true }), 0.6), t06a);
  console.log(`halation on vs off: ${dHal.toFixed(3)}`);
  ok(dHal > 1.0, `halation on visibly changes the render (${dHal.toFixed(3)})`);
  const dHalAmt = meanDiff(
    render(resolveFxExpr('fx_burnleak', { halation: true, halationAmt: 0 }), 0.6),
    render(resolveFxExpr('fx_burnleak', { halation: true, halationAmt: 1 }), 0.6));
  ok(dHalAmt > 0.5, `halation amount moves the render (${dHalAmt.toFixed(3)})`);
  const dWeave = meanDiff(render(resolveFxExpr('fx_burnleak', { gateWeave: true }), 0.6), t06a);
  console.log(`gate weave on vs off: ${dWeave.toFixed(3)}`);
  ok(dWeave > 1.0, `gate weave on visibly changes the render (${dWeave.toFixed(3)})`);
  const dWeaveAmt = meanDiff(
    render(resolveFxExpr('fx_burnleak', { gateWeave: true, weaveAmt: 0.2 }), 0.6),
    render(resolveFxExpr('fx_burnleak', { gateWeave: true, weaveAmt: 1 }), 0.6));
  ok(dWeaveAmt > 0.5, `weave amount moves the render (${dWeaveAmt.toFixed(3)})`);

  // ---- 7) Pass builder ----
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (clip, effectClips = []) => ({
    ...normalizeProject({}),
    media, videoClips: [clip], overlayClips: [], effectClips, textClips: [], audioClips: [],
  });
  const bound = { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN, effects: ['fx_burnleak'] };
  ok(clipHasPixelFx(mkProject(bound), bound) && pixelPasses(mkProject(bound), bound, 0, 0.5).length === 1,
    'clip-bound fx_burnleak: exactly one shader pass, claimed by the fx pass');
  const tuned = { ...bound, fxParams: { fx_burnleak: { amount: 0.9, halation: true } } };
  ok(pixelPasses(mkProject(tuned), tuned, 0, 0.5)[0].expr === resolveFxExpr('fx_burnleak', { amount: 0.9, halation: true }),
    'clip fxParams (incl. toggle) reach the pass builder');
  const free = { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN };
  const freeProj = mkProject(free, [{ id: 'e1', fx: 'fx_burnleak', start: 0, duration: LEN, params: { seed: 3 } }]);
  ok(pixelPasses(freeProj, free, 0, 0.5).some((p) => p.expr === resolveFxExpr('fx_burnleak', { seed: 3 })),
    'free Effects-track fx_burnleak reaches the pass builder');

  // ---- 8) Export carries the effect (baked-override pattern, test-fx-parity §5) ----
  const applyPasses = (frame, passes, lt) => {
    let cur = frame;
    for (const p of passes) {
      const out = new Uint8ClampedArray(W * H * 4);
      runEffect(cur, out, W, H, lt, p.expr);
      cur = Buffer.from(out);
    }
    return cur;
  };
  const projOf = (clip) => ({
    name: 'cc02', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
    videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  const frames = decodeFrames(grad, 0, LEN);
  const clip = { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN, effects: ['fx_burnleak'] };
  const proj = projOf(clip);
  const seg = path.join(dir, 'seg-burn.mkv');
  const enc = spawn(ffmpegPath, segmentEncoderArgs(seg, W, H, FPS), { windowsHide: true });
  const done = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`segment encoder ${c}`)))); enc.on('error', rej); });
  enc.stdin.on('error', () => {});
  const n = Math.round(LEN * FPS);
  for (let k = 0; k < n; k++) {
    const drawn = applyPasses(frames[Math.min(k, frames.length - 1)], pixelPasses(proj, clip, 0, k / FPS), k / FPS);
    if (!enc.stdin.write(Buffer.from(drawn))) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await done;
  const midK = Math.floor(n / 2);
  const expected = applyPasses(frames[midK], pixelPasses(proj, clip, 0, midK / FPS), midK / FPS);
  const segFrames = decodeFrames(seg, 0, LEN);
  const dSeg = meanDiff(segFrames[midK], expected);
  console.log(`burn segment vs CPU reference: ${dSeg.toFixed(3)}`);
  ok(dSeg <= 1.5, `burn segment matches the CPU reference within 1.5 (${dSeg.toFixed(3)})`);
  const baked = { ...proj, videoClips: [{ ...clip, effects: [], videoOverride: { file: seg, start: 0, end: LEN } }] };
  const out1 = path.join(dir, 'out-burn-1.mp4');
  const out2 = path.join(dir, 'out-burn-2.mp4');
  await runExport(baked, out1, null).promise;
  await runExport(baked, out2, null).promise;
  const frameAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 24 });
  const expFrame = frameAt(out1, midK / FPS);
  const dExp = meanDiff(expFrame, expected);
  const dPresence = meanDiff(expFrame, frames[midK]);
  console.log(`burn export vs CPU ${dExp.toFixed(3)}, export vs unprocessed source ${dPresence.toFixed(3)}`);
  ok(dExp <= 3, `burn export matches the CPU reference within codec tolerance 3 (${dExp.toFixed(3)})`);
  ok(dPresence > 0.5, `the burn is measurably present in the export (${dPresence.toFixed(3)})`);
  const dDet = meanDiff(expFrame, frameAt(out2, midK / FPS));
  console.log(`burn export determinism (two exports, same frame): ${dDet.toFixed(3)}`);
  ok(dDet <= 1.5, `same project re-exported renders the same burn frame (${dDet.toFixed(3)})`);

  if (fails.length) { console.error(`CC02 FILM BURN FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('CC02 FILM BURN OK — effect + 12 presets + halation/gate-weave toggles, deterministic, export-carried');
})().catch((e) => { console.error('CC02 FILM BURN FAIL:', e.message); process.exit(1); });
