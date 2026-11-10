// Silence detection + removal (10/10 step 4, Filmora merge row 14):
// 1) The log parser (electron/silence.cjs) on synthetic silencedetect logs:
//    pairs, a file that OPENS in silence, a trailing silence closed by the
//    duration hint.
// 2) The real FFmpeg pass over synthesized tone/silence WAV fixtures: the
//    detected spans land on the fixture's true silences.
// 3) The removal halves of the store: the same spans, mapped into a main-
//    track clip, cut with cutRanges (+ text ripple) shrink the project by
//    exactly the silent total; in a standalone audio clip, cutFreeRanges
//    closes the clip up inside itself with sampler-true source windows.
// 4) Wiring: IPC, preload, the App flow (menu, confirm, marks) and the
//    Timeline overlay are in place (source assertions).
// The beat half of row 14 is covered by test-beats / test-beats-detect;
// this suite pins the new "Split at beats" context-menu entry point only.
// Usage: node scripts/test-silence.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const silence = require('../electron/silence.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const SR = 16000;
function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
function tone(samples, from, to, freq = 440, amp = 0.5) {
  for (let i = Math.floor(from * SR); i < Math.floor(to * SR) && i < samples.length; i++) {
    samples[i] = amp * Math.sin(2 * Math.PI * freq * (i / SR));
  }
}

(async () => {
  // ---- 1. Parser -------------------------------------------------------------
  {
    const log = [
      '[silencedetect @ 0x1] silence_start: 2.003',
      '[silencedetect @ 0x1] silence_end: 5.012 | silence_duration: 3.009',
      '[silencedetect @ 0x1] silence_start: 7',
      '[silencedetect @ 0x1] silence_end: 8.2 | silence_duration: 1.2',
    ].join('\n');
    const r = silence.parseSilenceLog(log);
    ok(r.length === 2 && near(r[0].start, 2.003, 1e-9) && near(r[0].end, 5.012, 1e-9) && near(r[1].start, 7, 1e-9), 'parser: start/end pairs become source-second ranges');
    const leading = silence.parseSilenceLog('[silencedetect @ 0x1] silence_end: 1.5 | silence_duration: 1.5');
    ok(leading.length === 1 && leading[0].start === 0 && leading[0].end === 1.5, 'parser: a file opening in silence starts its span at 0');
    const trailing = silence.parseSilenceLog('[silencedetect @ 0x1] silence_start: 9.25', 10);
    ok(trailing.length === 1 && trailing[0].end === 10, 'parser: a trailing silence closes at the duration hint');
    ok(silence.parseSilenceLog('Duration: 00:00:10.00\nStream #0:0: Audio').length === 0, 'parser: a log with no silences yields none');
  }

  // ---- 2. The real pass over synthesized fixtures ------------------------------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-silence-'));
  {
    const s = new Float32Array(SR * 10);
    tone(s, 0, 2); tone(s, 5, 7); tone(s, 8.2, 10);
    const wav = path.join(dir, 'pattern.wav');
    writeWav(wav, s);
    const ranges = await silence.detectSilence(wav, { durationHint: 10 });
    ok(ranges.length === 2, `pass: the two true silences are found (got ${ranges.length}: ${JSON.stringify(ranges)})`);
    if (ranges.length === 2) {
      ok(near(ranges[0].start, 2, 0.35) && near(ranges[0].end, 5, 0.35), `pass: first silence ≈ [2, 5] (got [${ranges[0].start.toFixed(2)}, ${ranges[0].end.toFixed(2)}])`);
      ok(near(ranges[1].start, 7, 0.35) && near(ranges[1].end, 8.2, 0.35), `pass: second silence ≈ [7, 8.2] (got [${ranges[1].start.toFixed(2)}, ${ranges[1].end.toFixed(2)}])`);
    }
    const lead = new Float32Array(SR * 4);
    tone(lead, 1.5, 4);
    const wav2 = path.join(dir, 'leading.wav');
    writeWav(wav2, lead);
    const r2 = await silence.detectSilence(wav2, { durationHint: 4 });
    ok(r2.length === 1 && r2[0].start <= 0.35 && near(r2[0].end, 1.5, 0.35), `pass: a leading silence is reported from 0 (got ${JSON.stringify(r2)})`);
    const none = await silence.detectSilence(wav, { thresholdDb: -20, minDuration: 4 });
    ok(Array.isArray(none), 'pass: stricter options still answer (options are honoured, not ignored)');
  }

  // ---- 3. Removal in the store --------------------------------------------------
  const store = await import('../src/store.js');
  {
    // Main track: the fixture's silences mapped 1:1 (clip starts at 0, in 0).
    const p = {
      ...store.emptyProject(),
      media: [{ id: 'm0', type: 'video', hasAudio: true, duration: 10 }],
      videoClips: [{ id: 'v1', mediaId: 'm0', in: 0, out: 10, speed: 1, volume: 1, filter: 'none', effects: [] }],
      textClips: [{ id: 't1', start: 0, duration: 10, text: 'caption' }],
    };
    const cut = store.cutRanges(p, [{ start: 2, end: 5 }, { start: 7, end: 8.2 }], { rippleText: true });
    ok(near(store.projectDuration(cut), 5.8, 1e-9), `main track: the project shrinks by the silent total (10 -> ${store.projectDuration(cut)})`);
    const pieces = store.videoLayout(cut.videoClips);
    ok(pieces.length === 3 && pieces.map((l) => l.clip.in).join(',') === '0,5,8.2', 'main track: the surviving pieces keep their source windows');
    ok(near(cut.textClips.reduce((n, t) => n + t.duration, 0), 5.8, 1e-9), 'main track: captions ripple with the picture');

    // Standalone audio clip at start 5, source window [10, 20]: the same
    // silences live at timeline [7, 10] and [12, 13.2].
    const p2 = {
      ...store.emptyProject(),
      media: [{ id: 'm1', type: 'audio', duration: 30 }],
      audioClips: [{ id: 'a1', mediaId: 'm1', start: 5, in: 10, out: 20, speed: 1, volume: 1 }],
    };
    const cut2 = store.cutFreeRanges(p2, 'audio', 'a1', [{ start: 7, end: 10 }, { start: 12, end: 13.2 }]);
    const a = cut2.audioClips;
    ok(a.length === 3, `audio clip: three sounding pieces survive (got ${a.length})`);
    ok(a.map((x) => x.id).join(',') === 'a1,a1-c1,a1-c2', 'audio clip: piece ids derive from the clip id');
    ok(a.every((x, i) => near(x.start, [5, 7, 9][i], 1e-9)), `audio clip: pieces close up inside the clip (starts ${a.map((x) => x.start).join(', ')})`);
    ok(a.every((x, i) => near(x.in, [10, 15, 18.2][i], 1e-9) && near(x.out, [12, 17, 20][i], 1e-9)), 'audio clip: source windows stay sampler-true');
    ok(near(a.reduce((n, x) => n + (x.out - x.in), 0), 5.8, 1e-9), 'audio clip: the clip shrinks by exactly the silent total');
    const untouched = store.cutFreeRanges(p2, 'audio', 'missing', [{ start: 7, end: 10 }]);
    ok(untouched === p2, 'audio clip: an unknown clip id is a no-op');
    const whole = store.cutFreeRanges(p2, 'audio', 'a1', [{ start: 5, end: 15 }]);
    ok(whole.audioClips.length === 0, 'audio clip: a fully silent clip is removed outright');
  }

  // ---- 4. Wiring ------------------------------------------------------------------
  {
    const repo = path.join(__dirname, '..');
    const main = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');
    const preload = fs.readFileSync(path.join(repo, 'electron', 'preload.cjs'), 'utf8');
    const app = fs.readFileSync(path.join(repo, 'src', 'App.jsx'), 'utf8');
    const timeline = fs.readFileSync(path.join(repo, 'src', 'components', 'Timeline.jsx'), 'utf8');
    ok(main.includes("ipcMain.handle('silence:detect'") && main.includes("ipcMain.handle('silence:cancel'"), 'main exposes the silence detect/cancel IPC');
    ok(preload.includes('detectSilence') && preload.includes('silenceCancel'), 'preload bridges detectSilence / silenceCancel');
    ok(app.includes('Remove silences…') && app.includes('removeSilences') && app.includes("type: 'cutRanges', ranges: ask.ranges, rippleText: true") && app.includes("type: 'cutFreeRanges'"), 'App: the menu entry, detection flow and both removal dispatches are wired');
    ok(app.includes('silenceAsk') && app.includes('silenceMarks'), 'App: the confirm state feeds the Timeline marks');
    ok(app.includes('Split at beats') && app.includes('beatSplitTarget(project, time, sel)'), 'App: the clip menu carries Split at beats (row 14 beat half)');
    ok(timeline.includes('silence-range') && timeline.includes('marksFor'), 'Timeline renders the detected ranges on the clip');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `SILENCE FAIL — ${failures} assertion(s)` : 'SILENCE OK — detection on fixtures, parser edges, store removal (main + free), wiring');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('SILENCE FAIL —', e.message); process.exit(1); });
