// Sprint 9 — the fx segment cache (parity-matrix Arch-2: segment pre-render
// cache reused at export). Drives electron/fxjobs.cjs exactly the way
// src/fxExport.js does (begin -> read/paint/write loop -> end -> resolve),
// with a deterministic CPU painter standing in for the renderer's WebGL one:
// the painted bytes are a pure function of the project, so a segment rendered
// in one "session" (FxJobs instance) must be reusable, byte for byte, by the
// next — and ANY change to what determines the frames must miss the cache.
//
// Pinned here:
//   1. Cold render publishes one cache entry; a fresh instance over the same
//      cache dir begins with cached:true, paints nothing, and resolves to a
//      byte-identical file.
//   2. An export driven by the warm (cached) job decodes frame-identically to
//      the export driven by the cold render — reuse cannot change the picture.
//   3. Wrong reuse is impossible: changing an effect's strength, an effect's
//      timing, the project frame rate, a transition's duration, or the source
//      file itself each miss the cache (and a strength change also changes
//      the decoded content, so even a hypothetical wrong hit would show).
//   4. With no cache dir (the pre-Sprint-9 wiring) nothing is cached and the
//      old behaviour is unchanged.
// Usage: node scripts/test-fx-cache.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');
const { FxJobs } = require('../electron/fxjobs.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const W = 320; const H = 240; const FPS = 30; const FRAME = W * H * 4;
const base = (id, mediaId, extra = {}) => ({
  id, mediaId, in: 0, out: 0, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00',
  mask: null, maskFeather: 0, crop: null, transform: null, ...extra,
});

const run = (args) => new Promise((res, rej) => {
  const p = spawn(ffmpegPath, args, { windowsHide: true });
  const err = [];
  p.stderr.on('data', (c) => err.push(c));
  p.on('error', rej);
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(Buffer.concat(err).toString().slice(-300)))));
});
const decodeAll = async (file) => {
  const out = path.join(path.dirname(file), `dec-${path.basename(file)}.raw`);
  await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', out]);
  return fs.readFileSync(out);
};

// The fxExport loop, with the suite's painter: for a clip, add a constant to
// the green channel derived from the effect strength (the painted content is
// a function of the effect settings, as in the app; green because the red
// fixture's red channel sits near saturation and would clamp both strengths
// to the same byte); for a transition, blend the two sides by progress.
async function render(jobs, project, spec, paint) {
  const job = await jobs.begin(project, spec);
  if (!job.cached) {
    for (let k = 0; k < job.frames; k++) {
      const got = await jobs.read(job.id); // a Buffer for one reader, {a, b} for two
      if (!got) break;
      const bufs = Buffer.isBuffer(got) ? [got] : [got.a, got.b];
      await jobs.write(job.id, paint(bufs, k, job));
    }
  }
  const end = await jobs.end(job.id);
  // The job's segment file (fxExport resolves ids to files the same way via
  // FxJobs.resolve before handing the project to runExport).
  return { job, end, file: jobs.jobs.get(job.id).file };
}
const clipPaint = (project) => ([frame]) => {
  const strength = (project.effectClips[0] && project.effectClips[0].settings.strength) || 0;
  const delta = Math.round(strength * 80);
  const out = Buffer.from(frame);
  for (let i = 0; i < out.length; i += 4) out[i + 1] = Math.min(255, out[i + 1] + delta);
  return out;
};
const transitionPaint = ([a, b], k, job) => {
  const p = job.frames > 1 ? k / (job.frames - 1) : 1;
  const out = Buffer.alloc(FRAME);
  for (let i = 0; i < FRAME; i++) out[i] = Math.round(a[i] * (1 - p) + b[i] * p);
  return out;
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxcache-'));
  const cacheDir = path.join(dir, 'fx-segments');
  const cacheFiles = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mkv')) : []);
  const mkSrc = async (name, color, dur = 3.4) => {
    const f = path.join(dir, name);
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=${W}x${H}:rate=${FPS}:duration=${dur}`, '-pix_fmt', 'yuv420p', f]);
    return { id: `m-${name}`, path: f, name, ...(await probe(f)) };
  };
  const mA = await mkSrc('a.mp4', '0xE63946');
  const mB = await mkSrc('b.mp4', '0x1D6FB8');
  const fx = (over = {}) => [{ id: 'e1', type: 'vignette', track: 'video', in: 0, out: 1, settings: { strength: 0.5 }, ...over }];
  const clipProject = (over = {}) => ({
    name: 'cache-test', ratio: '4:3', width: W, height: H, fps: FPS, background: '#000000',
    media: [mA, mB], videoClips: [base('c1', mA.id, { out: 1 })], overlayClips: [], textClips: [],
    audioClips: [], stickerClips: [], effectClips: fx(), ...over,
  });

  // ---- 1+2. Clip segment: cold render, warm reuse, identical exports. ----
  const project = clipProject();
  const cold = new FxJobs(() => cacheDir);
  const coldR = await render(cold, project, { kind: 'clip', track: 'video', clipId: 'c1' }, clipPaint(project));
  ok(!coldR.job.cached, 'cold begin renders (no cached flag)');
  ok(coldR.end.frames === coldR.job.frames && coldR.job.frames === 30, `cold render wrote all ${coldR.job.frames} frames`);
  ok(cacheFiles().length === 1, 'the finished segment was published to the cache (1 entry)');
  const coldSegBytes = fs.readFileSync(coldR.file);
  const bakedCold = { ...project, videoClips: [{ ...project.videoClips[0], videoOverride: { file: coldR.file, start: 0, end: 1 } }] };
  const expCold = path.join(dir, 'exp-cold.mp4');
  await runExport(bakedCold, expCold, null).promise;

  const warm = new FxJobs(() => cacheDir);
  const warmR = await render(warm, project, { kind: 'clip', track: 'video', clipId: 'c1' }, clipPaint(project));
  ok(warmR.job.cached === true, 'a new session over the same cache begins cached (no re-render)');
  ok(warmR.end.frames === 30, 'the cached job reports the full frame count');
  ok(fs.readFileSync(warmR.file).equals(coldSegBytes), 'the reused segment is byte-identical to the cold render');
  const bakedWarm = { ...project, videoClips: [{ ...project.videoClips[0], videoOverride: { file: warmR.file, start: 0, end: 1 } }] };
  const expWarm = path.join(dir, 'exp-warm.mp4');
  await runExport(bakedWarm, expWarm, null).promise;
  const [decCold, decWarm] = [await decodeAll(expCold), await decodeAll(expWarm)];
  ok(decCold.length === 30 * FRAME, `the export holds all 30 frames at the project rate (got ${decCold.length / FRAME})`);
  ok(decWarm.equals(decCold), 'the warm-cache export decodes frame-identically to the cold export');
  cold.clear(); warm.clear();

  // ---- 3. Every determining change misses. ----
  const changed = new FxJobs(() => cacheDir);
  const stronger = clipProject({ effectClips: fx({ settings: { strength: 0.9 } }) });
  const strongR = await render(changed, stronger, { kind: 'clip', track: 'video', clipId: 'c1' }, clipPaint(stronger));
  ok(!strongR.job.cached, 'a changed effect strength misses the cache');
  const strongFrame = (await decodeAll(strongR.file)).subarray(5 * FRAME, 6 * FRAME);
  const cachedFrame = (await decodeAll(warmR.file)).subarray(5 * FRAME, 6 * FRAME);
  ok(!strongFrame.equals(cachedFrame), 'the re-rendered segment content actually differs (a wrong hit would be visible)');
  ok(cacheFiles().length === 2, 'the changed render published its own cache entry');
  changed.clear();

  const retimed = new FxJobs(() => cacheDir);
  const retimedR = await retimed.begin(clipProject({ effectClips: fx({ in: 0.2 }) }), { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(!retimedR.cached, "a changed effect timing (in point) misses the cache");
  retimed.clear();

  const reframed = new FxJobs(() => cacheDir);
  const reframedR = await reframed.begin(clipProject({ fps: 24 }), { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(!reframedR.cached, 'a changed project frame rate misses the cache');
  reframed.clear();

  const replaced = new FxJobs(() => cacheDir);
  const mA2 = await mkSrc('a.mp4', '0x22CC66', 4.0); // same path, new content on disk
  const replacedProject = clipProject({ media: [mA2, mB] });
  const replacedR = await replaced.begin(replacedProject, { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(!replacedR.cached, 'a source file replaced on disk misses the cache (stat fingerprint)');
  replaced.clear();

  // ---- Transition segments: same story across the junction. ----
  const tProject = (dur = 0.6) => ({
    name: 'cache-test-t', ratio: '4:3', width: W, height: H, fps: FPS, background: '#000000',
    media: [mA, mB],
    videoClips: [base('cA', mA.id, { out: 1.4 }), base('cB', mB.id, { out: 2.0, transition: { type: 'dissolve', duration: dur } })],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  });
  const tCold = new FxJobs(() => cacheDir);
  const tColdR = await render(tCold, tProject(), { kind: 'transition', clipId: 'cB' }, transitionPaint);
  ok(!tColdR.job.cached && tColdR.job.frames === 18, 'transition cold render (18 frames)');
  const tWarm = new FxJobs(() => cacheDir);
  const tWarmR = await render(tWarm, tProject(), { kind: 'transition', clipId: 'cB' }, transitionPaint);
  ok(tWarmR.job.cached === true, 'transition warm begin hits the cache');
  ok(fs.readFileSync(tWarmR.file).equals(fs.readFileSync(tColdR.file)), 'the reused transition segment is byte-identical');
  tCold.clear(); tWarm.clear();
  const tChanged = new FxJobs(() => cacheDir);
  const tChangedR = await tChanged.begin(tProject(0.9), { kind: 'transition', clipId: 'cB' });
  ok(!tChangedR.cached, "a changed transition duration misses the cache");
  tChanged.clear();

  // ---- 4. No cache dir: the pre-Sprint-9 behaviour, unchanged. ----
  const plain = new FxJobs();
  const plainR = await render(plain, clipProject(), { kind: 'clip', track: 'video', clipId: 'c1' }, clipPaint(clipProject()));
  ok(!plainR.job.cached && plainR.end.frames === 30, 'without a cache dir the pass renders as before, nothing cached');
  plain.clear();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `FX CACHE FAIL — ${failures} assertion(s)` : 'FX CACHE OK — cold renders publish, warm sessions reuse byte-identically, every determining change misses');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FX CACHE FAIL', e); process.exit(1); });
