// Automatic Export Quality Check (P1-57, Hamza's upgrade A).
//
// After every export the finished file is verified with ffprobe + one
// ffmpeg analysis pass — no new dependencies. The check flags, on the
// done card:
//
//   fail (the export is wrong): wrong dimensions, wrong fps, duration
//     off by more than 0.5 s, no audio stream when the project has sound,
//     the whole file silent, a text clip using a font this PC does not have
//   warn (reported with timestamps, export still good): black runs,
//     frozen runs, silent sections
//
// False positives are the enemy here, so the hard failures are narrow by
// design: a fade-to-black outro or a still-image slideshow must NOT fail
// the check. That is why black and frozen are warn-only — a mostly-black
// export or a frozen picture is a legitimate creative choice, and the
// card reports it instead of condemning it. A frozen run that overlaps a
// black run by more than 80% is dropped as a duplicate (black frames are
// frozen by definition; the black finding already covers that span).
//
// The renderer owns the expectations (it has the resolvers): it passes
// `qcExpected` { width, height, fps, duration, hasAudio } and
// `qcMissingFonts` [ids] on the project object handed to export:run /
// export:audio. This module only verifies the file against them.
'use strict';

const { execFile } = require('child_process');
const path = require('path');

const DUR_TOL_S = 0.5;
const FPS_TOL = 0.5;
// Runs shorter than this are not reported at all (a 2-frame dip is noise).
const BLACK_MIN_S = 0.5;
const SILENCE_MIN_S = 2;
const FREEZE_MIN_S = 2;
// A black/frozen run counts as a finding worth warning about at 1 s.
const WARN_RUN_S = 1;
// Failing thresholds: black or frozen covering this share of the file.
const BLACK_FAIL_SHARE = 0.25;
const FREEZE_FAIL_SHARE = 0.5;
// Whole-file silence: the audio track is silent for at least this share.
const SILENT_ALL_SHARE = 0.95;

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...opts, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code !== 0 && !stderr) return reject(err);
      // The analysis pass exits 0 (it renders to null); a non-zero exit with
      // stderr still carries partial detections, so resolve with the text.
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function probeFile(ffprobePath, file) {
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, ['-v', 'error', '-show_entries',
      'stream=codec_type,width,height,r_frame_rate,avg_frame_rate,duration',
      '-show_entries', 'format=duration', '-of', 'json', file],
    { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`ffprobe failed: ${String(stderr || err.message).slice(-300)}`));
      try {
        const j = JSON.parse(stdout);
        const video = (j.streams || []).find((s) => s.codec_type === 'video') || null;
        const audio = (j.streams || []).find((s) => s.codec_type === 'audio') || null;
        resolve({
          video: video ? {
            width: video.width, height: video.height,
            fps: video.avg_frame_rate ? evalRate(video.avg_frame_rate) : null,
            duration: video.duration ? parseFloat(video.duration) : null,
          } : null,
          hasAudio: !!audio,
          duration: j.format && j.format.duration ? parseFloat(j.format.duration) : null,
        });
      } catch (e) { reject(new Error(`ffprobe output unparseable: ${e.message}`)); }
    });
  });
}

function evalRate(s) {
  const m = String(s).match(/^(\d+)\/(\d+)$/);
  if (!m) return parseFloat(s) || null;
  return m[2] === '0' ? null : parseInt(m[1], 10) / parseInt(m[2], 10);
}

// The detect filters log one line per run boundary. Tolerant regexes: the
// filters print `black_start:0` (no space) and `freeze_start: 0` (space).
const RE_BLACK_START = /black_start:\s*([\d.]+)/;
const RE_BLACK_END = /black_end:\s*([\d.]+)/;
const RE_BLACK_DUR = /black_duration:\s*([\d.]+)/;
const RE_SIL_START = /silence_start:\s*([\d.]+)/;
const RE_SIL_END = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/;
const RE_FRZ_START = /freeze_start:\s*([\d.]+)/;
const RE_FRZ_END = /freeze_end:\s*([\d.]+)/;
const RE_FRZ_DUR = /freeze_duration:\s*([\d.]+)/;

function parseRuns(stderr) {
  const black = [];
  const silence = [];
  const frozen = [];
  const pending = { black: null, silence: null, frozen: null };
  for (const line of String(stderr).split('\n')) {
    let m;
    // Each filter prints its run boundaries on one line per boundary — but
    // blackdetect puts start, end AND duration on a single line, so every
    // pattern is tried independently per line (an else-if chain would drop
    // the end and duration of that same line).
    if ((m = line.match(RE_BLACK_START))) pending.black = { start: parseFloat(m[1]), end: null };
    if ((m = line.match(RE_BLACK_END)) && pending.black) pending.black.end = parseFloat(m[1]);
    if ((m = line.match(RE_BLACK_DUR)) && pending.black) {
      pending.black.duration = parseFloat(m[1]);
      if (pending.black.end == null) pending.black.end = pending.black.start + pending.black.duration;
      black.push(pending.black); pending.black = null;
    }
    if ((m = line.match(RE_SIL_START))) pending.silence = { start: parseFloat(m[1]), end: null };
    if ((m = line.match(RE_SIL_END)) && pending.silence) {
      pending.silence.end = parseFloat(m[1]);
      pending.silence.duration = parseFloat(m[2]);
      silence.push(pending.silence); pending.silence = null;
    }
    if ((m = line.match(RE_FRZ_START))) pending.frozen = { start: parseFloat(m[1]), end: null };
    if ((m = line.match(RE_FRZ_END)) && pending.frozen) pending.frozen.end = parseFloat(m[1]);
    if ((m = line.match(RE_FRZ_DUR)) && pending.frozen) {
      pending.frozen.duration = parseFloat(m[1]);
      if (pending.frozen.end == null) pending.frozen.end = pending.frozen.start + pending.frozen.duration;
      frozen.push(pending.frozen); pending.frozen = null;
    }
  }
  // A run whose end never logged (file cut mid-run) still counts.
  for (const [key, list] of [['black', black], ['silence', silence], ['frozen', frozen]]) {
    const p = pending[key];
    if (p && p.end == null) list.push({ ...p, end: p.start, duration: 0 });
  }
  return { black, silence, frozen };
}

function overlapShare(a, b) {
  const lo = Math.max(a.start, b.start);
  const hi = Math.min(a.end, b.end);
  if (hi <= lo) return 0;
  const shorter = Math.min(a.end - a.start, b.end - b.start);
  return shorter > 0 ? (hi - lo) / shorter : 0;
}

function total(runs) {
  return runs.reduce((s, r) => s + Math.max(0, (r.end ?? r.start) - r.start), 0);
}

// Pure: findings + verdict from probe data, detect runs and expectations.
// Kept separate from the ffmpeg call so the thresholds are unit-testable.
function verdictOf({ expected, actual, black, silence, frozen, missingFonts }) {
  const findings = [];
  const dur = actual.duration;
  if (expected && actual.video) {
    if (expected.width != null && actual.video.width !== expected.width
      || expected.height != null && actual.video.height !== expected.height) {
      findings.push({
        id: 'dims', level: 'fail',
        detail: `expected ${expected.width}×${expected.height}, got ${actual.video.width}×${actual.video.height}`,
        expected: { width: expected.width, height: expected.height },
        actual: { width: actual.video.width, height: actual.video.height },
      });
    }
    if (expected.fps != null && actual.video.fps != null
      && Math.abs(actual.video.fps - expected.fps) > FPS_TOL) {
      findings.push({
        id: 'fps', level: 'fail',
        detail: `expected ${expected.fps} fps, got ${actual.video.fps.toFixed(2)} fps`,
        expected: { fps: expected.fps }, actual: { fps: actual.video.fps },
      });
    }
  }
  if (expected && expected.duration != null && dur != null
    && Math.abs(dur - expected.duration) > DUR_TOL_S) {
    findings.push({
      id: 'duration', level: 'fail',
      detail: `expected ${expected.duration.toFixed(1)} s, got ${dur.toFixed(1)} s`,
      expected: { duration: expected.duration }, actual: { duration: dur },
    });
  }
  if (expected && expected.hasAudio && !actual.hasAudio) {
    findings.push({ id: 'no-audio', level: 'fail', detail: 'project has sound but the export has no audio stream' });
  }
  const silentTotal = total(silence);
  if (dur != null && dur > 0 && actual.hasAudio && silentTotal / dur >= SILENT_ALL_SHARE) {
    findings.push({
      id: 'silent-all', level: 'fail',
      detail: `audio is silent for ${silentTotal.toFixed(1)} s of ${dur.toFixed(1)} s`,
    });
  }
  const blackTotal = total(black);
  if (black.length) {
    const worst = black.reduce((a, b) => Math.max(a, b.end - b.start), 0);
    findings.push({
      id: 'black',
      level: dur != null && dur > 0 && blackTotal / dur > BLACK_FAIL_SHARE ? 'fail' : 'warn',
      detail: `${black.length} black run${black.length > 1 ? 's' : ''}, ${blackTotal.toFixed(1)} s total`,
      runs: black.map((r) => ({ start: +r.start.toFixed(2), end: +r.end.toFixed(2) })),
      worst: +worst.toFixed(2),
    });
  }
  // Frozen runs that are really black runs (overlapping >80%) are dropped —
  // the black finding already covers that span.
  const frozenReal = frozen.filter((f) => !black.some((b) => overlapShare(f, b) > 0.8));
  const frozenTotal = total(frozenReal);
  if (frozenReal.length) {
    findings.push({
      id: 'frozen',
      level: dur != null && dur > 0 && frozenTotal / dur > FREEZE_FAIL_SHARE ? 'fail' : 'warn',
      detail: `${frozenReal.length} frozen run${frozenReal.length > 1 ? 's' : ''}, ${frozenTotal.toFixed(1)} s total`,
      runs: frozenReal.map((r) => ({ start: +r.start.toFixed(2), end: +r.end.toFixed(2) })),
    });
  }
  if (dur != null && dur > 0 && actual.hasAudio && silentTotal > 0 && silentTotal / dur < SILENT_ALL_SHARE) {
    const long = silence.filter((r) => (r.end - r.start) >= WARN_RUN_S);
    if (long.length) {
      findings.push({
        id: 'silent',
        level: 'warn',
        detail: `${long.length} silent section${long.length > 1 ? 's' : ''}, ${total(long).toFixed(1)} s total`,
        runs: long.map((r) => ({ start: +r.start.toFixed(2), end: +r.end.toFixed(2) })),
      });
    }
  }
  for (const id of missingFonts || []) {
    findings.push({ id: 'font', level: 'fail', detail: `text uses font "${id}", which this PC does not have — it rendered in Arial`, font: id });
  }
  const verdict = findings.some((f) => f.level === 'fail') ? 'fail'
    : findings.length ? 'warn' : 'pass';
  return { verdict, findings };
}

async function checkExport({ ffmpegPath, ffprobePath, file, expected, missingFonts, isCanceled }) {
  const probe = await probeFile(ffprobePath, file);
  if (isCanceled && isCanceled()) return null;
  const dur = probe.duration ?? probe.video?.duration ?? null;
  const video = expected && expected.kind === 'audio' ? null : probe.video;
  const args = ['-hide_banner', '-nostdin', '-i', file];
  if (video) {
    args.push('-vf', `blackdetect=d=${BLACK_MIN_S}:pic_th=0.98:pix_th=0.10,freezedetect=n=0.001:d=${FREEZE_MIN_S}`);
  }
  if (probe.hasAudio) args.push('-af', `silencedetect=noise=-50dB:d=${SILENCE_MIN_S}`);
  args.push('-f', 'null', '-');
  const { stderr } = await run(ffmpegPath, args, {});
  if (isCanceled && isCanceled()) return null;
  const { black, silence, frozen } = parseRuns(stderr);
  const report = verdictOf({
    expected, missingFonts,
    actual: { ...probe, video, duration: dur },
    black: black.filter((r) => (r.end - r.start) >= BLACK_MIN_S),
    silence: silence.filter((r) => (r.end - r.start) >= SILENCE_MIN_S),
    frozen: frozen.filter((r) => (r.end - r.start) >= FREEZE_MIN_S),
  });
  return {
    ...report,
    duration: dur != null ? +dur.toFixed(2) : null,
    expected: expected ? {
      width: expected.width ?? null, height: expected.height ?? null,
      fps: expected.fps ?? null, duration: expected.duration ?? null, hasAudio: !!expected.hasAudio,
    } : null,
    actual: {
      width: video ? video.width : null, height: video ? video.height : null,
      fps: video && video.fps != null ? +video.fps.toFixed(2) : null,
      duration: dur != null ? +dur.toFixed(2) : null, hasAudio: probe.hasAudio,
    },
  };
}

module.exports = {
  checkExport, verdictOf, parseRuns, overlapShare,
  DUR_TOL_S, FPS_TOL, BLACK_MIN_S, SILENCE_MIN_S, FREEZE_MIN_S,
};
