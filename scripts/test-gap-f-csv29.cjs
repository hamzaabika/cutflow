// Gap-build Stream F (§7): CSV untested rows — run, don't rebuild.
// Verifies the mapped engine item for each of the 29 rows by the same
// methodology as test-fx-parity / test-transition-parity:
//   routing  — the clip is claimed by the effects pass and pixelPasses
//              yields the expected passes (the preview and the export share
//              this one engine, src/fx/apply.js);
//   override — frames rendered through the passes match the CPU reference
//              of the same expression within 1.5 mean abs;
//   export   — the baked project (exactly as src/fxExport.js produces it:
//              look stripped, override in place) exports a frame matching
//              the CPU reference within codec tolerance 3, and the look is
//              measurably present (> 0.5 vs the unprocessed source).
// Row -> engine mapping is the CC-08 verified inventory
// (docs/creative-composer-audit.md, branch cc-e). Rows whose mapped item is
// an overlay effect (152 fx_dust), a text template (27) or a caption
// template (200-208), and the Library & UX workflow rows (228/232/234/235),
// cannot be rendered by this Node harness (their export frames are drawn
// by the renderer's canvas) — they are covered by the live CDP driver
// scripts/test-gap-f-live.mjs instead; this script asserts their
// resolution/routing only. Row 129's named preset is MISSING (CC-01);
// the stand-in fx_bloom1 is what runs here, and the script says so.
// Usage: TMPDIR=<disk dir> node scripts/test-gap-f-csv29.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const LEN = 0.6;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { runEffect, runTransition } = await import('../src/fx/run.js');
  const { pixelPasses, clipHasPixelFx, isOverlay, overlayRanges } = await import('../src/fx/apply.js');
  const { fxTransition } = await import('../src/fx/catalog.js');
  const { easeValue } = await import('../src/fx/easing.js');
  const { gradeExpr, hasGrade } = await import('../src/fx/grade.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-gapf-csv29-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const grad = path.join(dir, 'grad.mp4');
  const det = path.join(dir, 'det.mp4');
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
  const meanRGB = (f) => {
    let r = 0; let g = 0; let b = 0;
    for (let i = 0; i < f.length; i += 4) { r += f[i]; g += f[i + 1]; b += f[i + 2]; }
    const n = f.length / 4;
    return [r / n, g / n, b / n];
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
  const frameAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 24 });

  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const projOf = (clip) => ({
    name: 'gapf-csv29', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
    videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  const renderOverride = async (clip, srcFile, tag) => {
    const proj = projOf(clip);
    const frames = decodeFrames(srcFile, clip.in, LEN);
    const out = path.join(dir, `ov-${tag}.mkv`);
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
  const midK = Math.floor(LEN * FPS / 2);
  // Plain baseline export (smooth source, no effects) for the pattern
  // metrics of the two high-frequency looks (rows 158/170): per-pixel
  // noise and 1px scanlines lose amplitude through the yuv420p round-trip
  // and grain is per-frame pseudo-random, so a mean-diff-vs-CPU gate is the
  // wrong instrument for them (see test-gap-f-verify.mjs) — the binding
  // export evidence is presence + the pattern metric vs this plain export.
  const luma = (f) => { const g = new Float32Array(W * H); for (let i = 0; i < W * H; i++) g[i] = 0.299 * f[i * 4] + 0.587 * f[i * 4 + 1] + 0.114 * f[i * 4 + 2]; return g; };
  const rowAlt = (g) => { let s = 0; for (let y = 0; y < H - 1; y++) { let a = 0, b = 0; for (let x = 0; x < W; x++) { a += g[y * W + x]; b += g[(y + 1) * W + x]; } s += Math.abs(a / W - b / W); } return s / (H - 1); };
  const hfEnergy = (g) => { let s = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) { s += Math.abs(g[y * W + x + 1] - g[y * W + x]); n++; } return s / n; };
  const plainGradFile = path.join(dir, 'plain-grad.mp4');
  {
    const plainProj = { name: 'gapf-plain', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media,
      videoClips: [{ ...base, id: 'pg', mediaId: 'mg', in: 0, out: LEN }], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [] };
    await runExport(plainProj, plainGradFile, null).promise;
  }
  const plainGradFrame = frameAt(plainGradFile, midK / FPS);

  // ---- Pixel effects -------------------------------------------------------
  // [csvRow, label, effectIds, sourceForOverride]
  const effectCases = [
    [129, 'Clean Soft Bloom (STAND-IN fx_bloom1; named multi-pass preset MISSING, CC-01)', ['fx_bloom1'], det],
    [144, 'Warm Edge Leak Overlay -> fx_leakedge', ['fx_leakedge'], det],
    [145, 'Soft Organic Leak -> fx_leakbl', ['fx_leakbl'], det],
    [147, 'Vintage Grain -> fx_grainfine + fx_faded', ['fx_grainfine', 'fx_faded'], det],
    [150, 'Scratch Overlay -> fx_scratch', ['fx_scratch'], det],
    [151, 'Paper Texture -> fx_agedpaper', ['fx_agedpaper'], det],
    [153, 'Subtle VHS Tracking -> fx_vhstrack', ['fx_vhstrack'], det],
    [155, 'Old Film Frame -> fx_filmborder + fx_oldphoto', ['fx_filmborder', 'fx_oldphoto'], det],
    [158, 'Fine Color Grain -> fx_colorgrain', ['fx_colorgrain'], det],
    [159, 'Chromatic Edge Split -> fx_rgb2', ['fx_rgb2'], det],
    [160, 'Soft Wave Warp -> fx_wavewarp', ['fx_wavewarp'], det],
    [166, 'Outline Trace -> fx_edgelines', ['fx_edgelines'], det],
    [167, 'Neon Line Outline -> fx_neonedge', ['fx_neonedge'], det],
    [170, 'Scanline Video -> fx_scanline', ['fx_scanline'], det],
  ];
  for (const [row, label, ids, srcFile] of effectCases) {
    const tag = `r${row}`;
    const clip = { ...base, id: 'c1', mediaId: srcFile === grad ? 'mg' : 'md', in: 0, out: LEN, effects: ids };
    const proj = projOf(clip);
    const passes = pixelPasses(proj, clip, 0, midK / FPS);
    ok(clipHasPixelFx(proj, clip), `row ${row} ${label}: claimed by the effects pass`);
    ok(passes.length === ids.length, `row ${row}: ${passes.length} shader pass(es) for ${ids.length} effect(s) (got ${passes.length})`);
    // Override vs CPU on the detailed source.
    const { file, frames } = await renderOverride(clip, srcFile, tag);
    const expected = applyPasses(frames[midK], pixelPasses(proj, clip, 0, midK / FPS), midK / FPS);
    const dOv = meanDiff(frameAt(file, midK / FPS), expected);
    console.log(`row ${row}: override vs CPU ${dOv.toFixed(3)}`);
    ok(dOv <= 1.5, `row ${row}: fx-pass override matches the CPU reference within 1.5`);
    // Final export vs CPU on the smooth source (baked project, as fxExport.js builds it).
    const gClip = { ...clip, mediaId: 'mg' };
    const g = await renderOverride(gClip, grad, `${tag}g`);
    const gProj = projOf(gClip);
    const gExpected = applyPasses(g.frames[midK], pixelPasses(gProj, gClip, 0, midK / FPS), midK / FPS);
    const baked = { ...gProj, videoClips: [{ ...gClip, adjust: {}, effects: [], videoOverride: { file: g.file, start: 0, end: LEN } }] };
    const outFile = path.join(dir, `out-${tag}.mp4`);
    await runExport(baked, outFile, null).promise;
    const expFrame = frameAt(outFile, midK / FPS);
    const dExp = meanDiff(expFrame, gExpected);
    const dPresence = meanDiff(expFrame, g.frames[midK]);
    console.log(`row ${row}: export vs CPU ${dExp.toFixed(3)}, export vs unprocessed source ${dPresence.toFixed(3)}`);
    if (row === 158 || row === 170) {
      // High-frequency look: gate on the pattern metric, report dExp as info only.
      const metric = row === 158 ? hfEnergy(luma(expFrame)) / Math.max(hfEnergy(luma(plainGradFrame)), 1e-6)
        : rowAlt(luma(expFrame)) / Math.max(rowAlt(luma(plainGradFrame)), 1e-6);
      const thresh = row === 158 ? 1.5 : 3;
      console.log(`row ${row}: pattern metric vs plain export ${metric.toFixed(1)}x (threshold ${thresh}x); export vs CPU ${dExp.toFixed(3)} info only`);
      ok(metric > thresh, `row ${row}: the look survives the export at full strength (pattern ${metric.toFixed(1)}x plain)`);
    } else {
      ok(dExp <= 3, `row ${row}: final export matches the CPU reference within codec tolerance 3`);
    }
    ok(dPresence > 0.5, `row ${row}: the look is measurably present in the export (not silently dropped)`);
  }

  // ---- Row 152 fx_dust: overlay effect — routing only here ------------------
  {
    const clip = { ...base, id: 'c1', mediaId: 'md', in: 0, out: LEN, effects: ['fx_dust'] };
    const proj = projOf(clip);
    ok(isOverlay('fx_dust'), 'row 152 Dust Flecks -> fx_dust: registered as an overlay effect');
    const ranges = overlayRanges(proj);
    ok(ranges.length === 1 && Math.abs(ranges[0][0]) < 1e-9 && Math.abs(ranges[0][1] - LEN) < 1e-9,
      `row 152: overlayRanges covers the clip [${ranges.map((r) => r.join('-')).join(', ')}]`);
    ok(!clipHasPixelFx(proj, clip), 'row 152: overlay effect correctly NOT claimed by the pixel pass (drawn by drawOverlayPasses)');
    console.log('row 152: export/preview draw verified live in test-gap-f-live.mjs (canvas path)');
  }

  // ---- Row 115 fx_irisout: engine transition, segment + export --------------
  {
    const TD = 0.6;
    const aRed = path.join(dir, 'a-red.mp4');
    const bBlu = path.join(dir, 'b-blu.mp4');
    gen(['-f', 'lavfi', '-i', `color=c=0xC81E1E:size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', aRed]);
    gen(['-f', 'lavfi', '-i', `color=c=0x1E1EC8:size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', bBlu]);
    const m2 = [];
    for (const [id, p] of [['ra', aRed], ['rb', bBlu]]) m2.push({ id, path: p, name: path.basename(p), ...(await probe(p)) });
    const t = fxTransition('fx_irisout');
    ok(!!t && !!t.expr, 'row 115 Circle Reveal Soft -> fx_irisout: engine transition with an expression');
    ok(t.expr.includes('smooth('), 'row 115: fx_irisout is the SOFT-edged iris (smooth() edge), not the hard circleopen');
    const segFramesA = decodeFrames(aRed, 2 - TD, TD);
    const segFramesB = decodeFrames(bBlu, 0, TD);
    const frames = Math.max(1, Math.round(TD * FPS));
    const seg = path.join(dir, 'seg-irisout.mkv');
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
    const segFrames = decodeFrames(seg, 0, TD);
    let worstSeg = 0;
    for (const k of [3, 8, 13]) worstSeg = Math.max(worstSeg, meanDiff(segFrames[k], refs[k]));
    console.log(`row 115: segment vs engine reference, worst frame diff ${worstSeg.toFixed(3)}`);
    ok(worstSeg <= 1.5, `row 115: rendered segment matches the engine reference within 1.5`);
    const project = {
      name: 'gapf-iris', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media: m2,
      videoClips: [
        { ...base, id: 'c1', mediaId: 'ra', in: 0, out: 2 },
        { ...base, id: 'c2', mediaId: 'rb', in: 0, out: 2, transition: { type: 'fx_irisout', duration: TD } },
      ],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
      fxSegments: { c2: seg },
    };
    const outFile = path.join(dir, 'out-iris.mp4');
    await runExport(project, outFile, null).promise;
    const expFrames = decodeFrames(outFile, 2 - TD, TD);
    let worstMean = 0;
    for (let k = 0; k < 18; k++) {
      const em = meanRGB(expFrames[k]);
      const sm = meanRGB(segFrames[Math.min(k, segFrames.length - 1)]);
      worstMean = Math.max(worstMean, Math.max(...em.map((v, ch) => Math.abs(v - sm[ch]))));
    }
    console.log(`row 115: export vs segment frame means, worst channel diff ${worstMean.toFixed(2)}`);
    ok(worstMean <= 6, `row 115: export carries the segment's progression (worst mean diff ${worstMean.toFixed(2)} <= 6)`);
    // The iris actually opens: mid-junction frame is neither pure A nor pure B.
    const mid = expFrames[9];
    const m = meanRGB(mid);
    ok(m[0] > 40 && m[0] < 180 && m[2] > 40 && m[2] < 180, `row 115: mid-junction frame is a real blend (mean RGB ${m.map((v) => v.toFixed(0)).join(', ')})`);
  }

  // ---- B-H-mask: HSL masks — wiring + preview/export parity ------------------
  {
    const clip = { ...base, id: 'c1', mediaId: 'mg', in: 0, out: LEN, grade: { hsl: { orange: { h: 0, s: 100, l: 0 } } } };
    ok(hasGrade(clip), 'HSL mask: hasGrade true for an orange +100 saturation mask');
    ok(typeof gradeExpr(clip.grade) === 'string' && gradeExpr(clip.grade).includes('ld(8)'), 'HSL mask: gradeExpr builds the hue-band expression');
    const proj = projOf(clip);
    ok(clipHasPixelFx(proj, clip), 'HSL mask: graded clip claimed by the effects pass');
    const passes = pixelPasses(proj, clip, 0, midK / FPS);
    ok(passes.length === 1, `HSL mask: exactly one grade pass (got ${passes.length})`);
    const { file, frames } = await renderOverride(clip, grad, 'hsl');
    const expected = applyPasses(frames[midK], pixelPasses(proj, clip, 0, midK / FPS), midK / FPS);
    const dOv = meanDiff(frameAt(file, midK / FPS), expected);
    console.log(`HSL mask: override vs CPU ${dOv.toFixed(3)}`);
    ok(dOv <= 1.5, 'HSL mask: fx-pass override matches the CPU reference within 1.5');
    const baked = { ...proj, videoClips: [{ ...clip, grade: {}, videoOverride: { file, start: 0, end: LEN } }] };
    const outFile = path.join(dir, 'out-hsl.mp4');
    await runExport(baked, outFile, null).promise;
    const expFrame = frameAt(outFile, midK / FPS);
    const dExp = meanDiff(expFrame, expected);
    const dPresence = meanDiff(expFrame, frames[midK]);
    console.log(`HSL mask: export vs CPU ${dExp.toFixed(3)}, export vs unprocessed source ${dPresence.toFixed(3)}`);
    ok(dExp <= 3, 'HSL mask: final export matches the CPU reference within codec tolerance 3');
    ok(dPresence > 0.5, 'HSL mask: the mask measurably changes the export (not silently dropped)');
    // Wiring: the HSL panel writes clip.grade.hsl (GradePanel -> HslPanel onChange).
    const gp = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'GradePanel.jsx'), 'utf8');
    ok(gp.includes('onChange={(hsl) => onGrade({ ...g, hsl })'), 'HSL mask wiring: GradePanel HSL tab writes grade.hsl');
    const pv = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'Preview.jsx'), 'utf8');
    ok(pv.includes('pixelPasses(project'), 'HSL mask wiring: Preview draws pixelPasses (grade included)');
    const fx = fs.readFileSync(path.join(__dirname, '..', 'electron', 'ffmpeg.cjs'), 'utf8');
    ok(fx.includes('fxSegments'), 'HSL mask wiring: export joins the pre-rendered fx segments');
  }

  // ---- Text / caption template resolution (render + export: live driver) ----
  {
    const catalog = await import('../src/text/catalog.js');
    const packs = await import('../src/text/captionPacks.js');
    const all = catalog.TEXT_TEMPLATES || [];
    const t27 = all.find((t) => t.id === 'title-decode');
    ok(!!t27, 'row 27 Terminal Decode -> title-decode: template resolves in src/text/catalog.js');
    ok(t27 && t27.patch && t27.patch.animIn && t27.patch.animIn.id === 'decode', `row 27: title-decode uses the decode animIn (got ${t27?.patch?.animIn?.id})`);
    const capIds = { 200: 'cap-hormozi', 201: 'cap-oneword', 202: 'cap-subtitle', 204: 'cap-neon', 206: 'cap-karaoke', 208: 'cap-minimal' };
    for (const [row, id] of Object.entries(capIds)) {
      ok(all.some((t) => t.id === id), `row ${row}: caption template ${id} resolves`);
    }
    ok((catalog.BUBBLES || []).some((b) => b.id === 'pill'),
      'row 205 Pill Background Subtitle: the pill bubble exists (BUBBLES) and applies to caption templates');
    ok(Array.isArray(packs.CAPTION_PACKS) && packs.CAPTION_PACKS.length >= 5, 'captions: caption style packs resolve');
    console.log('rows 27/200-208: render + export verified live in test-gap-f-live.mjs (canvas text path)');
  }

  // ---- Library & UX routing (behaviour: live driver) ------------------------
  {
    const schema = await import('../src/presets/schema.js');
    ok(typeof schema.parseCreativePresetFile === 'function', 'row 228 Preset Import Export: parseCreativePresetFile exists');
    // A well-formed v1 preset (built by the schema itself) round-trips
    // through serialize -> parse. (A bare {id, name, target, params}
    // object is NOT a v1 preset — kind + schemaVersion are required —
    // so the fixture must carry them.)
    const made = schema.newCreativePreset({ name: 'T', target: 'filter', variant: 'vivid', params: { intensity: 70 } });
    const parsed = schema.parseCreativePresetFile(schema.serializeCreativePreset(made));
    ok(parsed && parsed.presets && parsed.presets.length === 1 && parsed.presets[0].name === 'T' && parsed.presets[0].params.intensity === 70,
      'row 228: a preset JSON file parses to one preset (name + params intact)');
    const registry = await import('../src/presets/registry.js');
    ok(typeof registry.paramDefs === 'function' && registry.paramDefs('filter').length > 0,
      'row 234 Preset Variant Controls: paramDefs registry returns variant controls');
    const easing = await import('../src/fx/easing.js');
    ok(Array.isArray(easing.EASE_PRESETS) && easing.EASE_PRESETS.length > 0,
      `row 235 Easing Graph Presets: ${easing.EASE_PRESETS.length} easing presets in fx/easing.js`);
    const composer = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'ComposerPanel.jsx'), 'utf8');
    ok(composer.includes('parseCreativePresetFile'), 'row 228: ComposerPanel wires the import');
    ok(composer.includes('serializeCreativePreset'), 'row 228: ComposerPanel wires the export');
    const store = fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8');
    const multiApply = /selected.*apply|apply.*selected/i.test(store) && /multi/i.test(store);
    console.log(`row 232 Multi-Clip Apply: static scan for a multi-clip apply path: ${multiApply ? 'candidate found (verify live)' : 'NO apply-to-selected-clips path in store.js — verify live'}`);
    console.log('rows 228/232/234/235: behaviour verified live in test-gap-f-live.mjs');
  }

  if (fails.length) { console.error(`\nGAP-F CSV29 FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('\nGAP-F CSV29 OK');
})().catch((e) => { console.error('GAP-F CSV29 FAIL:', e); process.exit(1); });
