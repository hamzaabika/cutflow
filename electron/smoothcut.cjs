// Smooth Cut (P2-06), main-process side: the CJS mirror of the pure decisions in
// src/smoothCut.js (keep them in sync — scripts/test-p2b-smoothcut.mjs asserts
// it) plus the frame-difference check that decides the fallback.
//
// The check extracts the last frame before the cut and the first frame after it
// and scores them with FFmpeg's psnr filter. A talking-head jump cut keeps the
// framing, so the two frames score high; a big pose/framing change scores low
// and would warp a face or hands if smoothed, so the cut stays hard. The
// threshold (24 dB) is deliberately conservative: a false positive only costs a
// smoothing, never a warp.
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const SMOOTH_CUT_PSNR_MIN = 24;
const SMOOTH_CUT_DUR_MIN = 0.05;
const SMOOTH_CUT_DUR_MAX = 0.3;
const clampDur = (d) => Math.min(SMOOTH_CUT_DUR_MAX, Math.max(SMOOTH_CUT_DUR_MIN, Number(d) || 0.15));

// Mirror of src/smoothCut.js smoothCutBlendDur.
function smoothCutBlendDur(clips, i) {
  const c = clips[i];
  if (!c || !c.smoothCut || c.smoothCut.mode !== 'blend') return 0;
  if (c.smoothCut.fallback) return 0;
  const prev = clips[i - 1];
  if (!prev || !prev.mediaId || prev.mediaId !== c.mediaId) return 0;
  if (Math.abs((prev.out ?? 0) - (c.in ?? 0)) > 0.05) return 0;
  return clampDur(c.smoothCut.dur ?? 0.12);
}

function run(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim().split('\n').pop() || err.message));
      else resolve({ stdout, stderr });
    });
  });
}

async function grabFrame(ffmpegPath, srcPath, at, outPng) {
  await run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', srcPath, '-frames:v', '1', outPng]);
}

async function psnrBetween(ffmpegPath, aPng, bPng) {
  const { stderr } = await run(ffmpegPath, ['-y', '-hide_banner', '-nostats', '-i', aPng, '-i', bPng,
    '-filter_complex', '[0:v][1:v]psnr', '-f', 'null', '-']);
  const m = /average:\s*(inf|[\d.]+)/i.exec(stderr);
  if (!m) throw new Error('Could not read the PSNR score from FFmpeg.');
  return m[1] === 'inf' ? Infinity : Number(m[1]);
}

// { prevPath, nextPath, prevAt, nextAt, tmpDir } — prevAt is the time of the last
// frame before the cut, nextAt the first frame after it (source seconds).
// Returns { psnr, fallback } where fallback is 'large-motion' or null.
async function checkCut(ffmpegPath, { prevPath, nextPath, prevAt, nextAt, tmpDir }) {
  if (!prevPath || !fs.existsSync(prevPath)) throw new Error('The clip before the cut is missing its media file.');
  if (!nextPath || !fs.existsSync(nextPath)) throw new Error('The clip after the cut is missing its media file.');
  fs.mkdirSync(tmpDir, { recursive: true });
  const aPng = path.join(tmpDir, 'smoothcut-a.png');
  const bPng = path.join(tmpDir, 'smoothcut-b.png');
  try {
    await grabFrame(ffmpegPath, prevPath, Math.max(0, prevAt), aPng);
    await grabFrame(ffmpegPath, nextPath, Math.max(0, nextAt), bPng);
    const psnr = await psnrBetween(ffmpegPath, aPng, bPng);
    return { psnr, fallback: psnr < SMOOTH_CUT_PSNR_MIN ? 'large-motion' : null };
  } finally {
    for (const f of [aPng, bPng]) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  }
}

module.exports = { SMOOTH_CUT_PSNR_MIN, clampDur, smoothCutBlendDur, checkCut };
