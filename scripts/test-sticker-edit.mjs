// P0-02: sticker split / edge-trim / free-cut must behave like the other
// duration-based tracks (text / effect). Re-probe of the audit findings:
//   - splitAt had no sticker branch: splitting a sticker was a silent no-op.
//   - the magnet-OFF trim path read o.in / o.out / o.speed on stickers
//     (which have none) and wrote { in: NaN, start: NaN }.
//   - trimClip's duration branch never moved `start` on a left trim:
//     a text clip { start: 2, duration: 3 } left-trimmed by 1 s came out
//     { start: 2, duration: 2 } instead of { start: 3, duration: 2 }.
//   - cutFreeRanges returned the project unchanged for stickers.
// Usage: node scripts/test-sticker-edit.mjs
import { emptyProject, historyReducer } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const finite = (v) => Number.isFinite(v);

function project() {
  const p = emptyProject();
  return {
    ...p,
    media: [],
    videoClips: [],
    stickerClips: [
      { id: 's1', sticker: 'star.png', name: 'Star', start: 2, duration: 4, transform: {}, opacity: 1, w: 480, h: 480 },
      { id: 's2', sticker: 'heart.png', name: 'Heart', start: 8, duration: 2, transform: {}, opacity: 1, w: 480, h: 480 },
    ],
    textClips: [{ id: 't1', text: 'hello', start: 2, duration: 3 }],
    effectClips: [],
    magnet: { ...p.magnet, sticker: true, text: true },
  };
}
const run = (state, actions) => actions.reduce((s, a) => historyReducer(s, a), state);
const st = (p) => ({ past: [], present: p, future: [] });

// 1. Split a sticker at t=4 (middle of s1: start 2, duration 4).
{
  const s = run(st(project()), [{ type: 'split', track: 'sticker', id: 's1', t: 4, newId: 's1b' }]);
  const out = s.present.stickerClips;
  const a = out.find((x) => x.id === 's1');
  const b = out.find((x) => x.id === 's1b');
  ok(out.length === 3, `split sticker yields 3 clips (got ${out.length})`);
  ok(a && a.start === 2 && a.duration === 2, `split left half {start 2, duration 2} (got ${a ? `${a.start}/${a.duration}` : 'missing'})`);
  ok(b && b.start === 4 && b.duration === 2, `split right half {start 4, duration 2} (got ${b ? `${b.start}/${b.duration}` : 'missing'})`);
  ok(out.every((x) => finite(x.start) && finite(x.duration)), 'split sticker clips are all finite');
}

// 2. Magnet-ON left trim of a sticker by 1 s: start moves, end preserved, no NaN.
{
  const s = run(st(project()), [{ type: 'trimClip', track: 'sticker', id: 's1', edge: 'left', delta: 1 }]);
  const a = s.present.stickerClips.find((x) => x.id === 's1');
  const f = s.present.stickerClips.find((x) => x.id === 's2');
  ok(a && a.start === 3 && a.duration === 3, `left trim sticker -> {start 3, duration 3} (got ${a ? `${a.start}/${a.duration}` : 'missing'})`);
  ok(a && finite(a.start) && finite(a.duration) && !('in' in a && !finite(a.in)), 'left-trimmed sticker has no NaN fields');
  ok(f && f.start === 8, `follower stays glued at the preserved end (start 8, got ${f ? f.start : 'missing'})`);
}

// 3. Magnet-ON right trim of a sticker by 1 s: start unchanged, duration shrinks,
//    follower shifts earlier to stay glued.
{
  const s = run(st(project()), [{ type: 'trimClip', track: 'sticker', id: 's1', edge: 'right', delta: 1 }]);
  const a = s.present.stickerClips.find((x) => x.id === 's1');
  const f = s.present.stickerClips.find((x) => x.id === 's2');
  ok(a && a.start === 2 && a.duration === 3, `right trim sticker -> {start 2, duration 3} (got ${a ? `${a.start}/${a.duration}` : 'missing'})`);
  ok(f && f.start === 7, `follower shifts earlier after right trim (start 7, got ${f ? f.start : 'missing'})`);
}

// 4. The audit's probe case: text clip { start: 2, duration: 3 } left-trimmed by 1 s.
{
  const s = run(st(project()), [{ type: 'trimClip', track: 'text', id: 't1', edge: 'left', delta: 1 }]);
  const t = s.present.textClips.find((x) => x.id === 't1');
  ok(t && t.start === 3 && t.duration === 2, `left trim text -> {start 3, duration 2} (got ${t ? `${t.start}/${t.duration}` : 'missing'})`);
}

// 5. Silence-removal on a sticker removes the range and closes the clip.
{
  const s = run(st(project()), [{ type: 'cutFreeRanges', track: 'sticker', id: 's1', ranges: [{ start: 3, end: 4 }] }]);
  const out = s.present.stickerClips.filter((x) => x.id.startsWith('s1'));
  const total = out.reduce((n, x) => n + x.duration, 0);
  ok(out.length === 2, `free-cut sticker yields 2 pieces (got ${out.length})`);
  ok(Math.abs(total - 3) < 1e-9, `free-cut sticker total duration 3 (got ${total})`);
  ok(out.every((x) => finite(x.start) && finite(x.duration)), 'free-cut sticker pieces are all finite');
}

if (fails.length) { console.log(`sticker-edit FAIL (${fails.length} failing)`); process.exit(1); }
console.log('sticker-edit OK — sticker split / trim / free-cut behave like text');
