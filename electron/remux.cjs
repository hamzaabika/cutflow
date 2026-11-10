// Auto-remux: some containers make every decode-side seek slow or unreliable —
// MPEG-TS timestamps jump and drift, FLV has no real index, and an MP4 whose
// index (moov) sits at the end of the file forces a full scan before the first
// frame. CapCut's answer is a RemuxCache; this is the same idea in Cutflow's
// media cache: at first sight of such a file, stream-copy it (-c copy — no
// re-encode, no quality change, seconds rather than minutes) into a faststart
// MP4 next to the preview copies, and let the decode-side consumers (export
// graphs, caption audio, copy generation) read the copy transparently. The
// original file is never modified; if the remux fails or verifies short, the
// item simply keeps using the original. Pure module (no Electron imports).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { probe, usableCopyFile, encoderBinaries } = require('./ffmpeg.cjs');

function runFfmpegOn(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-2000) || `ffmpeg exited ${code}`))));
  });
}

// Is this MP4/MOV file faststart (index before the picture data)? Walks the
// top-level boxes: 'moov' seen before 'mdat' -> true, 'mdat' first -> false,
// anything unparseable -> null (unknown: no remux is decided on a guess).
function isFaststart(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    let offset = 0;
    for (let box = 0; box < 12; box++) {
      if (fs.readSync(fd, head, 0, 16, offset) < 8) return null;
      let size = head.readUInt32BE(0);
      const type = head.toString('ascii', 4, 8);
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      if (size === 1) size = Number(head.readBigUInt64BE(8)); // 64-bit largesize
      else if (size === 0) return null; // box runs to end of file: nothing more to learn
      if (!Number.isFinite(size) || size < 8) return null;
      offset += size;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

// The remux decision, from probe() facts (container = ffprobe format_name) and
// the faststart check for the MP4 family. Only container-level defects are
// listed: a remux cannot add keyframes or retime frames (that is what the
// preview transcodes are for) — it fixes exactly the things a stream copy
// fixes: container, index placement, and timestamp sanity.
function remuxDecision(info, faststart) {
  const reasons = [];
  if (!info || info.type !== 'video') return { needed: false, reasons };
  const tokens = String(info.container || '').split(',').map((s) => s.trim());
  const ext = path.extname(info.path || '').slice(1).toLowerCase();
  if (tokens.includes('mpegts')) reasons.push('MPEG-TS container');
  if (tokens.includes('flv')) reasons.push('FLV container');
  if (tokens.includes('avi') || ext === 'avi') reasons.push('AVI container');
  if ((tokens.includes('mp4') || tokens.includes('mov')) && faststart === false) {
    reasons.push('MP4 index (moov) at the end of the file');
  }
  return { needed: reasons.length > 0, reasons };
}

// The stream-copied fast-seek twin, cached per file like the preview copies
// ("-remux.mp4"). Verified the same way they are: the result must probe as
// video and cover the source's duration — a copy that lost streams or time is
// deleted and the generation counts as failed, so the caller falls back to
// the original instead of pointing the pipeline at a broken file.
async function makeRemux(item, cacheDir) {
  const st = fs.statSync(item.path);
  const key = require('crypto').createHash('sha1').update(`${item.path}|${st.size}|${st.mtimeMs}|remux1`).digest('hex').slice(0, 16);
  fs.mkdirSync(cacheDir, { recursive: true });
  const out = path.join(cacheDir, `${key}-remux.mp4`);
  if (usableCopyFile(out)) return out;
  if (fs.existsSync(out)) { try { fs.rmSync(out, { force: true }); } catch { /* the regeneration surfaces the failure */ } }
  const part = path.join(cacheDir, `${key}-remux.part.mp4`);
  const args = ['-i', item.path, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy',
    ...(item.vcodec === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', part];
  // Binary ladder, not just the bundled ffmpeg: the bundled ffmpeg-static
  // build SEGFAULTS on MPEG-TS input in this environment (verified — even a
  // re-encode from TS crashes it, while AVI/FLV/MKV copies work), so a TS
  // remux can only succeed on a system ffmpeg where one exists. First binary
  // that completes the copy wins; if none does, the caller falls back to the
  // original file (which is exactly what happened before auto-remux existed).
  let made = false;
  let lastErr = null;
  for (const bin of encoderBinaries()) {
    try {
      await runFfmpegOn(bin, args);
      fs.renameSync(part, out);
      made = true;
      break;
    } catch (e) {
      lastErr = e;
      try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
    }
  }
  if (!made) throw lastErr || new Error('The remux failed.');
  const info = await probe(out).catch(() => null);
  if (!info || info.type !== 'video' || !(info.duration > 0) || (item.duration > 0 && info.duration < item.duration * 0.9)) {
    try { fs.rmSync(out, { force: true }); } catch { /* ignore */ }
    throw new Error('The remuxed copy came out incomplete.');
  }
  return out;
}

module.exports = { isFaststart, remuxDecision, makeRemux };
