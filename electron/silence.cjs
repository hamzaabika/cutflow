// Silence detection (10/10 step 4, Filmora merge row 14) — a local FFmpeg
// pass over a media file's audio that reports the silent spans in it. The
// pass is FFmpeg's own `silencedetect` filter: audio at or below the noise
// threshold for at least the minimum duration prints silence_start /
// silence_end lines, and this module parses that log back into
// [{ start, end }] in SOURCE seconds. No model download, no network — the
// same local-DSP route the scene and beat passes take. The renderer pads
// each span slightly (so speech edges are not clipped), maps it into the
// clip through the speed sampler, shows it on the waveform and removes it
// with the ordinary range-cut store actions, so a silence removal is
// indistinguishable from a manual one downstream.
const { spawn } = require('child_process');
const { ffmpegPath } = require('./ffmpeg.cjs');

const DEFAULT_THRESHOLD_DB = -45;
const DEFAULT_MIN_DURATION = 0.6;

// The silencedetect log parser, exported for the suite. A silence_end with
// no pending start means the file OPENS in silence (the filter only ever
// printed the end): the span starts at 0. A start left open at the end of
// the log closes at `durationHint` when the caller knows the media length.
function parseSilenceLog(text, durationHint) {
  const out = [];
  let pending = null;
  for (const line of String(text || '').split('\n')) {
    const s = line.match(/silence_start:\s*(-?[0-9]+(?:\.[0-9]+)?)/);
    if (s) { pending = Math.max(0, Number(s[1])); continue; }
    const e = line.match(/silence_end:\s*(-?[0-9]+(?:\.[0-9]+)?)/);
    if (e) {
      const end = Number(e[1]);
      const start = pending === null ? 0 : pending;
      if (end > start) out.push({ start, end });
      pending = null;
    }
  }
  if (pending !== null && Number.isFinite(durationHint) && durationHint > pending) {
    out.push({ start: pending, end: durationHint });
  }
  return out;
}

// Detect the silent spans in `file`. opts.thresholdDb: -70..-20 (default
// -45 dB — room tone and mic hiss stay above it, true pauses fall below).
// opts.minDuration: 0.2..5 s (default 0.6 — shorter gaps are breaths, not
// silences worth cutting). opts.durationHint closes a trailing silence.
// opts.isCanceled polls a cancellation flag, the other passes' pattern.
function detectSilence(file, opts = {}) {
  const thresholdDb = Math.min(-20, Math.max(-70, Number(opts.thresholdDb) || DEFAULT_THRESHOLD_DB));
  const minDuration = Math.min(5, Math.max(0.2, Number(opts.minDuration) || DEFAULT_MIN_DURATION));
  const isCanceled = opts.isCanceled || (() => false);
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-i', file,
      '-vn', '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
      '-f', 'null', '-'];
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let log = '';
    p.stderr.on('data', (d) => { log += d; if (isCanceled()) p.kill('SIGKILL'); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (isCanceled()) return resolve([]);
      if (code !== 0) return reject(new Error(log.slice(-2000) || `Silence detection exited with ${code}`));
      resolve(parseSilenceLog(log, Number(opts.durationHint)));
    });
  });
}

module.exports = { detectSilence, parseSilenceLog, DEFAULT_THRESHOLD_DB, DEFAULT_MIN_DURATION };
