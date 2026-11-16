// FB-19 (P1-27) — old-project migration compatibility, pinned without Electron.
// Old project shapes (pre-schemaVersion v0) must open correctly under the
// current schema (v1): arrays exist, clip defaults are filled, string
// transitions normalise, size derives from ratio — and nothing else is
// rewritten. A v1 project passes through untouched; a newer-than-this-build
// project is left alone, never silently rewritten.
// Usage: node scripts/test-project-migrations.cjs
const { migrateProject, PROJECT_SCHEMA_VERSION } = require('../electron/projectfile.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const parse = (r) => JSON.parse(r.json);

// 1. Minimal v0 project: no schemaVersion, no arrays but videoClips, no
//    fps/size, bare clips.
let r = migrateProject(JSON.stringify({
  name: 'old project',
  media: [{ id: 'm1', path: '/tmp/cam.mp4', name: 'cam.mp4' }],
  videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 4 }],
}));
ok(r.migrated === true && r.fromVersion === 0 && r.toVersion === 1, 'v0 migrates to v1');
let p = parse(r);
ok(p.schemaVersion === 1, 'schemaVersion stamped 1');
ok(Array.isArray(p.effectClips) && Array.isArray(p.textClips) && Array.isArray(p.overlayClips) && Array.isArray(p.audioClips) && Array.isArray(p.stickerClips), 'all clip arrays exist after migration');
ok(p.videoClips[0].speed === 1 && p.videoClips[0].volume === 1 && p.videoClips[0].muted === false && p.videoClips[0].filter === 'none', 'bare clip gets speed/volume/muted/filter defaults');
ok(p.fps === 30 && p.width === 1920 && p.height === 1080 && p.background === '#000000', 'fps/size/background defaulted');
ok(p.videoClips[0].in === 0 && p.videoClips[0].out === 4 && p.media[0].path === '/tmp/cam.mp4', 'timings and media paths pass through untouched');

// 2. Legacy string transition normalises; explicit values are NOT overwritten.
r = migrateProject(JSON.stringify({
  name: 'x', ratio: '9:16', media: [], schemaVersion: 0,
  videoClips: [
    { id: 'c1', mediaId: 'm1', in: 0, out: 4, transition: 'dissolve', speed: 2, volume: 0.5, filter: 'vivid' },
    { id: 'c2', mediaId: 'm1', in: 4, out: 8, transition: null },
  ],
}));
p = parse(r);
ok(p.videoClips[0].transition.type === 'dissolve' && p.videoClips[0].transition.duration === 0.5, 'string transition -> { type, duration }');
ok(p.videoClips[0].speed === 2 && p.videoClips[0].volume === 0.5 && p.videoClips[0].filter === 'vivid', 'explicit clip values are kept, not overwritten');
ok(p.videoClips[1].transition === null, 'null transition stays null');
ok(p.width === 1080 && p.height === 1920, '9:16 ratio derives 1080x1920');

// 3. v1 passthrough: byte-identical, not "migrated".
const v1 = JSON.stringify({ name: 'new', schemaVersion: 1, media: [], videoClips: [], overlayClips: [], audioClips: [], stickerClips: [], effectClips: [], textClips: [], fps: 30, width: 1920, height: 1080, background: '#000000' });
r = migrateProject(v1);
ok(r.migrated === false && r.json === v1 && r.changes.length === 0, 'v1 passes through byte-identical');

// 4. Newer-than-this-build: left alone, flagged.
r = migrateProject(JSON.stringify({ name: 'future', schemaVersion: 99, media: [] }));
ok(r.migrated === false && r.newer === true && JSON.parse(r.json).schemaVersion === 99, 'future version left unchanged with newer:true');

// 5. Garbage and non-objects pass through unchanged (the caller decides).
r = migrateProject('not json at all');
ok(r.migrated === false && r.json === 'not json at all', 'unparseable input passes through');
r = migrateProject('[1,2,3]');
ok(r.migrated === false, 'non-object JSON passes through');

// 6. Idempotent: migrating twice equals migrating once.
const once = migrateProject(JSON.stringify({ name: 'old', media: [], videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 2 }] }));
const twice = migrateProject(once.json);
ok(twice.migrated === false && twice.json === once.json, 'migration is idempotent');

// 7. A v0 project with audio clips: audio clips get speed/volume/muted but no filter.
r = migrateProject(JSON.stringify({ name: 'a', media: [], audioClips: [{ id: 'a1', mediaId: 'm2', start: 0, in: 0, out: 5 }] }));
p = parse(r);
ok(p.audioClips[0].speed === 1 && p.audioClips[0].volume === 1 && p.audioClips[0].filter === undefined, 'audio clip: speed/volume/muted, no filter');

ok(PROJECT_SCHEMA_VERSION === 1, 'current schema version is 1');

console.log(failures ? `PROJECT-MIGRATIONS FAIL (${failures})` : 'PROJECT-MIGRATIONS OK');
process.exit(failures ? 1 : 0);
