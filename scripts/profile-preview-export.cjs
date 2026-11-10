// Sprint 9 profiling pass (Phase 5): what the sprint's changes do to preview
// and export timings, measured on a representative project in THIS
// environment. Not a test — a measurement tool; run it again after future
// performance work to compare.
//
//   node scripts/profile-preview-export.cjs
//
// What the numbers prove and what they do not:
//   * The fx pass is driven with a deterministic CPU painter standing in for
//     the renderer's WebGL painter (there is no GPU in this environment), so
//     the COLD fx-pass time overstates the app's paint cost — but the WARM
//     (cache-hit) time is structural: a hit skips decode, paint and encode
//     entirely, in any environment.
//   * This VM (shared vCPUs, no GPU) is not the reference laptop (ThinkPad
//     T470, i5-7300U, Intel HD 620): absolute seconds do not transfer; the
//     cold-vs-warm ratio and the copy-generation costs are the signal.
//   * Preview scrub latency itself is a renderer/GPU property and is not
//     measurable headlessly; what is measured on the preview side is the
//     cost of generating the copies the player scrubs through.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport, makeLightProxy, makeQualityProxy } = require('../electron/ffmpeg.cjs');
const { FxJobs } = require('../electron/fxjobs.cjs');

const W = 1920; const H = 1080; const FPS = 30;
const base = (id, mediaId, extra = {}) => ({
  id, mediaId, in: 0, out: 0, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00',
  mask: null, maskFeather: 0, crop: null, transform: null, ...extra,
});
const t = async (label, fn) => {
  const t0 = process.hrtime.bigint();
  const v = await fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`${label.padEnd(46)} ${ms.toFixed(0).padStart(7)} ms`);
  return v;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-profile-'));
  const cacheDir = path.join(dir, 'fx-segments');
  const src = path.join(dir, 'cam.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=6`, '-pix_fmt', 'yuv420p', src]);
  const m = { id: 'm1', path: src, name: 'cam.mp4', ...(await probe(src)) };
  const project = {
    name: 'profile', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media: [m],
    videoClips: [base('c1', 'm1', { out: 3 }), base('c2', 'm1', { in: 3, out: 6, transition: { type: 'dissolve', duration: 0.6 } })],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
    effectClips: [{ id: 'e1', type: 'vignette', track: 'video', in: 0, out: 3, settings: { strength: 0.5 } }],
  };
  console.log(`project: 1920x1080@30, 2 clips (5.4 s timeline), 1 fx clip (3 s), 1 fx transition (0.6 s)`);
  console.log(`host: ${os.cpus()[0].model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB — a shared VM, not the T470`);

  // The painter: a cheap per-pixel touch (the WebGL paint it stands in for is
  // GPU work in the app; here it also exercises the frame plumbing).
  const paintClip = ([frame]) => {
    const out = Buffer.from(frame);
    for (let i = 0; i < out.length; i += 16) out[i] = 255 - out[i];
    return out;
  };
  const paintTr = ([a, b], k, job) => {
    const p = job.frames > 1 ? k / (job.frames - 1) : 1;
    const out = Buffer.alloc(W * H * 4);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(a[i] * (1 - p) + b[i] * p);
    return out;
  };
  const renderAll = async (jobs) => {
    const segs = {};
    for (const [spec, paint] of [[{ kind: 'clip', track: 'video', clipId: 'c1' }, paintClip], [{ kind: 'transition', clipId: 'c2' }, paintTr]]) {
      const job = await jobs.begin(project, spec);
      if (!job.cached) {
        for (let k = 0; k < job.frames; k++) {
          const got = await jobs.read(job.id);
          if (!got) break;
          const bufs = Buffer.isBuffer(got) ? [got] : [got.a, got.b];
          await jobs.write(job.id, paint(bufs, k, job));
        }
      }
      await jobs.end(job.id);
      segs[spec.kind] = { file: jobs.jobs.get(job.id).file, cached: !!job.cached };
    }
    return segs;
  };

  const cold = new FxJobs(() => cacheDir);
  const coldSegs = await t('fx pass COLD (decode+paint+encode, 108 frames)', () => renderAll(cold));
  const baked = {
    ...project,
    videoClips: [{ ...project.videoClips[0], videoOverride: { file: coldSegs.clip.file, start: 0, end: 3 } }, project.videoClips[1]],
    fxSegments: { c2: coldSegs.transition.file },
  };
  await t('final export (segments spliced, x264 crf 20)', () => runExport(baked, path.join(dir, 'out-fx.mp4'), null).promise);
  const warm = new FxJobs(() => cacheDir);
  const warmSegs = await t('fx pass WARM (new session, cache hits)', () => renderAll(warm));
  console.log(`  warm segments reused: clip=${warmSegs.clip.cached}, transition=${warmSegs.transition.cached}`);
  const plain = { ...project, effectClips: [], videoClips: [project.videoClips[0], { ...project.videoClips[1], transition: null }] };
  await t('final export (no fx, concat baseline)', () => runExport(plain, path.join(dir, 'out-plain.mp4'), null).promise);
  cold.clear(); warm.clear();

  const copyCache = path.join(dir, 'copies');
  fs.mkdirSync(copyCache, { recursive: true });
  const light = await t('light proxy 1080p (540 px, fastdecode)', () => makeLightProxy(m, copyCache));
  console.log(`  light copy: ${Math.round(fs.statSync(light).size / 1024)} KB for a ${Math.round(fs.statSync(src).size / 1024)} KB source`);
  const med = await t("quality proxy 'medium' 1080p (960 px)", () => makeQualityProxy(m, copyCache, 'medium'));
  console.log(`  medium copy: ${Math.round(fs.statSync(med).size / 1024)} KB`);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('PROFILE DONE');
})().catch((e) => { console.error('PROFILE FAIL', e); process.exit(1); });
