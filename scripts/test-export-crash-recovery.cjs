// FB-19 (P1-27) — force-close mid-export end-to-end recovery.
// A crash (SIGKILL) in the middle of an export must leave a recoverable
// project: the project file is never overwritten unsafely, the autosave
// slot survives, and the previous version still opens (parses + migrates
// cleanly). The partial output file must not masquerade as a finished
// export either: it is absent, or it probes as incomplete.
// The export runs in a child process (scripts/helpers/export-crash-child.cjs)
// so the parent can kill -9 it the way a real force-close kills the app.
// Usage: TMPDIR=~/workspace/.tmp-battery node scripts/test-export-crash-recovery.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');
const { migrateProject } = require('../electron/projectfile.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-crashrec-'));
  const src = path.join(dir, 'cam.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', src]);
  const m = { id: 'm1', path: src, name: 'cam.mp4', ...(await probe(src)) };
  const project = {
    name: 'crash-recovery', ratio: '16:9', width: 320, height: 180, fps: 30, background: '#000000', media: [m],
    videoClips: [{ id: 'c1', mediaId: 'm1', in: 0, out: 20, filter: 'none', speed: 1, chromaKey: null, chromaColor: '#00ff00', mask: null, maskFeather: 0, crop: null, transform: null }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  };
  const projectFile = path.join(dir, 'project.clipcraft.json');
  const slotFile = path.join(dir, 'autosave-slot.json');
  fs.writeFileSync(projectFile, JSON.stringify(project, null, 2));
  fs.writeFileSync(slotFile, JSON.stringify(project, null, 2));
  const projectHashBefore = sha(projectFile);
  const slotHashBefore = sha(slotFile);
  const outFile = path.join(dir, 'export.mp4');

  const child = spawn(process.execPath, [path.join(__dirname, 'helpers', 'export-crash-child.cjs'), projectFile, outFile],
    { cwd: path.join(__dirname, '..'), env: { ...process.env, TMPDIR: dir }, stdio: 'pipe' });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d; });
  child.stderr.on('data', (d) => { childOut += d; });
  const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));

  // Wait until the export is visibly in flight (output file growing), then kill -9.
  let killedMidFlight = false;
  for (let i = 0; i < 300; i++) {
    await sleep(200);
    try {
      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50000) { killedMidFlight = true; break; }
    } catch { /* not yet */ }
    if (child.exitCode !== null) break; // export finished before we could kill it
  }
  let exit = null;
  if (killedMidFlight) {
    child.kill('SIGKILL');
    exit = await exited;
  } else {
    exit = await exited;
  }
  ok(killedMidFlight, 'export was in flight when killed (output file growing)');
  ok(exit.signal === 'SIGKILL', `child died by SIGKILL, not a clean exit (got code=${exit.code} signal=${exit.signal})`);

  // 1. The project file was never touched by the killed export.
  ok(fs.existsSync(projectFile) && sha(projectFile) === projectHashBefore, 'project file byte-identical after force-close (no unsafe overwrite)');
  // 2. The autosave slot survives too.
  ok(fs.existsSync(slotFile) && sha(slotFile) === slotHashBefore, 'autosave slot byte-identical after force-close');
  // 3. The previous version still opens: parses, migrates, keeps its clips.
  let opened = null;
  try { opened = JSON.parse(fs.readFileSync(projectFile, 'utf8')); } catch { opened = null; }
  ok(opened && opened.videoClips.length === 1 && opened.videoClips[0].out === 20, 'project still parses with its clips intact');
  const mig = migrateProject(fs.readFileSync(projectFile, 'utf8'));
  ok(!mig.newer && JSON.parse(mig.json).videoClips.length === 1, 'project migrates cleanly under the current schema');
  // 4. The partial output does not masquerade as a finished export.
  if (!fs.existsSync(outFile)) {
    ok(true, 'no output file left behind');
  } else {
    let dur = null;
    try { dur = (await probe(outFile)).duration; } catch { dur = null; }
    ok(dur === null || dur < 19, `partial output probes as incomplete (duration=${dur}) — never a finished export`);
    console.log(`  partial output on disk: ${Math.round(fs.statSync(outFile).size / 1024)} KB, probed duration ${dur}`);
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `EXPORT-CRASH-RECOVERY FAIL (${failures})` : 'EXPORT-CRASH-RECOVERY OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('EXPORT-CRASH-RECOVERY FAIL', e); process.exit(1); });
