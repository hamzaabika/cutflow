// Hardware encoding (10/10 perf program): the pick must be PROVEN, not
// assumed — an encoder is used only when a binary that lists it also passes a
// real 1-frame test encode on it; VAAPI (the Intel-on-Linux path) is wired
// with its device flag and hwupload stage; and when a forced hardware pick
// cannot actually encode, runExport must fall back to CPU and still deliver.
// On a GPU-less machine every hardware path is probe-only here: the suite
// proves the probing, the argument assembly, and the fallback end to end.
// Usage: node scripts/test-hwencode.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FF = path.resolve(__dirname, '../electron/ffmpeg.cjs');

function tinyProject(mediaFile) {
  return {
    name: 'hw', width: 320, height: 180, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: mediaFile, type: 'video', duration: 1, hasAudio: false, width: 320, height: 180 }],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 1, speed: 1 }],
    overlayClips: [], textClips: [], audioClips: [],
  };
}

(async () => {
  const ff = require(FF);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-hw-'));
  const src = path.join(tmp, 'src.mp4');
  const gen = spawnSync(ff.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src], { encoding: 'utf8' });
  assert.equal(gen.status, 0, `fixture generation: ${gen.stderr}`);

  // 1) Per-binary encoder presence: the bundled ffmpeg ships NO hardware
  // encoders at all (its list is software-only), which is exactly why the
  // pick must be allowed to come from a system ffmpeg.
  assert.equal(ff.binaryHasEncoder(ff.ffmpegPath, 'h264_nvenc'), false, 'bundled ffmpeg has no NVENC');
  assert.equal(ff.binaryHasEncoder(ff.ffmpegPath, 'libx264'), true, 'bundled ffmpeg has libx264');
  const sys = process.platform === 'linux' && fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : null;
  if (sys) assert.equal(ff.binaryHasEncoder(sys, 'h264_nvenc'), true, 'system ffmpeg lists NVENC');

  // 2) The pick is consistent: whatever it names, the named binary really
  // lists that encoder (for libx264 that is the bundled binary).
  const info = await ff.pickEncoderInfo();
  assert.ok(ff.binaryHasEncoder(info.binary, info.encoder), `pick ${info.encoder} is listed by ${info.binary}`);
  assert.equal(await ff.pickEncoder(), info.encoder, 'pickEncoder projects the pick-info name');
  console.log(`  pick on this machine: ${info.encoder} via ${info.binary}${info.device ? ` (${info.device})` : ''}`);

  // 3) VAAPI argument assembly: device flag before the first input, an
  // hwupload tail stage in the graph, NV12 upload instead of a software
  // -pix_fmt, and the encoder named at the codec position. CPU control build
  // keeps -pix_fmt yuv420p + libx264 and has no device flag.
  const proj = tinyProject(src);
  const vArgs = ff.buildExportArgs(proj, path.join(tmp, 'v.mp4'), { encoder: 'h264_vaapi', vaapiDevice: '/dev/dri/renderD128' }).args;
  const di = vArgs.indexOf('-vaapi_device');
  assert.ok(di >= 0 && vArgs[di + 1] === '/dev/dri/renderD128', 'vaapi device flag present');
  assert.ok(di < vArgs.indexOf('-i'), 'vaapi device flag precedes the inputs (input option)');
  assert.ok(vArgs.join(' ').includes('format=nv12,hwupload'), 'graph uploads frames to the device');
  assert.equal(vArgs[vArgs.indexOf('-c:v') + 1], 'h264_vaapi', 'codec position names h264_vaapi');
  assert.ok(!vArgs.includes('-pix_fmt'), 'no software -pix_fmt with VAAPI');
  const cArgs = ff.buildExportArgs(proj, path.join(tmp, 'c.mp4'), {}).args;
  assert.ok(!cArgs.includes('-vaapi_device'), 'CPU build has no device flag');
  assert.equal(cArgs[cArgs.indexOf('-c:v') + 1], 'libx264', 'CPU build encodes with libx264');
  assert.ok(cArgs.includes('-pix_fmt'), 'CPU build keeps -pix_fmt');

  // 4) Forced-hardware fallback, end to end (child process: the pick is
  // cached per process). FVE_ENCODER forces VAAPI from the system ffmpeg;
  // on a machine without a usable VAAPI device the test encode inside the
  // export must fail and runExport must retry on CPU and still deliver a
  // valid file. Skipped where no system ffmpeg exists to force from.
  if (sys && !ff.vaapiDevice()) {
    const child = spawnSync(process.execPath, ['-e', `
      const ff = require(${JSON.stringify(FF)});
      (async () => {
        const pick = await ff.pickEncoder();
        if (pick !== 'h264_vaapi') { console.error('forced pick not honoured: ' + pick); process.exit(2); }
        const job = ff.runExport(JSON.parse(process.env.CF_PROJ), process.env.CF_OUT, () => {});
        await job.promise;
        const info = await ff.probe(process.env.CF_OUT);
        if (!info || Math.abs(info.duration - 1) > 0.35) { console.error('bad output', info); process.exit(3); }
        console.log('fallback export OK, duration ' + info.duration);
      })().catch((e) => { console.error(e.message); process.exit(1); });
    `], { env: { ...process.env, FVE_ENCODER: 'h264_vaapi', FVE_FFMPEG_HW: sys, CF_PROJ: JSON.stringify(tinyProject(src)), CF_OUT: path.join(tmp, 'fallback.mp4') }, encoding: 'utf8', timeout: 120000 });
    assert.equal(child.status, 0, `forced-HW export falls back to CPU and delivers: ${child.stdout} ${child.stderr}`);
    console.log(`  ${child.stdout.trim()}`);
  } else {
    console.log('  forced-HW fallback check skipped (no system ffmpeg, or a VAAPI device exists here)');
  }

  console.log('HWENCODE OK');
})().catch((e) => { console.error(e); process.exit(1); });
