// FB-15 (P1-20) — the fx export stage timings recorded by electron/fxjobs.cjs
// are real, complete, and honest. Drives one clip job the way src/fxExport.js
// does (begin -> read/paint/write loop -> end) and pins:
//   1. A cold job records one timing entry with every stage present:
//      beginMs (spawn/setup), decodeMs (blocked waiting on the decoder pipe),
//      writeMs (feeding painted frames to the segment encoder), flushMs
//      (encoder drain at end), and totalMs equal to the sum of the parts.
//   2. decodeMs is genuinely > 0 on a cold render (frames really came
//      through the decoder) and writeMs/flushMs are >= 0.
//   3. A warm job over the same cache dir records cached:true with all
//      pipeline stages at 0 — a hit skips decode, paint and encode entirely —
//      and its total is just the cache-lookup time.
//   4. timings() returns copies: mutating the returned record does not
//      change the instance log.
// Usage: node scripts/test-fx-stage-timings.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { FxJobs } = require('../electron/fxjobs.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxstage-'));
  const cacheDir = path.join(dir, 'fx-segments');
  const W = 320; const H = 240; const FPS = 30;
  const src = path.join(dir, 'cam.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=2`, '-pix_fmt', 'yuv420p', src]);
  const m = { id: 'm1', path: src, name: 'cam.mp4', ...(await probe(src)) };
  const project = {
    name: 'fxstage', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media: [m],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 2, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00', mask: null, maskFeather: 0, crop: null, transform: null }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    effectClips: [{ id: 'e1', type: 'vignette', track: 'video', in: 0, out: 2, settings: { strength: 0.5 } }],
  };
  const paint = (frame) => { const out = Buffer.from(frame); for (let i = 0; i < out.length; i += 64) out[i] = 255 - out[i]; return out; };

  const cold = new FxJobs(() => cacheDir);
  const job = cold.begin(project, { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(!job.cached, 'cold job is not a cache hit');
  for (let k = 0; k < job.frames; k++) {
    const got = await cold.read(job.id);
    if (!got) break;
    await cold.write(job.id, paint(got));
  }
  await cold.end(job.id);
  const t = cold.timings();
  ok(t.length === 1, `one timing record (got ${t.length})`);
  const r = t[0];
  ok(r.kind === 'clip' && r.cached === false, 'cold record is a clip miss');
  ok(r.frames === job.frames && r.frames > 0, `frames recorded (${r.frames})`);
  for (const s of ['beginMs', 'decodeMs', 'writeMs', 'flushMs', 'totalMs']) ok(Number.isFinite(r[s]) && r[s] >= 0, `stage ${s} is a finite non-negative number (${r[s]})`);
  ok(r.decodeMs > 0, `decode stage really waited on the decoder (${r.decodeMs.toFixed(1)} ms)`);
  ok(Math.abs(r.totalMs - (r.beginMs + r.decodeMs + r.writeMs + r.flushMs)) < 1, 'totalMs equals the sum of the stages');
  cold.clear();

  const warm = new FxJobs(() => cacheDir);
  const wjob = warm.begin(project, { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(wjob.cached === true, 'warm job is a cache hit');
  await warm.end(wjob.id);
  const wt = warm.timings();
  ok(wt.length === 1 && wt[0].cached === true, 'warm record is a hit');
  ok(wt[0].decodeMs === 0 && wt[0].writeMs === 0 && wt[0].flushMs === 0, 'hit skips every pipeline stage (decode/write/flush all 0)');
  ok(wt[0].totalMs === wt[0].beginMs, 'hit total is just the lookup time');
  warm.clear();

  // timings() returns copies.
  const copy = cold.timings();
  copy[0].decodeMs = -999;
  ok(cold.timings()[0].decodeMs !== -999, 'timings() returns copies, not the live log');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `FX-STAGE-TIMINGS FAIL (${failures})` : 'FX-STAGE-TIMINGS OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FX-STAGE-TIMINGS FAIL', e); process.exit(1); });
