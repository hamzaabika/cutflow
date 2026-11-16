// Missing-font check for the export QC (P1-57). The renderer resolves the
// font ids a project's text clips actually use — the same resolution the
// renderer does at draw time — and reports the ids this PC does not have.
// A clip with no font field falls back to its template's font; a duo clip
// (Neon Pop Duo) resolves its own two line fonts plus the two RTL fonts.
import { fontKnown } from '../fonts.js';
import { TEXT_TEMPLATES } from '../text/catalog.js';
import { resolveDuo } from '../text/duo.js';

const BY_ID = Object.fromEntries((TEXT_TEMPLATES || []).map((t) => [t.id, t]));

export function fontIdsOfClip(clip) {
  const ids = [];
  if (clip.font) ids.push(clip.font);
  const tpl = clip.template && BY_ID[clip.template];
  if (tpl && tpl.patch && tpl.patch.font) ids.push(tpl.patch.font);
  if (clip.duo) {
    const d = resolveDuo(clip.duo);
    if (d.line1 && d.line1.font) ids.push(d.line1.font);
    if (d.line2 && d.line2.font) ids.push(d.line2.font);
    if (d.rtl) {
      if (d.rtl.font1) ids.push(d.rtl.font1);
      if (d.rtl.font2) ids.push(d.rtl.font2);
    }
  }
  return [...new Set(ids)];
}

export function missingFontsOf(project) {
  const ids = new Set();
  for (const clip of project.textClips || []) {
    for (const id of fontIdsOfClip(clip)) ids.add(id);
  }
  return [...ids].filter((id) => !fontKnown(id));
}
