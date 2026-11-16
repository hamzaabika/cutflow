// Live-app check for the P2 stream-A UI layer (trim tools, groups,
// advanced audio FX, beat grid, mixer). Boots the real app headless (Xvfb)
// with a fresh profile and verifies, against the running editor:
//   P2-01  trim-tool buttons exist; roll/slip/slide/rate dispatch changes
//          land in the project with the right neighbour semantics
//   P2-03  group/ungroup dispatch + selection expands to the group in the
//          DOM; Select-following selects the clip + everything after it
//   P2-21  the advanced AudioFx section renders (EQ bands, comp params,
//          pan/width) once a comp is enabled on the selected clip
//   P2-22  the beat-grid popover applies a manual 100 BPM grid and beat
//          ticks render on the ruler
//   P2-23  the mixer popover renders; a role change lands; a real export
//          with the music bus at -20 dB is ~20 dB quieter than at 0 dB
// Run AFTER `npm run build`:  node scripts/test-p2-ui-live.mjs
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9226;
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
    ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
    ws.onclose = () => {
      for (const { rej } of pending.values()) rej(new Error('ws closed'));
      pending.clear();
    };
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        if (ws.readyState !== 1) return rej(new Error('ws not open'));
        const mid = ++id;
        const timer = setTimeout(() => { pending.delete(mid); rej(new Error(`CDP timeout: ${method}`)); }, 60000);
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-p2ui-'));
const home = '/tmp/fve-p2-a';
fs.mkdirSync(home, { recursive: true });
const clip = path.join(dir, 'clip.mp4');
const music = path.join(dir, 'music.mp3');
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=12', '-c:a', 'libmp3lame', '-q:a', '4', music]);
const probe = async (f) => ff.probe(f);
const mClip = await probe(clip);
const mMusic = await probe(music);

const env = {
  ...process.env, HOME: home, DISPLAY: ':99',
  TMPDIR: path.join(process.env.HOME, 'workspace', '.tmp-p2-a-tmp'),
  VK_ICD_FILENAMES: path.join(process.env.HOME, 'workspace', 'vulkan', 'lvp_icd.json'),
  LIBGL_ALWAYS_SOFTWARE: '1',
  FVE_EXPORT_TARGET: dir,
};
delete env.FVE_SMOKE;
delete env.VK_ICD_FILENAMES;
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-accelerated-video-decode', '--disable-accelerated-video-encode', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
child.on('exit', (code, signal) => { console.log(`[child] electron exited code=${code} signal=${signal}`); });

const shotDir = '/home/hatch/workspace/cutflow-shots/p2-ui';
fs.mkdirSync(shotDir, { recursive: true });

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
  const shot = async (name) => {
    const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, name), Buffer.from(data, 'base64'));
  };
  const until = async (expr, ms = 120000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(500); }
    return false;
  };
  const doneCount = async () => ev(`document.querySelectorAll('.xjob-ic.ok').length`);
  // Wait for THIS export's job to settle (encode + loudness-normalize
  // post-step): a valid file alone is not enough — the normalize step
  // replaces the file after the main encode, so measuring on file
  // validity can read the previous export's output.
  const waitJobDone = async (before, ms = 240000) => {
    const t0 = Date.now();
    let fails = 0;
    while (Date.now() - t0 < ms) {
      try { if ((await doneCount()) > before) return true; fails = 0; }
      catch { if (++fails >= 5) return false; /* ws dead — the app is gone */ }
      await sleep(1000);
    }
    return false;
  };
  const waitFile = async (file, ms = 240000) => {
    // A video export is done only when the file is a VALID mp4 (moov atom
    // written): size stability alone passes on a stalled, incomplete encode.
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        const s = fs.statSync(file);
        if (s.size > 0) {
          const r = spawnSync(ff.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' });
          const dur = Number((r.stdout || '').trim());
          if (Number.isFinite(dur) && dur > 0) return true;
        }
      } catch { /* not yet */ }
      await sleep(1000);
    }
    return false;
  };
  const volDb = (file) => {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', 'volumedetect', '-vn', '-sn', '-dn', '-f', 'null', '/dev/null'], { encoding: 'utf8' });
    const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    return m ? Number(m[1]) : null;
  };

  await until(`!!window.__fve`, 60000);
  // Dismiss the first-run Welcome modal: it can appear on Home AND again on
  // entering the editor, and it swallows pointer hits while up — poll until
  // its button is gone, not just once.
  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i += 1) {
      const gone = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Start creating'); if (b) { b.click(); return false; } return !document.body.innerText.includes('Welcome to Cutflow'); })()`).catch(() => true);
      if (gone) return true;
      await sleep(500);
    }
    return false;
  };
  await dismissWelcome();
  await ev(`(() => { const b = document.querySelector('[aria-label="Create project"]'); if (b) b.click(); return !!b; })()`).catch(() => {});
  check('editor ready', await until(`!!document.querySelector('.play-btn')`, 60000));
  await dismissWelcome();
  await sleep(600);

  const mkProject = (extra = {}) => ({
    name: 'p2-ui-test', ratio: '16:9', resolution: 180, width: 320, height: 180, fps: 30, background: '#000000',
    media: [
      { id: 'm0', path: clip, name: 'clip.mp4', ...mClip },
      { id: 'm1', path: music, name: 'music.mp3', ...mMusic },
    ],
    videoClips: [
      { id: 'v1', mediaId: 'm0', in: 0, out: 4, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
      { id: 'v2', mediaId: 'm0', in: 4, out: 8, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
      { id: 'v3', mediaId: 'm0', in: 8, out: 12, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null },
    ],
    overlayClips: [], audioClips: [{ id: 'a1', mediaId: 'm1', start: 0, in: 0, out: 12, speed: 1, volume: 1, muted: false }],
    stickerClips: [], effectClips: [], textClips: [], ...extra,
  });
  await evFire(`window.__fve.load(${JSON.stringify(mkProject())})`);
  await sleep(800);
  check('project loaded (3 video clips)', await ev(`window.__fve.duration() === 12`));
  // The welcome card triggers on first editor entry (async settings load),
  // so it can appear AFTER the earlier dismissal — dismiss again now that
  // the project is in, before any real pointer hit.
  check('welcome dismissed before pointer click', await dismissWelcome());

  // ---- P2-01: trim-tool buttons + dispatch semantics ----
  const hasTool = async (prefix) => ev(`!![...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').startsWith(${JSON.stringify(prefix)}))`);
  check('roll tool button', await hasTool('Roll:'));
  check('slip tool button', await hasTool('Slip:'));
  check('slide tool button', await hasTool('Slide:'));
  check('rate tool button', await hasTool('Rate stretch:'));
  await ev(`window.__fve.dispatch({ type: 'rollEdit', track: 'video', id: 'v1', edge: 'right', delta: 1 })`);
  let p = await ev(`window.__fve.exportData().project`);
  check('roll +1 moves edit point (v1 out 5, v2 in 5)', p.videoClips[0].out === 5 && p.videoClips[1].in === 5, `v1.out=${p.videoClips[0].out} v2.in=${p.videoClips[1].in}`);
  await ev(`window.__fve.dispatch({ type: 'slipClip', track: 'video', id: 'v2', delta: 1 })`);
  p = await ev(`window.__fve.exportData().project`);
  check('slip +1 shifts source window, span kept (v2 in 6, out 9)', p.videoClips[1].in === 6 && p.videoClips[1].out === 9, `v2.in=${p.videoClips[1].in} v2.out=${p.videoClips[1].out}`);
  await ev(`window.__fve.dispatch({ type: 'slideClip', track: 'video', id: 'v2', delta: 1 })`);
  p = await ev(`window.__fve.exportData().project`);
  check('slide +1 moves clip, neighbours absorb (v1 out 6, v3 in 9)', p.videoClips[0].out === 6 && p.videoClips[2].in === 9, `v1.out=${p.videoClips[0].out} v3.in=${p.videoClips[2].in}`);
  await ev(`window.__fve.dispatch({ type: 'rateStretch', track: 'video', id: 'v3', delta: 2 })`);
  // The dispatch commits through React state: exportData() read in the same
  // tick can still show the pre-dispatch snapshot (speed 1) while the live
  // duration already reflects the change — poll for the committed speed.
  await until(`window.__fve.exportData().project.videoClips[2].speed === 0.6`, 5000);
  p = await ev(`window.__fve.exportData().project`);
  check('rate +2 slows v3 (speed 0.6, window fixed, total 14s)', p.videoClips[2].speed === 0.6 && p.videoClips[2].out - p.videoClips[2].in === 3 && await ev(`window.__fve.duration()`) === 14, `speed=${p.videoClips[2].speed} dur=${await ev(`window.__fve.duration()`)}`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await ev(`window.__fve.dispatch({ type: 'undo' })`);
  await shot('01-trim-tools.png');

  // ---- P2-03: groups + select-following ----
  await ev(`window.__fve.dispatch({ type: 'groupClips', items: [{ track: 'video', id: 'v1' }, { track: 'video', id: 'v2' }], groupId: 'g1' })`);
  p = await ev(`window.__fve.exportData().project`);
  check('groupClips stamps groupId on both', p.videoClips[0].groupId === 'g1' && p.videoClips[1].groupId === 'g1');
  // A real pointer click on v1 (not the __fve.select hook, which sets the
  // selection state directly and bypasses App's select() expansion).
  const clickClip = async (idx) => {
    const rect = await ev(`(() => { const els = [...document.querySelectorAll('.clip.video')]; if (!els[${idx}]) return null; const r = els[${idx}].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!rect) return false;
    await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
    await sleep(500);
    return true;
  };
  check('clicked v1 in the timeline', await clickClip(0));
  check('clicking v1 selects its group (2 clips highlighted)', await ev(`document.querySelectorAll('.clip.selected').length`) === 2, `selected=${await ev(`document.querySelectorAll('.clip.selected').length`)}`);
  await ev(`window.__fve.dispatch({ type: 'ungroupClips', items: [{ track: 'video', id: 'v1' }] })`);
  p = await ev(`window.__fve.exportData().project`);
  check('ungroup dissolves the whole group', !p.videoClips[0].groupId && !p.videoClips[1].groupId);
  await ev(`window.__fve.select({ track: 'video', id: 'v1' })`);
  await ev(`window.__fve.seek(0.5)`);
  await sleep(300);
  const clickedFollow = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').startsWith('Select following')); if (b && !b.disabled) { b.click(); return true; } return false; })()`);
  check('select-following button clickable', clickedFollow);
  await sleep(400);
  check('select-following selects v1+v2+v3', await ev(`document.querySelectorAll('.clip.selected').length`) >= 3, `selected=${await ev(`document.querySelectorAll('.clip.selected').length`)}`);

  // ---- P2-22: beat grid popover ----
  const clickedManual = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').startsWith('Beat grid: set a tempo')); if (b) { b.click(); return true; } return false; })()`);
  check('manual-grid button opens beat panel', clickedManual && await until(`!!document.querySelector('.tl-popover')`, 5000));
  await shot('02-beat-panel.png');
  await ev(`(() => { const n = document.querySelector('.tl-popover input[type="number"]'); if (!n) return false; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(n, '100'); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await ev(`(() => { const b = [...document.querySelectorAll('.tl-popover button')].find((x) => x.textContent.trim() === 'Apply grid'); if (b) b.click(); return !!b; })()`);
  await sleep(500);
  p = await ev(`window.__fve.exportData().project`);
  check('manual grid applied (100 BPM)', p.beats && p.beats.bpm === 100 && Array.isArray(p.beats.times) && p.beats.times.length > 0, `bpm=${p.beats?.bpm} beats=${p.beats?.times?.length}`);
  check('beat ticks render on the ruler', await ev(`document.querySelectorAll('.beat-tick').length`) > 0, `ticks=${await ev(`document.querySelectorAll('.beat-tick').length`)}`);

  // ---- P2-23: mixer popover + roles ----
  const clickedMixer = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || x.title || '').startsWith('Track mixer:')); if (b) { b.click(); return true; } return false; })()`);
  check('mixer button opens mixer panel', clickedMixer && await until(`!!document.querySelector('.tl-popover.mixer')`, 5000));
  await shot('03-mixer-panel.png');
  await ev(`window.__fve.dispatch({ type: 'setMixer', patch: { music: -20 } })`);
  p = await ev(`window.__fve.exportData().project`);
  check('setMixer stores music -20 dB', p.mixer && p.mixer.music === -20, `music=${p.mixer?.music}`);
  await ev(`window.__fve.select({ track: 'audio', id: 'a1' })`);
  await sleep(500);
  check('role picker shows in inspector (music default)', await ev(`(() => { const s = [...document.querySelectorAll('select')].find((x) => (x.getAttribute('aria-label') || '') === 'Mix bus'); return s ? s.value : null; })()`) === 'music');
  await ev(`window.__fve.dispatch({ type: 'setClipRole', track: 'audio', id: 'a1', role: 'sfx' })`);
  p = await ev(`window.__fve.exportData().project`);
  check('setClipRole lands (a1 -> sfx)', p.audioClips[0].role === 'sfx', `role=${p.audioClips[0].role}`);

  // ---- P2-21: advanced AudioFx section ----
  await ev(`window.__fve.dispatch({ type: 'update', track: 'audio', id: 'a1', patch: { audioFx: { comp: true, eqBands: [{ f: 1000, g: 3, q: 1 }] } } })`);
  await sleep(600);
  // textContent, not innerText: the inspector scrolls and off-screen rows
  // are not rendered text. The audio card may sit below the fold — scroll it
  // into view first so the section is actually open.
  await ev(`(() => { const el = document.querySelector('#audio\\\\:fx') || [...document.querySelectorAll('.afx-group-title')][0]; if (el) el.scrollIntoView({ block: 'nearest' }); return !!el; })()`).catch(() => {});
  await sleep(400);
  const afxTitles = await ev(`[...document.querySelectorAll('.afx-group-title')].map((e) => e.textContent)`);
  const afxLabels = await ev(`[...document.querySelectorAll('.afx-label')].map((e) => e.textContent)`);
  check('advanced EQ section renders', afxTitles.includes('Parametric EQ') && afxLabels.includes('Band 1'), `titles=${JSON.stringify(afxTitles)}`);
  check('compressor params render', afxLabels.includes('Threshold') && afxLabels.includes('Ratio'));
  check('stereo section renders', afxTitles.includes('Stereo') && afxLabels.includes('Pan'));
  await shot('04-audiofx-advanced.png');

  // ---- P2-23 export: music bus -20 dB vs 0 dB on the same audio clip ----
  // The video export's master loudness stage (social/-14 LUFS by default)
  // re-gains the whole mix, so an ABSOLUTE level comparison is meaningless
  // by design. The honest probe is the RELATIVE balance: dialogue is a 440 Hz
  // sine, music an 880 Hz sine, so each bus's level is measured separately
  // in the finished file (bandpass + volumedetect) and the music/dialogue
  // ratio must shift by ~20 dB. The loudness gain cancels in the ratio.
  const bandVol = (file, freq) => {
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-i', file, '-af', `bandpass=f=${freq}:width_type=h:width=50,volumedetect`, '-vn', '-sn', '-dn', '-f', 'null', '/dev/null'], { encoding: 'utf8' });
    const m = (r.stderr || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    return m ? Number(m[1]) : null;
  };
  const mixRatio = (file) => {
    const d = bandVol(file, 440);
    const m = bandVol(file, 880);
    return (d == null || m == null) ? null : m - d;
  };
  // Ground truth on the encoder itself: while the export runs, read the
  // ffmpeg child's command line (and the graph file it references) and
  // check the music tail carries the bus volume.
  const captureEncoderGraph = async (outFile) => {
    for (let i = 0; i < 60; i += 1) {
      try {
        const ps = execFileSync('pgrep', ['-a', '-f', 'ffmpeg'], { encoding: 'utf8' });
        for (const line of ps.split('\n')) {
          if (!line.includes(outFile)) continue;
          const pid = line.trim().split(/\s+/)[0];
          let cmd = '';
          try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch {}
          const graphFile = cmd.split(/\s+/).find((a) => a.endsWith('.txt'));
          let graph = cmd;
          if (graphFile && fs.existsSync(graphFile)) graph = fs.readFileSync(graphFile, 'utf8');
          return { pid, graph };
        }
      } catch { /* ffmpeg not up yet */ }
      await sleep(500);
    }
    return null;
  };
  await ev(`window.__fve.dispatch({ type: 'setClipRole', track: 'audio', id: 'a1', role: 'music' })`);
  // Clear the compressor/EQ the P2-21 step put on the clip so the export
  // comparison measures the bus alone.
  await ev(`window.__fve.dispatch({ type: 'update', track: 'audio', id: 'a1', patch: { audioFx: null } })`);
  await ev(`window.__fve.dispatch({ type: 'setMixer', patch: { music: -20, master: 0 } })`);
  const outQuiet = path.join(dir, 'ui-export.mp4');
  const d0 = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  const encQuiet = await captureEncoderGraph(outQuiet);
  check('quiet export encoder runs with music bus volume=0.1', !!encQuiet && encQuiet.graph.includes('volume=0.1'), encQuiet ? `pid=${encQuiet.pid}` : 'no encoder seen');
  check('quiet export job settles', await waitJobDone(d0));
  check('quiet export file lands', await waitFile(outQuiet), outQuiet);
  const ratioQuiet = mixRatio(outQuiet);
  fs.rmSync(outQuiet, { force: true });
  await ev(`window.__fve.dispatch({ type: 'setMixer', patch: { music: 0 } })`);
  const d1 = await doneCount();
  await evFire(`window.__fve.exportNow()`);
  const encLoud = await captureEncoderGraph(outQuiet);
  check('loud export encoder runs without the 0.1 bus volume', !!encLoud && !encLoud.graph.includes('volume=0.1'), encLoud ? `pid=${encLoud.pid}` : 'no encoder seen');
  check('loud export job settles', await waitJobDone(d1));
  check('loud export file lands', await waitFile(outQuiet), outQuiet);
  const ratioLoud = mixRatio(outQuiet);
  check('music bus -20 dB shifts the music/dialogue balance ~20 dB in a real export', ratioQuiet != null && ratioLoud != null && (ratioLoud - ratioQuiet) > 15 && (ratioLoud - ratioQuiet) < 25, `ratio quiet=${ratioQuiet} loud=${ratioLoud} shift=${ratioLoud - ratioQuiet}`);
} catch (e) {
  console.log('DRIVER ERROR', e.message);
  console.log('stderr tail:', stderr.slice(-2000));
  try { const { data } = await cdp.call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shotDir, 'error.png'), Buffer.from(data, 'base64')); } catch {}
} finally {
  const fails = results.filter(([, ok]) => !ok);
  console.log(`\nP2-UI-LIVE: ${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('failures:', fails.map(([n]) => n).join(' | '));
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} process.exit(fails.length ? 1 : 0); }, 1500);
}
