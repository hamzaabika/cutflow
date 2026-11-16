// Professional Color Management (P1-53) — the input colour-space display, the
// LUT double-application guard, and SDR/HDR parity on a colour-reference clip.
//   Part A (pure): colourSpaceLabel / colourAction (src/colour.js) and
//     gradeLutDuplicatesFilter (src/fx/lut.js).
//   Part B (real export): a true HLG BT.2020 clip through the REAL export
//     path (runExport) must match a reference encode that applies the app's
//     own TONEMAP (toSdr), and must be tagged BT.709. The control — the same
//     clip encoded with NO tonemap — must score clearly worse, which is what
//     proves the tonemap is doing the work (without it the picture comes out
//     pale and yellowish, per the comment at electron/ffmpeg.cjs:141).
// Usage: node scripts/test-colour-management.cjs
process.env.FVE_ENCODER = 'libx264'; // deterministic software encoding for measurements
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath, ffprobePath, probe, runExport, toSdr } = require('../electron/ffmpeg.cjs');

const W = 1280;
const H = 720;
const DUR = 2;
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

function psnrVs(a, b) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', a, '-i', b,
    '-filter_complex', '[0:v][1:v]psnr', '-f', 'null', '-'], { maxBuffer: 16 * 1024 * 1024 });
  const err = (r.stderr || '').toString();
  const m = err.match(/average:([0-9.]+|inf)/);
  if (!m) throw new Error(`no PSNR line: ${err.slice(-300)}`);
  return m[1] === 'inf' ? 99 : Number(m[1]);
}
function probeColour(file) {
  const j = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  return { color_space: v.color_space, color_primaries: v.color_primaries, color_transfer: v.color_transfer };
}

(async () => {
  const { colourSpaceLabel, colourAction } = await import('../src/colour.js');
  const { gradeLutDuplicatesFilter } = await import('../src/fx/lut.js');
  const { lutFilterRef } = await import('../src/fx/filters.js');

  // ---- Part A: labels -----------------------------------------------------
  check(colourSpaceLabel({ type: 'video', hdr: true, colorSpace: 'bt2020nc', colorTransfer: 'arib-std-b67' }) === 'BT.2020 · HLG', 'HLG labels BT.2020 · HLG');
  check(colourSpaceLabel({ type: 'video', hdr: true, colorSpace: 'bt2020nc', colorTransfer: 'smpte2084' }) === 'BT.2020 · PQ', 'PQ labels BT.2020 · PQ');
  check(colourSpaceLabel({ type: 'video', colorSpace: 'smpte170m', colorTransfer: 'bt709' }) === 'BT.601', 'BT.601 source labels BT.601');
  check(colourSpaceLabel({ type: 'video', colorSpace: 'bt709', colorTransfer: 'bt709' }) === null, 'plain BT.709 has no badge (native space)');
  check(colourSpaceLabel({ type: 'video' }) === null, 'untagged source has no badge');
  check(colourSpaceLabel({ type: 'audio' }) === null, 'audio has no colour label');
  check(colourAction({ type: 'video', hdr: true, colorSpace: 'bt2020nc', colorTransfer: 'arib-std-b67' }) === 'tonemap', 'HDR action is tonemap');
  check(colourAction({ type: 'video', colorSpace: 'smpte170m', colorTransfer: 'bt709' }) === 'convert', 'BT.601 action is convert');
  check(colourAction({ type: 'video', colorSpace: 'bt709', colorTransfer: 'bt709' }) === null, 'BT.709 action is none');

  // ---- Part A: LUT dedupe -------------------------------------------------
  const amber = { bundled: 'slay-01-amber.cube' };
  const fade = { bundled: 'slay-02-fade.cube' };
  const grade = { ref: amber, name: 'Amber', intensity: 100 };
  check(gradeLutDuplicatesFilter(grade, amber) === true, 'same file in both slots is a duplicate');
  check(gradeLutDuplicatesFilter(grade, fade) === false, 'different file in the grade slot is not a duplicate');
  check(gradeLutDuplicatesFilter(grade, null) === false, 'no filter LUT (intensity 0) is not a duplicate — the grade LUT still runs');
  check(gradeLutDuplicatesFilter(null, amber) === false, 'no grade LUT is not a duplicate');
  check(gradeLutDuplicatesFilter({ ref: { path: '/tmp/x.cube' }, intensity: 100 }, amber) === false, 'a user .cube in the grade slot never equals a bundled filter LUT');
  check(lutFilterRef({ filter: 'lut:slay-01-amber.cube', filterIntensity: 100 })?.bundled === 'slay-01-amber.cube', 'lutFilterRef resolves the bundled filter LUT');
  check(lutFilterRef({ filter: 'lut:slay-01-amber.cube', filterIntensity: 0 }) === null, 'lutFilterRef is null at intensity 0 (filter switched off)');

  // ---- Part B: HDR parity -------------------------------------------------
  const { resolveExport } = await import('../src/exportQuality.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-colour-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const hlg = path.join(dir, 'hlg.mp4');
  // True HLG values: testsrc2 (BT.709) converted to BT.2020 primaries + HLG transfer.
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=30:duration=${DUR}`,
    '-vf', 'zscale=tin=bt709:min=bt709:pin=bt709:t=arib-std-b67:m=bt2020nc:p=bt2020:rin=tv:r=tv,format=yuv420p10le',
    '-color_primaries', 'bt2020', '-color_trc', 'arib-std-b67', '-colorspace', 'bt2020nc',
    '-c:v', 'libx264', '-crf', '10', hlg]);
  const info = await probe(hlg);
  check(info.hdr === true, `probe flags the HLG clip as HDR (hdr=${info.hdr})`);
  check(info.colorSpace === 'bt2020nc' && info.colorTransfer === 'arib-std-b67', `probe reads BT.2020/HLG (${info.colorSpace}/${info.colorTransfer})`);
  check(colourSpaceLabel(info) === 'BT.2020 · HLG' && colourAction(info) === 'tonemap', 'the probed HLG clip labels BT.2020 · HLG and tonemaps');

  const media = [{ id: 'm1', path: hlg, name: 'hlg.mp4', ...info }];
  const project = {
    name: 'colour', ratio: '16:9', resolution: 720, width: W, height: H, fps: 30, background: '#101010', media,
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: DUR, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    exportSettings: { preset: 'high', custom: {} },
  };
  project.export = resolveExport(project, { libx265: true });
  const out = path.join(dir, 'app.mp4');
  const job = runExport(project, out, () => {});
  await job.promise;
  check(fs.existsSync(out), 'app export of the HLG clip completes');
  const outTags = probeColour(out);
  check(outTags.color_space === 'bt709' && outTags.color_transfer === 'bt709',
    `app export is tagged BT.709 (${outTags.color_space}/${outTags.color_transfer})`);

  // Reference: the same clip through the app's own TONEMAP, same encoder settings as 'high'.
  const tonemap = toSdr({ hdr: true }).slice(1);
  const ref = path.join(dir, 'ref.mp4');
  gen(['-i', hlg, '-vf', tonemap, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', ref]);
  const control = path.join(dir, 'control.mp4');
  gen(['-i', hlg, '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', control]);
  const pApp = psnrVs(out, ref);
  const pCtl = psnrVs(control, ref);
  console.log(`  PSNR app-export vs tonemap reference: ${pApp.toFixed(2)} dB; no-tonemap control: ${pCtl.toFixed(2)} dB`);
  check(pApp >= 35, `app export matches the tonemap reference (PSNR ${pApp.toFixed(2)} dB >= 35)`);
  check(pApp - pCtl >= 5, `the tonemap is doing the work: app beats the no-tonemap control by ${(pApp - pCtl).toFixed(2)} dB (>= 5)`);

  console.log(failures === 0 ? '\nCOLOUR MANAGEMENT OK' : `\nCOLOUR MANAGEMENT FAILURES: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
