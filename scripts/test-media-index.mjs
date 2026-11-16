// Semantic footage search / AI tagging (P2-41, AI-05): offline index —
// tokenisation + Arabic normalisation, auto-tagging, ranked retrieval
// precision and latency. Retrieval precision is measured on a synthetic
// 200-item library with known relevant sets; latency is the wall time of
// one query over that library.
// Usage: node scripts/test-media-index.mjs
import { normalizeArabic, tokenize, autoTags, buildMediaIndex, searchMediaIndex, loadMediaIndexPrefs, saveMediaIndexPrefs, deleteMediaIndex, MEDIA_INDEX_KEY } from '../src/mediaIndex.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// --- normalisation ---
ok(normalizeArabic('مقابلة') === normalizeArabic('مقابله'), 'teh marbuta / heh normalise together');
ok(normalizeArabic('أحمد إسلام آدم') === 'احمد اسلام ادم', 'alef forms normalise');
ok(normalizeArabic('السَّلَامُ') === 'السلام', 'diacritics strip');
ok(tokenize('Hello, Cutflow Pro 2026!').join('|') === 'hello|cutflow|pro|2026', 'tokenize splits on punctuation, lowercases');

// --- auto-tagging (bilingual, word-boundary safe) ---
ok(autoTags({ name: 'beach drone sunset.mp4' }).includes('beach') && autoTags({ name: 'beach drone sunset.mp4' }).includes('drone'), 'English keywords tag');
ok(autoTags({ name: 'مقابلة مع خالد.mp4' }).includes('interview'), 'Arabic keyword tags (مقابلة)');
ok(autoTags({ name: 'مقابله مع خالد.mp4' }).includes('interview'), 'Arabic keyword tags with ه spelling too');
ok(autoTags({ name: 'card trick.mp4' }).includes('car') === false, 'car does not fire on "card"');
ok(autoTags({ name: 'cooking show.mp4' }, 'today we cook a tagine in the kitchen').includes('cooking'), 'transcript words tag too');
ok(autoTags({ name: 'random clip.mp4' }).length === 0, 'unrelated media gets no tags');

// --- retrieval precision on a synthetic 200-item library ---
const items = [];
const beachIds = [], interviewIds = [], mixedIds = [];
for (let i = 0; i < 200; i++) {
  let name, transcript = '';
  if (i < 12) { name = `beach day ${i}.mp4`; transcript = 'waves on the shore'; beachIds.push(`m${i}`); }
  else if (i < 24) { name = `مقابلة ${i}.mp4`; transcript = 'حوار مع الضيف'; interviewIds.push(`m${i}`); }
  else if (i < 30) { name = `beach interview ${i}.mp4`; transcript = 'talking on the beach'; beachIds.push(`m${i}`); interviewIds.push(`m${i}`); mixedIds.push(`m${i}`); }
  else if (i < 40) { name = `city night ${i}.mp4`; transcript = 'streets at night'; }
  else { name = `clip ${i}.mp4`; transcript = 'random footage here'; }
  items.push({ id: `m${i}`, name, type: 'video', tags: autoTags({ name }, transcript), transcript });
}
const index = buildMediaIndex(items);
ok(index.size === 200, 'index holds all 200 items');
const precisionAt = (results, relevant, k) => {
  const top = results.slice(0, k).map((r) => r.id);
  const hits = top.filter((id) => relevant.includes(id)).length;
  return hits / Math.min(k, top.length || 1);
};
let r = searchMediaIndex(index, 'beach');
ok(r.length === 18, `beach query returns all 18 beach items (got ${r.length})`);
ok(precisionAt(r, beachIds, 5) === 1, 'beach precision@5 = 1.0');
ok(r[0].score >= r[r.length - 1].score, 'results rank by score descending');
r = searchMediaIndex(index, 'شاطئ');
ok(r.length === 18 && precisionAt(r, beachIds, 5) === 1, 'Arabic query شاطئ finds the same beach items (tag match)');
r = searchMediaIndex(index, 'مقابله');
ok(r.length === 18 && precisionAt(r, interviewIds, 5) === 1, 'Arabic query مقابله (ه spelling) finds مقابلة items');
r = searchMediaIndex(index, 'beach interview');
ok(r.length === 6 && r.every((x) => mixedIds.includes(x.id)), 'multi-word query is AND across terms (only the 6 mixed items)');
ok(searchMediaIndex(index, 'beach nonexistentword').length === 0, 'a term no document has kills the query');
ok(searchMediaIndex(index, 'shore').length === 12 && searchMediaIndex(index, 'shore')[0].viaTranscript, 'transcript-only hits are flagged viaTranscript');
ok(searchMediaIndex(index, '').length === 0, 'empty query returns nothing (panel keeps registry order)');

// --- latency ---
const t0 = performance.now();
for (let i = 0; i < 100; i++) searchMediaIndex(index, 'beach interview');
const ms = (performance.now() - t0) / 100;
ok(ms < 5, `one ranked query over 200 items takes ${ms.toFixed(3)} ms (< 5 ms)`);
console.log(`  latency: ${ms.toFixed(3)} ms/query over 200 items; beach P@5=1.0, interview P@5=1.0, mixed AND exact`);

// --- index prefs: enable/disable/delete ---
const mem = new Map();
const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
ok(loadMediaIndexPrefs(store).enabled === true, 'index enabled by default');
saveMediaIndexPrefs(store, { enabled: false, tagCache: { m1: ['beach'] } });
ok(loadMediaIndexPrefs(store).enabled === false, 'index can be disabled');
ok(loadMediaIndexPrefs(store).tagCache.m1[0] === 'beach', 'tag cache persists');
const after = deleteMediaIndex(store);
ok(after.enabled === true && !store.getItem(MEDIA_INDEX_KEY), 'delete wipes the persisted index and re-enables the default');
ok(loadMediaIndexPrefs({ getItem: () => '{broken' }).enabled === true, 'corrupt prefs fall back to enabled');

if (failures) { console.log(`test-media-index: FAIL (${failures} failures)`); process.exit(1); }
console.log('test-media-index: PASS');
