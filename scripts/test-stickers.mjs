// Bundled stickers (10/10 step 3): the restored sticker machinery end to end —
// registry ↔ files agree, the project model round-trips sticker clips through
// normalize + the reducer, and a real export composites the sticker in place.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { STICKER_CATS, STICKERS, stickerById } from '../src/stickers.js';
import { historyReducer, normalizeProject } from '../src/store.js';

const require = createRequire(import.meta.url);
const ff = require('../electron/ffmpeg.cjs');
const root = path.join(import.meta.dirname, '..');
const dir = path.join(root, 'shared', 'stickers');

// ---- Registry ↔ files -------------------------------------------------------
assert.ok(STICKERS.length >= 80, `sticker set carries 80+ stickers (got ${STICKERS.length})`);
// Step 5 growth: the two new shelves land with real depth, and every shelf
// keeps at least the step-3 floor.
for (const [cat, min] of [['Faces', 8], ['Celebration', 8], ['Badges', 10], ['Arrows', 10], ['Social', 10]]) {
  const n = STICKERS.filter((s) => s.cat === cat).length;
  assert.ok(n >= min, `${cat} shelf carries ${min}+ stickers (got ${n})`);
}
const ids = new Set(); const names = new Set();
for (const st of STICKERS) {
  assert.ok(!ids.has(st.id), `duplicate sticker id ${st.id}`); ids.add(st.id);
  assert.ok(!names.has(st.name), `duplicate sticker name ${st.name}`); names.add(st.name);
  assert.ok(STICKER_CATS.includes(st.cat), `${st.id} sits in a real shelf (${st.cat})`);
  assert.equal(stickerById(st.id)?.file, st.file, `${st.id} resolves through stickerById`);
  const file = path.join(dir, st.file);
  assert.ok(fs.existsSync(file), `${st.file} exists in shared/stickers`);
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString('latin1'), 'PNG', `${st.file} is a PNG`);
  assert.equal(buf.readUInt32BE(16), st.w, `${st.id} PNG width matches the registry`);
  assert.equal(buf.readUInt32BE(20), st.h, `${st.id} PNG height matches the registry`);
  assert.equal(buf[25], 6, `${st.id} PNG carries an alpha channel (RGBA)`);
}
for (const cat of STICKER_CATS) {
  assert.ok(STICKERS.filter((s) => s.cat === cat).length >= 4, `${cat} shelf carries at least 4 stickers`);
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.deepEqual(manifest.items.map((i) => i.id), STICKERS.map((s) => s.id), 'manifest and registry list the same stickers');

// ---- Model round-trip -------------------------------------------------------
const fresh = () => ({ past: [], present: normalizeProject({}), future: [] });
const run = (st, ...actions) => actions.reduce(historyReducer, st);
let st = run(fresh(), { type: 'addSticker', clipId: 'stk1', sticker: 'badge-star.png', name: 'Starburst Badge', w: 480, h: 480, at: 1.5 });
assert.equal(st.present.stickerClips.length, 1, 'addSticker lands a clip');
const clip = st.present.stickerClips[0];
assert.equal(clip.start, 1.5); assert.equal(clip.duration, 3);
assert.equal(clip.transform.scale, 0.3); assert.equal(clip.opacity, 1);
st = run(st, { type: 'update', track: 'sticker', id: 'stk1', patch: { start: 2.5, transform: { scale: 0.8, x: 0.1, y: 0, rot: 15 } } });
assert.equal(st.present.stickerClips[0].start, 2.5, 'generic update moves a sticker clip');
assert.equal(st.present.stickerClips[0].transform.rot, 15, 'generic update patches its transform');
st = run(st, { type: 'duplicate', track: 'sticker', id: 'stk1', newId: 'stk2' });
assert.equal(st.present.stickerClips.length, 2, 'generic duplicate copies a sticker clip');
assert.equal(st.present.stickerClips[1].start, 5.5, 'the copy lands after the original');
st = run(st, { type: 'delete', track: 'sticker', id: 'stk1' }, { type: 'delete', track: 'sticker', id: 'stk2' });
assert.equal(st.present.stickerClips.length, 0, 'generic delete removes sticker clips');

// normalizeProject keeps good sticker clips (old files load whole again) and
// sanitizes the rest instead of dropping the lane.
const loaded = normalizeProject({
  stickerClips: [
    { id: 'ok', sticker: 'badge-star.png', name: 'Starburst', start: -3, duration: 999, opacity: 2, w: 480, h: 480 },
    { id: 'no-file' },
    { sticker: 'badge-star.png' },
    null, 'junk',
  ],
});
assert.equal(loaded.stickerClips.length, 1, 'only the well-formed sticker clip survives loading');
assert.equal(loaded.stickerClips[0].start, 0, 'negative start clamps to 0');
assert.equal(loaded.stickerClips[0].duration, 120, 'duration clamps to the 120 s ceiling');
assert.equal(loaded.stickerClips[0].opacity, 1, 'opacity clamps to 1');

// ---- Export round-trip --------------------------------------------------------
// A dark 2 s clip, exported twice: bare, and with the amber starburst sticker
// centred at full frame height. The centre pixel must carry the sticker's amber
// in the second export and the bare background in the first.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-stickers-'));
const srcFile = path.join(tmp, 'base.mp4');
execFileSync(ff.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x101418:size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', srcFile]);
const info = await ff.probe(srcFile);
const media = [{ id: 'm1', path: srcFile, name: 'base.mp4', ...info }];
const baseProject = {
  name: 'stickers', ratio: '16:9', resolution: 720, width: 320, height: 180, fps: 30, background: '#101418', media,
  videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  overlayClips: [], textClips: [], audioClips: [], stickerClips: [],
};
const centrePixel = async (project, out) => {
  await ff.runExport(project, out, () => {}).promise;
  const raw = execFileSync(ff.ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const at = (90 * 320 + 160) * 3;
  return [raw[at], raw[at + 1], raw[at + 2]];
};
const bare = await centrePixel(baseProject, path.join(tmp, 'bare.mp4'));
const stickerFile = path.join(dir, 'badge-star.png');
const withSticker = {
  ...baseProject,
  stickerClips: [{ id: 'stk1', sticker: 'badge-star.png', name: 'Starburst Badge', start: 0, duration: 2, transform: { scale: 1, x: 0, y: 0 }, opacity: 1, w: 480, h: 480 }],
  stickerFiles: { stk1: stickerFile },
};
const stuck = await centrePixel(withSticker, path.join(tmp, 'stuck.mp4'));
assert.ok(bare[0] < 60 && bare[1] < 60 && bare[2] < 60, `bare export centre is the dark background (${bare})`);
assert.ok(stuck[0] > 170 && stuck[1] > 90 && stuck[1] < 215 && stuck[2] < 100, `sticker export centre is the starburst amber (${stuck})`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`stickers ok: ${STICKERS.length} stickers across ${STICKER_CATS.length} shelves — registry, model and export round-trips pass`);
