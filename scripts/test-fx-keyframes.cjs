// Effect parameter keyframing (P2-20): intensity keyframes per effect.
//   Part A (pure): fxStrengthAt interpolation / hold / sanitize / upsert /
//     remove in src/fx/fxKeys.js.
//   Part B (preview parity): pixelPasses — the one engine the preview and
//     the export share — renders a keyframed blur at ~0 strength early and
//     ~full strength late (CPU reference via src/fx/run.js).
//   Part C (export parity): a real runExport of the same keyframed clip
//     shows the same trend in the encoded frames: early frame near the
//     source, late frame clearly blurred.
// Usage: TMPDIR on disk if /tmp is small; node scripts/test-fx-keyframes.cjs
process.env.FVE_ENCODER = 'libx264';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport } = require('../electron/ffmpeg.cjs');

const W = 320;
const H = 180;
const FPS = 30;
const LEN = 2;
const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

(async () => {
  const { fxStrengthAt, sanitizeFxKeys, upsertFxKey, removeFxKey } = await import('../src/fx/fxKeys.js');
  const { pixelPasses } = await import('../src/fx/apply.js');
  const { runEffect } = await import('../src/fx/run.js');

  // ---- Part A: pure keyframe math ------------------------------------------
  const keys = [{ t: 0, v: 0 }, { t: 2, v: 1 }];
  ok(fxStrengthAt(keys, 0) === 0, 'key at t=0 reads 0');
  ok(fxStrengthAt(keys, 2) === 1, 'key at t=2 reads 1');
  ok(Math.abs(fxStrengthAt(keys, 1) - 0.5) < 1e-9, 'midpoint interpolates to 0.5');
  ok(Math.abs(fxStrengthAt(keys, 0.5) - 0.25) < 1e-9, 'quarter point interpolates to 0.25');
  ok(fxStrengthAt(keys, -1) === 0, 'before the first key holds the first value');
  ok(fxStrengthAt(keys, 5) === 1, 'after the last key holds the last value');
  ok(fxStrengthAt([], 1, 0.7) === 0.7, 'no keys: the static strength is used');
  ok(fxStrengthAt(undefined, 1) === 1, 'no keys and no static strength: full strength');
  ok(fxStrengthAt([{ t: 1, v: 0.3 }], 0) === 0.3 && fxStrengthAt([{ t: 1, v: 0.3 }], 9) === 0.3, 'a single key holds everywhere');
  assertDeep(sanitizeFxKeys([{ t: 2, v: 1 }, { t: 0, v: 0 }, { t: 0, v: 0.5 }, { t: 'x', v: 1 }, { t: 1, v: 2 }], 2),
    [{ t: 0, v: 0.5 }, { t: 1, v: 1 }, { t: 2, v: 1 }], 'sanitize sorts, de-dupes (last wins), drops junk, clamps');
  assertDeep(upsertFxKey(keys, 1, 0.9), [{ t: 0, v: 0 }, { t: 1, v: 0.9 }, { t: 2, v: 1 }], 'upsert inserts in order');
  assertDeep(upsertFxKey(keys, 0, 0.2), [{ t: 0, v: 0.2 }, { t: 2, v: 1 }], 'upsert replaces a key at the same time');
  assertDeep(removeFxKey([{ t: 0, v: 0 }, { t: 1, v: 0.5 }, { t: 2, v: 1 }], 1.02), [{ t: 0, v: 0 }, { t: 2, v: 1 }], 'remove drops the nearest key');
  assertDeep(removeFxKey(keys, 1), keys, 'remove far from any key changes nothing');

  function assertDeep(a, b, msg) {
    const same = JSON.stringify(a) === JSON.stringify(b);
    ok(same, msg);
    if (!same) console.log('  got', JSON.stringify(a), 'want', JSON.stringify(b));
  }

  // ---- Fixture: detailed source --------------------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fxkeys-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const det = path.join(dir, 'det.mp4');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=${LEN}`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', det]);
  const media = [{ id: 'md', path: det, name: 'det.mp4', ...(await probe(det)) }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const clip = { ...base, id: 'c1', mediaId: 'md', in: 0, out: LEN, effects: ['blur'], fxKeys: { blur: [{ t: 0, v: 0 }, { t: 2, v: 1 }] } };
  const proj = { name: 'fxkeys', ratio: '16:9', width: W, height: H, fps: FPS, background: '#000000', media, videoClips: [clip], overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [] };

  const decodeFrames = (file, from, len) => {
    const raw = execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `trim=start=${from}:duration=${len},setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H},format=rgba`,
      '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 28 });
    const size = W * H * 4;
    const frames = [];
    for (let o = 0; o + size <= raw.length; o += size) frames.push(Buffer.from(raw.subarray(o, o + size)));
    return frames;
  };
  const frameAt = (file, t) => execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-frames:v', '1', '-vf', `scale=${W}:${H},format=rgba`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { maxBuffer: 1 << 24 });
  const meanDiff = (f1, f2) => {
    let s = 0;
    const n = Math.min(f1.length, f2.length);
    for (let i = 0; i < n; i++) s += Math.abs(f1[i] - f2[i]);
    return s / n;
  };
  const applyPasses = (frame, passes, lt) => {
    let cur = frame;
    for (const p of passes) {
      const out = new Uint8ClampedArray(W * H * 4);
      runEffect(cur, out, W, H, lt, p.expr);
      cur = Buffer.from(out);
    }
    return cur;
  };

  // ---- Part B: the shared engine renders the keyframe ramp -----------------
  const srcFrames = decodeFrames(det, 0, LEN);
  const early = applyPasses(srcFrames[3], pixelPasses(proj, clip, 0, 0.1), 0.1);
  const late = applyPasses(srcFrames[57], pixelPasses(proj, clip, 0, 1.9), 1.9);
  const dEarly = meanDiff(early, srcFrames[3]);
  const dLate = meanDiff(late, srcFrames[57]);
  console.log(`CPU reference: early diff ${dEarly.toFixed(3)}, late diff ${dLate.toFixed(3)}`);
  ok(dEarly < 0.5, 'preview engine: ~0 strength early leaves the frame near-untouched');
  ok(dLate > 2, 'preview engine: ~full strength late blurs the frame clearly');
  ok(dLate > dEarly * 4, 'preview engine: the keyframe ramp is visible in the render');
  // A clip with no keys renders exactly as before (static strength path).
  const staticClip = { ...clip, fxKeys: undefined, fxStrength: { blur: 0.5 } };
  const pStatic = pixelPasses(proj, staticClip, 0, 1);
  const pKeyed = pixelPasses(proj, { ...clip, fxKeys: { blur: [{ t: 0, v: 0.5 }, { t: 2, v: 0.5 }] } }, 0, 1);
  ok(JSON.stringify(pStatic.map((p) => p.expr)) === JSON.stringify(pKeyed.map((p) => p.expr)),
    'constant keys equal the static strength (old projects render identically)');

  // ---- Part C: the real export follows the same ramp ------------------------
  // The export's effects pass is the renderer's renderFxPass (src/fxExport.js):
  // it renders each frame through pixelPasses — the shared engine — into a
  // segment file, bakes videoOverride into the clip, and runExport encodes
  // that. A node test reproduces exactly that bake (the same recipe
  // test-fx-parity uses), then checks the encoded frames against the CPU
  // reference at early/late times. A detailed STILL source isolates the
  // signal: encode noise stays low and the blur ramp stands out.
  const { segmentEncoderArgs } = require('../electron/fxjobs.cjs');
  const { spawn } = require('child_process');
  const still = path.join(dir, 'still.png');
  gen(['-f', 'lavfi', '-i', `testsrc2=size=${W}x${H}:rate=${FPS}:duration=0.1`, '-frames:v', '1', still]);
  const stillMp4 = path.join(dir, 'still.mp4');
  gen(['-loop', '1', '-i', still, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-t', String(LEN), '-pix_fmt', 'yuv420p', stillMp4]);
  const sMedia = [{ id: 'ms', path: stillMp4, name: 'still.mp4', ...(await probe(stillMp4)) }];
  const sClip = { ...clip, mediaId: 'ms' };
  const sProj = { ...proj, media: sMedia, videoClips: [sClip] };
  const sFrames = decodeFrames(stillMp4, 0, LEN);
  const segFile = path.join(dir, 'seg.mkv');
  const enc = spawn(ffmpegPath, segmentEncoderArgs(segFile, W, H, FPS), { windowsHide: true });
  const encDone = new Promise((res, rej) => { enc.on('close', (c) => (c === 0 ? res() : rej(new Error(`override encoder ${c}`)))); enc.on('error', rej); });
  enc.stdin.on('error', () => {});
  const n = Math.round(LEN * FPS);
  for (let k = 0; k < n; k++) {
    const f = sFrames[Math.min(k, sFrames.length - 1)];
    const passes = pixelPasses(sProj, sClip, 0, k / FPS);
    const drawn = passes.length ? applyPasses(f, passes, k / FPS) : f;
    if (!enc.stdin.write(Buffer.from(drawn))) await new Promise((r) => enc.stdin.once('drain', r));
  }
  enc.stdin.end();
  await encDone;
  const baked = { ...sProj, videoClips: [{ ...sClip, adjust: {}, effects: [], videoOverride: { file: segFile, start: 0, end: LEN } }] };
  const outFile = path.join(dir, 'out.mp4');
  await runExport(baked, outFile, null).promise;
  ok(fs.existsSync(outFile) && fs.statSync(outFile).size > 0, 'keyframed export completes');
  for (const [label, k, t] of [['early', 6, 0.2], ['late', 54, 1.8]]) {
    const ref = applyPasses(sFrames[k], pixelPasses(sProj, sClip, 0, t), t);
    const exp = frameAt(outFile, t);
    const d = meanDiff(exp, ref);
    console.log(`export vs CPU reference (${label}): ${d.toFixed(3)}`);
    ok(d <= 3, `export: ${label} frame matches the keyframed CPU reference within codec tolerance 3`);
  }
  const expEarly = frameAt(outFile, 0.2);
  const expLate = frameAt(outFile, 1.8);
  const ramp = meanDiff(expEarly, expLate);
  console.log(`export ramp: exported early-vs-late ${ramp.toFixed(3)}`);
  ok(ramp > 2, 'export: the keyframe ramp is visible in the encoded output, matching the preview');

  fs.rmSync(dir, { recursive: true, force: true });
  if (fails.length) { console.error(`FX-KEYFRAMES FAIL (${fails.length})`); process.exit(1); }
  console.log('FX-KEYFRAMES OK');
})().catch((e) => { console.error(e); process.exit(1); });
