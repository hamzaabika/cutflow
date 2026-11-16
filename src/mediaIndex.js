// Semantic footage search / AI tagging (P2-41, AI-05) — offline first.
// There are no semantic embeddings in the app, and none are added here:
// the index is built on-device from what the project already holds — file
// names, user tags, and the spoken dialogue attributed from caption clips —
// plus a small bilingual keyword tagger (English + Arabic/Darija) that
// derives tags from those same sources. Nothing leaves the PC, no model is
// downloaded, and the index itself is only an in-memory inverted index over
// the project's own media: it can be switched off (search falls back to the
// plain substring scan) and deleted (its persisted tag cache, localStorage
// `clipcraft.mediaIndex.v1`, is wiped) from the Media panel.
//
// Retrieval: multi-word queries are AND across terms (like the existing
// search); terms match name (weight 3), tags (weight 2) or transcript
// (weight 1), Arabic-normalised (alef forms, teh marbuta, diacritics) so
// "مقابله" finds "مقابلة". Results rank by total weight, then by name.
const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const ALEF = /[أإآٱ]/g;

export function normalizeArabic(s) {
  return String(s || '')
    .replace(DIACRITICS, '')
    .replace(ALEF, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

export function tokenize(text) {
  return normalizeArabic(String(text || '').toLowerCase())
    .split(/[^a-z0-9\u0600-\u06FF]+/u)
    .filter(Boolean);
}

// Bilingual keyword tagger: one tag per concept, English + Arabic/Darija
// surface forms. Deliberately small and inspectable — a tag only fires
// when the word actually appears in the name or the spoken dialogue.
export const TAG_KEYWORDS = {
  beach: ['beach', 'sea', 'ocean', 'شاطئ', 'شط', 'بحر'],
  interview: ['interview', 'مقابله', 'مقابلة', 'حوار'],
  drone: ['drone', 'aerial', 'درون'],
  cooking: ['cooking', 'recipe', 'kitchen', 'طبخ', 'مطبخ', 'وصفه', 'وصفة'],
  car: ['car', 'drive', 'driving', 'سياره', 'سيارة', 'طوموبيل'],
  city: ['city', 'street', 'urban', 'مدينه', 'مدينة', 'شارع'],
  night: ['night', 'nocturne', 'ليل', 'ليلي'],
  dance: ['dance', 'dancing', 'رقص'],
  tutorial: ['tutorial', 'how to', 'lesson', 'شرح', 'درس', 'تعلم'],
  vlog: ['vlog', 'فلوق', 'فلوغ'],
  workout: ['workout', 'gym', 'fitness', 'رياضه', 'رياضة', 'جيم'],
  music: ['music', 'song', 'concert', 'موسيقى', 'موسيقي', 'اغنيه', 'اغنية'],
  wedding: ['wedding', 'عرس', 'زواج'],
  nature: ['nature', 'forest', 'mountain', 'طبيعه', 'طبيعة', 'جبل', 'غابه', 'غابة'],
  tech: ['tech', 'software', 'coding', 'تقنيه', 'تقنية', 'برمجه', 'برمجة'],
  food: ['food', 'restaurant', 'اكل', 'أكل', 'مطعم'],
  sport: ['football', 'soccer', 'match', 'كوره', 'كورة', 'مباراه', 'مباراة'],
  talking: ['podcast', 'talk', 'بودكاست'],
};

export function autoTags(media, transcriptText = '') {
  const hay = ` ${tokenize(`${media?.name || ''} ${transcriptText}`).join(' ')} `;
  const tags = new Set(Array.isArray(media?.tags) ? media.tags.map((t) => String(t).toLowerCase()) : []);
  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    for (const kw of keywords) {
      const nkw = tokenize(kw).join(' ');
      // Word-boundary match on the token stream: 'car' must not fire on 'card'.
      if (nkw && hay.includes(` ${nkw} `)) { tags.add(tag); break; }
    }
  }
  return [...tags];
}

// Build the inverted index over prepared items:
// { id, name, type, tags: [..], transcript } — one entry per media item.
export function buildMediaIndex(items) {
  const docs = new Map();
  const postings = new Map(); // token -> Map(id -> best weight)
  for (const item of items || []) {
    const nameTokens = new Set(tokenize(item.name));
    // Tag tokens include the tag's own name AND every surface form that
    // maps to it (English + Arabic/Darija), so a query in either language
    // finds the tag: 'شاطئ' matches items tagged 'beach', 'مقابله' matches
    // items tagged 'interview'.
    const tagTokens = new Set((item.tags || []).flatMap((t) => [
      ...tokenize(t),
      ...(TAG_KEYWORDS[String(t).toLowerCase()] || []).flatMap((kw) => tokenize(kw)),
    ]));
    const transcriptTokens = new Set(tokenize(item.transcript || ''));
    docs.set(item.id, { item, nameTokens, tagTokens, transcriptTokens });
    const add = (tokens, weight) => {
      for (const tok of tokens) {
        if (!postings.has(tok)) postings.set(tok, new Map());
        const m = postings.get(tok);
        m.set(item.id, Math.max(m.get(item.id) || 0, weight));
      }
    };
    add(nameTokens, 3);
    add(tagTokens, 2);
    add(transcriptTokens, 1);
  }
  return { docs, postings, size: docs.size };
}

// Ranked retrieval. AND across terms; every term must appear in some field.
// Returns [{ id, score, viaTranscript }] best-first (score, then name).
export function searchMediaIndex(index, query) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !index) return [];
  const scores = new Map();
  for (const term of terms) {
    const posting = index.postings.get(term);
    if (!posting) return []; // AND: a term no document has kills the query
    for (const [id, w] of posting) scores.set(id, (scores.get(id) || 0) + w);
  }
  // AND enforcement: a document must carry every term (the loop above adds
  // a score per term only when the term posts the document, so a document
  // missing a term has fewer contributing terms — count them).
  const termCount = new Map();
  for (const term of terms) {
    for (const id of index.postings.get(term).keys()) termCount.set(id, (termCount.get(id) || 0) + 1);
  }
  const out = [];
  for (const [id, score] of scores) {
    if ((termCount.get(id) || 0) !== terms.length) continue;
    const doc = index.docs.get(id);
    const viaTranscript = terms.some((t) => !doc.nameTokens.has(t) && !doc.tagTokens.has(t) && doc.transcriptTokens.has(t));
    out.push({ id, score, viaTranscript });
  }
  out.sort((a, b) => b.score - a.score || String(index.docs.get(a.id).item.name || '').localeCompare(String(index.docs.get(b.id).item.name || '')));
  return out;
}

// Index controls (persisted): enabled by default; off = the Media panel
// falls back to the plain substring scan; delete = the persisted tag cache
// is wiped (the in-memory index is rebuilt from the project on next load).
export const MEDIA_INDEX_KEY = 'clipcraft.mediaIndex.v1';
export function loadMediaIndexPrefs(storage) {
  try {
    const v = JSON.parse(storage.getItem(MEDIA_INDEX_KEY) || 'null');
    if (v && typeof v === 'object') return { enabled: v.enabled !== false, tagCache: v.tagCache && typeof v.tagCache === 'object' ? v.tagCache : {} };
  } catch { /* defaults */ }
  return { enabled: true, tagCache: {} };
}
export function saveMediaIndexPrefs(storage, prefs) {
  try { storage.setItem(MEDIA_INDEX_KEY, JSON.stringify({ enabled: prefs.enabled !== false, tagCache: prefs.tagCache || {} })); } catch { /* not saved */ }
}
export function deleteMediaIndex(storage) {
  try { storage.removeItem(MEDIA_INDEX_KEY); } catch { /* already gone */ }
  return { enabled: true, tagCache: {} };
}
