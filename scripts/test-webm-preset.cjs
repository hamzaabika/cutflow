// WebM VP9 speed (P1 batch 2, item 0): the x264 preset names must never map onto VP9
// cpu-used 0/1 — measured 2026-11-15 (5 s 1080x1920, CRF 18, deadline good): cpu-used 0
// took ~169 s, 1 took 84.7 s, 2 took 40.8 s, with PSNR identical to three decimals
// (26.515 / 26.518 / 26.518 for 0 / 2 / 4). The ladder is floored at 2: the default
// 'high' preset (x264 'slow') used to land on cpu-used 0 and take ~4 min for 5 s.
// Usage: node scripts/test-webm-preset.cjs
process.env.FVE_ENCODER = 'libx264'; // deterministic software encoding
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, buildExportArgs } = require('../electron/ffmpeg.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-webm-'));
  const src = path.join(dir, 'src.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-c:v', 'libx264', '-crf', '12', src]);
  const info = await probe(src);
  const media = [{ id: 'm1', path: src, name: 'src.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const cpuUsedOf = (preset) => {
    const project = {
      name: 'webm', ratio: '16:9', resolution: 720, width: 640, height: 360, fps: 30, background: '#101010', media,
      videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 }],
      overlayClips: [], textClips: [], audioClips: [], effectClips: [], stickerClips: [],
      export: { format: 'webm', mode: 'crf', crf: 18, encoderPreset: preset, audioKbps: 192 },
    };
    const args = buildExportArgs(project, path.join(dir, 'out.webm'), { encoder: 'libx264' }).args;
    const i = args.indexOf('-cpu-used');
    return i >= 0 ? Number(args[i + 1]) : null;
  };

  const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
  const values = PRESETS.map((p) => [p, cpuUsedOf(p)]);
  for (const [p, v] of values) {
    check(v !== null, `${p}: WebM args carry -cpu-used (got ${v})`);
    check(v >= 2, `${p}: cpu-used floor 2, never 0/1 (got ${v})`);
    check(v <= 5, `${p}: cpu-used at most 5 (got ${v})`);
  }
  // The ordering is kept: a slower x264 preset never maps to a FASTER cpu-used than a
  // faster preset (equal is fine — the floor collapses the slow end).
  for (let i = 1; i < values.length; i++) {
    check(values[i][1] <= values[i - 1][1], `ordering: ${values[i][0]} (${values[i][1]}) <= ${values[i - 1][0]} (${values[i - 1][1]})`);
  }
  // The default 'high' preset is x264 'slow' — the exact case that took ~4 min for 5 s.
  check(cpuUsedOf('slow') === 2, `default 'high' preset (slow) maps to cpu-used 2 (got ${cpuUsedOf('slow')})`);

  if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
  console.log('\nAll WebM preset checks passed.');
})();
