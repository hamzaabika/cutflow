// FVE_SMOKE_MODE=gate: §8 creator-ready E2E gate, in-app half.
// The runner (scripts/test-creator-ready-gate.cjs) writes <dir>/gate-plan.json:
//   { steps: [{ id, projectFile?, actions: [...] }] }
// Each action is executed in order against the live app; observations are
// appended to <dir>/gate-result.json under the step id. The runner launches
// the app once per step (resilient to sibling `pkill -x electron` kills),
// then measures exported files itself with ffprobe / loudnorm / export QC.
//
// Actions:
//   { op: 'load' }                    load step.projectFile via __fve.load
//   { op: 'seek', t }                 __fve.seek(t)
//   { op: 'tab', id }                 __fve.tab(id)  (left-panel tab)
//   { op: 'dispatch', action }        __fve.dispatch(action)
//   { op: 'eval', js, key }           run JS in the renderer, store JSON value under key
//   { op: 'exportData', file }        write __fve.exportData() to file
//   { op: 'export', file }            __fve.exportNow(), rename the smoke export to file
//   { op: 'save', file }              save the current project JSON to file via window.api.saveProject
//   { op: 'shot', file }              capture the .stage rect to file
//   { op: 'wait', ms }
//   { op: 'click', selector }         click the first element matching selector (throws if none)
//
// The executor never invents a result: an action that throws records the
// error on the step and the step is reported failed by the runner.
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function gateSmoke(win, dir, result) {
  const q = (js) => win.webContents.executeJavaScript(js);
  const planPath = path.join(dir, 'gate-plan.json');
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  const outPath = path.join(dir, 'gate-result.json');
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { steps: {} };

  const dismissWelcome = async () => {
    for (let i = 0; i < 20; i++) {
      const gone = await q(`(() => { const b = document.querySelector('.welcome-go'); if (b) b.click(); return !document.querySelector('.welcome-root'); })()`).catch(() => true);
      if (gone) return;
      await wait(250);
    }
    throw new Error('Welcome card did not dismiss');
  };

  for (const step of plan.steps) {
    const obs = { actions: {}, error: null };
    // Flush after EVERY action: a sibling stream's `pkill -x electron`
    // can take this app down mid-step, and evidence must survive the kill.
    const flush = () => {
      out.steps[step.id] = obs;
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
      result.gate = out;
    };
    try {
      // Most steps enter the editor via a preset card; a step with
      // skipHome stays on the Home screen (e.g. to read the autosave slots
      // through the app API after a forced quit).
      if (!step.skipHome) {
        await q(`(() => { const el = document.querySelector('.home-create'); if (el) el.click(); return true; })()`).catch(() => {});
        await wait(1200);
        await dismissWelcome();
      } else {
        await wait(1200);
      }
      if (step.projectFile) {
        const project = JSON.parse(fs.readFileSync(path.join(dir, step.projectFile), 'utf8'));
        await q(`window.__fve.load(${JSON.stringify(project)})`);
        await wait(1500);
      }
      for (const a of step.actions || []) {
        if (a.op === 'open') {
          // Real file-open path (loadProjectFile -> afterLoadNotes): the
          // only path that runs the missing-media check + relink dialog.
          // __fve.load (dispatch 'load') bypasses it by design.
          const r = await q(`(async () => { try { return await window.api.openProjectPath(${JSON.stringify(path.join(dir, a.file))}); } catch (e) { return { error: String(e) }; } })()`);
          obs.actions.open = r;
          await wait(2000);
        } else if (a.op === 'load') {
          const project = JSON.parse(fs.readFileSync(path.join(dir, a.file), 'utf8'));
          await q(`window.__fve.load(${JSON.stringify(project)})`);
          await wait(1500);
        } else if (a.op === 'seek') {
          await q(`window.__fve.seek(${a.t})`);
          await wait(600);
        } else if (a.op === 'tab') {
          await q(`window.__fve.tab(${JSON.stringify(a.id)})`);
          await wait(600);
        } else if (a.op === 'dispatch') {
          await q(`window.__fve.dispatch(${JSON.stringify(a.action)})`);
          await wait(500);
        } else if (a.op === 'eval') {
          obs.actions[a.key || 'eval'] = await q(a.js);
        } else if (a.op === 'exportData') {
          const data = await q(`window.__fve.exportData()`);
          fs.writeFileSync(path.join(dir, a.file), JSON.stringify(data, null, 2));
        } else if (a.op === 'export') {
          // Same settle logic as the golden smoke: poll the job state text
          // (the tray poll is blind — the file on disk is ground truth),
          // then rename the smoke export ui-export.mp4.
          await q(`window.__fve.exportNow()`);
          let done = false;
          let status = '';
          for (let i = 0; i < 600; i++) {
            await wait(500);
            status = await q(`document.querySelector('.xjob-state, .xjob-err-title')?.textContent || ''`).catch(() => '');
            if (/complete|failed/i.test(status)) { done = true; break; }
          }
          if (!done) throw new Error(`export for step ${step.id} did not settle`);
          if (!/complete/i.test(status || '')) {
            const err = await q(`document.querySelector('.xjob-error')?.textContent || document.querySelector('.error-log')?.textContent || null`).catch(() => null);
            throw new Error(`export for step ${step.id} failed: ${status} ${err || ''}`);
          }
          const src = path.join(dir, 'ui-export.mp4');
          if (!fs.existsSync(src)) throw new Error(`export file missing for step ${step.id} (ui-export.mp4 not on disk)`);
          fs.renameSync(src, path.join(dir, a.file));
          obs.actions.exportFile = a.file;
          await wait(400);
        } else if (a.op === 'save') {
          // Headless note: the app's project:save only writes directly when
          // the file is already a known project file, otherwise it opens a
          // native save dialog (undrivable headless). The gate's save step
          // verifies the SERIALIZED project round-trips byte-identically
          // through write-to-disk + reload — the same JSON the app writes —
          // not the dialog itself; that limitation is stated in the report.
          const data = await q(`window.__fve.exportData()`);
          fs.writeFileSync(path.join(dir, a.file), JSON.stringify(data.project, null, 2));
          obs.actions.save = { file: a.file, bytes: fs.statSync(path.join(dir, a.file)).size };
        } else if (a.op === 'shot') {
          const rect = await q(`(() => { const el = document.querySelector('.stage'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
          if (!rect || rect.width < 10) throw new Error('no .stage rect for shot');
          fs.writeFileSync(path.join(dir, a.file), (await win.capturePage(rect)).toPNG());
        } else if (a.op === 'wait') {
          await wait(a.ms);
        } else if (a.op === 'waitForFile') {
          const re = new RegExp(a.pattern);
          const deadline = Date.now() + (a.timeoutMs || 300000);
          let found = null;
          let settled = false;
          while (Date.now() < deadline) {
            await wait(2000);
            const states = await q(`[...document.querySelectorAll('.xjob-state, .xjob-err-title')].map((e) => e.textContent || '')`).catch(() => []);
            settled = states.length > 0 && states.every((s) => /complete|failed/i.test(s));
            found = fs.readdirSync(dir).find((f) => re.test(f) && fs.statSync(path.join(dir, f)).size > 0);
            if (found && settled) break;
          }
          obs.actions[a.key || 'waitForFile'] = found;
          if (!found) throw new Error(`waitForFile: no file matching ${a.pattern} after ${a.timeoutMs || 300000}ms`);
          if (!settled) throw new Error(`waitForFile: ${found} appeared but no export job settled (tray still running?)`);
        } else if (a.op === 'click') {
          const clicked = await q(`(() => { const el = document.querySelector(${JSON.stringify(a.selector)}); if (!el) return false; el.click(); return true; })()`);
          if (!clicked) throw new Error(`click: no element for ${a.selector}`);
          await wait(600);
        } else {
          throw new Error(`unknown gate action op ${a.op}`);
        }
        flush();
      }
    } catch (e) {
      obs.error = e.message;
    }
    if (!obs.error) obs.done = true;
    flush();
  }
};
