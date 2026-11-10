// Audio-only export parity (Sprint 3): the audio export is no longer a second-class path —
//   - it honours the resolved export settings (the chosen audio bitrate reaches the encoder;
//     two settings produce measurably different output bitrates),
//   - it runs as a job with real progress (monotonic 0..1 events, ending at 1),
//   - the master loudnorm stage measures the mixdown and gains it to the -14 LUFS target.
// Cancel coverage for the audio job lives in test-export-cancel.cjs.
// Usage: node scripts/test-export-audio-parity.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { ffmpegPath, ffprobePath, probe, buildAudioExportArgs, runAudioExport, exportAudio } = require('../electron/ffmpeg.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

function audioBitrate(file) {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim());
}

// Integrated loudness of a finished file, measured with the same loudnorm analysis the
// master stage uses — the output must land on the master target.
function integratedLoudness(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/"input_i"\s*:\s*"([^"]+)"/);
  return m ? Number(m[1]) : NaN;
}

(async () => {
  const { resolveExport } = await import('../src/exportQuality.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-aup-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const src = path.join(dir, 'src.mp4');
  // A quiet tone (volume 0.1 ≈ -20 dBFS): the master stage has real work to do on it.
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-af', 'volume=0.1', '-shortest', '-c:v', 'libx264', '-crf', '18', src]);
  const info = await probe(src);
  const media = [{ id: 'm1', path: src, name: 'src.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (audioKbps) => {
    const p = {
      name: 'aup', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010', media,
      videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 8 }],
      overlayClips: [], textClips: [], audioClips: [],
      exportSettings: { preset: 'custom', custom: { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps } },
    };
    p.export = resolveExport(p, { libx265: true, vp9: true });
    return p;
  };

  // ---- Argument level ---------------------------------------------------------
  const unstamped = { ...mkProject(192) };
  delete unstamped.export;
  check(buildAudioExportArgs(unstamped, path.join(dir, 'x.mp3'), 'mp3').join(' ').includes('-b:a 192k'),
    'unstamped project keeps the historical 192k (the fallback did not move)');
  check(buildAudioExportArgs(mkProject(128), path.join(dir, 'x.mp3'), 'mp3').join(' ').includes('-b:a 128k'), 'MP3 args carry the stamped 128k');
  check(buildAudioExportArgs(mkProject(320), path.join(dir, 'x.m4a'), 'm4a').join(' ').includes('-b:a 320k'), 'M4A args carry the stamped 320k');
  const wavArgs = buildAudioExportArgs(mkProject(320), path.join(dir, 'x.wav'), 'wav').join(' ');
  check(wavArgs.includes('pcm_s16le') && !wavArgs.includes('-b:a'), 'WAV is lossless PCM — no bitrate is invented for it');

  // ---- Real exports: settings bite, progress flows -----------------------------
  const lo = path.join(dir, 'lo.mp3');
  await runAudioExport(mkProject(96), lo, 'mp3', () => {}).promise;
  const seen = [];
  const hi = path.join(dir, 'hi.mp3');
  await runAudioExport(mkProject(320), hi, 'mp3', (p) => seen.push(p)).promise;
  const loK = audioBitrate(lo) / 1000;
  const hiK = audioBitrate(hi) / 1000;
  check(hiK > loK * 1.8, `two bitrate settings -> measurably different outputs (96k stamps ${Math.round(loK)}k, 320k stamps ${Math.round(hiK)}k)`);
  const loInfo = await probe(lo);
  check(Math.abs(loInfo.duration - 8) < 0.3, `audio export duration matches the timeline (${loInfo.duration.toFixed(2)}s)`);
  check(seen.length >= 3 && seen.every((v) => v >= 0 && v <= 1) && seen.every((v, i) => i === 0 || v >= seen[i - 1]) && seen[seen.length - 1] === 1,
    `progress: ${seen.length} monotonic events in [0,1], ending at 1`);

  // ---- Master loudnorm stage ------------------------------------------------------
  const I = integratedLoudness(hi);
  check(Number.isFinite(I) && Math.abs(I - (-14)) <= 1.5, `master stage: the quiet mix leaves at the -14 LUFS target (measured ${I.toFixed(2)} LUFS)`);
  const wav = path.join(dir, 'master.wav');
  await runAudioExport(mkProject(192), wav, 'wav', () => {}).promise;
  const Iw = integratedLoudness(wav);
  check(Number.isFinite(Iw) && Math.abs(Iw - (-14)) <= 1.5, `master stage applies to WAV too (measured ${Iw.toFixed(2)} LUFS)`);

  // ---- Back-compat wrapper -----------------------------------------------------------
  const wrapped = path.join(dir, 'wrapped.mp3');
  await exportAudio(mkProject(192), wrapped, 'mp3');
  check(fs.existsSync(wrapped) && fs.statSync(wrapped).size > 0, 'exportAudio() promise wrapper still exports');

  console.log(failures ? `\nAUDIO PARITY: ${failures} FAILURE(S) — outputs in ${dir}` : `\nAUDIO PARITY OK — outputs in ${dir}`);
  if (failures) process.exitCode = 1;
})().catch((e) => { console.error('AUDIO PARITY ERROR:', e.message); process.exitCode = 1; });
