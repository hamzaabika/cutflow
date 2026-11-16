// FB-25 (P1-34) — caption proofreading: word re-alignment keeps the
// timings of unchanged words after a text edit, punctuation/name flags
// fire on the right cases, WER/CER measure what they claim, and the
// proofreadCaptions store action applies a dialog's edits in one undo
// step (caption clips only, frame-quantised like `update`).
// Usage: node scripts/test-proofread.mjs
import assert from 'node:assert/strict';
import { captionRows, realignWords, punctuationFlag, nameFlags, normalizeDarija, wer, cer } from '../src/proofread.js';
import { emptyProject, historyReducer } from '../src/store.js';

let n = 0;
const check = (name, fn) => { fn(); n += 1; console.log(`ok ${n} - ${name}`); };
const run = (p, a) => historyReducer({ past: [], present: p, future: [] }, a).present;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// --- word re-alignment ---
check('one-word fix keeps the other words timings', () => {
  const oldWords = [
    { text: 'هاد', start: 0.0, end: 0.3 },
    { text: 'الفيديو', start: 0.3, end: 0.8 },
    { text: 'موجه', start: 0.8, end: 1.2 },
  ];
  const out = realignWords(oldWords, 'هاد الفيديو موجه', 'هاد الفيديو موجه ليك');
  assert.equal(out.length, 4);
  assert.ok(approx(out[0].start, 0.0) && approx(out[0].end, 0.3));
  assert.ok(approx(out[1].start, 0.3) && approx(out[1].end, 0.8));
  assert.ok(approx(out[2].start, 0.8) && approx(out[2].end, 1.2));
  assert.equal(out[3].text, 'ليك');
  assert.ok(out[3].start >= 1.2 && out[3].end > out[3].start);
});
check('a corrected word is interpolated between its neighbours', () => {
  const oldWords = [
    { text: 'كاتفلو', start: 0.0, end: 0.5 },
    { text: 'هو', start: 0.5, end: 0.7 },
    { text: 'تطبيق', start: 0.7, end: 1.2 },
  ];
  const out = realignWords(oldWords, 'كاتفلو هو تطبيق', 'Cutflow هو تطبيق');
  assert.equal(out[0].text, 'Cutflow');
  assert.ok(out[0].start >= 0 && out[0].end <= 0.5);
  assert.ok(approx(out[1].start, 0.5) && approx(out[2].end, 1.2));
});
check('unchanged text returns identical timings', () => {
  const oldWords = [{ text: 'سلام', start: 0.1, end: 0.6 }];
  const out = realignWords(oldWords, 'سلام', 'سلام');
  assert.deepEqual(out, oldWords);
});
check('no word timings means no realignment', () => {
  assert.deepEqual(realignWords([], 'سلام', 'سلام عليكم'), []);
});

// --- flags ---
check('missing sentence-final punctuation is flagged', () => {
  assert.equal(punctuationFlag('هاد الفيديو موجه ليك'), 'missingEnd');
  assert.equal(punctuationFlag('هاد الفيديو موجه ليك.'), null);
  assert.equal(punctuationFlag('واش عمرك فكرتي؟'), null);
  assert.equal(punctuationFlag(''), null);
});
check('a near-miss proper noun is flagged with the right suggestion', () => {
  const flags = nameFlags('تحديت راسي نصاوب تطبيق بحال Katflow');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].suggest, 'Cutflow');
});
check('an exact proper noun is not flagged', () => {
  assert.deepEqual(nameFlags('تحديت راسي نصاوب Cutflow'), []);
});
check('an unrelated word is not flagged', () => {
  assert.deepEqual(nameFlags('هاد الفيديو موجه ليك بالخصوص'), []);
});

// --- metrics ---
check('identical texts score WER 0 and CER 0', () => {
  assert.equal(wer('هاد الفيديو موجه ليك', 'هاد الفيديو موجه ليك').wer, 0);
  assert.equal(cer('هاد الفيديو موجه ليك', 'هاد الفيديو موجه ليك').cer, 0);
});
check('one substituted word in four scores WER 0.25', () => {
  const r = wer('هاد الفيديو موجه ليك', 'هاد الفيديو موجه ليكم');
  assert.equal(r.wer, 0.25);
  assert.equal(r.subs, 1);
  assert.equal(r.refWords, 4);
});
check('a dropped word counts as a deletion', () => {
  const r = wer('هاد الفيديو موجه ليك', 'هاد الفيديو ليك');
  assert.equal(r.dels, 1);
  assert.equal(r.wer, 0.25);
});
check('empty hypothesis scores WER 1', () => {
  assert.equal(wer('هاد الفيديو', '').wer, 1);
});
check('normalisation folds alef variants and strips punctuation', () => {
  assert.equal(normalizeDarija('إلى أين؟'), normalizeDarija('الي اين'));
  assert.equal(normalizeDarija('مئة!'), normalizeDarija('مئه'));
});
check('CER counts character edits over the normalised string', () => {
  const r = cer('سلام', 'سلا');
  assert.ok(r.cer > 0 && r.cer < 1);
  assert.equal(r.refChars, 4);
});

// --- store action ---
check('proofreadCaptions applies text + speaker + timing in one step, captions only', () => {
  const p = {
    ...emptyProject(),
    textClips: [
      { id: 'c1', caption: true, text: 'كاتفلو هو تطبيق', start: 0, duration: 2, words: [{ text: 'كاتفلو', start: 0, end: 0.5 }], speaker: '' },
      { id: 'c2', caption: true, text: 'سلام', start: 2, duration: 1, words: [], speaker: '' },
      { id: 't1', caption: false, text: 'TITLE', start: 0, duration: 3, words: [] },
    ],
  };
  const q = run(p, {
    type: 'proofreadCaptions',
    patches: [{ id: 'c1', patch: { text: 'Cutflow هو تطبيق', speaker: 'Hamza', start: 0.1, duration: 2, words: [{ text: 'Cutflow', start: 0, end: 0.5 }] } }],
  });
  const c1 = q.textClips.find((c) => c.id === 'c1');
  assert.equal(c1.text, 'Cutflow هو تطبيق');
  assert.equal(c1.speaker, 'Hamza');
  assert.equal(c1.words[0].text, 'Cutflow');
  // Untouched captions and non-caption text clips are byte-identical.
  assert.equal(q.textClips.find((c) => c.id === 'c2').text, 'سلام');
  assert.equal(q.textClips.find((c) => c.id === 't1').text, 'TITLE');
});
check('captionRows returns caption clips in timeline order with speakers', () => {
  const p = {
    ...emptyProject(),
    textClips: [
      { id: 'c2', caption: true, text: 'ثاني', start: 2, duration: 1, speaker: 'Yassine', words: [] },
      { id: 'c1', caption: true, text: 'أول', start: 0, duration: 1, speaker: 'Hamza', words: [] },
      { id: 't1', caption: false, text: 'TITLE', start: 0, duration: 1, words: [] },
    ],
  };
  const rows = captionRows(p);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'c1');
  assert.equal(rows[0].speaker, 'Hamza');
  assert.equal(rows[1].speaker, 'Yassine');
});

console.log(`PROOFREAD OK (${n} checks)`);
