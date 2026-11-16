// P0-05: the AI video enhancer must refuse BEFORE grinding when the job does
// not fit — free disk < estimated temp need, or frame count over the safe
// bound — and the refusal must show the estimate. A short clip must still
// pass the guard (the engine stage itself may fail on this headless VM
// without Vulkan; the guard passing is what this proves).
// Usage: node scripts/test-video-enhance-guard.mjs
process.env.FVE_ENCODER = 'libx264';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { estimateEnhance, checkEnhancePlan, runEnhance, MAX_ENHANCE_FRAMES } = require('../electron/esrgan.cjs');
const { ffmpegPath } = require('../electron/ffmpeg.cjs');

// 1. The estimate: worst-case uncompressed RGB24 PNG bytes, input + upscaled.
{
  const e = estimateEnhance({ width: 320, height: 180, duration: 2, fps: 30, scale: 2 });
  assert.equal(e.frames, 60, `frames 60, got ${e.frames}`);
  assert.equal(e.bytesIn, 60 * 320 * 180 * 3, `bytesIn ${e.bytesIn}`);
  assert.equal(e.bytesUp, 60 * 640 * 360 * 3, `bytesUp ${e.bytesUp}`);
  assert.equal(e.bytesTotal, e.bytesIn + e.bytesUp, 'total is in + up');
  console.log(`  estimate 320x180 2s 30fps 2x: ${e.frames} frames, ${(e.bytesTotal / 1048576).toFixed(1)} MB temp`);
}

// 2. Frame cap: the audit's 10-min 1080p30 clip (18,000 frames) refuses.
{
  assert.throws(
    () => checkEnhancePlan({ width: 1920, height: 1080, duration: 600, fps: 30, scale: 4 }, 512 * 1024 ** 3),
    /too long to enhance.*18,000 frames/i,
    '10-min clip refuses on frames',
  );
  console.log(`  10-min 1080p30 refuses (cap ${MAX_ENHANCE_FRAMES} frames)`);
}

// 3. Disk check: 1080p 10 s 4x needs ~31.7 GB temp; 100 MB free refuses.
{
  assert.throws(
    () => checkEnhancePlan({ width: 1920, height: 1080, duration: 10, fps: 30, scale: 4 }, 100 * 1024 ** 2),
    /Not enough free disk space.*31\.7 GB/i,
    'tiny free space refuses with the estimate shown',
  );
  console.log('  1080p 10 s 4x refuses on disk (needs ~31.7 GB, 100 MB free)');
}

// 4. A short clip passes the guard and returns its estimate.
{
  const e = checkEnhancePlan({ width: 320, height: 180, duration: 2, fps: 30, scale: 2 }, 10 * 1024 ** 3);
  assert.equal(e.frames, 60, 'short clip passes with 60 frames');
  console.log('  short clip passes the guard');
}

// 5. runEnhance live: a real 1080p 10 s clip refuses BEFORE extracting when
//    the temp dir lives on a small filesystem (this VM: /tmp is a 512 MB
//    tmpfs). Skipped with a note when the temp filesystem is roomy.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-enh-guard-'));
  const clip1080 = path.join(dir, 'clip1080.mp4');
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=30:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip1080]);
  const free = fs.statfsSync(dir).bfree * fs.statfsSync(dir).bsize;
  const need = estimateEnhance({ width: 1920, height: 1080, duration: 10, fps: 30, scale: 4 }).bytesTotal;
  if (free < need) {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cutflow-enhance-'));
    await assert.rejects(
      runEnhance({ src: clip1080, model: 'fast', scale: 4, outFile: path.join(dir, 'out.mp4'), tmpRoot: dir }),
      /Not enough free disk space/i,
      'live runEnhance refuses on disk before extracting',
    );
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cutflow-enhance-'));
    assert.deepEqual(after, before, 'refusal creates no temp work dir');
    console.log(`  live runEnhance refuses a 1080p 10 s 4x clip (${(free / 1048576).toFixed(0)} MB free, needs ~31.7 GB), no temp dir left`);
  } else {
    console.log(`  SKIP live disk refusal: temp filesystem has ${(free / 1073741824).toFixed(1)} GB free (needs ~31.7 GB)`);
  }

  // 6. The guard passes for a short clip: runEnhance gets past the guard to
  //    the pipeline — proven with a pre-cancelled token, which throws
  //    'canceled' AFTER the guard (a guard refusal would throw its own
  //    message instead). A full engine run is not in this suite: on this
  //    headless VM the Vulkan engine grinds for many minutes even on 60
  //    tiny frames. Temp cleanup on cancel is asserted too.
  const tiny = path.join(dir, 'tiny.mp4');
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', tiny]);
  {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cutflow-enhance-'));
    await assert.rejects(
      runEnhance({ src: tiny, model: 'fast', scale: 2, outFile: path.join(dir, 'tiny-out.mp4'), tmpRoot: dir, isCanceled: () => true }),
      (e) => e.canceled === true,
      'short clip passes the guard (pre-cancelled run throws canceled, not a guard refusal)',
    );
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('cutflow-enhance-'));
    assert.deepEqual(after, before, 'cancelled run leaves no temp work dir');
    console.log('  short clip passes the guard (cancelled run reaches the pipeline, temp cleaned up)');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('video-enhance-guard OK — the enhancer refuses jobs that do not fit, before grinding');
