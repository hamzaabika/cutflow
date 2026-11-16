// Real-footage previews + recency + apply-to-all acceptance test (FB-28 · P1-43).
// Run: node scripts/test-fx-recency-apply.mjs
import assert from 'assert/strict';
import { effectUpdatesForSelection, applyToSelectedTargets } from '../src/fx/applyToSelected.js';
import { loadRecentEffects, recordRecentEffect } from '../src/fx/recentEffects.js';

const store = () => {
  const s = { _v: {} };
  return {
    getItem(k) { return s._v[k] ?? null; },
    setItem(k, v) { s._v[k] = String(v); },
    removeItem(k) { delete s._v[k]; },
  };
};

// Recently-used effects: most recent first, deduped, capped at 8.
{
  const st = store();
  assert.deepEqual(loadRecentEffects(st), []);
  recordRecentEffect('grain', st);
  recordRecentEffect('blur', st);
  recordRecentEffect('grain', st);
  assert.deepEqual(loadRecentEffects(st), ['grain', 'blur'], 're-apply moves to the front');
  for (let i = 0; i < 10; i++) recordRecentEffect(`fx_${i}`, st);
  const list = loadRecentEffects(st);
  assert.equal(list.length, 8, 'capped at 8');
  assert.equal(list[0], 'fx_9', 'newest first');
  assert.ok(!list.includes('grain'), 'oldest falls off');
}

// Apply-to-all-selected: one update per selected clip missing the effect.
const clip = (id, len, effects = []) => ({ id, in: 0, out: len, effects });
const project = {
  videoClips: [clip('a', 6, ['grain']), clip('b', 6, []), clip('c', 6, [],)],
  overlayClips: [clip('o1', 4, [])],
};
project.videoClips[2] = { ...project.videoClips[2], gap: false };
const sel = { items: [
  { track: 'video', id: 'a' },
  { track: 'video', id: 'b' },
  { track: 'overlay', id: 'o1' },
] };
{
  const updates = effectUpdatesForSelection(project, sel, 'blur');
  assert.equal(updates.length, 3, 'all three selected clips lack blur');
  assert.deepEqual(updates.map((u) => u.id), ['a', 'b', 'o1']);
  assert.deepEqual(updates[0].patch, { effects: ['grain', 'blur'] }, 'existing effects preserved, new one appended');
  assert.deepEqual(updates[1].patch, { effects: ['blur'] });
  const again = effectUpdatesForSelection(project, sel, 'grain');
  assert.deepEqual(again.map((u) => u.id), ['b', 'o1'], 'clips already carrying the effect are untouched');
  assert.deepEqual(effectUpdatesForSelection(project, { items: [] }, 'blur'), [], 'empty selection: nothing to do');
  assert.deepEqual(effectUpdatesForSelection(project, null, 'blur'), [], 'no selection: nothing to do');
  assert.equal(applyToSelectedTargets(project, sel, 'grain').length, 2);
}
// A gapped clip in the selection is skipped (selectedPictures filters gaps).
{
  const gapped = {
    videoClips: [clip('a', 6), { id: 'g', in: 0, out: 2, gap: true, effects: [] }],
    overlayClips: [],
  };
  const s2 = { items: [{ track: 'video', id: 'a' }, { track: 'video', id: 'g' }] };
  assert.deepEqual(effectUpdatesForSelection(gapped, s2, 'blur').map((u) => u.id), ['a']);
}
console.log('fx-recency-apply OK: recent effects capped/deduped, apply-to-all-selected touches only clips missing the effect');
