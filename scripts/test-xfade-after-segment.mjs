// Regression test: an FX transition (segment path) followed by a native
// xfade transition in one export used to fail the whole export with
// ffmpeg code 234 ("[Parsed_xfade] The inputs needs to be a constant
// frame rate; current rate of 1/0 is invalid") — the segment-concat
// output carries no frame rate, and the xfade branch only set the time
// base (settb). The fix stamps fps=${fps} onto both xfade inputs.
// Usage: node scripts/test-xfade-after-segment.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const ff = (await import('../electron/ffmpeg.cjs')).default;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-xfade-seg-'));
const mk = (name, args) => { const p = path.join(dir, name); const r = spawnSync(ff.ffmpegPath, ['-y', '-v', 'error', ...args, p]); assert.equal(r.status, 0, `fixture ${name} failed`); return p; };
const a = mk('a.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
const b = mk('b.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
const seg = mk('seg.mp4', ['-f', 'lavfi', '-i', 'color=c=white:size=640x360:rate=30:duration=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
const mA = await ff.probe(a); const mB = await ff.probe(b);
const clip = (id, mediaId, tr) => ({ id, mediaId, in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: tr || null });
const project = {
  name: 'xfade-after-segment', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
  media: [{ id: 'mA', path: a, name: 'a.mp4', ...mA }, { id: 'mB', path: b, name: 'b.mp4', ...mB }],
  videoClips: [
    clip('v1', 'mA'),
    clip('v2', 'mB', { type: 'fadewhite', duration: 0.5 }),
    clip('v3', 'mA', { type: 'fade', duration: 0.5 }),
  ],
  overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [],
  fxSegments: { v2: seg },
};
const out = path.join(dir, 'out.mp4');
const { args, total } = ff.buildExportArgs(project, out, {});
assert.equal(total, 11, `total duration is 11 s (got ${total})`);
const r = spawnSync(ff.ffmpegPath, args, { encoding: 'utf8', timeout: 120000 });
assert.equal(r.status, 0, `export failed (exit ${r.status}): ${(r.stderr || '').split('\n').filter((l) => /error|failed/i.test(l)).join(' | ')}`);
assert.ok(fs.existsSync(out) && fs.statSync(out).size > 100000, 'export file lands with real content');
const probe = await ff.probe(out);
assert.equal(probe.width, 640, 'export is 640 wide');
assert.equal(probe.height, 360, 'export is 360 high');
assert.ok(Math.abs(probe.duration - 11) < 0.2, `export duration is 11 s (got ${probe.duration})`);
console.log('XFADE-AFTER-SEGMENT OK: FX segment -> native xfade exports (exit 0, 640x360, 11 s)');
