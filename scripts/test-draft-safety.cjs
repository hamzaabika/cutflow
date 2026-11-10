// Draft safety (electron/draftsafety.cjs + projectfile.cjs relink helpers): transactional
// project-file saves with rotating backups, crash simulation (torn temp write, truncated
// live file, crash between rotate and commit), read fallback (file -> backups -> autosave
// slot), invalid-save refusal, and the missing-media / folder-scan halves of relink.
// Usage: node scripts/test-draft-safety.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ds = require('../electron/draftsafety.cjs');
const pf = require('../electron/projectfile.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cc-draftsafety-'));
const proj = (name, extra = {}) => JSON.stringify({ id: 'p1', name, media: [], videoClips: [], ...extra });
const nameOf = (json) => JSON.parse(json).name;

// ---- Transactional writes + rotation -------------------------------------------
{
  const dir = tmp();
  const file = path.join(dir, 'film.clipcraft.json');

  ds.writeProjectTx(file, proj('v1'));
  assert.equal(nameOf(fs.readFileSync(file, 'utf8')), 'v1');
  assert.deepEqual(ds.backupPaths(file), []); // nothing to rotate on the first save

  ds.writeProjectTx(file, proj('v2'));
  assert.equal(nameOf(fs.readFileSync(file, 'utf8')), 'v2');
  assert.equal(nameOf(fs.readFileSync(ds.backupPath(file, 1), 'utf8')), 'v1');

  // Rotation is bounded: after 8 saves exactly MAX_BACKUPS backups exist, newest first.
  for (let i = 3; i <= 8; i += 1) ds.writeProjectTx(file, proj(`v${i}`));
  assert.equal(ds.backupPaths(file).length, ds.MAX_BACKUPS);
  assert.equal(nameOf(fs.readFileSync(file, 'utf8')), 'v8');
  assert.equal(nameOf(fs.readFileSync(ds.backupPath(file, 1), 'utf8')), 'v7');
  assert.equal(nameOf(fs.readFileSync(ds.backupPath(file, ds.MAX_BACKUPS), 'utf8')), 'v3');
  assert.ok(!fs.existsSync(`${file}.part`)); // no temp debris after a clean save

  // An invalid payload is refused BEFORE anything is touched.
  const before = fs.readFileSync(file, 'utf8');
  const bakBefore = fs.readFileSync(ds.backupPath(file, 1), 'utf8');
  assert.throws(() => ds.writeProjectTx(file, '{"id":"p1", torn'));
  assert.throws(() => ds.writeProjectTx(file, '[1,2,3]'));
  assert.throws(() => ds.writeProjectTx(file, ''));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.equal(fs.readFileSync(ds.backupPath(file, 1), 'utf8'), bakBefore);
  assert.ok(!fs.existsSync(`${file}.part`));
}

// ---- Crash simulation ------------------------------------------------------------
{
  const dir = tmp();
  const file = path.join(dir, 'crash.clipcraft.json');
  ds.writeProjectTx(file, proj('good-1'));
  ds.writeProjectTx(file, proj('good-2'));

  // Crash DURING a write: a torn .part file is left behind, the live file untouched.
  fs.writeFileSync(`${file}.part`, '{"id":"p1","name":"tor');
  let r = ds.readProjectWithFallback(file);
  assert.equal(r.recoveredFrom, null);
  assert.equal(nameOf(r.json), 'good-2');

  // The next successful save simply overwrites the stale temp file.
  ds.writeProjectTx(file, proj('good-3'));
  assert.equal(nameOf(fs.readFileSync(file, 'utf8')), 'good-3');
  assert.ok(!fs.existsSync(`${file}.part`));

  // Torn LIVE file (truncated mid-JSON, the classic kill-during-write state):
  // the reader falls back to the newest backup and says so.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 12));
  r = ds.readProjectWithFallback(file);
  assert.equal(r.recoveredFrom.kind, 'backup');
  assert.equal(r.recoveredFrom.path, ds.backupPath(file, 1));
  assert.equal(nameOf(r.json), 'good-2');
  assert.ok(r.recoveredFrom.savedAt > 0);

  // Crash BETWEEN rotate and commit: the live file never landed, .bak1 holds the
  // previous good state — recovery still yields a valid project.
  fs.unlinkSync(file);
  r = ds.readProjectWithFallback(file);
  assert.equal(r.recoveredFrom.kind, 'backup');
  assert.equal(nameOf(r.json), 'good-2');

  // Every on-disk copy corrupt -> the autosave slot is the last resort.
  for (const bak of ds.backupPaths(file)) fs.writeFileSync(bak, 'garbage{');
  r = ds.readProjectWithFallback(file, proj('from-slot'));
  assert.equal(r.recoveredFrom.kind, 'autosave');
  assert.equal(nameOf(r.json), 'from-slot');

  // Nothing readable anywhere -> corrupt (NOT missing: something was there).
  r = ds.readProjectWithFallback(file, '{also torn');
  assert.deepEqual(r, { corrupt: true });

  // A genuinely absent project reports missing, so callers keep their "file gone" UX.
  r = ds.readProjectWithFallback(path.join(dir, 'never-existed.clipcraft.json'));
  assert.deepEqual(r, { missing: true });
}

// ---- Missing media + folder scan (relink halves) ---------------------------------
{
  const dir = tmp();
  const realFile = path.join(dir, 'kept.mp4');
  fs.writeFileSync(realFile, 'x');
  const gone = path.join(dir, 'moved-away.mp4');
  const project = JSON.stringify({
    id: 'p9', name: 'Relink',
    media: [
      { id: 'm1', name: 'kept.mp4', path: realFile, type: 'video', duration: 12, width: 1920, height: 1080 },
      { id: 'm2', name: 'moved-away.mp4', path: gone, type: 'video', duration: 30, width: 1280, height: 720 },
      { id: 'm3', name: 'gone.mp3', path: path.join(dir, 'gone.mp3'), type: 'audio', duration: 5 },
      { id: 'm4', name: 'generated', path: '', type: 'audio' }, // pathless entries are not relinkable
    ],
    videoClips: [],
  });
  const missing = pf.findMissingMedia(project);
  assert.deepEqual(missing.map((m) => m.id), ['m2', 'm3']);
  assert.equal(missing[0].name, 'moved-away.mp4');
  assert.equal(missing[0].duration, 30);
  assert.deepEqual(pf.findMissingMedia('{torn'), []);

  // Folder scan: matches by basename anywhere below the picked folder (any case),
  // finds duplicates as separate candidates, ignores unrelated and hidden files.
  const lib = path.join(dir, 'library');
  fs.mkdirSync(path.join(lib, 'sub', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(lib, '.hidden'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'sub', 'Moved-Away.mp4'), 'a');
  fs.writeFileSync(path.join(lib, 'sub', 'deep', 'moved-away.mp4'), 'b');
  fs.writeFileSync(path.join(lib, 'gone.mp3'), 'c');
  fs.writeFileSync(path.join(lib, 'unrelated.mp4'), 'd');
  fs.writeFileSync(path.join(lib, '.hidden', 'gone.mp3'), 'e');
  const found = pf.scanMediaFolder(lib, ['moved-away.mp4', 'gone.mp3', 'absent.wav']);
  assert.equal(found.get('moved-away.mp4').length, 2); // ambiguous until verified
  assert.deepEqual(found.get('gone.mp3'), [path.join(lib, 'gone.mp3')]); // hidden copy not offered
  assert.equal(found.has('absent.wav'), false);
  assert.equal(found.has('unrelated.mp4'), false);
}

console.log('test-draft-safety: all assertions passed');
