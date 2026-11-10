// Batch caption find & replace (10/10 step 5, Filmora row 13's second half):
// a literal replace across a caption set (imported .srt / auto captions /
// translations) as one undo step — plain title text is never touched,
// timings and styles stay put, and a no-match replace changes nothing.
// Usage: node scripts/test-caption-replace.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { historyReducer, normalizeProject } from '../src/store.js';

const base = normalizeProject({});
const present = {
  ...base,
  textClips: [
    { id: 's1', source: 'srt', text: 'Hello Hamza, hello world', start: 0, duration: 2 },
    { id: 's2', source: 'srt', text: 'nothing here', start: 2, duration: 2 },
    { id: 'a1', caption: true, text: 'Hamza speaks', start: 4, duration: 2 },
    { id: 't1', source: 'translation', text: 'Hamza parle', start: 6, duration: 2 },
    { id: 'x1', text: 'Hamza title card', start: 8, duration: 2 },
  ],
};
const run = (st, action) => historyReducer(st, action);
// The hand-built clips have no layer assignment yet, so the first dispatch
// is the history wrapper's own normalisation pass — warm the fixture with
// it (exactly what loading a project does) before measuring no-ops.
const start = () => run({ past: [], present, future: [] }, { type: 'replaceCaptionText', find: 'ZZZ-NOT-PRESENT', replace: '', scope: 'all' });
const texts = (st) => Object.fromEntries(st.present.textClips.map((c) => [c.id, c.text]));

// Scope 'all': every caption kind changes; the plain title clip never does.
const s0 = start();
let st = run(s0, { type: 'replaceCaptionText', find: 'Hamza', replace: 'Mohamed', scope: 'all' });
assert.deepEqual(texts(st), {
  s1: 'Hello Mohamed, hello world', s2: 'nothing here', a1: 'Mohamed speaks', t1: 'Mohamed parle', x1: 'Hamza title card',
}, 'scope all rewrites srt + auto + translation captions and leaves titles alone');
assert.equal(st.past.length, s0.past.length + 1, 'the batch replace is one undo step');
assert.equal(st.present.textClips.find((c) => c.id === 's1').start, 0, 'timings are untouched');
assert.equal(st.present.textClips.find((c) => c.id === 's1').duration, 2, 'durations are untouched');

// Every occurrence inside one clip is replaced.
st = run(start(), { type: 'replaceCaptionText', find: 'hello', replace: 'hi', scope: 'srt' });
assert.equal(texts(st).s1, 'Hello Hamza, hi world', 'all occurrences in a clip are replaced (case-sensitive: Hello stays)');
assert.equal(texts(st).a1, 'Hamza speaks', 'scope srt leaves auto captions alone');

// Scope 'captions' hits only generated captions; 'translation' only translations.
st = run(start(), { type: 'replaceCaptionText', find: 'Hamza', replace: 'H.', scope: 'captions' });
assert.deepEqual([texts(st).a1, texts(st).s1, texts(st).t1], ['H. speaks', 'Hello Hamza, hello world', 'Hamza parle'], 'scope captions is exact');
st = run(start(), { type: 'replaceCaptionText', find: 'Hamza', replace: 'H.', scope: 'translation' });
assert.equal(texts(st).t1, 'H. parle', 'scope translation is exact');

// No-ops return the identical project (no phantom undo steps).
for (const action of [
  { type: 'replaceCaptionText', find: 'absent', replace: 'x', scope: 'all' },
  { type: 'replaceCaptionText', find: '', replace: 'x', scope: 'all' },
  { type: 'replaceCaptionText', find: 'Hamza', replace: 'Hamza', scope: 'all' },
]) {
  const warmed = start();
  const after = run(warmed, action);
  assert.equal(after.present, warmed.present, `no-op replace (${JSON.stringify(action.find)} -> ${JSON.stringify(action.replace)}) changes nothing`);
  assert.equal(after.past.length, warmed.past.length, 'no-op replace adds no undo step');
}

// Empty replacement deletes the word (a real editing use).
st = run(start(), { type: 'replaceCaptionText', find: 'Hamza, ', replace: '', scope: 'srt' });
assert.equal(texts(st).s1, 'Hello hello world', 'an empty replacement removes the text');

// Wiring: the Captions tab carries the card and dispatches the action.
const panel = fs.readFileSync(path.join(import.meta.dirname, '..', 'src/components/LeftPanel.jsx'), 'utf8');
assert.ok(panel.includes('FindReplaceCard') && panel.includes("type: 'replaceCaptionText'"), 'Captions tab wires the find & replace card');
console.log('caption-replace ok: scoped batch replace across caption kinds, titles untouched, one undo step, no-ops free');
