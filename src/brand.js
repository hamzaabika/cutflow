// Brand kit: the user's reusable brand — logo files, a palette of colours and a
// font pick — kept at settings level (localStorage), so it is shared by every
// project on this PC. Pure logic; storage is injected for testing, following
// the fx/presets.js and text/userTemplates.js pattern.
//
// What the kit does today (R1): the Brand panel manages the registry, logos can
// be sent to the project from it, and NEW text clips adopt the kit's font and
// primary colour (brandTextPatch, merged under the caller's own patch — a
// template's style always wins). Nothing here is project data: deleting the
// kit never touches a saved project.

export const BRAND_KEY = 'clipcraft.brand';

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function sanitizeColor(c) {
  if (typeof c !== 'string' || !HEX.test(c.trim())) return null;
  let h = c.trim().toLowerCase();
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return h;
}

function sanitizeLogo(l) {
  if (!l || typeof l !== 'object' || typeof l.path !== 'string' || !l.path) return null;
  const name = typeof l.name === 'string' && l.name.trim() ? l.name.trim() : l.path.split(/[\\/]/).pop();
  return { path: l.path, name };
}

export function sanitizeBrand(b) {
  const src = b && typeof b === 'object' ? b : {};
  const logos = (Array.isArray(src.logos) ? src.logos : []).map(sanitizeLogo).filter(Boolean)
    .filter((l, i, arr) => arr.findIndex((x) => x.path === l.path) === i);
  const colors = (Array.isArray(src.colors) ? src.colors : []).map(sanitizeColor).filter(Boolean)
    .filter((c, i, arr) => arr.indexOf(c) === i);
  const color = sanitizeColor(src.color) || '';
  return {
    logos,
    colors,
    font: typeof src.font === 'string' ? src.font : '',
    // The primary colour is only meaningful while it is part of the palette.
    color: color && colors.includes(color) ? color : '',
  };
}

export const emptyBrand = () => ({ logos: [], colors: [], font: '', color: '' });

export function loadBrand(storage) {
  try {
    return sanitizeBrand(JSON.parse((storage || localStorage).getItem(BRAND_KEY) || 'null'));
  } catch { return emptyBrand(); }
}

export function saveBrand(storage, brand) {
  try { (storage || localStorage).setItem(BRAND_KEY, JSON.stringify(sanitizeBrand(brand))); } catch { /* storage full/blocked */ }
}

// The text-clip patch the kit contributes: only the keys the user actually set.
// Empty kit → empty patch → new text clips are exactly what they were before.
export function brandTextPatch(brand) {
  const b = sanitizeBrand(brand);
  return {
    ...(b.font ? { font: b.font } : {}),
    ...(b.color ? { color: b.color } : {}),
  };
}

export function hasBrand(brand) {
  const b = sanitizeBrand(brand);
  return b.logos.length > 0 || b.colors.length > 0 || !!b.font;
}
