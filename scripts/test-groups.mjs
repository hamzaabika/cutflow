// Clip groups, select-following, bulk-op lock respect (P2-03, TL-07).
// Usage: node scripts/test-groups.mjs
import { emptyProject, historyReducer, findClipIn } from '../src/store.js';
import { groupMates, expandGroupSelection, followingClips } from '../src/groups.js';

const assert = (ok, what) => { if (!ok) throw new Error(what); };
const state = (project) => ({ past: [], present: project, future: [] });
const clip = (id, over = {}) => ({ id, mediaId: 'm0', in: 0, out: 10, speed: 1, volume: 1, muted: false, ...over });
const base = (over = {}) => ({
  ...emptyProject(),
  media: [{ id: 'm0', type: 'video', duration: 40, width: 1280, height: 720, hasAudio: true }],
  videoClips: [clip('v1', { in: 0, out: 10 }), clip('v2', { in: 10, out: 20 }), clip('v3', { in: 20, out: 30 })],
  audioClips: [
    { id: 'a1', mediaId: 'm0', start: 0, in: 0, out: 10, speed: 1, volume: 1 },
    { id: 'a2', mediaId: 'm0', start: 10, in: 10, out: 20, speed: 1, volume: 1 },
  ],
  ...over,
});

// --- Group / ungroup.
{
  let s = state(base());
  s = historyReducer(s, { type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'audio', id: 'a1' }], groupId: 'g1' });
  assert(findClipIn(s.present, 'video', 'v1').groupId === 'g1', 'groupClips stamps the video clip');
  assert(findClipIn(s.present, 'audio', 'a1').groupId === 'g1', 'groupClips stamps the audio clip');
  assert(findClipIn(s.present, 'video', 'v2').groupId === undefined, 'groupClips leaves others alone');
  const mates = groupMates(s.present, 'video', 'v1');
  assert(mates.length === 2 && mates.some((m) => m.track === 'audio' && m.id === 'a1'), 'groupMates finds cross-track members');
  const expanded = expandGroupSelection(s.present, [{ track: 'video', id: 'v1' }]);
  assert(expanded.length === 2, 'selecting one member expands to the group');
  assert(expandGroupSelection(s.present, [{ track: 'video', id: 'v2' }]).length === 1, 'ungrouped clips do not expand');
  s = historyReducer(s, { type: 'undo' });
  assert(!findClipIn(s.present, 'video', 'v1').groupId, 'grouping undoes');
  s = historyReducer(s, { type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }], groupId: 'g2' });
  s = historyReducer(s, { type: 'ungroupClips', items: [{ track: 'video', id: 'v1' }] });
  assert(!findClipIn(s.present, 'video', 'v1').groupId, 'ungroup clears the member');
  assert(!findClipIn(s.present, 'video', 'v2').groupId, 'ungroup dissolves the whole group, not just the named member');
  // Split halves keep the group; duplicates do not.
  s = historyReducer(s, { type: 'groupClips', items: [{ track: 'video', id: 'v2' }], groupId: 'g3' });
  s = historyReducer(s, { type: 'split', track: 'video', id: 'v2', t: 15, newId: 'v2b' });
  assert(findClipIn(s.present, 'video', 'v2').groupId === 'g3', 'split keeps the group on the left half');
  assert(findClipIn(s.present, 'video', 'v2b').groupId === 'g3', 'split keeps the group on the right half');
  s = historyReducer(s, { type: 'duplicate', track: 'video', id: 'v2', newId: 'v2c' });
  assert(findClipIn(s.present, 'video', 'v2c').groupId === undefined, 'duplicate does not join the group');
}

// --- Select-following.
{
  const p = base();
  const f = followingClips(p, 'video', 10);
  assert(f.length === 2 && f[0].id === 'v2' && f[1].id === 'v3', 'followingClips from the playhead');
  assert(followingClips(p, 'video', 0).length === 3, 'followingClips at zero takes all');
  assert(followingClips(p, 'video', 29).length === 1, 'followingClips near the end takes the last');
  const fa = followingClips(p, 'audio', 10);
  assert(fa.length === 1 && fa[0].id === 'a2', 'followingClips on the audio lane');
}

// --- Bulk ops respect locks (and grouping expands the bulk set).
{
  // Locked audio layer: grouping across it is refused wholesale.
  const locked = base({ layerState: { 'audio:0': { locked: true } } });
  let s = state(locked);
  const before = s.present;
  s = historyReducer(s, { type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'audio', id: 'a1' }], groupId: 'g9' });
  assert(s.present === before, 'groupClips refused when a member sits on a locked layer');
  // Ungroup on a locked member is refused too.
  const grouped = base();
  let g = state(grouped);
  g = historyReducer(g, { type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'audio', id: 'a1' }], groupId: 'g1' });
  const lockedGrouped = { ...g.present, layerState: { 'audio:0': { locked: true } } };
  let g2 = state(lockedGrouped);
  const b2 = g2.present;
  g2 = historyReducer(g2, { type: 'ungroupClips', items: [{ track: 'audio', id: 'a1' }] });
  assert(g2.present === b2, 'ungroupClips refused on a locked layer');
  // Delete of a grouped member via the expanded selection removes the group;
  // a locked member blocks its own delete (single-item guard).
  let d = state(base());
  d = historyReducer(d, { type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'audio', id: 'a1' }], groupId: 'g1' });
  d = historyReducer(d, { type: 'beginGesture' });
  for (const it of expandGroupSelection(d.present, [{ track: 'video', id: 'v1' }])) {
    d = historyReducer(d, { type: 'delete', track: it.track, id: it.id });
  }
  d = historyReducer(d, { type: 'endGesture' });
  assert(!findClipIn(d.present, 'video', 'v1'), 'bulk delete removes the video member');
  assert(!findClipIn(d.present, 'audio', 'a1'), 'bulk delete removes the grouped audio member');
  assert(findClipIn(d.present, 'video', 'v2'), 'bulk delete leaves the rest');
}

console.log('test-groups: all checks passed');
