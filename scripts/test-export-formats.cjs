// Export formats (Sprint 3): the format is a real choice end to end —
//   - argument construction per format (MP4/MOV share the H.264 stage, WebM is VP9+Opus
//     with no mov-only options, GIF takes the palette branch and maps no audio),
//   - the resolver's format rules (MP4 default, WebM -> MP4 fallback without VP9,
//     GIF geometry from the size preset, settings patches that preserve the format),
//   - real exports probed for container + streams (MOV, WebM, GIF, MP4/MOV + mov_text),
//   - the GIF duration cap refusing honestly instead of grinding.
// Usage: node scripts/test-export-formats.cjs
process.env.FVE_ENCODER = 'libx264'; // deterministic software encoding
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, ffprobePath, probe, runExport, buildExportArgs } = require('../electron/ffmpeg.cjs');

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

function probeFull(file) {
  const out = execFileSync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]).toString();
  const j = JSON.parse(out);
  return {
    format: j.format.format_name,
    duration: Number(j.format.duration),
    video: j.streams.find((s) => s.codec_type === 'video'),
    audio: j.streams.find((s) => s.codec_type === 'audio'),
    subtitle: j.streams.find((s) => s.codec_type === 'subtitle'),
  };
}

(async () => {
  const { resolveExport, storedExportSettings, settingsPatch } = await import('../src/exportQuality.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-fmt-'));
  const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
  const src = path.join(dir, 'src.mp4');
  gen(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-crf', '12', src]);
  const info = await probe(src);
  const media = [{ id: 'm1', path: src, name: 'src.mp4', ...info }];
  const base = { volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, speed: 1 };
  const mkProject = (exportSettings) => ({
    name: 'fmt', ratio: '16:9', resolution: 720, width: 640, height: 360, fps: 30, background: '#101010', media,
    videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 4 }],
    overlayClips: [], textClips: [], audioClips: [],
    ...(exportSettings ? { exportSettings } : {}),
  });
  const stamped = (exportSettings, caps = { libx265: true, vp9: true }) => {
    const p = mkProject(exportSettings);
    p.export = resolveExport(p, caps);
    return p;
  };
  const argsOf = (p, out) => buildExportArgs(p, out, { encoder: 'libx264' }).args;
  const FAST = { preset: 'custom', custom: { mode: 'crf', crf: 28, bitrateMbps: 12, resCap: 0, fps: 0, codec: 'h264', encoderPreset: 'ultrafast', audioKbps: 128 } };

  // ---- Resolver rules -------------------------------------------------------
  check(resolveExport(mkProject(null), {}).format === 'mp4', 'no stored settings -> MP4 (the historical default)');
  const noVp9 = resolveExport(mkProject({ ...FAST, format: 'webm' }), { libx265: true, vp9: false });
  check(noVp9.format === 'mp4' && noVp9.notes.some((n) => n.includes('WebM')), 'WebM without VP9 in the build falls back to MP4, with the note saying so');
  const big = { ...mkProject(null), width: 1280, height: 720 };
  const gifBig = resolveExport({ ...big, exportSettings: { ...FAST, format: 'gif', gifSize: 640, gifFps: 15 } }, {});
  check(gifBig.gifW === 640 && gifBig.gifH === 360, `GIF geometry: 1280x720 at the 640 preset -> 640x360 (got ${gifBig.gifW}x${gifBig.gifH})`);
  const gifSmall = resolveExport(mkProject({ ...FAST, format: 'gif', gifSize: 640, gifFps: 15 }), {});
  check(gifSmall.gifW === 640 && gifSmall.gifH === 360, 'GIF geometry at project size when under the preset (never upscaled)');
  const tiny = { ...mkProject(null), width: 320, height: 180 };
  const gifTiny = resolveExport({ ...tiny, exportSettings: { ...FAST, format: 'gif', gifSize: 640, gifFps: 15 } }, {});
  check(gifTiny.gifW === 320 && gifTiny.gifH === 180, 'GIF geometry: a 320x180 project stays 320x180 at the 640 preset');
  // settingsPatch: a quality-only patch must not reset the format fields, and vice versa.
  const withWebm = { exportSettings: { preset: 'high', custom: {}, format: 'webm', gifSize: 320, gifFps: 20 } };
  const patched = settingsPatch(withWebm, { preset: 'low', custom: {} });
  check(patched.exportSettings.format === 'webm' && patched.exportSettings.gifSize === 320 && patched.exportSettings.gifFps === 20,
    'settingsPatch preserves format/GIF fields across a quality-only patch');
  const repatched = settingsPatch({ exportSettings: patched.exportSettings }, { preset: 'low', custom: {}, format: 'gif', subtitleTrack: true });
  check(repatched.exportSettings.format === 'gif' && repatched.exportSettings.subtitleTrack === true, 'settingsPatch applies format-side fields when named');
  check(storedExportSettings(withWebm).format === 'webm', 'storedExportSettings reads the format back');

  // ---- Argument construction per format -------------------------------------
  const mp4 = argsOf(stamped(FAST), path.join(dir, 'x.mp4')).join(' ');
  check(mp4.includes('libx264') && mp4.includes('-c:a aac') && mp4.includes('+faststart') && !mp4.includes('libvpx') && !mp4.includes('mov_text'),
    'MP4: H.264 + AAC + faststart, no VP9, no subtitle stream without the toggle');
  const mov = argsOf(stamped({ ...FAST, format: 'mov' }), path.join(dir, 'x.mov')).join(' ');
  check(mov.includes('libx264') && mov.includes('-c:a aac') && mov.includes('+faststart'), 'MOV: the same H.264/AAC stage in the MOV muxer');
  const webm = argsOf(stamped({ ...FAST, format: 'webm' }), path.join(dir, 'x.webm'));
  const webmS = webm.join(' ');
  check(webmS.includes('libvpx-vp9') && webmS.includes('libopus') && webmS.includes('-crf 28'), 'WebM: VP9 constrained-quality from the CRF setting + Opus audio');
  check(!webmS.includes('movflags') && !webmS.includes('-c:a aac') && !webmS.includes('color_primaries'), 'WebM: no mov-only options leak into the WebM muxer');
  const webmBr = argsOf(stamped({ format: 'webm', preset: 'custom', custom: { ...FAST.custom, mode: 'bitrate', bitrateMbps: 8 } }), path.join(dir, 'x.webm')).join(' ');
  check(webmBr.includes('-b:v 8M'), 'WebM bitrate mode: the target bitrate reaches VP9');
  const gifArgs = argsOf(stamped({ ...FAST, format: 'gif', gifSize: 320, gifFps: 12 }), path.join(dir, 'x.gif'));
  const gifS = gifArgs.join(' ');
  check(gifS.includes('palettegen') && gifS.includes('paletteuse'), 'GIF: the palettegen/paletteuse branch is in the graph');
  check(gifArgs.filter((a) => a === '-map').length === 1 && !gifS.includes('-c:a'), 'GIF: exactly one map (video), no audio anywhere');
  check(gifS.includes('fps=12') && gifS.includes('scale=320:180'), 'GIF: the size preset and frame rate reach the graph');

  // ---- GIF duration cap -------------------------------------------------------
  const longMedia = [{ id: 'm1', path: src, name: 'src.mp4', ...info, duration: 40 }];
  const longProject = { ...mkProject({ ...FAST, format: 'gif' }), media: longMedia, videoClips: [{ ...base, id: 'c1', mediaId: 'm1', in: 0, out: 35 }] };
  longProject.export = resolveExport(longProject, { libx265: true, vp9: true });
  let capError = null;
  try { buildExportArgs(longProject, path.join(dir, 'long.gif'), { encoder: 'libx264' }); } catch (e) { capError = e; }
  check(!!capError && /GIF export is limited to 30 s/.test(capError.message), `GIF over 30 s refuses with the honest message (got: ${capError && capError.message})`);

  // ---- Real exports -----------------------------------------------------------
  const run = async (label, exportSettings, extra = {}) => {
    const p = stamped(exportSettings);
    Object.assign(p, extra);
    const out = path.join(dir, `${label}.${p.export.format}`);
    await runExport(p, out, () => {}).promise;
    return { out, probe: probeFull(out) };
  };
  const movR = await run('real-mov', { ...FAST, format: 'mov' });
  check(movR.probe.format.includes('mov') && movR.probe.video.codec_name === 'h264' && movR.probe.audio.codec_name === 'aac',
    `MOV export: mov container, H.264 + AAC (got ${movR.probe.format} / ${movR.probe.video.codec_name} / ${movR.probe.audio && movR.probe.audio.codec_name})`);
  const webmR = await run('real-webm', { ...FAST, format: 'webm' });
  check(webmR.probe.format.includes('webm') && webmR.probe.video.codec_name === 'vp9' && webmR.probe.audio.codec_name === 'opus',
    `WebM export: webm container, VP9 + Opus (got ${webmR.probe.format} / ${webmR.probe.video.codec_name} / ${webmR.probe.audio && webmR.probe.audio.codec_name})`);
  check(Math.abs(webmR.probe.duration - 4) < 0.4, `WebM duration matches the timeline (${webmR.probe.duration.toFixed(2)}s)`);
  const gifR = await run('real-gif', { ...FAST, format: 'gif', gifSize: 320, gifFps: 12 });
  check(gifR.probe.format === 'gif' && gifR.probe.video.codec_name === 'gif' && !gifR.probe.audio,
    'GIF export: gif stream, no audio stream');
  check(gifR.probe.video.width === 320 && gifR.probe.video.height === 180, `GIF export at the 320 preset (got ${gifR.probe.video.width}x${gifR.probe.video.height})`);
  // A GIF carries no container duration: count frames (4 s at 12 fps = 48, ±2 for edge frames).
  const frameCount = Number(JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-count_frames', '-print_format', 'json', '-show_streams', gifR.out]).toString()).streams[0].nb_read_frames);
  check(Math.abs(frameCount - 48) <= 2, `GIF duration matches the timeline (${frameCount} frames at 12 fps ≈ ${(frameCount / 12).toFixed(2)}s)`);
  check(fs.readFileSync(gifR.out).includes('NETSCAPE2.0'), 'GIF loops (NETSCAPE2.0 extension present)');

  // ---- mov_text subtitle track --------------------------------------------------
  const srtFile = path.join(dir, 'captions.srt');
  fs.writeFileSync(srtFile, '1\n00:00:00,500 --> 00:00:02,000\nHello captions\n\n2\n00:00:02,500 --> 00:00:03,500\nSecond line\n');
  const subR = await run('real-subs', { ...FAST, format: 'mp4', subtitleTrack: true }, { subtitleFile: srtFile, subtitleLang: 'en' });
  check(!!subR.probe.subtitle && subR.probe.subtitle.codec_name === 'mov_text',
    `MP4 + subtitle toggle: a mov_text stream is muxed (got ${subR.probe.subtitle && subR.probe.subtitle.codec_name})`);
  check(subR.probe.video.codec_name === 'h264' && !!subR.probe.audio, 'MP4 + subtitle toggle: video and audio streams unaffected');
  const extracted = path.join(dir, 'extracted.srt');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', subR.out, '-map', '0:s:0', '-c:s', 'srt', extracted]);
  const back = fs.readFileSync(extracted, 'utf8');
  const startMatch = back.match(/00:00:00,(\d{3})/);
  check(back.includes('Hello captions') && back.includes('Second line') && startMatch && Number(startMatch[1]) >= 400 && Number(startMatch[1]) <= 650,
    'mov_text cues round-trip: texts intact, first cue starts at ~0.5 s');
  const subMov = await run('real-subs-mov', { ...FAST, format: 'mov', subtitleTrack: true }, { subtitleFile: srtFile });
  check(!!subMov.probe.subtitle && subMov.probe.subtitle.codec_name === 'mov_text', 'MOV + subtitle toggle: mov_text muxes there too');
  const noFile = argsOf(stamped({ ...FAST, format: 'mp4', subtitleTrack: true }), path.join(dir, 'x.mp4')).join(' ');
  check(!noFile.includes('mov_text'), 'subtitle toggle without a staged SRT: no subtitle stream, no phantom args');
  const offArgs = argsOf(stamped({ ...FAST, format: 'mp4', subtitleTrack: false }), path.join(dir, 'x.mp4')).join(' ');
  check(!offArgs.includes('mov_text'), 'subtitle toggle off: no mov_text even though the builder could add one');

  console.log(failures ? `\nEXPORT FORMATS: ${failures} FAILURE(S) — outputs in ${dir}` : `\nEXPORT FORMATS OK — outputs in ${dir}`);
  if (failures) process.exitCode = 1;
})().catch((e) => { console.error('EXPORT FORMATS ERROR:', e.message); process.exitCode = 1; });
