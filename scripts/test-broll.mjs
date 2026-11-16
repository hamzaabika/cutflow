// Gap-build Stream E — AI-05 smart B-roll suggestions (local P2-41 index).
// Run: node scripts/test-broll.mjs
import assert from 'node:assert/strict';
import { buildMediaIndex, autoTags } from '../src/mediaIndex.js';
import { suggestBroll, suggestForSentence, sentenceTerms } from '../src/broll.js';
import { normalizeProject } from '../src/store.js';

const items = [
  { id: 'm-beach', name: 'beach sunset.mp4', type: 'video', tags: ['beach'], transcript: '' },
  { id: 'm-kitchen', name: 'cooking pasta.mp4', type: 'video', tags: ['cooking'], transcript: '' },
  { id: 'm-song', name: 'my song.mp3', type: 'audio', tags: ['music'], transcript: '' },
  { id: 'm-city', name: 'city night drive.mp4', type: 'video', tags: ['city', 'night'], transcript: 'driving through the city at night' },
];
const index = buildMediaIndex(items.map((m) => ({ ...m, transcript: m.transcript || '' })));

assert.deepEqual(sentenceTerms('we went to the beach and cooked'), ['went', 'beach', 'cooked'], 'glue words drop out, content terms stay');
assert.ok(!sentenceTerms('the and of').length, 'a sentence of pure glue yields no terms');

const project = {
  ...normalizeProject({}),
  media: items,
  videoClips: [{ id: 'v1', mediaId: 'm-beach', in: 0, out: 5, speed: 1 }],
  textClips: [
    { id: 'c1', caption: true, start: 0, duration: 4, text: 'we cooked pasta in the kitchen' },
    { id: 'c2', caption: true, start: 5, duration: 4, text: 'then we drove through the city at night' },
    { id: 'c3', caption: true, start: 10, duration: 3, text: 'and the beach was beautiful' },
  ],
};
const used = new Set(['m-beach']);

// The beach clip is already on the timeline, so sentence 3 gets nothing
// for it — even though it matches.
const s3 = suggestForSentence(sentenceTerms('and the beach was beautiful'), { index, items, usedIds: used });
assert.equal(s3, null, 'media already on the timeline is never suggested as B-roll');

// Kitchen matches the cooking sentence.
const s1 = suggestForSentence(sentenceTerms('we cooked pasta in the kitchen'), { index, items, usedIds: used });
assert.equal(s1?.id, 'm-kitchen', 'the cooking sentence suggests the cooking clip');
assert.equal(s1.reason.term, 'pasta', 'the reason names the spoken word that matched the clip name');

// Audio is never B-roll.
const song = suggestForSentence(sentenceTerms('my song music'), { index, items, usedIds: used });
assert.equal(song, null, 'audio media is never suggested as overlay B-roll');

const all = suggestBroll({ project, index, items });
assert.equal(all.length, 2, 'two sentences get a suggestion (kitchen + city)');
assert.equal(all[0].mediaId, 'm-kitchen', 'first suggestion is the kitchen clip');
assert.equal(all[0].start, 0, 'suggestion starts at its sentence');
assert.equal(all[1].mediaId, 'm-city', 'second suggestion is the city clip');
assert.equal(all[1].sentence, 1, 'second suggestion belongs to the second sentence');
assert.ok(all[0].reason.text.includes('pasta'), 'the reason explains itself in plain words');

// One use per media item: two sentences about cooking claim it once.
const dup = {
  ...project,
  textClips: [
    { id: 'c1', caption: true, start: 0, duration: 4, text: 'we cooked pasta' },
    { id: 'c2', caption: true, start: 5, duration: 4, text: 'cooking again in the kitchen' },
  ],
  videoClips: [],
};
assert.equal(suggestBroll({ project: dup, index, items }).length, 1, 'the same clip is suggested once, for the first sentence');
assert.equal(suggestBroll({ project: dup, index, items, dismissed: ['m-kitchen'] }).length, 0, 'a dismissed clip is never suggested again');
assert.deepEqual(suggestBroll({ project, index: null, items }), [], 'no index, no suggestions');
assert.deepEqual(suggestBroll({ project: { ...project, textClips: [] }, index, items }), [], 'no transcript, no suggestions');

console.log('test-broll: PASS');
