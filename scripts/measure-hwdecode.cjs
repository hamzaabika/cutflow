// FB-17 (P1-22) — hardware decode, measured on THIS VM's Mesa path.
// Records what this machine can actually answer and states plainly what it
// cannot: ffmpeg -hwaccels, a vaapi decode attempt, a CPU-decode timing
// baseline, and the adaptive decision the app would take here. The
// multi-tier A/B (old/new Intel, Apple Silicon, AMD/NVIDIA, dropped-frame
// and seek measurements per tier) is UNRUNNABLE here — this VM has one Mesa
// lavapipe software path and no such hardware — and is reported as such,
// not faked.
// Run: TMPDIR=~/workspace/.tmp-battery node scripts/measure-hwdecode.cjs
// Writes: ~/workspace/cutflow-audit-20261115/f4-17-hwdecode-measure-2026-11-15.{json,md}
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const { resolveDecodeMode, probeHwaccels, gpuRendererName } = require('../electron/hwdecode.cjs');

const OUT_DIR = '/home/hatch/workspace/cutflow-audit-20261115';
const STAMP = '2026-11-15';
const run = (args, opts = {}) => spawnSync(ffmpegPath, args, { encoding: 'utf8', timeout: 60000, ...opts });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-hwdec-'));
  const src = path.join(dir, 'cam.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=6', '-pix_fmt', 'yuv420p', src]);

  const hwaccels = probeHwaccels(ffmpegPath);
  // vaapi decode attempt (the only plausible accelerator on a Mesa/Linux box).
  const vaapi = run(['-y', '-hide_banner', '-loglevel', 'error', '-hwaccel', 'vaapi', '-hwaccel_device', '/dev/dri/renderD128', '-i', src, '-f', 'null', '-']);
  const vaapiDeviceExists = fs.existsSync('/dev/dri/renderD128');
  // CPU decode baseline: decode the same 6 s to null, three runs.
  const cpuRuns = [];
  for (let i = 0; i < 3; i++) {
    const t0 = process.hrtime.bigint();
    const r = run(['-y', '-hide_banner', '-loglevel', 'error', '-i', src, '-f', 'null', '-']);
    cpuRuns.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6, exit: r.status });
  }
  // The decision the app takes on this machine: software renderer, no hwaccel.
  const gpuInfo = { gpuDevice: [{ active: true, deviceName: '', vendorId: 0, deviceId: 0 }], auxAttributes: { gl_renderer: 'llvmpipe (LLVM 15, 256 bits)' } };
  const decision = resolveDecodeMode({ settings: { videoDecode: 'auto', safeMode: false }, gpuInfo, hwaccels });
  const data = {
    generated: STAMP,
    host: `${os.cpus()[0].model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    renderer: gpuRendererName(gpuInfo),
    hwaccels,
    vaapiDeviceExists,
    vaapiAttempt: { exit: vaapi.status, stderrTail: String(vaapi.stderr || '').slice(-300) },
    cpuDecodeMs_6s1080p: cpuRuns.map((r) => Math.round(r.ms)),
    cpuDecodeExit: cpuRuns.map((r) => r.exit),
    decision,
    multiTierAB: 'UNRUNNABLE here: no old/new Intel, Apple Silicon, AMD or NVIDIA hardware on this VM — one Mesa lavapipe software path only. The buildable core (adaptive logic + denylist + safe-mode setting) is done and unit-tested; per-tier dropped-frame/seek A/B needs real hardware.',
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `f4-17-hwdecode-measure-${STAMP}.json`), JSON.stringify(data, null, 2));
  const md = [`# FB-17 (P1-22) — hardware decode, measured on this VM — ${STAMP}`, '', `Host: ${data.host}`, `Renderer: ${data.renderer}`, '',
    `- FFmpeg hwaccels on this build: ${hwaccels.length ? hwaccels.join(', ') : '(none)'}`,
    `- /dev/dri/renderD128 present: ${vaapiDeviceExists}`,
    `- vaapi decode attempt exit: ${vaapi.status} — ${String(vaapi.stderr || '').slice(-300) || '(no stderr)'}`,
    `- CPU decode of 6 s 1080p (3 runs): ${data.cpuDecodeMs_6s1080p.join(', ')} ms`,
    `- Adaptive decision on this machine (auto): **${decision.mode}** — ${decision.reason}`,
    '',
    '## Multi-tier A/B',
    '',
    data.multiTierAB,
    '', `Raw data: \`f4-17-hwdecode-measure-${STAMP}.json\` in this folder.`, ''];
  fs.writeFileSync(path.join(OUT_DIR, `f4-17-hwdecode-measure-${STAMP}.md`), md.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(data, null, 2));
  console.log('MEASURE DONE');
})().catch((e) => { console.error('MEASURE FAIL', e); process.exit(1); });
