// Gap-build C live verification: boots the real app (Xvfb, fresh profile) and
// proves the new Stream C work in the running editor —
//   * Graphics section lists 10 templates; clicking Progress Ring adds one
//     grouped clip (one undo step removes it again)
//   * the new text anims / transitions / effects appear in their browsers
//   * the preview text layer actually paints and moves (masked reveal, ring,
//     counter) between two playhead positions
//   * hover scrub swaps a video thumb to the frame under the pointer + a time
//   * a real export of a project carrying a graphic + new anim + new
//     transition + new effect writes frames that differ across the cut
// Results are written to results.json after every check (stdout can be
// truncated by the harness — the file is the record). The renderer under
// swiftshader is SLOW (~1 s per evaluate, innerText far worse), so this
// driver uses textContent, never innerText, waits with `until` instead of
// fixed sleeps, and polls the export FILE on disk rather than the DOM while
// ffmpeg runs.
// Run AFTER `npm run build`:  node scripts/test-gapc-live.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = Number(process.env.GAPC_CDP_PORT || 9251); // 2026-11-15: Stream A took 9243 after the 17:40 pkill incident; 9244 was ours until Stream E claimed it (~18:57) — now 9251.
const CDP_TIMEOUT = 120000;
const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;
const { graphicTemplateClips } = await import('../src/graphics/catalog.js');

const SCRATCH = '/home/hatch/workspace/.tmp-gap-c-live';
const OUTDIR = path.join(SCRATCH, 'out');
for (const d of [SCRATCH, OUTDIR, path.join(SCRATCH, 'home'), path.join(SCRATCH, 'tmp')]) fs.mkdirSync(d, { recursive: true });
const outFile = path.join(OUTDIR, 'ui-export.mp4');
const resultsPath = path.join(SCRATCH, 'results.json');

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond, extra]);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Source media ------------------------------------------------------------
const clipA = path.join(SCRATCH, 'clipA.mp4');
const clipB = path.join(SCRATCH, 'clipB.mp4');
if (!fs.existsSync(clipA)) execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipA]);
if (!fs.existsSync(clipB)) execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB]);
const mA = await ff.probe(clipA);
const mB = await ff.probe(clipB);
const sprite = path.join(SCRATCH, 'sprite.jpg');
if (!fs.existsSync(sprite)) execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', clipA, '-vf', 'fps=10,scale=160:90,tile=10x1', '-frames:v', '1', sprite]);

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
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, CDP_TIMEOUT);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}
async function waitTarget() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

const ELECTRON = '/home/hatch/workspace/.tmp-gap-c-live/electron-gapc-dist/cutflow-gapc';
// 2026-11-15: our own copy of the Electron dist with the binary renamed
// cutflow-gapc. The documented rig cleanup `pkill -x electron` matches the
// process name — launching the stock `electron` binary got every one of our
// apps SIGTERMed by sibling streams' cleanups (runs 1-6 + idle tests, all
// exitCode 15), while the siblings' cutflow-* binaries were immune.
const env = {
  ...process.env, HOME: path.join(SCRATCH, 'home'), DISPLAY: ':99',
  FVE_EXPORT_TARGET: OUTDIR, TMPDIR: path.join(SCRATCH, 'tmp'),
  VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES || '/home/hatch/workspace/vulkan/lvp_icd.json',
};
// The port must be free: a stale electron from an earlier run (or a sibling
// stream) answering /json/list would hand us the WRONG app.
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (r.ok) throw new Error(`CDP port ${PORT} already answers — refusing to drive a foreign app`);
} catch (e) { if (e.message.includes('already answers')) throw e; /* free */ }
const child = spawn(ELECTRON,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} } };
process.on('exit', kill);

const shotDir = path.join(SCRATCH, 'shots');
fs.mkdirSync(shotDir, { recursive: true });
let failed = false;
try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const evFire = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: false, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  // Screenshots are diagnostic evidence only — under swiftshader the
  // compositor can stall for minutes on a 1920x1080 capture (run 7 lost the
  // whole verification to a 120 s screenshot timeout), so a slow capture is
  // skipped, never fatal.
  const shot = async (name) => {
    try {
      const { data } = await Promise.race([
        cdp.call('Page.captureScreenshot', { format: 'png' }),
        sleep(25000).then(() => { throw new Error('screenshot slow — skipped'); }),
      ]);
      fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
    } catch (e) { console.log(`[shot] ${name}: ${e.message}`); }
  };
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(1000); }
    return false;
  };
  const textClips = async () => (await ev(`window.__fve.exportData().project.textClips`)) || [];

  await until(`!!window.__fve`, 60000);
  check('app boots', true);
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 120000));
  await until(`!!window.__fve`, 30000);
  await ev(`(() => { const b = document.querySelector('button[aria-label="Skip tour"]') || [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) b.click(); return !!b; })()`).catch(() => {});
  await sleep(1500);

  // ---- Graphics: the Text tab lists 10 templates; a click adds a group ----
  // Scope to the GRAPHICS-template group: text/catalog.js also has a
  // 'Graphics' category (10 text templates, incl. its own 'Progress Ring'
  // and 'Timer Countdown'), and it renders BEFORE the graphics group, so a
  // document-wide title search counts 11 tiles and clicks the text
  // template (graphic.kind 'ring', no groupId) instead of the graphic
  // template (graphic.kind 'progress-ring', groupId set). The graphics
  // group is the one holding a tile titled 'Countdown Timer' — a name
  // only src/graphics/catalog.js has.
  await ev(`window.__fve.tab('text')`);
  const gfxReady = await until(`[...document.querySelectorAll('.lib-group-name')].some((e) => e.textContent.trim().startsWith('Graphics'))`, 60000);
  const gfxListed = await ev(`(() => {
    const groups = [...document.querySelectorAll('.lib-group-name')].map((e) => e.textContent.trim());
    const g = [...document.querySelectorAll('.lib-group')].find((el) => [...el.querySelectorAll('.tpl-btn')].some((b) => (b.getAttribute('title') || '').startsWith('Countdown Timer')));
    const tiles = g ? [...g.querySelectorAll('.tpl-btn')].map((b) => b.getAttribute('title') || '') : [];
    return { groups, tiles: tiles.filter((t) => /Progress Ring|Number Counter|Countdown Timer|Split Screen|Cinematic|Brand Endcard|Stroke Draw|Progress Bar|Pointer Highlight|Kinetic Dot/.test(t)) };
  })()`);
  check('Graphics section lists 10 templates', gfxReady && gfxListed.groups.some((g) => g.startsWith('Graphics · 10')) && gfxListed.tiles.length === 10, JSON.stringify(gfxListed.groups) + ' tiles=' + gfxListed.tiles.length);
  const before = (await textClips()).length;
  await ev(`(() => { const g = [...document.querySelectorAll('.lib-group')].find((el) => [...el.querySelectorAll('.tpl-btn')].some((b) => (b.getAttribute('title') || '').startsWith('Countdown Timer'))); const b = g && [...g.querySelectorAll('.tpl-btn')].find((x) => (x.getAttribute('title') || '').startsWith('Progress Ring')); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  const after = await textClips();
  const ring = after.find((c) => c.graphic && c.graphic.kind === 'progress-ring');
  check('clicking Progress Ring adds a grouped clip', after.length === before + 1 && !!ring && !!ring.groupId, `clips ${before} -> ${after.length}`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await sleep(1000);
  check('one undo removes the whole graphic group', (await textClips()).length === before);
  await shot('gapc-graphics-tile.png');

  // ---- Browsers list the new transitions / effects (textContent: no layout) -
  await ev(`window.__fve.tab('transitions')`);
  await sleep(1500);
  const trText = await ev(`document.body.textContent`);
  check('new transitions listed', ['Smooth Push Up', 'Smooth Push Down', 'Parallax Zoom', 'Perspective Push', 'Motion Match Blur', 'Signal Line Cut'].every((n) => trText.includes(n)));
  await ev(`window.__fve.tab('effects')`);
  await sleep(1500);
  const fxText = await ev(`document.body.textContent`);
  check('new effects listed', fxText.includes('Gentle Heat Haze') && fxText.includes('Motion Echo'));

  // ---- Full project: graphic + new anims + new transition + new effect -----
  const ringClips = graphicTemplateClips('progress-ring', 0.5);
  const project = {
    name: 'gapc-live', ratio: '16:9', resolution: 360, width: 640, height: 360, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clipA, name: 'clipA.mp4', type: 'video', duration: mA.duration, width: mA.width, height: mA.height, hasAudio: true },
      { id: 'm1', path: clipB, name: 'clipB.mp4', type: 'video', duration: mB.duration, width: mB.width, height: mB.height, hasAudio: true },
      { id: 'm2', path: clipA, name: 'scrub.mp4', type: 'video', duration: mA.duration, width: mA.width, height: mA.height, hasAudio: true, thumb: sprite, thumbCount: 10, thumbW: 160, thumbH: 90 },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_heathaze'], transition: null },
      { id: 'v2', mediaId: 'm1', in: 0, out: 2, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_motionecho'], transition: { type: 'fx_signalline', duration: 0.5 } },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      ...ringClips,
      { id: 't-mask', text: 'MASKED LINE', start: 0.5, duration: 2, y: 0.35, size: 32, color: '#ffffff', animIn: { id: 'maskedLineReveal', dur: 0.9 }, animOut: { id: 'charScatter', dur: 0.9 }, animLoop: { id: 'lightsweep', speed: 1 } },
      { id: 't-sweep', text: 'LIGHT SWEEP', start: 0.5, duration: 2, y: 0.65, size: 32, color: '#ffffff', animIn: { id: 'lightSweepReveal', dur: 0.9 }, animLoop: { id: 'typeOsc', speed: 1 } },
    ],
  };
  await evFire(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(2000);

  // ---- Preview text layer paints and moves ---------------------------------
  const layerStats = async (t) => ev(`(async () => {
    window.__fve.seek(${t});
    await new Promise((r) => setTimeout(r, 500));
    const cv = document.querySelector('canvas.text-layer');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let painted = 0, sum = 0;
    for (let i = 3; i < d.length; i += 16) { if (d[i] > 20) { painted += 1; sum += d[i]; } }
    return { painted, sum, w: cv.width, h: cv.height };
  })()`);
  const s06 = await layerStats(0.6);
  const s16 = await layerStats(1.6);
  check('preview text layer paints', s06 && s06.painted > 0 && s16 && s16.painted > 0, JSON.stringify({ s06, s16 }));
  check('preview text layer moves over time', s06 && s16 && (s06.painted !== s16.painted || s06.sum !== s16.sum), `painted ${s06?.painted} -> ${s16?.painted}, sum ${s06?.sum} -> ${s16?.sum}`);
  await ev(`window.__fve.seek(1.2)`);
  await sleep(800);
  await shot('gapc-preview.png');

  // ---- Hover scrub ----------------------------------------------------------
  // The app's media worker regenerates posters/filmstrips after load, so the
  // card's live thumbCount/duration/poster can differ from the synthetic
  // values the project was loaded with — read the LIVE record and derive the
  // expectations from it instead of hardcoding 10 frames / 4 s.
  await ev(`window.__fve.tab('media')`);
  await sleep(1500);
  const liveM2 = await ev(`(() => { const m = window.__fve.exportData().project.media.find((x) => x.id === 'm2'); return m ? { thumbCount: m.thumbCount, duration: m.duration, poster: !!m.poster, thumb: !!m.thumb } : null; })()`);
  const scrubBefore = await ev(`(() => {
    const cards = [...document.querySelectorAll('.asset')];
    const card = cards.find((c) => (c.textContent || '').includes('scrub.mp4'));
    if (!card) return { found: false, cards: cards.length };
    const spriteEl = card.querySelector('.asset-sprite');
    return { found: true, sprite: !!spriteEl, poster: !!card.querySelector('.asset-thumb img'), pos: spriteEl ? spriteEl.style.backgroundPosition : null };
  })()`);
  check('scrub card renders a thumbnail (poster or filmstrip)', scrubBefore.found && (scrubBefore.sprite || scrubBefore.poster), JSON.stringify({ ...scrubBefore, liveM2 }));
  const FRAC = 0.75;
  const scrubAfter = await ev(`(() => {
    const card = [...document.querySelectorAll('.asset')].find((c) => (c.textContent || '').includes('scrub.mp4'));
    const thumb = card.querySelector('.asset-thumb');
    const r = thumb.getBoundingClientRect();
    thumb.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * ${FRAC}, clientY: r.top + r.height / 2 }));
    return new Promise((res) => setTimeout(() => {
      const spriteEl = card.querySelector('.asset-sprite');
      const label = card.querySelector('.asset-scrub');
      res({ pos: spriteEl ? spriteEl.style.backgroundPosition : null, label: label ? label.textContent : null });
    }, 400));
  })()`);
  // Expected frame/position/time from the LIVE record, tolerant of one frame.
  const liveCount = (liveM2 && liveM2.thumbCount) || 10;
  const liveDur = (liveM2 && liveM2.duration) || 4;
  const expFrame = Math.min(liveCount - 1, Math.floor(FRAC * liveCount));
  const expPos = (expFrame / (liveCount - 1)) * 100;
  const gotPos = scrubAfter.pos ? parseFloat(scrubAfter.pos) : NaN;
  const expSecs = Math.floor(FRAC * liveDur);
  const gotSecs = scrubAfter.label ? parseInt(scrubAfter.label.split(':')[1] || '0', 10) + 60 * parseInt(scrubAfter.label.split(':')[0] || '0', 10) : NaN;
  check('hover scrub shows the frame under the pointer', Number.isFinite(gotPos) && Math.abs(gotPos - expPos) <= 100 / (liveCount - 1) + 0.01, JSON.stringify({ ...scrubAfter, liveM2, expFrame, expPos: expPos.toFixed(2) }));
  check('hover scrub time label tracks the pointer', Number.isFinite(gotSecs) && Math.abs(gotSecs - expSecs) <= 1, JSON.stringify({ ...scrubAfter, liveM2, expSecs }));
  await shot('gapc-hover-scrub.png');

  // ---- Real export: wait for the job tray to report completion -------------
  // (NOT file-size stability: the muxer writes the 48-byte ftyp header at
  // job start and the file stays that size while FX frames bake — run 8
  // called that "complete" and ffprobe then failed on the empty mdat.)
  fs.rmSync(outFile, { force: true });
  await evFire(`window.__fve.exportNow()`);
  const done = await until(`!!document.querySelector('.xjob-state')`, 300000);
  check('export completes (job tray reports done)', done);
  check('export file written', fs.existsSync(outFile) && fs.statSync(outFile).size > 1000, outFile + (fs.existsSync(outFile) ? ` ${fs.statSync(outFile).size}B` : ''));
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
    const info = await ff.probe(outFile);
    check('export is ~4s 640x360', Math.abs(info.duration - 4) < 0.5 && info.width === 640 && info.height === 360, `${info.width}x${info.height} ${info.duration?.toFixed(2)}s`);
    const fA = path.join(SCRATCH, 'frameA.png');
    const fB = path.join(SCRATCH, 'frameB.png');
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1.2', '-i', outFile, '-frames:v', '1', fA]);
    execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '3.2', '-i', outFile, '-frames:v', '1', fB]);
    const hA = execFileSync('md5sum', [fA]).toString().split(' ')[0];
    const hB = execFileSync('md5sum', [fB]).toString().split(' ')[0];
    const szA = fs.statSync(fA).size, szB = fs.statSync(fB).size;
    check('exported frames differ across the cut', hA !== hB, `1.2s=${hA.slice(0, 8)} (${szA}B) 3.2s=${hB.slice(0, 8)} (${szB}B)`);
    check('exported frames are not blank', szA > 5000 && szB > 5000, `${szA}B / ${szB}B`);
  }
} catch (e) {
  failed = true;
  console.log('DRIVER ERROR:', e.message);
  console.log('child stderr (last 2000 chars):', stderr.slice(-2000));
}
kill();
if (results.some(([, ok]) => !ok)) failed = true;
console.log(failed ? 'gapc-live: FAILED' : 'gapc-live ok');
process.exit(failed ? 1 : 0);
