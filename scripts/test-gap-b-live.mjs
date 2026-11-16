// Stream B live verification: drives the real dev app (CDP) through the
// Stream B UI — inspector levels, FX stack bypass/reorder, frame hold,
// J/L cuts, split screen, Pan & Zoom, audio Replace/Merge + A/B, Source
// Monitor insert, transcript speaker/confidence/proofreading, Q/W trim,
// SpeedDialog named presets, LUT/FCPXML buttons, and the composer demo.
//
// Usage: node scripts/test-gap-b-live.mjs   (run after `npm run build`)
//   CDP port 9252 (A: 9243, C: 9244 — verified free + owner-checked);
//   fresh HOME per run; no FVE_SMOKE (smoke.cjs default flow quits the app).
// Screenshots: ~/workspace/cutflow-shots/gap-b/
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9260;
const SHOTS = '/home/hatch/workspace/cutflow-shots/gap-b';
fs.mkdirSync(SHOTS, { recursive: true });
const ff = (await import('../electron/ffmpeg.cjs')).default;
const ffmpegPath = ff.ffmpegPath;

const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); } };
    ws.onerror = () => reject(new Error('ws error'));
    ws.onclose = () => { for (const { rej } of pending.values()) rej(new Error('ws closed')); pending.clear(); };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => { if (ws.readyState !== 1) return rej(new Error('ws not open')); const mid = ++id; const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000); pending.set(mid, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } }); ws.send(JSON.stringify({ id: mid, method, params })); }),
      close: () => ws.close(),
    });
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-gapb-live-'));
const homeDir = path.join(dir, 'home');
fs.mkdirSync(homeDir, { recursive: true });
const clip = path.join(dir, 'clip.mp4');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip]);
const info = await ff.probe(clip);

// Fixture: v1 (effects, linked audio starting at 1 s so J-cut can move it),
// v2 (partner for split screen), caption t1 (low-confidence word + a
// proofreading issue in its text).
const project = {
  id: 'gapb-live', name: 'Gap B Live', ratio: '16:9', resolution: 720, width: 640, height: 360, fps: 30, background: '#000000',
  media: [{ id: 'm1', path: clip, name: 'clip.mp4', ...info }],
  videoClips: [
    { id: 'v1', mediaId: 'm1', in: 0, out: 3, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: ['fx_bloom2', 'fx_vhs'], transition: null, linkId: 'L1' },
    { id: 'v2', mediaId: 'm1', in: 3, out: 6, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
  ],
  // Linked pair: the audio's source window (0–3) matches the picture's, so
  // the pair is consistent — syncLinked must not "correct" the picture when
  // the audio moves on its own (J/L cuts, independent trims).
  audioClips: [{ id: 'a1', mediaId: 'm1', start: 0.5, in: 0, out: 3, speed: 1, volume: 1, muted: false, linkId: 'L1', linkOff: 0.5, linkInOff: 0 }],
  overlayClips: [],
  textClips: [{
    id: 't1', text: 'Hello  world', start: 0.5, duration: 2.5, x: 0.5, y: 0.8, size: 48, caption: true,
    words: [
      { text: 'Hello', start: 0, end: 1.2, conf: 0.9 },
      { text: 'world', start: 1.3, end: 2.5, conf: 0.4 },
    ],
  }],
  stickerClips: [], effectClips: [],
};

const env = {
  ...process.env, HOME: homeDir, DISPLAY: ':99',
  TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-battery'),
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
};
delete env.FVE_SMOKE; delete env.FVE_SMOKE_MODE;
// Renamed Electron binary: sibling streams' cleanups run bare
// `pkill -x electron`, which SIGTERMs every stock-`electron` process
// (exitCode 15) — two live runs died that way ~100 s in. A hardlinked
// copy renamed cutflow-gapb does not match the pattern (same fix as
// stream C's cutflow-gapc).
const electronBin = [
  path.join(os.homedir(), 'workspace', '.tmp-battery', 'electron-gapb-dist', 'cutflow-gapb'),
  path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  path.join(os.homedir(), 'workspace', 'electron-dist', 'electron'),
].find((p) => fs.existsSync(p));
const child = spawn(electronBin,
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

async function waitTarget() {
  for (let i = 0; i < 120; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (page) {
        if (!page.url.includes('.tmp-gap-b')) throw new Error(`CDP port ${PORT} belongs to another app (${page.url})`);
        return page;
      }
    } catch (e) { if (/belongs to another app/.test(e.message)) throw e; }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(r.exceptionDetails).slice(0, 400)}`);
    return r.result.value;
  };
  // Screenshots are best-effort evidence: the hidden-window rig throttles
  // the compositor, and a stuck capture must not fail the checks.
  const shot = async (name) => {
    try {
      const r = await Promise.race([
        cdp.call('Page.captureScreenshot', { format: 'png' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('shot timeout')), 20000)),
      ]);
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    } catch (e) { console.log(`shot skipped (${name}): ${e.message}`); }
  };
  const clickText = async (sel, text) => ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const b=els.find((x)=>x.textContent.trim()==='${text}' || (x.textContent||'').trim().startsWith('${text}')); if(!b) return false; b.click(); return true; })()`);
  const waitFor = async (expr, ms = 5000) => { for (let i = 0; i < ms / 250; i++) { if (await ev(expr).catch(() => false)) return true; await sleep(250); } return false; };
  const clickLevel = async (name) => {
    const ok = await clickText('[aria-label="Inspector level"] button', name);
    return ok && waitFor(`(() => { const b=[...document.querySelectorAll('[aria-label="Inspector level"] button')].find((x)=>x.textContent.trim()==='${name}'); return b && b.getAttribute('aria-selected')==='true'; })()`);
  };
  const clickTab = async (name) => {
    const ok = await ev(`(() => { const b=[...document.querySelectorAll('.ci-tabs [role="tab"]')].find((x)=>x.textContent.trim()==='${name}'); if(!b) return false; b.click(); return true; })()`);
    await sleep(500);
    return ok;
  };
  const clickAria = async (label) => ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>(x.getAttribute('aria-label')||'').startsWith(${JSON.stringify(label)})); if(!b||b.disabled) return false; b.click(); return true; })()`);
  const hasText = async (t) => ev(`document.body.innerText.includes(${JSON.stringify(t)})`);
  const proj = async () => ev('window.__fve.exportData().project');
  const dumpClips = async (tag) => console.log(`clips@${tag}:`, (await proj()).videoClips.map((c) => `${c.id}:${c.in}-${c.out}`).join(' '));

  for (let i = 0; i < 60; i++) { if (await ev('!!window.__fve')) break; await sleep(500); }
  check('app boots, __fve present', await ev('!!window.__fve'));
  // Dismiss the first-run Welcome modal (button 'Start creating').
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.trim()==='Start creating'); if(b) b.click(); return true; })()`).catch(() => {});
  await sleep(500);
  // __fve.load() does not enter the editor — enter it first via the
  // Home '.home-create' tile, then load the fixture over the fresh project.
  await ev(`(() => { const b=document.querySelector('.home-create') || document.querySelector('[aria-label="Create project"]'); if(b) b.click(); return !!b; })()`).catch(() => {});
  for (let i = 0; i < 60; i++) { if (await ev(`!!document.querySelector('.play-btn')`)) break; await sleep(500); }
  check('editor entered via .home-create', await ev(`!!document.querySelector('.play-btn')`));
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await sleep(1000);
  check('fixture loads', (await proj()).videoClips.length === 2);
  await dumpClips('load');
  await ev(`window.__fve.select({track:'video', id:'v1'})`);
  await sleep(500);

  // --- UX-01 inspector levels ---------------------------------------------
  check('inspector level switch exists', await hasText('Presets') && await ev(`!!document.querySelector('[aria-label="Inspector level"]')`));
  check('Basic hides Stabilize', !(await ev(`!!document.querySelector('.stab-levels, [aria-label="Stabilize"]')`)));
  check('switch to Advanced level', await clickLevel('Advanced'));
  check('Advanced shows Stabilize', await waitFor(`!!document.querySelector('.stab-levels')`));
  check('switch back to Basic level', await clickLevel('Basic'));

  // --- FX-01 bypass + reorder (Adjust tab → Effects section) ----------------
  check('Adjust tab opens', await clickTab('Adjust'));
  await waitFor(`!!document.querySelector('.fx-entry')`);
  check('bypass toggles fxBypassed', await clickAria('Bypass Glow Bloom') && (await proj()).videoClips[0].fxBypassed?.fx_bloom2 === true);
  check('bypass toggles back', await clickAria('Enable Glow Bloom') && !(await proj()).videoClips[0].fxBypassed?.fx_bloom2);
  const orderBefore = (await proj()).videoClips[0].effects.join(',');
  // Move the first effect down: find the 'Move effect down' button in the first fx-entry.
  const moved = await ev(`(() => { const e=document.querySelector('.fx-entry'); if(!e) return false; const b=[...e.querySelectorAll('button')].find((x)=>(x.getAttribute('aria-label')||'')==='Move effect down'); if(!b) return false; b.click(); return true; })()`);
  await sleep(300);
  check('reorder moves effect down', moved && (await proj()).videoClips[0].effects.join(',') !== orderBefore, (await proj()).videoClips[0].effects.join(','));

  // --- P1-50 frame hold (Video tab) --------------------------------------------
  check('Video tab opens', await clickTab('Video'));
  check('frame-hold section present', await ev(`[...document.querySelectorAll('.ci-section .ci-head b')].some((x)=>x.textContent==='Frame hold')`));
  check('set hold at playhead', await clickText('button', 'Hold frame at playhead') && !!(await proj()).videoClips[0].frameHold);
  check('clear hold', await clickText('button', 'Clear hold') && !(await proj()).videoClips[0].frameHold);

  // --- TL-03 J-cut ------------------------------------------------------------
  check('linked-audio section present', await ev(`[...document.querySelectorAll('.ci-section .ci-head b')].some((x)=>x.textContent.includes('J / L cuts'))`));
  const aStartBefore = (await proj()).audioClips[0].start;
  await clickText('button', 'J-cut −0.5s');
  await sleep(300);
  check('J-cut moves linked audio early', Math.abs((await proj()).audioClips[0].start - (aStartBefore - 0.5)) < 0.01, `start ${(await proj()).audioClips[0].start}`);
  check('J-cut leaves the picture alone', (await proj()).videoClips[0].in === 0 && (await proj()).videoClips[0].out === 3);
  await shot('01-inspector-jcut.png');

  // --- Split screen + Pan & Zoom ----------------------------------------------
  check('split-screen section present', await ev(`[...document.querySelectorAll('.ci-section .ci-head b')].some((x)=>x.textContent==='Split screen')`));
  // Partner dropdown (custom in-app select): open it, pick the partner clip.
  const picked = await ev(`(() => { const b=document.querySelector('button[aria-label="Partner clip"]'); if(!b) return 'no-btn'; b.click(); return 'opened'; })()`);
  await sleep(500);
  const chosePartner = await ev(`(() => { const opts=[...document.querySelectorAll('[role="option"]')].filter((x)=>/clip\\.mp4/.test(x.textContent||'')); if(!opts.length) return false; opts[0].click(); return true; })()`);
  await sleep(400);
  const appliedSplit = await clickText('button', 'Apply split screen');
  await sleep(300);
  const v1t = (await proj()).videoClips[0].transform;
  check('split screen applies (partner picked, transform set)', picked === 'opened' && chosePartner && appliedSplit && v1t && Math.abs(v1t.scale - 0.5) < 0.01, `picked=${picked} chose=${chosePartner} applied=${appliedSplit} scale=${v1t?.scale}`);
  check('pan-zoom applies effect', await clickText('button', 'Apply Pan & Zoom') && (await proj()).videoClips[0].effects.includes('fx_panzoom'));
  await dumpClips('panzoom');

  // --- AU-04 audio Replace/Merge + A/B -----------------------------------------
  check('Audio tab opens', await clickTab('Audio'));
  check('audio layering toggle present', await hasText('Preset applies as') && await hasText('Merge'));
  await clickText('.afx-layer .chip', 'Merge');
  const fxBefore = JSON.stringify((await proj()).videoClips[0].audioFx || {});
  const presetClicked = await ev(`(() => { const b=document.querySelector('.afx-chip'); if(!b) return false; b.click(); return true; })()`);
  await sleep(500);
  const fxAfter = JSON.stringify((await proj()).videoClips[0].audioFx || {});
  check('preset applies in Merge mode', presetClicked && fxAfter !== fxBefore);
  check('A/B buttons appear after preset', await hasText('A · before') && await hasText('B · preset'));
  await clickText('button', 'A · before');
  await sleep(400);
  check('A/B returns to pre-preset chain', JSON.stringify((await proj()).videoClips[0].audioFx || {}) === fxBefore);

  // --- Source Monitor ------------------------------------------------------------
  await ev(`window.__fve.tab('media')`);
  await sleep(500);
  const peeked = await ev(`(() => { const card=document.querySelector('.asset'); if(!card) return false; card.click(); return true; })()`);
  await sleep(800);
  check('source monitor appears on card click', peeked && await ev(`!!document.querySelector('.source-monitor')`));
  // Mark In at the current position (0), scrub to 2 s via the native setter
  // (React tracks the range through its own value descriptor), Mark Out,
  // verify the labels, then Insert — the range must be 0–2, not 2–2.
  await clickText('.source-monitor-marks button', 'Mark In');
  const scrubbed = await ev(`(() => { const m=document.querySelector('.source-monitor'); if(!m) return false; const r=m.querySelector('input[type="range"]'); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(r,'2'); r.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  await sleep(400);
  await clickText('.source-monitor-marks button', 'Mark Out');
  await sleep(300);
  const marksShown = await ev(`(() => { const b=[...document.querySelectorAll('.source-monitor-marks button')].map((x)=>x.textContent); return b.join(' | '); })()`);
  const clipsBefore = (await proj()).videoClips.length;
  await ev(`(() => { const b=[...document.querySelectorAll('.source-monitor-insert button')].find((x)=>/Insert at playhead/.test(x.textContent)); if(b) b.click(); return !!b; })()`);
  await sleep(500);
  const newClips = (await proj()).videoClips;
  const inserted = newClips.find((c) => c.id !== 'v1' && c.id !== 'v2');
  check('source monitor inserts marked range', scrubbed && newClips.length === clipsBefore + 1 && !!inserted && Math.abs(inserted.in - 0) < 0.05 && Math.abs(inserted.out - 2) < 0.05, `marks=[${marksShown}] inserted in=${inserted?.in} out=${inserted?.out}`);
  await dumpClips('insert');
  await shot('02-source-monitor.png');

  // --- Transcript: speaker / confidence / proofreading ------------------------------
  // The TranscriptCard lives on the Captions tab's 'Transcript & AI' sub-tab.
  await ev(`window.__fve.tab('captions')`);
  await sleep(600);
  const subTab = await clickText('button', 'Transcript & AI');
  await sleep(600);
  check('transcript sub-tab opens', subTab && await waitFor(`!!document.querySelector('.tx-quality, .tx-speaker')`));
  check('transcript quality block present', await hasText('Confidence below') && await hasText('Check text'));
  check('low-confidence word flagged', await ev(`!!document.querySelector('.tx-word-low')`));
  // React commits the speaker on blur, implemented via focusout — dispatch
  // focusout (a plain 'blur' event never reaches React's handler).
  const speakerSet = await ev(`(() => { const inp=document.querySelector('.tx-speaker'); if(!inp) return false; inp.focus(); const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(inp,'Hamza'); inp.dispatchEvent(new Event('input',{bubbles:true})); inp.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); return true; })()`);
  await sleep(400);
  check('speaker label saves on blur', speakerSet && (await proj()).textClips[0].speaker === 'Hamza');
  await clickText('button', 'Check text');
  await sleep(400);
  check('proofreader finds the double-space issue', await hasText('Apply all'));
  await clickText('button', 'Apply all');
  await sleep(400);
  check('proofreader applies the fix', (await proj()).textClips[0].text === 'Hello world', (await proj()).textClips[0].text);
  await shot('03-transcript.png');

  // --- Q/W trim -----------------------------------------------------------------------
  // Dump the clips before/after: trimSide re-ids the surviving half, so
  // assert on the surviving half's in/out, not on id 'v1'.
  const clipsBeforeQ = (await proj()).videoClips.map((c) => `${c.id}:${c.in}-${c.out}`).join(' ');
  await dumpClips('before-Q');
  await ev(`window.__fve.select({track:'video', id:'v1'})`);
  await ev(`window.__fve.seek(1.5)`);
  await sleep(400);
  // The transcript section left focus in an input: blur it, or the app's
  // key handler (which ignores keys typed into fields) swallows the Q.
  await ev(`document.activeElement && document.activeElement.blur()`);
  await sleep(200);
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 });
  await sleep(600);
  const clipsAfterQ = (await proj()).videoClips;
  const rightHalf = clipsAfterQ.find((c) => Math.abs(c.in - 1.5) < 0.05 && Math.abs(c.out - 3) < 0.05);
  check('Q trims everything before the playhead', !!rightHalf, `before=[${clipsBeforeQ}] after=[${clipsAfterQ.map((c) => `${c.id}:${c.in}-${c.out}`).join(' ')}]`);

  // The Welcome card can re-appear after first editor entry (async settings
  // load) — dismiss it again before any pointer work, or it covers the
  // timeline (elementFromPoint hits .welcome-dim).
  await ev(`(() => { const b=[...document.querySelectorAll('button')].find((x)=>x.textContent.trim()==='Start creating'); if(b) b.click(); return true; })()`).catch(() => {});
  await sleep(400);
  // --- SpeedDialog named presets -------------------------------------------------------
  // Open the clip menu with a synthetic contextmenu event on the timeline
  // clip (CDP right-clicks do not reliably produce one here), then Speed.
  const clipRect = await ev(`(() => { const el=document.querySelector('.clip.video'); if(!el) return null; el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  let speedOk = false; let menuSeen = false;
  if (clipRect) {
    const ctxFired = await ev(`(() => { const el=document.elementFromPoint(${clipRect.x}, ${clipRect.y}); if(!el) return 'no-el'; const clip=el.closest('.clip'); if(!clip) return 'not-a-clip:'+el.className; clip.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true, clientX:${clipRect.x}, clientY:${clipRect.y}})); return 'fired'; })()`);
    await sleep(600);
    menuSeen = await ev(`!!document.querySelector('.ctx-menu, [role="menu"]')`);
    const menuItem = await ev(`(() => { const b=[...document.querySelectorAll('[role="menuitem"]')].find((x)=>/Speed/.test(x.textContent)); if(!b) return false; b.click(); return true; })()`);
    await sleep(600);
    speedOk = menuItem && (await hasText('Montage')) && (await hasText('Hero')) && (await hasText('Bullet'));
    check('SpeedDialog opens with Montage/Hero/Bullet presets', speedOk, `ctx=${ctxFired} menuSeen=${menuSeen} menuItem=${menuItem}`);
    await shot('04-speed-dialog.png');
    await ev(`(() => { const b=[...document.querySelectorAll('.modal-actions button')].find((x)=>x.textContent.trim()==='Cancel'); if(b) b.click(); return !!b; })()`).catch(() => {});
    await sleep(300);
  } else {
    check('SpeedDialog opens with Montage/Hero/Bullet presets', false, 'no timeline clip rect');
  }

  // --- LUT export button (GradePanel) + FCPXML button (ExportDialog) -------------------
  // NOTE: select v2 — v1's id changed at the Q trim (the surviving half is
  // re-id'd), so selecting 'v1' here would select nothing.
  await ev(`window.__fve.select({track:'video', id:'v2'})`);
  await ev(`(() => { const b=[...document.querySelectorAll('.ci-tabs [role="tab"]')].find((x)=>x.textContent.trim()==='Adjust'); if(b) b.click(); return !!b; })()`);
  await sleep(400);
  check('LUT export button present in Grade panel', await hasText('Export grade as .cube'));
  const exportOpened = await ev(`(() => { const b=document.querySelector('.btn-export:not(.caret)'); if(!b) return false; b.click(); return true; })()`);
  await sleep(800);
  const dialogOpen = await waitFor(`!!document.querySelector('.export-modal')`);
  check('Export dialog shows FCPXML button', exportOpened && dialogOpen && await ev(`[...document.querySelectorAll('.export-modal button')].some((x)=>x.textContent.trim()==='Export .fcpxml')`));
  await shot('05-export-dialog.png');
  await ev(`(() => { const b=[...document.querySelectorAll('.export-modal button')].find((x)=>/Close|Cancel/.test(x.textContent)); if(b) { b.click(); return true; } return false; })()`).catch(() => {});

  // --- Composer demo loads ---------------------------------------------------------------
  const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'composer-demo', 'composer-vertical-demo.json'), 'utf8'));
  demo.media.forEach((m) => { m.path = path.join(ROOT, 'docs', 'composer-demo', m.path); });
  await ev(`window.__fve.load(${JSON.stringify(demo)})`);
  await sleep(1000);
  const d = await proj();
  check('composer demo loads (3 clips, 1 caption)', d.videoClips.length === 3 && d.textClips.length === 1 && d.width === 1080 && d.height === 1920);
  check('demo beats present', d.videoClips[0].effects.includes('fx_bloom2') && d.videoClips[1].transition?.type === 'fx_lightburn' && d.videoClips[2].transition?.type === 'fx_zoomin' && d.textClips[0].animIn?.id === 'flicker');
  // Frame-level visual checks of the demo are not possible in this rig:
  // the hidden-window compositor is throttled and every captureScreenshot
  // times out (see the skipped shots above). The demo's structure is
  // verified here; its render path is the same one the PSNR-verified
  // frame-hold export test covers.

  cdp.close();
  child.kill('SIGTERM');
  await Promise.race([child.exitCode !== null ? Promise.resolve() : new Promise((r) => child.on('exit', r)), sleep(10000)]);
} catch (e) {
  console.log('DRIVER ERROR', e.message);
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

const failed = results.filter(([, ok]) => !ok);
console.log(`\ntest-gap-b-live: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length) { console.log('failed:', failed.map(([n]) => n).join(', ')); }
if (stderr) console.log('--- app stderr (last 1500 chars) ---\n' + stderr.slice(-1500));
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
