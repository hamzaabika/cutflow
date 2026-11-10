// Home switchboard list logic (src/homeList.js, R5): slot+recent merge (a file-backed
// project appears once), the two sort orders, search reach, and the trash bookkeeping
// for file-only references (park, days-left, expiry). Pure-module suite.
// Usage: node scripts/test-home-list.mjs
import assert from 'node:assert/strict';
import {
  mergeHomeEntries, sortHomeEntries, filterHomeEntries,
  trashEntryForRecent, trashEntryForSlot, daysLeftInTrash, isTrashExpired, fmtDuration,
} from '../src/homeList.js';

const DAY = 24 * 3600 * 1000;
const slot = (id, title, updatedAt, extra = {}) => ({ id, title, file: null, ratio: '16:9', thumb: null, duration: 0, updatedAt, ...extra });
const recent = (path, name, modifiedAt, extra = {}) => ({ path, name, ratio: '9:16', modifiedAt, thumb: null, duration: 0, ...extra });

// --- Merge: slots first-class; a recent for the same path folds into its slot ---
{
  const slots = [
    slot('s1', 'Filed', 100, { file: '/w/a.clipcraft.json', duration: 0 }),
    slot('s2', 'Loose', 300),
  ];
  const recents = [
    recent('/w/a.clipcraft.json', 'Filed (stale name)', 200, { thumb: { kind: 'image', src: 'x' }, duration: 42 }),
    recent('/w/b.clipcraft.json', 'File only', 250),
  ];
  const list = mergeHomeEntries(slots, recents);
  assert.equal(list.length, 3); // the filed project appears ONCE
  const filed = list.find((e) => e.slotId === 's1');
  assert.equal(filed.name, 'Filed'); // the slot's title wins over the stale recent name
  assert.equal(filed.thumb.kind, 'image'); // the recent fills a missing poster
  assert.equal(filed.duration, 42); // ...and a missing duration
  assert.equal(filed.modifiedAt, 200); // ...and the fresher timestamp
  assert.deepEqual(list.map((e) => e.name), ['Loose', 'File only', 'Filed']); // newest first
  const fileOnly = list.find((e) => e.path === '/w/b.clipcraft.json');
  assert.equal(fileOnly.slotId, undefined); // file-only entries carry no slot identity
  assert.deepEqual(mergeHomeEntries([], []), []);
  assert.deepEqual(mergeHomeEntries(null, null), []);
}

// --- Sort: recent is native; name is alphabetical with recency as the tiebreak ---
{
  const list = [
    { name: 'beta', modifiedAt: 10 }, { name: 'Alpha', modifiedAt: 5 },
    { name: 'beta', modifiedAt: 30 }, { name: 'gamma', modifiedAt: 20 },
  ];
  assert.deepEqual(sortHomeEntries(list, 'recent').map((e) => e.modifiedAt), [30, 20, 10, 5]);
  assert.deepEqual(sortHomeEntries(list, 'name').map((e) => `${e.name}:${e.modifiedAt}`),
    ['Alpha:5', 'beta:30', 'beta:10', 'gamma:20']);
  assert.deepEqual(sortHomeEntries(list, 'bogus').map((e) => e.modifiedAt), [30, 20, 10, 5]); // unknown → recent
}

// --- Search: name or ratio, case-insensitive; empty query returns everything ---
{
  const list = [{ name: 'Beach Day', ratio: '16:9' }, { name: 'Promo', ratio: '9:16' }];
  assert.deepEqual(filterHomeEntries(list, 'beach').map((e) => e.name), ['Beach Day']);
  assert.deepEqual(filterHomeEntries(list, '9:16').map((e) => e.name), ['Promo']);
  assert.equal(filterHomeEntries(list, '  ').length, 2);
  assert.equal(filterHomeEntries(list, 'zzz').length, 0);
}

// --- Trash bookkeeping: park a file recent, count its days, expire it on schedule ---
{
  const r = recent('/w/b.clipcraft.json', 'File only', 250, { duration: 7 });
  const t = trashEntryForRecent(r, 1000);
  assert.equal(t.kind, 'file');
  assert.equal(t.path, '/w/b.clipcraft.json');
  assert.equal(t.trashedAt, 1000);
  assert.equal(t.duration, 7);
  assert.equal(daysLeftInTrash(1000, 1000), 30);
  assert.equal(daysLeftInTrash(1000, 1000 + 29 * DAY), 1);
  assert.equal(daysLeftInTrash(1000, 1000 + 45 * DAY), 0);
  assert.equal(isTrashExpired(t, 1000 + 29 * DAY), false);
  assert.equal(isTrashExpired(t, 1000 + 31 * DAY), true);
  const st = trashEntryForSlot({ id: 's9', title: 'Gone', file: '/w/g.json', ratio: '1:1', thumb: null, duration: 3, updatedAt: 9, trashedAt: 500 });
  assert.equal(st.kind, 'slot');
  assert.equal(st.slotId, 's9');
  assert.equal(st.path, '/w/g.json');
}

// --- Duration chips ---
assert.equal(fmtDuration(0), '');
assert.equal(fmtDuration(7), '0:07');
assert.equal(fmtDuration(754), '12:34');
assert.equal(fmtDuration(3725), '1:02:05');
assert.equal(fmtDuration(undefined), '');

console.log('HOME LIST OK: merge folds recents into slots, sorts + search pinned, file-trash park/expiry, duration format');
