// Pure helpers for the folder-backed asset pack (electron/assets.cjs serves the manifest)
// and for the Media panel's tree (Workstream C). No React, no window — the test suite
// (scripts/test-assets.cjs) exercises this file directly. The one import below,
// store.js, is pure too (layout math only); it never imports this file back.
import { freeLen, videoLayout } from './store.js';

// Assets-tab groups, in order. The pack's AUDIO is deliberately NOT here (Hamza,
// 2026-11-01): Music lives in the Audio tab's Music place and Sound FX in the Audio
// tab's Sound FX place, with the music — Assets holds the visual/other groups only.
// Generated is not a manifest group either — it is the Forge shelf, read through
// window.api.forgeList in the panel. Characters, Icons and 3D arrived with pack 2.
export const ASSET_GROUPS = ['Transitions', 'Overlays', 'Characters', 'Icons', '3D'];

// Where a pack item goes when clicked in a library panel, as the `where` argument of
// App's addFile(path, where): audio files land on the audio lane at the playhead (addFile
// routes by media type), video and image files become overlay clips at the playhead
// (images with the default image duration, like imported photos). Must agree with
// electron/assets.cjs laneFor(); test-assets.cjs pins the agreement.
export const assetAddWhere = (item) => (item && (item.kind === 'video' || item.kind === 'image') ? 'overlay' : 'main');

// ---- Media tree classification ----
// Kinds come from the media registry itself (m.type). Speech and Processed are subsets
// identified by HOW the item entered the registry:
// - Speech: text-to-speech output. TTS results carry a credit whose license is 'piper' or
//   'elevenlabs' (electron tts:speak), and App tags new ones origin: 'tts' as well. Plain
//   voice-over RECORDINGS are the user's own microphone files, not generated speech, so
//   they stay plain Audio.
// - Processed: render outputs registered as media — Detach audio, Reverse and Stabilize.
//   App tags new renders origin: 'detach' | 'reverse' | 'stabilize'; renders made before
//   the tag existed are recognised by the render cache's file naming (<hash>-detach.wav,
//   <hash>-rev.mp4, <hash>-stab.mp4 — electron/detach.cjs, reverse.cjs, stabilize.cjs).
//   Colour mattes and black videos (checklist #11) are generated in-app too, so
//   origin 'matte' counts as processed as well.
//   Voice-enhance renders are NOT media (they hang off the clip as clip.enhance), so they
//   truthfully never appear here.
export const PROCESSED_ORIGINS = ['detach', 'reverse', 'stabilize', 'enhance', 'matte'];
const RENDER_NAME = /-(detach|rev|stab)\.[a-z0-9]+$/i;

export const isSpeechMedia = (m) => !!m && m.type === 'audio'
  && (m.origin === 'tts' || m.credit?.license === 'piper' || m.credit?.license === 'elevenlabs');

export const isProcessedMedia = (m) => {
  if (!m) return false;
  if (PROCESSED_ORIGINS.includes(m.origin)) return true;
  const base = String(m.path || '').split(/[\\/]/).pop() || '';
  return RENDER_NAME.test(m.name || '') || RENDER_NAME.test(base);
};

// Filter nodes: 'all' | 'video' | 'audio' | 'image' | 'generated' | 'speech' | 'processed'.
// ('generated' is the union of the two generated sub-sources — the Media panel
// shows all of them as one row of filter chips since P5.)
export function mediaTreeCounts(media) {
  const c = { all: media.length, video: 0, audio: 0, image: 0, speech: 0, processed: 0, generated: 0 };
  for (const m of media) {
    if (m.type === 'video') c.video += 1;
    else if (m.type === 'audio') c.audio += 1;
    else if (m.type === 'image') c.image += 1;
    if (isSpeechMedia(m)) c.speech += 1;
    if (isProcessedMedia(m)) c.processed += 1;
    if (isSpeechMedia(m) || isProcessedMedia(m)) c.generated += 1;
  }
  return c;
}

export function mediaTreeFilter(media, sel) {
  switch (sel) {
    case 'video': return media.filter((m) => m.type === 'video');
    case 'audio': return media.filter((m) => m.type === 'audio');
    case 'image': return media.filter((m) => m.type === 'image');
    case 'speech': return media.filter((m) => isSpeechMedia(m));
    case 'processed': return media.filter((m) => isProcessedMedia(m));
    case 'generated': return media.filter((m) => isSpeechMedia(m) || isProcessedMedia(m));
    default: return media;
  }
}

// ---- Media search (P1-47) ----
// Project media carries no user-editable tag field — tags exist only on
// stock/pack audio — so a query matches against what the registry actually
// holds: the display name, the file extension, the kind label, the
// origin-derived labels (speech / processed / generated / the raw origin),
// any tags the item does carry (stock-added items keep their source tags),
// and the dialogue transcribed for that media (mediaTranscriptTexts).
// Multi-word queries are AND across terms: every term must appear somewhere
// in the item's fields, so "beach drone" never matches a beach photo plus a
// drone clip. Matching is a plain case-insensitive substring scan — O(n) over
// the library, no index to build or keep in sync.
const normSearch = (s) => String(s || '').toLowerCase();

function mediaTagList(m) {
  const tags = Array.isArray(m.tags) ? m.tags : (typeof m.tags === 'string' ? m.tags.split(/[,\s]+/) : []);
  const ext = String(m.name || m.path || '').split('.').pop() || '';
  return [
    m.type, ext,
    ...(isSpeechMedia(m) ? ['speech'] : []),
    ...(isProcessedMedia(m) ? ['processed'] : []),
    ...((isSpeechMedia(m) || isProcessedMedia(m)) ? ['generated'] : []),
    ...(m.origin ? [String(m.origin)] : []),
    ...tags,
  ].map(normSearch).filter(Boolean);
}

// The non-transcript haystack of one item (name + tags), kept separate from
// the transcript text so the panel can tell the user a hit came from spoken
// dialogue rather than from the file name.
export function mediaNameTagHaystack(m) {
  return [m.name, ...mediaTagList(m)].map(normSearch).filter(Boolean).join('\n');
}

// { match, viaTranscript }: viaTranscript is true only when the query hits
// the transcript and at least one term hits ONLY the transcript — a hit on
// the name is a name hit even if the same word was also spoken.
export function mediaMatchesQuery(m, query, transcriptText = '') {
  const terms = normSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return { match: true, viaTranscript: false };
  const hay = mediaNameTagHaystack(m);
  const spoken = normSearch(transcriptText);
  const match = terms.every((t) => hay.includes(t) || spoken.includes(t));
  const viaTranscript = match && terms.some((t) => !hay.includes(t) && spoken.includes(t));
  return { match, viaTranscript };
}

// Dialogue search: caption clips carry no media id (they are timeline text),
// so a caption sentence is attributed to the media whose timeline clip covers
// its span — video via videoLayout, audio/overlay via start + freeLen. Media
// never placed on the timeline, or captions with no overlapping clip, get no
// transcript text, and the search then falls back to name/tag only for them.
// Returns a Map mediaId -> joined caption text.
export function mediaTranscriptTexts(project) {
  const byId = new Map();
  const caps = (project.textClips || []).filter((c) => c.caption && String(c.text || '').trim());
  if (!caps.length) return byId;
  const spans = [];
  for (const l of videoLayout(project.videoClips || [])) {
    if (!l.clip.gap && l.clip.mediaId) spans.push({ id: l.clip.mediaId, start: l.start, end: l.end });
  }
  for (const c of project.audioClips || []) {
    if (c.mediaId) spans.push({ id: c.mediaId, start: c.start || 0, end: (c.start || 0) + freeLen('audio', c) });
  }
  for (const c of project.overlayClips || []) {
    if (c.mediaId) spans.push({ id: c.mediaId, start: c.start || 0, end: (c.start || 0) + freeLen('overlay', c) });
  }
  if (!spans.length) return byId;
  const acc = new Map();
  for (const cap of caps) {
    const s = cap.start, e = cap.start + cap.duration;
    for (const sp of spans) {
      if (sp.start < e && s < sp.end) {
        if (!acc.has(sp.id)) acc.set(sp.id, []);
        acc.get(sp.id).push(cap.text);
      }
    }
  }
  for (const [id, texts] of acc) byId.set(id, texts.join(' '));
  return byId;
}

// Sort orders for the Media grid. 'added' is the default and preserves the
// old grid order exactly: newest first, and items imported before addedAt
// existed (no stamp) keep their registry order after the dated ones.
export const MEDIA_SORTS = ['added', 'name', 'duration'];

export function sortMedia(media, sort) {
  const list = media.map((m, i) => ({ m, i }));
  if (sort === 'name') {
    list.sort((a, b) => normSearch(a.m.name).localeCompare(normSearch(b.m.name)) || a.i - b.i);
  } else if (sort === 'duration') {
    list.sort((a, b) => (b.m.duration || 0) - (a.m.duration || 0) || a.i - b.i);
  } else {
    list.sort((a, b) => {
      const ad = a.m.addedAt, bd = b.m.addedAt;
      if (ad == null && bd == null) return a.i - b.i;
      if (ad == null) return 1;
      if (bd == null) return -1;
      return bd - ad || a.i - b.i;
    });
  }
  return list.map((x) => x.m);
}
