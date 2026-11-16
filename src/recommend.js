// Intelligent asset recommendation (P3-10) — LOCAL ONLY.
// Built on the P2-41 offline semantic index (./mediaIndex.js): the signals
// come from the project itself — the transcript words in its caption/text
// clips, the names of the clips already on its timeline, and the tags of its
// media — and the candidates are ranked by that same local index. Nothing
// is fetched, no model is downloaded, no data leaves the PC: this module
// imports no network API at all (there is no fetch / XHR / WebSocket here),
// so it works with the network disabled. Every suggestion carries a
// structured reason ({ kind, term, clip? }) so the UI can say WHY it was
// suggested ("transcript mentions X" / "matches clip Y" / "tagged Z").
// A suggestion can be dismissed (persisted locally, never suggested again
// until the dismissal list is cleared), recommendations can be switched off,
// and the index they read is the Media panel's index — disable or delete it
// there and recommendations stop with it.
import { tokenize, searchMediaIndex } from './mediaIndex.js';

// Words too common to signal anything (English + Arabic). Deliberately
// short: the point is to drop glue words, not to build a dictionary.
export const RECOMMEND_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'it', 'this', 'that',
  'we', 'you', 'our', 'your', 'from', 'by', 'at', 'as', 'be', 'are', 'was', 'were', 'i', 'me', 'my',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'its', 'but', 'not', 'so', 'if', 'then',
  'when', 'how', 'what', 'why', 'who', 'all', 'can', 'will', 'just', 'like', 'get', 'got', 'have',
  'has', 'had', 'do', 'does', 'did', 'very', 'really', 'more', 'most', 'new', 'one', 'two', 'first',
  'also', 'about', 'into', 'over', 'after', 'before', 'up', 'down', 'out', 'now', 'here', 'there',
  'في', 'من', 'الي', 'على', 'ان', 'ما', 'لا', 'لم', 'لن', 'هذا', 'هذه', 'هو', 'هي', 'كان', 'يكون',
  'مع', 'عن', 'بعد', 'قبل', 'عند', 'بين', 'لكن', 'كما', 'ثم', 'او',
]);

// File extensions carry no content: without this, 'mp4' matches every
// video in the library and the suggestions turn generic.
export const FILE_EXTENSIONS = new Set([
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'srt', 'vtt',
]);

// The project's own signals, in one place so the UI and the tests agree:
//   transcriptTerms — words spoken in caption/text clips (and attributed
//     media transcripts), the strongest signal;
//   clipTerms — Map term -> the timeline clip name it came from;
//   tagTerms — words from the media's own tags.
// Counts are kept so a word said five times outranks a word said once.
export function collectProjectSignals(project, mediaById, transcripts) {
  const transcriptTerms = new Map();
  const clipTerms = new Map();
  const tagTerms = new Map();
  const add = (map, term) => map.set(term, (map.get(term) || 0) + 1);
  const addText = (map, text) => {
    for (const tok of tokenize(text)) {
      if (tok.length > 1 && !RECOMMEND_STOPWORDS.has(tok)) add(map, tok);
    }
  };
  for (const c of project?.textClips || []) addText(transcriptTerms, c.text || '');
  if (transcripts) for (const text of transcripts.values()) addText(transcriptTerms, text || '');
  const used = new Set();
  for (const track of ['videoClips', 'audioClips', 'overlayClips']) {
    for (const c of project?.[track] || []) {
      if (c.mediaId) used.add(c.mediaId);
      const m = mediaById?.get(c.mediaId);
      if (m?.name) {
        for (const tok of tokenize(m.name)) {
          // File extensions are not content: 'mp4' would match every video
          // in the library and turn the suggestions generic.
          if (tok.length > 1 && !RECOMMEND_STOPWORDS.has(tok) && !FILE_EXTENSIONS.has(tok) && !clipTerms.has(tok)) clipTerms.set(tok, m.name);
        }
      }
    }
  }
  // Tag words come from the media already ON the timeline only: the
  // project's own footage is tagged X, so more X is worth suggesting. Tags
  // of library items that are not in the project are NOT a signal — they
  // would let every tagged asset recommend itself.
  for (const id of used) {
    const m = mediaById?.get(id);
    for (const tag of m?.tags || []) addText(tagTerms, tag);
  }
  return { transcriptTerms, clipTerms, tagTerms, usedIds: used };
}

// Rank the local library against the signals. index is the P2-41 index built
// over items [{ id, name, type, tags, transcript }]; items is the same list
// (for names/types). Assets already on the timeline (usedIds) and dismissed
// ones never surface. Returns [{ id, item, score, reasons }] best-first,
// reasons capped at two per asset: the strongest source wins per term
// (transcript > timeline clip > tag > the asset's own name).
export function recommendAssets({ index, items, signals, dismissed = [], limit = 5 } = {}) {
  if (!index || !signals || !items?.length) return [];
  const dismissedSet = new Set(dismissed);
  const byId = new Map(items.map((m) => [m.id, m]));
  // Signal terms ranked: transcript words first (weight 3, by count), then
  // timeline-clip words (weight 2), then tag words (weight 1). Only the top
  // 12 terms are queried — the rest is noise.
  const weighted = new Map();
  for (const [term, n] of signals.transcriptTerms) weighted.set(term, { w: 3 * n, source: 'transcript' });
  for (const [term] of signals.clipTerms) {
    if (!weighted.has(term)) weighted.set(term, { w: 2, source: 'clip' });
  }
  for (const [term, n] of signals.tagTerms) {
    if (!weighted.has(term)) weighted.set(term, { w: 1 * Math.min(n, 3), source: 'tag' });
  }
  const terms = [...weighted.entries()].sort((a, b) => b[1].w - a[1].w).slice(0, 12);
  const acc = new Map(); // id -> { score, reasons: Map(key -> reason) }
  for (const [term, { w, source }] of terms) {
    for (const hit of searchMediaIndex(index, term)) {
      const id = hit.id;
      if (dismissedSet.has(id) || signals.usedIds?.has(id)) continue;
      const doc = index.docs.get(id);
      if (!doc) continue;
      if (!acc.has(id)) acc.set(id, { score: 0, reasons: new Map() });
      const entry = acc.get(id);
      entry.score += w * hit.score;
      // The reason says why THIS project wants THIS asset: the signal's
      // source wins, except a tag-only match is explained by the asset's tag.
      let reason;
      if (source === 'transcript') reason = { kind: 'transcript', term };
      else if (source === 'clip') reason = { kind: 'clip', term, clip: signals.clipTerms.get(term) };
      else if (doc.tagTokens.has(term)) reason = { kind: 'tag', term };
      else reason = { kind: 'name', term };
      entry.reasons.set(`${reason.kind}:${reason.term}`, reason);
    }
  }
  const out = [];
  for (const [id, entry] of acc) {
    const item = byId.get(id);
    if (!item) continue;
    // Transcript reasons first, then clip, tag, name; at most two shown.
    const order = { transcript: 0, clip: 1, tag: 2, name: 3 };
    const reasons = [...entry.reasons.values()].sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 2);
    out.push({ id, item, score: entry.score, reasons });
  }
  out.sort((a, b) => b.score - a.score || String(a.item.name || '').localeCompare(String(b.item.name || '')));
  return out.slice(0, limit);
}

// Recommendation prefs (persisted locally): on by default; dismissed ids
// are never suggested again until the list is cleared. The INDEX itself is
// owned by the media index prefs (clipcraft.mediaIndex.v1) — this only
// switches the suggestions on/off and remembers dismissals.
export const RECOMMEND_KEY = 'clipcraft.recommend.v1';
export function loadRecommendPrefs(storage) {
  try {
    const v = JSON.parse(storage.getItem(RECOMMEND_KEY) || 'null');
    if (v && typeof v === 'object') {
      return { enabled: v.enabled !== false, dismissed: Array.isArray(v.dismissed) ? v.dismissed : [] };
    }
  } catch { /* defaults */ }
  return { enabled: true, dismissed: [] };
}
export function saveRecommendPrefs(storage, prefs) {
  try {
    storage.setItem(RECOMMEND_KEY, JSON.stringify({
      enabled: prefs.enabled !== false,
      dismissed: Array.isArray(prefs.dismissed) ? prefs.dismissed : [],
    }));
  } catch { /* not saved */ }
}
export function dismissRecommendation(storage, id) {
  const prefs = loadRecommendPrefs(storage);
  if (!prefs.dismissed.includes(id)) prefs.dismissed.push(id);
  saveRecommendPrefs(storage, prefs);
  return prefs;
}
export function clearRecommendDismissals(storage) {
  const prefs = loadRecommendPrefs(storage);
  prefs.dismissed = [];
  saveRecommendPrefs(storage, prefs);
  return prefs;
}
export function deleteRecommendPrefs(storage) {
  try { storage.removeItem(RECOMMEND_KEY); } catch { /* already gone */ }
  return { enabled: true, dismissed: [] };
}
