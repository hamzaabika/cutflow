// Version history store (electron/versions.cjs): record/list/read round trip, content
// dedupe, background throttle vs forced saves, bounded eviction (files deleted),
// restore reads, torn-index rebuild, and id/filename sanitisation.
// Usage: node scripts/test-versions.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vs = require('../electron/versions.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-versions-'));
const proj = (name) => JSON.stringify({ id: 'p1', name, media: [], videoClips: [] });
const T0 = 1_700_000_000_000;

{
  const root = tmp();

  // Forced saves always record; the list is newest first with its metadata.
  const e1 = vs.recordVersion(root, 'p1', proj('alpha'), { source: 'save', boundFile: '/work/a.clipcraft.json', force: true, now: T0 });
  assert.ok(e1 && e1.file.endsWith('.json'));
  assert.equal(e1.source, 'save');
  assert.equal(e1.boundFile, '/work/a.clipcraft.json');
  const e2 = vs.recordVersion(root, 'p1', proj('beta'), { source: 'save', force: true, now: T0 + 1000 });
  const list = vs.listVersions(root, 'p1');
  assert.deepEqual(list.map((e) => e.file), [e2.file, e1.file]);
  assert.equal(list[1].savedAt, T0);

  // Restore: reading a snapshot returns the exact payload that was recorded.
  assert.equal(vs.readVersion(root, 'p1', e1.file), proj('alpha'));
  assert.equal(JSON.parse(vs.readVersion(root, 'p1', e2.file)).name, 'beta');

  // Unchanged content never duplicates, even forced and much later.
  assert.equal(vs.recordVersion(root, 'p1', proj('beta'), { force: true, now: T0 + 60_000 }), null);
  assert.equal(vs.listVersions(root, 'p1').length, 2);

  // Background writers are throttled to one snapshot per MIN_INTERVAL...
  assert.equal(vs.recordVersion(root, 'p1', proj('gamma'), { source: 'autosave', now: T0 + 2000 }), null);
  // ...but the same content lands once the interval has passed.
  const e3 = vs.recordVersion(root, 'p1', proj('gamma'), { source: 'autosave', now: T0 + 1000 + vs.MIN_INTERVAL + 1 });
  assert.ok(e3);
  assert.equal(e3.source, 'autosave');
  assert.equal(vs.listVersions(root, 'p1').length, 3);

  // Invalid payloads and hostile ids are refused; reads cannot escape the store.
  assert.equal(vs.recordVersion(root, 'p1', '{torn', { force: true, now: T0 + 9e6 }), null);
  assert.equal(vs.recordVersion(root, '../evil', proj('x'), { force: true, now: T0 }), null);
  assert.equal(vs.readVersion(root, 'p1', '../../etc/passwd'), null);
  assert.equal(vs.readVersion(root, 'p1', 'not-a-snapshot.json'), null);
  assert.equal(vs.readVersion(root, 'p1', '1234567890-deadbeef.json'), null); // well-formed but absent
  assert.deepEqual(vs.listVersions(root, 'nobody'), []);
}

// Eviction: the store keeps at most CAP snapshots and deletes the evicted files.
{
  const root = tmp();
  const files = [];
  for (let i = 0; i < vs.CAP + 3; i += 1) {
    const e = vs.recordVersion(root, 'p7', proj(`s${i}`), { force: true, now: T0 + i * 1000 });
    files.push(e.file);
  }
  const list = vs.listVersions(root, 'p7');
  assert.equal(list.length, vs.CAP);
  assert.equal(JSON.parse(vs.readVersion(root, 'p7', list[0].file)).name, `s${vs.CAP + 2}`);
  for (const evicted of files.slice(0, 3)) {
    assert.ok(!fs.existsSync(path.join(root, 'p7', evicted)));
    assert.equal(vs.readVersion(root, 'p7', evicted), null);
  }
}

// A torn index rebuilds from the snapshot files themselves.
{
  const root = tmp();
  const e = vs.recordVersion(root, 'p8', proj('kept'), { force: true, now: T0 });
  fs.writeFileSync(path.join(root, 'p8', 'index.json'), '{torn index');
  const list = vs.listVersions(root, 'p8');
  assert.equal(list.length, 1);
  assert.equal(list[0].file, e.file);
  assert.equal(list[0].savedAt, T0);
  assert.equal(vs.readVersion(root, 'p8', e.file), proj('kept'));
  // ...and recording still works on top of the rebuilt index.
  const e2 = vs.recordVersion(root, 'p8', proj('kept-2'), { force: true, now: T0 + 5000 });
  assert.deepEqual(vs.listVersions(root, 'p8').map((x) => x.file), [e2.file, e.file]);
}

console.log('test-versions: all assertions passed');
