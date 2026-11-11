// Post-recording sound check: did a finished screen recording actually
// capture sound? One FFmpeg `volumedetect` pass over the file's audio
// reports the loudest peak in it. Digital silence measures -inf; room
// tone and microphone hiss stay far below speech. A peak at or under
// SILENT_PEAK_DB over a whole recording means nothing was really
// captured — a muted microphone, a denied device, a silent source.
//
// Used by electron/screenrec.cjs after a recording converts: when sound
// was expected (microphone or computer sound on) but the file is silent,
// the renderer tells the user plainly instead of letting them discover
// it later. It is the same local-DSP route as electron/silence.cjs —
// FFmpeg's own filters, no model, no network.
const { spawn } = require('child_process');
const { ffmpegPath } = require('./ffmpeg.cjs');

// The peak level (dBFS) at or below which a whole recording counts as
// silent. Speech and computer sound peak far above this; a working mic
// left in a quiet room is the only grey zone, and there "no sound" is
// literally true.
const SILENT_PEAK_DB = -50;

// The volumedetect log parser, exported for the suite. The filter prints
// one `max_volume: <value> dB` line when the file HAS an audio stream;
// no line at all means there is nothing to hear (video-only file, or
// FFmpeg refused the run). -inf is digital silence.
function parseVolumeLog(text) {
  const m = String(text || '').match(/max_volume:\s*(-inf|-?[0-9]+(?:\.[0-9]+)?)\s*dB/);
  if (!m) return { hasAudio: false, peakDb: null };
  if (m[1] === '-inf') return { hasAudio: true, peakDb: -Infinity };
  return { hasAudio: true, peakDb: Number(m[1]) };
}

// Measure `file`. Resolves { hasAudio, peakDb, silent }:
//   silent — no audio stream, or the peak is at/under the threshold.
// An analysis failure resolves silent:false with `error` set: a broken
// check must never brand a good recording silent. (A missing max_volume
// line is NOT a failure — with an audio stream the filter always prints
// one, so its absence means there is no audio to measure.)
function checkRecordingSound(file, opts = {}) {
  const thresholdDb = Number.isFinite(Number(opts.thresholdDb)) ? Number(opts.thresholdDb) : SILENT_PEAK_DB;
  return new Promise((resolve) => {
    const args = ['-hide_banner', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'];
    let p;
    try {
      p = spawn(ffmpegPath, args, { windowsHide: true });
    } catch (e) {
      return resolve({ hasAudio: null, peakDb: null, silent: false, error: e.message });
    }
    let log = '';
    p.stderr.on('data', (d) => { log += d; });
    p.on('error', (e) => resolve({ hasAudio: null, peakDb: null, silent: false, error: e.message }));
    p.on('close', (code) => {
      const { hasAudio, peakDb } = parseVolumeLog(log);
      if (!hasAudio) {
        // FFmpeg spells out a missing audio stream; anything else that
        // produced no measurement is an analysis failure, not silence.
        const noStream = /matches no streams|does not contain any stream|No audio stream/i.test(log);
        if (code !== 0 && !noStream) {
          return resolve({ hasAudio: null, peakDb: null, silent: false, error: log.slice(-500) || `Sound check exited with ${code}` });
        }
        return resolve({ hasAudio: false, peakDb: null, silent: true });
      }
      resolve({ hasAudio: true, peakDb, silent: peakDb <= thresholdDb });
    });
  });
}

module.exports = { checkRecordingSound, parseVolumeLog, SILENT_PEAK_DB };
