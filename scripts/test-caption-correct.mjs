// Gap-build Stream E — AI-04 Arabic/Darija caption correction + WER/CER.
// Run: node scripts/test-caption-correct.mjs
import assert from 'node:assert/strict';
import { correctCaptionText, correctClip, wer, cer, scoreSample, normalizeForEval } from '../src/captionCorrect.js';

// Diacritics + tatweel stripped; Darija kept as spoken.
let r = correctCaptionText('هَادا هُوَ الدَّار دِيَالِي');
assert.equal(r.text, 'هادا هو الدار ديالي', 'diacritics stripped, Darija words untouched');
assert.ok(r.changes.some((c) => c.rule === 'diacritics'), 'the change is reported as diacritics');

// Classic misspellings.
assert.equal(correctCaptionText('انشاء الله غادي نمشيو').text, 'إن شاء الله غادي نمشيو', 'انشاء الله -> إن شاء الله, غادي kept');
assert.equal(correctCaptionText('مشاء الله عليك').text, 'ما شاء الله عليك', 'مشاء الله -> ما شاء الله');

// Punctuation spacing.
assert.equal(correctCaptionText('سلام ، كيف حالك ؟').text, 'سلام، كيف حالك؟', 'no space before punctuation');
assert.equal(correctCaptionText('قال:مرحبا.كيفك').text, 'قال: مرحبا. كيفك', 'space after punctuation');
assert.equal(correctCaptionText('واو!!! بزاف').text, 'واو!! بزاف', 'triple punctuation collapses to double');

// Doubled words.
assert.equal(correctCaptionText('قال قال ليا').text, 'قال ليا', 'doubled word removed');
assert.equal(correctCaptionText('هادا هادا هو').text, 'هادا هو', 'doubled Darija word removed');

// Detached prefixes attach.
assert.equal(correctCaptionText('و قال ليا ف الدار').text, 'وقال ليا فالدار', 'و and ف attach');
assert.equal(correctCaptionText('مشيت ل الدار').text, 'مشيت للدار', 'ل + ال assimilates to لل');

// What it must NOT do: guess at ambiguous words, or "fix" Darija to Fusha.
assert.equal(correctCaptionText('علي قال ليا').text, 'علي قال ليا', 'علي (the name) is not rewritten as على');
assert.equal(correctCaptionText('هادي هي الحياة').text, 'هادي هي الحياة', 'Darija هادي and MSA الحياة both stand');
assert.equal(correctCaptionText('باش نمشي دابا').text, 'باش نمشي دابا', 'Darija باش / دابا untouched');
assert.equal(correctCaptionText('').text, '', 'empty in, empty out');
assert.deepEqual(correctCaptionText('سلام').changes, [], 'clean text reports no changes');

// correctClip keeps word timings when the word count is unchanged.
{
  const clip = { id: 'c1', text: 'سلام ، كيف حالك ؟', duration: 3, words: [
    { text: 'سلام', start: 0, end: 0.8 }, { text: '،', start: 0.8, end: 0.9 },
    { text: 'كيف', start: 0.9, end: 1.6 }, { text: 'حالك', start: 1.6, end: 2.4 }, { text: '؟', start: 2.4, end: 2.5 },
  ] };
  const { patch, changes } = correctClip(clip);
  assert.equal(patch.text, 'سلام، كيف حالك؟', 'clip text corrected');
  // Punctuation attaches to its word, so 5 tokens become 3 and the timings
  // are shared out by word length over the clip span.
  assert.equal(patch.words.length, 3, 'word count follows the corrected text');
  assert.equal(patch.words[0].start, 0, 'first word starts at the clip start');
  assert.ok(Math.abs(patch.words[2].end - 3) < 0.001, 'last word ends at the clip end');
  assert.deepEqual(patch.words.map((w) => w.text), ['سلام،', 'كيف', 'حالك؟'], 'corrected word texts');
  assert.ok(changes.length > 0, 'changes reported');
  assert.equal(correctClip({ id: 'c2', text: 'سلام', duration: 1, words: [{ text: 'سلام', start: 0, end: 1 }] }).patch, null, 'a clean clip needs no patch');
}

// WER / CER.
assert.equal(wer('hello world', 'hello world'), 0, 'identical: WER 0');
assert.equal(wer('hello world', 'hello'), 0.5, 'one word missing of two: WER 0.5');
assert.equal(wer('hello world', 'hello there world'), 0.5, 'one insertion over a 2-word reference: WER 0.5');
assert.equal(cer('abc', 'abc'), 0, 'identical: CER 0');
assert.equal(cer('abc', 'abd'), 1 / 3, 'one char wrong of three: CER 1/3');
assert.equal(wer('السلام عليكم', 'السلام عليكم'), 0, 'Arabic identical: WER 0');
assert.equal(normalizeForEval('أحمد في المدرسة'), normalizeForEval('احمد في المدرسه'), 'eval normalisation treats alef/teh-marbuta variants as equal');
assert.equal(wer('أحمد في المدرسة', 'احمد في المدرسه'), 0, 'normalised WER ignores spelling variants');

// A full sample: correction must not make the score worse.
{
  const s = scoreSample({ reference: 'إن شاء الله غادي نمشيو للدار', hypothesis: 'انشاء الله غادي نمشيو ل الدار' });
  assert.ok(s.werAfter < s.werBefore, `correction improves WER (${s.werBefore} -> ${s.werAfter})`);
  assert.equal(s.corrected, 'إن شاء الله غادي نمشيو للدار', 'the corrected hypothesis matches the reference');
}

console.log('test-caption-correct: PASS');
