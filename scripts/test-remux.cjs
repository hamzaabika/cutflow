// Auto-remux (10/10 perf program): container-level seek defects are decided
// from probe facts (MPEG-TS / FLV / AVI, or an MP4 whose moov index sits at
// the end of the file), the fix is a verified stream copy — same streams, no
// re-encode — and the export graph reads the copy transparently while the
// original file is never touched.
// Usage: node scripts/test-remux.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

(async () => {
  const ff = require('../electron/ffmpeg.cjs');
  const { remuxDecision, isFaststart, makeRemux } = require('../electron/remux.cjs');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-remux-'));
  const cache = path.join(tmp, 'cache');
  const gen = (name, extra) => {
    const out = path.join(tmp, name);
    const r = spawnSync(ff.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', ...extra, out], { encoding: 'utf8' });
    assert.equal(r.status, 0, `generate ${name}: ${r.stderr}`);
    return out;
  };
  const slowMp4 = gen('slow.mp4', []); // default MP4 layout: moov at the end
  const fastMp4 = gen('fast.mp4', ['-movflags', '+faststart']);
  const tsFile = gen('clip.ts', ['-f', 'mpegts']);
  const mkvFile = gen('clip.mkv', []);

  const pSlow = await ff.probe(slowMp4);
  const pFast = await ff.probe(fastMp4);
  const pTs = await ff.probe(tsFile);
  const pMkv = await ff.probe(mkvFile);
  console.log(`  containers: mp4=${pSlow.container} ts=${pTs.container} mkv=${pMkv.container}`);

  // 1) The faststart walker reads real box layouts.
  assert.equal(isFaststart(fastMp4), true, 'faststart MP4 detected');
  assert.equal(isFaststart(slowMp4), false, 'moov-at-end MP4 detected');
  assert.notEqual(isFaststart(tsFile), true, 'a TS is never read as faststart');

  // 2) Decisions: only container-level defects trigger a remux.
  const dTs = remuxDecision(pTs, null);
  assert.ok(dTs.needed && dTs.reasons.join(' ').includes('MPEG-TS'), `TS decided: ${dTs.reasons}`);
  const dSlow = remuxDecision(pSlow, isFaststart(slowMp4));
  assert.ok(dSlow.needed && dSlow.reasons.join(' ').includes('moov'), `slow MP4 decided: ${dSlow.reasons}`);
  assert.equal(remuxDecision(pFast, isFaststart(fastMp4)).needed, false, 'faststart MP4 needs no remux');
  assert.equal(remuxDecision(pMkv, null).needed, false, 'MKV seeks fine — no remux');
  assert.equal(remuxDecision({ ...pTs, type: 'audio' }, null).needed, false, 'audio is never remuxed');
  assert.equal(remuxDecision({ ...pSlow, container: '' }, null).needed, false, 'unknown container — no guess, no remux');

  // 3) The remux itself: a stream copy into a faststart MP4 that probes as
  // the same content, cached on the second call; the original is untouched.
  const before = fs.statSync(tsFile);
  const tsItem = { path: tsFile, type: 'video', duration: pTs.duration, vcodec: pTs.vcodec, hasAudio: true };
  const copy = await makeRemux(tsItem, cache);
  assert.ok(fs.existsSync(copy) && copy.endsWith('-remux.mp4'), `remux copy exists: ${copy}`);
  assert.equal(isFaststart(copy), true, 'the copy itself is faststart');
  const pCopy = await ff.probe(copy);
  assert.equal(pCopy.type, 'video');
  assert.ok(Math.abs(pCopy.duration - pTs.duration) < Math.max(0.35, pTs.duration * 0.1), `duration preserved (${pCopy.duration} vs ${pTs.duration})`);
  assert.equal(pCopy.vcodec, pTs.vcodec, 'same video codec — a copy, not a re-encode');
  assert.equal(await makeRemux(tsItem, cache), copy, 'second call is the cache hit');
  const after = fs.statSync(tsFile);
  assert.equal(after.size, before.size, 'original untouched (size)');
  assert.equal(after.mtimeMs, before.mtimeMs, 'original untouched (mtime)');

  // 4) Export reads the copy transparently when the pointer is set, and the
  // original when it is not.
  const project = (media) => ({
    name: 'remux', width: 320, height: 180, fps: 30, background: '#000000',
    media: [media],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 2, speed: 1 }],
    overlayClips: [], textClips: [], audioClips: [],
  });
  const mediaBase = { id: 'm1', path: tsFile, type: 'video', duration: pTs.duration, hasAudio: true, width: 320, height: 180 };
  const withCopy = ff.buildExportArgs(project({ ...mediaBase, remux: copy }), path.join(tmp, 'o1.mp4'), {}).args;
  assert.ok(withCopy.includes(copy), 'export inputs include the remux copy');
  assert.ok(!withCopy.includes(tsFile), 'export inputs exclude the TS original');
  const without = ff.buildExportArgs(project(mediaBase), path.join(tmp, 'o2.mp4'), {}).args;
  assert.ok(without.includes(tsFile), 'without the pointer the export reads the original');

  console.log('REMUX OK');
})().catch((e) => { console.error(e); process.exit(1); });
