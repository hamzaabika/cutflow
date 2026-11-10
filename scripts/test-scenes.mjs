// Scene detection (Sprint 10): electron/scenes.cjs runs the bundled
// FFmpeg's scene-change detection over a clip's picture; a fixture with
// known hard cuts must report them at the right times, a gradual fade must
// report none, and the store's splitAtTimes action turns the reported cuts
// into real splits (the path the clip menu's "Split at scenes" dispatches).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ffmpegPath } = require('../electron/ffmpeg.cjs');
const { detectScenes, parseSceneLog } = require('../electron/scenes.cjs');
const { emptyProject, historyReducer, videoLayout } = await import('../src/store.js');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b, tol = 0.2) => Math.abs(a - b) <= tol;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-scenes-'));
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);

// --- Parser ------------------------------------------------------------------
{
  const log = [
    'frame:0    pts:0       pts_time:0',
    'lavfi.scene_score=0.001200',
    'frame:60   pts:5120    pts_time:2.000000',
    'lavfi.scene_score=1.000000',
    'frame:120  pts:10240   pts_time:4.000000',
    'lavfi.scene_score=0.875000',
  ].join('\n');
  const cuts = parseSceneLog(log);
  ok(cuts.length === 2 && near(cuts[0].time, 2, 0.001) && near(cuts[1].time, 4, 0.001) && near(cuts[0].score, 1, 0.001),
    'the metadata log parses into timed cuts with scores (the first frame is not a cut)');
}

// --- Fixture with known hard cuts ---------------------------------------------
const hard = path.join(dir, 'hard.mp4');
gen(['-f', 'lavfi', '-i', 'color=black:size=320x180:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'color=white:size=320x180:rate=30:duration=2',
  '-f', 'lavfi', '-i', 'color=red:size=320x180:rate=30:duration=2',
  '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-crf', '18', hard]);

const cuts = await detectScenes(hard, { threshold: 0.3 });
ok(Array.isArray(cuts), 'detection runs on the fixture');
ok(cuts.length === 2, `two cuts found (got ${cuts.length}: ${cuts.map((c) => c.time.toFixed(2)).join(', ')})`);
ok(cuts.length === 2 && near(cuts[0].time, 2) && near(cuts[1].time, 4), 'the cuts land on the known boundaries (2 s and 4 s)');

// --- A gradual fade is not a scene ---------------------------------------------
const fade = path.join(dir, 'fade.mp4');
gen(['-f', 'lavfi', '-i', 'color=black:size=320x180:rate=30:duration=5',
  '-f', 'lavfi', '-i', 'color=white:size=320x180:rate=30:duration=5',
  '-filter_complex', '[0][1]xfade=transition=fade:duration=2:offset=2', '-c:v', 'libx264', '-crf', '18', fade]);
const fadeCuts = await detectScenes(fade, { threshold: 0.3 });
ok(fadeCuts.length === 0, `a 2 s crossfade reports no cuts at the default threshold (got ${fadeCuts.length})`);

// --- The cuts become real splits ------------------------------------------------
{
  const p = {
    ...emptyProject(),
    media: [{ id: 'm1', path: hard, type: 'video', duration: 6, width: 320, height: 180, hasAudio: false }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
  };
  const st = historyReducer({ past: [], present: p, future: [] },
    { type: 'splitAtTimes', track: 'video', id: 'v1', times: cuts.map((c) => c.time), newIds: cuts.map((_, i) => `s${i}`) });
  const lay = videoLayout(st.present.videoClips);
  ok(lay.length === 3, `the clip splits into three pieces (got ${lay.length})`);
  ok(lay.length === 3 && near(lay[1].start, 2) && near(lay[2].start, 4), 'piece boundaries sit on the detected cuts');
  ok(lay.length === 3 && lay.every((l) => Math.abs((l.clip.out - l.clip.in) - (l.end - l.start)) < 0.05), 'each piece keeps its source span');
  const undone = historyReducer(st, { type: 'undo' });
  ok(undone.present.videoClips.length === 1, 'one undo restores the uncut clip');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nSCENES OK');
process.exit(fails.length ? 1 : 0);
