// Regression test for the ZIP export failing in the app while the ESM
// suite stayed green (2026-11-14): archiver 8 is pure ESM, so a top-level
// require('archiver') throws ERR_REQUIRE_ESM on the app's Node
// (Electron 33 / Node 20), which has no require(esm). This file is CJS
// and loads projectzip.cjs with require() — run it with require(esm)
// disabled so it reproduces the app's loader exactly:
//   node --no-experimental-require-module scripts/test-projectzip-require.cjs
// With the old top-level require the load itself throws; with the fix
// (dynamic import inside writeProjectZip) the module loads and a real
// .zip is written.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectzip = require('../electron/projectzip.cjs');
const { buildZipManifest, writeProjectZip } = projectzip;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cutflow-zip-req-'));
  const clip = path.join(tmp, 'clip.mp4');
  fs.writeFileSync(clip, Buffer.alloc(2048, 7));
  const project = {
    name: 'Req Test', width: 1080, height: 1920, fps: 30, ratio: '9:16',
    media: [{ id: 'm1', type: 'video', path: clip, name: 'clip.mp4', duration: 5 }],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 5 }],
  };
  const manifest = buildZipManifest(project, project.name);
  assert.equal(manifest.files.length, 1, 'one file in manifest');
  assert.equal(manifest.missing.length, 0, 'nothing missing');
  const outPath = path.join(tmp, 'Req Test.zip');
  const res = await writeProjectZip(project, project.name, outPath, null);
  assert.ok(res.path, 'write returns a path');
  assert.ok(res.bytes > 100, `zip has real content (${res.bytes} bytes)`);
  const magic = fs.readFileSync(outPath).subarray(0, 2).toString('latin1');
  assert.equal(magic, 'PK', 'output starts with the ZIP magic');
  console.log('PROJECT ZIP REQUIRE OK —', res.bytes, 'bytes at', outPath);
})().catch((e) => { console.error('PROJECT ZIP REQUIRE FAIL:', e.message); process.exit(1); });
