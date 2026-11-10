// Export cancel lifecycle (Sprint 3): cancel must work at EVERY phase, exactly once,
// with no orphan process and no partial file —
//   - during the encoder-probe window (previously: killed nothing, the spawn still ran),
//   - mid-encode (the process dies, the truncated output is removed),
//   - for the audio job too (previously it had no cancel at all),
//   - and a cancel must not poison the next export.
// Usage: node scripts/test-export-cancel.cjs
process.env.FVE_ENCODER = 'libx264';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, runExport, runAudioExport } = require('../electron/ffmpeg.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Any live process whose command line names this output file (the export's own ffmpeg).
function processesOn(file) {
  let hits = 0;
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid) || Number(pid) === process.pid) continue;
    try {
      if (fs.readFileSync(path.join('/proc', pid, 'cmdline'), 'utf8').includes(file)) hits++;
    } catch { /* process exited */ }
  }
  return hits;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cancel-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const src = path.join(dir, 'src.mp4');
  // Noisy (ultrafast) source so the export encode has real work: 45 s at 360p.
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=45', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=45', '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', src]);
  const info = await probe(src);
  const media = [{ id: 'm1', path: src, name: 'src.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const project = {
    name: 'cancel', ratio: '16:9', width: 640, height: 360, fps: 30, background: '#101010', media,
    videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 45 }],
    overlayClips: [], textClips: [], audioClips: [],
  };

  // ---- 1. Cancel during the encoder-probe window --------------------------------
  const out1 = path.join(dir, 'probe-window.mp4');
  const t0 = Date.now();
  const job1 = runExport(project, out1, () => {});
  job1.cancel(); // synchronously: the probe promise has not resolved, nothing spawned yet
  const err1 = await job1.promise.then(() => null, (e) => e);
  const elapsed1 = Date.now() - t0;
  check(!!err1 && /cancel/i.test(err1.message), `probe-window cancel rejects as canceled (got: ${err1 && err1.message.split('\n')[0]})`);
  check(!fs.existsSync(out1), 'probe-window cancel: no output file was ever created');
  check(elapsed1 < 3000, `probe-window cancel settles immediately (${elapsed1} ms — no encode ran)`);
  check(processesOn(out1) === 0, 'probe-window cancel: no ffmpeg process exists for the output');

  // ---- 2. Cancel mid-encode ---------------------------------------------------------
  const out2 = path.join(dir, 'mid-encode.mp4');
  let canceledAt = 0;
  const job2 = runExport(project, out2, (p) => {
    if (p > 0 && !canceledAt) { canceledAt = Date.now(); job2.cancel(); }
  });
  setTimeout(() => { if (!canceledAt) { canceledAt = Date.now(); job2.cancel(); } }, 2500); // fallback if progress is slow to start
  const err2 = await job2.promise.then(() => null, (e) => e);
  check(!!err2 && /cancel/i.test(err2.message), `mid-encode cancel rejects as canceled (got: ${err2 && err2.message.split('\n')[0]})`);
  check(!fs.existsSync(out2), 'mid-encode cancel: the partial output file is removed');
  await sleep(400);
  check(processesOn(out2) === 0, 'mid-encode cancel: no orphan ffmpeg process remains');

  // ---- 3. Cancel the audio job ---------------------------------------------------------
  const out3 = path.join(dir, 'audio.mp3');
  const job3 = runAudioExport(project, out3, 'mp3', () => {});
  setTimeout(() => job3.cancel(), 250);
  const err3 = await job3.promise.then(() => null, (e) => e);
  check(!!err3 && /cancel/i.test(err3.message), `audio cancel rejects as canceled (got: ${err3 && err3.message.split('\n')[0]})`);
  check(!fs.existsSync(out3), 'audio cancel: no partial file remains');
  await sleep(300);
  check(processesOn(out3) === 0, 'audio cancel: no orphan ffmpeg process remains');

  // ---- 4. The next export is unaffected ---------------------------------------------------
  const short = {
    ...project,
    videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 2 }],
  };
  const out4 = path.join(dir, 'after.mp4');
  await runExport(short, out4, () => {}).promise;
  const info4 = await probe(out4);
  check(fs.existsSync(out4) && Math.abs(info4.duration - 2) < 0.25, 'a fresh export after the cancels completes normally');

  console.log(failures ? `\nEXPORT CANCEL: ${failures} FAILURE(S) — outputs in ${dir}` : `\nEXPORT CANCEL OK — outputs in ${dir}`);
  if (failures) process.exitCode = 1;
})().catch((e) => { console.error('EXPORT CANCEL ERROR:', e.message); process.exitCode = 1; });
