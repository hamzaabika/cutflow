// P1-19 deterministic golden-frame suite: preview vs export, pixel-compared.
// For a fixed set of cases (text template, Arabic RTL text, pixel effect,
// transition mid-frame, grade layer, sticker/overlay) the live app seeks the
// preview to a fixed time and captures the stage exactly as the user sees it,
// then exports the same project through the real pipeline; this driver
// extracts the exported frame at the same time and compares pixel-exactly
// within the stated tolerances, FAILING on mismatch.
//
// Determinism: fixed seeds (no random anywhere), fixed timestamps, no
// wall-clock dependence. Every case's frame content is a pure function of
// the project time t — solid-colour / static-gradient media, text entrances
// fully settled at t, no loops, no particles, no speed ramps — so the preview
// capture and the export frame must agree up to YUV<->RGB conversion loss.
//
// Thresholds (stated, not tuned per run): PSNR >= 30 dB, mean absolute
// channel difference <= 6.0, at most 2% of pixels differing by > 16 levels.
// Controls: (a) export-vs-itself PSNR must be inf (the encoder is
// deterministic — same project re-encoded is bit-identical, per
// test-blend-psnr.cjs), so any measured difference is pipeline, not encoder
// noise; (b) a negative control — preview of one case vs export of another —
// must FAIL the thresholds, proving the comparison can detect mismatch.
//
// Explicitly excluded (not silently loosened): particle overlays
// (fx_snow/fx_rain/... — their phase is quantised off the video element's
// clock in preview vs the export timebase, so a one-frame phase difference
// is possible); speed ramps (preview resamples via the element rate, export
// via setpts — same map, different sampler); morph-cut (flow analysis is
// cached and deterministic, but the case is heavy and already covered by
// scripts/test-morph-cut-export.cjs); DISSOLVE as a per-pixel case — its
// mid-frame is a single-pixel hash dither (catalog.js dissolve expr), and
// that pattern cannot survive the export's yuv420p + x264 encode: measured
// 2026-11-15, the rendered segment matches the preview pixel-exactly
// (PSNR 45.85 dB, 100% A/B-mask agreement — the engine parity is real and
// is pinned at the segment stage by test-transition-parity.cjs §2), but
// re-encoding that same segment frame to yuv420p/x264 destroys it
// (PSNR 12.86 dB, 70.38% of pixels off by > 16), and the export matches the
// re-encoded segment (26.09 dB) rather than the raw one (12.77 dB). The
// transition mid-frame case therefore uses `fade` (linear blend, survives
// the encode; parity suite §1 pins it MATCHES) to exercise the same join
// timing and frame alignment. Audio peak/RMS parity is pinned by
// scripts/test-export-audio-parity.cjs, not duplicated here.
//
// Usage: node scripts/test-golden-frames.cjs   (uses xvfb-run when headless;
//   needs Xvfb :99 or a display — see AGENTS.md battery notes)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const W = 640;
const H = 360;
const FPS = 30;
// PSNR >= 30 dB, mean abs diff <= 6 levels, <= 2% of pixels off by > 16.
const PSNR_MIN = 30;
const MEAN_ABS_MAX = 6.0;
const PCT_BIG_MAX = 2.0;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// Evidence dir: fresh per run, or resume an earlier dir via
// GOLDEN_RESUME_DIR (reuses its media/projects and only runs the cases
// still missing evidence — useful when a sibling stream's `pkill -x
// electron` kills a run mid-way).
const dir = process.env.GOLDEN_RESUME_DIR && fs.existsSync(process.env.GOLDEN_RESUME_DIR)
  ? process.env.GOLDEN_RESUME_DIR
  : fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fve-golden-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
const root = path.join(__dirname, '..');

const rawFrame = (file, t, w, h) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(t), '-i', file,
  '-frames:v', '1', '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const rawPng = (file, w, h) => execFileSync(ffmpegPath, ['-v', 'error', '-i', file,
  '-vf', `scale=${w}:${h}:flags=area`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
// Comparison size = the preview PNG's own size (the stage's native size).
// The smoke fits the stage to 640x360, so this is normally identity; if the
// fit ever lands elsewhere, both sides are compared at that size rather than
// resampling the capture up to the project size.
const pngSize = async (file) => {
  const info = await probe(file);
  return { w: info.width, h: info.height };
};
const stats = (a, b) => {
  let sum = 0; let big = 0; let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    sum += d; if (d > max) max = d; if (d > 16) big++;
  }
  return { meanAbs: sum / a.length, maxAbs: max, pctBig: (100 * big) / a.length };
};

(async () => {
  // Fixed synthetic media: solid colours + a static gradient (no motion).
  const redF = path.join(dir, 'red.mp4');
  const blueF = path.join(dir, 'blue.mp4');
  const gradF = path.join(dir, 'grad.mp4');
  gen(['-f', 'lavfi', '-i', `color=c=0xc02020:s=${W}x${H}:r=${FPS}:d=3`, '-pix_fmt', 'yuv420p', redF]);
  gen(['-f', 'lavfi', '-i', `color=c=0x2040c0:s=${W}x${H}:r=${FPS}:d=3`, '-pix_fmt', 'yuv420p', blueF]);
  // The gradients source randomises its vector each invocation AND morphs
  // its colours over time, so the fixture was never the same twice (three
  // unpinned runs: three orientations, pixel-fx PSNRs 32.99 / 29.60 /
  // 33.77 dB; pinning x0/y0/x1/y1 did not help — the colours still drift
  // with T). Paint the gradient with geq instead: a static vertical
  // c0 (top) -> c1 (bottom) lerp, byte-identical every run.
  gen(['-f', 'lavfi', '-i', `nullsrc=s=${W}x${H}:r=${FPS}:d=3`, '-vf', `geq=r='32+160*Y/${H}':g='64+96*Y/${H}':b='96-32*Y/${H}'`, '-pix_fmt', 'yuv420p', gradF]);
  const media = {};
  for (const [id, p] of [['red', redF], ['blue', blueF], ['grad', gradF]]) {
    media[id] = { id, path: p, name: path.basename(p), ...(await probe(p)) };
  }
  const clipBase = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const video = (id, mediaId, out, extra = {}) => ({ ...clipBase, id, mediaId, in: 0, out, ...extra });
  const mk = (videoClips, extra = {}) => ({
    name: 'golden', ratio: '16:9', resolution: 720, width: W, height: H, fps: FPS, background: '#000000',
    media: Object.values(media), videoClips,
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [], ...extra,
  });
  const textClip = (id, text, template) => ({
    id, text, template, start: 0, duration: 2, x: 0.5, y: 0.5, size: 72,
  });

  // Fixed cases. t is chosen after any entrance is fully settled, except the
  // transition case where t is exactly mid-transition (P = 0.5).
  const cases = [
    { name: 'text-latin', t: 1.5, useTemplates: true,
      project: mk([video('v1', 'red', 2)], { textClips: [textClip('t1', 'GOLDEN', 'cap-classic')] }) },
    { name: 'text-arabic', t: 1.5, useTemplates: true,
      project: mk([video('v1', 'red', 2)], { textClips: [textClip('t1', 'السلام عليكم', 'cap-arabic')] }) },
    { name: 'pixel-fx', t: 1.0, useTemplates: false,
      project: mk([video('v1', 'grad', 2, { effects: ['fx_scanline'] })]) },
    // c2 starts at 2 - 0.6 = 1.4 (transition overlap); mid-transition t = 1.7.
    { name: 'transition-mid', t: 1.7, useTemplates: false,
      project: mk([video('v1', 'red', 2), video('v2', 'blue', 2, { transition: { type: 'fade', duration: 0.6 } })]) },
    { name: 'grade', t: 1.0, useTemplates: false,
      project: mk([video('v1', 'grad', 2, { filter: 'cinematic', filterIntensity: 100 })]) },
    { name: 'sticker', t: 1.0, useTemplates: false,
      project: mk([video('v1', 'red', 2)], { stickerClips: [{ id: 's1', sticker: 'badge-star.png', name: 'Starburst Badge', start: 0, duration: 2, transform: { scale: 0.3, x: 0, y: 0 }, opacity: 1, w: 480, h: 480 }] }) },
  ];
  const caseMeta = cases.map(({ name, t, useTemplates, project }) => {
    fs.writeFileSync(path.join(dir, `project-${name}.json`), JSON.stringify(project, null, 2));
    return { name, projectFile: `project-${name}.json`, t, useTemplates };
  });
  fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(caseMeta, null, 2));

  const electronBin = process.env.ELECTRON_BIN
    || [path.join(root, 'node_modules', 'electron', 'dist', 'electron'),
      path.join(os.homedir(), 'workspace', 'electron-dist', 'electron')].find((p) => fs.existsSync(p));
  if (!electronBin) throw new Error('electron binary not found (set ELECTRON_BIN)');
  // Launch the real app on Xvfb :99 with the battery's software-GL flags
  // (test-p2-ui-live.mjs recipe): SwiftShader WebGL, no GPU process — the
  // plain xvfb-run launch dies with "GPU process isn't usable" on this VM.
  const launchApp = async (pending) => {
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(pending, null, 2));
    const display = process.env.DISPLAY || ':99';
    const args = ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-gpu-sandbox', '--disable-accelerated-video-decode',
      '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader'];
    const child = spawn(electronBin, args, {
      cwd: root, stdio: 'inherit',
      env: { ...process.env, DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: '1',
        FVE_SMOKE: dir, FVE_SMOKE_MODE: 'golden' },
    });
    return new Promise((resolve) => {
      const kill = setTimeout(() => { child.kill('SIGKILL'); resolve(-1); }, 600000);
      child.on('exit', (c) => { clearTimeout(kill); resolve(c); });
    });
  };
  const caseDone = (c) => fs.existsSync(path.join(dir, `preview-${c.name}.png`)) && fs.existsSync(path.join(dir, `export-${c.name}.mp4`));
  let result = { cases: {} };
  // One app launch per case, up to 3 attempts each. The VM is shared with
  // the other CC streams, and their `pkill -x electron` (SIGTERM, exit 15 —
  // see a killed run's logs/crash.log: 'GPU process gone {reason:killed,
  // exitCode:15}') takes this app down with it; a multi-case run then loses
  // everything after the kill. Cases are independent, so a kill costs at
  // most one case's evidence, and a case is never marked from a partial run.
  for (const c of cases) {
    for (let attempt = 1; attempt <= 3 && !caseDone(c); attempt++) {
      const meta = caseMeta.find((m) => m.name === c.name);
      console.log(`  app run: case ${c.name} (attempt ${attempt})`);
      const code = await launchApp([meta]);
      // A kill here is environmental cross-talk (a sibling stream's
      // `pkill -x electron`), not a product failure: log it and retry.
      // Only a case with no evidence after all attempts fails the suite.
      if (code !== 0) console.log(`  case ${c.name} attempt ${attempt} exited code ${code} (killed or crashed — retrying)`);
      const resultPath = path.join(dir, 'result.json');
      if (fs.existsSync(resultPath)) {
        const r = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        result.cases = { ...result.cases, ...(r.cases || {}) };
        if (r.error) console.log(`  case ${c.name} attempt ${attempt} smoke error: ${r.error}`);
      } else {
        console.log(`  case ${c.name} attempt ${attempt} wrote no result.json (app killed mid-run — retrying)`);
      }
    }
  }
  const missing = cases.filter((c) => !caseDone(c));
  for (const c of missing) ok(false, `case ${c.name}: preview PNG + export MP4 on disk after 3 attempts`);
  if (missing.length) { console.log(`GOLDEN FRAMES FAIL — ${missing.length} case(s) produced no evidence; evidence dir ${dir}`); process.exit(1); }

  // Encoder-floor control: the same export frame read twice must be identical.
  const expLatin = path.join(dir, 'export-text-latin.mp4');
  const f1 = rawFrame(expLatin, 1.5, W, H);
  const f2 = rawFrame(expLatin, 1.5, W, H);
  ok(f1.equals(f2), 'control: same export frame read twice is identical');

  for (const c of cases) {
    const prevPng = path.join(dir, `preview-${c.name}.png`);
    const expMp4 = path.join(dir, `export-${c.name}.mp4`);
    ok(fs.existsSync(prevPng) && fs.existsSync(expMp4), `case ${c.name}: preview PNG + export MP4 on disk`);
    if (!fs.existsSync(prevPng) || !fs.existsSync(expMp4)) continue;
    const { w: cw, h: ch } = await pngSize(prevPng);
    const stage = result.cases?.[c.name]?.stage;
    console.log(`  ${c.name}: stage ${stage ? `${stage.width}x${stage.height}` : `${cw}x${ch} (from PNG)`}, t=${c.t}`);
    if (cw !== W || ch !== H) console.log(`  ${c.name}: NOTE stage is ${cw}x${ch}, not project ${W}x${H} — comparing at stage size`);
    const prevRaw = rawPng(prevPng, cw, ch);
    const expRaw = rawFrame(expMp4, c.t, cw, ch);
    // PSNR computed from the two raw buffers directly (same metric as the
    // ffmpeg psnr filter, but frame-accurate at t rather than frame 0).
    const mse = (() => { let s = 0; for (let i = 0; i < prevRaw.length; i++) { const d = prevRaw[i] - expRaw[i]; s += d * d; } return s / prevRaw.length; })();
    const psnrDb = mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse);
    const st = stats(prevRaw, expRaw);
    console.log(`  ${c.name}: PSNR ${psnrDb === Infinity ? 'inf' : psnrDb.toFixed(2)} dB (min ${PSNR_MIN}), meanAbs ${st.meanAbs.toFixed(2)} (max ${MEAN_ABS_MAX}), >16: ${st.pctBig.toFixed(2)}% (max ${PCT_BIG_MAX}%), maxAbs ${st.maxAbs}`);
    ok(psnrDb >= PSNR_MIN, `${c.name}: preview vs export PSNR ${psnrDb === Infinity ? 'inf' : psnrDb.toFixed(2)} dB >= ${PSNR_MIN}`);
    ok(st.meanAbs <= MEAN_ABS_MAX, `${c.name}: mean abs diff ${st.meanAbs.toFixed(2)} <= ${MEAN_ABS_MAX}`);
    ok(st.pctBig <= PCT_BIG_MAX, `${c.name}: pixels off by >16: ${st.pctBig.toFixed(2)}% <= ${PCT_BIG_MAX}%`);
  }

  // Negative control: preview of one case vs export of another MUST fail the
  // thresholds — proves the comparison detects a real mismatch.
  const negSize = await pngSize(path.join(dir, 'preview-text-latin.png'));
  const negPrev = rawPng(path.join(dir, 'preview-text-latin.png'), negSize.w, negSize.h);
  const negExp = rawFrame(path.join(dir, 'export-pixel-fx.mp4'), 1.0, negSize.w, negSize.h);
  const negMse = (() => { let s = 0; for (let i = 0; i < negPrev.length; i++) { const d = negPrev[i] - negExp[i]; s += d * d; } return s / negPrev.length; })();
  const negPsnr = 10 * Math.log10((255 * 255) / negMse);
  const negStats = stats(negPrev, negExp);
  console.log(`  negative control: text-latin preview vs pixel-fx export: PSNR ${negPsnr.toFixed(2)} dB, meanAbs ${negStats.meanAbs.toFixed(2)}`);
  ok(negPsnr < PSNR_MIN || negStats.meanAbs > MEAN_ABS_MAX, 'negative control: mismatched pair fails the thresholds (comparison is live)');

  console.log(failures ? `GOLDEN FRAMES FAIL — ${failures} assertion(s); evidence dir ${dir}` : `GOLDEN FRAMES OK — ${cases.length} cases, preview == export within tolerance; evidence dir ${dir}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
