// Smart B-roll suggestions (gap-build Stream E, AI-05) — LOCAL ONLY.
//
// What the speaker is saying names the B-roll: for each transcript
// sentence, the sentence's content words are searched against the P2-41
// offline media index (names, tags, spoken dialogue — all on-device), and
// the best local picture media that is NOT already on the timeline is
// suggested as an overlay B-roll for that sentence's span. Nothing is
// fetched, no model runs, no stock is involved: the candidates are the
// project's own library, ranked by the same index the Media panel's
// semantic search uses. A suggestion says WHY ("you say X, this clip is
// tagged X") and the user places it — nothing is added automatically.
//
// One suggestion per sentence at most (the best match), one use per media
// item (the first sentence that claims it keeps it), audio-only media
// never suggested (an overlay needs a picture). Sentences with no match
// get no suggestion rather than a forced one.
import { autoTags, searchMediaIndex, tokenize } from './mediaIndex.js';
import { RECOMMEND_STOPWORDS, FILE_EXTENSIONS } from './recommend.js';
import { transcriptSentences } from './transcript.js';

// Content terms of a sentence: tokens minus glue words and file extensions.
export function sentenceTerms(text) {
  return [...new Set(tokenize(text).filter((t) => t.length > 1 && !RECOMMEND_STOPWORDS.has(t) && !FILE_EXTENSIONS.has(t)))];
}

// The best local B-roll candidate for one sentence's terms, or null.
// index: the P2-41 index; items: [{ id, name, type, tags, transcript }];
// usedIds: media already on the timeline (never suggested); claimed: media
// already suggested for an earlier sentence (one use each).
export function suggestForSentence(terms, { index, items, usedIds = new Set(), claimed = new Set() } = {}) {
  if (!index || !terms?.length || !items?.length) return null;
  const byId = new Map(items.map((m) => [m.id, m]));
  let best = null;
  for (const term of terms) {
    for (const hit of searchMediaIndex(index, term)) {
      const item = byId.get(hit.id);
      if (!item || item.type === 'audio' || usedIds.has(hit.id) || claimed.has(hit.id)) continue;
      const tags = autoTags(item, item.transcript || '');
      const score = hit.score * (tags.includes(term) ? 2 : 1);
      if (!best || score > best.score) best = { id: hit.id, item, score, term, viaTag: tags.includes(term) };
    }
  }
  if (!best) return null;
  return {
    id: best.id,
    item: best.item,
    score: Math.round(best.score * 100) / 100,
    reason: best.viaTag
      ? { kind: 'tag', term: best.term, text: `You say “${best.term}” — this clip is tagged ${best.term}` }
      : { kind: 'name', term: best.term, text: `You say “${best.term}” — this clip matches ${best.term}` },
  };
}

// Suggestions across the whole transcript: [{ sentence, start, end,
// mediaId, name, type, score, reason }] in timeline order.
export function suggestBroll({ project, index, items, dismissed = [], limit = 10 } = {}) {
  const sentences = transcriptSentences(project || {});
  if (!sentences.length || !index) return [];
  const usedIds = new Set();
  for (const track of ['videoClips', 'audioClips', 'overlayClips']) {
    for (const c of project?.[track] || []) if (c.mediaId) usedIds.add(c.mediaId);
  }
  const dismissedSet = new Set(dismissed);
  const claimed = new Set();
  const out = [];
  for (let i = 0; i < sentences.length && out.length < limit; i++) {
    const s = sentences[i];
    const terms = sentenceTerms(s.text);
    if (!terms.length) continue;
    const hit = suggestForSentence(terms, { index, items, usedIds, claimed });
    if (!hit || dismissedSet.has(hit.id)) continue;
    claimed.add(hit.id);
    out.push({
      sentence: i, start: s.start, end: s.end, text: s.text,
      mediaId: hit.id, name: hit.item.name, type: hit.item.type,
      score: hit.score, reason: hit.reason,
    });
  }
  return out;
}
