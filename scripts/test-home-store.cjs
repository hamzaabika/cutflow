// Home switchboard store semantics (R5, parity §8): duplicate (independent copy, new id,
// unbound), rename in place (title + document name, recency order preserved), and the
// trash lifecycle (soft-delete hides, restore round-trips, the 30-day purge evicts only
// the expired, the cap counts live slots only, and index hygiene never drops trash).
// Drives electron/autosave.cjs directly, like test-autosave.cjs.
// Usage: node scripts/test-home-store.cjs
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../electron/autosave.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-home-store-'));
const DAY = 24 * 3600 * 1000;
const NOW = Date.now(); // the store's purge reads the wall clock — timestamps stay relative to it
const rec = (id, title, updatedAt, extra = {}) => ({
  id, title, file: null, ratio: '16:9', thumb: null, duration: 12.5, updatedAt,
  projectJson: JSON.stringify({ id, name: title, media: [], videoClips: [] }),
  ...extra,
});

{
  const root = tmp();
  store.writeSlot(root, rec('a', 'Alpha', NOW - 5000, { file: '/work/alpha.clipcraft.json' }));
  store.writeSlot(root, rec('b', 'Beta', NOW - 4000));

  // --- Duplicate: new id, "copy" title, unbound, full document, source untouched ---
  const copy = store.copySlot(root, 'a', NOW - 3000);
  assert.ok(copy && copy.id !== 'a');
  assert.equal(copy.title, 'Alpha copy');
  assert.equal(copy.file, null); // never shares the source's bound file
  assert.equal(copy.duration, 12.5);
  const copySlotBody = store.readSlot(root, copy.id);
  assert.equal(copySlotBody.project.id, copy.id);
  assert.equal(copySlotBody.project.name, 'Alpha copy');
  // Independence: editing the copy (a rewrite under its own id) leaves the source alone.
  store.writeSlot(root, rec(copy.id, 'Alpha copy', NOW - 2000, {
    projectJson: JSON.stringify({ id: copy.id, name: 'Alpha copy', media: [{ id: 'm1' }], videoClips: [] }),
  }));
  assert.deepEqual(store.readSlot(root, 'a').project.media, []);
  assert.equal(store.readSlot(root, 'a').title, 'Alpha');
  assert.equal(store.slotForFile(root, '/work/alpha.clipcraft.json')?.id, 'a'); // binding stays with the source
  assert.equal(store.copySlot(root, 'nope'), null); // missing source refuses

  // --- Rename in place: title + document name move, order does not ---
  const before = store.listSlots(root).map((x) => x.id);
  const renamed = store.renameSlot(root, 'b', '  Beta Prime  ');
  assert.equal(renamed.title, 'Beta Prime'); // trimmed
  assert.equal(store.readSlot(root, 'b').project.name, 'Beta Prime');
  assert.deepEqual(store.listSlots(root).map((x) => x.id), before); // recency order preserved
  assert.equal(store.renameSlot(root, 'b', '   '), null); // empty refused
  assert.equal(store.renameSlot(root, 'nope', 'X'), null);

  // --- Trash: hidden from the live list, listed in trash, file binding released ---
  assert.equal(store.trashSlot(root, 'a', NOW - 1000), true);
  assert.ok(!store.listSlots(root).some((x) => x.id === 'a'));
  assert.equal(store.slotForFile(root, '/work/alpha.clipcraft.json'), null); // a trashed slot adopts nothing
  const trash = store.listTrashed(root);
  assert.equal(trash.length, 1);
  assert.equal(trash[0].id, 'a');
  assert.equal(trash[0].trashedAt, NOW - 1000);
  assert.equal(trash[0].file, '/work/alpha.clipcraft.json'); // the reference is kept for restore; the file itself is untouched by the store
  assert.equal(store.trashSlot(root, 'a', NOW), true); // idempotent
  assert.equal(store.listTrashed(root)[0].trashedAt, NOW - 1000); // first trash time stands
  assert.equal(store.copySlot(root, 'a'), null); // no duplicating out of the trash
  assert.equal(store.renameSlot(root, 'a', 'Ghost'), null); // no renaming in the trash

  // A rewrite of a trashed slot (the editor may still hold it) keeps it trashed.
  store.writeSlot(root, rec('a', 'Alpha', NOW, { file: '/work/alpha.clipcraft.json' }));
  assert.ok(!store.listSlots(root).some((x) => x.id === 'a'));
  assert.equal(store.listTrashed(root).length, 1);

  // --- Restore: back in the live list with its binding and content intact ---
  assert.equal(store.restoreSlot(root, 'a'), true);
  assert.ok(store.listSlots(root).some((x) => x.id === 'a'));
  assert.equal(store.listTrashed(root).length, 0);
  assert.equal(store.slotForFile(root, '/work/alpha.clipcraft.json')?.id, 'a');
  assert.equal(store.restoreSlot(root, 'a'), false); // not trashed any more

  // --- Index hygiene: deleting one slot never drops trashed entries from the index ---
  store.trashSlot(root, 'b', NOW);
  assert.equal(store.deleteSlot(root, copy.id), true);
  assert.equal(store.listTrashed(root).map((x) => x.id).join(), 'b'); // trash survived the delete's index rewrite
  store.writeSlot(root, rec('c', 'Gamma', NOW)); // ...and a plain write's index rewrite
  assert.equal(store.listTrashed(root).map((x) => x.id).join(), 'b');

  // --- Purge: only trash older than the retention window is evicted ---
  assert.deepEqual(store.purgeTrashed(root, NOW + 29 * DAY), []); // inside the window: nothing goes
  assert.deepEqual(store.purgeTrashed(root, NOW + 31 * DAY), ['b']); // past it: evicted
  assert.equal(store.readSlot(root, 'b'), null);
  assert.ok(!fs.existsSync(path.join(root, 'b.json')));
  // The wall-clock list pass purges genuinely old trash on its own:
  store.writeSlot(root, rec('d', 'Delta', NOW));
  store.trashSlot(root, 'd', NOW - 31 * DAY); // stamped 31 days ago
  store.listSlots(root);
  assert.equal(store.listTrashed(root).length, 0); // 'd' was purged by the list pass itself
  assert.equal(store.readSlot(root, 'd'), null);

  // --- The cap counts live slots only: a full store plus trash still accepts writes ---
  const root2 = tmp();
  for (let i = 0; i < store.CAP; i++) store.writeSlot(root2, rec(`k${i}`, `P${i}`, NOW - 10000 + i));
  store.trashSlot(root2, 'k0', NOW);
  store.writeSlot(root2, rec('fresh', 'Fresh', NOW)); // 23 live + 1 trashed + this = at cap, no live eviction
  const live = store.listSlots(root2);
  assert.equal(live.length, store.CAP);
  assert.ok(live.some((x) => x.id === 'k1')); // the oldest LIVE slot was not evicted to make room
  assert.equal(store.listTrashed(root2).map((x) => x.id).join(), 'k0');
}

console.log('HOME STORE OK: duplicate independent + unbound, rename in place, trash/restore round trip, purge evicts only expired, cap counts live only');
