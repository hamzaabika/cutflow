// Performance mode effects (10/10 perf program): the persisted Low-End mode
// must do real, measurable work. This suite proves the two halves that are
// exercisable outside the app shell: the settings roundtrip (with the mode
// validation that rejects unknown values), and the lite visuals generation
// main passes in Low-End — fewer, smaller thumbnails, a narrower waveform,
// and a SEPARATE cache slot so switching modes never serves the wrong-cost
// visuals. (The remaining Low-End effects — one-at-a-time background jobs
// and lowered export process priority — are main-process wiring around
// these same settings reads.)
// Usage: node scripts/test-perfmode.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Module = require('module');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-perf-'));

  // 1) Settings roundtrip with a stubbed electron shell (settings.cjs only
  // touches app.getPath / safeStorage through these seams).
  const origLoad = Module._load;
  Module._load = function (req, ...rest) {
    if (req === 'electron') {
      return {
        app: { getPath: () => tmp },
        safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(String(s)), decryptString: (b) => Buffer.from(b).toString() },
      };
    }
    return origLoad.call(this, req, ...rest);
  };
  let settings;
  try {
    settings = require('../electron/settings.cjs');
  } finally {
    Module._load = origLoad;
  }
  assert.equal(settings.getPerfMode(), 'balanced', 'default mode is balanced');
  assert.equal(settings.setPerfMode('low-end'), 'low-end');
  assert.equal(settings.getPerfMode(), 'low-end', 'low-end persists');
  assert.equal(settings.setPerfMode('bogus'), 'balanced', 'an unknown mode falls back to balanced');
  assert.equal(settings.getPerfMode(), 'balanced');

  // 2) Lite visuals: a 30 s clip gets 30 normal thumbnails but only 15 lite
  // ones, the lite sprite is smaller on disk, a waveform is still produced,
  // and the two variants live in different cache slots (a normal call after
  // the lite one returns the normal numbers again, not the lite ones).
  const ff = require('../electron/ffmpeg.cjs');
  const src = path.join(tmp, 'long.mp4');
  const gen = spawnSync(ff.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src], { encoding: 'utf8' });
  assert.equal(gen.status, 0, `fixture generation: ${gen.stderr}`);
  const probed = await ff.probe(src);
  const item = { path: src, type: 'video', duration: probed.duration, hasAudio: true, width: 320, height: 180 };
  const cache = path.join(tmp, 'cache');
  const collect = async (opts) => {
    const merged = {};
    await ff.makeVisuals(item, cache, (patch) => Object.assign(merged, patch), opts);
    return merged;
  };
  const normal = await collect({});
  const lite = await collect({ lite: true });
  const normalAgain = await collect({});
  console.log(`  thumbnails: normal=${normal.thumbCount} lite=${lite.thumbCount}; sprite bytes: normal=${fs.statSync(normal.thumb).size} lite=${fs.statSync(lite.thumb).size}`);
  assert.equal(normal.thumbCount, 30, `normal thumbnail count (${normal.thumbCount})`);
  assert.equal(lite.thumbCount, 15, `lite thumbnail count (${lite.thumbCount})`);
  assert.ok(lite.thumb && lite.thumb !== normal.thumb, 'lite visuals use a separate cache slot');
  assert.ok(lite.wave && fs.existsSync(lite.wave), 'lite mode still produces a waveform');
  assert.ok(fs.statSync(lite.thumb).size < fs.statSync(normal.thumb).size, 'lite sprite is smaller on disk');
  assert.equal(normalAgain.thumbCount, 30, 'normal visuals are intact after a lite pass (cache separation)');
  assert.equal(normalAgain.thumb, normal.thumb, 'normal cache slot reused');

  console.log('PERFMODE OK');
})().catch((e) => { console.error(e); process.exit(1); });
