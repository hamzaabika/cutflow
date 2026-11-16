// FB-15 (P1-20) — FX export stage profiling (measurements, not optimisation).
// The Sprint 9 profiler measured cold-vs-warm fx-pass time only; this one
// splits the pass into its stages, per the audit acceptance criteria:
//   fxRead (decoder producing frames + pipe IPC) -> fxGL (paint, the
//   WebGL shader work — here a deterministic CPU painter standing in for
//   it, N passes for N effects) -> fxWrite (feeding painted frames to the
//   segment encoder) -> flush (encoder drain) -> final export encode.
// Matrix: the SAME project at 1080p and 4K, with 1 / 5 / 20 effects,
// cache cold and warm. Stage times come from FxJobs.timings()
// (electron/fxjobs.cjs); paint time is measured around the paint call here.
// The painter is a stand-in, so absolute paint seconds do not transfer to
// the app's GPU painter — the stage SPLIT and the cold/warm ratio are the
// signal. Optimise only if these measurements warrant it; nothing here
// changes any render path.
// Run: TMPDIR=~/workspace/.tmp-battery node scripts/profile-fx-stages.cjs
//   (TMPDIR on disk: /tmp is a 512 MB tmpfs and 4K segments do not fit it.)
// Writes: ~/workspace/cutflow-audit-20261115/f4-15-fx-stage-profile-2026-11-15.{json,md}
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { FxJobs } = require('../electron/fxjobs.cjs');

const FPS = 30; const DUR = 2; // 2 s timeline keeps the 4K matrix affordable
const OUT_DIR = '/home/hatch/workspace/cutflow-audit-20261115';
const STAMP = '2026-11-15';

const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

function makeProject(dir, W, H, nEffects) {
  const src = path.join(dir, `cam-${W}x${H}.mp4`);
  if (!fs.existsSync(src)) {
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${DUR}`, '-pix_fmt', 'yuv420p', src]);
  }
  return { src };
}

async function renderPass(jobs, project, nEffects, W, H) {
  // Paint = N cheap per-pixel passes standing in for N effects. Stride 64 at
  // 4K (16 at 1080p) keeps the stand-in's wall time comparable across
  // resolutions — the split, not the absolute paint seconds, is measured.
  const stride = W >= 3840 ? 64 : 16;
  let paintMs = 0;
  const job = jobs.begin(project, { kind: 'clip', track: 'video', clipId: 'c1' });
  if (!job.cached) {
    for (let k = 0; k < job.frames; k++) {
      const got = await jobs.read(job.id);
      if (!got) break;
      const t0 = process.hrtime.bigint();
      const out = Buffer.from(got);
      for (let e = 0; e < nEffects; e++) for (let i = 0; i < out.length; i += stride) out[i] = 255 - out[i];
      paintMs += ms(t0);
      await jobs.write(job.id, out);
    }
  }
  await jobs.end(job.id);
  const t = jobs.timings()[0];
  return { ...t, paintMs, frames: job.frames };
}

(async () => {
  if (os.tmpdir() === '/tmp') console.log('WARNING: TMPDIR is /tmp (512 MB tmpfs) — 4K segments may not fit; rerun with TMPDIR=~/workspace/.tmp-battery');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxprofile-'));
  const cacheDir = path.join(dir, 'fx-segments');
  const host = `${os.cpus()[0].model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB`;
  console.log(`host: ${host}`);
  const rows = [];
  for (const [label, W, H] of [['1080p', 1920, 1080], ['4K', 3840, 2160]]) {
    const { src } = makeProject(dir, W, H, 1);
    const m = { id: 'm1', path: src, name: path.basename(src), ...(await probe(src)) };
    for (const nEffects of [1, 5, 20]) {
      const project = {
        name: 'fxprofile', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media: [m],
        videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: DUR, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00', mask: null, maskFeather: 0, crop: null, transform: null }],
        overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
        effectClips: Array.from({ length: nEffects }, (_, i) => ({ id: `e${i + 1}`, type: 'vignette', track: 'video', in: 0, out: DUR, settings: { strength: 0.5 } })),
      };
      const cold = new FxJobs(() => cacheDir);
      const c = await renderPass(cold, project, nEffects, W, H);
      cold.clear();
      const warm = new FxJobs(() => cacheDir);
      const w = await renderPass(warm, project, nEffects, W, H);
      warm.clear();
      // Final export encode stage: the baked project (cold segment spliced in).
      // The segment file lives in the cache dir; resolve() needs the real file.
      const segFile = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mkv')).map((f) => path.join(cacheDir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      const baked2 = { ...project, videoClips: [{ ...project.videoClips[0], videoOverride: { file: segFile, start: 0, end: DUR } }] };
      const t0 = process.hrtime.bigint();
      await runExport(baked2, path.join(dir, `out-${label}-${nEffects}.mp4`), null).promise;
      const exportMs = ms(t0);
      const row = { resolution: label, width: W, height: H, effects: nEffects, frames: c.frames,
        cold: { beginMs: c.beginMs, decodeMs: c.decodeMs, paintMs: c.paintMs, writeMs: c.writeMs, flushMs: c.flushMs, pipelineMs: c.totalMs, passMs: c.totalMs + c.paintMs },
        warm: { beginMs: w.beginMs, decodeMs: w.decodeMs, paintMs: w.paintMs, writeMs: w.writeMs, flushMs: w.flushMs, pipelineMs: w.totalMs, passMs: w.totalMs + w.paintMs },
        exportEncodeMs: exportMs };
      rows.push(row);
      console.log(`${label} ${String(nEffects).padStart(2)}fx cold: begin ${c.beginMs.toFixed(0)} decode ${c.decodeMs.toFixed(0)} paint ${c.paintMs.toFixed(0)} write ${c.writeMs.toFixed(0)} flush ${c.flushMs.toFixed(0)} | warm pass ${(w.totalMs + w.paintMs).toFixed(0)} ms | export encode ${exportMs.toFixed(0)} ms`);
    }
  }
  const json = { generated: STAMP, host, note: 'Same 2 s project at 1080p and 4K, 1/5/20 effects, cache cold/warm. Paint is a CPU stand-in (N passes, stride 16 @1080p / 64 @4K); absolute paint seconds do not transfer to the GPU painter — the stage split and cold/warm ratio are the signal. decodeMs includes decoder + pipe IPC + frame copy (readback); writeMs is encode ingest; flushMs is encoder drain; exportEncodeMs is the final runExport splice+encode.', rows };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `f4-15-fx-stage-profile-${STAMP}.json`), JSON.stringify(json, null, 2));
  const md = [`# FB-15 (P1-20) — FX export stage profile — ${STAMP}`, '', `Host: ${host} (shared VM, no GPU — absolute seconds do not transfer to the ThinkPad; the stage split and cold/warm ratio are the signal).`, '',
    'Same 2 s project at 1080p and 4K, 1 / 5 / 20 effects, cache cold and warm. Paint is a CPU stand-in (N per-pixel passes, stride 16 @1080p / 64 @4K).',
    '', '| res | fx | cold begin | cold decode | cold paint | cold write | cold flush | cold pass | warm pass | export encode |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((r) => `| ${r.resolution} | ${r.effects} | ${r.cold.beginMs.toFixed(0)} | ${r.cold.decodeMs.toFixed(0)} | ${r.cold.paintMs.toFixed(0)} | ${r.cold.writeMs.toFixed(0)} | ${r.cold.flushMs.toFixed(0)} | ${r.cold.passMs.toFixed(0)} | ${r.warm.passMs.toFixed(0)} | ${r.exportEncodeMs.toFixed(0)} |`),
    '', 'Stage meanings: **begin** = job spawn/setup; **decode** = blocked waiting on the decoder pipe (decode + IPC + frame copy/readback); **paint** = the fxGL stand-in; **write** = feeding painted frames to the segment encoder; **flush** = encoder drain at end(); **export encode** = final runExport splice + x264 encode of the baked project.',
    '', '## Verdict', '',
    'See the measurements section of the FB-15 commit message for the read of these numbers (optimise only if they warrant it).',
    '', `Raw data: \`f4-15-fx-stage-profile-${STAMP}.json\` in this folder.`, ''];
  fs.writeFileSync(path.join(OUT_DIR, `f4-15-fx-stage-profile-${STAMP}.md`), md.join('\n'));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PROFILE DONE');
})().catch((e) => { console.error('PROFILE FAIL', e); process.exit(1); });
