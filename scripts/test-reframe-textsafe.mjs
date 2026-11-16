// Auto-reframe P2-42 additions: centre mode, text-safe fit fallback, and
// the reframeMeta record. The face-tracking core + export pixel check live
// in scripts/test-reframe.mjs; this suite pins only the new behaviour.
// Usage: node scripts/test-reframe.mjs scripts/test-reframe-textsafe.mjs
// (or: node scripts/test-reframe-textsafe.mjs)
import { buildVerticalCopy, coverFor, fitFor, reframeClip } from '../src/reframe.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ±${tol}`);

const SHAPE = { width: 720, height: 1280 };
const MEDIA = { width: 1280, height: 720 };
const CLIP = { id: 'c1', mediaId: 'm0', in: 0, out: 6, speed: 1 };
const proj = (textClips = []) => ({
  id: 'p0', name: 'Talk', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000',
  media: [{ id: 'm0', type: 'video', width: 1280, height: 720, duration: 6 }],
  videoClips: [CLIP], overlayClips: [], textClips, audioClips: [], stickerClips: [], effectClips: [], markers: [],
});

// --- fit geometry: 16:9 into 9:16 fits by height, so the fit scale is set by width.
{
  const f = fitFor(SHAPE, MEDIA, CLIP);
  near(f.fx, 1, 1e-9, 'fit fx');
  near(f.fy, 0.31640625, 1e-9, 'fit fy');
  near(f.s, 1, 1e-9, 'fit scale is 1 (width already fits)');
  const c = coverFor(SHAPE, MEDIA, CLIP);
  ok(f.s < c.s, 'fit scale is smaller than cover scale (bars, no crop)');
  const p = fitFor(SHAPE, { width: 720, height: 1280 }, CLIP);
  near(p.s, 1, 1e-9, 'portrait fit scale');
}

// --- text-safe fit: a faceless clip overlapping timeline text is fitted, not cropped.
{
  const out = reframeClip(CLIP, MEDIA, SHAPE, [], { textSafe: true, hasText: true });
  ok(out.reframeFit === true, 'faceless text-carrying clip is marked fitted');
  near(out.transform.scale, 1, 1e-9, 'fitted clip keeps scale 1 (whole picture visible)');
  near(out.transform.x, 0, 1e-9, 'fitted clip is centred');
  const out2 = reframeClip(CLIP, MEDIA, SHAPE, [], { textSafe: true, hasText: false });
  ok(!out2.reframeFit, 'faceless clip WITHOUT text is still cropped (cover)');
  near(out2.transform.scale, coverFor(SHAPE, MEDIA, CLIP).s, 1e-4, 'cropped clip uses the cover scale (rounded to 4dp)');
  const out3 = reframeClip(CLIP, MEDIA, SHAPE, [], { textSafe: false, hasText: true });
  ok(!out3.reframeFit, 'textSafe off: text-carrying clip is cropped as before');
}

// --- centre mode ignores the face path entirely.
{
  const pts = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.6, x: 0.2, y: 0.5 }));
  const out = reframeClip(CLIP, MEDIA, SHAPE, pts, { mode: 'center' });
  ok(!out.keyframes || !out.keyframes.x, 'centre mode writes no tracking keyframes');
  near(out.transform.x, 0, 1e-9, 'centre mode stays centred');
  const out2 = reframeClip(CLIP, MEDIA, SHAPE, pts, { mode: 'face' });
  ok(out2.transform.x !== 0, 'face mode offsets toward the face');
}

// --- buildVerticalCopy: meta record + per-clip decisions.
{
  const pts = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.6, x: 0.25, y: 0.5 }));
  const p = proj([{ id: 't1', start: 0, duration: 6, text: 'hello' }]);
  const copy = buildVerticalCopy(p, { c1: pts }, () => 'copyid', { mode: 'face', textSafe: true });
  ok(copy.reframeMeta.mode === 'face' && copy.reframeMeta.textSafe === true, 'meta records mode + textSafe');
  ok(copy.reframeMeta.tracked.includes('c1'), 'faced clip recorded as tracked');
  ok(!copy.videoClips[0].reframeFit, 'fitted marker is stripped from the shipped clip');
  // Same project, no face at all, text overlapping: the clip is fitted.
  const copy2 = buildVerticalCopy(p, {}, () => 'copy2', { mode: 'face', textSafe: true });
  ok(copy2.reframeMeta.fitted.includes('c1'), 'faceless text-carrying clip recorded as fitted');
  ok(copy2.videoClips[0].transform.scale === 1, 'fitted clip scale is 1 in the copy');
  // No text at all: faceless clip is centred (cover), not fitted.
  const copy3 = buildVerticalCopy(proj(), {}, () => 'copy3', { mode: 'face', textSafe: true });
  ok(copy3.reframeMeta.centred.includes('c1') && !copy3.reframeMeta.fitted.length, 'faceless text-free clip is centred, not fitted');
  // Centre mode records the mode and tracks nothing.
  const copy4 = buildVerticalCopy(p, { c1: pts }, () => 'copy4', { mode: 'center', textSafe: true });
  ok(copy4.reframeMeta.mode === 'center' && copy4.reframeMeta.tracked.length === 0, 'centre mode tracks nothing');
  // Defaults (no opts): face mode, textSafe off — the old behaviour.
  const copy5 = buildVerticalCopy(p, { c1: pts }, () => 'copy5');
  ok(copy5.reframeMeta.mode === 'face' && copy5.reframeMeta.textSafe === false, 'defaults preserve the old behaviour');
  ok(p.ratio === '16:9', 'original untouched');
}

if (failures) { console.log(`test-reframe-textsafe: FAIL (${failures} failures)`); process.exit(1); }
console.log('test-reframe-textsafe: PASS');
