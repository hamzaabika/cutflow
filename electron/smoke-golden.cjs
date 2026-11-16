// FVE_SMOKE_MODE=golden: P1-19 deterministic golden-frame suite, in-app half.
// The runner (scripts/test-golden-frames.cjs) writes <dir>/cases.json:
//   [{ name, projectFile, t, useTemplates }]
// For each case this mode loads the project, seeks the preview to the fixed
// time, captures the preview stage exactly as the user sees it
// (win.capturePage over the '.stage' rect), then exports the same project
// through the real pipeline (exportNow) and renames the smoke export to
// export-<name>.mp4. The runner compares preview PNG vs exported frame.
//
// Determinism by construction: every case's frame content is a pure function
// of the project time t — solid-colour / static-gradient media (no
// frame-to-frame variation), text entrances fully settled at t, no loops,
// no particles, no speed ramps. The video elements only need to be decoded
// and seeked, never played, so no wall-clock or rAF timing leaks in.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function goldenSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const shotStage = async (name) => {
    const rect = await q(`(() => { const el = document.querySelector('.stage'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
    if (!rect || rect.width < 10 || rect.height < 10) throw new Error(`no .stage rect (got ${JSON.stringify(rect)})`);
    fs.writeFileSync(path.join(dir, name), (await win.capturePage(rect)).toPNG());
    return rect;
  };
  const dismissWelcome = async () => {
    // First-run Welcome card (WelcomeCard.jsx): shows once on first entry
    // into the editor and dims the stage behind it — a capture taken under
    // it reads ~3x too dark. Its "Start creating" button closes it.
    for (let i = 0; i < 20; i++) {
      const gone = await q(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !document.querySelector('.welcome-root'); })()`).catch(() => true);
      if (gone) return;
      await wait(250);
    }
    throw new Error('Welcome card did not dismiss');
  };
  // Fit the stage to exactly the project frame (640x360): the comparison is
  // pixel-exact, so a 626x352 capture resampled to 640x360 smears
  // high-frequency content (scanlines, text edges) and fails cases that are
  // actually in parity. Grow the window by the rect delta until the stage
  // lands on 640x360 (or 5 tries, after which the driver compares at the
  // stage's native size instead).
  const fitStage = async () => {
    for (let i = 0; i < 5; i++) {
      const r = await q(`(() => { const el = document.querySelector('.stage'); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })()`);
      if (!r) throw new Error('no .stage to fit');
      if (r.w === 640 && r.h === 360) return { width: 640, height: 360 };
      const [cw, ch] = win.getContentSize();
      win.setContentSize(cw + (640 - r.w), ch + (360 - r.h));
      await wait(400);
    }
    const r = await q(`(() => { const b = document.querySelector('.stage').getBoundingClientRect(); return { width: Math.round(b.width), height: Math.round(b.height) }; })()`);
    console.log(`golden: stage fit stopped at ${r.width}x${r.height} (target 640x360)`);
    return r;
  };
  // Wait until every visible stage video has decoded frames: a transition's
  // incoming clip renders black in the transition canvas until its video
  // element is seeked + ready, which reads as a false parity failure.
  const waitMediaReady = async () => {
    for (let i = 0; i < 40; i++) {
      const ready = await q(`(() => {
        const vids = [...document.querySelectorAll('.stage video')].filter((v) => {
          const slot = v.closest('.slot');
          return slot && getComputedStyle(slot).visibility === 'visible' && v.style.display !== 'none';
        });
        return vids.length === 0 || vids.every((v) => v.readyState >= 3);
      })()`).catch(() => false);
      if (ready) break;
      await wait(250);
    }
    await wait(800);
  };
  const cases = JSON.parse(fs.readFileSync(path.join(dir, 'cases.json'), 'utf8'));
  result.cases = {};

  win.setContentSize(1440, 900);
  await wait(800);
  // The app starts on the Home screen: enter the editor through a preset card first, then load.
  await q(`document.querySelector('.home-create').click()`);
  await wait(600);
  await dismissWelcome();
  await wait(400);
  await fitStage();

  for (const c of cases) {
    const entry = { t: c.t, stage: null, exportStatus: null, exportFile: null };
    result.cases[c.name] = entry;
    const project = fs.readFileSync(path.join(dir, c.projectFile), 'utf8');
    await q(`window.__fve.load(${project})`);
    await wait(1200);
    if (c.useTemplates) {
      await q(`window.__fve.applyTemplates()`);
      await wait(400);
    }
    await q(`window.__fve.pause(); window.__fve.seek(${c.t})`);
    // Settle: video elements seeked + one redraw. Content is time-invariant
    // per case by construction, so a fixed settle is enough; poll the
    // transport timecode as the liveness check, not the frame.
    for (let i = 0; i < 20; i++) {
      const tc = await q(`document.querySelector('.tc')?.textContent || ''`).catch(() => '');
      if (tc) break;
      await wait(250);
    }
    await wait(1200);
    await dismissWelcome();
    await waitMediaReady();
    entry.stage = await shotStage(`preview-${c.name}.png`);

    // Real export through the same path a user triggers (no summary gate in smoke).
    await q(`window.__fve.exportNow()`);
    let done = false;
    for (let i = 0; i < 360; i++) {
      await wait(500);
      const st = await q(`document.querySelector('.xjob-state, .xjob-err-title')?.textContent || ''`).catch(() => '');
      if (/complete|failed/i.test(st)) { entry.exportStatus = st; done = true; break; }
    }
    if (!done) throw new Error(`export for case ${c.name} did not settle`);
    if (!/complete/i.test(entry.exportStatus || '')) {
      entry.exportError = await q(`document.querySelector('.error-log')?.textContent || null`).catch(() => null);
      throw new Error(`export for case ${c.name} failed: ${entry.exportStatus} ${entry.exportError || ''}`);
    }
    const src = path.join(dir, 'ui-export.mp4');
    if (!fs.existsSync(src)) throw new Error(`export file missing for case ${c.name} (ui-export.mp4 not on disk)`);
    const dst = path.join(dir, `export-${c.name}.mp4`);
    fs.renameSync(src, dst);
    entry.exportFile = `export-${c.name}.mp4`;
    await wait(400);
  }
};
