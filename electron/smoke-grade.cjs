// FVE_SMOKE_MODE=grade: Adjust > Basic through the interface (warmer, darker, vignette), the player picture
// changes the expected way, and the export gets the same grade.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ffmpegPath, probe } = require('./ffmpeg.cjs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function gradeSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const until = async (js, ms) => { for (let t = 0; t < ms; t += 500) { if (await q(js)) return true; await wait(500); } return false; };
  // Mean R, G, B of the player picture (center area), and of the corners.
  const playerColor = async () => {
    const r = await q(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    const img = await win.capturePage(r);
    const { width: w, height: h } = img.getSize();
    const bmp = img.toBitmap(); // BGRA
    const mean = (x0, y0, x1, y1) => {
      const s = [0, 0, 0];
      let n = 0;
      for (let y = Math.floor(y0 * h); y < Math.floor(y1 * h); y += 2) for (let x = Math.floor(x0 * w); x < Math.floor(x1 * w); x += 2) {
        const i = (y * w + x) * 4;
        s[0] += bmp[i + 2]; s[1] += bmp[i + 1]; s[2] += bmp[i]; n++;
      }
      return s.map((v) => Math.round(v / n));
    };
    return { center: mean(0.35, 0.35, 0.65, 0.65), corner: mean(0.02, 0.02, 0.12, 0.12) };
  };
  // NumBox only commits on Enter / blur / arrow keys — typing (the 'input'
  // event) merely edits its local text. Setting the value without blurring
  // leaves the grade untouched (the pre-fix run recorded grade/hsl as
  // undefined and after == before). Focus, set, input, blur — as separate
  // evaluate calls with small waits, so React flushes the focus/input state
  // between steps instead of batching the whole sequence (a starved
  // renderer dropped the commit when all three ran in one synchronous task).
  const setNum = async (name, v) => {
    const sel = `.left input[aria-label="${name} value"]`;
    await q(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.focus(); return !!el; })()`);
    await wait(100);
    await q(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${v}');
      el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await wait(100);
    await q(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.blur(); })()`);
    await wait(100);
  };

  win.show();
  win.moveTop();
  await wait(800);
  // The app starts on the Home screen: enter the editor through a preset card first, then load.
  // (Same entry step as smoke-textanim.cjs; without it __fve.load() leaves the app on Home
  // and every editor query below throws — .stage null.)
  await q(`document.querySelector('.home-create')?.click()`);
  await wait(600);
  // One clip only (the city), so the export is short.
  const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'));
  project.videoClips = project.videoClips.slice(0, 1).map((c) => ({ ...c, filter: 'none', effects: [], transition: null }));
  project.overlayClips = [];
  project.effectClips = [];
  project.stickerClips = [];
  project.textClips = [];
  project.markers = [];
  await q(`window.__fve.load(${JSON.stringify(project)})`);
  await wait(1500);
  await q(`window.__fve.seek(1); window.__fve.select({ track: 'video', id: '${project.videoClips[0].id}' }); window.__fve.tab('adjust')`);
  await wait(1200);
  // Wait for a decoded frame: reading the player colour while the video is
  // still buffering records black ([0,0,0]) instead of the picture. Retry
  // the read until the centre is non-black (bounded — a stuck decode fails
  // the run on the colour assertions, not here).
  await until(`[...document.querySelectorAll('video')].some((v) => v.readyState >= 3 && v.currentTime > 0)`, 20000);
  for (let i = 0; i < 5; i++) {
    result.before = await playerColor();
    if (result.before.center.some((v) => v !== 0) || result.before.corner.some((v) => v !== 0)) break;
    await wait(1000);
  }
  result.rows = await q(`[...document.querySelectorAll('.left .grade-row .grade-top span')].map((s) => s.textContent)`);
  await setNum('Temp', 80);
  await setNum('Exposure', -40);
  await setNum('Vignette', 100);
  await wait(1500);
  result.grade = (await q('window.__fve.exportData().project.videoClips[0].grade'));
  result.after = await playerColor();
  fs.writeFileSync(path.join(dir, 'grade-panel.png'), (await win.capturePage(await q(`(() => { const b = document.querySelector('.left').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`))).toPNG());
  fs.writeFileSync(path.join(dir, 'grade-player.png'), (await win.capturePage()).toPNG());

  // HSL: take the color out of the reds and oranges (the sunset), then Curves: darker mid tones.
  const clickTab = (name) => q(`[...document.querySelectorAll('.left .grade-tabs button')].find((b) => b.textContent === '${name}').click()`);
  await clickTab('HSL');
  await wait(300);
  for (const color of ['Red', 'Orange']) {
    await q(`document.querySelector('.left .hsl-dot[aria-label="${color}"]').click()`);
    await wait(150);
    await setNum(`${color} Saturation`, -100);
    await wait(150);
  }
  await clickTab('Curves');
  await wait(300);
  await q(`(() => { const s = document.querySelector('.left .curves-box'); const r = s.getBoundingClientRect();
    const x = r.left + r.width * 0.5, y0 = r.top + r.height * 0.5, y1 = r.top + r.height * 0.68;
    s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y1 })); })()`);
  await wait(1500);
  const g2 = await q('window.__fve.exportData().project.videoClips[0].grade');
  result.hsl = g2.hsl;
  result.curve = g2.curves && g2.curves.master;
  result.afterHslCurves = await playerColor();
  fs.writeFileSync(path.join(dir, 'grade-curves.png'), (await win.capturePage(await q(`(() => { const b = document.querySelector('.left').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`))).toPNG());
  await clickTab('HSL');
  await wait(400);
  fs.writeFileSync(path.join(dir, 'grade-hsl.png'), (await win.capturePage(await q(`(() => { const b = document.querySelector('.left').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`))).toPNG());

  // LUT: the bundled "Neon" at 80 %.
  await clickTab('Basic');
  await wait(300);
  result.lutOptions = await q(`[...document.querySelectorAll('.left select[aria-label="LUT"] option')].map((o) => o.textContent)`);
  await q(`(() => { const el = document.querySelector('.left select[aria-label="LUT"]'); const o = [...el.options].find((x) => x.textContent === 'Neon');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, o.value); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(800);
  // The LUT row only renders once loadLut() resolves (async .cube load) —
  // wait for the intensity input instead of assuming 800 ms is enough.
  await until(`!!document.querySelector('.left input[aria-label="LUT intensity value"]')`, 15000);
  await setNum('LUT intensity', 80);
  await wait(1500);
  result.lut = (await q('window.__fve.exportData().project.videoClips[0].grade')).lut;
  result.afterLut = await playerColor();
  fs.writeFileSync(path.join(dir, 'grade-lut.png'), (await win.capturePage(await q(`(() => { const b = document.querySelector('.left').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()`))).toPNG());

  // Export and compare the same frame with the original media.
  const out = path.join(dir, 'ui-export.mp4');
  fs.rmSync(out, { force: true });
  await q('window.__fve.exportNow()');
  // Export completion is signaled by the jobs tray (.xjob-ic.ok), not by a
  // .modal-icon.ok element — no component renders that class anymore, so the
  // old selector waited the full 300 s on every run.
  result.exportDone = await until(`!!document.querySelector('.xjob-ic.ok, .xjob-ic.error')`, 300000);
  result.exportResult = await q(`document.querySelector('#export-title')?.textContent + ' ' + (document.querySelector('.error-log')?.textContent || '').slice(0, 300)`);
  if (fs.existsSync(out)) {
    const info = await probe(out);
    const frame = (file, ss) => execFileSync(ffmpegPath, ['-v', 'error', '-ss', String(ss), '-i', file, '-frames:v', '1', '-vf', `scale=${info.width}:${info.height}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1e8 });
    const m = project.media.find((x) => x.id === project.videoClips[0].mediaId);
    const mean = (buf, x0, y0, x1, y1) => {
      const s = [0, 0, 0];
      let n = 0;
      for (let y = Math.floor(y0 * info.height); y < Math.floor(y1 * info.height); y += 2) for (let x = Math.floor(x0 * info.width); x < Math.floor(x1 * info.width); x += 2) {
        const i = (y * info.width + x) * 3;
        s[0] += buf[i]; s[1] += buf[i + 1]; s[2] += buf[i + 2]; n++;
      }
      return s.map((v) => Math.round(v / n));
    };
    const ex = frame(out, 1);
    const src = frame(m.path, project.videoClips[0].in + 1);
    result.export = { center: mean(ex, 0.35, 0.35, 0.65, 0.65), corner: mean(ex, 0.02, 0.02, 0.12, 0.12) };
    result.source = { center: mean(src, 0.35, 0.35, 0.65, 0.65), corner: mean(src, 0.02, 0.02, 0.12, 0.12) };
  }
};
