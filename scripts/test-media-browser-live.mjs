// Live-app check for the P1-47 Advanced Media Browser: boots the built app
// headless (Xvfb), seeds a 120-item library via __fve.load, and drives the
// Media tab's search / sort / favorites filter / empty state end to end.
// Run AFTER `npm run build`:  node scripts/test-media-browser-live.mjs
// Writes result.json + a screenshot into tmp/media-browser/ (worktree tmp).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9227;
const HOME = '/tmp/fve-p1b4-item12';
const TMPDIR = path.join(ROOT, 'tmp');
const OUT = path.join(TMPDIR, 'media-browser');
const { ffmpegPath } = await import('../electron/ffmpeg.cjs');

fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const dir = fs.mkdtempSync(path.join(TMPDIR, 'fve-media-browser-'));

const results = [];
const check = (name, cond, extra = '') => {
  results.push([name, !!cond, extra]);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
};

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
    ws.onopen = () => resolve({
      call: (method, params = {}) => new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
      close: () => ws.close(),
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---- Fixtures: one tiny video / image / audio, copied to 120 distinct files ----
const gen = (args) => execFileSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
gen(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'base.mp4')]);
gen(['-f', 'lavfi', '-i', 'color=c=0x2a4a6b:size=320x180:duration=0.1', '-frames:v', '1', path.join(dir, 'base.png')]);
gen(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', path.join(dir, 'base.mp3')]);

const media = [];
const add = (id, name, type, ext, base, duration, extra = {}) => {
  const file = path.join(dir, `${id}.${ext}`);
  fs.copyFileSync(path.join(dir, base), file);
  media.push({ id, name, type, path: file, duration, width: 320, height: 180, addedAt: 1000 + media.length * 1000, ...extra });
};
// Named items the assertions target; the rest pad the library to 120.
add('m-interview', 'Interview Final.mp4', 'video', 'mp4', 'base.mp4', 10);
add('m-apple', 'Apple Orchard.mp4', 'video', 'mp4', 'base.mp4', 120);
add('m-zebra', 'Zebra Crossing.mp4', 'video', 'mp4', 'base.mp4', 3);
add('m-night', 'Night B-Roll.mp4', 'video', 'mp4', 'base.mp4', 8, { tags: 'b-roll, night' });
add('m-tts', 'Voice - hello.mp3', 'audio', 'mp3', 'base.mp3', 20, { origin: 'tts' });
for (let i = 0; i < 12; i += 1) add(`m-beach-${i}`, `Beach Drone ${String(i + 1).padStart(2, '0')}.mp4`, 'video', 'mp4', 'base.mp4', 5 + i);
for (let i = media.length; i < 120; i += 1) {
  const kind = i % 3;
  if (kind === 0) add(`m-g${i}`, `Clip ${String(i).padStart(3, '0')}.mp4`, 'video', 'mp4', 'base.mp4', (i % 90) + 1);
  else if (kind === 1) add(`m-g${i}`, `Photo ${String(i).padStart(3, '0')}.png`, 'image', 'png', 'base.png', 0);
  else add(`m-g${i}`, `Sound ${String(i).padStart(3, '0')}.mp3`, 'audio', 'mp3', 'base.mp3', (i % 60) + 1);
}

const project = {
  name: 'Media Browser check', ratio: '16:9', resolution: 720, width: 1280, height: 720, fps: 30, background: '#000000',
  media,
  // The interview clip is first on the timeline (span 0-10s); the caption at
  // 2-5s attributes its dialogue to it and to nothing else.
  videoClips: [
    { id: 'v1', mediaId: 'm-interview', in: 0, out: 10, speed: 1, volume: 1, muted: false },
    { id: 'v2', mediaId: 'm-apple', in: 0, out: 10, speed: 1, volume: 1, muted: false },
  ],
  audioClips: [], overlayClips: [], stickerClips: [], effectClips: [],
  textClips: [
    { id: 'cap1', caption: true, text: 'we filmed this in marrakech last spring', start: 2, duration: 3, words: [] },
    { id: 't1', caption: false, text: 'a title, not dialogue', start: 1, duration: 2 },
  ],
};

const env = {
  ...process.env, HOME, DISPLAY: ':99', TMPDIR,
  VK_ICD_FILENAMES: path.join(os.homedir(), 'workspace/vulkan/lvp_icd.json'),
};
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'),
  ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`],
  { cwd: ROOT, env, stdio: 'pipe', detached: true });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const killChild = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } } };

try {
  const page = await waitTarget();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => {
    const r = await cdp.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };
  const waitFor = async (expr, label, tries = 60) => {
    for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* page mid-navigation */ } await sleep(500); }
    throw new Error('timeout waiting for ' + label);
  };
  const setSearch = (v) => ev(`(() => {
    const el = document.querySelector('.media-search input[type=search]');
    if (!el) throw new Error('no media search box');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    desc.set.call(el, ${JSON.stringify(v)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  const cardCount = () => ev(`document.querySelectorAll('.asset-grid .asset').length`);
  const cardNames = () => ev(`[...document.querySelectorAll('.asset-grid .asset .asset-name')].map((n) => n.textContent)`);
  const countText = () => ev(`document.querySelector('.media-count')?.textContent || ''`);

  await waitFor(`!!document.querySelector('.home-create')`, 'home');
  await ev(`document.querySelector('.home-create').click()`);
  await waitFor(`!!document.querySelector('section.timeline')`, 'editor timeline');
  // First-run Welcome modal swallows pointer hits: dismiss it first.
  if (await ev(`!!document.querySelector('.welcome-go')`)) {
    await ev(`document.querySelector('.welcome-go').click()`);
    await sleep(400);
  }
  await ev(`window.__fve.load(${JSON.stringify(project)})`);
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 120`, '120 media cards');
  // The Welcome card opens on editor entry once the async first-run flags
  // land, which can be after the first dismiss above — dismiss again here.
  if (await ev(`!!document.querySelector('.welcome-go')`)) {
    await ev(`document.querySelector('.welcome-go').click()`);
    await sleep(400);
  }

  check('search box present in Media tab', await ev(`!!document.querySelector('.media-search input[type=search]')`));
  check('baseline: 120 cards', (await cardCount()) === 120, String(await cardCount()));
  check('default sort is date added (newest first)', (await cardNames())[0] === 'Sound 119.mp3', (await cardNames())[0]);

  // Name search + results count.
  const t0 = performance.now();
  await setSearch('beach');
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 12`, 'beach results');
  const searchMs = performance.now() - t0;
  check('name search finds the 12 beach clips', (await cardCount()) === 12, String(await cardCount()));
  check('results count reads "12 of 120 · ranked by relevance"', (await countText()) === '12 of 120 · ranked by relevance', await countText());
  console.log(`live search (120 items, name query): ${searchMs.toFixed(1)} ms to rendered results`);

  // Tag search: 'night' lives only in the Night B-Roll item's tags.
  await setSearch('night');
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 1`, 'night results');
  check('tag search finds the tagged clip', (await cardNames())[0] === 'Night B-Roll.mp4', (await cardNames())[0]);

  // Transcript search: 'marrakech' is spoken, not in any file name.
  await setSearch('marrakech');
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 1`, 'marrakech results');
  check('dialogue search finds the interview clip', (await cardNames())[0] === 'Interview Final.mp4', (await cardNames())[0]);
  check('dialogue hit carries the Dialogue badge', await ev(`!!document.querySelector('.asset-grid .asset .asset-opt.transcript')`));
  await shot('media-browser-transcript.png');

  // Sort: name A-Z, then duration longest first.
  await setSearch('');
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 120`, 'cleared results');
  await ev(`(() => { const s = document.querySelector('.media-sort'); s.value = 'name'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(`(document.querySelector('.asset-grid .asset .asset-name')?.textContent || '') === 'Apple Orchard.mp4'`, 'name sort');
  check('sort by name: Apple Orchard first', (await cardNames())[0] === 'Apple Orchard.mp4', (await cardNames())[0]);
  await ev(`(() => { const s = document.querySelector('.media-sort'); s.value = 'duration'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(`(document.querySelector('.asset-grid .asset .asset-name')?.textContent || '') === 'Apple Orchard.mp4'`, 'duration sort');
  check('sort by duration: 120s Apple Orchard first', (await cardNames())[0] === 'Apple Orchard.mp4');

  // Favorites-only: star the first card, filter to it, unfilter.
  await ev(`document.querySelector('.asset-grid .asset .fav-star').click()`);
  await waitFor(`!!document.querySelector('.asset-grid .asset .fav-star.on')`, 'star on');
  await ev(`[...document.querySelectorAll('.media-fav-only')].find((b) => b.textContent.includes('Favorites only'))?.click()`);
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 1`, 'favorites-only results');
  check('favorites-only shows just the starred clip', (await cardCount()) === 1 && (await cardNames())[0] === 'Apple Orchard.mp4', (await cardNames())[0]);
  await ev(`[...document.querySelectorAll('.media-fav-only')].find((b) => b.textContent.includes('Favorites only'))?.click()`);
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 120`, 'favorites off');

  // Empty state + clear action.
  await setSearch('zzz-no-such-media');
  await waitFor(`!!document.querySelector('.media-empty-search')`, 'empty state');
  check('empty state says no media matches', (await ev(`document.querySelector('.media-empty-search p')?.textContent || ''`)).includes('No media matches'), await ev(`document.querySelector('.media-empty-search p')?.textContent || ''`));
  await ev(`document.querySelector('.media-empty-search button')?.click()`);
  await waitFor(`document.querySelectorAll('.asset-grid .asset').length === 120`, 'cleared after empty state');
  check('clear search restores all 120', (await cardCount()) === 120, String(await cardCount()));
  check('search box is empty after clear', (await ev(`document.querySelector('.media-search input[type=search]')?.value`)) === '');

  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, searchMs }, null, 2));
} catch (e) {
  console.log('FAIL  live suite error: ' + e.message);
  results.push(['live suite error', false, e.message]);
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ results, stderr: stderr.slice(-2000) }, null, 2));
} finally {
  killChild();
}
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `media-browser-live: ${failed} FAILURES` : 'media-browser-live: ALL PASS');
process.exit(failed ? 1 : 0);
