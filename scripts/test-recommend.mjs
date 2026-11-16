// Intelligent asset recommendation (P3-10): suggestions come only from the
// local P2-41 index over the project's own media — no network, no model —
// ranked by the project's own signals (transcript words, timeline clip
// names, timeline media tags), with a reason per suggestion, timeline and
// dismissed assets excluded, and an empty result when there is no signal.
// Usage: node scripts/test-recommend.mjs
import assert from 'assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';

register('./css-stub-loader.mjs', import.meta.url);

const { buildMediaIndex, autoTags } = await import('../src/mediaIndex.js');
const {
  collectProjectSignals, recommendAssets,
  loadRecommendPrefs, saveRecommendPrefs, dismissRecommendation,
  clearRecommendDismissals, deleteRecommendPrefs, RECOMMEND_KEY,
} = await import('../src/recommend.js');

const ok = (c, m) => assert.ok(c, m);

// --- no network, by construction ---------------------------------------------
{
  const src = fs.readFileSync(new URL('../src/recommend.js', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, ''); // comments may name the things the code must not use
  for (const banned of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'http://', 'https://']) {
    ok(!src.includes(banned), `recommend.js contains no ${banned}`);
  }
}

// --- fixture: a cooking project with a beach clip on the timeline ------------
const items = [
  { id: 'm-beach', name: 'beach-sunset.mp4', type: 'video', tags: ['beach'] },
  { id: 'm-drone', name: 'drone-reel.mp4', type: 'video', tags: ['drone'] },
  { id: 'm-wed', name: 'highlights-reel.mp4', type: 'video', tags: ['wedding'] },
  { id: 'm-pasta', name: 'pasta-recipe.mp4', type: 'video', tags: [] },
  { id: 'm-beach2', name: 'beach-drone.mp4', type: 'video', tags: [] },
  { id: 'm-wed2', name: 'wedding-dance.mp4', type: 'video', tags: [] },
  { id: 'm-city', name: 'city-night.mp4', type: 'video', tags: [] },
  { id: 'm-cook-audio', name: 'cooking-music.mp3', type: 'audio', tags: [] },
];
const mediaById = new Map(items.map((m) => [m.id, m]));
const transcripts = new Map([['m-beach', 'cooking pasta at the beach house']]);
const project = {
  textClips: [{ text: 'today we are cooking pasta at the beach house', caption: true }],
  videoClips: [
    { mediaId: 'm-beach' },
    { mediaId: 'm-drone' },
    { mediaId: 'm-wed' },
  ],
  audioClips: [], overlayClips: [],
};
const index = buildMediaIndex(items.map((m) => ({
  id: m.id, name: m.name, type: m.type,
  tags: autoTags(m, transcripts.get(m.id) || ''),
  transcript: transcripts.get(m.id) || '',
})));
const signals = collectProjectSignals(project, mediaById, transcripts);

const recs = recommendAssets({ index, items, signals });
const ids = recs.map((r) => r.id);
ok(ids.includes('m-pasta'), 'pasta clip recommended (transcript mentions pasta/cooking)');
ok(ids.includes('m-beach2'), 'second beach clip recommended (transcript mentions beach)');
ok(ids.includes('m-wed2'), 'second wedding clip recommended (timeline media is tagged wedding)');
ok(ids.includes('m-cook-audio'), 'cooking audio recommended (transcript mentions cooking)');
ok(!ids.includes('m-city'), 'unrelated city clip is NOT recommended');
ok(!ids.includes('m-beach'), 'a clip already on the timeline is NOT recommended');
ok(!ids.includes('m-drone'), 'a clip already on the timeline is NOT recommended');
ok(!ids.includes('m-wed'), 'a clip already on the timeline is NOT recommended');

// --- reasons explain the suggestion, from the project's own content ---------
{
  const pasta = recs.find((r) => r.id === 'm-pasta');
  ok(pasta.reasons.some((r) => r.kind === 'transcript' && (r.term === 'pasta' || r.term === 'cooking')),
    `pasta reason is the transcript (${JSON.stringify(pasta.reasons)})`);
  const wed2 = recs.find((r) => r.id === 'm-wed2');
  ok(wed2.reasons.some((r) => r.kind === 'tag' && r.term === 'wedding'),
    `wedding reason is the tag (${JSON.stringify(wed2.reasons)})`);
  const beach2 = recs.find((r) => r.id === 'm-beach2');
  ok(beach2.reasons.some((r) => r.kind === 'transcript' && r.term === 'beach'),
    `beach reason is the transcript (${JSON.stringify(beach2.reasons)})`);
  ok(recs.every((r) => r.reasons.length >= 1 && r.reasons.length <= 2), 'every suggestion carries 1-2 reasons');
  ok(recs.every((r) => r.score > 0), 'every suggestion has a positive score');
}

// --- a clip-name signal (not in the transcript) names the timeline clip -----
{
  const signals2 = collectProjectSignals(
    { textClips: [], videoClips: [{ mediaId: 'm-drone' }], audioClips: [], overlayClips: [] },
    mediaById, new Map(),
  );
  const recs2 = recommendAssets({ index, items, signals: signals2 });
  const beach2 = recs2.find((r) => r.id === 'm-beach2');
  ok(beach2 && beach2.reasons.some((r) => r.kind === 'clip' && r.term === 'drone' && r.clip === 'drone-reel.mp4'),
    `drone reason names the timeline clip (${JSON.stringify(beach2?.reasons)})`);
}

// --- dismissal, limits, and empty states ------------------------------------
{
  const dismissed = recommendAssets({ index, items, signals, dismissed: ['m-pasta'] });
  ok(!dismissed.some((r) => r.id === 'm-pasta'), 'a dismissed asset is not suggested again');
  const limited = recommendAssets({ index, items, signals, limit: 2 });
  assert.equal(limited.length, 2, 'limit is honoured');
  assert.deepEqual(recommendAssets({ index: null, items, signals }), [], 'no index means no suggestions');
  assert.deepEqual(recommendAssets({ index, items, signals: collectProjectSignals({ textClips: [], videoClips: [], audioClips: [], overlayClips: [] }, mediaById, new Map()) }), [], 'no signal means no suggestions');
  assert.deepEqual(recommendAssets({ index, items: [], signals }), [], 'an empty library means no suggestions');
}

// --- prefs: on by default, dismissals persist locally, wipe restores --------
{
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  assert.deepEqual(loadRecommendPrefs(storage), { enabled: true, dismissed: [] }, 'defaults: on, nothing dismissed');
  const after = dismissRecommendation(storage, 'm-pasta');
  ok(after.dismissed.includes('m-pasta'), 'dismissal is stored');
  assert.deepEqual(loadRecommendPrefs(storage).dismissed, ['m-pasta'], 'dismissal survives a reload');
  dismissRecommendation(storage, 'm-pasta');
  assert.equal(loadRecommendPrefs(storage).dismissed.length, 1, 'dismissing twice does not duplicate');
  saveRecommendPrefs(storage, { enabled: false, dismissed: ['m-pasta'] });
  assert.equal(loadRecommendPrefs(storage).enabled, false, 'switching off persists');
  assert.deepEqual(clearRecommendDismissals(storage).dismissed, [], 'dismissals can be cleared');
  assert.deepEqual(deleteRecommendPrefs(storage), { enabled: true, dismissed: [] }, 'deleting wipes the prefs');
  ok(!store.has(RECOMMEND_KEY), 'delete removes the stored key');
}

console.log('RECOMMEND OK');
