// Sprint 6 — the non-BT.709 colour row, resolved: it was a REAL divergence, now fixed.
// The export's output stage tags every file BT.709. Before this sprint a source whose
// own colour description was NOT BT.709 (a BT.601 DVD rip, a BT.470 broadcast capture,
// a BT.2020 SDR file) was decoded with its own matrix and then simply LABELLED 709 —
// every player decoded the values with the wrong matrix and colours shifted. Measured
// on the fixture below (testsrc2 encoded as smpte170m): the old retag-only behaviour
// reads a mean abs 10.97 per channel sample away from the correctly converted picture.
//
// The fix: probe() captures the source's colour description (colorSpace /
// colorPrimaries / colorTransfer / colorRange), and pictureSource + the fx-pass clip
// decoder convert to true BT.709 at decode time (electron/ffmpeg.cjs colorFix, the
// colorspace filter), next to the HDR tonemap. Conservative by design: untagged or
// partly-unknown sources are left exactly as before. This suite pins:
//   1. probe captures the description; colorFix builds the conversion only when the
//      description is non-709 and fully mappable.
//   2. A 601 export comes out tagged BT.709 AND pixel-matched to an independent
//      reference conversion (mean abs <= 3), while the same media with its colour
//      fields blanked (the old behaviour) misses the reference by > 6 — the
//      divergence, and its closure, in numbers.
//   3. A BT.2020 SDR source converts the same way.
//   4. An untagged source gets NO conversion anywhere in the graph (unchanged path).
// Usage: node scripts/test-colour-export.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport, buildExportArgs, colorFix } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-colour-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  // testsrc2 -> YUV with the encoder's default (601-family) conversion, tagged 601:
  // a genuine 601-encoded, 601-tagged file.
  const src601 = path.join(dir, 'src601.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'smpte170m', '-colorspace', 'smpte170m', '-color_trc', 'bt709', src601]);
  const src2020 = path.join(dir, 'src2020.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p',
    '-color_primaries', 'bt2020', '-colorspace', 'bt2020nc', '-color_trc', 'bt2020-10', src2020]);
  const srcPlain = path.join(dir, 'srcplain.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', srcPlain]);

  const frameRgb = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 24 });
  // The reference "correctly converted picture", built two-step because a one-step
  // -vf colorspace decode is NOT a valid reference in this FFmpeg build: the CLI's
  // final YUV->RGB conversion follows the input stream's original colour props and
  // ignores the filter's updated frame props (measured: a correctly converted file
  // decoded plainly lands 1.09 from this reference; the one-step decode lands ~10).
  // Step 1 extracts the converted YUV samples (sample extraction is matrix-free);
  // step 2 decodes them with explicit BT.709 input props — what a player shows for
  // a true-709 file.
  const frameYuv = (file, t, vf) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', ...(vf ? ['-vf', vf] : []), '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], { maxBuffer: 1 << 24 });
  const yuvToRgb709 = (yuv) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error',
    '-color_primaries', 'bt709', '-colorspace', 'bt709', '-color_trc', 'bt709',
    '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-i', 'pipe:0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: yuv, maxBuffer: 1 << 24 });
  const referenceConverted = (file, vf) => yuvToRgb709(frameYuv(file, 0.7, vf));
  const meanDiff = (a, b) => {
    let s = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i]);
    return s / n;
  };
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const exportOne = async (mediaEntry, tag) => {
    const project = {
      name: 'colour', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000',
      media: [mediaEntry],
      videoClips: [{ ...base, id: 'c1', mediaId: mediaEntry.id, in: 0, out: 1.5 }],
      overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
    };
    const out = path.join(dir, `out-${tag}.mp4`);
    await runExport(project, out, null).promise;
    return { out, project };
  };

  // ---- 1) probe + colorFix unit behaviour ----
  const m601 = { id: 'm601', path: src601, name: 'src601.mp4', ...(await probe(src601)) };
  ok(m601.colorSpace === 'smpte170m' && m601.colorPrimaries === 'smpte170m' && m601.colorTransfer === 'bt709',
    `probe captures the 601 description (${m601.colorSpace}/${m601.colorPrimaries}/${m601.colorTransfer})`);
  ok(colorFix(m601).includes('colorspace=all=bt709'), 'colorFix converts a 601 source');
  ok(colorFix({ colorSpace: 'bt709', colorPrimaries: 'bt709', colorTransfer: 'bt709' }) === '', 'colorFix leaves a 709 source alone');
  ok(colorFix({}) === '' && colorFix({ colorSpace: 'unknown', colorPrimaries: 'bt2020', colorTransfer: 'bt2020-10' }) === '', 'colorFix leaves untagged / partly-unknown sources alone');
  ok(colorFix({ hdr: true, colorSpace: 'bt2020nc', colorPrimaries: 'bt2020', colorTransfer: 'smpte2084' }) === '', 'colorFix leaves HDR to the tonemap path');

  // ---- 2) 601 export: tags true, pixels converted; the old behaviour measured ----
  const ref601 = referenceConverted(src601, 'colorspace=all=bt709:ispace=smpte170m:iprimaries=smpte170m,format=yuv420p');
  const fixed = await exportOne(m601, '601-fixed');
  const fixedInfo = await probe(fixed.out);
  ok(fixedInfo.colorSpace === 'bt709' && fixedInfo.colorPrimaries === 'bt709' && fixedInfo.colorTransfer === 'bt709',
    `601 export is tagged BT.709 (${fixedInfo.colorSpace}/${fixedInfo.colorPrimaries}/${fixedInfo.colorTransfer})`);
  const dFixed = meanDiff(frameRgb(fixed.out, 0.7), ref601);
  console.log(`601 export vs reference conversion: mean abs diff ${dFixed.toFixed(3)}`);
  ok(dFixed <= 3, '601 export pixels match the reference conversion within 3');
  const m601Blank = { ...m601, colorSpace: '', colorPrimaries: '', colorTransfer: '', colorRange: '' };
  const old = await exportOne(m601Blank, '601-old');
  const dOld = meanDiff(frameRgb(old.out, 0.7), ref601);
  console.log(`601 retag-only (old behaviour) vs reference conversion: mean abs diff ${dOld.toFixed(3)}`);
  ok(dOld > 6 && dOld > dFixed + 3, 'the old retag-only behaviour measurably diverged (and the fix closes it)');

  // ---- 2b) Partially-tagged source: space only (the smptebars shape) ----
  // Regression pin: this media probes as colorSpace=bt470bg with primaries and
  // transfer ABSENT, and its frames carry primaries=unknown — the colorspace filter
  // refuses unknown frame props, so an earlier version of colorFix (which pinned
  // only the non-709 components) killed the whole export with "Unsupported input
  // primaries 2 (unknown)". The export must succeed and come out tagged BT.709.
  {
    const bars = path.join(dir, 'bars.mp4');
    gen(['-f', 'lavfi', '-i', `smptebars=size=${W}x${H}:rate=${FPS}:duration=2`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', bars]);
    const mBars = { id: 'mbars', path: bars, name: 'bars.mp4', ...(await probe(bars)) };
    ok(mBars.colorSpace === 'bt470bg' && !mBars.colorPrimaries, `bars fixture is space-only tagged (${mBars.colorSpace}/${mBars.colorPrimaries || 'absent'})`);
    const barsOut = await exportOne(mBars, 'bars');
    const barsInfo = await probe(barsOut.out);
    ok(barsInfo.hasVideo && barsInfo.colorSpace === 'bt709', 'space-only source: export succeeds, tagged BT.709');
  }

  // ---- 3) BT.2020 SDR export ----
  const m2020 = { id: 'm2020', path: src2020, name: 'src2020.mp4', ...(await probe(src2020)) };
  ok(colorFix(m2020).includes('ispace=bt2020ncl'), 'colorFix converts a BT.2020 SDR source');
  const ref2020 = referenceConverted(src2020, 'colorspace=all=bt709:ispace=bt2020ncl:iprimaries=bt2020:itrc=bt2020-10,format=yuv420p');
  const fixed2020 = await exportOne(m2020, '2020-fixed');
  const info2020 = await probe(fixed2020.out);
  const d2020 = meanDiff(frameRgb(fixed2020.out, 0.7), ref2020);
  console.log(`BT.2020 export vs reference conversion: mean abs diff ${d2020.toFixed(3)}, tags ${info2020.colorSpace}/${info2020.colorPrimaries}/${info2020.colorTransfer}`);
  ok(info2020.colorSpace === 'bt709' && d2020 <= 3, 'BT.2020 SDR export is converted and tagged BT.709');

  // ---- 3b) The layered path (overlay clip) ----
  // The layered path retagged too, before the fix: its format=rgba step read a 601
  // overlay's values with the wrong matrix (measured 10.6 mean abs from the
  // reference). buildLayer now converts at the end of its YUV chain — after the fit
  // scale, before format=rgba; everything past that point is RGBA (no matrix work)
  // and composite() re-encodes with the explicit BT.709 matrix (TO_YUV709).
  {
    const black = { id: 'mbk', path: path.join(dir, 'black.mp4'), name: 'black.mp4' };
    gen(['-f', 'lavfi', '-i', `color=c=black:size=${W}x${H}:rate=${FPS}:duration=2`, '-pix_fmt', 'yuv420p', black.path]);
    Object.assign(black, await probe(black.path));
    const project = {
      name: 'colour-overlay', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000',
      media: [black, m601],
      videoClips: [{ ...base, id: 'c1', mediaId: 'mbk', in: 0, out: 1.5 }],
      overlayClips: [{ ...base, id: 'o1', mediaId: 'm601', start: 0, in: 0, out: 1.5, layer: 0, transform: { scale: 1, x: 0, y: 0 } }],
      textClips: [], audioClips: [], stickerClips: [], effectClips: [],
    };
    const out = path.join(dir, 'out-overlay601.mp4');
    await runExport(project, out, null).promise;
    const dLayer = meanDiff(frameRgb(out, 0.7), ref601);
    console.log(`601 overlay (layered path) vs reference conversion: mean abs diff ${dLayer.toFixed(3)}`);
    ok(dLayer <= 3, 'layered path: the 601 overlay lands converted (end-of-chain conversion + explicit 709 re-encode)');
  }

  // ---- 4) Untagged source: the graph is unchanged ----
  const mPlain = { id: 'mp', path: srcPlain, name: 'srcplain.mp4', ...(await probe(srcPlain)) };
  const { project } = await exportOne(mPlain, 'plain');
  const graph = buildExportArgs(project, path.join(dir, 'x.mp4')).args.join(' ');
  ok(!graph.includes('colorspace=all'), 'untagged source: no colorspace conversion filter anywhere in the export graph');
  ok(colorFix(mPlain) === '', 'untagged source: colorFix is empty');

  if (fails.length) { console.error(`COLOUR EXPORT FAIL (${fails.length}): ${fails.join(' | ')}`); process.exit(1); }
  console.log('COLOUR EXPORT OK — non-709 sources are converted to true BT.709, untagged sources untouched');
})().catch((e) => { console.error('COLOUR EXPORT FAIL:', e.message); process.exit(1); });
