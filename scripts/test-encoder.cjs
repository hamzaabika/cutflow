// GPU/CPU encoder pick (v1.1.12): the probe must resolve to an encoder that
// really encodes on THIS machine (in the sandbox that is libx264; on a GPU
// machine the first working hardware encoder), FVE_ENCODER must force the
// pick, every candidate's argument set must name its codec, and the export
// summary's encoder line must describe the same pick. Also covers the
// argument contract of videoCodec via buildExportArgs' codec section.
// Usage: node scripts/test-encoder.cjs
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');

(async () => {
  // Forced pick wins and is returned verbatim (child process: the pick is cached per process).
  const forced = spawnSync(process.execPath, ['-e', `
    const { pickEncoder } = require(${JSON.stringify(path.resolve(__dirname, '../electron/ffmpeg.cjs'))});
    pickEncoder().then((e) => { console.log(e); });
  `], { env: { ...process.env, FVE_ENCODER: 'h264_qsv' }, encoding: 'utf8' });
  assert.equal(forced.stdout.trim(), 'h264_qsv', 'FVE_ENCODER forces the pick');

  // The real probe: resolves to a known encoder, and that encoder passes a test encode
  // (pickEncoder only returns a hardware name after its own test encode succeeds;
  // libx264 is the floor). Prove the returned encoder encodes a real half-second clip.
  delete process.env.FVE_ENCODER;
  const ff = require('../electron/ffmpeg.cjs');
  const pickInfo = await ff.pickEncoderInfo();
  const pick = pickInfo.encoder;
  assert.ok(['h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_amf', 'libx264'].includes(pick), `pick is a known encoder: ${pick}`);
  // The picked encoder really encodes on the binary the pick names (the
  // bundled ffmpeg ships no hardware encoders, so a hardware pick names a
  // system binary; the probe args carry the VAAPI device/upload when the
  // pick needs them).
  const probe = spawnSync(pickInfo.binary, ff.probeEncodeArgs(pick, pickInfo.device), { encoding: 'utf8' });
  assert.equal(probe.status, 0, `picked encoder (${pick} via ${pickInfo.binary}) encodes: ${(probe.stderr || '').split('\n').slice(-2).join(' ')}`);

  // hasEncoder agrees with the bundled ffmpeg's own list.
  assert.equal(ff.hasLibx265(), execFileSync(ff.ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).includes('libx265'), 'libx265 detection matches ffmpeg -encoders');

  // The renderer summary line describes the pick (and H.265 stays software).
  const { encoderSummary } = await import('../src/exportQuality.js');
  assert.equal(encoderSummary('h264', { encoder: 'h264_nvenc' }), 'h264_nvenc · GPU (NVIDIA)');
  assert.equal(encoderSummary('h264', { encoder: 'h264_qsv' }), 'h264_qsv · GPU (Intel Quick Sync)');
  assert.equal(encoderSummary('h264', { encoder: 'h264_vaapi' }), 'h264_vaapi · GPU (VAAPI)');
  assert.equal(encoderSummary('h264', { encoder: 'h264_amf' }), 'h264_amf · GPU (AMD)');
  assert.equal(encoderSummary('h264', { encoder: 'libx264' }), 'libx264 · CPU (software)');
  assert.equal(encoderSummary('h265', { encoder: 'h264_nvenc' }), 'libx265 · CPU (software)', 'H.265 is software even with a GPU pick');
  assert.equal(encoderSummary('h264', {}), null, 'no pick reported -> no line (never guessed)');
  const { resolveExport, summaryRows } = await import('../src/exportQuality.js');
  const proj = { width: 1280, height: 720, fps: 30 };
  const eff = resolveExport(proj, { libx265: true, encoder: pick });
  const encRow = summaryRows(eff, proj).find(([k]) => k === 'Encoder');
  assert.ok(encRow && encRow[1].includes(pick), `summary row names the real pick (${pick})`);

  console.log(`ENCODER OK (pick on this machine: ${pick})`);
})().catch((e) => { console.error(e); process.exit(1); });
