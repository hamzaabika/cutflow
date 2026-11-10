// Scene (shot) detection (Sprint 10) — a local FFmpeg pass over a media
// file that reports the hard cuts in it. The pass is the `scene` score the
// select filter computes per frame (a normalized frame-difference the
// FFmpeg documentation itself offers for shot detection): frames whose
// score clears the threshold are printed with their timestamps by the
// metadata filter, and this module parses that log back into
// [{ time, score }] in SOURCE seconds. No model download, no network —
// the matrix's [LOCAL-FREE] route. The renderer maps the boundaries
// inside a clip's window through the speed sampler and lands them as
// ordinary splits (store action splitAtTimes), so a scene split is
// indistinguishable from a manual one downstream.
const { spawn } = require('child_process');
const { ffmpegPath } = require('./ffmpeg.cjs');

const DEFAULT_THRESHOLD = 0.3;

// The metadata=print log parser, exported for the suite: a frame header
// line ("frame:N pts:... pts_time:T") followed by its
// "lavfi.scene_score=S" line makes one detection.
function parseSceneLog(text) {
  const out = [];
  let pending = null;
  for (const line of String(text || '').split('\n')) {
    const t = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/);
    if (t) { pending = { time: Number(t[1]), score: 0 }; continue; }
    const s = line.match(/lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/);
    if (s && pending) {
      pending.score = Number(s[1]);
      if (pending.time > 0.05) out.push(pending); // time 0 is the first frame, never a cut
      pending = null;
    }
  }
  return out;
}

// Detect the cuts in `file`. opts.threshold: 0.05..0.9 (default 0.3 — hard
// cuts score far above it; dissolves and fades stay below). opts.isCanceled
// polls a cancellation flag, the other derivative jobs' pattern.
function detectScenes(file, opts = {}) {
  const threshold = Math.min(0.9, Math.max(0.05, Number(opts.threshold) || DEFAULT_THRESHOLD));
  const isCanceled = opts.isCanceled || (() => false);
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-i', file,
      '-vf', `select='gt(scene,${threshold})',metadata=print`,
      '-an', '-f', 'null', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let log = '';
    p.stderr.on('data', (d) => { log += d; if (isCanceled()) p.kill('SIGKILL'); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (isCanceled()) return resolve([]);
      if (code !== 0) return reject(new Error(log.slice(-2000) || `Scene detection exited with ${code}`));
      resolve(parseSceneLog(log));
    });
  });
}

module.exports = { detectScenes, parseSceneLog, DEFAULT_THRESHOLD };
