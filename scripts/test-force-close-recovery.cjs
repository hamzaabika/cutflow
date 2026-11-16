// P1-27 — force-close recovery tests: kill the app mid-edit (SIGKILL) and
// verify autosave recovery.
//
// Part A (store level, deterministic): the autosave store
// (electron/autosave.cjs) must survive a crash at every point — a torn
// index, a torn slot write, a missing index — and always hand back the last
// good slot, never a half-written one. Writes are tmp-file + rename, so a
// kill mid-write leaves either the old slot or the new one, never a torn
// slot file.
//
// Part B (app level, live): launch the real dev app (isolated with a fresh
// HOME, so its autosave dir is <smoke>/home/.config/ClipCraft/autosave),
// load a project, make an edit, SIGKILL the electron process, and verify
// (1) the autosave slot on disk holds the edit and (2) a relaunched app
// lists the slot and reads the edit back through the same IPC the Home
// screen uses. CDP port 9244, verified to belong to this stream's app
// (the page URL must contain this worktree's path) before driving it.
//
// Usage: node scripts/test-force-close-recovery.cjs
//   (run after `npm run build`; needs Xvfb :99 and ffmpeg on PATH)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const store = require('../electron/autosave.cjs');
const { ffmpegPath, probe } = require('../electron/ffmpeg.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = 9261; // unique CDP port for this stream (A: 9243, C: 9244, others nearby — verified free before use; waitTarget also refuses a foreign owner)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Part A — store level
// ---------------------------------------------------------------------------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-forceclose-'));
  const rec = (id, title, updatedAt, extra = {}) => ({
    id, title, file: null, ratio: '16:9', thumb: null, updatedAt,
    projectJson: JSON.stringify({ id, name: title, media: [], videoClips: [] }),
    ...extra,
  });
  store.writeSlot(root, rec('p1', 'Alpha', 1000));
  store.writeSlot(root, rec('p2', 'Beta', 2000));

  // A kill that lands while the index is being rewritten: delete the index.
  fs.rmSync(path.join(root, 'index.json'));
  assert.deepEqual(store.listSlots(root).map((x) => x.id), ['p2', 'p1'], 'index rebuilds from slot files after loss');
  assert.equal(store.readSlot(root, 'p1').project.name, 'Alpha');

  // A torn index (garbage bytes, as a kill mid-rename could leave behind).
  fs.writeFileSync(path.join(root, 'index.json'), '{torn', 'utf8');
  assert.deepEqual(store.listSlots(root).map((x) => x.id), ['p2', 'p1'], 'corrupt index rebuilds from slot files');
  assert.equal(store.readSlot(root, 'p2').project.name, 'Beta');

  // A torn slot write: a leftover .part tmp file + a corrupt slot file.
  // Neither may be returned or listed; the good slot must survive.
  fs.writeFileSync(path.join(root, 'p1.json.part'), '{"id":"p1","title":"Half', 'utf8');
  fs.writeFileSync(path.join(root, 'bad.json'), '{nope', 'utf8');
  assert.equal(store.readSlot(root, 'p1').project.name, 'Alpha', 'torn .part is ignored, last good slot survives');
  assert.ok(!store.listSlots(root).some((x) => x.id === 'bad'), 'corrupt slot file is skipped, never listed');
  assert.equal(store.readSlot(root, 'bad'), null);

  // A write that lands cleanly leaves no .part behind and the slot parses.
  store.writeSlot(root, rec('p1', 'Alpha II', 3000));
  assert.ok(!fs.existsSync(path.join(root, 'p1.json.part')), 'no .part left after a clean write');
  assert.equal(store.readSlot(root, 'p1').project.name, 'Alpha II');
  assert.deepEqual(store.listSlots(root).map((x) => x.id), ['p1', 'p2']);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('Part A (store-level crash safety): PASS');
}

// ---------------------------------------------------------------------------
// Part B — app level: SIGKILL mid-edit, slot on disk, relaunch recovery
// ---------------------------------------------------------------------------
const electronBin = [
  // Renamed binary first: sibling streams' cleanups run bare
  // `pkill -x electron`, which SIGTERMs every stock-`electron` process
  // (exitCode 15). A hardlinked copy renamed cutflow-gapb does not match.
  path.join(os.homedir(), 'workspace', '.tmp-battery', 'electron-gapb-dist', 'cutflow-gapb'),
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  path.join(os.homedir(), 'workspace', 'electron-dist', 'electron'),
].find((p) => fs.existsSync(p));
assert(electronBin, 'electron binary not found');
// NOTE: this test deliberately does NOT set FVE_SMOKE. With FVE_SMOKE set,
// electron/smoke.cjs runs its default flow on launch (clicks .home-create,
// reads <dir>/project.json, exports, app.quit()) — the app would quit
// under the test. Like scripts/test-p2-ui-live.mjs, the app is isolated
// with a fresh HOME instead, so its userData (and autosave dir) lands
// under <dir>/home/.config/ClipCraft/autosave.
const slotDirFor = (dir) => path.join(dir, 'home', '.config', 'ClipCraft', 'autosave');

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

async function waitTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      // The port must belong to THIS stream's app: sibling streams run their
      // own dev apps on nearby ports, and driving the wrong app would load
      // the fixture into their session and read their slots. The page URL
      // carries this worktree's path, so it identifies the owner.
      if (page) {
        // Was a hard-coded '.tmp-gap-b' (gap-b stream worktree); on the
        // merged tree the app serves from this repo's dist/, so match ROOT.
        assert(page.url.includes(ROOT), `CDP port ${PORT} belongs to another app (${page.url}) — refusing to drive it`);
        return page;
      }
    } catch (e) {
      if (/belongs to another app/.test(e.message)) throw e;
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

function launch(homeDir, logPath) {
  const env = {
    ...process.env, HOME: homeDir, DISPLAY: ':99',
    TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-battery'),
    VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
    LIBGL_ALWAYS_SOFTWARE: '1',
  };
  delete env.FVE_SMOKE;
  delete env.FVE_SMOKE_MODE;
  const child = spawn(electronBin,
    ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox',
     '--disable-accelerated-video-decode', '--disable-accelerated-video-encode',
     '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
     `--remote-debugging-port=${PORT}`],
    { cwd: ROOT, env, stdio: 'pipe', detached: true });
  const log = fs.createWriteStream(logPath, { flags: 'a' });
  child.stderr.on('data', (d) => log.write(d));
  child.stdout.on('data', (d) => log.write(d));
  return child;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-forceclose-'));
  const homeDir = path.join(dir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  const clip = path.join(dir, 'clip.mp4');
  execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=30:duration=3', '-pix_fmt', 'yuv420p', clip]);
  const info = await probe(clip);
  const project = {
    id: 'p27kill', name: 'Force Close Test', ratio: '16:9', resolution: 720,
    width: 320, height: 180, fps: 30, background: '#000000',
    media: [{ id: 'm1', path: clip, name: 'clip.mp4', ...info }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    overlayClips: [], textClips: [], audioClips: [], stickerClips: [], effectClips: [],
  };
  const slotFile = path.join(slotDirFor(dir), 'p27kill.json');

  // --- Run 1: load, edit, SIGKILL -----------------------------------------
  let child = launch(homeDir, path.join(dir, 'app-run1.log'));
  try {
    const page = await waitTarget();
    const cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    const ev = async (expr) => {
      const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
      return r.result.value;
    };
    for (let i = 0; i < 60; i++) {
      if (await ev('!!window.__fve')) break;
      await sleep(500);
    }
    assert(await ev('!!window.__fve'), '__fve harness present');
    await ev(`window.__fve.load(${JSON.stringify(project)})`);
    await sleep(3000); // slot debounce is 1000 ms after the last change
    // The mid-edit change: volume 1 -> 0.42 on the only clip.
    await ev(`window.__fve.dispatch({type:'update', track:'video', id:'v1', patch:{volume:0.42}})`);
    await sleep(3000); // let the debounced slot write land
    assert(fs.existsSync(slotFile), 'slot file written before the kill');
    // Force-close: SIGKILL to the whole process group of THIS app only.
    process.kill(-child.pid, 'SIGKILL');
    await (child.exitCode !== null && child.signalCode !== null
      ? Promise.resolve()
      : new Promise((r) => child.on('exit', r)));
    cdp.close();
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
  }

  // --- On disk: the slot must hold the edit -------------------------------
  const slot = JSON.parse(fs.readFileSync(slotFile, 'utf8'));
  assert.equal(slot.id, 'p27kill');
  assert.equal(slot.project.name, 'Force Close Test');
  assert.equal(slot.project.videoClips[0].volume, 0.42, 'slot on disk holds the mid-edit change');

  // --- Run 2: relaunch, Home must list the slot and read the edit --------
  child = launch(homeDir, path.join(dir, 'app-run2.log'));
  try {
    const page = await waitTarget();
    const cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    const ev = async (expr) => {
      const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails)}`);
      return r.result.value;
    };
    for (let i = 0; i < 60; i++) {
      if (await ev('!!window.__fve')) break;
      await sleep(500);
    }
    const list = await ev('window.api.slotList()');
    assert(Array.isArray(list) && list.some((x) => x.id === 'p27kill'), 'relaunched app lists the killed project in its slots');
    const recovered = await ev(`window.api.slotRead('p27kill')`);
    assert.equal(recovered?.project?.videoClips?.[0]?.volume, 0.42, 'relaunched app reads the edit back from the slot');
    cdp.close();
    child.kill('SIGTERM');
    await Promise.race([
      child.exitCode !== null ? Promise.resolve() : new Promise((r) => child.on('exit', r)),
      sleep(10000),
    ]);
  } finally {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Part B (app-level SIGKILL + relaunch recovery): PASS');
  console.log('test-force-close-recovery: PASS');
})().catch((e) => { console.error('test-force-close-recovery: FAIL', e); process.exit(1); });
