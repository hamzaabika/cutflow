// slideVideo: a main-track clip slides in time (the 2026-11-16 drag fix).
// A lone clip could not be moved on the timeline at all — reorder has nothing
// to reorder past — so the drag was a visible no-op. Usage:
//   node scripts/test-slide-video.mjs
import assert from 'node:assert/strict';
import { historyReducer, normalizeProject, videoLayout } from '../src/store.js';

const run = (st, ...actions) => actions.reduce(historyReducer, st);
const mk = (id, mediaId, len) => ({ id, mediaId, in: 0, out: len, speed: 1, volume: 1, muted: false, transition: null });
const gap = (id, len) => ({ id, gap: true, in: 0, out: len, speed: 1 });
const fresh = (clips) => ({
  past: [],
  present: {
    ...normalizeProject({}),
    media: [{ id: 'v', type: 'video', duration: 10, hasAudio: true }],
    videoClips: clips,
  },
  future: [],
});
const main = (p) => videoLayout(p.videoClips).map((l) => `${l.clip.gap ? 'GAP' : l.clip.id}@${l.start}`).join(' ');

// 1. A lone clip slides right into empty space: a gap opens before it.
let st = run(fresh([mk('a', 'v', 2)]), { type: 'slideVideo', id: 'a', at: 3 });
assert.equal(main(st.present), 'GAP@0 a@3');
assert.equal(st.present.videoClips[0].gap, true);
assert.equal(st.present.videoClips[0].out - st.present.videoClips[0].in, 3);

// 2. ... and slides back to the start: the gap closes up again.
st = run(st, { type: 'slideVideo', id: 'a', at: 0 });
assert.equal(main(st.present), 'a@0');
assert.equal(st.present.videoClips.length, 1);

// 3. Dropping a clip over another keeps the reorder behaviour (nearest boundary).
st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 3)]), { type: 'slideVideo', id: 'b', at: 0.5 });
assert.equal(main(st.present), 'b@0 a@3');
st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 3)]), { type: 'slideVideo', id: 'b', at: 1.5 });
assert.equal(main(st.present), 'a@0 b@2');

// 4. Dropping past the end opens a gap after the last clip.
st = run(fresh([mk('a', 'v', 2), mk('b', 'v', 3)]), { type: 'slideVideo', id: 'a', at: 6 });
assert.equal(main(st.present), 'b@0 GAP@3 a@6');

// 5. Dropping inside an existing gap lands exactly there (gap splits around it).
st = run(fresh([mk('a', 'v', 2), gap('g', 2), mk('b', 'v', 3)]), { type: 'slideVideo', id: 'b', at: 3 });
assert.equal(main(st.present), 'a@0 GAP@2 b@3');

// 6. A slide to the clip's current start is a no-op (same project object).
st = fresh([mk('a', 'v', 2)]);
const slid = run(st, { type: 'slideVideo', id: 'a', at: 0 });
assert.equal(slid.present, st.present);

// 7. Unknown id / gap id: no change.
st = fresh([mk('a', 'v', 2)]);
assert.equal(run(st, { type: 'slideVideo', id: 'zzz', at: 5 }).present, st.present);
st = fresh([mk('a', 'v', 2), gap('g', 2)]);
assert.equal(run(st, { type: 'slideVideo', id: 'g', at: 0 }).present, st.present);

// 8. Negative target clamps to zero.
st = run(fresh([mk('a', 'v', 2)]), { type: 'slideVideo', id: 'a', at: -4 });
assert.equal(main(st.present), 'a@0');

// 9. The whole slide is one undo step (begin/endGesture folding).
st = run(fresh([mk('a', 'v', 2)]), { type: 'beginGesture' },
  { type: 'slideVideo', id: 'a', at: 1 }, { type: 'slideVideo', id: 'a', at: 2 }, { type: 'slideVideo', id: 'a', at: 3 },
  { type: 'endGesture' });
assert.equal(main(st.present), 'GAP@0 a@3');
assert.equal(st.past.length, 1);
st = run(st, { type: 'undo' });
assert.equal(main(st.present), 'a@0');

console.log('test-slide-video: PASS (9 checks)');
