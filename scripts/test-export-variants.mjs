// P2-26 unit test: batch export variants (pure renderer math — no app needed).
//   1. buildVariantProject: 16:9 -> 9:16 and 1:1 get cover scale (frame filled, no
//      pillarbox); 16:9 -> 16:9 is a plain geometry copy; the original is untouched.
//   2. checkSafeArea: a caption at y=0.92 is flagged in vertical (bottom margin
//      20%) but fine in horizontal; a centred caption passes everywhere.
//   3. variantFileName: distinct stems per variant.
// Usage: node scripts/test-export-variants.mjs
import assert from 'node:assert';
import { EXPORT_VARIANTS, buildVariantProject, checkSafeArea, variantFileName, variantForProject } from '../src/exportVariants.js';

const project = {
  id: 'p1', name: 'demo', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30,
  media: [{ id: 'm0', path: '/x/clip.mp4', name: 'clip.mp4', width: 1280, height: 720, duration: 10 }],
  videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 10, speed: 1, transform: { scale: 1, x: 0, y: 0 } }],
  textClips: [
    { id: 't-low', text: 'Bottom caption', start: 0, duration: 3, x: 0.5, y: 0.88 },
    { id: 't-mid', text: 'Middle title', start: 0, duration: 3, x: 0.5, y: 0.5 },
  ],
  stickerClips: [{ id: 's1', sticker: 'star', start: 0, duration: 3, transform: { scale: 0.3, x: 0, y: 0 } }],
  overlayClips: [], audioClips: [], effectClips: [],
};

const [h, v, s] = EXPORT_VARIANTS;
assert.equal(variantForProject(project).id, 'horizontal');

// 1a. Vertical: 720x1280, video clip cover-scaled so the 16:9 picture fills 9:16.
const vp = buildVariantProject(project, v);
assert.equal(vp.width, 720, 'vertical width');
assert.equal(vp.height, 1280, 'vertical height');
assert.equal(vp.ratio, '9:16');
const vc = vp.videoClips[0];
assert.ok(vc.transform.scale > 1.5, `cover scale fills the frame (got ${vc.transform.scale})`);
assert.equal(project.videoClips[0].transform.scale, 1, 'original untouched');
assert.equal(project.width, 1280, 'original geometry untouched');

// 1b. Square: 720x720, also cover-scaled.
const sp = buildVariantProject(project, s);
assert.deepEqual([sp.width, sp.height], [720, 720]);
assert.ok(sp.videoClips[0].transform.scale > 1, `square cover scale (got ${sp.videoClips[0].transform.scale})`);

// 1c. Horizontal at the same geometry: plain copy, no reframe applied.
const hp = buildVariantProject(project, h);
assert.deepEqual([hp.width, hp.height], [1280, 720]);
assert.equal(hp.videoClips[0].transform.scale, 1, 'no cover scale on same-aspect variant');

// 2. Safe area: the low caption breaches the vertical bottom margin only.
const vWarn = checkSafeArea(project, v);
assert.ok(vWarn.some((w) => w.clipId === 't-low' && w.edge === 'bottom'), `vertical flags low caption: ${JSON.stringify(vWarn)}`);
assert.ok(!vWarn.some((w) => w.clipId === 't-mid'), 'centred caption passes vertical');
const hWarn = checkSafeArea(project, h);
assert.ok(!hWarn.some((w) => w.clipId === 't-low'), 'low caption is inside the horizontal safe area');
const sWarn = checkSafeArea(project, s);
assert.ok(!sWarn.some((w) => w.clipId === 't-low'), 'low caption is inside the square safe area (bottom margin 8%)');
// A centred sticker passes everywhere.
for (const variant of EXPORT_VARIANTS) {
  assert.ok(!checkSafeArea(project, variant).some((w) => w.clipId === 's1'), `sticker passes ${variant.id}`);
}

// 3. File names are distinct per variant.
assert.equal(variantFileName('demo', h, 'mp4'), 'demo_16x9.mp4');
assert.equal(variantFileName('demo', v, 'mp4'), 'demo_9x16.mp4');
assert.equal(variantFileName('demo', s, 'mp4'), 'demo_1x1.mp4');

console.log('EXPORT VARIANTS OK');
