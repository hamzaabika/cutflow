// Master loudness (P1-14): measure a finished export with ffmpeg's loudnorm
// analysis pass and bring its mix to a target, then report what the delivered
// file actually measures (integrated LUFS, LRA, true peak, clipping).
//
// Design (the matrix §3 design, shared with the audio-only export): measure,
// then a plain gain — never a second dynamic pass over clips that may already
// carry per-clip loudnorm. The gain is applied to the AUDIO stream only; the
// video stream is copied untouched, so the picture never re-encodes. The
// normalized file is written to a temp path and moved over the original only
// on success, so a failure or a cancel leaves the finished export intact.
//
// This module takes the ffmpeg/ffprobe paths as arguments and never requires
// ffmpeg.cjs, so the audio export (which lives there) can use it without a
// require cycle.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
// P1-52: the pause state lives in its own dependency-free module so both this
// file and ffmpeg.cjs can share it without a require cycle.
const { trackExportProc } = require('./exportPause.cjs');

// Loudness targets (EBU R128 / platform norms). 'social' is the default: it
// is the target the per-clip loudnorm and the audio-only master stage already
// used (-14 LUFS / -1 dBTP), so video exports now match audio exports.
const LOUDNESS_TARGETS = {
  social: { id: 'social', I: -14, TP: -1, LRA: 11 },
  podcast: { id: 'podcast', I: -16, TP: -1, LRA: 11 },
  broadcast: { id: 'broadcast', I: -23, TP: -2, LRA: 7 },
};
const LOUDNESS_IDS = ['off', 'social', 'podcast', 'broadcast', 'custom'];

// Resolve the stored export settings to a target, or null when mastering is
// off. Anything unrecognised falls back to the social default — the same
// fallback effectiveExport applies to the other export fields.
function resolveLoudnessTarget(exp) {
  const e = exp || {};
  const id = LOUDNESS_IDS.includes(e.loudness) ? e.loudness : 'social';
  if (id === 'off') return null;
  if (id === 'custom') {
    const I = Number.isFinite(Number(e.loudnessI)) ? Math.max(-30, Math.min(-8, Number(e.loudnessI))) : -14;
    return { id, I, TP: -1, LRA: 11 };
  }
  return { ...LOUDNESS_TARGETS[id] };
}

// Does this project have any audible sound to master? A clip counts when it
// is not muted and its media reports audio. (A silent timeline measures
// nothing, so the stage skips and the done card shows no loudness line.)
function projectHasAudio(project) {
  const byId = new Map((project.media || []).map((m) => [m.id, m]));
  const audible = (c) => c && !c.muted && byId.get(c.mediaId)?.hasAudio;
  return (project.videoClips || []).some(audible)
    || (project.overlayClips || []).some(audible)
    || (project.audioClips || []).some(audible);
}

// Parse the loudnorm JSON block ffmpeg prints to stderr on its analysis pass:
// {"input_i": "-20.12", "input_tp": "-3.40", "input_lra": "8.20",
//  "input_thresh": "-30.45", "target_offset": "0.00", "linear": "true", ...}
// Silence measures as input_i "-inf" — that is unmeasurable, not -Infinity.
function parseLoudnormJson(stderr) {
  const m = stderr.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (!m) return null;
  let j = null;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const I = Number(j.input_i);
  if (!Number.isFinite(I)) return null;
  return {
    integrated: I,
    truePeak: Number(j.input_tp),
    lra: Number(j.input_lra),
    thresh: Number(j.input_thresh),
    targetOffset: Number(j.target_offset),
    linear: j.linear === 'true',
  };
}

// B-F19 — the live LUFS panel's data: EBU R128 momentary/short-term samples
// over the whole file (10 Hz) plus the summary (integrated, LRA, true peak).
// ebur128's frame lines only print at verbose log level, so the run asks
// for it; the summary block is parsed separately (frame lines carry their
// own running I/LRA, which are NOT the summary).
function parseEbur128Curve(stderr) {
  const samples = [];
  const re = /t:\s*([\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g;
  let m;
  while ((m = re.exec(stderr))) {
    const t = Number(m[1]);
    const mom = Number(m[2]);
    const st = Number(m[3]);
    if (Number.isFinite(t)) samples.push({ t, m: Number.isFinite(mom) ? mom : null, s: Number.isFinite(st) ? st : null });
  }
  const summaryAt = stderr.lastIndexOf('Summary:');
  const summary = summaryAt >= 0 ? stderr.slice(summaryAt) : '';
  const grab = (label) => {
    const mm = new RegExp(`${label}:\\s*(-?[\\d.]+)`).exec(summary);
    return mm ? Number(mm[1]) : null;
  };
  const integrated = grab('I');
  const lra = grab('LRA');
  const truePeak = grab('Peak');
  if (!samples.length && !Number.isFinite(integrated)) return null;
  // Cap the sample count for long timelines (stride to ≤ 1200 points).
  const stride = Math.max(1, Math.ceil(samples.length / 1200));
  const thin = stride === 1 ? samples : samples.filter((_, i) => i % stride === 0);
  return { samples: thin, integrated, lra, truePeak, duration: samples.length ? samples[samples.length - 1].t : 0 };
}

function measureLoudnessCurve(ffmpegPath, file) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostats', '-v', 'verbose', '-i', file, '-af', 'ebur128=framelog=verbose:peak=true', '-f', 'null', '-'], { windowsHide: true });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(parseEbur128Curve(err)));
  });
}

// One loudnorm analysis pass over a file. Returns the measurement or null
// (silence / no audio / ffmpeg failure — the caller treats null as "nothing
// to normalize", never as an error).
function measureLoudness(ffmpegPath, file) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { windowsHide: true });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(parseLoudnormJson(err)));
  });
}

// The file's first audio stream (codec + bitrate + duration), or null.
function probeAudio(ffprobePath, file) {
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(ffprobePath, ['-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,bit_rate', '-show_entries', 'format=duration',
      '-of', 'json', file], { windowsHide: true });
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const s = (j.streams || [])[0];
        if (!s) return resolve(null);
        resolve({ codec: s.codec_name || null, bitrate: Number(s.bit_rate) || 0, duration: Number(j.format?.duration) || 0 });
      } catch { resolve(null); }
    });
  });
}

const AUDIO_ENCODERS = { aac: 'aac', opus: 'libopus', mp3: 'libmp3lame', vorbis: 'libvorbis', flac: 'flac', pcm_s16le: 'pcm_s16le', pcm_f32le: 'pcm_f32le' };
function runFfmpeg(ffmpegPath, args, onProgress, totalSeconds) {
  return new Promise((resolve, reject) => {
    // P1-52: the normalize re-encode is a long export child — pausable like
    // the encode itself (the short loudnorm measure pass is not tracked).
    const p = trackExportProc(spawn(ffmpegPath, args, { windowsHide: true }));
    let err = '';
    let last = '';
    const feed = (d) => {
      const s = last + d.toString();
      const lines = s.split('\n');
      last = lines.pop();
      for (const line of lines) {
        const m = /out_time_ms=(\d+)/.exec(line);
        if (m && onProgress && totalSeconds > 0) onProgress(Math.min(1, Number(m[1]) / 1e6 / totalSeconds));
      }
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-2000) || `FFmpeg exited with ${code}`))));
  });
}

// Normalize a finished export file to the target, in place (via a temp file).
// Returns the report for the done card:
//   { applied, gainDb, target: {I, TP, LRA}, measured: <before>, final: <after> }
// measured/final are measureLoudness results ({ integrated, truePeak, lra });
// final.clipped is true when the delivered file's true peak is over 0 dBTP.
// A file with no audio, silence, or a gain under 0.05 dB is left untouched
// (applied: false) — the report still carries the measurement when there is one.
async function normalizeLoudness(ffmpegPath, ffprobePath, file, target, opts = {}) {
  const measured = await measureLoudness(ffmpegPath, file);
  if (!measured) return { applied: false, gainDb: 0, target, measured: null, final: null };
  if (opts.isCanceled?.()) return { applied: false, gainDb: 0, target, measured, final: { ...measured, clipped: Number.isFinite(measured.truePeak) && measured.truePeak > 0 }, canceled: true };
  let gain = target.I - measured.integrated;
  if (Number.isFinite(measured.truePeak)) gain = Math.min(gain, target.TP - measured.truePeak);
  gain = Math.max(-24, Math.min(24, gain));
  if (Math.abs(gain) < 0.05) {
    return { applied: false, gainDb: gain, target, measured, final: { ...measured, clipped: Number.isFinite(measured.truePeak) && measured.truePeak > 0 } };
  }
  const audio = await probeAudio(ffprobePath, file);
  if (!audio) return { applied: false, gainDb: gain, target, measured, final: { ...measured, clipped: Number.isFinite(measured.truePeak) && measured.truePeak > 0 } };
  const encoder = AUDIO_ENCODERS[audio.codec] || (path.extname(file).toLowerCase() === '.webm' ? 'libopus' : 'aac');
  const bitrateKbps = Math.max(32, Math.min(512, Math.round((audio.bitrate || (opts.audioKbps || 192) * 1000) / 1000)));
  // The temp file MUST live next to the target: rename(2) cannot cross
  // filesystems, and os.tmpdir() is a tmpfs here while exports live on disk —
  // a temp under os.tmpdir() fails the rename with EXDEV (caught live
  // 2026-11-15: the stage silently never applied). A stale temp from a
  // killed run is overwritten by ffmpeg's -y; the catch/cancel paths below
  // remove it, so only a hard kill can leave one behind.
  const tmp = path.join(path.dirname(file), `.fve-loud-${process.pid}-${Date.now()}${path.extname(file) || '.mp4'}`);
  try {
    await runFfmpeg(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file,
      '-map', '0:v?', '-map', '0:a?', '-c:v', 'copy', '-c:a', encoder, '-b:a', `${bitrateKbps}k`,
      '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.98:level=false`,
      '-progress', 'pipe:1', '-nostats', tmp],
      opts.onProgress, audio.duration);
    if (opts.isCanceled?.()) { fs.rmSync(tmp, { force: true }); return { applied: false, gainDb: gain, target, measured, final: { ...measured, clipped: Number.isFinite(measured.truePeak) && measured.truePeak > 0 }, canceled: true }; }
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  const final = await measureLoudness(ffmpegPath, file);
  const report = final || measured;
  return { applied: true, gainDb: gain, target, measured, final: { ...report, clipped: Number.isFinite(report.truePeak) && report.truePeak > 0 } };
}

module.exports = { LOUDNESS_TARGETS, LOUDNESS_IDS, resolveLoudnessTarget, projectHasAudio, parseLoudnormJson, parseEbur128Curve, measureLoudness, measureLoudnessCurve, probeAudio, normalizeLoudness };
