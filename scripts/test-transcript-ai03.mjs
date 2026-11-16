// Gap-build Stream E — AI-03 transcript confidence controls + speaker
// labelling. Run: node scripts/test-transcript-ai03.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptSentences, lowConfidenceWords, confidenceStats, speakerName, speakersUsed, retakeGroups, SPEAKER_IDS } from '../src/transcript.js';
import { normalizeProject, historyReducer } from '../src/store.js';

const require = createRequire(import.meta.url);
const { segmentWords } = require('../electron/whisper.cjs');
const cloud = require('../electron/cloudCaptions.cjs');

// ---------- Whisper token probabilities become word confidence ----------
{
  const seg = { start: 0, end: 3, text: 'hello world' };
  const s = {
    tokens: [
      { text: ' hello', offsets: { from: 0, to: 500 }, p: 0.99 },
      { text: ' world', offsets: { from: 500, to: 1000 }, p: 0.42 },
    ],
  };
  const words = segmentWords(s, seg);
  assert.equal(words.length, 2, 'two words from two tokens');
  assert.equal(words[0].conf, 0.99, 'high-confidence word keeps its token probability');
  assert.equal(words[1].conf, 0.42, 'low-confidence word keeps its token probability');
  // No p on the tokens: no conf invented.
  const noP = segmentWords({ tokens: [{ text: ' hello', offsets: { from: 0, to: 500 } }] }, { start: 0, end: 1, text: 'hello' });
  assert.equal('conf' in noP[0], false, 'a word without token probabilities carries no confidence');
  // A multi-token word averages its tokens' probabilities.
  const multi = segmentWords({
    tokens: [
      { text: ' hel', offsets: { from: 0, to: 200 }, p: 0.8 },
      { text: 'lo', offsets: { from: 200, to: 400 }, p: 0.6 },
    ],
  }, { start: 0, end: 1, text: 'hello' });
  assert.equal(multi[0].conf, 0.7, 'a split word averages its tokens');
}

// ---------- Transcript helpers: confidence + speakers ----------
const mkProject = () => ({
  ...normalizeProject({}),
  speakers: { S1: 'Hamza' },
  textClips: [
    { id: 'c1', caption: true, start: 0, duration: 4, text: 'hello world again', speaker: 'S1',
      words: [
        { text: 'hello', start: 0, end: 0.5, conf: 0.98 },
        { text: 'world', start: 0.6, end: 1.1, conf: 0.41 },
        { text: 'again', start: 1.2, end: 1.8 },
      ] },
    { id: 'c2', caption: true, start: 4, duration: 2, text: 'hello world again', speaker: 'S2',
      words: [{ text: 'hello', start: 0, end: 0.5, conf: 0.9 }, { text: 'world', start: 0.6, end: 1, conf: 0.88 }, { text: 'again', start: 1.1, end: 1.6, conf: 0.91 }] },
  ],
});
{
  const sentences = transcriptSentences(mkProject());
  assert.equal(sentences[0].speaker, 'S1', 'sentence carries the clip speaker label');
  assert.equal(sentences[0].words[1].conf, 0.41, 'word confidence survives into the transcript');
  assert.equal('conf' in sentences[0].words[2], false, 'a word without a score carries none');
  const low = lowConfidenceWords(sentences, 0.7);
  assert.equal(low.length, 1, 'one word below 0.7');
  assert.equal(low[0].text, 'world', 'the low word is the 0.41 one');
  assert.equal(low[0].speaker, 'S1', 'the review entry says who said it');
  assert.deepEqual(lowConfidenceWords(sentences, 0.3), [], 'nothing below 0.3');
  const stats = confidenceStats(sentences, 0.7);
  assert.equal(stats.total, 6, 'six words total');
  assert.equal(stats.withConf, 5, 'five carry a score');
  assert.equal(stats.low, 1, 'one below the threshold');
  assert.ok(Math.abs(stats.avg - 0.816) < 0.001, `mean confidence is 0.816, got ${stats.avg}`);
  assert.equal(speakerName(mkProject(), 'S1'), 'Hamza', 'a named speaker shows the name');
  assert.equal(speakerName(mkProject(), 'S2'), 'Speaker 2', 'an unnamed speaker shows its number');
  assert.deepEqual(speakersUsed(sentences), ['S1', 'S2'], 'speakers used, in order');
  assert.deepEqual(SPEAKER_IDS, ['S1', 'S2', 'S3', 'S4'], 'four speaker slots offered');
  // Retake detection (pre-existing, verified here, not rebuilt): the two
  // identical sentences group, last complete take is the keeper.
  const groups = retakeGroups(sentences);
  assert.equal(groups.length, 1, 'the repeated line groups as a retake');
  assert.equal(groups[0].keep, 1, 'the last take is the suggested keeper');
}

// ---------- setCaptions carries conf + speaker into the clips ----------
{
  const st = { past: [], present: mkProject(), future: [] };
  const p = historyReducer(st, { type: 'setCaptions', style: {}, segments: [
    { id: 'n1', text: 'hi there', start: 0, end: 2, speaker: 'S2', words: [{ text: 'hi', start: 0, end: 0.4, conf: 0.55 }, { text: 'there', start: 0.5, end: 1, conf: 0.95 }] },
  ] }).present;
  const clip = p.textClips.find((c) => c.id === 'n1');
  assert.equal(clip.speaker, 'S2', 'speaker label lands on the clip');
  assert.equal(clip.words[0].conf, 0.55, 'word confidence lands on the clip');
  assert.equal(clip.words[1].conf, 0.95, 'high word confidence lands too');
  // Labelling by hand: a plain update sets the speaker on a caption clip.
  const labelled = historyReducer({ past: [], present: p, future: [] }, { type: 'update', track: 'text', id: 'n1', patch: { speaker: 'S1' } }).present;
  assert.equal(labelled.textClips.find((c) => c.id === 'n1').speaker, 'S1', 'manual speaker labelling works through update');
}

// ---------- Deepgram diarization: opt-in, speaker labels on segments ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-ai03-'));
  const audio = path.join(dir, 'a.mp3');
  fs.writeFileSync(audio, Buffer.from([0, 1, 2, 3]));
  const dgJson = { results: { utterances: [
    { start: 0, end: 2, transcript: 'hello', speaker: 0 },
    { start: 2, end: 4, transcript: 'hi back', speaker: 1 },
    { start: 4, end: 5, transcript: 'no speaker field here' },
  ] } };
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(String(url));
    // A real Deepgram reply only carries speakers when diarization was
    // asked for — the stub mirrors that.
    const asked = String(url).includes('diarize=true');
    const utterances = dgJson.results.utterances.map((u) => (asked ? u : { start: u.start, end: u.end, transcript: u.transcript }));
    return { ok: true, json: async () => ({ results: { utterances } }) };
  };
  const on = await cloud.transcribeCloud({ provider: 'deepgram', key: 'k', audioPath: audio, fetchImpl, diarize: true });
  assert.ok(calls[0].includes('diarize=true'), 'diarize on asks Deepgram for speakers');
  assert.equal(on.segments[0].speaker, 'S1', 'speaker 0 becomes S1');
  assert.equal(on.segments[1].speaker, 'S2', 'speaker 1 becomes S2');
  assert.equal('speaker' in on.segments[2], false, 'an utterance without a speaker stays unlabelled');
  const off = await cloud.transcribeCloud({ provider: 'deepgram', key: 'k', audioPath: audio, fetchImpl, diarize: false });
  assert.ok(calls[1].includes('diarize=false'), 'diarize off leaves the old behaviour');
  assert.equal('speaker' in off.segments[0], false, 'without diarization no speaker is reported');
  // Chunk merging keeps the label.
  const merged = cloud.mergeChunks([{ offset: 10, segments: on.segments }]);
  assert.equal(merged[0].speaker, 'S1', 'merged chunk keeps the speaker');
  assert.equal(merged[0].start, 10, 'merged chunk shifts the time');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('test-transcript-ai03: PASS');
