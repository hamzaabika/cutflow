const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');

app.setName('ClipCraft');
// FB-17 (P1-22) — adaptive hardware video decode. The decode switch must be
// set before the first window's GPU process starts, so the decision runs
// here, at startup, from (in order) the safe-mode + videoDecode settings,
// the FVE_GPU_VIDEO env override, the GPU fingerprint cached from the last
// launch, and this FFmpeg build's accelerator list — see
// electron/hwdecode.cjs. First launch has no fingerprint: 'auto' resolves
// to CPU, the safe default, exactly like the old unconditional disable.
// Videos are decoded on the CPU, not the graphics chip. On some PCs (seen with an Intel HD 530 and its 2022
// driver) the graphics process crashed again and again while playing, and the player went black for a moment
// each time. The player only plays H.264 / VP9 / AV1 up to 1080p (heavier files get a light preview copy), which
// any CPU decodes easily. That HD 530 workaround is NOT removed: the denylist in hwdecode.cjs keeps
// Skylake HD 510/520/530 on CPU decode until it is verified fixed on real hardware.
let decodeDecision = { mode: 'cpu', reason: 'Startup decision not yet resolved.', deniedBy: null, hwaccel: null, renderer: '' };
try {
  const hw = require('./hwdecode.cjs');
  const st = require('./settings.cjs');
  const fp = st.getGpuFingerprint();
  const gpuInfo = fp ? { gpuDevice: [{ active: true, deviceName: fp.renderer }] } : null;
  decodeDecision = hw.resolveDecodeMode({
    env: process.env,
    settings: { videoDecode: st.getVideoDecode(), safeMode: st.getSafeMode() },
    gpuInfo,
    hwaccels: hw.probeHwaccels(require('./ffmpeg.cjs').ffmpegPath),
  });
} catch (e) { decodeDecision = { mode: 'cpu', reason: `Decode decision failed (${e.message}) — CPU decode kept.`, deniedBy: null, hwaccel: null, renderer: '' }; }
if (decodeDecision.mode !== 'hardware') app.commandLine.appendSwitch('disable-accelerated-video-decode');
// Inside the Snap (and other confined runtimes) Chromium cannot create shared
// memory in /dev/shm and the app traps on launch — seen on the Snap Store build
// 2026-11-09: 'Creating shared memory in /dev/shm ... Permission denied (13)'
// then 'Trace/breakpoint trap (core dumped)'. Keep shared memory in /tmp
// instead; verified by hand with `cutflow --disable-dev-shm-usage`.
app.commandLine.appendSwitch('disable-dev-shm-usage');
// The screen recording UI test uses Chromium's fake camera and microphone, never the real ones.
if (process.env.FVE_SMOKE && process.env.FVE_SMOKE_MODE === 'screenrec') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}
const path = require('path');
const fs = require('fs');
const os = require('os');
const { FxJobs } = require('./fxjobs.cjs');
const { mediaCacheStats, evictMediaCache, clearMediaCache } = require('./mediacache.cjs');
const { probe, runExport, runAudioExport, toM4a, renderTimelineAudio, detectSilences, makeVisuals, needsProxy, usableCopyFile, makeProxy, makeLightProxy, makeQualityProxy, hasLibx265, hasVp9, pickEncoder } = require('./ffmpeg.cjs');
const { remuxDecision, isFaststart, makeRemux } = require('./remux.cjs');
const { qualityTargetSize, pruneDeadCopies } = require('./quality.cjs');
const whisper = require('./whisper.cjs');
const cloudCaptions = require('./cloudCaptions.cjs');

// Whisper lived under the old app name; move it instead of downloading ~150 MB again.
const whisperDir = () => {
  const dir = path.join(app.getPath('userData'), 'whisper');
  const old = path.join(app.getPath('appData'), 'free-video-editor', 'whisper');
  if (!fs.existsSync(dir) && fs.existsSync(old)) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.renameSync(old, dir);
  }
  return dir;
};

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'aiff', 'aif', 'amr', 'ac3', 'mka'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'];

let win;
let currentExport = null;
let currentAudioJob = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0d12',
    title: 'Cutflow',
    // The .ico carries 16-256 px versions, so the title bar and taskbar stay sharp on Windows.
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pinned explicitly rather than relying on the Electron default (already true here).
      sandbox: true,
      // Dev server pages are http://localhost and must still read local media files.
      webSecurity: !process.env.VITE_DEV_SERVER_URL,
      // UI tests keep their local storage (the unsaved-project copy) in memory, away from the real one.
      ...(process.env.FVE_SMOKE ? { partition: 'fve-smoke' } : {}),
    },
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  if (!process.env.FVE_SMOKE) win.maximize();
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    win.webContents.send('app:closeRequest');
    clearTimeout(closeTimer);
    closeTimer = setTimeout(closeNow, 5000);
  });
  // The interface files may be missing for a moment (being rebuilt by "npm run build" / "npm start" in another
  // window) or the page may crash: load it again instead of leaving a black window.
  let reloads = 0;
  const reloadSoon = () => {
    if (reloads++ < 10) setTimeout(() => { if (win && !win.isDestroyed()) win.webContents.reload(); }, 1500);
  };
  win.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    logCrash('page failed to load', { code, desc });
    reloadSoon();
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    if (d.reason === 'clean-exit') return;
    logCrash('interface crashed', { reason: d.reason, exitCode: d.exitCode });
    recovered = true; // the interface reloads and restores the project it autosaved
    reloadSoon();
  });
  win.webContents.on('unresponsive', () => logCrash('interface not responding', {}));
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) logCrash('interface error', { message: String(message).slice(0, 500), at: `${path.basename(sourceId || '')}:${line}` });
  });
  win.webContents.on('did-finish-load', () => {
    // An empty page (index.html written but the scripts not yet): check that the interface started.
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.webContents.executeJavaScript("!!(document.getElementById('root') && document.getElementById('root').children.length)")
        .then((ok) => { if (ok) reloads = 0; else reloadSoon(); }).catch(() => {});
    }, 4000);
  });
  if (process.env.FVE_SMOKE) {
    win.webContents.once('did-finish-load', () => require('./smoke.cjs')(win, app, process.env.FVE_SMOKE));
  }
}

// ---- Crash log: <userData>/logs/crash.log, so a black or frozen window can be explained afterwards. ----
// Only what went wrong and the app's memory use: no project content, no keys.
let recovered = false;
const crashDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'logs') : path.join(app.getPath('userData'), 'logs'));
let lastLog = { key: '', at: 0 };
function logCrash(what, details) {
  try {
    const key = `${what}|${JSON.stringify(details)}`;
    if (key === lastLog.key && Date.now() - lastLog.at < 5000) return; // the same error repeating every frame
    lastLog = { key, at: Date.now() };
    const dir = crashDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'crash.log');
    const mem = app.getAppMetrics().map((m) => `${m.type}:${Math.round((m.memory?.workingSetSize || 0) / 1024)}MB`).join(' ');
    const line = `${new Date().toISOString()} v${app.getVersion()} ${what} ${JSON.stringify(details)} | memory ${mem}\n`;
    if (fs.existsSync(file) && fs.statSync(file).size > 300000) fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(-150000));
    fs.appendFileSync(file, line);
  } catch {
    // logging must never break the app
  }
}
// Graphics chip and driver, written with graphics process crashes.
let gpuName = '';
app.whenReady().then(() => app.getGPUInfo('complete')).then((info) => {
  const g = (info.gpuDevice || []).find((x) => x.active) || (info.gpuDevice || [])[0];
  // P2-36: a software renderer reports vendor/device 0 and no name at all
  // (verified on this VM) — "0:0 driver ?" is not a name, so say so plainly.
  // 'complete' (one-time, cached) carries auxAttributes; 'basic' does not.
  if (g) {
    gpuName = g.deviceName || info.auxAttributes?.gl_renderer
      || ((g.vendorId === 0 && g.deviceId === 0) ? 'Software rendering (no GPU reported)'
        : `${Number(g.vendorId).toString(16)}:${Number(g.deviceId).toString(16)} driver ${g.driverVersion || '?'}`);
    // FB-17: cache this launch's renderer for the NEXT launch's startup
    // decode decision (the switch must be set before getGPUInfo can answer).
    try { require('./settings.cjs').setGpuFingerprint(gpuName); } catch { /* fingerprint is best-effort */ }
  }
}).catch(() => {});
app.on('child-process-gone', (_e, d) => {
  if (d.reason === 'clean-exit') return;
  logCrash(`${d.type} process gone`, { reason: d.reason, exitCode: d.exitCode, name: d.name || '', ...(d.type === 'GPU' ? { gpu: gpuName } : {}) });
});
ipcMain.handle('app:recovered', () => {
  const r = recovered;
  recovered = false;
  return r;
});
ipcMain.handle('app:openCrashLog', () => {
  const file = path.join(crashDir(), 'crash.log');
  if (fs.existsSync(file)) shell.showItemInFolder(file);
  return fs.existsSync(file);
});

async function probeAll(files) {
  const items = [];
  for (const file of files) {
    try {
      const info = await probe(file);
      items.push({ path: file, name: path.basename(file), ...info });
    } catch (e) {
      items.push({ path: file, name: path.basename(file), error: e.message });
    }
  }
  queueVisuals(items.filter((i) => !i.error));
  return items;
}

// Thumbnails and waveforms are generated in the background; the UI gets each result
// through 'media:visuals' so importing never waits for them. How many jobs run at once
// is the performance mode's concurrency knob (measured per mode — see PERF-REPORT).
const visualsQueue = [];
const visualsQueued = new Set();
const proxyRetried = new Set(); // "path|quality" keys already given their one retry this session
const remuxAttempted = new Set(); // "path|size|mtime" keys whose auto-remux was attempted this session
const previewProxyState = new Map(); // path -> { failed, retried } for the preview copy (QA2 RC3)
const forceProxyPaths = new Set(); // paths the user explicitly asked to retry (Retry buttons)
let visualsActive = 0;
const VISUALS_CONCURRENCY = { 'low-end': 1, balanced: 2, 'high-performance': 3 };

function queueVisuals(items) {
  for (const it of items) {
    if (visualsQueued.has(it.path)) continue;
    visualsQueued.add(it.path);
    visualsQueue.push(it);
  }
  pumpVisuals();
}

// Thumbnails, waveforms and preview proxies. Not "cache": on Windows that is the same folder as Chromium's own
// "Cache", which Chromium cleans, deleting our files. Proxies left there by older versions are moved over once.
let mediaCacheReady = false;
function mediaCacheDir() {
  // UI tests use their own folder (they make and delete proxies).
  const dir = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'media-cache-test') : path.join(app.getPath('userData'), 'media-cache');
  if (!mediaCacheReady) {
    mediaCacheReady = true;
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(app.getPath('userData'), 'cache');
    try {
      for (const f of fs.readdirSync(old)) {
        if (!/-proxy\.mp4$/.test(f)) continue; // thumbnails and waveforms are quick to make again
        try { fs.renameSync(path.join(old, f), path.join(dir, f)); } catch { /* in use or already there */ }
      }
    } catch { /* no old folder */ }
    // First use of the folder in this session: bound what an earlier session
    // left behind (eviction is best-effort — a folder that cannot evict just
    // stays over the cap, never an error at startup).
    try { evictMediaCache(dir, settings.getMediaCacheCapMB(), protectedCacheFiles()); } catch { /* eviction never fails startup */ }
  }
  return dir;
}

// Files the media-cache eviction must never delete: every generated copy the
// open project points at (proxies, light/quality copies, remux twins,
// thumbnails, waveforms, posters) plus any file a live fx job is reading.
// Everything else in the folder is regenerable — checkGenerated drops the
// pointer on the next load and pruneDeadCopies does the same mid-session,
// so the copy is simply made again when needed.
function protectedCacheFiles() {
  const out = [];
  try {
    for (const j of fxJobs.inUseFiles()) out.push(j);
  } catch { /* fx jobs not up yet */ }
  const p = liveProjectDoc;
  if (p) {
    for (const m of p.media || []) {
      for (const f of [m.proxy, m.lightProxy, m.remux, m.thumb, m.wave, m.poster]) if (typeof f === 'string' && f) out.push(f);
      if (m.proxies && typeof m.proxies === 'object') for (const f of Object.values(m.proxies)) if (typeof f === 'string' && f) out.push(f);
    }
  }
  return out;
}

function pumpVisuals() {
  const limit = VISUALS_CONCURRENCY[settings.getPerfMode()] || 2;
  while (visualsActive < limit && visualsQueue.length) {
    visualsActive++;
    processVisualItem(visualsQueue.shift())
      .catch(() => {})
      .finally(() => {
        visualsActive--;
        pumpVisuals();
        // The queue just drained: bound the media cache now, while nothing
        // is writing into it (eviction is best-effort and never fails the app).
        if (visualsActive === 0 && !visualsQueue.length) {
          try { evictMediaCache(mediaCacheDir(), settings.getMediaCacheCapMB(), protectedCacheFiles()); } catch { /* eviction never fails playback */ }
        }
      });
  }
}

async function processVisualItem(it) {
    const send = (v) => { if (win && !win.isDestroyed()) win.webContents.send('media:visuals', { path: it.path, ...v }); };
    const cache = mediaCacheDir();
    // Dead copy pointers first (see pruneDeadCopies in quality.cjs): clear them in the
    // renderer before anything else reads them, so the player falls back to a working
    // file at once; the generation paths below then remake the copies because the
    // entries read as missing (null), which is what they already key on. The predicate
    // is "usable as a playable file" (a real, non-empty regular file), not mere
    // existence: a directory or corrupt stub at a copy path otherwise reads as a ready
    // copy and blacks the player permanently (QA2 RC2).
    const pruned = pruneDeadCopies(it, usableCopyFile);
    if (pruned) {
      send(pruned.patch);
      it = pruned.item;
    }
    // Facts first: codec details for the proxy decisions, the container for
    // the remux decision. Probed once here when the renderer's subset lacks
    // them, patched back so the renderer's own decodability judgement
    // (needsPreviewCopy) works on facts instead of guessing "unknown", and
    // reused by every generation step below. The colour description rides
    // along too (P1-53): the library badge and the Grade panel's source line
    // read it, and an old project whose items predate those fields gets them
    // from this one re-probe instead of showing the bare "HDR" fallback.
    let info = it;
    const lackedFacts = it.vcodec === undefined || it.pixFmt === undefined || it.hdr === undefined || it.container === undefined || it.colorSpace === undefined;
    if (lackedFacts) {
      info = { ...it, ...(await probe(it.path).catch(() => ({}))) };
      if (info.vcodec !== undefined) {
        send({ vcodec: info.vcodec, pixFmt: info.pixFmt, profile: info.profile, hdr: info.hdr, acodec: info.acodec, channels: info.channels, fps: info.fps, fpsExact: info.fpsExact, fpsRational: info.fpsRational, rotation: info.rotation, container: info.container, colorSpace: info.colorSpace, colorPrimaries: info.colorPrimaries, colorTransfer: info.colorTransfer, colorRange: info.colorRange });
      }
    }
    // Auto-remux (electron/remux.cjs): a stream-copied fast-seek twin for
    // containers that seek poorly. The DECISION uses the original's facts;
    // the generation steps below then decode FROM the copy (identical
    // streams, faster and frame-accurate seeks), and the export graphs read
    // it through mediaMap in ffmpeg.cjs. One attempt per file version per
    // session; a failure is a state (remuxFailed), never a loop — the
    // original keeps serving throughout.
    let srcInfo = info;
    if (info.type === 'video') {
      if (typeof it.remux === 'string' && usableCopyFile(it.remux)) {
        srcInfo = { ...info, path: it.remux };
      } else {
        const tokens = String(info.container || '').split(',');
        const fst = (tokens.includes('mp4') || tokens.includes('mov')) ? isFaststart(it.path) : null;
        if (remuxDecision(info, fst).needed) {
          let akey = it.path;
          try { const s = fs.statSync(it.path); akey = `${it.path}|${s.size}|${s.mtimeMs}`; } catch { /* path alone */ }
          if (!remuxAttempted.has(akey)) {
            remuxAttempted.add(akey);
            try {
              const rp = await makeRemux(info, cache);
              it = { ...it, remux: rp };
              send({ remux: rp, remuxFailed: false });
              srcInfo = { ...info, path: rp };
            } catch {
              send({ remuxFailed: true });
            }
          }
        }
      }
    }
    await makeVisuals(srcInfo, cache, send, { lite: settings.getPerfMode() === 'low-end' }).catch(() => {});
    // Preview proxy for video the player cannot decode well (projects saved earlier lack the codec details).
    try {
      let proxyPath = it.proxy;
      if (needsProxy(info)) {
        // Preview-copy failure is a STATE, not a silent catch (QA2 RC3): the first
        // failure is retried once automatically (the renderer re-queues the item when
        // the flag lands); after that only an explicit user retry (force) tries again.
        // A usable saved copy keeps playing throughout: makeProxy is still consulted
        // because its cache key covers the source's size+mtime, so a file replaced
        // under the same path earns a fresh copy and a fresh pointer.
        const st = previewProxyState.get(it.path) || {};
        const forced = forceProxyPaths.delete(it.path);
        const haveUsable = typeof proxyPath === 'string' && proxyPath !== '';
        if (!haveUsable && st.failed && st.retried && !forced) {
          proxyPath = null; // already retried: leave the failed state the renderer shows
        } else {
          // This attempt IS the retry when a failure is already on record; the flag is
          // written before the attempt and preserved in the catch — reading the stale
          // snapshot there would reset it and loop the retries forever.
          const isRetry = !!st.failed;
          if (!haveUsable) {
            previewProxyState.set(it.path, { failed: true, retried: isRetry });
            send({ optimizing: true, proxyFailed: false });
          }
          try {
            proxyPath = await makeProxy(srcInfo, cache);
            previewProxyState.delete(it.path);
            send({ proxy: proxyPath, proxyFailed: false, optimizing: false });
          } catch {
            if (haveUsable) {
              send({ optimizing: false }); // the saved copy still plays; not a failure
            } else {
              previewProxyState.set(it.path, { failed: true, retried: isRetry });
              proxyPath = null;
              send({ proxyFailed: true, optimizing: false });
            }
          }
        }
      }
      // The light copy (Sprint 9): the player's universal fallback below Full —
      // store.js previewPathFor consults item.lightProxy for every level, but until
      // now nothing generated one, so the fallback never existed and a missing
      // level copy fell straight back to the full-size original. It is the
      // cheapest copy to build (540 px shorter side, fastdecode), so it is made
      // first and the level copies below refine from it. Only when it would
      // actually be smaller than the source; a failed build is a state (false),
      // like a failed level copy, not a silent retry loop.
      const quality = settings.getQuality();
      if (info.type === 'video' && quality !== 'full' && it.lightProxy == null
        && Math.min(info.width || 0, info.height || 0) > 540) {
        try {
          send({ lightProxy: await makeLightProxy(srcInfo, cache) });
        } catch {
          send({ lightProxy: false });
        }
      }
      // Playback quality below Full: the level's scaled copy (see quality.cjs). While it is missing the
      // player falls back to smaller copies / the original; the patch swaps it in when ready. A source
      // that already fits the level needs no copy: the level resolves to the full-quality chain itself.
      if (info.type === 'video' && quality !== 'full') {
        const prev = it.proxies && typeof it.proxies === 'object' ? it.proxies : {};
        // A failed copy (proxies[q] === false) used to be final until the file
        // was re-imported. Now it is retried ONCE per session per file+level:
        // the renderer re-queues 'failed' items, this set is the brake that
        // keeps a persistently failing source from looping forever.
        const retryKey = `${it.path}|${quality}`;
        const mayRetry = prev[quality] === false && !proxyRetried.has(retryKey);
        if (prev[quality] === false && !mayRetry) {
          // Already retried this session: leave the failure state untouched.
        } else if (prev[quality] == null || mayRetry) {
          if (mayRetry) proxyRetried.add(retryKey);
          if (!qualityTargetSize(info.width, info.height, quality)) {
            send({ proxies: { ...prev, [quality]: proxyPath && fs.existsSync(proxyPath) ? proxyPath : it.path } });
          } else {
            send({ optimizing: true });
            try {
              send({ proxies: { ...prev, [quality]: await makeQualityProxy(srcInfo, cache, quality) }, optimizing: false });
            } catch {
              send({ proxies: { ...prev, [quality]: false }, optimizing: false }); // retried once per session (see above)
            }
          }
        }
      }
    } catch {
      send({ optimizing: false });
    }
    visualsQueued.delete(it.path);
}

// Playback quality: the current level, the space the scaled copies take, and deleting them
// (only at Full quality, so the player is never left pointing at deleted files).
const proxyFiles = () => {
  try {
    return fs.readdirSync(mediaCacheDir()).filter((f) => /-(lproxy|qhigh|qmedium|qlow)\.mp4$/.test(f)).map((f) => path.join(mediaCacheDir(), f));
  } catch {
    return [];
  }
};
const proxyStatus = () => {
  const quality = settings.getQuality();
  const files = proxyFiles();
  const fxSeg = fxJobs.cacheStats();
  const mc = mediaCacheStats(mediaCacheDir());
  return {
    on: quality !== 'full', quality, files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0),
    fxSegments: { files: fxSeg.entries, bytes: fxSeg.bytes, capMB: settings.getFxCacheCapMB() },
    mediaCache: { files: mc.files, bytes: mc.bytes, capMB: settings.getMediaCacheCapMB() },
  };
};
ipcMain.handle('proxy:status', () => proxyStatus());

// System status (FB-30 / P1-45): one snapshot for the tray's System section,
// so no async job runs without visible status. Proxy + fx/media cache come
// from proxyStatus(); the AI model states are the same status() calls the
// panels already use on demand (Whisper / matting / reframe / Piper —
// installed, and which models/voices are downloaded); `active` is the set
// of main-process jobs currently running, so the tray can show progress
// (from the renderer's progress listeners) and offer cancel. Captions runs
// through its own flag because captions:run has no job variable of its own.
let captionsJob = null; // { model } while a captions run is in flight
const systemStatus = () => {
  let whisperSt = null;
  let mattingSt = null;
  let reframeSt = null;
  let piperSt = null;
  try { whisperSt = whisper.status(whisperDir()); } catch { /* status must never break the tray */ }
  try { mattingSt = matting.status(mattingDir()); } catch { /* see above */ }
  try { reframeSt = reframe.status(reframeDir()); } catch { /* see above */ }
  try { piperSt = tts.piperStatus(ttsDir()); } catch { /* see above */ }
  return {
    proxy: proxyStatus(),
    models: { whisper: whisperSt, matting: mattingSt, reframe: reframeSt, piper: piperSt },
    fxCache: { ...fxJobs.cacheStats(), active: fxJobs.jobs.size },
    active: {
      matting: mattingJob ? { path: mattingJob.path } : null,
      reframe: !!reframeJob,
      enhance: !!enhanceJob,
      audioFx: !!audioFxJob,
      translate: !!translateJob,
      captions: captionsJob ? { model: captionsJob.model } : null,
      esrgan: !!esrganJob,
      detach: !!detachJob,
      reverse: !!revJob,
      tts: !!ttsJob,
    },
  };
};
ipcMain.handle('system:status', () => systemStatus());

// Retry a failed model download (FB-30): installs one model through the
// same install path its panel uses on first run, reporting progress on the
// same channel the tray already listens to. Ids: whisper-base /
// whisper-turbo / whisper-darija, matting, reframe, piper (engine + the
// first voice). Anything else is refused — the tray only ever offers the
// models the status snapshot reports as missing.
ipcMain.handle('models:install', async (_e, id) => {
  const sendCap = (stage, progress) => { if (win && !win.isDestroyed()) win.webContents.send('captions:progress', { stage, progress }); };
  const sendMat = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('matting:progress', { path: '', stage, fraction }); };
  const sendRef = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('reframe:progress', { stage, fraction }); };
  const sendTts = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('tts:progress', { stage, fraction }); };
  try {
    if (id === 'matting') {
      sendMat('download', 0);
      await matting.install(mattingDir(), (f) => sendMat('download', f), net.fetch);
      return { ok: true };
    }
    if (id === 'reframe') {
      sendRef('download', 0);
      await reframe.install(reframeDir(), (f) => sendRef('download', f), net.fetch);
      return { ok: true };
    }
    if (id === 'piper') {
      const voice = (tts.PIPER_VOICES || [])[0];
      if (!voice) return { error: 'No Piper voice is available.' };
      await tts.piperPrepare(net.fetch, ttsDir(), voice.id, sendTts);
      return { ok: true };
    }
    const model = { 'whisper-base': 'base', 'whisper-turbo': 'turbo', 'whisper-darija': 'darija' }[id];
    if (model) {
      await whisper.install(whisperDir(), (what, f) => sendCap(`Downloading ${what}`, f), model);
      return { ok: true };
    }
    return { error: `Unknown model: ${id}` };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('proxy:set', (_e, on) => {
  settings.setProxy(on === true);
  return proxyStatus();
});
ipcMain.handle('proxy:setQuality', (_e, q) => {
  settings.setQuality(q);
  return proxyStatus();
});
// The fx segment cache cap (Settings → Playback quality): stored in MB; the
// eviction in fxjobs.cjs reads it on the next publish.
ipcMain.handle('proxy:setFxCacheCap', (_e, mb) => {
  settings.setFxCacheCapMB(mb);
  return proxyStatus();
});
// Media cache cap + clear (P1-26): changing the cap prunes immediately (the
// fx cap applies to the next publish instead — the media cache is checked on
// every visuals drain, so a smaller cap takes effect here, not on the next
// import). Clearing mirrors proxy:clear — only at Full quality, so the
// player is never left pointing at deleted copies.
ipcMain.handle('proxy:setMediaCacheCap', (_e, mb) => {
  settings.setMediaCacheCapMB(mb);
  try { evictMediaCache(mediaCacheDir(), settings.getMediaCacheCapMB(), protectedCacheFiles()); } catch { /* eviction is best-effort */ }
  return proxyStatus();
});
ipcMain.handle('proxy:clearMediaCache', () => {
  if (settings.getQuality() !== 'full') return { ...proxyStatus(), deleted: [] };
  const deleted = clearMediaCache(mediaCacheDir(), protectedCacheFiles());
  return { ...proxyStatus(), deleted };
});
// Performance mode: a bundle applied on selection — Low-End defaults playback to the
// Low tier, High-Performance to Full, Balanced leaves the user's tier alone. The other
// knobs (visuals concurrency, export priority) read the persisted mode where they run.
ipcMain.handle('perf:getMode', () => settings.getPerfMode());
ipcMain.handle('perf:setMode', (_e, mode) => {
  const m = settings.setPerfMode(mode);
  if (m === 'low-end') settings.setQuality('low');
  if (m === 'high-performance') settings.setQuality('full');
  pumpVisuals(); // a wider or narrower gate applies to the queue right away
  return { mode: m, ...proxyStatus() };
});
ipcMain.handle('proxy:clear', () => {
  if (settings.getQuality() !== 'full') return { ...proxyStatus(), deleted: [] };
  const deleted = [];
  for (const f of proxyFiles()) {
    try {
      fs.rmSync(f);
      deleted.push(f);
    } catch { /* still open in the player */ }
  }
  return { ...proxyStatus(), deleted };
});

// Adjust > Auto: a few small frames of the clip (the analysis itself runs in the renderer, src/fx/autocolor.js).
ipcMain.handle('color:sample', async (_e, item, from, to) => {
  try {
    if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
    const frames = await require('./ffmpeg.cjs').sampleFrames(item, from, to);
    return frames.length ? { frames } : { error: 'Could not read pictures from this clip.' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('media:ensureVisuals', (_e, items, opts) => {
  // A user-pressed Retry (stage chip / media card) forces one fresh preview-copy
  // attempt for those paths, past the once-per-session automatic retry brake.
  if (opts && opts.force) for (const i of items || []) if (i && i.path) forceProxyPaths.add(i.path);
  return queueVisuals((items || []).filter((i) => i && fs.existsSync(i.path)));
});

ipcMain.handle('media:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
      { name: 'Video', extensions: VIDEO_EXT },
      { name: 'Audio', extensions: AUDIO_EXT },
      { name: 'Images', extensions: IMAGE_EXT },
    ],
  });
  return res.canceled ? [] : probeAll(res.filePaths);
});

// Files dropped from Explorer.
ipcMain.handle('media:probe', (_e, files) => {
  const ok = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT];
  return probeAll(files.filter((f) => ok.includes(path.extname(f).slice(1).toLowerCase())));
});

// Voice-over recorded in the UI (MediaRecorder webm) -> m4a in the user data folder.
ipcMain.handle('media:saveRecording', async (_e, bytes) => {
  const dir = path.join(app.getPath('userData'), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const webm = path.join(dir, `voiceover-${stamp}.webm`);
  fs.writeFileSync(webm, Buffer.from(bytes));
  const m4a = await toM4a(webm, webm.replace(/\.webm$/, '.m4a'));
  fs.rmSync(webm, { force: true });
  return (await probeAll([m4a]))[0];
});

// ---- Your fonts: .ttf / .otf / .woff / .woff2 kept in <userData>/fonts for every project. ----
const userFonts = require('./fonts.cjs');
const fontDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'fonts-test') : path.join(app.getPath('userData'), 'fonts'));
const fontList = () => userFonts.list(fontDir()).map(({ id, name }) => ({ id, name }));
ipcMain.handle('fonts:list', () => fontList());
ipcMain.handle('fonts:import', async (_e, files) => {
  try {
    let paths = Array.isArray(files) ? files.filter((f) => typeof f === 'string') : null;
    if (!paths) {
      const res = await dialog.showOpenDialog(win, {
        title: 'Add fonts', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Fonts', extensions: userFonts.EXT.map((x) => x.slice(1)) }],
      });
      if (res.canceled) return { added: [], skipped: [], list: fontList() };
      paths = res.filePaths;
    }
    return { ...userFonts.add(fontDir(), paths), list: fontList() };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('fonts:data', (_e, id) => {
  const file = userFonts.fileOf(fontDir(), id);
  return file ? fs.readFileSync(file) : null;
});
ipcMain.handle('fonts:remove', (_e, id) => {
  try {
    userFonts.remove(fontDir(), id);
  } catch (e) {
    return { error: e.message };
  }
  return { list: fontList() };
});

// ---- Favorites (sounds, videos, photos), kept across projects. UI tests use their own file. ----
const favorites = require('./favorites.cjs');
const favDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'favorites-test') : app.getPath('userData'));
ipcMain.handle('favorites:list', () => favorites.list(favDir()));
ipcMain.handle('favorites:toggle', (_e, entry) => {
  try {
    return favorites.toggle(favDir(), entry);
  } catch (e) {
    return { error: e.message };
  }
});

// ---- Creative packs (P2-14): versioned preset packs with an asset manifest.
// The packs dir follows the FVE_SMOKE test override like fonts/favorites.
const packs = require('./packs.cjs');
const packsDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'packs-test') : path.join(app.getPath('userData'), 'packs'));
ipcMain.handle('packs:list', async () => {
  try { return { packs: packs.listPacks(packsDir()) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('packs:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Import creative pack',
    properties: ['openFile', 'openDirectory'],
    filters: [{ name: 'Cutflow pack', extensions: ['cutflowpack'] }],
  });
  if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'cancelled' };
  try { return await packs.importPack(packsDir(), res.filePaths[0]); } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('packs:export', async (_e, manifest) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export creative pack',
    defaultPath: `${packs.slug(manifest?.name || 'pack')}.cutflowpack`,
    filters: [{ name: 'Cutflow pack', extensions: ['cutflowpack'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, error: 'cancelled' };
  try { return await packs.exportPack(res.filePath, manifest); } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('packs:remove', async (_e, id) => {
  try { return packs.removePack(packsDir(), id); } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('packs:repair', async (_e, id, name) => {
  const res = await dialog.showOpenDialog(win, { title: `Locate ${name}`, properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, error: 'cancelled' };
  try { return await packs.repairAsset(packsDir(), id, name, res.filePaths[0]); } catch (e) { return { ok: false, error: e.message }; }
});

// ---- Audio library (Openverse / SFXMint / MyInstants + Soundza). Files live in <userData>/library. ----
const library = require('./library.cjs');
const soundza = require('./soundza.cjs');
const libraryDir = () => path.join(app.getPath('userData'), 'library');
// The Soundza key only ever comes from the encrypted settings. Local-fixture override for
// tests/development (cf. CLIPCRAFT_PACK_URL): while CLIPCRAFT_SOUNDZA_URL points the client
// at a fixture server, a key may come from the environment, because the test sandbox has no
// OS keyring to save one into. In normal runs the environment is never consulted.
const soundzaKey = () => settings.getServiceKey('soundza')
  || (process.env.CLIPCRAFT_SOUNDZA_URL ? process.env.CLIPCRAFT_SOUNDZA_KEY || '' : '');
const libraryPath = (item) => (String(item?.id || '').startsWith('soundza-')
  ? soundza.download(net.fetch, libraryDir(), item, soundzaKey())
  : library.download(net.fetch, libraryDir(), item));

ipcMain.handle('library:search', async (_e, opts) => {
  try {
    return await library.search(net.fetch, opts || {});
  } catch (e) {
    return { error: /fetch|ENOTFOUND|ERR_INTERNET|network/i.test(e.message) ? 'No internet connection.' : e.message };
  }
});
ipcMain.handle('library:file', async (_e, item) => {
  try {
    return { path: await libraryPath(item) };
  } catch (e) {
    return { error: e.message };
  }
});
// Adds a library sound as a media item; online sounds keep their license and credit line.
ipcMain.handle('library:add', async (_e, item) => {
  try {
    const file = await libraryPath(item);
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const credit = {
      title: item.title, creator: item.creator, license: item.license, licenseName: item.licenseName,
      licenseUrl: item.licenseUrl, landing: item.landing, providerName: item.providerName,
      line: item.provider === 'soundza' ? soundza.creditLine(item) : library.creditLine(item),
    };
    return { ...m, name: `${item.title}${path.extname(file) || '.mp3'}`, credit };
  } catch (e) {
    return { error: e.message };
  }
});

// ---- Sound effects (Soundza). The key stays in this process. ----
ipcMain.handle('soundza:status', () => ({ hasKey: !!soundzaKey() }));
// Tests a typed key (or the saved one) with a tiny search.
ipcMain.handle('soundza:test', async (_e, key) => {
  try {
    const k = String(key || '').trim() || soundzaKey();
    const r = await soundza.search(net.fetch, k, { q: 'whoosh' });
    return { ok: true, text: `Soundza works (a test search found ${r.results.length} sounds).` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
ipcMain.handle('soundza:search', async (_e, opts) => {
  try {
    return await soundza.search(net.fetch, soundzaKey(), opts || {});
  } catch (e) {
    return { error: e.message };
  }
});
// Preview MP3s are fetched once into the library folder (the page may only play local media).
ipcMain.handle('soundza:preview', async (_e, item) => {
  try {
    return { path: await soundza.preview(net.fetch, libraryDir(), item) };
  } catch (e) {
    return { error: e.message };
  }
});

// Project files the user picked in a Save or Open dialog: only these are written without asking (auto save).
const projectFiles = new Set();
// Transactional writes with rotating backups (electron/draftsafety.cjs): a save lands
// completely or the previous good state survives untouched, the payload is validated
// before anything is touched, and the last few states stay beside the file as .bakN.
const draftsafety = require('./draftsafety.cjs');
const writeProject = (file, json) => draftsafety.writeProjectTx(file, json);
// Version history (electron/versions.cjs): snapshots of the project document per
// project id — explicit saves always record, background writers are throttled and
// content-deduped inside the store. History must never break a save: fully guarded.
const versionsStore = require('./versions.cjs');
const versionsDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'versions-test') : path.join(app.getPath('userData'), 'versions'));
const recordProjectVersion = (json, boundFile, force, source, idOverride) => {
  try {
    const p = draftsafety.parseProjectJson(json);
    const id = idOverride || p?.id;
    if (!id) return;
    versionsStore.recordVersion(versionsDir(), id, json, { source, boundFile: boundFile || null, force: !!force });
  } catch { /* a history failure is silent; the save itself already succeeded */ }
};
// Saves to the project's file, or asks where the first time (and for "Save as").
ipcMain.handle('project:save', async (_e, json, file, opts = {}) => {
  try {
    if (file && projectFiles.has(file) && !opts.saveAs) {
      writeProject(file, json);
      recordProjectVersion(json, file, true, 'save');
      bridgeNote(json, file);
      return file;
    }
    const name = String(opts.name || 'project').replace(/[\\/:*?"<>|]+/g, '').trim() || 'project';
    const res = await dialog.showSaveDialog(win, {
      title: opts.saveAs ? 'Save project as' : 'Save project',
      defaultPath: file || `${name}.clipcraft.json`,
      filters: [{ name: 'Project', extensions: ['json'] }],
    });
    if (res.canceled) return null;
    writeProject(res.filePath, json);
    projectFiles.add(res.filePath);
    recordProjectVersion(json, res.filePath, true, opts.saveAs ? 'save-as' : 'save');
    bridgeNote(json, res.filePath);
    return res.filePath;
  } catch (e) {
    return { error: `Could not save the project: ${e.message}` };
  }
});

// Checklist #7 — export the project with all its media as one .zip
// (backup / sharing). Missing media is reported, never silently dropped
// (the bundled JSON keeps those entries with their original paths); the
// job streams, so a multi-gigabyte project never sits in memory whole.
ipcMain.handle('project:exportZip', async (event, json, opts = {}) => {
  try {
    const project = JSON.parse(json);
    const name = String(opts.name || project.name || 'project').replace(/[\\/:*?"<>|]+/g, '').trim() || 'project';
    const res = await dialog.showSaveDialog(win, {
      title: 'Export project as ZIP',
      defaultPath: `${name}.zip`,
      filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    });
    if (res.canceled) return null;
    const { writeProjectZip } = require('./projectzip.cjs');
    return await writeProjectZip(project, name, res.filePath, (p) => {
      try { event.sender.send('zip:progress', p); } catch { /* window closed mid-zip */ }
    });
  } catch (e) {
    return { error: `Could not export the project ZIP: ${e.message}` };
  }
});
ipcMain.handle('zip:cancel', () => {
  try { return require('./projectzip.cjs').cancelProjectZip(); } catch { return false; }
});
// Auto save: rewrites an already chosen project file.
ipcMain.handle('project:autosave', (_e, file, json) => {
  if (!projectFiles.has(file)) return false;
  try {
    writeProject(file, json);
    recordProjectVersion(json, file, false, 'autosave');
    bridgeNote(json, file);
    return true;
  } catch {
    return false;
  }
});

// Loads a project file with the draft-safety fallback chain (draftsafety.cjs): the
// file itself, then its rotating .bakN backups, then the autosave slot bound to it —
// a damaged file opens as its newest surviving state instead of an error, and the
// result says where it came from (recoveredFrom) so the interface can tell the user.
// Also reports the project's missing source media (the relink flow). Returns one of
// { json, recoveredFrom, missing, packaged, totalMedia } | { missingFile: true } | { corrupt: true }.
const loadProjectFile = async (file) => {
  const pf = require('./projectfile.cjs');
  const entry = autosaveStore.slotForFile(autosaveDir(), file);
  const slot = entry ? autosaveStore.readSlot(autosaveDir(), entry.id) : null;
  const slotJson = slot?.project ? JSON.stringify(slot.project) : null;
  const r = draftsafety.readProjectWithFallback(file, slotJson, slot?.updatedAt || null);
  if (r.missing) return { missingFile: true };
  if (r.corrupt) return { corrupt: true };
  // A bundled project (a ZIP's <name>.clipcraft.json) writes its media
  // paths relative to the project file — resolve them against this file's
  // folder before anything probes or checks them (checklist #7).
  const packaged = pf.isPackagedProject(r.json);
  const json = pf.resolveRelativeMedia(r.json, path.dirname(file));
  // FB-19 (P1-27): old projects open under the current schema — migrate
  // before anything probes or checks them, so a v0 shape can never crash
  // the editor for a field it no longer writes.
  const mig = pf.migrateProject(json);
  const sized = await pf.refreshSizes(pf.checkGenerated(mig.json, mediaCacheDir()), probe);
  let totalMedia = 0;
  try { totalMedia = (JSON.parse(sized).media || []).length; } catch { totalMedia = 0; }
  return { json: sized, recoveredFrom: r.recoveredFrom || null, missing: pf.findMissingMedia(sized), packaged, totalMedia,
    migration: mig.migrated ? { from: mig.fromVersion, to: mig.toVersion, changes: mig.changes } : null };
};

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'Project', extensions: ['json'] }],
  });
  if (res.canceled) return null;
  const file = res.filePaths[0];
  const loaded = await loadProjectFile(file);
  if (loaded.missingFile) return null;
  if (loaded.corrupt) return { file, corrupt: true };
  projectFiles.add(file);
  bridgeNote(loaded.json, file);
  return { file, ...loaded };
});

// Reopen a known project file by path (Home screen recents): same load as project:open,
// no dialog. Returns null when the file is gone (and no backup survived it).
ipcMain.handle('project:openPath', async (_e, filePath) => {
  try {
    if (!filePath) return null;
    const loaded = await loadProjectFile(filePath);
    if (loaded.missingFile) return null;
    if (loaded.corrupt) return { file: filePath, corrupt: true };
    projectFiles.add(filePath);
    bridgeNote(loaded.json, filePath);
    return { file: filePath, ...loaded };
  } catch {
    return null;
  }
});

// Read a project file WITHOUT adopting it (Home's duplicate of a file-only recent):
// the same draft-safety load, but the file is not registered, nothing is noted as the
// bridge's live project, and no binding changes — the renderer copies the document
// into a fresh autosave slot under a fresh id.
ipcMain.handle('project:readPath', async (_e, filePath) => {
  try {
    if (!filePath) return null;
    const loaded = await loadProjectFile(filePath);
    if (loaded.missingFile || loaded.corrupt) return null;
    return { file: filePath, json: loaded.json, missing: loaded.missing, packaged: loaded.packaged, totalMedia: loaded.totalMedia };
  } catch {
    return null;
  }
});

// ---- Per-project autosave slots (electron/autosave.cjs): one slot per project id under
// <userData>/autosave, so Home is a switchboard — leaving a project (Home, another open,
// a new project) flushes its slot, and every project the user touched is listed there.
const autosaveStore = require('./autosave.cjs');
const autosaveDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'autosave-test') : path.join(app.getPath('userData'), 'autosave'));
ipcMain.handle('slots:write', (_e, record) => {
  const entry = autosaveStore.writeSlot(autosaveDir(), record);
  // Slot writes are also version-history fodder (throttled + deduped in the store), so
  // a project that was never saved to a file still has earlier states to go back to.
  if (entry && record?.projectJson) recordProjectVersion(record.projectJson, record.file || null, false, 'slot', record.id);
  if (entry && record?.projectJson) bridgeNote(record.projectJson, record.file || null);
  return entry;
});
ipcMain.handle('slots:list', () => autosaveStore.listSlots(autosaveDir()));
ipcMain.handle('slots:forFile', (_e, filePath) => autosaveStore.slotForFile(autosaveDir(), filePath));
ipcMain.handle('slots:read', (_e, id) => {
  const slot = autosaveStore.readSlot(autosaveDir(), id);
  // A slot bound to a project file adopts that file as known (same trust as project:openPath),
  // so the auto-save-to-file writes keep working for a project reopened from its slot.
  if (slot?.file && fs.existsSync(slot.file)) projectFiles.add(slot.file);
  // Missing source media rides along so opening the slot can offer the relink flow.
  if (slot?.project) slot.missing = require('./projectfile.cjs').findMissingMedia(JSON.stringify(slot.project));
  if (slot?.project) bridgeNote(slot.project, slot.file || null);
  return slot;
});

// ---- Version history (electron/versions.cjs) --------------------------------------
// list: the project's snapshots (newest first). read: one snapshot, refreshed through
// the same hygiene as a project open, ready to load as the project. record: an
// explicit restore point (the renderer records the CURRENT state before restoring an
// older one, so a restore is itself reversible).
ipcMain.handle('versions:list', (_e, id) => versionsStore.listVersions(versionsDir(), id));
ipcMain.handle('versions:read', async (_e, id, file) => {
  const raw = versionsStore.readVersion(versionsDir(), id, file);
  if (!raw) return null;
  const pf = require('./projectfile.cjs');
  const json = await pf.refreshSizes(pf.checkGenerated(pf.migrateProject(raw).json, mediaCacheDir()), probe);
  return { json, missing: pf.findMissingMedia(json) };
});
ipcMain.handle('versions:record', (_e, id, json, boundFile) => {
  try {
    return versionsStore.recordVersion(versionsDir(), id, json, { source: 'restore-point', boundFile: boundFile || null, force: true });
  } catch {
    return null;
  }
});
// P1-48: named versions — record the live project as a snapshot with a name
// (forced: naming is an explicit user act, like a save). Rename: only the
// index entry changes. Summary/diff/selective: pure store functions over the
// snapshot JSONs; '__current__' as a file means the live project JSON passed
// alongside, so a version can be compared against what is on screen now.
// Selective restore merges through the same hygiene as a project open and
// reports missing media the same way versions:read does. The store's CAP
// already bounds the count, so named snapshots cannot bloat the project.
ipcMain.handle('versions:createNamed', (_e, id, json, name, boundFile) => {
  try {
    return versionsStore.recordVersion(versionsDir(), id, json, { source: 'snapshot', name, boundFile: boundFile || null, force: true });
  } catch {
    return null;
  }
});
ipcMain.handle('versions:rename', (_e, id, file, name) => {
  try {
    return versionsStore.renameVersion(versionsDir(), id, file, name);
  } catch {
    return null;
  }
});
const versionsDoc = (_e, id, file, liveJson) => {
  if (file === '__current__') {
    try { return liveJson ? JSON.parse(liveJson) : null; } catch { return null; }
  }
  const raw = versionsStore.readVersion(versionsDir(), id, file);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
};
ipcMain.handle('versions:summary', (_e, id, file, liveJson) => {
  const doc = versionsDoc(_e, id, file, liveJson);
  return doc ? versionsStore.summarizeProject(doc) : null;
});
ipcMain.handle('versions:diff', (_e, id, fileA, fileB, liveJson) => {
  const a = versionsDoc(_e, id, fileA, liveJson);
  const b = versionsDoc(_e, id, fileB, liveJson);
  if (!a || !b) return null;
  return versionsStore.diffProjects(a, b);
});
ipcMain.handle('versions:selective', async (_e, id, file, currentJson, selection) => {
  const raw = versionsStore.readVersion(versionsDir(), id, file);
  if (!raw) return null;
  let snap; let cur;
  try { snap = JSON.parse(raw); cur = JSON.parse(currentJson); } catch { return null; }
  if (!snap || !cur) return null;
  const merged = versionsStore.selectiveRestore(cur, snap, selection);
  const pf = require('./projectfile.cjs');
  const json = await pf.refreshSizes(pf.checkGenerated(pf.migrateProject(JSON.stringify(merged)).json, mediaCacheDir()), probe);
  return { json, missing: pf.findMissingMedia(json) };
});
// Timed auto-backup (10/10 step 4, Filmora merge row 10): the renderer calls
// this on a cadence while a project is open; the STORE decides what lands —
// content dedupe skips an unchanged project and the background throttle caps
// it at one snapshot per MIN_INTERVAL, so the cadence produces a backup
// timeline, not a snapshot per tick. Never forced: an explicit save in the
// same window is the newer state and this must not duplicate it.
ipcMain.handle('versions:autoBackup', (_e, id, json, boundFile) => {
  try {
    return versionsStore.recordVersion(versionsDir(), id, json, { source: 'auto-backup', boundFile: boundFile || null, force: false });
  } catch {
    return null;
  }
});

// ---- Agent draft bridge (electron/bridge.cjs) --------------------------------
// A local (127.0.0.1-only), token-gated HTTP door for external agent tools.
// OFF unless the user enables it in Settings; while off nothing listens.
// Agents read the open project and propose edits on shadow drafts; the user
// reviews them in the editor (Agent drafts) and only an explicit accept — a
// revision compare-and-swap — commits one, through the same transactional
// write + slot + version path as a normal save. The bridge core tracks the
// live project from the save/autosave/open traffic below (noteLive): its
// revision moves only when the document content actually changes.
const bridgeCore = require('./bridge.cjs');
const bridgeDiscoveryFile = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'bridge-test.json') : path.join(app.getPath('userData'), 'bridge.json'));
const writeBridgeDiscovery = () => {
  try {
    const st = bridge.state();
    if (st.listening) fs.writeFileSync(bridgeDiscoveryFile(), JSON.stringify({ port: st.port, pid: process.pid, startedAt: Date.now(), version: st.version }), 'utf8');
    else fs.unlinkSync(bridgeDiscoveryFile());
  } catch { /* discovery is a convenience for local tools; the Settings pane shows the same facts */ }
};
// The parsed live document, kept from the same traffic that feeds the
// bridge (bridgeNote below): the derivative surface reads it.
let liveProjectDoc = null;
const ffmpegCore = require('./ffmpeg.cjs');
const { setExportPaused, clearExportPause } = require('./exportPause.cjs'); // P1-52
const { hasAudioFx, hasCleanVoice, hasRepair } = require('./audiofx.cjs');
const findBridgeClip = (p, clipId) => {
  if (!p || !clipId) return null;
  for (const track of ['videoClips', 'overlayClips', 'audioClips']) {
    const clip = (p[track] || []).find((c) => c.id === clipId);
    if (clip) return { clip, track, media: (p.media || []).find((x) => x.id === clip.mediaId) || null };
  }
  return null;
};
// Derivative inspection (10/10 step 4): per-media twin/proxy states and
// per-clip AudioFx / enhance render states for the open project, plus the
// fx segment cache's occupancy. States come from the SAME functions the
// export graph consults (ffmpegCore.audioFxPathOf / enhancePathOf), so
// what the bridge reports is what an export would use — never a guess.
const derivativeInspect = () => {
  const p = liveProjectDoc;
  const fileState = (f) => (typeof f === 'string' && f ? (fs.existsSync(f) ? 'ready' : 'missing') : 'none');
  const media = ((p && p.media) || []).map((m) => ({
    mediaId: m.id, name: m.name || '', type: m.type || '',
    remux: m.remuxFailed ? 'failed' : fileState(m.remux),
    proxy: m.proxyFailed ? 'failed' : fileState(m.proxy),
    lightProxy: m.lightProxy === false ? 'failed' : fileState(m.lightProxy),
    proxies: Object.fromEntries(Object.entries(m.proxies || {}).map(([q, f]) => [q, f === false ? 'failed' : fileState(f)])),
    thumb: fileState(m.thumb), wave: fileState(m.wave),
  }));
  const clips = [];
  if (p) {
    for (const track of ['videoClips', 'overlayClips', 'audioClips']) {
      for (const c of p[track] || []) {
        const m = (p.media || []).find((x) => x.id === c.mediaId) || null;
        const audioFx = !hasAudioFx(c.audioFx) ? 'none'
          : ffmpegCore.audioFxPathOf(c, m) ? 'ready'
            : (c.audioFxRender && c.audioFxRender.path ? 'stale' : 'pending');
        const e = c.enhance;
        const enhance = !(e && e.on) ? 'none'
          : ffmpegCore.enhancePathOf(c) ? 'ready'
            : (e.path ? 'stale' : 'pending');
        if (audioFx !== 'none' || enhance !== 'none') clips.push({ clipId: c.id, track: track.replace(/Clips$/, ''), audioFx, enhance });
      }
    }
  }
  const seg = fxJobs.cacheStats();
  return { media, clips, fxSegments: { files: seg.entries, bytes: seg.bytes, capMB: Math.round(seg.capBytes / 1048576) } };
};
// Derivative refresh: warm ONE cache file (or clear the segment cache).
// The renderers are content-addressed, so the warmed file is exactly the
// file the editor's own upkeep pass produces and then finds; pointers are
// recorded by that pass, never from here. The AudioFx branch shares the
// audiofx:render IPC's single-job guard — a render of the same clip from
// both doors at once would collide on the same .part name.
const derivativeRefresh = async (req) => {
  const p = liveProjectDoc;
  if (!p) return { error: 'No project is open in the editor.', status: 409 };
  const kind = req && req.kind;
  if (kind === 'fxsegments') {
    if (req.action !== 'clear') return { error: "The fxsegments refresh supports action: 'clear' only." };
    return { ok: true, kind, ...fxJobs.clearSegmentCache() };
  }
  if (kind === 'audiofx') {
    const found = findBridgeClip(p, req.clipId);
    if (!found) return { error: 'No such clip in the open project.', status: 404 };
    const { clip, media: m } = found;
    if (!m || (!hasAudioFx(clip.audioFx) && !hasCleanVoice(clip.cleanVoice) && !hasRepair(clip.repair))) return { error: 'That clip has no audio effects to render.' };
    if (audioFxJob) return { busy: true };
    const srcPath = ffmpegCore.enhancePathOf(clip) || m.path;
    if (!srcPath || !fs.existsSync(srcPath)) return { error: 'The media file was not found.' };
    const job = { canceled: false };
    audioFxJob = job;
    try {
      const res = await renderAudioFx({
        srcPath, from: clip.in || 0, to: clip.out ?? m.duration, fx: clip.audioFx, cleanVoice: clip.cleanVoice, repair: clip.repair, channels: m.channels,
        cacheDir: mediaCacheDir(), ffmpegPath: ffmpegCore.ffmpegPath, isCanceled: () => job.canceled,
      });
      if (!res) return { error: 'No audio effects to render.' };
      return { ok: true, kind, clipId: clip.id, path: res.path, note: 'Cache warmed — the editor picks the render up on its next upkeep pass and records it then.' };
    } catch (e) {
      return { error: e.message };
    } finally {
      audioFxJob = null;
    }
  }
  const m = (p.media || []).find((x) => x.id === (req && req.mediaId));
  if (!m) return { error: 'No such media in the open project.', status: 404 };
  if (kind === 'remux') {
    const info = { ...m, ...(await probe(m.path).catch(() => ({}))) };
    const tokens = String(info.container || '').split(',');
    const fst = (tokens.includes('mp4') || tokens.includes('mov')) ? isFaststart(m.path) : null;
    if (!remuxDecision(info, fst).needed) return { ok: true, kind, mediaId: m.id, needed: false };
    try {
      const rp = await makeRemux(info, mediaCacheDir());
      return { ok: true, kind, mediaId: m.id, needed: true, path: rp, note: 'Cache warmed — the editor adopts the twin on its next pass over this media.' };
    } catch (e) {
      return { error: e.message };
    }
  }
  if (kind === 'proxy' || kind === 'lightProxy') {
    const info = { ...m, ...(await probe(m.path).catch(() => ({}))) };
    try {
      const rp = await (kind === 'proxy' ? makeProxy(info, mediaCacheDir()) : makeLightProxy(info, mediaCacheDir()));
      return { ok: true, kind, mediaId: m.id, path: rp, note: 'Cache warmed — the editor adopts the copy on its next pass over this media.' };
    } catch (e) {
      return { error: e.message };
    }
  }
  return { error: `Unknown derivative kind '${kind}'. Use audiofx, remux, proxy, lightProxy or fxsegments.` };
};
const bridge = bridgeCore.createBridge({
  derivatives: () => derivativeInspect(),
  refreshDerivative: (req) => derivativeRefresh(req),
  commit: ({ projectId, json, file }) => {
    if (file) {
      writeProject(file, json);
      recordProjectVersion(json, file, true, 'agent-bridge');
    }
    // Keep the autosave slot in step with the accepted state, so Home and the
    // crash-recovery copy show what the user just accepted.
    try {
      const p = JSON.parse(json);
      const prev = autosaveStore.readSlot(autosaveDir(), projectId);
      autosaveStore.writeSlot(autosaveDir(), {
        id: projectId, title: p.name || prev?.title || 'Untitled', file: file || prev?.file || null,
        ratio: p.ratio || '', thumb: prev?.thumb || null, updatedAt: Date.now(), projectJson: json,
      });
    } catch { /* the file write already landed; the renderer's own autosave heals the slot */ }
    bridge.noteLive(projectId, json, file || null);
  },
  listVersions: (id) => versionsStore.listVersions(versionsDir(), id),
  onChange: () => {
    try { if (win && !win.isDestroyed()) win.webContents.send('bridge:shadowsChanged'); } catch { /* window going away */ }
  },
});
// Feed the bridge's live-project tracker from the traffic that already carries
// the document: slot writes (every edit), explicit saves, and project opens.
const bridgeNote = (json, file) => {
  try {
    const p = typeof json === 'string' ? JSON.parse(json) : json;
    if (p && p.id) {
      liveProjectDoc = p;
      bridge.noteLive(p.id, typeof json === 'string' ? json : JSON.stringify(p), file || null);
    }
  } catch { /* a malformed payload must never break a save */ }
};
ipcMain.handle('bridge:getState', () => ({
  enabled: settings.getBridgeEnabled(),
  ...bridge.state(),
  live: bridge.liveInfo(),
  pending: bridge.listShadows(false).filter((s) => s.status === 'pending').length,
}));
ipcMain.handle('bridge:setEnabled', async (_e, on) => {
  settings.setBridgeEnabled(on === true);
  if (on === true) await bridge.start();
  else await bridge.stop();
  writeBridgeDiscovery();
  return { enabled: settings.getBridgeEnabled(), ...bridge.state(), live: bridge.liveInfo(), pending: bridge.listShadows(false).filter((s) => s.status === 'pending').length };
});
ipcMain.handle('bridge:listShadows', () => bridge.listShadows(true));
// Accept is the user's act, from the review surface: the renderer passes the
// project it is showing, and a shadow made from any other project is refused.
ipcMain.handle('bridge:accept', (_e, shadowId, projectId) => {
  const shadow = bridge.getShadow(shadowId);
  if (!shadow) return { error: 'No such shadow draft.' };
  if (shadow.projectId !== projectId) return { error: 'That draft belongs to a different project than the one open.' };
  return bridge.acceptShadow(shadowId);
});
ipcMain.handle('bridge:discard', (_e, shadowId) => bridge.discardShadow(shadowId));

// ---- Media relink ------------------------------------------------------------------
// A candidate file counts as the missing item's new home when the probe agrees with
// what the project remembers: duration within 0.75 s when both are known, picture
// size equal when both are known. A name twin that fails verification is NOT offered
// as a match — a wrong relink is worse than a missing file.
const relinkVerify = (item, info) => {
  if (!info || info.error) return false;
  if (item.duration > 0 && info.duration > 0 && Math.abs(info.duration - item.duration) > 0.75) return false;
  if (item.width > 0 && info.width > 0 && (info.width !== item.width || info.height !== item.height)) return false;
  return true;
};
const relinkPatch = (p, info) => ({
  path: p,
  ...(info ? {
    type: info.type, duration: info.duration, width: info.width, height: info.height,
    hasVideo: info.hasVideo, hasAudio: info.hasAudio, fps: info.fps, fpsExact: info.fpsExact, fpsRational: info.fpsRational,
    rotation: info.rotation, hdr: info.hdr,
    colorSpace: info.colorSpace, colorPrimaries: info.colorPrimaries,
    colorTransfer: info.colorTransfer, colorRange: info.colorRange,
  } : {}),
});
// Locate one missing file by hand: returns { id, ...patch } or null when cancelled.
ipcMain.handle('relink:pickFile', async (_e, item) => {
  const res = await dialog.showOpenDialog(win, {
    title: `Locate “${String(item?.name || 'media')}”`,
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const p = res.filePaths[0];
  const info = await probe(p).catch(() => null);
  return { id: item?.id, ...relinkPatch(p, info), verified: relinkVerify(item || {}, info) };
});
// Scan a folder the user picked: match every missing item by name, verify candidates
// by probe. Returns { matches: [{ id, ...patch }], ambiguous: [{ id, name, candidates }],
// unmatched: [id] } — ambiguous items are left for a manual locate, never guessed.
ipcMain.handle('relink:scanFolder', async (_e, items) => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose the folder the media moved to',
    properties: ['openDirectory'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const pf = require('./projectfile.cjs');
  const list = Array.isArray(items) ? items : [];
  const found = pf.scanMediaFolder(res.filePaths[0], list.map((m) => path.basename(m.path || m.name || '')));
  const matches = [];
  const ambiguous = [];
  const unmatched = [];
  for (const item of list) {
    const candidates = found.get(path.basename(item.path || item.name || '').toLowerCase()) || [];
    if (!candidates.length) { unmatched.push(item.id); continue; }
    const verified = [];
    for (const c of candidates) {
      const info = await probe(c).catch(() => null);
      if (relinkVerify(item, info)) verified.push({ path: c, info });
    }
    if (verified.length === 1) matches.push({ id: item.id, ...relinkPatch(verified[0].path, verified[0].info), verified: true });
    else if (verified.length > 1) ambiguous.push({ id: item.id, name: item.name, candidates: verified.map((v) => v.path) });
    else unmatched.push(item.id);
  }
  return { matches, ambiguous, unmatched };
});
// Missing-media truth re-check (Part 3 addendum, 2026-11-10): the SAME
// findMissingMedia the load paths use, exposed so the renderer can re-verify
// the open project's referenced paths at export start — a file can be moved
// or deleted while the app is open, and the disk is the truth.
ipcMain.handle('media:checkMissing', (_e, project) => {
  const pf = require('./projectfile.cjs');
  return pf.findMissingMedia(JSON.stringify(project || {}));
});
ipcMain.handle('slots:delete', (_e, id) => autosaveStore.deleteSlot(autosaveDir(), id));
// Home switchboard actions (R5, parity §8): duplicate / rename / trash / restore over
// the same slot store. Trashing is a soft delete — the slot is parked for 30 days and
// the bound project file is never touched; slots:delete above stays the permanent one.
ipcMain.handle('slots:listTrashed', () => autosaveStore.listTrashed(autosaveDir()));
ipcMain.handle('slots:trash', (_e, id) => autosaveStore.trashSlot(autosaveDir(), id));
ipcMain.handle('slots:restore', (_e, id) => autosaveStore.restoreSlot(autosaveDir(), id));
ipcMain.handle('slots:copy', (_e, id) => autosaveStore.copySlot(autosaveDir(), id));
ipcMain.handle('slots:rename', (_e, id, title) => autosaveStore.renameSlot(autosaveDir(), id, title));
// Rename a project that lives ONLY in its .clipcraft file (a Home recent with no slot):
// the document's own name is rewritten in place through the transactional save path
// (validate → temp write → verified rename, backups rotated), so a crash mid-rename
// cannot tear the file. A file that does not parse is refused, never "healed" silently.
ipcMain.handle('project:renameFile', (_e, file, title) => {
  const name = String(title || '').trim().slice(0, 120);
  if (!file || !name) return null;
  try {
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    p.name = name;
    const json = JSON.stringify(p, null, 2);
    require('./draftsafety.cjs').writeProjectTx(file, json); // throws on any failure, file untouched
    projectFiles.add(file);
    recordProjectVersion(json, file, false, 'slot', p.id);
    return { name };
  } catch {
    return null;
  }
});

// Closing the window: the interface saves the project, or asks (in its own dialog) about a project that never had
// a file. If it does not answer (frozen), the window closes anyway after a few seconds; the next start offers the
// autosaved copy.
let allowClose = !!process.env.FVE_SMOKE && process.env.FVE_SMOKE_MODE !== 'autosave';
let closeTimer = null;
const closeNow = () => {
  clearTimeout(closeTimer);
  allowClose = true;
  if (win && !win.isDestroyed()) win.close();
};
ipcMain.handle('app:closeNow', () => closeNow());
ipcMain.handle('app:closeCancel', () => clearTimeout(closeTimer));

// Export happens in two steps: the UI draws the text layer and streams its raw RGBA pixels
// (export:textBegin / export:textFrame — see electron/textstream.cjs), then FFmpeg composes
// everything (export:run). Frame folders are only accepted if created by export:begin.
const frameDirs = new Set();

const EXPORT_FORMAT_DIALOG = {
  mp4: { title: 'Export video', filter: 'MP4 video' },
  mov: { title: 'Export video', filter: 'MOV video' },
  webm: { title: 'Export video', filter: 'WebM video' },
  gif: { title: 'Export GIF', filter: 'GIF image' },
};
ipcMain.handle('export:begin', async (_e, suggested, format) => {
  const fmt = EXPORT_FORMAT_DIALOG[format] ? format : 'mp4';
  let file = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, `ui-export.${fmt}`) : null;
  // Test-only hook (scripts/test-export-sound-live.mjs): a preset export target
  // with NO native save dialog. window.api is frozen (contextBridge), so a test
  // cannot stub exportBegin from the renderer — the stub silently never sticks
  // and the real dialog hangs the export forever. This env var is the only
  // dialog bypass; it is never set by the app itself.
  if (!file && process.env.FVE_EXPORT_TARGET) file = path.join(process.env.FVE_EXPORT_TARGET, `ui-export.${fmt}`);
  if (!file) {
    const base = String(suggested || 'export').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'export';
    const res = await dialog.showSaveDialog(win, {
      title: EXPORT_FORMAT_DIALOG[fmt].title,
      defaultPath: `${base}.${fmt}`,
      filters: [{ name: EXPORT_FORMAT_DIALOG[fmt].filter, extensions: [fmt] }],
    });
    if (res.canceled) return { canceled: true };
    file = res.filePath;
  }
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-text-'));
  frameDirs.add(frameDir);
  return { file, frameDir };
});

// Batch export (P2-26): one save dialog for the whole batch, then one target per
// variant — sibling files in the same folder (name_16x9.mp4, name_9x16.mp4,
// name_1x1.mp4), each with its own frame folder. The caller passes the already
// sanitised file stems; the directory is the one the user just picked (or the
// FVE_EXPORT_TARGET test dir, where the stems land as-is — one distinct file per
// variant, so a batch never overwrites the single-export hook's ui-export file).
ipcMain.handle('export:beginBatch', async (_e, names, format) => {
  const fmt = EXPORT_FORMAT_DIALOG[format] ? format : 'mp4';
  const list = (Array.isArray(names) ? names : []).map((n) => String(n || '').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)).filter(Boolean);
  if (!list.length) return { canceled: true };
  let dir = process.env.FVE_SMOKE || process.env.FVE_EXPORT_TARGET || null;
  if (!dir) {
    const res = await dialog.showSaveDialog(win, {
      title: EXPORT_FORMAT_DIALOG[fmt].title,
      defaultPath: `${list[0]}.${fmt}`,
      filters: [{ name: EXPORT_FORMAT_DIALOG[fmt].filter, extensions: [fmt] }],
    });
    if (res.canceled) return { canceled: true };
    dir = path.dirname(res.filePath);
    // The dialog's file name is the first variant's; the rest are siblings.
    const picked = path.basename(res.filePath, `.${fmt}`);
    list[0] = picked;
  }
  return {
    canceled: false,
    targets: list.map((name) => {
      const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-text-'));
      frameDirs.add(frameDir);
      return { file: path.join(dir, `${name}.${fmt}`), frameDir };
    }),
  };
});

// Text layer: raw frames from the interface, packed by FFmpeg into <frameDir>/text.mov as they come (textstream.cjs).
const { TextStream } = require('./textstream.cjs');
const textStreams = new Map(); // frameDir -> TextStream
const textStream = (dir) => {
  const s = textStreams.get(dir);
  if (!s) throw new Error('Unknown text layer');
  return s;
};
ipcMain.handle('export:textBegin', (_e, dir, width, height, fps) => {
  if (!frameDirs.has(dir)) throw new Error('Unknown frame folder');
  textStreams.get(dir)?.kill();
  textStreams.set(dir, new TextStream(require('./ffmpeg.cjs').ffmpegPath, dir, width, height, fps));
});
ipcMain.handle('export:textFrame', (_e, dir, frame) => textStream(dir).add(frame));
ipcMain.handle('export:textEnd', async (_e, dir) => {
  const s = textStream(dir);
  await s.finish();
  return s.count;
});

const dropFrames = (dir) => {
  if (!frameDirs.has(dir)) return;
  frameDirs.delete(dir);
  textStreams.get(dir)?.kill();
  textStreams.delete(dir);
  fs.rmSync(dir, { recursive: true, force: true });
};

ipcMain.handle('export:abort', (_e, dir) => dropFrames(dir));

// Animated effects pass (see electron/fxjobs.cjs): frames go to the interface's WebGL shaders and back.
// Rendered segments persist in the media cache (Sprint 9) so a later export reuses them.
const fxJobs = new FxJobs(
  () => path.join(mediaCacheDir(), 'fx-segments'),
  () => settings.getFxCacheCapMB() * 1024 * 1024, // the Settings cap drives the LRU eviction (fxjobs.cjs)
);
const fxCall = (fn) => async (...args) => {
  try {
    return { ok: true, value: await fn(...args) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
};
ipcMain.handle('fx:begin', fxCall((_e, project, spec) => fxJobs.begin(project, spec)));
ipcMain.handle('fx:read', fxCall((_e, id) => fxJobs.read(id)));
ipcMain.handle('fx:write', fxCall((_e, id, bytes) => fxJobs.write(id, bytes)));
ipcMain.handle('fx:readMany', fxCall((_e, id, n) => fxJobs.readMany(id, n)));
ipcMain.handle('fx:writeMany', fxCall((_e, id, frames) => fxJobs.writeMany(id, frames)));
ipcMain.handle('fx:end', fxCall((_e, id) => fxJobs.end(id)));
ipcMain.handle('fx:clear', () => fxJobs.clear());
app.on('will-quit', () => fxJobs.clear());

// What the bundled FFmpeg can do, for the export-quality UI (H.265 availability drives the summary's
// stated fallback). Cached: the encoder list does not change at runtime.
let exportCapsCache = null;
ipcMain.handle('export:caps', async () => {
  // encoder: the probed pick (v1.1.12) — a GPU encoder when one truly works
  // on this machine, libx264 otherwise; the Export summary names it.
  exportCapsCache ||= { libx265: hasLibx265(), vp9: hasVp9(), encoder: await pickEncoder().catch(() => 'libx264') };
  return exportCapsCache;
});

ipcMain.handle('export:run', async (_e, projectIn, target, textFrames) => {
  // P2-36: per-job cost — wall time + peak app RAM while the encode runs.
  const costT0 = Date.now();
  const costSampler = require('./resourceMonitor.cjs').startPeakSampler(app);
  try {
    let project = fxJobs.resolve(projectIn);
    // Soft subtitle track: the renderer serialized the caption clips to SRT text
    // (projectIn.subtitleSrt); stage it as a file the export graph can mux (mov_text).
    // The frame dir is the export's own scratch space, dropped when the export ends.
    if (typeof projectIn.subtitleSrt === 'string' && projectIn.subtitleSrt.trim() && frameDirs.has(target.frameDir)) {
      const srtFile = path.join(target.frameDir, 'captions.srt');
      try {
        fs.writeFileSync(srtFile, projectIn.subtitleSrt);
        project = { ...project, subtitleFile: srtFile, subtitleLang: projectIn.subtitleLang };
      } catch { /* no track: the burned-in captions still export */ }
    }
    const textFile = path.join(target.frameDir, 'text.mov');
    const withText = textFrames > 0 && frameDirs.has(target.frameDir) && fs.existsSync(textFile)
      ? { ...project, textOverlay: { file: textFile, count: textFrames } }
      : project;
    // Bundled stickers (10/10 step 3): resolve each sticker clip's file name to its
    // absolute path under shared/stickers/ (basename-only, the bundled:path rule);
    // clips that do not resolve are skipped by the export graph.
    let withStickers = withText;
    if (Array.isArray(withText.stickerClips) && withText.stickerClips.length) {
      const stickerFiles = {};
      for (const c of withText.stickerClips) {
        if (c && typeof c.sticker === 'string' && /^[\w.-]+$/.test(c.sticker)) {
          const fp = path.join(BUNDLED_MEDIA_DIRS.stickers, c.sticker);
          if (fs.existsSync(fp)) stickerFiles[c.id] = fp;
        }
      }
      if (Object.keys(stickerFiles).length) withStickers = { ...withText, stickerFiles };
    }
    // Low-End mode: the export yields CPU to the rest of the PC (nice +10). Other modes
    // run at normal priority. Priority never changes the encoder settings or output.
    // The encode reports 0 → 0.95 when mastering is on: the master stage owns the last
    // 5% of the bar (the renderer flips to the 'loudness' phase on the export:phase event).
    const loudnessTarget = require('./loudness.cjs').resolveLoudnessTarget(withStickers.export);
    const masterOn = !!loudnessTarget && withStickers.export?.format !== 'gif' && require('./loudness.cjs').projectHasAudio(withStickers);
    currentExport = runExport(withStickers, target.file, (p) => win.webContents.send('export:progress', masterOn ? p * 0.95 : p), { nice: settings.getPerfMode() === 'low-end' ? 10 : 0 });
    await currentExport.promise;
    let size = 0;
    try { size = fs.statSync(target.file).size; } catch { /* the done card shows no size */ }
    // P0-01 (#16): clips skipped for missing files, listed on the done card
    // like the ZIP export's missing files — never a silent drop.
    // P1-14: the master loudness stage — measure the finished file, gain its
    // audio to the target, measure again for the report. Best-effort by
    // design: a failed stage never fails the export (the file stands as
    // encoded, and the report says what was measured, if anything).
    let loudnessReport = null;
    if (masterOn) {
      win.webContents.send('export:phase', 'loudness');
      try {
        const { ffmpegPath, ffprobePath } = require('./ffmpeg.cjs');
        loudnessReport = await require('./loudness.cjs').normalizeLoudness(ffmpegPath, ffprobePath, target.file, loudnessTarget, {
          audioKbps: withStickers.export?.audioKbps,
          isCanceled: () => !!currentExport?.canceled,
        });
        if (loudnessReport?.applied) { try { size = fs.statSync(target.file).size; } catch { /* keep the encode size */ } }
      } catch (e) {
        loudnessReport = { applied: false, gainDb: 0, target: loudnessTarget, measured: null, final: null, error: e.message };
      }
    } else if (withStickers.export?.format !== 'gif' && require('./loudness.cjs').projectHasAudio(withStickers)) {
      // AU-07: mastering off — still measure, so the done card reports the
      // export's true loudness instead of saying nothing. Best-effort like
      // the master stage: a failed measurement never fails the export.
      try {
        const { ffmpegPath } = require('./ffmpeg.cjs');
        const measured = await require('./loudness.cjs').measureLoudness(ffmpegPath, target.file);
        loudnessReport = { applied: false, gainDb: 0, target: null, measured, final: measured };
      } catch (e) {
        loudnessReport = { applied: false, gainDb: 0, target: null, measured: null, final: null, error: e.message };
      }
    }
    // P1-57: the automatic export quality check — verify the finished file
    // against what the renderer expected (dimensions, fps, duration, audio)
    // plus black/frozen/silent runs and missing fonts. Best-effort like the
    // loudness stage: a failed check never fails the export; the done card
    // shows the verdict, and a null report means the check itself failed.
    let qcReport = null;
    if (!currentExport?.canceled && withStickers.qcExpected) {
      win.webContents.send('export:phase', 'qc');
      try {
        const { ffmpegPath, ffprobePath } = require('./ffmpeg.cjs');
        qcReport = await require('./exportqc.cjs').checkExport({
          ffmpegPath, ffprobePath, file: target.file,
          expected: withStickers.qcExpected,
          missingFonts: withStickers.qcMissingFonts || [],
          isCanceled: () => !!currentExport?.canceled,
        });
      } catch (e) { console.error('[export-qc] check failed:', e.message); }
    }
    return { ok: true, file: target.file, size, skipped: currentExport.skipped || [], loudness: loudnessReport, qc: qcReport,
      cost: { wallMs: Date.now() - costT0, peakRssMB: costSampler.stop() } };
  } catch (e) {
    if (currentExport?.canceled) return { canceled: true };
    // FB-18 (P1-24): the error may already carry its classification from
    // ffmpeg.cjs; a failure raised before any encode (probe, setup) is
    // classified here, against the project being exported.
    const h = e.exportCode ? { code: e.exportCode, clipName: e.exportClip, raw: e.exportRaw }
      : require('./exportErrors.cjs').humanizeExportError({ message: e.message, project: projectIn });
    return { ok: false, error: e.message, errorCode: h.code, errorClip: h.clipName || null, errorRaw: h.raw || e.message };
  } finally {
    costSampler.stop();
    currentExport = null;
    dropFrames(target.frameDir);
    fxJobs.clear();
  }
});

// One full-resolution frame of an original media file at `at` seconds, as a JPEG in the media
// cache (never scaled — the Export dialog's cover preview shows this, not a thumbnail-sprite
// frame). Cached per file+position; the cache keeps only the newest few grabs.
ipcMain.handle('media:frame', async (_e, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require('./ffmpeg.cjs');
  try {
    if (!mediaPath || !fs.existsSync(mediaPath)) return { ok: false, error: 'missing file' };
    const st = fs.statSync(mediaPath);
    const key = require('crypto').createHash('sha1')
      .update(`${mediaPath}|${st.size}|${st.mtimeMs}|${(Number(at) || 0).toFixed(2)}`).digest('hex').slice(0, 16);
    const out = path.join(mediaCacheDir(), `${key}-frame.jpg`);
    if (!fs.existsSync(out)) {
      await new Promise((resolve, reject) => execFile(ffmpegPath,
        ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', '-q:v', '3', out],
        (e) => (e ? reject(e) : resolve())));
      // Prune older grabs (keep the newest 16) so scrubbing the cover chooser cannot fill the cache.
      try {
        const grabs = fs.readdirSync(mediaCacheDir()).filter((f) => f.endsWith('-frame.jpg'))
          .map((f) => path.join(mediaCacheDir(), f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
        for (const f of grabs.slice(16)) { try { fs.rmSync(f); } catch { /* in use */ } }
      } catch { /* cache dir unavailable */ }
    }
    return { ok: true, path: out };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Embed the chosen poster frame as the MP4's attached cover picture: grab the frame from the source
// media, then a stream-copy remux adds it as attached_pic (the original file is only replaced once
// the remux succeeds, so a failure leaves the export untouched).
ipcMain.handle('export:cover', async (_e, file, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require('./ffmpeg.cjs');
  const run = (args) => new Promise((resolve, reject) => execFile(ffmpegPath, args, (e) => (e ? reject(e) : resolve())));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipcraft-cover-'));
  try {
    if (!fs.existsSync(file) || !fs.existsSync(mediaPath)) throw new Error('missing file');
    const cover = path.join(tmp, 'cover.jpg');
    await run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', '-q:v', '3', cover]);
    // The remux must keep the exported file's own container (an .mp4 temp would write
    // MP4 bytes over a .mov export); the extension drives the muxer.
    const out = path.join(tmp, `with-cover${path.extname(file) || '.mp4'}`);
    await run(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', out]);
    fs.copyFileSync(out, file);
    let size = 0;
    try { size = fs.statSync(file).size; } catch { /* ignore */ }
    return { ok: true, size };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Audio only: asks where to save, then exports through the audio JOB (runAudioExport) —
// the same lifecycle as video export: progress events on the shared channel, coverage by
// export:cancel, the resolved settings honoured, the master loudnorm stage applied.
const AUDIO_FORMATS = { mp3: 'MP3 audio', wav: 'WAV audio', m4a: 'M4A audio' };
ipcMain.handle('export:audio', async (_e, project, format, name) => {
  if (!AUDIO_FORMATS[format]) return { ok: false, error: 'Unknown audio format' };
  // P2-36: per-job cost, same as the video export.
  const costT0 = Date.now();
  const costSampler = require('./resourceMonitor.cjs').startPeakSampler(app);
  const base = String(name || 'audio').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'audio';
  let file = process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, `ui-audio.${format}`) : null;
  if (!file) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export audio',
      defaultPath: `${base}.${format}`,
      filters: [{ name: AUDIO_FORMATS[format], extensions: [format] }],
    });
    if (res.canceled) { costSampler.stop(); return { canceled: true }; }
    file = res.filePath;
  }
  try {
    currentAudioJob = runAudioExport(project, file, format, (p) => win.webContents.send('export:progress', p), { nice: settings.getPerfMode() === 'low-end' ? 10 : 0 });
    await currentAudioJob.promise;
    // P1-57: same automatic quality check as the video export — silence and
    // duration only (no picture to check). Best-effort: never fails the export.
    let qcReport = null;
    if (!currentAudioJob?.canceled && project.qcExpected) {
      win.webContents.send('export:phase', 'qc');
      try {
        const { ffmpegPath, ffprobePath } = require('./ffmpeg.cjs');
        qcReport = await require('./exportqc.cjs').checkExport({
          ffmpegPath, ffprobePath, file,
          expected: { ...project.qcExpected, kind: 'audio' },
          missingFonts: [],
          isCanceled: () => !!currentAudioJob?.canceled,
        });
      } catch (e) { console.error('[export-qc] audio check failed:', e.message); }
    }
    return { ok: true, file, skipped: currentAudioJob.skipped || [], loudness: currentAudioJob.loudness || null, qc: qcReport,
      cost: { wallMs: Date.now() - costT0, peakRssMB: costSampler.stop() } };
  } catch (e) {
    if (currentAudioJob?.canceled) return { canceled: true };
    // FB-18 (P1-24): same classification as the video export, against the
    // project being exported.
    const h = e.exportCode ? { code: e.exportCode, clipName: e.exportClip, raw: e.exportRaw }
      : require('./exportErrors.cjs').humanizeExportError({ message: e.message, project });
    return { ok: false, error: e.message, errorCode: h.code, errorClip: h.clipName || null, errorRaw: h.raw || e.message };
  } finally {
    costSampler.stop();
    currentAudioJob = null;
  }
});

ipcMain.handle('export:cancel', () => {
  // P1-52: a canceled export leaves no pause behind for the next job.
  clearExportPause();
  if (currentExport) {
    currentExport.canceled = true;
    currentExport.cancel();
  }
  if (currentAudioJob) {
    currentAudioJob.canceled = true;
    currentAudioJob.cancel();
  }
});

// P1-52: pause / resume a running export (SIGSTOP / SIGCONT on the live
// ffmpeg children; queued jobs pause in the renderer queue, not here).
ipcMain.handle('export:pause', () => setExportPaused(true));
ipcMain.handle('export:resume', () => setExportPaused(false));
// ---- Settings and AI. API keys stay in this process; the renderer only ever sees a hint like "…abcd". ----
const settings = require('./settings.cjs');
const ai = require('./ai.cjs');

// Opens a help page in the browser. Only a short allowlist of known sites is accepted.
const HELP_HOSTS = new Set(['www.slaycamera.com', 'www.instagram.com', 'elevenlabs.io', 'try.elevenlabs.io', 'pixabay.com', 'aistudio.google.com', 'console.developers.google.com', 'console.cloud.google.com', 'ollama.com', 'console.anthropic.com', 'platform.openai.com', 'console.groq.com', 'github.com', 'hamzaabika.com', 'www.hamzaabika.com', 'paypal.me', 'clipcrafts.pages.dev', 'getcutflow.pages.dev']); // P2-30: the update feed / About download links live on the feed hosts — without them "open in browser" silently no-ops.
ipcMain.handle('app:openHelp', (_e, url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && HELP_HOSTS.has(u.hostname)) return shell.openExternal(u.toString());
  } catch {
    // fall through
  }
  return false;
});

ipcMain.handle('settings:get', () => settings.getPublic());
ipcMain.handle('settings:setLanguage', (_e, lang) => settings.setLanguage(lang));
ipcMain.handle('settings:setRecorderPrefs', (_e, patch) => settings.setRecorderPrefs(patch));
// The OS language, for the interface language's first-start default
// (Settings › Language; a saved choice always wins over this).
ipcMain.handle('app:locale', () => app.getLocale());
ipcMain.handle('settings:setKeymap', (_e, map) => settings.setKeymap(map));
ipcMain.handle('settings:setKeystrokes', (_e, on) => settings.setKeystrokes(on));
ipcMain.handle('settings:setExportSound', (_e, on) => settings.setExportSound(on));
ipcMain.handle('settings:setReduceMotion', (_e, on) => settings.setReduceMotion(on));
ipcMain.handle('settings:setReduceFlashing', (_e, on) => settings.setReduceFlashing(on));
// FB-17 (P1-22): video decode choice + safe mode. Both apply on next
// launch (the decode switch is set before the first window starts); the
// Settings UI says so.
ipcMain.handle('settings:setVideoDecode', (_e, m) => settings.setVideoDecode(m));
ipcMain.handle('settings:setSafeMode', (_e, on) => settings.setSafeMode(on));
// The decode decision this launch started with, for the Settings UI.
ipcMain.handle('app:decodeDecision', () => ({ ...decodeDecision }));
// ---- MCP servers: external tool servers (stdio) whose tools FlowAI may call. ----
const mcp = require('./mcp.cjs');
const mcpRegistry = mcp.createRegistry(() => settings.getMcpServers());
ipcMain.handle('settings:setMcpServers', (_e, list) => settings.setMcpServers(list));
ipcMain.handle('mcp:tools', async () => {
  try {
    const { decls, problems } = await mcpRegistry.declarations();
    // The renderer/agent only needs the Gemini declaration shape; _mcp routing stays server-side.
    return { ok: true, tools: decls.map(({ _mcp, ...d }) => d), problems };
  } catch (e) {
    return { ok: false, error: e.message, tools: [], problems: [] };
  }
});
ipcMain.handle('mcp:call', async (_e, { name, args }) => {
  try {
    const { result } = await mcpRegistry.call(name, args || {});
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('mcp:test', async (_e, server) => mcpRegistry.test(server));
ipcMain.handle('settings:save', (_e, patch) => {
  try {
    return { ok: true, settings: settings.save(patch) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('settings:clearKey', (_e, provider) => settings.clearKey(provider));
ipcMain.handle('settings:saveServiceKey', (_e, name, key) => {
  try {
    return { ok: true, settings: settings.saveServiceKey(name, key) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
ipcMain.handle('settings:clearServiceKey', (_e, name) => settings.clearServiceKey(name));

// ---- About and updates: the version, and (only when the user asks in About) whether the
// update feed on clipcrafts.pages.dev has a newer one — see updates.cjs. ----
const updates = require('./updates.cjs');
ipcMain.handle('app:version', () => app.getVersion());
// Manual checks only (the About dialog); nothing checks automatically at startup.
ipcMain.handle('updates:check', async () => {
  // Snap installs are updated by snapd, never by the in-app .deb flow
  // (a confined, read-only app cannot download and pkexec-install a package).
  if (process.env.SNAP) {
    lastCheck = { current: app.getVersion(), storeManaged: true, newer: false };
    return lastCheck;
  }
  lastCheck = await updates.check();
  return lastCheck;
});
let lastCheck = null;
// In-app installer download (progress streamed to the requesting window). Uses ONLY the
// download URL from the last check — the renderer never supplies a URL.
ipcMain.handle('updates:download', async (e, allowUnverified = false) => {
  if (process.env.SNAP) return { error: 'This install updates through the Snap Store.' };
  if (!lastCheck?.newer || !lastCheck.downloadUrl) return { error: 'Check for updates first.' };
  // A-F8: a newer version whose feed published no checksum is held, not downloaded.
  if (!lastCheck.sha256) return { error: 'This update has no published checksum — the update feed did not include a SHA-256 for the installer, so Cutflow will not download or install it. The update will be available once the feed publishes a checksum.', hashMissing: true };
  return updates.downloadInstaller(lastCheck.downloadUrl, {
    destDir: app.getPath('downloads'),
    // Gate 7: the feed's published SHA-256 for this installer; the download is
    // verified against it before it can ever be installed (updates.cjs).
    // FB-21: without a feed checksum the download is refused unless the user
    // explicitly overrode it in About (allowUnverified).
    expectedSha256: lastCheck.sha256 || '',
    allowUnverified: allowUnverified === true,
    onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('updates:progress', p); },
  });
});
// Opens the installer downloaded above — and only that exact file.
ipcMain.handle('updates:openInstaller', async () => {
  const p = updates.lastDownload();
  if (!p || !fs.existsSync(p)) return { error: 'The downloaded installer is no longer there.' };
  const { shell } = require('electron');
  const err = await shell.openPath(p);
  return err ? { error: err } : { ok: true };
});
// One-click install of the file downloaded above (updates.cjs validates that it is exactly
// that file), then a relaunch into the new version: relaunch() registers the fresh start
// and this process quits, so the new instance begins only after the package files are fully
// replaced. Where no silent install exists (macOS), fall back to opening the downloaded
// file — the same behaviour as updates:openInstaller.
ipcMain.handle('updates:install', async (_e, allowUnverified = false) => {
  if (process.env.SNAP) return { error: 'This install updates through the Snap Store.' };
  // FB-21: an unverified download (no feed checksum) is not installed — or
  // opened for a manual install — without the same explicit override the
  // download needed.
  if (updates.lastDownload() && !updates.lastDownloadSha256() && allowUnverified !== true) {
    return { error: 'This installer was downloaded without a checksum to verify it against, so it will not be installed. Download it again with checksum verification, or explicitly allow the unverified install.', missingChecksum: true };
  }
  const r = await updates.installDownloaded({ destDir: app.getPath('downloads'), allowUnverified: allowUnverified === true });
  if (r.unsupported) {
    const p = updates.lastDownload();
    if (!p || !fs.existsSync(p)) return { error: 'The downloaded installer is no longer there.' };
    const { shell } = require('electron');
    const err = await shell.openPath(p);
    return err ? { error: err } : { ok: true, opened: true };
  }
  if (r.error) return r;
  app.relaunch();
  setTimeout(() => app.quit(), 300);
  return { ok: true, restarting: true };
});

// ---- Text to speech: Piper (free, on this PC) and ElevenLabs (the user's key). ----
const tts = require('./tts.cjs');
const ttsDir = () => path.join(app.getPath('userData'), 'tts');
const ttsOut = () => path.join(app.getPath('userData'), 'voiceovers');
ipcMain.handle('tts:status', () => ({ ...tts.piperStatus(ttsDir()), elevenKey: !!settings.getServiceKey('elevenlabs') }));
ipcMain.handle('tts:elevenVoices', async () => {
  try {
    return { voices: await tts.elevenVoices(net.fetch, settings.getServiceKey('elevenlabs')) };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('tts:elevenUsage', async () => {
  try {
    return { usage: await tts.elevenUsage(net.fetch, settings.getServiceKey('elevenlabs')) };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('tts:testKey', async (_e, key) => {
  try {
    const k = String(key || '').trim() || settings.getServiceKey('elevenlabs');
    const v = await tts.elevenVoices(net.fetch, k);
    // A key without the "User" read permission cannot see its credits; the voices still work.
    const u = await tts.elevenUsage(net.fetch, k).catch(() => null);
    const credits = u ? ` ${u.left.toLocaleString('en-US')} of ${u.limit.toLocaleString('en-US')} credits left this month.` : '';
    return { ok: true, text: `ElevenLabs works (${v.length} voices).${credits}` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
// Speaks the text and returns a media item (the file stays in <userData>/voiceovers).
let ttsJob = null; // FB-30: visible in system:status while speaking
ipcMain.handle('tts:speak', async (_e, req) => {
  ttsJob = { engine: req.engine || 'piper' };
  try {
    const send = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('tts:progress', { stage, fraction }); };
    let file;
    if (req.engine === 'eleven') {
      send('voice', 0);
      file = await tts.elevenSpeak(net.fetch, settings.getServiceKey('elevenlabs'), ttsOut(), req);
    } else {
      await tts.piperPrepare(net.fetch, ttsDir(), req.voiceId, send);
      send('voice', 1);
      file = await tts.piperSpeak(ttsDir(), ttsOut(), req);
    }
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const words = String(req.text).trim().split(/\s+/).slice(0, 5).join(' ').replace(/[\\/:*?"<>|]+/g, '');
    const credit = req.engine === 'eleven'
      ? { license: 'elevenlabs', providerName: 'ElevenLabs', creator: req.voiceName || 'ElevenLabs voice', line: 'Voice generated with ElevenLabs (elevenlabs.io)' }
      : { license: 'piper', providerName: 'Piper', creator: req.voiceName || req.voiceId, line: `Voice: Piper ${req.voiceId}` };
    return { ...m, name: `Voice - ${words || 'text'}${path.extname(file)}`, credit };
  } catch (e) {
    return { error: e.message };
  } finally {
    ttsJob = null;
  }
});

// ---- AI video and photo generation (ElevenLabs, the user's key; the API needs a Pro plan). Files stay in
// <userData>/generated with a small .json describing each one. ----
const gen = require('./gen.cjs');
const genDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'generated-test') : path.join(app.getPath('userData'), 'generated'));
const genJobs = new Map(); // job id -> AbortController
ipcMain.handle('gen:status', async () => {
  const key = settings.getServiceKey('elevenlabs');
  if (!key) return { hasKey: false };
  // A key without the "User" read permission cannot see its plan: generation is then simply tried.
  const u = await tts.elevenUsage(net.fetch, key).catch(() => null);
  return { hasKey: true, tier: u?.tier || '', pro: gen.isPro(u?.tier), left: u?.left ?? null, limit: u?.limit ?? null, proUrl: gen.PRO_URL };
});
ipcMain.handle('gen:models', () => gen.catalog());
ipcMain.handle('gen:list', () => gen.list(genDir()));
// Speech for a talking avatar must be MP3 or WAV: other audio (a recorded voice-over is M4A) is converted once.
const speechFile = async (file) => {
  if (gen.AUDIO_TYPES[path.extname(file).toLowerCase()]) return file;
  const out = path.join(genDir(), 'speech', `${path.basename(file, path.extname(file))}.mp3`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await new Promise((resolve, reject) => require('child_process').execFile(require('./ffmpeg.cjs').ffmpegPath,
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', out],
    { windowsHide: true }, (e) => (e ? reject(new Error('Could not read this audio.')) : resolve())));
  return out;
};
ipcMain.handle('gen:run', async (_e, jobId, kind, opts = {}) => {
  const ctl = new AbortController();
  genJobs.set(jobId, ctl);
  try {
    const onStatus = (stage) => { if (win && !win.isDestroyed()) win.webContents.send('gen:progress', { jobId, stage }); };
    const key = settings.getServiceKey('elevenlabs');
    let o = opts;
    if (kind === 'avatar') {
      // Typed text is spoken first with the chosen ElevenLabs voice.
      if (o.text) {
        onStatus('voicing');
        o = { ...o, audio: await tts.elevenSpeak(net.fetch, key, ttsOut(), { voiceId: o.voiceId, text: o.text }) };
      } else if (o.audio) o = { ...o, audio: await speechFile(o.audio) };
    }
    return await gen.run(net.fetch, key, genDir(), kind, o, { onStatus, signal: ctl.signal });
  } catch (e) {
    return { error: e.message, code: e.code || '' };
  } finally {
    genJobs.delete(jobId);
  }
});
ipcMain.handle('gen:stop', (_e, jobId) => genJobs.get(jobId)?.abort());
ipcMain.handle('gen:remove', (_e, file) => {
  try { gen.remove(genDir(), file); } catch { /* not a generated file: nothing to remove */ }
  return gen.list(genDir());
});
ipcMain.handle('gen:reveal', (_e, file) => {
  const hit = gen.list(genDir()).find((e) => e.path === file);
  if (hit) shell.showItemInFolder(hit.path);
  return !!hit;
});

// ---- Forge: Cutflow's own AI generation (photos + short videos). Pollinations (free, no key)
// for photos; Gemini — the AI assistant's existing key, no second key field — for Gemini photos
// and Veo videos. Jobs live in the forge module, so they survive panel switches. ----
const forge = require('./forge.cjs');
const forgeDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'forge-test') : path.join(app.getPath('userData'), 'forge'));
const forgeDeps = () => ({ fetchImpl: net.fetch, dir: forgeDir(), getKey: () => settings.getActive('gemini').apiKey });
ipcMain.handle('forge:status', () => ({ hasGeminiKey: !!settings.getActive('gemini').apiKey }));
ipcMain.handle('forge:catalog', () => forge.catalog());
ipcMain.handle('forge:list', () => forge.list(forgeDir()).map((e) => ({ ...e, path: path.join(forgeDir(), e.file) })));
ipcMain.handle('forge:start', (_e, opts) => { try { return forge.start(forgeDeps(), opts || {}); } catch (e) { return { error: e.message }; } });
ipcMain.handle('forge:jobs', () => forge.listJobs());
ipcMain.handle('forge:cancel', (_e, id) => forge.cancel(id));
ipcMain.handle('forge:remove', (_e, id) => forge.remove(forgeDir(), id));
ipcMain.handle('forge:reveal', (_e, id) => {
  const entry = forge.list(forgeDir()).find((e) => e.id === id);
  if (entry) shell.showItemInFolder(path.join(forgeDir(), entry.file));
  return !!entry;
});
// ---- Asset pack library: folder-backed (electron/assets.cjs). The folder is created on
// first read so the panels can name a real path in their empty state. ----
const assets = require('./assets.cjs');
ipcMain.handle('assets:list', () => {
  const root = assets.assetsRoot(app.getPath('userData'), process.env);
  assets.ensureRoot(root);
  return assets.readLibraryFor(app.getPath('userData'), process.env, process.resourcesPath);
});

// ---- First run: the Welcome card, shown once (flags in settings.json —
// electron/settings.cjs). ----
ipcMain.handle('firstrun:get', () => settings.getFirstRun());
ipcMain.handle('firstrun:set', (_e, patch) => settings.setFirstRun(patch));

// My avatars: photos of people reused in every project (<userData>/avatars).
const avatarDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'avatars-test') : path.join(app.getPath('userData'), 'avatars'));
ipcMain.handle('avatars:list', () => gen.avatarList(avatarDir()));
ipcMain.handle('avatars:add', async (_e, file) => {
  try {
    let files = file ? [file] : [];
    if (!file) {
      const res = await dialog.showOpenDialog(win, { title: 'Add avatar photos', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
      if (res.canceled) return { list: gen.avatarList(avatarDir()) };
      files = res.filePaths;
    }
    const added = files.map((f) => gen.avatarAdd(avatarDir(), f));
    return { list: gen.avatarList(avatarDir()), added };
  } catch (e) {
    return { error: e.message, list: gen.avatarList(avatarDir()) };
  }
});
ipcMain.handle('avatars:remove', (_e, file) => {
  try {
    gen.avatarRemove(avatarDir(), file);
  } catch {
    // not an avatar: nothing to remove
  }
  return gen.avatarList(avatarDir());
});

// (The project-Templates store + package flow lived here until 2026-11-10:
// removed for good at Hamza's order — no IPC, no bundled packages.)
ipcMain.handle('shell:openFolder', (_e, dir) => (fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? shell.openPath(dir) : false));

// ---- Stock photos and videos (Pixabay). The key stays in this process. ----
const stock = require('./stock.cjs');
// UI tests keep their (fake) downloads apart from the real library.
const stockDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'library-test') : path.join(app.getPath('userData'), 'library'));
// Tests a typed key (or the saved one) with a tiny search.
ipcMain.handle('stock:test', async (_e, key) => {
  try {
    const k = String(key || '').trim() || settings.getServiceKey('pixabay');
    const r = await stock.search(net.fetch, k, { kind: 'photo', q: `nature ${Date.now() % 7}` });
    return { ok: true, text: `Pixabay works (${r.total} photos for a test search).` };
  } catch (e) {
    return { ok: false, text: e.message };
  }
});
ipcMain.handle('stock:search', async (_e, opts) => {
  try {
    return await stock.search(net.fetch, settings.getServiceKey('pixabay'), opts || {});
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('stock:thumb', async (_e, url) => {
  try {
    return { path: await stock.thumbnail(net.fetch, stockDir(), url) };
  } catch (e) {
    return { error: e.message };
  }
});
// AI background removal (Remove BG > Auto removal): the model is downloaded once, then each video gets a matte
// (electron/matting.cjs), one job at a time. Progress goes to the interface as matting:progress.
const matting = require('./matting.cjs');
const mattingDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'matting-test') : path.join(app.getPath('userData'), 'matting'));
const matteCache = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'mattes-test') : path.join(app.getPath('userData'), 'mattes'));
let mattingJob = null; // { path, canceled }
ipcMain.handle('matting:status', () => matting.status(mattingDir()));
ipcMain.handle('matting:run', async (_e, item) => {
  if (mattingJob) return { error: 'Another video is being processed. Wait for it to finish.' };
  if (!item || !item.path || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
  const job = { path: item.path, canceled: false };
  mattingJob = job;
  const send = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('matting:progress', { path: item.path, stage, fraction }); };
  try {
    if (!matting.status(mattingDir()).installed) {
      send('download', 0);
      await matting.install(mattingDir(), (f) => send('download', f), net.fetch);
    }
    send('matte', 0);
    const { ffmpegPath, toSdr } = require('./ffmpeg.cjs');
    const file = await matting.makeMatte(item, {
      dir: mattingDir(), cacheDir: matteCache(), ffmpegPath, toSdr, onProgress: (f) => send('matte', f), isCanceled: () => job.canceled,
    });
    return { matte: file };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    mattingJob = null;
  }
});
ipcMain.handle('matting:cancel', () => { if (mattingJob) mattingJob.canceled = true; });

// Auto-reframe 9:16: face tracking over the main track's ranges (electron/reframe.cjs), one job at a
// time. The renderer sends one item per video clip; progress goes to the interface as reframe:progress
// (fraction of the whole job). The result is a face-centre path per clip; src/reframe.js builds the
// vertical project copy from the paths.
const reframe = require('./reframe.cjs');
const reframeDir = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'reframe-test') : path.join(app.getPath('userData'), 'reframe'));
const reframeCache = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'reframe-cache-test') : path.join(app.getPath('userData'), 'reframe-cache'));
let reframeJob = null; // { canceled }
ipcMain.handle('reframe:run', async (_e, items) => {
  if (reframeJob) return { error: 'Another video is being processed. Wait for it to finish.' };
  const list = (items || []).filter((x) => x && x.item && x.item.path && fs.existsSync(x.item.path));
  if (!list.length) return { error: 'The video files were not found.' };
  const job = { canceled: false };
  reframeJob = job;
  const send = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('reframe:progress', { stage, fraction }); };
  try {
    if (!reframe.status(reframeDir()).installed) {
      send('download', 0);
      await reframe.install(reframeDir(), (f) => send('download', f), net.fetch);
    }
    const { ffmpegPath, toSdr } = require('./ffmpeg.cjs');
    const results = {};
    for (let i = 0; i < list.length; i++) {
      const { clipId, item, from, to } = list[i];
      send('faces', i / list.length);
      results[clipId] = await reframe.analyze(item, {
        dir: reframeDir(), cacheDir: reframeCache(), ffmpegPath, toSdr, from, to,
        onProgress: (f) => send('faces', (i + f) / list.length), isCanceled: () => job.canceled,
      });
    }
    send('faces', 1);
    return { results };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    reframeJob = null;
  }
});
ipcMain.handle('reframe:cancel', () => { if (reframeJob) reframeJob.canceled = true; });

// Beat cuts: analyse the project soundtrack's beat grid (electron/beats.cjs), one job
// at a time. Progress goes to the interface as beats:progress (stage + fraction of the
// whole job); the renderer stores the result on the project (src/beats.js reads it).
const beats = require('./beats.cjs');
const beatsCache = () => (process.env.FVE_SMOKE ? path.join(process.env.FVE_SMOKE, 'beats-cache-test') : path.join(app.getPath('userData'), 'beats-cache'));
let beatsJob = null; // { canceled }
ipcMain.handle('beats:analyze', async (_e, project) => {
  if (beatsJob) return { error: 'Another video is being processed. Wait for it to finish.' };
  const job = { canceled: false };
  beatsJob = job;
  const send = (stage, fraction) => { if (win && !win.isDestroyed()) win.webContents.send('beats:progress', { stage, fraction }); };
  try {
    send('render', 0);
    const r = await beats.analyzeProject(project, {
      cacheDir: beatsCache(),
      onProgress: (stage, f) => send(stage, f),
      isCanceled: () => job.canceled,
    });
    send('analyze', 1);
    return { bpm: r.bpm, beats: r.beats, cached: !!r.cached };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    beatsJob = null;
  }
});
ipcMain.handle('beats:cancel', () => { if (beatsJob) beatsJob.canceled = true; });

// Scene splitting (Sprint 10): one detection job at a time over a media
// file (electron/scenes.cjs — the FFmpeg scene-score pass); the renderer
// maps the returned source-second boundaries into the clip and dispatches
// ordinary splits.
const scenes = require('./scenes.cjs');
let scenesJob = null; // { canceled }
ipcMain.handle('scenes:detect', async (_e, file, opts) => {
  if (scenesJob) return { error: 'Another video is being processed. Wait for it to finish.' };
  const job = { canceled: false };
  scenesJob = job;
  try {
    const cuts = await scenes.detectScenes(file, { threshold: opts && opts.threshold, isCanceled: () => job.canceled });
    if (job.canceled) return { canceled: true };
    return { cuts };
  } catch (e) {
    return { error: e.message };
  } finally {
    scenesJob = null;
  }
});
ipcMain.handle('scenes:cancel', () => { if (scenesJob) scenesJob.canceled = true; });

// Silence detection (10/10 step 4): one job at a time over a media file
// (electron/silence.cjs — the FFmpeg silencedetect pass); the renderer maps
// the returned source-second spans into the clip, shows them on the
// waveform and removes them through the range-cut store actions.
const silenceMod = require('./silence.cjs');
let silenceJob = null; // { canceled }
ipcMain.handle('silence:detect', async (_e, file, opts) => {
  if (silenceJob) return { error: 'Another video is being processed. Wait for it to finish.' };
  if (!file || !fs.existsSync(file)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  silenceJob = job;
  try {
    const ranges = await silenceMod.detectSilence(file, {
      thresholdDb: opts && opts.thresholdDb,
      minDuration: opts && opts.minDuration,
      durationHint: opts && opts.durationHint,
      isCanceled: () => job.canceled,
    });
    if (job.canceled) return { canceled: true };
    return { ranges };
  } catch (e) {
    return { error: e.message };
  } finally {
    silenceJob = null;
  }
});
ipcMain.handle('silence:cancel', () => { if (silenceJob) silenceJob.canceled = true; });

// AI video enhance (electron/esrgan.cjs): one job at a time, like the
// silence pass — the renderer queues it in the export-jobs tray and drives
// progress/cancel from there. Cancel sets the flag AND kills the running
// child (frame extraction, the engine, or the encode) immediately.
const esrganMod = require('./esrgan.cjs');
let esrganJob = null; // { canceled, child }
ipcMain.handle('esrgan:start', async (e, req) => {
  if (esrganJob) return { error: 'Another enhance job is already running.' };
  if (!req || !req.src || !fs.existsSync(req.src)) return { error: 'The media file was not found.' };
  const job = { canceled: false, child: null };
  esrganJob = job;
  try {
    const res = await esrganMod.runEnhance({
      src: req.src, model: req.model, scale: req.scale, outFile: req.outFile,
      onProgress: (p) => { if (!e.sender.isDestroyed()) e.sender.send('esrgan:progress', p); },
      isCanceled: () => job.canceled,
      onChild: (child) => { job.child = child; },
    });
    if (job.canceled) return { canceled: true };
    return res;
  } catch (err) {
    if (err && err.canceled) return { canceled: true };
    return { error: err.message };
  } finally {
    esrganJob = null;
  }
});
ipcMain.handle('esrgan:cancel', () => {
  if (esrganJob) {
    esrganJob.canceled = true;
    if (esrganJob.child) { try { esrganJob.child.kill('SIGKILL'); } catch { /* gone */ } }
  }
  return true;
});

// Save a text file the renderer produced (subtitle export, v1.1.11): the
// dialog and the write live here; the renderer supplies only text + a name.
ipcMain.handle('file:saveText', async (_e, { title, defaultName, content, filters } = {}) => {
  try {
    const name = String(defaultName || 'file.txt').replace(/[\\/:*?"<>|]+/g, '').trim() || 'file.txt';
    const res = await dialog.showSaveDialog(win, {
      title: title || 'Save file',
      defaultPath: name,
      filters: filters && filters.length ? filters : [{ name: 'Text', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, String(content ?? ''), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { error: `Could not save the file: ${e.message}` };
  }
});

// ---- Caption translation (v1.1.10): the user's AI provider translates the
// caption lines; timings never leave the renderer. One job at a time. ----
const translate = require('./translate.cjs');
let translateJob = null; // { canceled }
ipcMain.handle('translate:captions', async (_e, { texts, targetName } = {}) => {
  if (translateJob) return { error: 'A translation is already running. Wait for it to finish.' };
  if (!Array.isArray(texts) || !texts.length) return { error: 'There are no captions to translate.' };
  if (!targetName) return { error: 'Pick a target language first.' };
  const job = { canceled: false };
  translateJob = job;
  const send = (done, total) => { if (win && !win.isDestroyed()) win.webContents.send('translate:progress', { done, total }); };
  try {
    const fb = require('./aifallback.cjs');
    const active = settings.getActive();
    const keys = settings.getPublic().keys || {};
    const order = fb.fallbackOrder(active.provider, (p) => p === 'ollama' || !!keys[p]);
    const { result, provider, failed } = await fb.withFallback(order, (p) => settings.getActive(p), (cfg) =>
      translate.translateTexts(texts, targetName, (system, user) => ai.chat(cfg, { system, messages: [{ role: 'user', content: user }], maxTokens: 4096, timeoutMs: 120000 }), {
        onProgress: send,
        isCancelled: () => job.canceled,
      }));
    if (job.canceled) return { canceled: true };
    return { ok: true, texts: result, provider, fellBack: failed.map((f) => f.provider) };
  } catch (e) {
    return job.canceled || /cancelled/i.test(e.message || '') ? { canceled: true } : { error: e.message };
  } finally {
    translateJob = null;
  }
});
ipcMain.handle('translate:cancel', () => { if (translateJob) translateJob.canceled = true; });

// Background pictures for scenes without footage (FlowAI's add_scene), kept with the library downloads.
ipcMain.handle('scene:make', async (_e, opts) => {
  try {
    const file = await require('./ffmpeg.cjs').makeScene(opts || {}, path.join(stockDir(), 'scenes'));
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const o = opts || {};
    return { ...m, name: `Background ${o.color}${o.color2 ? `-${o.color2}` : ''}.png` };
  } catch (e) {
    return { error: e.message };
  }
});

// Stabilization (vid.stab, electron/stabilize.cjs): one clip at a time; the stabilized copy comes back as a media item.
const { stabilize } = require('./stabilize.cjs');
let stabJob = null;
ipcMain.handle('stabilize:run', async (_e, item, from, to, level) => {
  if (stabJob) return { error: 'Another clip is being stabilized.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
  const job = { canceled: false };
  stabJob = job;
  try {
    const out = await stabilize(item, {
      from, to, level, cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath, toSdr: require('./ffmpeg.cjs').toSdr,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('stabilize:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the stabilized video.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (stabilized).mp4` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    stabJob = null;
  }
});
ipcMain.handle('stabilize:cancel', () => { if (stabJob) stabJob.canceled = true; });

// Motion tracking (electron/track.cjs): one job at a time; the path comes back to the renderer, which
// stores it on the clip. The render is cached by file, range, pick and box, like the other derivatives.
const { trackMotion } = require('./track.cjs');
let trackJob = null;
ipcMain.handle('track:run', async (_e, item, from, to, pick, box) => {
  if (trackJob) return { error: 'Another clip is being tracked.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The video file was not found.' };
  if (!pick || !Number.isFinite(pick.x) || !Number.isFinite(pick.y)) return { error: 'No point to track.' };
  const job = { canceled: false };
  trackJob = job;
  try {
    const res = await trackMotion(item, {
      from, to, pick, box: box || { w: 0.055, h: 0.095 }, cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('track:progress', { path: item.path, fraction }); },
    });
    return { points: res.points, fps: res.fps, frames: res.raw, cached: !!res.cached };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    trackJob = null;
  }
});
ipcMain.handle('track:cancel', () => { if (trackJob) trackJob.canceled = true; });

// Reverse (context menu, item 12): same one-job-at-a-time derivative-render pattern.
const { reverse } = require('./reverse.cjs');
let revJob = null;
ipcMain.handle('reverse:run', async (_e, item, from, to) => {
  if (revJob) return { error: 'Another clip is being reversed.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  revJob = job;
  try {
    const out = await reverse(item, {
      from, to, hasVideo: item.type !== 'audio', cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath, toSdr: require('./ffmpeg.cjs').toSdr,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('reverse:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the reversed video.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (reversed).mp4` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    revJob = null;
  }
});
ipcMain.handle('reverse:cancel', () => { if (revJob) revJob.canceled = true; });

// Detach audio (clip menu): render a video clip's sound into its own audio file, cached
// like the reverse renders. The project then holds it as a linked audio clip.
const { detach } = require('./detach.cjs');
let detachJob = null;
ipcMain.handle('detach:run', async (_e, item, from, to) => {
  if (detachJob) return { error: 'Another clip is being detached.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  detachJob = job;
  try {
    const out = await detach(item, {
      from, to, cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('detach:progress', { path: item.path, fraction }); },
    });
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the detached audio.' };
    return { ...m, name: `${path.basename(item.path).replace(/\.[^.]+$/, '')} (detached).wav` };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    detachJob = null;
  }
});
ipcMain.handle('detach:cancel', () => { if (detachJob) detachJob.canceled = true; });

// Voice Enhancer (clip Audio tab): render the clip's sound cleaned (electron/enhance.cjs,
// cached like the detach renders). The clip then plays / exports the enhanced file.
const { enhance } = require('./enhance.cjs');
let enhanceJob = null;
ipcMain.handle('enhance:run', async (_e, item, from, to, strength) => {
  if (enhanceJob) return { error: 'Another clip is being enhanced.' };
  if (!item || !fs.existsSync(item.path)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  enhanceJob = job;
  try {
    const res = await enhance(item, {
      from, to, strength, cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('enhance:progress', { path: item.path, fraction }); },
    });
    return { path: res.path };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    enhanceJob = null;
  }
});
ipcMain.handle('enhance:cancel', () => { if (enhanceJob) enhanceJob.canceled = true; });

// Smooth Cut (P2-06): score the frames either side of a cut. The renderer passes
// the two media paths and the source times of the last / first frames; the reply
// is { psnr, fallback } — fallback 'large-motion' means the cut stays hard.
const { checkCut } = require('./smoothcut.cjs');
ipcMain.handle('smoothcut:check', async (_e, req) => {
  try {
    if (!req || !req.prevPath || !req.nextPath) return { error: 'Smooth Cut needs the two clips around the cut.' };
    const res = await checkCut(require('./ffmpeg.cjs').ffmpegPath, {
      ...req, tmpDir: path.join(mediaCacheDir(), 'smoothcut'),
    });
    return { psnr: res.psnr === Infinity ? null : Math.round(res.psnr * 10) / 10, fallback: res.fallback };
  } catch (err) {
    return { error: err.message };
  }
});

// AudioFx preview parity (electron/audiofxrender.cjs): render a clip's effected sound,
// cached like the enhance renders. The renderer asks whenever a clip's audioFx / range /
// sound source outdates the stored derivative (clip.audioFxRender); preview and export
// then both play that one file. A second request while one runs answers { busy: true }
// so the renderer's upkeep loop retries instead of failing the clip.
const { renderAudioFx } = require('./audiofxrender.cjs');
let audioFxJob = null;
ipcMain.handle('audiofx:render', async (_e, req) => {
  if (audioFxJob) return { busy: true };
  if (!req || !req.srcPath || !fs.existsSync(req.srcPath)) return { error: 'The media file was not found.' };
  const job = { canceled: false };
  audioFxJob = job;
  try {
    const res = await renderAudioFx({
      srcPath: req.srcPath, from: req.from, to: req.to, fx: req.fx, cleanVoice: req.cleanVoice, repair: req.repair, channels: req.channels,
      cacheDir: mediaCacheDir(), ffmpegPath: require('./ffmpeg.cjs').ffmpegPath,
      isCanceled: () => job.canceled,
      onProgress: (fraction) => { if (win && !win.isDestroyed()) win.webContents.send('audiofx:progress', { path: req.srcPath, fraction }); },
    });
    return res ? { path: res.path, chain: res.chain } : { error: 'No audio effects to render.' };
  } catch (e) {
    return e.canceled ? { canceled: true } : { error: e.message };
  } finally {
    audioFxJob = null;
  }
});
ipcMain.handle('audiofx:cancel', () => { if (audioFxJob) audioFxJob.canceled = true; });

// Freeze frame (context menu, item 12): grab one frame of a media file as a PNG still the
// project can hold. Cached by file + time; the file lands in the media cache like other stills.
ipcMain.handle('media:frameImage', async (_e, mediaPath, at) => {
  const { execFile } = require('child_process');
  const { ffmpegPath } = require('./ffmpeg.cjs');
  try {
    if (!fs.existsSync(mediaPath)) return { error: 'The media file was not found.' };
    const st = fs.statSync(mediaPath);
    const key = require('crypto').createHash('sha1').update(`${mediaPath}|${st.size}|${st.mtimeMs}|frame|${Number(at).toFixed(2)}`).digest('hex').slice(0, 16);
    const dir = mediaCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, `${key}-frame.png`);
    if (!fs.existsSync(out)) {
      await new Promise((resolve, reject) => execFile(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Number(at) || 0)), '-i', mediaPath, '-frames:v', '1', out], (e) => (e ? reject(e) : resolve())));
    }
    const [m] = await probeAll([out]);
    if (!m || m.error) return { error: 'Could not read the frozen frame.' };
    return m;
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('stock:add', async (_e, item) => {
  try {
    const file = await stock.download(net.fetch, stockDir(), item);
    const [m] = await probeAll([file]);
    if (m.error) return { error: m.error };
    const name = `${(item.tags || 'pixabay').split(',')[0].trim() || 'pixabay'} ${item.id}.${path.extname(file).slice(1)}`;
    return { ...m, name, credit: { license: 'pixabay', providerName: 'Pixabay', creator: item.user, landing: item.pageURL, line: stock.creditLine(item) } };
  } catch (e) {
    return { error: e.message };
  }
});
// Tests the typed (not yet saved) values when given, otherwise the saved configuration.
const draftConfig = (draft = {}) => {
  const saved = settings.getActive(draft.provider);
  return {
    provider: saved.provider,
    model: (draft.model || '').trim() || saved.model,
    baseUrl: draft.baseUrl !== undefined ? draft.baseUrl.trim().replace(/\/+$/, '') : saved.baseUrl,
    apiKey: (draft.apiKey || '').trim() || saved.apiKey,
  };
};
ipcMain.handle('ai:test', (_e, draft) => ai.testConnection(draftConfig(draft)));
ipcMain.handle('ai:models', (_e, draft) => ai.listModels(draftConfig(draft)));
ipcMain.handle('ai:ollamaStatus', (_e, draft) => ai.ollamaStatus(draftConfig(draft).baseUrl));

// Ollama model download (P1-30 free path): runs `ollama pull <model>` in the main
// process and streams the last progress line to the renderer. The model name is
// validated (no shell is used at all), one pull at a time; a missing `ollama`
// binary reports plainly instead of failing silently.
let ollamaPullChild = null;
ipcMain.handle('ai:ollamaPull', (e, model) => new Promise((resolve) => {
  const m = String(model || '').trim();
  if (!ai.validOllamaModel(m)) return resolve({ ok: false, error: 'Invalid model name.' });
  if (ollamaPullChild) return resolve({ ok: false, error: 'A model download is already running.' });
  const child = require('child_process').spawn('ollama', ['pull', m], { windowsHide: true });
  ollamaPullChild = child;
  let last = '';
  const onData = (d) => {
    last = String(d).trim().split('\n').filter(Boolean).pop() || last;
    try { e.sender.send('ai:ollamaPullProgress', { model: m, line: last }); } catch { /* window closed */ }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (err) => {
    ollamaPullChild = null;
    resolve({ ok: false, error: err.code === 'ENOENT' ? 'Ollama is not installed on this PC. Download it from ollama.com first.' : err.message });
  });
  child.on('close', (code) => {
    ollamaPullChild = null;
    resolve(code === 0 ? { ok: true, model: m } : { ok: false, error: `Download failed (exit ${code}).${last ? ` Last line: ${last}` : ''}` });
  });
}));
ipcMain.handle('ai:ollamaPullCancel', () => {
  if (!ollamaPullChild) return false;
  ollamaPullChild.kill();
  ollamaPullChild = null;
  return true;
});

// ---- Bundled generated media (10/10 step 3): the synthesized SFX and the drawn
// stickers live under shared/<kind>/; the renderer knows only file names from its
// registries, and this resolver maps them to absolute paths. Basename-only, so a
// registry entry can never walk out of its folder. ----
const BUNDLED_MEDIA_DIRS = { sfx: path.join(__dirname, '..', 'shared', 'sfx'), stickers: path.join(__dirname, '..', 'shared', 'stickers') };
ipcMain.handle('bundled:path', (_e, kind, file) => {
  const dir = BUNDLED_MEDIA_DIRS[kind];
  if (!dir || typeof file !== 'string' || !/^[\w.-]+$/.test(file)) return null;
  const p = path.join(dir, file);
  return fs.existsSync(p) ? p : null;
});

// ---- LUTs (.cube): the bundled ones in shared/luts, or a file the user picked. ----
const LUT_DIR = path.join(__dirname, '..', 'shared', 'luts');
ipcMain.handle('lut:read', (_e, ref) => {
  try {
    let file;
    if (ref && ref.bundled) {
      if (!/^[\w.-]+\.cube$/i.test(ref.bundled)) return { error: 'Unknown LUT' };
      file = path.join(LUT_DIR, ref.bundled);
    } else if (ref && ref.path) {
      if (!/\.cube$/i.test(ref.path)) return { error: 'Only .cube LUT files are supported.' };
      file = ref.path;
    } else return { error: 'No LUT' };
    if (!fs.existsSync(file)) return { error: `LUT file not found: ${path.basename(file)}` };
    if (fs.statSync(file).size > 60 * 1024 * 1024) return { error: 'This LUT file is too big.' };
    return { text: fs.readFileSync(file, 'utf8') };
  } catch (e) {
    return { error: e.message };
  }
});
ipcMain.handle('lut:import', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Import a LUT', properties: ['openFile'], filters: [{ name: '3D LUT', extensions: ['cube'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { path: file, name: path.basename(file).replace(/\.cube$/i, '') };
});

// ---- FlowAI agent: one model step per call; tools run in the interface, heavy ones call back here. ----
// If the provider fails, the step goes to the next one with a saved key (Gemini, Groq, OpenAI-compatible).
// req.provider: the provider that answered the previous step of this request, so a run stays on it.
ipcMain.handle('agent:step', async (_e, req) => {
  try {
    const fb = require('./aifallback.cjs');
    const active = settings.getActive();
    const first = fb.TOOL_PROVIDERS.includes(req.provider) ? req.provider : active.provider;
    const keys = settings.getPublic().keys || {};
    const order = fb.TOOL_PROVIDERS.includes(first) ? fb.fallbackOrder(first, (p) => p === 'ollama' || !!keys[p]) : [first];
    const { result, provider, failed } = await fb.withFallback(order, (p) => settings.getActive(p), (cfg) => ai.agentStep(cfg, req));
    return {
      ok: true, ...result, provider, model: settings.getActive(provider).model,
      fellBack: failed.map((f) => ({ provider: f.provider, name: fb.NAMES[f.provider], reason: f.reason })),
    };
  } catch (e) {
    return { ok: false, error: e.message, link: e.link, linkLabel: e.linkLabel, suggestModel: e.suggestModel };
  }
});
ipcMain.handle('agent:silences', async (_e, project, opts) => {
  try {
    return { ok: true, silences: await detectSilences(project, opts) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// B-F19 — the live LUFS panel: render the timeline's mixed audio, run EBU
// R128 over it, and return the momentary/short-term curve + summary.
ipcMain.handle('audio:loudnessCurve', async (_e, project) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-lufs-'));
  try {
    const wav = await renderTimelineAudio(project, path.join(tmp, 'audio.wav'), 'all');
    const { ffmpegPath } = require('./ffmpeg.cjs');
    const curve = await require('./loudness.cjs').measureLoudnessCurve(ffmpegPath, wav);
    return { ok: true, curve };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
});

ipcMain.handle('captions:status', () => whisper.status(whisperDir()));

// Auto captions: install whisper.cpp on first use, mix the main-track audio, transcribe.
ipcMain.handle('captions:run', async (_e, project, opts = {}) => {
  const send = (stage, progress) => win.webContents.send('captions:progress', { stage, progress });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-cap-'));
  captionsJob = { model: opts.model || 'base' }; // FB-30: visible in system:status while running
  try {
    const dir = whisperDir();
    const install = () => whisper.install(dir, (what, f) => send(`Downloading ${what}`, f), opts.model);
    send('Preparing', 0);
    await install();
    send('Extracting audio', 0);
    const wav = await renderTimelineAudio(project, path.join(tmp, 'audio.wav'), opts.source || 'all');
    const run = () => whisper.transcribe(dir, wav, opts, (f) => send('Transcribing', f));
    send('Transcribing', 0);
    let segments;
    try {
      segments = await run();
    } catch (e) {
      if (e.code !== 'MODEL_DAMAGED') throw e;
      // The model was corrupt and has been removed: download it again and retry once.
      await install();
      send('Transcribing', 0);
      segments = await run();
    }
    if (!segments.length) {
      throw new Error('No speech was detected in the selected audio. Check the "Transcribe" source and the language, and make sure the clip is not muted.');
    }
    return { ok: true, segments };
  } catch (e) {
    const log = path.join(whisperDir(), 'last-run.log');
    return { ok: false, error: e.message.includes('Full log:') ? e.message : `${e.message}\n\nFull log: ${log}` };
  } finally {
    captionsJob = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Like shell:openFolder, the path must be a real existing one — never raw renderer input.
// P2-30: validated before the OS ever sees the path — see electron/shellOpen.cjs.
// show only reveals the containing folder; open launches the default handler,
// so open is restricted to known-safe extensions, no execute bits, and never
// under the app's userData dir (settings/keys).
// P2-36: live resource numbers for the Resources dialog (electron/resourceMonitor.cjs).
// Cheap by design: one getAppMetrics call per poll, and the dialog polls at 2 s.
ipcMain.handle('system:metrics', () => require('./resourceMonitor.cjs').collectMetrics({ app, process, os: require('os'), gpuName }));
const { canShow, canOpen } = require('./shellOpen.cjs');
ipcMain.handle('shell:show', (_e, file) => (canShow(file) ? shell.showItemInFolder(file) : false));
ipcMain.handle('shell:open', (_e, file) => (canOpen(file, app.getPath('userData')) ? shell.openPath(file) : false));

// Cloud captions (item O): the same timeline audio, transcribed by the provider the user
// picked with their own saved key. Segments come back in the local flow's exact shape.
ipcMain.handle('captions:runCloud', async (_e, project, opts = {}) => {
  const send = (stage, progress) => { if (win && !win.isDestroyed()) win.webContents.send('captions:progress', { stage, progress }); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-capc-'));
  try {
    const provider = opts.provider || 'groq';
    const meta = cloudCaptions.PROVIDERS[provider];
    if (!meta) return { ok: false, error: `Unknown caption provider: ${provider}` };
    const key = settings.getServiceKey(meta.service);
    if (!key) return { ok: false, error: `No ${meta.name} API key saved. Add it in the Captions panel first.` };
    send('Extracting audio', 0);
    const wav = await renderTimelineAudio(project, path.join(tmp, 'audio.wav'), opts.source || 'all');
    send('Transcribing', 0.05);
    const segments = await cloudCaptions.transcribePrepared({
      provider, key, model: opts.model || undefined, language: opts.language, diarize: !!opts.diarize,
      wavPath: wav, dir: tmp, ffmpegPath: require('./ffmpeg.cjs').ffmpegPath, probe,
      fetchImpl: net.fetch, onProgress: (f) => send('Transcribing', 0.05 + f * 0.95),
    });
    if (!segments.length) {
      throw new Error('No speech was detected in the selected audio. Check the "Transcribe" source and the language, and make sure the clip is not muted.');
    }
    return { ok: true, segments };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Test a cloud caption key: the typed key when given, otherwise the saved one.
ipcMain.handle('captions:testCloud', async (_e, provider, keyOverride) => {
  try {
    const meta = cloudCaptions.PROVIDERS[provider];
    if (!meta) return { error: `Unknown caption provider: ${provider}` };
    const key = String(keyOverride || '').trim() || settings.getServiceKey(meta.service);
    if (!key) return { error: `No ${meta.name} key to test — paste one or save one first.` };
    await cloudCaptions.testConnection({ provider, key, fetchImpl: net.fetch });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

app.whenReady().then(() => {
  settings.ensureQualityDefault(); // brand-new installs start with preview copies on (Sprint 9)
  createWindow();
  // Agent draft bridge: only when the user left it enabled — while off, nothing listens.
  if (settings.getBridgeEnabled()) bridge.start().then(writeBridgeDiscovery).catch(() => {});
  // Find the graphics card's video encoder now (a short test encode), so the first export does not wait for it.
  setTimeout(() => require('./ffmpeg.cjs').pickEncoder(), 4000);
  // Screen recording (Media > Record screen).
  require('./screenrec.cjs').install({ app, getWin: () => win, ffmpegPath: require('./ffmpeg.cjs').ffmpegPath, probeAll });
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { bridge.stop(); writeBridgeDiscovery(); });
