// Mixed RTL/LTR text layout (P2-38, UX-06): bidi run ordering and weak-item
// attachment. The visual-order cases are the ones the old whole-line
// reversal got wrong. Layout-level behaviour (long-word breaking,
// letter-spacing suppression, canvas direction) is verified live in the
// dev app, where a real canvas exists — see the P2-38 live notes.
// Usage: node scripts/test-bidi.mjs
import { bidiVisualOrder, wordDir, splitTrailingPunct } from '../src/text/bidi.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const visual = (text, rtl) => bidiVisualOrder(text.split(/\s+/).filter(Boolean).map((t, i) => ({ text: t, w: 10, i })), rtl).map((w) => w.text).join(' ');

// --- word direction ---
ok(wordDir('شاهد') === 'rtl', 'Arabic word is rtl');
ok(wordDir('Cutflow') === 'ltr', 'Latin word is ltr');
ok(wordDir('12') === 'num', 'digits are weak (num)');
ok(wordDir('!') === 'punct', 'punctuation-only word is weak (punct)');
ok(wordDir('الجزء2') === 'rtl', 'Arabic word with a digit is rtl (first strong char wins)');
ok(wordDir('Cutflow2') === 'ltr', 'Latin word with a digit is ltr');

// --- visual order ---
ok(visual('شاهد Cutflow Pro الآن', true) === 'الآن Cutflow Pro شاهد',
  'RTL line: Latin run keeps internal order (was "Pro Cutflow" under whole-line reversal)');
ok(visual('مرحبا بالعالم', true) === 'بالعالم مرحبا', 'pure RTL line still reverses');
ok(visual('Hello Cutflow world', false) === 'Hello Cutflow world', 'pure LTR line unchanged');
ok(visual('الحلقة 12 من Cutflow', true) === 'Cutflow من 12 الحلقة',
  'RTL line: number stays attached to the Arabic word before it');
ok(visual('اشتر Cutflow الآن !', true) === '! الآن Cutflow اشتر',
  'RTL line: trailing punctuation travels with the line end, not the Latin word');
ok(visual('Cutflow هو الأفضل', true) === 'الأفضل هو Cutflow',
  'RTL line: single Latin word lands in the middle, in place');
ok(visual('Watch Cutflow الآن', false) === 'Watch Cutflow الآن',
  'LTR paragraph with an Arabic run keeps logical run order');
ok(visual('سعر Cutflow Pro هو 99 درهم', true) === 'درهم 99 هو Cutflow Pro سعر',
  'RTL line: Latin run + number run each keep their own order');

// --- trailing punctuation (B-UX9): the split layout() applies ---
ok(JSON.stringify(splitTrailingPunct('2026!')) === JSON.stringify({ core: '2026', punct: '!' }), 'split: digits + ! separates');
ok(JSON.stringify(splitTrailingPunct('حالك؟')) === JSON.stringify({ core: 'حالك', punct: '؟' }), 'split: Arabic word + ؟ separates');
ok(JSON.stringify(splitTrailingPunct('Cutflow!')) === JSON.stringify({ core: 'Cutflow', punct: '!' }), 'split: Latin word + ! separates');
ok(splitTrailingPunct('12.5') === null, 'split: a decimal keeps its point');
ok(splitTrailingPunct('!') === null, 'split: a lone punctuation word is already its own item');
ok(splitTrailingPunct('مَرْحَبًا') === null, 'split: a trailing diacritic is not punctuation');
ok(splitTrailingPunct('مرحبا') === null, 'split: no trailing punctuation, nothing to split');

// Visual order with the split applied (the words layout() hands over:
// the trailing punctuation is its own item, last in the line).
ok(visual('مرحبا Cutflow 2026 !', true) === '! Cutflow 2026 مرحبا',
  'B-UX9: trailing ! after a number travels to the line end, not glued to the number');
ok(visual('شاهد Cutflow !', true) === '! Cutflow شاهد',
  'B-UX9: trailing ! after a Latin word travels to the line end');
ok(visual('مرحبا بالعالم !', true) === '! بالعالم مرحبا',
  'B-UX9: trailing ! after pure Arabic travels to the line end');
ok(visual('مرحبا ! كيف حالك ؟', true) === '؟ حالك كيف ! مرحبا',
  'B-UX9: mid-line ! stays with its word; only the line-end ؟ travels');
ok(visual('اشتر Cutflow الآن !', true) === '! الآن Cutflow اشتر',
  'RTL line: trailing punctuation travels with the line end, not the Latin word');

if (failures) { console.log(`test-bidi: FAIL (${failures} failures)`); process.exit(1); }
console.log('test-bidi: PASS');
