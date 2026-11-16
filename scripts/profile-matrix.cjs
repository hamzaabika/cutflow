// P1-20 profiling matrix: the fx pass (decode + paint + encode) across
// resolution (1080p / 4K) x fx-segment count (1 / 5 / 20) x cache state
// (cold / warm), measured with the same machinery as
// scripts/profile-preview-export.cjs (FxJobs + the deterministic CPU painter
// standing in for the renderer's WebGL painter).
//
// Usage: TMPDIR=~/workspace/.tmp-battery node scripts/profile-matrix.cjs
//   (TMPDIR on disk: the 4K segments do not fit /tmp's 512 MB tmpfs.)
// Writes docs/profile-matrix-2026-11-15.json and prints a table.
//
// What the numbers prove and what they do not (same caveats as the
// single-config profiler): the COLD fx-pass time overstates the app's paint
// cost (the painter is CPU, the app paints on GPU), but the WARM
// (cache-hit) time is structural — a hit skips decode, paint and encode
// entirely, in any environment. This VM (shared vCPUs, no GPU) is not the
// reference laptop (ThinkPad T470, i5-7300U, Intel HD 620): absolute seconds
// do not transfer; the cold-vs-warm ratio and the per-frame costs are the
// signal. "Effects" here means fx segments (one rendered clip segment per
// effect-bearing clip); the painter is identical for every segment, so the
// count axis measures decode/encode + cache throughput, not per-effect
// shader cost.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { FxJobs } = require('../electron/fxjobs.cjs');

const FPS = 30;
const CLIP_LEN = 1; // seconds per segment
const RESOLUTIONS = [
  { label: '1080p', w: 1920, h: 1080 },
  { label: '4K', w: 3840, h: 2160 },
];
const COUNTS = [1, 5, 20];

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

(async () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'fve-matrix-'));
  const started = new Date().toISOString();
  const results = [];
  try {
    for (const res of RESOLUTIONS) {
      const src = path.join(dir, `cam-${res.label}.mp4`);
      execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', `testsrc2=size=${res.w}x${res.h}:rate=${FPS}:duration=${COUNTS[COUNTS.length - 1] * CLIP_LEN + 1}`,
        '-pix_fmt', 'yuv420p', src]);
      const m = { id: 'm1', path: src, name: `cam-${res.label}.mp4`, ...(await probe(src)) };
      for (const n of COUNTS) {
        const videoClips = [];
        for (let i = 0; i < n; i++) {
          videoClips.push({ id: `c${i}`, mediaId: 'm1', in: i * CLIP_LEN, out: (i + 1) * CLIP_LEN, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00', mask: null, maskFeather: 0, crop: null, transform: null });
        }
        const project = {
          name: 'profile-matrix', ratio: '16:9', width: res.w, height: res.h, fps: FPS, background: '#000000',
          media: [m], videoClips, overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
        };
        const cacheDir = path.join(dir, `fx-${res.label}-${n}`);
        // Same deterministic painter as profile-preview-export.cjs.
        const paint = ([frame]) => {
          const out = Buffer.from(frame);
          for (let i = 0; i < out.length; i += 16) out[i] = 255 - out[i];
          return out;
        };
        const renderAll = async (jobs) => {
          let cached = 0;
          let frames = 0;
          for (let i = 0; i < n; i++) {
            const job = await jobs.begin(project, { kind: 'clip', track: 'video', clipId: `c${i}` });
            if (job.cached) cached++;
            frames += job.frames;
            if (!job.cached) {
              for (let k = 0; k < job.frames; k++) {
                const got = await jobs.read(job.id);
                if (!got) break;
                await jobs.write(job.id, paint([got]));
              }
            }
            await jobs.end(job.id);
          }
          return { cached, frames };
        };
        const cold = new FxJobs(() => cacheDir);
        const t0 = process.hrtime.bigint();
        const coldRes = await renderAll(cold);
        const coldMs = ms(t0);
        const warm = new FxJobs(() => cacheDir);
        const t1 = process.hrtime.bigint();
        const warmRes = await renderAll(warm);
        const warmMs = ms(t1);
        cold.clear(); warm.clear();
        const row = {
          resolution: res.label, width: res.w, height: res.h, segments: n,
          frames: coldRes.frames,
          coldMs: Math.round(coldMs), warmMs: Math.round(warmMs),
          coldMsPerFrame: +(coldMs / coldRes.frames).toFixed(2),
          warmMsPerFrame: +(warmMs / warmRes.frames).toFixed(2),
          warmCached: warmRes.cached, coldCached: coldRes.cached,
          warmOverCold: +(warmMs / coldMs).toFixed(3),
        };
        results.push(row);
        console.log(`${res.label.padEnd(6)} ${String(n).padStart(2)} segs  cold ${String(row.coldMs).padStart(7)} ms (${row.coldMsPerFrame} ms/f)  warm ${String(row.warmMs).padStart(6)} ms (${row.warmMsPerFrame} ms/f)  warm/cold ${row.warmOverCold}  cached ${row.warmCached}/${n}`);
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const artifact = {
    generated: started,
    script: 'scripts/profile-matrix.cjs',
    host: `${os.cpus()[0].model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB — a shared VM, not the T470`,
    method: 'FxJobs fx pass (decode + deterministic CPU paint + encode) per clip segment; 1 s segments at 30 fps; cold = first render into an empty cache, warm = new session over the same cache.',
    caveats: [
      'Cold paint time overstates the app (CPU painter stands in for WebGL); warm time is structural (a hit skips decode, paint and encode).',
      'Absolute seconds do not transfer to the T470; cold-vs-warm ratio and ms/frame are the signal.',
      '"Segments" is the fx-segment count (one rendered clip segment per effect-bearing clip), not per-effect shader cost.',
    ],
    results,
  };
  const outPath = path.join(__dirname, '..', 'docs', 'profile-matrix-2026-11-15.json');
  fs.writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`PROFILE MATRIX DONE — ${outPath}`);
})().catch((e) => { console.error('PROFILE MATRIX FAIL', e); process.exit(1); });
