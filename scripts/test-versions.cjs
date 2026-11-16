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

// P1-48: named versions — a name rides on the recorded entry and survives
// listing; renaming updates the index only (the snapshot file is untouched),
// and blank/hostile names are refused. Renaming an evicted/absent file fails.
{
  const root = tmp();
  const e = vs.recordVersion(root, 'pn', proj('named'), { source: 'save', name: '  First cut  ', force: true, now: T0 });
  assert.equal(e.name, 'First cut');
  assert.equal(vs.listVersions(root, 'pn')[0].name, 'First cut');
  const renamed = vs.renameVersion(root, 'pn', e.file, 'Director\u2019s cut');
  assert.equal(renamed.name, 'Director\u2019s cut');
  assert.equal(vs.listVersions(root, 'pn')[0].name, 'Director\u2019s cut');
  assert.equal(vs.readVersion(root, 'pn', e.file), proj('named')); // file untouched
  assert.equal(vs.renameVersion(root, 'pn', e.file, '   '), null);
  assert.equal(vs.renameVersion(root, 'pn', e.file, 'x'.repeat(200)).name.length, 80);
  assert.equal(vs.renameVersion(root, 'pn', '1234567890-deadbeef.json', 'nope'), null);
  assert.equal(vs.listVersions(root, 'pn')[0].name.length, 80);
}

// P1-48: comparison — summarize/diff over two project documents.
{
  const media = [
    { id: 'm1', name: 'clip-a.mp4' },
    { id: 'm2', name: 'clip-b.mp4' },
    { id: 'm3', name: 'music.mp3' },
  ];
  const a = { id: 'p', name: 'Cut 1', media,
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 5 }, { id: 'v2', mediaId: 'm2', in: 0, out: 4 }],
    textClips: [{ id: 't1', text: 'Hello', start: 0, duration: 2 }], audioClips: [], overlayClips: [], stickerClips: [], effectClips: [] };
  const b = { id: 'p', name: 'Cut 2', media: [media[0], media[2]],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 5 }, { id: 'v3', mediaId: 'm2', in: 0, out: 3 }],
    textClips: [{ id: 't1', text: 'Hello', start: 0, duration: 2 }, { id: 't2', text: 'World', start: 2, duration: 2 }],
    audioClips: [{ id: 'a1', mediaId: 'm3', start: 0, in: 0, out: 6 }], overlayClips: [], stickerClips: [], effectClips: [] };
  const sa = vs.summarizeProject(a);
  assert.equal(sa.title, 'Cut 1');
  assert.equal(sa.duration, 9);
  assert.equal(sa.tracks.video.count, 2);
  assert.equal(sa.tracks.text.clips[0].label, 'Hello');
  const d = vs.diffProjects(a, b);
  assert.deepEqual(d.title, { from: 'Cut 1', to: 'Cut 2' });
  assert.equal(d.duration.from, 9);
  assert.equal(d.tracks.video.before, 2);
  assert.equal(d.tracks.video.after, 2);
  assert.equal(d.tracks.text.after, 2);
  assert.ok(d.tracks.text.added.includes('World'));
  assert.equal(d.tracks.audio.after, 1);
  assert.ok(d.mediaRemoved.includes('clip-b.mp4'));
  assert.deepEqual(vs.diffProjects(a, a).tracks.video, { before: 2, after: 2, added: [], removed: [] });
}

// P1-48: selective restoration — whole-track replace, single-clip replace and
// append, untouched tracks preserved, and media the restored clips need is
// copied over when the live project lacks it.
{
  const live = { id: 'p', name: 'Live', media: [{ id: 'm1', name: 'clip-a.mp4' }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 5 }],
    textClips: [{ id: 't1', text: 'Old', start: 0, duration: 2 }],
    audioClips: [], overlayClips: [], stickerClips: [], effectClips: [] };
  const snap = { id: 'p', name: 'Snap', media: [{ id: 'm1', name: 'clip-a.mp4' }, { id: 'm2', name: 'clip-b.mp4' }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 8 }, { id: 'v2', mediaId: 'm2', in: 0, out: 4 }],
    textClips: [{ id: 't1', text: 'New', start: 0, duration: 3 }, { id: 't2', text: 'Extra', start: 3, duration: 1 }],
    audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 4 }],
    overlayClips: [], stickerClips: [], effectClips: [] };
  // Whole text track only: video stays live, text comes from the snapshot.
  const m1 = vs.selectiveRestore(live, snap, { tracks: ['text'], clips: [] });
  assert.equal(m1.videoClips[0].out, 5);
  assert.deepEqual(m1.textClips.map((c) => c.text), ['New', 'Extra']);
  assert.equal(m1.audioClips.length, 0);
  // One clip: the video clip's state is replaced in place; the other video
  // clip is not pulled in, and the text track is untouched.
  const m2 = vs.selectiveRestore(live, snap, { tracks: [], clips: [{ track: 'video', id: 'v1' }] });
  assert.equal(m2.videoClips.length, 1);
  assert.equal(m2.videoClips[0].out, 8);
  assert.equal(m2.textClips[0].text, 'Old');
  // A clip the live project never had is appended, with its media entry.
  const m3 = vs.selectiveRestore(live, snap, { tracks: [], clips: [{ track: 'audio', id: 'a1' }] });
  assert.equal(m3.audioClips.length, 1);
  assert.ok(m3.media.some((m) => m.id === 'm2'));
  assert.equal(m3.videoClips[0].out, 5);
  // Unknown tracks/clips and empty selections change nothing.
  assert.deepEqual(vs.selectiveRestore(live, snap, { tracks: ['nope'], clips: [{ track: 'video', id: 'ghost' }] }), live);
}

console.log('test-versions: all assertions passed');
