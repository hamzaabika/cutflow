// P0-01 (#16): a missing media file must not hard-fail the whole export.
//   - buildExportArgs drops clips whose file is gone from disk and reports
//     them in `skipped` (same shape as the ZIP export's `missing`: { track, name });
//   - a clip whose media entry is absent entirely is skipped the same way;
//   - when EVERY main-track clip is missing, the export still refuses — but
//     with a plain-language message, not a raw ffmpeg error;
//   - runExport completes with the good clips and exposes the skipped list
//     on the job, so the done card can list them like the ZIP card does.
// Usage: node scripts/test-missing-media.mjs
process.env.FVE_ENCODER = 'libx264'; // deterministic software encoding
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, buildAudioExportArgs, runExport, ffmpegPath } = require('../electron/ffmpeg.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-missing-media-'));
const goodVid = path.join(tmp, 'good.mp4');
const goodAud = path.join(tmp, 'good.wav');
const missingVid = path.join(tmp, 'gone.mp4'); // never created
const missingAud = path.join(tmp, 'gone.wav'); // never created
execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-ar', '44100', '-ac', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', goodVid]);
execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-ar', '44100', '-ac', '2', goodAud]);

const media = [
  { id: 'v1', path: goodVid, type: 'video', duration: 2, hasAudio: true },
  { id: 'v2', path: missingVid, type: 'video', duration: 2, hasAudio: true },
  { id: 'a1', path: goodAud, type: 'audio', duration: 3 },
  { id: 'a2', path: missingAud, type: 'audio', duration: 3 },
];
const clip = (id, mediaId, extra = {}) => ({ id, mediaId, in: 0, out: 2, speed: 1, volume: 1, muted: false, ...extra });
function proj(over = {}) {
  return {
    name: 'missing-media', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30,
    background: '#000000', media,
    videoClips: [clip('v1', 'v1'), clip('v2', 'v2')],
    audioClips: [{ id: 'au1', mediaId: 'a1', start: 0, in: 0, out: 3 }, { id: 'au2', mediaId: 'a2', start: 0, in: 0, out: 3 }],
    overlayClips: [], textClips: [], effectClips: [], stickerClips: [],
    ...over,
  };
}

// 1. buildExportArgs: missing clips are skipped AND reported; good clips stay.
{
  const { args, total, skipped } = buildExportArgs(proj(), path.join(tmp, 'out1.mp4'));
  const names = (skipped || []).map((s) => s.name);
  assert.equal((skipped || []).length, 2, `skipped should list 2 clips, got ${JSON.stringify(skipped)}`);
  assert.ok(names.some((n) => n.includes('gone.mp4')), `skipped names include the missing video: ${names}`);
  assert.ok(names.some((n) => n.includes('gone.wav')), `skipped names include the missing audio: ${names}`);
  assert.ok(!args.join(' ').includes('gone'), 'ffmpeg args must not reference any missing file');
  assert.ok(args.join(' ').includes('good.mp4'), 'ffmpeg args keep the good clip');
  assert.ok(Math.abs(total - 2) < 1e-9, `total is the good clip only (2s), got ${total}`);
  console.log('  missing clips skipped + reported, good clip kept, total 2s');
}

// 2. A clip whose media entry is absent entirely is skipped the same way.
{
  const p = proj({ videoClips: [clip('v1', 'v1'), clip('vx', 'no-such-id')] });
  const { skipped } = buildExportArgs(p, path.join(tmp, 'out2.mp4'));
  assert.ok((skipped || []).some((s) => s.track === 'video' && s.name.includes('vx')), `absent-entry clip listed in skipped: ${JSON.stringify(skipped)}`);
  console.log('  absent media entry skipped + reported');
}

// 3. Every main-track clip missing: plain-language refusal, not a raw ffmpeg error.
{
  const p = proj({ videoClips: [clip('v2', 'v2')], audioClips: [] });
  assert.throws(() => buildExportArgs(p, path.join(tmp, 'out3.mp4')), /missing their files/i, 'all-missing main track throws the plain message');
  console.log('  all-missing main track refuses with a plain message');
}

// 4. Audio export: a missing audio clip is skipped, the good one still mixes.
{
  const args = buildAudioExportArgs(proj(), path.join(tmp, 'out4.mp3'), 'mp3');
  assert.ok(!args.join(' ').includes('gone'), 'audio args must not reference any missing file');
  console.log('  audio export skips the missing clip');
}

// 5. runExport live: the job completes on the good clips and exposes skipped.
{
  const outFile = path.join(tmp, 'live.mp4');
  const job = runExport(proj(), outFile, () => {});
  await job.promise;
  assert.ok(fs.existsSync(outFile) && fs.statSync(outFile).size > 0, 'live export file exists');
  assert.equal((job.skipped || []).length, 2, `live job.skipped lists 2 clips, got ${JSON.stringify(job.skipped)}`);
  console.log('  live export completes; job.skipped lists the 2 missing clips');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('missing-media OK — missing files are skipped and reported, never a hard fail');
