// Caption style packs (P2-43): saved caption looks that apply to ANY
// transcript. A pack is a style patch only — it never carries text, words,
// timing or position in time. Applying a pack to a caption clip changes how
// the words look and move; the transcript data (text, words, start,
// duration) is copied through untouched, so the same pack restyles an
// English, Darija or Arabic transcript identically, and re-applying a
// different pack never loses a word.
//
// Each pack wraps a built-in caption template (src/text/catalog.js) and
// adds the overrides that make it a pack rather than a template pick:
// explicit lineHeight / maxWidth so multi-line captions never overlap, and
// — for the Arabic pack — no uppercasing (Arabic has no case; uppercasing
// Latin product names inside an Arabic line would break the shaping) and
// an Arabic font with word-level highlight (never per-character, which
// would break joins — see src/text/render.js).
import { TEXT_TEMPLATES } from './catalog.js';
import { captureStylePatch } from './userTemplates.js';

export const CAPTION_PACKS = [
  {
    id: 'pack-word-pop', name: 'Word Pop', template: 'cap-hormozi',
    desc: 'Words pop in one by one, the active word in violet.',
    rtlSafe: true, overrides: { lineHeight: 1.15, maxWidth: 0.86 },
  },
  {
    id: 'pack-active-highlight', name: 'Active Highlight', template: 'cap-karaoke',
    desc: 'A karaoke sweep follows the spoken word.',
    rtlSafe: true, overrides: { lineHeight: 1.15, maxWidth: 0.86 },
  },
  {
    id: 'pack-fade-reveal', name: 'Fade / Reveal', template: 'cap-minimal',
    desc: 'Quiet fade-in captions, no pop — for interviews and explainers.',
    rtlSafe: true, overrides: { lineHeight: 1.2, maxWidth: 0.86 },
  },
  {
    id: 'pack-contrast-bubble', name: 'Contrast Bubble', template: 'cap-subtitle',
    desc: 'High-contrast bubble that stays readable over any footage.',
    rtlSafe: true, overrides: { lineHeight: 1.25, maxWidth: 0.86, bubble: 'rounded', bubbleColor: '#000000' },
  },
  {
    id: 'pack-arabic-safe', name: 'Arabic Safe', template: 'cap-arabic-box',
    desc: 'Arabic / Darija captions: Tajawal, word-level highlight, generous line spacing, no uppercasing.',
    rtlSafe: true, overrides: { font: 'tajawal', uppercase: false, italic: false, lineHeight: 1.35, maxWidth: 0.84 },
  },
];

export const captionPackById = (id) => CAPTION_PACKS.find((p) => p.id === id) || null;

// The style patch a pack applies: the wrapped template's style first, the
// pack's overrides on top. Transcript fields are never in a style patch
// (captureStylePatch only keeps CAPTION_STYLE_KEYS), so this is safe to
// spread over any caption clip.
export function captionPackPatch(pack) {
  const p = typeof pack === 'string' ? captionPackById(pack) : pack;
  if (!p) return null;
  const tpl = TEXT_TEMPLATES.find((t) => t.id === p.template);
  const base = tpl ? captureStylePatch(tpl.patch) || {} : {};
  return { ...base, ...(p.overrides || {}) };
}

// Apply a pack to a caption clip: style changes only. The returned clip
// keeps its id, text, words, start, duration, caption flag and source.
export function applyCaptionPack(clip, packId) {
  if (!clip || typeof clip !== 'object') return null;
  const patch = captionPackPatch(packId);
  if (!patch) return null;
  const out = { ...clip, ...patch };
  out.template = typeof packId === 'string' ? captionPackById(packId)?.template || clip.template : packId.template;
  return out;
}

// True when a pack is safe for Arabic text: word-level (never character)
// animation, no uppercasing, an Arabic font, and line spacing that keeps
// stacked lines apart.
export function packIsArabicSafe(packId) {
  const p = typeof packId === 'string' ? captionPackById(packId) : packId;
  if (!p) return false;
  const patch = captionPackPatch(p);
  if (!patch) return false;
  const animIn = patch.animIn?.id || '';
  const charAnims = ['typewriter', 'charSlideUp', 'charFlicker', 'decode'];
  if (charAnims.includes(animIn)) return false;
  if (patch.uppercase) return false;
  if ((patch.lineHeight || 0) < 1.15) return false;
  return p.rtlSafe === true;
}
