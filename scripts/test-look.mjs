// MisterHorse P2-6 — batch style application: the style is the whole look
// (filter + grade + adjust + the effect set), applied to every selected
// picture clip, plus the one-click "apply this clip's style" action.
// Grouping and multi-select themselves already exist (verified in code and
// live); this suite pins the style behaviour and the store round-trip.
import { isLookPatch, lookPatchFor, fullStylePatch, applyStyleAction, selectedPictures, lookAction } from '../src/look.js';
import { historyReducer, normalizeProject } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };

const mk = (id, len, extra = {}) => ({ id, mediaId: 'm', in: 0, out: len, speed: 1, ...extra });
const base = () => ({
  ...normalizeProject({}),
  media: [{ id: 'm', type: 'video', duration: 30 }],
  videoClips: [mk('a', 10), mk('b', 4)],
  overlayClips: [mk('o1', 6, { start: 0 })],
  textClips: [mk('t1', 3, { start: 0 })],
});

// 1. isLookPatch: style keys pass, geometry/timing/transition keys refuse.
ok(isLookPatch({ filter: 'warm' }), 'filter is a look patch');
ok(isLookPatch({ effects: ['fx_vhs'] }), 'effects list is a look patch');
ok(isLookPatch({ fxParams: { fx_vhs: { grain: 10 } } }), 'fxParams is a look patch');
ok(isLookPatch({ fxTiming: { fx_vhs: { start: 0, duration: 1 } } }), 'fxTiming is a look patch');
ok(isLookPatch({ grade: { exposure: 0.5 }, effects: ['fx_vhs'] }), 'mixed style patch passes');
ok(!isLookPatch({ transform: { scale: 2 } }), 'transform is NOT a look patch');
ok(!isLookPatch({ transition: { type: 'fade' } }), 'transition is NOT a look patch');
ok(!isLookPatch({ out: 5 }), 'timing is NOT a look patch');
ok(!isLookPatch({}), 'empty patch is NOT a look patch');
ok(!isLookPatch({ filter: 'warm', transform: { scale: 2 } }), 'mixed look+geometry refuses');

// 2. Grade/adjust diffing is preserved: only the moved slider propagates.
{
  const src = mk('a', 10, { grade: { exposure: 0.2, saturation: 1 }, adjust: { brightness: 0 } });
  const tgt = mk('b', 4, { grade: { exposure: 0.9, saturation: 0.5 }, adjust: { brightness: 0.3 } });
  const patch = lookPatchFor(src, { grade: { exposure: 0.7, saturation: 1 } }, tgt);
  ok(patch.grade.exposure === 0.7 && patch.grade.saturation === 0.5, `grade diffing keeps target saturation (${JSON.stringify(patch.grade)})`);
}

// 3. Effect keys copy wholesale: the target ends up with the source's set.
{
  const src = mk('a', 10, { effects: ['fx_vhs', 'fx_grain'], fxParams: { fx_vhs: { grain: 12 } }, fxStrength: { fx_vhs: 0.5 } });
  const tgt = mk('b', 4, { effects: ['fx_blur'], fxParams: { fx_blur: { radius: 0.02 } } });
  const patch = lookPatchFor(src, { effects: src.effects, fxParams: src.fxParams, fxStrength: src.fxStrength }, tgt);
  ok(JSON.stringify(patch.effects) === JSON.stringify(['fx_vhs', 'fx_grain']), 'effects list copies wholesale');
  ok(patch.fxParams.fx_vhs.grain === 12 && !('fx_blur' in patch.fxParams), 'fxParams copies wholesale (old effect params go)');
  ok(patch.fxStrength.fx_vhs === 0.5, 'fxStrength copies wholesale');
}

// 4. fxTiming windows clamp to each target's own span.
{
  const src = mk('a', 10, { effects: ['fx_vhs'], fxTiming: { fx_vhs: { start: 2, duration: 3 } } });
  const tgt = mk('b', 1.5, { effects: [] });
  const patch = lookPatchFor(src, { fxTiming: src.fxTiming }, tgt);
  ok(patch.fxTiming.fx_vhs.start <= 1.4 && patch.fxTiming.fx_vhs.duration <= 1.5 - patch.fxTiming.fx_vhs.start + 1e-9,
    `timing clamps to the 1.5s target (${JSON.stringify(patch.fxTiming.fx_vhs)})`);
  const long = mk('c', 10, { effects: [] });
  const patch2 = lookPatchFor(src, { fxTiming: src.fxTiming }, long);
  ok(patch2.fxTiming.fx_vhs.start === 2 && patch2.fxTiming.fx_vhs.duration === 3, 'timing passes through unchanged when it fits');
}

// 5. fullStylePatch deep-copies: mutating the patch never touches the source.
{
  const src = mk('a', 10, { filter: 'warm', grade: { exposure: 0.2 }, effects: ['fx_vhs'], fxParams: { fx_vhs: { grain: 12 } } });
  const patch = fullStylePatch(src);
  patch.grade.exposure = 9; patch.effects.push('fx_blur'); patch.fxParams.fx_vhs.grain = 99;
  ok(src.grade.exposure === 0.2 && src.effects.length === 1 && src.fxParams.fx_vhs.grain === 12, 'fullStylePatch is a deep copy');
  ok(!('transform' in patch) && !('transition' in patch), 'style patch carries no geometry');
}

// 6. applyStyleAction: one updateMany, one update per target, patches independent.
{
  const src = mk('a', 10, { filter: 'warm', effects: ['fx_vhs'] });
  const action = applyStyleAction([{ track: 'video', id: 'b' }, { track: 'overlay', id: 'o1' }], src);
  ok(action.type === 'updateMany' && action.updates.length === 2, 'applyStyleAction is one updateMany with 2 updates');
  action.updates[0].patch.filter = 'cold';
  ok(action.updates[1].patch.filter === 'warm', 'per-target patches are independent copies');
}

// 7. selectedPictures: picture tracks only, gaps excluded, no items -> [].
{
  const p = base();
  const items = selectedPictures(p, { items: [{ track: 'video', id: 'a' }, { track: 'overlay', id: 'o1' }, { track: 'text', id: 't1' }] });
  ok(items.length === 2 && items.every((x) => x.track === 'video' || x.track === 'overlay'), 'selectedPictures keeps picture clips only');
  ok(selectedPictures(p, null).length === 0 && selectedPictures(p, { track: 'video', id: 'a' }).length === 0, 'single selection is not a multi-selection');
  const gapped = { ...p, videoClips: [mk('a', 10, { gap: true }), mk('b', 4)] };
  ok(selectedPictures(gapped, { items: [{ track: 'video', id: 'a' }, { track: 'video', id: 'b' }] }).length === 1, 'gaps are excluded');
}

// 8. Store round-trip: apply the style, then undo restores it.
{
  const src = mk('a', 10, { filter: 'warm', grade: { exposure: 0.4 }, effects: ['fx_vhs'], fxParams: { fx_vhs: { grain: 12 } } });
  const tgt = mk('b', 4, { filter: 'none', grade: { exposure: 0 }, effects: ['fx_blur'] });
  let st = { past: [], present: { ...base(), videoClips: [src, tgt] }, future: [] };
  st = historyReducer(st, applyStyleAction([{ track: 'video', id: 'b' }], src));
  const after = st.present.videoClips.find((c) => c.id === 'b');
  ok(after.filter === 'warm' && after.grade.exposure === 0.4, 'store applies filter+grade to the target');
  ok(JSON.stringify(after.effects) === JSON.stringify(['fx_vhs']) && after.fxParams.fx_vhs.grain === 12, 'store applies the effect set to the target');
  ok(st.present.videoClips.find((c) => c.id === 'a').filter === 'warm', 'source is untouched');
  st = historyReducer(st, { type: 'undo' });
  const undone = st.present.videoClips.find((c) => c.id === 'b');
  ok(undone.filter === 'none' && JSON.stringify(undone.effects) === JSON.stringify(['fx_blur']), 'undo restores the target style (one undo step)');
}

// 9. lookAction still works for the incremental path (filter edit on A -> B).
{
  const src = mk('a', 10, { filter: 'none' });
  const tgt = mk('b', 4, { filter: 'none' });
  const action = lookAction([{ track: 'video', clip: tgt }], src, { filter: 'warm' });
  ok(action.updates[0].patch.filter === 'warm', 'lookAction carries a filter edit');
}

if (fails.length) { console.log(`\ntest-look: FAIL (${fails.length})`); process.exit(1); }
console.log('\ntest-look: PASS');
