// 10/10 step 4 — fx segment cache eviction (the Sprint 9 deferral): the cache is
// size-bounded with an LRU policy. Drives electron/fxjobs.cjs the way
// src/fxExport.js does (begin -> read/paint/write -> end), with the same
// deterministic CPU painter as test-fx-cache.cjs.
//
// Pinned here:
//   1. Publishing past the cap evicts the least-recently-used entries until
//      the cache fits; the newest entries survive.
//   2. A cache HIT refreshes an entry's recency — the hit entry is no longer
//      the eviction candidate.
//   3. An entry a live job is using (its file feeds an in-flight export) is
//      NEVER evicted, even when it is the oldest and the cache stays over
//      the cap because of it.
//   4. clearSegmentCache drops everything except in-use entries.
//   5. cacheStats reports entries / bytes / the configured cap.
// Usage: node scripts/test-fx-eviction.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { FxJobs, DEFAULT_CACHE_CAP_BYTES } = require('../electron/fxjobs.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const W = 320; const H = 240; const FPS = 30;
const base = (id, mediaId, extra = {}) => ({
  id, mediaId, in: 0, out: 0, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00',
  mask: null, maskFeather: 0, crop: null, transform: null, ...extra,
});

async function render(jobs, project) {
  const job = await jobs.begin(project, { kind: 'clip', track: 'video', clipId: 'c1' });
  if (!job.cached) {
    const strength = (project.effectClips[0] && project.effectClips[0].settings.strength) || 0;
    const delta = Math.round(strength * 80);
    for (let k = 0; k < job.frames; k++) {
      const frame = await jobs.read(job.id);
      if (!frame) break;
      const out = Buffer.from(frame);
      for (let i = 0; i < out.length; i += 4) out[i + 1] = Math.min(255, out[i + 1] + delta);
      await jobs.write(job.id, out);
    }
  }
  await jobs.end(job.id);
  return jobs.jobs.get(job.id);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxevict-'));
  const cacheDir = path.join(dir, 'fx-segments');
  const entries = () => (fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mkv')).sort() : []);
  const sizeOf = (f) => fs.statSync(path.join(cacheDir, f)).size;

  const src = path.join(dir, 'a.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0xE63946:size=${W}x${H}:rate=${FPS}:duration=3`, '-pix_fmt', 'yuv420p', src]);
  const mA = { id: 'm-a', path: src, name: 'a.mp4', ...(await probe(src)) };
  const project = (strength) => ({
    name: 'evict-test', ratio: '4:3', width: W, height: H, fps: FPS, background: '#000000',
    media: [mA], videoClips: [base('c1', mA.id, { out: 0.5 })], overlayClips: [], textClips: [],
    audioClips: [], stickerClips: [],
    effectClips: [{ id: 'e1', type: 'vignette', track: 'video', in: 0, out: 0.5, settings: { strength } }],
  });

  // A generous cap while seeding, then the test drives the cap explicitly.
  let cap = Number.MAX_SAFE_INTEGER;
  const jobs = new FxJobs(() => cacheDir, () => cap);
  const j1 = await render(jobs, project(0.3));
  const j2 = await render(jobs, project(0.5));
  const j3 = await render(jobs, project(0.7));
  ok(entries().length === 3, `three distinct renders published three cache entries (got ${entries().length})`);
  const [f1, f2, f3] = [`${j1.key}.mkv`, `${j2.key}.mkv`, `${j3.key}.mkv`];
  const total = entries().reduce((n, f) => n + sizeOf(f), 0);

  // Deterministic recency: f1 oldest, f2 middle, f3 newest.
  const t0 = Date.now() - 60000;
  fs.utimesSync(path.join(cacheDir, f1), new Date(t0), new Date(t0));
  fs.utimesSync(path.join(cacheDir, f2), new Date(t0 + 10000), new Date(t0 + 10000));
  fs.utimesSync(path.join(cacheDir, f3), new Date(t0 + 20000), new Date(t0 + 20000));

  // ---- 5. Stats -------------------------------------------------------------
  const stats = jobs.cacheStats();
  ok(stats.entries === 3 && stats.bytes === total && stats.capBytes === cap, 'cacheStats reports entries, bytes and the configured cap');
  const defJobs = new FxJobs(() => cacheDir);
  ok(defJobs.cacheStats().capBytes === DEFAULT_CACHE_CAP_BYTES, 'an unwired cap falls back to the 2 GiB default');

  // ---- 2. A hit refreshes recency -------------------------------------------
  const hit = jobs.cacheHit(j1.key);
  ok(hit === path.join(cacheDir, f1), 'cacheHit returns the seeded entry');
  ok(fs.statSync(path.join(cacheDir, f1)).mtimeMs > t0 + 20000, 'the hit made the oldest entry the most recently used');

  // ---- 1. Eviction is LRU and stops at the cap -------------------------------
  // Cap fits f1 + f3 but not all three: f2 (now the oldest after the hit
  // refreshed f1) must go, f1 and f3 must stay.
  cap = sizeOf(f1) + sizeOf(f3) + 1024;
  const deleted = jobs.evictIfNeeded();
  ok(deleted.length === 1 && deleted[0] === path.join(cacheDir, f2), 'eviction removed exactly the least-recently-used entry');
  ok(fs.existsSync(path.join(cacheDir, f1)) && fs.existsSync(path.join(cacheDir, f3)), 'the hit entry and the newest entry survive');
  ok(jobs.cacheStats().bytes <= cap, 'the cache fits the cap after eviction');
  jobs.clear();

  // ---- 3. In-use entries are never evicted -----------------------------------
  // A fresh instance begins a CACHED job for f1: that job's file is feeding an
  // export. Cap is then set below f1's own size — eviction must delete f3
  // (not in use) and leave f1 alone, staying over the cap rather than
  // breaking the in-flight export.
  const busy = new FxJobs(() => cacheDir, () => 1);
  const begun = await busy.begin(project(0.3), { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(begun.cached === true, 'the busy instance begins from the cache (its job now uses f1)');
  const deletedBusy = busy.evictIfNeeded();
  ok(fs.existsSync(path.join(cacheDir, f1)), 'the in-use entry survives eviction at any cap');
  ok(deletedBusy.every((f) => f !== path.join(cacheDir, f1)), 'eviction never reports the in-use file as deleted');
  ok(!fs.existsSync(path.join(cacheDir, f3)), 'the not-in-use entry was evicted instead');
  const resolved = busy.resolve(project(0.3));
  ok(resolved.videoClips[0].videoOverride === undefined && fs.existsSync(busy.jobs.get(begun.id).file), 'the in-flight job still resolves to its segment file');
  busy.clear();

  // ---- 4. clearSegmentCache respects the same guard --------------------------
  const j4jobs = new FxJobs(() => cacheDir, () => Number.MAX_SAFE_INTEGER);
  const j4 = await render(j4jobs, project(0.9));
  const f4 = `${j4.key}.mkv`;
  j4jobs.clear();
  const holder = new FxJobs(() => cacheDir);
  const held = await holder.begin(project(0.3), { kind: 'clip', track: 'video', clipId: 'c1' });
  ok(held.cached === true, 'a holder job uses f1 from the cache');
  const cleared = holder.clearSegmentCache();
  ok(fs.existsSync(path.join(cacheDir, f1)), 'clear keeps the in-use entry');
  ok(!fs.existsSync(path.join(cacheDir, f4)) && cleared.includes(path.join(cacheDir, f4)), 'clear drops every entry not in use');
  holder.clear();

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `FX EVICTION FAIL — ${failures} assertion(s)` : 'FX EVICTION OK — LRU eviction under a configurable cap, hits refresh recency, in-use entries untouchable');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('FX EVICTION FAIL', e); process.exit(1); });
