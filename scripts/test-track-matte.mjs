// True Track Matte System (P2-12): the resolver's rules + the export graph
// (buildExportArgs) carrying the matte through alphamerge in both modes,
// and refusing mattes that cannot work.
// Usage: node scripts/test-track-matte.mjs
process.env.FVE_ENCODER = 'libx264';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildExportArgs, ffmpegPath } = require('../electron/ffmpeg.cjs');
const { matteCandidates, resolveTrackMatte } = await import('../src/trackMatte.js');

const dir = path.join(process.cwd(), 'tmp', 'test-track-matte');
fs.mkdirSync(dir, { recursive: true });
const mkVid = (name, color) => {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    execFileSync(ffmpegPath, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:size=320x180:rate=30:duration=2`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', p]);
  }
  return p;
};
const redVid = mkVid('red.mp4', 'red');
const whiteVid = mkVid('white.mp4', 'white');

const media = [
  { id: 'mRed', path: redVid, type: 'video', duration: 2, hasAudio: false, width: 320, height: 180 },
  { id: 'mWhite', path: whiteVid, type: 'video', duration: 2, hasAudio: false, width: 320, height: 180 },
];
const clip = (id, mediaId, extra = {}) => ({ id, mediaId, in: 0, out: 2, speed: 1, volume: 1, muted: false, ...extra });
function proj(over = {}) {
  return {
    name: 'track-matte', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30,
    background: '#000000', media,
    videoClips: [clip('v1', 'mRed'), clip('v2', 'mWhite')],
    audioClips: [], overlayClips: [], textClips: [], effectClips: [], stickerClips: [],
    ...over,
  };
}

// --- Resolver ---------------------------------------------------------------
{
  const p = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v1', mode: 'luma' } }] });
  const r = resolveTrackMatte(p, p.overlayClips[0], 'overlay');
  assert.ok(r.ok, `overlay matte from main clip resolves: ${JSON.stringify(r)}`);
  assert.strictEqual(r.mode, 'luma', 'mode travels');
  assert.strictEqual(r.fromLocal, 0, 'aligned tracks: offset 0');
  const cands = matteCandidates(p, p.overlayClips[0]).map((c) => c.clip.id);
  assert.ok(cands.includes('v1') && cands.includes('v2') && !cands.includes('o1'), `candidates are the other picture clips: ${cands}`);
  // Source starting later is refused.
  const late = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v2', mode: 'alpha' } }] });
  const rLate = resolveTrackMatte(late, late.overlayClips[0], 'overlay');
  assert.ok(!rLate.ok && rLate.reason === 'starts-after', `late source refused: ${rLate.reason}`);
  // Nested matte refused; self refused; gone source refused.
  const nested = proj({ overlayClips: [
    { ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v1', mode: 'luma' } },
    { ...clip('o2', 'mWhite'), start: 0, matte: { sourceId: 'o1', mode: 'luma' } },
  ] });
  assert.ok(!resolveTrackMatte(nested, nested.overlayClips[1], 'overlay').ok, 'nested matte refused');
  assert.ok(!resolveTrackMatte(proj(), { ...clip('v1', 'mRed'), matte: { sourceId: 'v1', mode: 'luma' } }, 'video').ok, 'self matte refused');
  assert.ok(!resolveTrackMatte(proj(), { ...clip('v1', 'mRed'), matte: { sourceId: 'nope', mode: 'luma' } }, 'video').ok, 'gone source refused');
  // Offset: a main clip starting at 2s matting from the first clip samples 2s in.
  const off = proj({ videoClips: [clip('v1', 'mRed'), { ...clip('v2', 'mWhite'), matte: { sourceId: 'v1', mode: 'alpha' } }] });
  const rOff = resolveTrackMatte(off, off.videoClips[1], 'video');
  assert.ok(rOff.ok && Math.abs(rOff.fromLocal - 2) < 1e-9, `offset is the start gap (got ${rOff.fromLocal})`);
  console.log('  resolver rules hold');
}

// --- Export graph -----------------------------------------------------------
{
  // Luma matte on an overlay: the graph alphamerges the target with a
  // grayscale render of the source track.
  const p = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v1', mode: 'luma' } }] });
  const { args } = buildExportArgs(p, path.join(dir, 'out-luma.mp4'));
  const graph = args.join(' ');
  assert.ok(graph.includes('alphamerge'), 'luma graph has alphamerge');
  assert.ok(graph.includes('format=gray'), 'luma graph converts the source to gray');
  assert.ok(graph.includes('white.mp4') && graph.includes('red.mp4'), 'graph references both tracks');
  // alphamerge REPLACES alpha (live catch 2026-11-15: the transparent
  // surround became semi-opaque black and darkened the whole frame), so the
  // matte must be multiplied by the layer's own alpha first.
  assert.ok(graph.includes('blend=all_mode=multiply'), 'matte is multiplied by the layer alpha before alphamerge');
  console.log('  luma export graph carries alphamerge + gray source');
}
{
  // Pixel proof: render the luma-matted export and read real frames. The
  // overlay is white at half size, centred, matted by red (luma 0.30), so
  // the centre is a red/white blend while the corner stays full red — the
  // matte must not darken anything outside the overlay picture.
  const p = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, transform: { scale: 0.5, x: 0, y: 0 }, matte: { sourceId: 'v1', mode: 'luma' } }] });
  const out = path.join(dir, 'out-luma.mp4');
  const { args } = buildExportArgs(p, out);
  execFileSync(ffmpegPath, args, { stdio: 'pipe' });
  const frame = path.join(dir, 'frame-luma.png');
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', frame]);
  // Read the PNG without a canvas dependency: decode via ffmpeg to raw RGB.
  const raw = path.join(dir, 'frame-luma.raw');
  execFileSync(ffmpegPath, ['-y', '-v', 'error', '-i', frame, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  const buf = fs.readFileSync(raw);
  const at = (x, y) => [buf[(y * 320 + x) * 3], buf[(y * 320 + x) * 3 + 1], buf[(y * 320 + x) * 3 + 2]];
  const corner = at(10, 10);
  const centre = at(160, 90);
  assert.ok(corner[0] > 200 && corner[1] < 40, `corner stays red (got ${corner})`);
  // Red main (253,0,0) under a white overlay at red-luma alpha 0.30: R stays
  // ~253 (both layers are full red there) while G/B rise to ~76.
  assert.ok(centre[1] > 40 && centre[1] < 120 && centre[2] > 40 && centre[2] < 120, `centre is a red/white blend (got ${centre})`);
  assert.ok(centre[1] - corner[1] > 20, `centre differs from corner (matte applied: ${centre} vs ${corner})`);
  console.log(`  luma matte renders: corner ${corner}, centre ${centre}`);
}
{
  // Alpha mode: the source's own alpha drives the target.
  const p = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v1', mode: 'alpha' } }] });
  const { args } = buildExportArgs(p, path.join(dir, 'out-alpha.mp4'));
  assert.ok(args.join(' ').includes('alphaextract'), 'alpha graph has alphaextract');
  assert.ok(args.join(' ').includes('alphamerge'), 'alpha graph has alphamerge');
  console.log('  alpha export graph carries alphamerge + alphaextract');
}
{
  // A matte that cannot work (source starts later) builds no alphamerge —
  // the clip exports unmatted instead of failing.
  const p = proj({ overlayClips: [{ ...clip('o1', 'mWhite'), start: 0, matte: { sourceId: 'v2', mode: 'luma' } }] });
  const { args } = buildExportArgs(p, path.join(dir, 'out-bad.mp4'));
  assert.ok(!args.join(' ').includes('alphamerge'), 'unworkable matte adds no alphamerge');
  console.log('  unworkable matte is skipped in the graph');
}
{
  // Main-track target matting from the first clip.
  const p = proj({ videoClips: [clip('v1', 'mRed'), { ...clip('v2', 'mWhite'), matte: { sourceId: 'v1', mode: 'luma' } }] });
  const { args } = buildExportArgs(p, path.join(dir, 'out-main.mp4'));
  assert.ok(args.join(' ').includes('alphamerge'), 'main-track target gets alphamerge');
  console.log('  main-track matte target works');
}

console.log('test-track-matte: PASS');
