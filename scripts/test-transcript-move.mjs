// Transcript move/reorder (Sprint 10): the store's moveRanges action lifts
// timeline ranges and re-inserts them elsewhere — the picture reorders, the
// captions follow word-for-word, the total duration is unchanged and one
// undo restores the original order. (Deleting a sentence and watching the
// exported duration drop lives in test-transcript.mjs; this suite covers
// the move the Transcript card's "Move here" buttons dispatch.)
import { emptyProject, historyReducer, videoLayout, exportDuration } from '../src/store.js';
import { transcriptSentences } from '../src/transcript.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const run = (p, a) => historyReducer({ past: [], present: p, future: [] }, a);

function project() {
  const p = emptyProject();
  return {
    ...p,
    media: [{ id: 'm1', path: '/x/v.mp4', type: 'video', duration: 30, width: 320, height: 180, hasAudio: true }],
    videoClips: [{ id: 'v1', mediaId: 'm1', in: 0, out: 30, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null }],
    textClips: [
      // Word timings are RELATIVE to the clip start (the store's model —
      // transcriptSentences adds the start back for display and selection).
      { id: 'c1', text: 'hello brave world', start: 1, duration: 4, y: 0.85, caption: true,
        words: [
          { text: 'hello', start: 0, end: 1 }, { text: 'brave', start: 1, end: 2.5 }, { text: 'world', start: 2.5, end: 4 },
        ] },
      { id: 'c2', text: 'second sentence', start: 7, duration: 3, y: 0.85, caption: true,
        words: [
          { text: 'second', start: 0, end: 1.5 }, { text: 'sentence', start: 1.5, end: 3 },
        ] },
      { id: 'c3', text: 'a later cue', start: 20, duration: 3, y: 0.85, caption: true, words: null },
    ],
  };
}
const sentencesOf = (p) => transcriptSentences(p).map((s) => s.text);

// --- Move a whole sentence to the front -------------------------------------
{
  const st = run(project(), { type: 'moveRanges', ranges: [{ start: 7, end: 10 }], to: 0 });
  const q = st.present;
  const lay = videoLayout(q.videoClips);
  ok(lay.map((l) => l.clip.in).join(',') === '7,0,10', `picture reordered: moved piece first (got ins ${lay.map((l) => l.clip.in).join(',')})`);
  ok(near(exportDuration(q), 30), `total duration unchanged (got ${exportDuration(q)})`);
  ok(sentencesOf(q).join(' | ') === 'second sentence | hello brave world | a later cue',
    `captions follow the picture (got ${sentencesOf(q).join(' | ')})`);
  const moved = transcriptSentences(q)[0];
  ok(near(moved.start, 0) && moved.words.every((w) => w.start >= -1e-9 && w.end <= 3.001),
    'the moved sentence is re-based at 0 with its word timings inside it');
  ok(st.past.length === 1, 'one undo step');
  const undone = historyReducer(st, { type: 'undo' });
  ok(sentencesOf(undone.present).join(' | ') === 'hello brave world | second sentence | a later cue', 'undo restores the original order');
}

// --- Move part of a sentence (two words) to the end --------------------------
{
  const st = run(project(), { type: 'moveRanges', ranges: [{ start: 2, end: 5 }], to: 30 });
  const q = st.present;
  ok(near(exportDuration(q), 30), 'duration still 30 after a partial move');
  const lay = videoLayout(q.videoClips);
  ok(near(lay[lay.length - 1].clip.in, 2), 'the moved picture piece (source 2..5) plays last');
  const brave = q.textClips.find((c) => c.text === 'brave world');
  ok(brave && near(brave.start, 27), `the moved caption piece lands at the end (start ${brave?.start})`);
  ok(brave.words.length === 2 && brave.words.every((w) => w.start >= -1e-9 && w.end <= 3.001),
    'its words are re-based inside the moved window (relative to the piece)');
  const braveSentence = transcriptSentences(q).find((s) => s.text === 'brave world');
  ok(braveSentence && near(braveSentence.start, 27) && near(braveSentence.words[0].start, 27),
    'the transcript reads the moved words at their new absolute times');
  const hello = q.textClips.find((c) => c.text === 'hello');
  ok(hello && near(hello.start, 1) && near(hello.duration, 1), 'the survivor keeps "hello" where it was');
  ok(sentencesOf(q)[1] === 'second sentence' && near(transcriptSentences(q)[1].start, 4),
    'the untouched middle sentence shifts left by the lifted length');
}

// --- A move across a caption without word timings ---------------------------
{
  const st = run(project(), { type: 'moveRanges', ranges: [{ start: 1, end: 5 }], to: 15 });
  const q = st.present;
  const c3 = q.textClips.find((c) => c.id.startsWith('c3'));
  // The block leaves from before c3 and lands before c3: the two shifts
  // cancel, so the word-less caption keeps its place.
  ok(c3 && near(c3.start, 20), `the word-less caption keeps its place when the block crosses it (start ${c3?.start})`);
  ok(near(exportDuration(q), 30), 'duration unchanged when the block crosses it');
}

// --- Locked main track refuses ----------------------------------------------
{
  const locked = run(project(), { type: 'setLayerState', track: 'video', layer: 0, patch: { locked: true } }).present;
  const st = run(locked, { type: 'moveRanges', ranges: [{ start: 7, end: 10 }], to: 0 });
  ok(st.present === locked && st.past.length === 0, 'move on a locked main track is refused, no history step');
}

// --- No-op moves change nothing ----------------------------------------------
{
  const p = project();
  const st = run(p, { type: 'moveRanges', ranges: [{ start: 8, end: 8 }], to: 0 });
  ok(st.present.videoClips.length === 1 && near(exportDuration(st.present), 30)
    && sentencesOf(st.present).join(' | ') === sentencesOf(p).join(' | '),
  'an empty range set moves nothing');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nTRANSCRIPT MOVE OK');
process.exit(fails.length ? 1 : 0);
