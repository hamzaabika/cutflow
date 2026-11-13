// Project ZIP export (checklist #7): the manifest rewrites media paths to
// assets/…, dedupes by path, suffixes same-basename collisions, reports
// missing media instead of dropping it, and strips regenerable cache
// fields; the written archive is a valid zip whose bundled JSON resolves
// back through projectfile.resolveRelativeMedia. Usage: node scripts/test-project-zip.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import projectzip from '../electron/projectzip.cjs';
import projectfile from '../electron/projectfile.cjs';
import AdmZip from 'adm-zip';

const { buildZipManifest, writeProjectZip, cancelProjectZip } = projectzip;
const { resolveRelativeMedia } = projectfile;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutflow-zip-'));
const dirA = path.join(tmp, 'a');
const dirB = path.join(tmp, 'b');
fs.mkdirSync(dirA);
fs.mkdirSync(dirB);
// Same basename in two folders (collision → -2 suffix), one file used by
// two media entries (dedupe), one file that does not exist (missing).
const fileA = path.join(dirA, 'clip.mp4');
const fileB = path.join(dirB, 'clip.mp4');
fs.writeFileSync(fileA, crypto.randomBytes(1024));
fs.writeFileSync(fileB, crypto.randomBytes(2048));
const gone = path.join(tmp, 'gone.mp4');
const project = {
  name: 'My Project',
  width: 1080, height: 1920, fps: 30, ratio: '9:16',
  media: [
    { id: 'm1', type: 'video', path: fileA, name: 'clip.mp4', duration: 10, thumb: '/tmp/cache/t1.png', wave: '/tmp/cache/w1.json', proxy: '/tmp/cache/p1.mp4', lightProxy: '/tmp/cache/lp1.mp4', proxies: { '720': '/tmp/cache/x.mp4' } },
    { id: 'm2', type: 'video', path: fileA, name: 'clip.mp4 again', duration: 10 },
    { id: 'm3', type: 'video', path: fileB, name: 'clip.mp4 other', duration: 5 },
    { id: 'm4', type: 'video', path: gone, name: 'gone.mp4', duration: 3 },
  ],
  videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 10 }],
};

const manifest = buildZipManifest(project, 'My Project');
assert.equal(manifest.name, 'My Project');
assert.equal(manifest.jsonName, 'My Project.clipcraft.json');
assert.deepEqual(manifest.files.map((f) => f.dest), ['assets/clip.mp4', 'assets/clip-2.mp4']);
assert.equal(manifest.missing.length, 1);
assert.equal(manifest.missing[0].id, 'm4');
const bundled = JSON.parse(manifest.json);
assert.equal(bundled.media[0].path, 'assets/clip.mp4');
assert.equal(bundled.media[1].path, 'assets/clip.mp4'); // same file, deduped
assert.equal(bundled.media[2].path, 'assets/clip-2.mp4'); // same basename, suffixed
assert.equal(bundled.media[3].path, gone); // missing: original path kept
for (const f of ['thumb', 'wave', 'proxy', 'lightProxy', 'proxies']) assert.ok(!(f in bundled.media[0]), `${f} stripped`);
assert.equal(bundled.videoClips[0].mediaId, 'm1'); // clips untouched

// The written archive opens, holds the JSON + both files, and the bundled
// JSON's relative paths resolve against the folder it is unzipped into.
const outPath = path.join(tmp, 'My Project.zip');
const res = await writeProjectZip(project, 'My Project', outPath);
assert.equal(res.path, outPath);
assert.equal(res.files, 2);
assert.equal(res.missing.length, 1);
assert.ok(res.bytes > 0);
const zip = new AdmZip(outPath);
assert.deepEqual(zip.getEntries().map((e) => e.entryName).sort(), ['My Project.clipcraft.json', 'assets/clip-2.mp4', 'assets/clip.mp4']);
const inner = JSON.parse(zip.readAsText('My Project.clipcraft.json'));
assert.equal(inner.media[0].path, 'assets/clip.mp4');
const unzipDir = path.join(tmp, 'unzipped');
fs.mkdirSync(unzipDir);
zip.extractAllTo(unzipDir, true);
const resolved = JSON.parse(resolveRelativeMedia(JSON.stringify(inner), unzipDir));
assert.equal(resolved.media[0].path, path.join(unzipDir, 'assets', 'clip.mp4'));
assert.ok(fs.existsSync(resolved.media[0].path));
assert.equal(resolved.media[3].path, gone); // missing stays missing

// Cancel: a big random file keeps the stream busy; cancelling in the same
// tick aborts the archive and removes the partial file.
const big = path.join(tmp, 'big.mp4');
fs.writeFileSync(big, crypto.randomBytes(64 * 1024 * 1024));
const bigProject = { name: 'big', media: [{ id: 'b1', type: 'video', path: big, duration: 60 }], videoClips: [] };
const bigOut = path.join(tmp, 'big.zip');
const pending = writeProjectZip(bigProject, 'big', bigOut);
assert.equal(cancelProjectZip(), true);
const cancelled = await pending;
assert.equal(cancelled.canceled, true);
assert.ok(!fs.existsSync(bigOut));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('PROJECT ZIP OK');
