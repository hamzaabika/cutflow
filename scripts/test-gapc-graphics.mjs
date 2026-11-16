// Gap-build C — grouped layer templates (CSV rows 178/179/183/184/189/190/
// 191/192/193/197): the grouped layer-template system. Proves, at the real
// renderer (src/text/render.js drawTextClip) with a stub canvas context, that
// every template builds a group of real clips sharing one groupId, every
// graphic kind paints and animates over the clip (ring fills, counter counts,
// countdown counts down, bar fills, stroke draws, credits roll, dots pulse),
// and the store inserts the whole group in one action. Usage:
// node scripts/test-gapc-graphics.mjs
import assert from 'assert/strict';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const { drawTextClip, textBox } = await import('../src/text/render.js');
const { GRAPHIC_TEMPLATES, GRAPHIC_CATEGORIES, graphicTemplateById, graphicTemplateClips } = await import('../src/graphics/catalog.js');
const { groupMates } = await import('../src/groups.js');
const { emptyProject, historyReducer } = await import('../src/store.js');

function fakeCtx() {
  const calls = [];
  const grad = { addColorStop() {} };
  const target = {
    calls,
    measureText(s) { return { width: [...String(s)].length * 12 }; },
    createLinearGradient() { return grad; },
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'string') return (...args) => { calls.push([k, ...args]); };
      return undefined;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
const draw = (clip, lt) => {
  const ctx = fakeCtx();
  drawTextClip(ctx, { ...clip, start: 0 }, lt, 1280, 720);
  return ctx;
};
// textBox measures through a scratch canvas in the browser; in node it gets
// the same stub context.
if (typeof document === 'undefined') {
  globalThis.document = { createElement: () => ({ getContext: () => fakeCtx() }) };
}
const ofKind = (ctx, name) => ctx.calls.filter((c) => c[0] === name);
const fills = (ctx) => ofKind(ctx, 'fillText').map((c) => c[1]);

// ---- Catalogue integrity ----------------------------------------------------
assert.deepEqual(GRAPHIC_CATEGORIES, ['All', 'Titles', 'Motion Elements'], 'graphic categories');
assert.equal(GRAPHIC_TEMPLATES.length, 10, 'ten graphic templates');
const ids = ['split-screen-title', 'cinematic-simple-credits', 'brand-endcard', 'stroke-draw-on',
  'progress-ring', 'number-counter', 'countdown-timer', 'progress-bar', 'pointer-highlight', 'kinetic-dot-grid'];
assert.deepEqual(GRAPHIC_TEMPLATES.map((t) => t.id).sort(), [...ids].sort(), 'all ten CSV rows are templates');
for (const tpl of GRAPHIC_TEMPLATES) {
  assert.ok(tpl.parts.length >= 1, `${tpl.id}: has parts`);
  assert.ok(tpl.duration > 0, `${tpl.id}: has a duration`);
  const clips = graphicTemplateClips(tpl.id, 2);
  assert.equal(clips.length, tpl.parts.length, `${tpl.id}: one clip per part`);
  assert.equal(new Set(clips.map((c) => c.id)).size, clips.length, `${tpl.id}: unique clip ids`);
  assert.equal(new Set(clips.map((c) => c.groupId)).size, 1, `${tpl.id}: one shared groupId`);
  assert.ok(clips.every((c) => c.start === 2 && c.duration === tpl.duration), `${tpl.id}: parts share start/duration`);
  assert.ok(clips.every((c) => c.graphicTemplate === tpl.id), `${tpl.id}: parts are marked with their template`);
}
assert.deepEqual(graphicTemplateClips('nope', 0), [], 'unknown template builds nothing');
assert.equal(graphicTemplateById('progress-ring').name, 'Progress Ring', 'lookup by id');
console.log('graphics catalogue ok (10 templates, grouped)');

// ---- Every kind paints -------------------------------------------------------
for (const tpl of GRAPHIC_TEMPLATES) {
  const clips = graphicTemplateClips(tpl.id, 0);
  for (const clip of clips) {
    const ctx = draw(clip, tpl.duration / 2);
    const painted = ctx.calls.filter((c) => ['fillText', 'fill', 'stroke', 'fillRect'].includes(c[0])).length;
    assert.ok(painted > 0, `${tpl.id}/${clip.graphicPart}: paints (${painted} paint calls)`);
    // The selection box is a real size, not the empty-text fallback.
    const box = textBox(clip, 1280, 720);
    assert.ok(box.w >= 10 && box.h > 20, `${tpl.id}/${clip.graphicPart}: selection box ${box.w.toFixed(0)}x${box.h.toFixed(0)}`);
  }
}
console.log('all graphic kinds paint + have selection boxes');

// ---- Motion over the clip ----------------------------------------------------
const ring = graphicTemplateClips('progress-ring', 0)[0];
{
  const arcEnd = (lt) => {
    const ctx = draw(ring, lt);
    // The fill arc starts at the top (-PI/2); the track is a full circle from 0.
    const arcs = ofKind(ctx, 'arc').filter((a) => Math.abs(a[4] + Math.PI / 2) < 0.01);
    return arcs.length ? arcs[0][5] : null;
  };
  assert.ok(arcEnd(0.05) < arcEnd(1.5), `ring fills over the clip (${arcEnd(0.05)?.toFixed(2)} -> ${arcEnd(1.5)?.toFixed(2)})`);
  assert.ok(Math.abs(arcEnd(2.99) - (-Math.PI / 2 + Math.PI * 2)) < 0.05, 'ring completes at the end');
  assert.ok(fills(draw(ring, 1.5)).some((s) => s === '50%'), 'ring shows a live percentage');
  console.log('progress ring ok');
}
const counter = graphicTemplateClips('number-counter', 0)[0];
{
  assert.ok(fills(draw(counter, 0.01)).some((s) => s === '0'), `counter starts at 0 (${fills(draw(counter, 0.01))})`);
  assert.ok(fills(draw(counter, 2.99)).some((s) => s === '1,000'), `counter ends at 1,000 (${fills(draw(counter, 2.99))})`);
  console.log('number counter ok');
}
const cd = graphicTemplateClips('countdown-timer', 0)[0];
{
  assert.ok(fills(draw(cd, 0.01)).some((s) => s === '0:10'), `countdown starts at 0:10 (${fills(draw(cd, 0.01))})`);
  assert.ok(fills(draw(cd, 9.99)).some((s) => s === '0:00'), `countdown ends at 0:00 (${fills(draw(cd, 9.99))})`);
  console.log('countdown timer ok');
}
const bar = graphicTemplateClips('progress-bar', 0)[0];
{
  const fillW = (lt) => Math.max(...ofKind(draw(bar, lt), 'fillRect').map((c) => c[3]), 0);
  assert.ok(fillW(0.05) < fillW(1.5) && fillW(1.5) < fillW(2.95), `bar fills over the clip (${fillW(0.05).toFixed(0)} -> ${fillW(1.5).toFixed(0)} -> ${fillW(2.95).toFixed(0)})`);
  console.log('progress bar ok');
}
const strokeClip = graphicTemplateClips('stroke-draw-on', 0)[0];
{
  const segs = (lt) => ofKind(draw(strokeClip, lt), 'lineTo').length;
  assert.ok(segs(0.05) < segs(1) && segs(1) < segs(1.99), `stroke draws over the clip (${segs(0.05)} -> ${segs(1)} -> ${segs(1.99)} segments)`);
  console.log('stroke draw on ok');
}
const credits = graphicTemplateClips('cinematic-simple-credits', 0)[0];
{
  const ys = (lt) => ofKind(draw(credits, lt), 'fillText').map((c) => c[3]);
  const a = ys(0.1), b = ys(4);
  assert.ok(a.length > 0 && b.length > 0, 'credits paint lines');
  assert.ok(Math.max(...b) < Math.max(...a), `credits roll upward (${Math.max(...a).toFixed(0)} -> ${Math.max(...b).toFixed(0)})`);
  console.log('cinematic credits ok');
}
const dots = graphicTemplateClips('kinetic-dot-grid', 0)[0];
{
  const arcs = (lt) => ofKind(draw(dots, lt), 'arc').length;
  assert.equal(arcs(1), 9 * 5, `dot grid paints ${arcs(1)} dots`);
  const r1 = ofKind(draw(dots, 1), 'arc').map((a) => a[3]);
  const r2 = ofKind(draw(dots, 1.6), 'arc').map((a) => a[3]);
  assert.notDeepEqual(r1, r2, 'dot grid pulses over time');
  console.log('kinetic dot grid ok');
}
const pointer = graphicTemplateClips('pointer-highlight', 0)[0];
{
  const radii = (lt) => ofKind(draw(pointer, lt), 'arc').map((a) => a[3]);
  assert.ok(radii(0.5).length >= 3, 'pointer draws halo + ring + dot');
  assert.notDeepEqual(radii(0.5), radii(1.1), 'pointer pulses');
  console.log('pointer highlight ok');
}

// ---- Store: one dispatch inserts the whole group, group selection expands --
{
  const state = { past: [], present: emptyProject(), future: [] };
  const clips = graphicTemplateClips('brand-endcard', 1);
  const next = historyReducer(state, { type: 'addGraphicTemplate', clips });
  assert.equal(next.present.textClips.length, 4, 'endcard lands as 4 clips');
  assert.equal(next.past.length, 1, 'one undo step for the whole group');
  const mates = groupMates(next.present, 'text', clips[0].id);
  assert.equal(mates.length, 4, 'selecting one part selects the whole group');
  const undone = historyReducer(next, { type: 'undo' });
  assert.equal(undone.present.textClips.length, 0, 'one undo removes the whole group');
  console.log('store insert + group + undo ok');
}
console.log('gapc-graphics ok');

// ---- Static-frame skip must NOT freeze time-driven graphics ----------------
// A settled graphic clip (progress ring with progress null, counter,
// countdown) changes pixels every frame, so its signature must be null at
// any local time — otherwise the export reuses one frame from the moment the
// last plain text clip ends (the ring froze at 67% from t=2.5s in the live
// export probe). A static panel MAY prove static.
const { clipStaticSignature, textLayerSignature } = await import('../src/text/staticFrame.js');
{
  const ring = graphicTemplateClips('progress-ring', 0.5)[0];
  assert.equal(clipStaticSignature(ring, 2.0), null, 'time-driven ring never static');
  assert.equal(clipStaticSignature(ring, 2.7), null, 'time-driven ring never static (settled window)');
  const counter = graphicTemplateClips('number-counter', 0.5)[0];
  assert.equal(clipStaticSignature(counter, 1.5), null, 'number counter never static');
  const timer = graphicTemplateClips('countdown-timer', 0.5)[0];
  assert.equal(clipStaticSignature(timer, 1.5), null, 'countdown never static');
  const panel = { id: 'p1', text: '', start: 0.5, duration: 3, graphic: { kind: 'panel' }, animIn: { id: 'none', dur: 0 }, animOut: { id: 'none', dur: 0 }, animLoop: { id: 'none' } };
  assert.equal(typeof clipStaticSignature(panel, 1.5), 'string', 'static panel may prove static');
  const project = { textClips: [ring] };
  assert.equal(textLayerSignature(project, 2.0), null, 'layer signature null while a graphic moves');
  const plain = { id: 'x', text: 'HELLO', start: 0, duration: 3, animIn: { id: 'none', dur: 0 }, animOut: { id: 'none', dur: 0 }, animLoop: { id: 'none' } };
  assert.equal(typeof textLayerSignature({ textClips: [plain] }, 1.5), 'string', 'settled plain text still proves static');
  console.log('static-frame graphic guard ok');
}
