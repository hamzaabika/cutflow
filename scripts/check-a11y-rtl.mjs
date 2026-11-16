// Live accessibility + RTL check (B-UX8, B-UX9): boots the built app on
// Xvfb, walks the real DOM and measures what a static test cannot:
//   - hit targets: every visible interactive element >= 24x24 CSS px
//     (WCAG 2.2 AA minimum target size);
//   - contrast: every visible text run's computed colour vs its effective
//     background, >= 4.5:1 normal text, >= 3:1 large text / UI parts;
//   - focus: no positive tabindex, a visible :focus-visible outline, and a
//     Tab walk that reaches the toolbar, panels and timeline;
//   - scaling: at 125/150/200% (deviceScaleFactor) the app must not gain a
//     horizontal scrollbar or clip the top bar / timeline;
//   - RTL (B-UX9): the same pass in Arabic — mixed Arabic/Latin text,
//     punctuation side, and timecode digits — plus review screenshots.
// Run AFTER `npm run build`:
//   TMPDIR=~/workspace/.tmp-battery node scripts/check-a11y-rtl.mjs [en|ar]
// Screenshots land in ~/workspace/cutflow-shots/a11y-rtl/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 9253;
const LANG = process.argv[2] || 'en';
const EXPORT_LABEL = LANG === 'ar' ? 'تصدير' : 'Export';
const SHOTS = '/home/hatch/workspace/cutflow-shots/a11y-rtl';
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

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
      const page = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl && x.url.includes('.tmp-gap-d'));
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target never appeared');
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-a11y-'));
const env = { ...process.env, HOME: home, DISPLAY: ':99', VK_ICD_FILENAMES: '/home/hatch/workspace/vulkan/lvp_icd.json' };
const args = ['.', '--no-sandbox', '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`];
if (LANG === 'ar') args.push('--lang=ar');
const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron'), args, { cwd: ROOT, env, stdio: 'pipe', detached: true });
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
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };
  const waitFor = async (expr, label, tries = 40) => {
    for (let i = 0; i < tries; i += 1) { try { if (await ev(expr)) return true; } catch { /* mid-navigation */ } await sleep(500); }
    throw new Error('timeout waiting for ' + label);
  };

  await waitFor(`document.body.children.length > 0`, 'app shell');
  await sleep(1000);
  // Dismiss the first-run Welcome modal if it is up (it swallows pointer hits).
  await ev(`[...document.querySelectorAll('button')].find((b) => /got it|dismiss|close|fermer|إغلاق|فهمت/i.test(b.textContent))?.click()`);
  await sleep(500);
  check('app boots on .tmp-gap-d', (await ev(`location.href`)).includes('.tmp-gap-d'));

  // Enter the editor.
  if (!(await ev(`!!document.querySelector('section.timeline')`))) {
    await ev(`document.querySelector('.home-create')?.click()`);
    await waitFor(`!!document.querySelector('section.timeline')`, 'editor timeline');
  }
  await sleep(1200);
  // The first-run Welcome card opens on first entry into the editor (not
  // on Home) — dismiss it here, before any screenshot or pointer drive.
  await ev(`document.querySelector('.welcome-go')?.click()`);
  await sleep(600);
  await shot(`${LANG}-editor.png`);

  // ---- The audit: one evaluate, returns a JSON report ----
  const audit = await ev(`(() => {
    const out = { smallTargets: [], lowContrast: [], posTabindex: 0, tabbable: 0, focusOutline: '', overflowX: false };
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    };
    const label = (el) => (el.className && String(el.className).split(' ').slice(0, 2).join('.')) + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label').slice(0, 30) + ']' : '') + (el.textContent ? '"' + el.textContent.trim().slice(0, 24) + '"' : '');
    // Hit targets.
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) out.smallTargets.push({ tag: el.tagName, w: +r.width.toFixed(1), h: +r.height.toFixed(1), label: label(el) });
    }
    // Contrast.
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { c: p.slice(0, 3), a: p[3] ?? 1 }; };
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0.9) return bg.c;
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      if (!el.childNodes.length) continue;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!text || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden') continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = bgOf(el);
      const l1 = lum(fg.c), l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const min = large ? 3 : 4.5;
      const key = fg.c + '|' + bg + '|' + el.textContent.trim().slice(0, 40);
      if (ratio < min && !seen.has(key)) {
        seen.add(key);
        out.lowContrast.push({ ratio: +ratio.toFixed(2), min, size, fg: cs.color, bg: 'rgb(' + bg.join(', ') + ')', text: el.textContent.trim().slice(0, 48), label: label(el) });
      }
    }
    // Focus order.
    for (const el of document.querySelectorAll('[tabindex]')) {
      const ti = parseInt(el.getAttribute('tabindex'), 10);
      if (ti > 0) out.posTabindex++;
    }
    out.tabbable = [...document.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].filter(visible).length;
    const firstBtn = document.querySelector('button');
    if (firstBtn) {
      firstBtn.focus();
      const cs = getComputedStyle(firstBtn);
      out.focusOutline = cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor;
    }
    out.overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return out;
  })()`);

  console.log('--- audit @100% ---');
  console.log('small targets (<24px):', audit.smallTargets.length);
  for (const s of audit.smallTargets.slice(0, 40)) console.log('  ', JSON.stringify(s));
  console.log('low contrast:', audit.lowContrast.length);
  for (const s of audit.lowContrast.slice(0, 40)) console.log('  ', JSON.stringify(s));
  console.log('positive tabindex:', audit.posTabindex, '| tabbable:', audit.tabbable, '| focus outline:', audit.focusOutline, '| overflowX:', audit.overflowX);
  check('no interactive element under 24x24', audit.smallTargets.length === 0, `${audit.smallTargets.length} small`);
  check('no text below contrast minimum', audit.lowContrast.length === 0, `${audit.lowContrast.length} low`);
  check('no positive tabindex', audit.posTabindex === 0, `${audit.posTabindex} positive`);
  check('no horizontal overflow at 100%', audit.overflowX === false);

  // Focus: real keyboard focus — Tab through the first stops and read the
  // ring off the actually-focused element. (:focus-visible only matches
  // keyboard focus; the scripted .focus() in the audit above never
  // triggers it, so it cannot tell us whether keyboard focus is visible.)
  const focusWalk = [];
  await ev(`document.activeElement?.blur();`);
  for (let i = 0; i < 12; i++) {
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await sleep(150);
    focusWalk.push(await ev(`(() => { const el = document.activeElement; if (!el || el === document.body) return null; const cs = getComputedStyle(el); return { tag: el.tagName, label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32), outline: cs.outlineStyle + ' ' + cs.outlineWidth, ring: cs.boxShadow.slice(0, 48) }; })()`));
  }
  console.log('focus walk (Tab x12):');
  focusWalk.forEach((f, i) => console.log('  ', i + 1, JSON.stringify(f)));
  const stops = focusWalk.filter(Boolean);
  // A ring counts when it is an outline or an OUTSET box-shadow. An inset
  // shadow is the active-tab underline, not a focus indicator.
  const ringed = stops.filter((f) => f.outline !== 'none 0px' || (f.ring !== 'none' && !f.ring.includes('inset')));
  check('Tab reaches interactive elements', stops.length >= 6, `${stops.length} stops`);
  check('keyboard-focused elements show a visible ring', ringed.length >= Math.max(1, stops.length - 2), `${ringed.length}/${stops.length} with a ring`);

  // ---- Scaling 125 / 150 / 200% ----
  for (const dsf of [1.25, 1.5, 2]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: dsf, mobile: false });
    await sleep(800);
    const ov = await ev(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, exportVisible: (() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(EXPORT_LABEL)})); if (!b) return 'no-export-btn'; const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight ? 'yes' : 'clipped'; })() })`);
    console.log(`scaling ${Math.round(dsf * 100)}%: scrollWidth ${ov.sw} vs clientWidth ${ov.cw}, export button ${ov.exportVisible}`);
    check(`no horizontal overflow at ${Math.round(dsf * 100)}%`, ov.sw <= ov.cw + 1, `sw=${ov.sw} cw=${ov.cw}`);
    check(`export button reachable at ${Math.round(dsf * 100)}%`, ov.exportVisible === 'yes', ov.exportVisible);
    await shot(`${LANG}-editor-${Math.round(dsf * 100)}pct.png`);
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

  // ---- RTL specifics (ar run only) ----
  if (LANG === 'ar') {
    check('html dir=rtl in Arabic', (await ev('document.documentElement.dir')) === 'rtl');
    check('timeline wrapper stays dir=ltr', (await ev(`document.querySelector('section.timeline')?.getAttribute('dir')`)) === 'ltr');
    // Timecode digits: the ruler / playhead readout must use Western digits.
    const tc = await ev(`(() => { const els = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /\\d{1,2}:\\d{2}/.test(e.textContent)); return els.slice(0, 5).map((e) => e.textContent.trim()); })()`);
    console.log('timecodes found:', JSON.stringify(tc));
    check('timecodes use Western digits', tc.length > 0 && tc.every((s) => !/[٠-٩]/.test(s)), JSON.stringify(tc));
    // Media-panel stats line: must not clip inside its panel.
    const stats = await ev(`(() => { const el = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /المعاينة متوسطة/.test(e.textContent)); if (!el) return null; const r = el.getBoundingClientRect(); return { sw: el.scrollWidth, cw: el.clientWidth, clipped: el.scrollWidth > el.clientWidth + 1, text: el.textContent.slice(0, 80) }; })()`);
    console.log('media stats line:', JSON.stringify(stats));
    check('media stats line does not clip', stats ? !stats.clipped : false, JSON.stringify(stats));
    // Mixed Arabic/Latin text clip: add one, type a mixed line, and look
    // at the preview. The inspector textarea is dir=auto, so the bidi
    // algorithm orders the runs; the screenshot is the visual evidence.
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'النص')?.click()`);
    await sleep(600);
    await ev(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('إضافة نص'))?.click()`);
    await waitFor(`!!document.querySelector('textarea[dir="auto"]')`, 'text inspector');
    await sleep(600);
    const setText = await ev(`(() => {
      const ta = document.querySelector('textarea[dir="auto"]');
      if (!ta) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'مرحبا Cutflow 2026!');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value;
    })()`);
    check('mixed text clip created', setText === 'مرحبا Cutflow 2026!', JSON.stringify(setText));
    // The default text clip fades in over 0.3s, so at t=0 it is invisible
    // by design — seek to mid-clip (1.5s of 3s) before judging the render.
    // The Welcome card opens deferred, so dismiss it again right before
    // each screenshot, or it covers the preview.
    const seekMid = async () => {
      await ev(`window.__fve?.seek(1.5)`);
      await sleep(800);
      return (await ev(`document.body.innerText.includes('00:01.50')`)) === true;
    };
    await seekMid();
    await ev(`document.querySelector('.welcome-go')?.click()`);
    await sleep(1200);
    await shot('ar-mixed-text.png');
    // Punctuation: an Arabic question + comma must sit on the correct
    // (right) side of the line in the inspector textarea's rendering.
    const punct = await ev(`(() => {
      const ta = document.querySelector('textarea[dir="auto"]');
      if (!ta) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, 'هل هذا يعمل؟ نعم، يعمل!');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return { dir: ta.getAttribute('dir'), value: ta.value };
    })()`);
    check('punctuation line kept with dir=auto', punct && punct.dir === 'auto' && punct.value === 'هل هذا يعمل؟ نعم، يعمل!', JSON.stringify(punct));
    await seekMid();
    await ev(`document.querySelector('.welcome-go')?.click()`);
    await sleep(1200);
    await shot('ar-punctuation.png');
  }

  cdp.close();
} catch (e) {
  console.error('LIVE ERROR:', e.message);
  console.error(stderr.slice(-800));
  results.push(['live run completed', false, e.message]);
} finally {
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  fs.rmSync(home, { recursive: true, force: true });
}

const failed = results.filter(([, c]) => !c);
console.log(failed.length ? `check-a11y-rtl: FAIL (${failed.length}/${results.length})` : `check-a11y-rtl: PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
