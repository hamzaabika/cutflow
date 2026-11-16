// Checklist #19 — Mute: a muted audio clip must be silent everywhere, not
// just in the menu state. The video and overlay tracks already honour
// clip.muted in preview and export; the audio track did not (Preview.jsx
// played it at full gain, and the export builders mixed it in). These
// checks assert, at the argument level, that a muted audio clip's file
// never reaches any ffmpeg command — video export, audio-only export,
// transcription/silence mix — and that it does not extend the export
// length. The preview gain guard is verified live (element volume reads
// 0 while a muted clip plays); the menu entry itself is verified live.
// Usage: node scripts/test-clip-mute.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe, buildAudioExportArgs, buildExportArgs, buildTimelineAudioArgs, audioExportTotal } = require('../electron/ffmpeg.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

(async () => {
  const { resolveExport } = await import('../src/exportQuality.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-mute-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  // Video with sound (8 s) + two tones: A is the clip that gets muted (20 s),
  // B stays live (8 s). Different frequencies so a mix-up would be audible.
  const vid = path.join(dir, 'vid.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-af', 'volume=0.5', '-shortest', '-c:v', 'libx264', '-crf', '18', vid]);
  const toneA = path.join(dir, 'toneA.wav');
  gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', toneA]);
  const toneB = path.join(dir, 'toneB.wav');
  gen(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=8', toneB]);
  const vInfo = await probe(vid);
  const aInfo = await probe(toneA);
  const bInfo = await probe(toneB);
  const media = [
    { id: 'mv', path: vid, name: 'vid.mp4', ...vInfo },
    { id: 'ma', path: toneA, name: 'toneA.wav', ...aInfo },
    { id: 'mb', path: toneB, name: 'toneB.wav', ...bInfo },
  ];
  check(vInfo.hasAudio && aInfo.hasAudio && bInfo.hasAudio, 'fixtures all carry audio');
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (mutedA) => {
    const p = {
      name: 'mute', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#101010', media,
      videoClips: [{ ...base, id: 'c1', mediaId: 'mv', in: 0, out: 8 }],
      overlayClips: [], textClips: [],
      audioClips: [
        { ...base, id: 'a1', mediaId: 'ma', in: 0, out: 20, start: 0, muted: mutedA },
        { ...base, id: 'a2', mediaId: 'mb', in: 0, out: 8, start: 0, muted: false },
      ],
      exportSettings: { preset: 'custom', custom: { mode: 'crf', crf: 20, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'veryfast', audioKbps: 192 } },
    };
    p.export = resolveExport(p, { libx265: true, vp9: true });
    return p;
  };

  // ---- Muted audio clip is excluded from every mix --------------------------
  const p = mkProject(true);
  const audioArgs = buildAudioExportArgs(p, path.join(dir, 'out.mp3'), 'mp3').join(' ');
  check(audioArgs.includes(toneB) && !audioArgs.includes(toneA), 'audio-only export: live tone in, muted tone out');
  const videoArgs = buildExportArgs(p, path.join(dir, 'out.mp4')).args.join(' ');
  check(videoArgs.includes(toneB) && !videoArgs.includes(toneA), 'video export: live tone in, muted tone out');
  const tlArgs = buildTimelineAudioArgs(p, path.join(dir, 'tl.wav'), 'audio').join(' ');
  check(tlArgs.includes(toneB) && !tlArgs.includes(toneA), 'transcription mix: live tone in, muted tone out');
  check(audioExportTotal(p) === 8, `export length ignores the muted 20 s clip (got ${audioExportTotal(p)}, want 8)`);

  // ---- Unmuting restores the clip (the flag is the only thing that changes) --
  const pLive = mkProject(false);
  const audioArgsLive = buildAudioExportArgs(pLive, path.join(dir, 'out2.mp3'), 'mp3').join(' ');
  check(audioArgsLive.includes(toneA) && audioArgsLive.includes(toneB), 'unmuted: both tones in the audio export');
  check(audioExportTotal(pLive) === 20, `unmuted: export length follows the 20 s clip (got ${audioExportTotal(pLive)})`);

  // ---- Everything muted: the audio export refuses instead of exporting silence
  const pSilent = mkProject(true);
  pSilent.videoClips[0].muted = true;
  pSilent.audioClips[1].muted = true;
  let threw = '';
  try { buildAudioExportArgs(pSilent, path.join(dir, 'out3.mp3'), 'mp3'); } catch (e) { threw = e.message; }
  check(/Nothing to export/.test(threw), `all-muted audio export refuses (got: ${threw || 'no error'})`);

  // ---- The video track's own mute still works (regression guard) -------------
  const pVidMuted = mkProject(false);
  pVidMuted.videoClips[0].muted = true;
  const vidMutedArgs = buildAudioExportArgs(pVidMuted, path.join(dir, 'out4.mp3'), 'mp3').join(' ');
  check(!vidMutedArgs.includes(vid), 'muted video clip: its sound leaves the audio export too');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `CLIP MUTE FAIL (${failures})` : 'CLIP MUTE OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
