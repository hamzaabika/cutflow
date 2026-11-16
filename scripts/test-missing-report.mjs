// Packaged-project missing-asset report (P1-54): the open-time report pieces.
//   - missingClipRefs (src/store.js): which timeline clips use each missing file.
//   - isPackagedProject (electron/projectfile.cjs): the relative-path signature
//     of a project that came from a ZIP package.
// The dialog wiring (packaged context, persistent note after Skip, bypass
// gaps) is verified live in the app; see verify-missing-report.mjs.
// Usage: node scripts/test-missing-report.mjs
import assert from 'node:assert/strict';
import { missingClipRefs } from '../src/store.js';
import { isPackagedProject, findMissingMedia, resolveRelativeMedia } from '../electron/projectfile.cjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? '  ok' : '  FAIL'}  ${msg}`); if (!ok) failures++; };

// ---- missingClipRefs -------------------------------------------------------
const project = {
  videoClips: [
    { id: 'v1', mediaId: 'm1', in: 0, out: 4, speed: 1 },
    { id: 'v2', mediaId: 'm2', in: 1, out: 3, speed: 1, transition: { type: 'fade', duration: 0.5 } },
    { id: 'g1', gap: true },
    { id: 'v3', mediaId: 'm1', in: 0, out: 2, speed: 1 },
  ],
  overlayClips: [{ id: 'o1', mediaId: 'm3', start: 1, duration: 2 }],
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 0.5, duration: 3 }],
  textClips: [],
};
const refs = missingClipRefs(project, ['m1', 'm3', 'mUnused', 'mGhost']);
check(Array.isArray(refs.m1) && refs.m1.length === 3, 'm1 is used by 3 clips (2 video + 1 audio)');
const v1 = refs.m1.find((r) => r.id === 'v1');
check(v1 && v1.track === 'video' && v1.start === 0 && v1.end === 4, 'video ref carries timeline start/end (v1: 0–4)');
const v2 = refs.m1.find((r) => r.id === 'v3');
check(v2 && v2.start === 5.5 && v2.end === 7.5, 'video ref after a 0.5 s transition + zero-length gap starts at 5.5 (v3: 5.5–7.5)');
const a1 = refs.m1.find((r) => r.id === 'a1');
check(a1 && a1.track === 'audio' && a1.start === 0.5 && a1.end === 3.5, 'audio ref carries start/duration (a1: 0.5–3.5)');
check(refs.m3?.length === 1 && refs.m3[0].track === 'overlay' && refs.m3[0].start === 1 && refs.m3[0].end === 3, 'overlay ref (o1: 1–3)');
check(!('mUnused' in refs) && !('mGhost' in refs), 'unused media and unknown ids get no refs entry');
check(Object.keys(missingClipRefs(project, [])).length === 0, 'empty missing list returns no refs');
check(Object.keys(missingClipRefs(null, ['m1'])).length === 0, 'null project returns no refs');

// ---- isPackagedProject ------------------------------------------------------
const pkg = JSON.stringify({ media: [
  { id: 'a', path: 'assets/clip.mp4' },
  { id: 'b', path: '/home/u/clip2.mp4' },
] });
const local = JSON.stringify({ media: [{ id: 'a', path: '/home/u/clip.mp4' }] });
check(isPackagedProject(pkg) === true, 'a relative assets/ path marks the project packaged');
check(isPackagedProject(local) === false, 'all-absolute paths are not packaged');
check(isPackagedProject(JSON.stringify({ media: [] })) === false, 'no media is not packaged');
check(isPackagedProject('not json') === false, 'unparseable JSON is not packaged');

// ---- the packaged round-trip at the projectfile level ----------------------
// A ZIP-bundled JSON (relative assets/) unzipped to a folder missing one
// asset: resolveRelativeMedia points the present one at the folder, and
// findMissingMedia reports only the absent one — the exact input the
// open-time report renders.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-missing-'));
fs.mkdirSync(path.join(dir, 'assets'));
fs.writeFileSync(path.join(dir, 'assets', 'here.mp4'), 'x');
const bundled = JSON.stringify({ media: [
  { id: 'm1', name: 'here.mp4', path: 'assets/here.mp4', type: 'video', duration: 2 },
  { id: 'm2', name: 'gone.mp4', path: 'assets/gone.mp4', type: 'video', duration: 2 },
  { id: 'm3', name: 'pool.mp4', path: 'assets/pool.mp4', type: 'video', duration: 2 },
] });
check(isPackagedProject(bundled) === true, 'bundled JSON is packaged before resolving');
const resolved = JSON.parse(resolveRelativeMedia(bundled, dir));
check(resolved.media[0].path === path.join(dir, 'assets', 'here.mp4'), 'present asset resolves against the package folder');
const missing = findMissingMedia(JSON.stringify(resolved));
check(missing.length === 2 && missing.some((m) => m.id === 'm2') && missing.some((m) => m.id === 'm3'), 'findMissingMedia reports the 2 absent assets (m2, m3)');
const refs2 = missingClipRefs({ videoClips: [{ id: 'v1', mediaId: 'm2', in: 0, out: 2, speed: 1 }], overlayClips: [], audioClips: [] }, missing.map((m) => m.id));
check(refs2.m2?.length === 1 && !('m3' in refs2), 'm2 breaks 1 clip; m3 (unused pool item) breaks none');

console.log(failures === 0 ? '\nMISSING REPORT OK' : `\nMISSING REPORT FAILURES: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
