// Live-app check for Cutflow Stream F5 (FB-23 / FB-24 / FB-25 / FB-30 /
// FB-33). Boots the real app headless (Xvfb) with a fresh profile and
// drives the running editor:
//   FB-33  idle document.fonts is small (no bundled face loaded at
//          startup); adding a Bebas Neue title loads exactly that face
//          through the store (document.fonts.check turns true); the
//          export below runs renderTextFrames through the gate.
//   FB-30  system:status snapshot shape; models:install refuses an
//          unknown id; the audio-source badge appears for the clip with
//          an audio effect and no derivative; the tray's System section
//          renders while the export runs.
//   FB-25  Proofread dialog: a mistyped proper noun is flagged with a
//          one-click fix, a speaker label is set, Apply lands the edits
//          in the project and the speaker chip shows in the transcript.
//   FB-24  a repeated caption forms a retake group; Keep opens the cut
//          review with a confidence %; Apply cuts the take (duration
//          drops).
//   FB-23  the Forge panel shows the estimated cost before generating;
//          the AI & privacy dialog lists the inventory.
// Run AFTER `npm run build`:  node scripts/test-f5-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9261;
const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;

const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 180000);
        pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        try { ws.send(JSON.stringify({ id: mid, method, params })); }
        catch (e) { clearTimeout(timer); pending.delete(mid); rej(e); }
      }),
      close: () => ws.close(),
    });
  });
}

async function waitTarget() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-f5-'));
const home = '/tmp/fve-f5-live';
fs.mkdirSync(home, { recursive: true });
const clip = path.join(dir, 'clip.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
const probe = async (f) => ff.probe(f);
const mClip = await probe(clip);

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-battery'),
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
  FVE_EXPORT_TARGET: dir,
};
delete env.FVE_SMOKE;
// The electron binary is renamed per worktree (cutflow-live on main,
// cutflow-f5 in the stream worktree); pick whichever exists in this tree.
const BIN = ['cutflow-live', 'electron', 'cutflow-f5'].map((n) => path.join(ROOT, 'node_modules/electron/dist', n)).find((p) => fs.existsSync(p));
const child = spawn(BIN,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

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
  const until = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i += 1) {
      const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
      if (gone) return true;
      await sleep(500);
    }
    return false;
  };
  const clickButton = async (text, scope = 'document') => ev(`(() => { const b = [...${scope}.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);
  const setField = async (selector, value, textarea = false) => ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = ${textarea ? 'window.HTMLTextAreaElement' : 'window.HTMLInputElement'}.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);

  await until(`!!window.__fve`, 60000);
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await dismissWelcome();
  await sleep(600);

  const words = (list, start) => list.map(([w, s, e]) => ({ text: w, start: s, end: e }));
  const mkProject = () => ({
    name: 'f5-live-test', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
    media: [{ id: 'm0', path: clip, name: 'clip.mp4', ...mClip }],
    videoClips: [
      // FB-30: an audio effect with no derivative yet — the preview must
      // say it plays the original audio until the render lands.
      { id: 'v1', mediaId: 'm0', in: 0, out: 12, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null, audioFx: { eq: { low: 3, mid: 0, high: 0 } } },
    ],
    overlayClips: [], audioClips: [], stickerClips: [], effectClips: [],
    textClips: [
      { id: 'c1', caption: true, text: 'هاد الفيديو موجه ليك', start: 0, duration: 4, font: 'cairo', size: 44, y: 0.8, words: words([['هاد', 0, 0.5], ['الفيديو', 0.5, 1.5], ['موجه', 1.5, 2.5], ['ليك', 2.5, 3.5]]) },
      { id: 'c2', caption: true, text: 'هاد الفيديو موجه ليك', start: 4, duration: 4, font: 'cairo', size: 44, y: 0.8, words: words([['هاد', 0, 0.5], ['الفيديو', 0.5, 1.5], ['موجه', 1.5, 2.5], ['ليك', 2.5, 3.5]]) },
      { id: 'c3', caption: true, text: 'Cutflow هو تطبيق', start: 8, duration: 4, font: 'cairo', size: 44, y: 0.8, words: words([['Cutflow', 0, 1], ['هو', 1, 1.5], ['تطبيق', 1.5, 3]]) },
    ],
  });
  await evFire(`window.__fve.load(${JSON.stringify(mkProject())})`);
  await sleep(800);
  check('project loaded (12 s)', await ev(`window.__fve.duration() === 12`));
  // FB-30 audio badge, polled FIRST: the badge only shows while the clip
  // has an effect and no derivative yet, and the full render lands ~3 s
  // after load (probe9: pending 0-1 s, rendering 1.8-2.4 s, derivative
  // SET at 2.9 s, badge gone after). Polling for it after the font steps
  // below arrives too late — the product is correct, the check must look
  // during the window. The v1 clip has an effect and no derivative yet.
  let badgeSeen = '';
  for (let i = 0; i < 40 && !badgeSeen; i += 1) {
    badgeSeen = await ev(`(() => { const el = document.querySelector('.stage-note.audio'); return el ? el.textContent : ''; })()`).catch(() => '');
    if (!badgeSeen) await sleep(500);
  }
  check('audio source badge appears for the effected clip', !!badgeSeen, badgeSeen.slice(0, 80));
  check('welcome dismissed before pointer click', await dismissWelcome());

  // ---- FB-33: no bundled face loaded at startup ----
  const idleFaces = await ev(`document.fonts.size`);
  check('idle document.fonts is small (no bundled faces at startup)', idleFaces < 100, `${idleFaces} faces`);
  // document.fonts.check() is not a reliable "not loaded" test (it can
  // report true for a face the browser can synthesise); the faces list is.
  check('Bebas Neue NOT loaded at idle', await ev(`![...document.fonts].some((f) => f.family === 'Bebas Neue')`));
  // Add a Bebas title through the store's own gate: dispatch a text clip,
  // then the Preview gate must load exactly that face.
  await ev(`window.__fve.dispatch({ type: 'addText', clipId: 't1', at: 0, patch: { text: 'TITLE', duration: 4, font: 'bebas', size: 64, y: 0.5, bold: false, italic: false } })`);
  const bebasLoaded = await until(`document.fonts.check('400 32px "Bebas Neue"') && [...document.fonts].some((f) => f.family === 'Bebas Neue' && f.status === 'loaded')`, 15000);
  check('Bebas Neue loads on demand once a clip uses it', bebasLoaded);

  // ---- FB-30: system snapshot + model retry guard + audio badge ----
  const sys = await ev(`window.api.systemStatus()`);
  check('system:status returns proxy + models + fxCache + active', !!(sys && sys.proxy && sys.models && sys.models.whisper && sys.models.matting && sys.models.reframe && sys.models.piper && sys.fxCache && sys.active), JSON.stringify(Object.keys(sys || {})));
  check('whisper model state reports a boolean (fresh profile: not downloaded)', typeof sys?.models?.whisper?.installed === 'boolean' && sys.models.whisper.models.base === false, JSON.stringify(sys?.models?.whisper));
  const bogus = await ev(`window.api.modelsInstall('bogus-model')`);
  check('models:install refuses an unknown id', !!(bogus && bogus.error && bogus.error.includes('Unknown model')));

  // ---- FB-25: proofread dialog (name flag + speaker + apply) ----
  await ev(`window.__fve.tab('captions')`).catch(() => {});
  // The transcript card lives under the "Transcript & AI" sub-tab.
  check('Transcript sub-tab opens', await clickButton('Transcript & AI'));
  await sleep(500);
  check('Proofread button present', await clickButton('Proofread'));
  check('proofread dialog opens', await until(`!!document.querySelector('.proofread-modal')`, 10000));
  // The third row is c3 ("Cutflow هو تطبيق"): mistype it, take the fix.
  await setField('.proofread-row:nth-child(3) .proofread-text', 'Katflow هو تطبيق', true);
  await sleep(400);
  check('near-miss proper noun is flagged', await ev(`document.body.innerText.includes('did you mean Cutflow')`));
  check('one-click name fix applies', await clickButton('Use Cutflow'));
  await sleep(300);
  const fixedText = await ev(`document.querySelector('.proofread-row:nth-child(3) .proofread-text')?.value ?? ''`);
  check('text corrected to Cutflow', fixedText === 'Cutflow هو تطبيق', fixedText);
  await setField('.proofread-row:nth-child(3) .proofread-speaker', 'Hamza');
  check('Apply lands the edits', await clickButton('Apply changes'));
  await sleep(500);
  const p25 = await ev(`window.__fve.exportData().project`);
  const c3 = p25.textClips.find((c) => c.id === 'c3');
  check('caption text + speaker saved in the project', c3 && c3.text === 'Cutflow هو تطبيق' && c3.speaker === 'Hamza', JSON.stringify({ text: c3?.text, speaker: c3?.speaker }));
  check('speaker chip shows in the transcript', await ev(`[...document.querySelectorAll('.tx-speaker')].some((el) => el.value === 'Hamza')`)); // .tx-speaker is an <input> (free-text speaker, AI-03): textContent is always empty, the name lives in .value.

  // ---- FB-24: retake review with confidence ----
  check('retake group is listed', await until(`!!document.querySelector('.tx-retakes')`, 10000));
  check('Keep take opens the review', await clickButton('Keep suggested take'));
  check('cut review dialog opens', await until(`!!document.querySelector('#cut-review-title')`, 10000));
  const confShown = await ev(`document.querySelector('#cut-review-title')?.closest('.modal')?.innerText.match(/Confidence (\\d+)%/)?.[1] || ''`);
  check('review shows a per-cut confidence percentage', !!confShown, confShown ? `${confShown}%` : '');
  check('review Apply button present', await ev(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('Apply'))`));
  await clickButton('Apply');
  await sleep(800);
  check('review closes after Apply', await ev(`!document.querySelector('#cut-review-title')`));
  const durAfter = await ev(`window.__fve.duration()`);
  check('retake cut applied (duration drops below 12)', durAfter < 12, `duration=${durAfter}`);

  // ---- FB-23: Forge cost before Generate + AI inventory ----
  await ev(`window.__fve.tab('forge')`);
  await sleep(800);
  const costText = await ev(`(() => { const el = [...document.querySelectorAll('.forge p[role="status"]')].map((e) => e.textContent).join(' '); return el; })()`);
  check('Forge shows an estimated cost before generating', /Estimated cost|Free — no charge/.test(costText), costText.slice(0, 100));
  check('AI & privacy button opens the inventory', await clickButton('AI & privacy'));
  check('inventory dialog lists providers', await until(`document.body.innerText.includes('AI & privacy — what runs where')`, 10000)
    && await ev(`document.body.innerText.includes('Pollinations') && document.body.innerText.includes('Groq')`));
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Close'); if (b) b.click(); return true; })()`).catch(() => {});

  // ---- FB-30 (tray) + FB-33 (export gate): export with the title clip ----
  const beforeJobs = await ev(`document.querySelectorAll('.xjob-ic.ok').length`);
  await evFire(`window.__fve.exportNow()`);
  let sysVisible = false;
  for (let i = 0; i < 30 && !sysVisible; i += 1) {
    sysVisible = await ev(`!!document.querySelector('[aria-label="System"]')`).catch(() => false);
    if (!sysVisible) await sleep(500);
  }
  check('tray System section renders while the export runs', sysVisible);
  let exported = null;
  for (let i = 0; i < 120; i += 1) {
    const done = await ev(`document.querySelectorAll('.xjob-ic.ok').length`).catch(() => 0);
    if (done > beforeJobs) break;
    await sleep(2000);
    if (i === 119) break;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4') && f !== 'clip.mp4');
  if (files.length) {
    const f = path.join(dir, files[0]);
    const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f], { encoding: 'utf8' });
    exported = Number((r.stdout || '').trim());
  }
  check('export with the gated title clip produces a valid mp4', Number.isFinite(exported) && exported > 0, `duration=${exported} files=${files.join(',')}`);

  cdp.close();
} catch (e) {
  console.log(`ERROR ${e.message}`);
  if (stderr) console.log(`[electron stderr tail]\n${stderr.slice(-2000)}`);
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already dead */ }
}

const fails = results.filter(([, ok]) => !ok);
console.log(`\nF5 LIVE: ${results.length - fails.length}/${results.length} PASS`);
if (fails.length) { console.log('failures:'); fails.forEach(([name, , extra]) => console.log(`  - ${name} ${extra}`)); process.exitCode = 1; }
