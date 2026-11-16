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
//
// P2-40: the kit also carries intro / outro clip references, and the whole
// kit travels as a versioned brand pack (see serializeBrandPack): fonts,
// colours, logos and intro/outro resolve through an asset manifest with
// relative paths + SHA-256, so a pack imported on a clean install relinks
// what is there and reports what is missing instead of silently substituting.
import { sanitizeAssets, relinkAssets } from './presets/assets.js';

export const BRAND_KEY = 'clipcraft.brand';
export const BRAND_PACK_KIND = 'cutflow.brand-pack';
export const BRAND_PACK_SCHEMA_VERSION = 1;

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

// An intro / outro reference: a media file (video or image) the user places
// at the start / end of a project, plus its duration when known.
function sanitizeMediaRef(r) {
  if (!r || typeof r !== 'object' || typeof r.path !== 'string' || !r.path) return null;
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : r.path.split(/[\\/]/).pop();
  const out = { path: r.path, name };
  if (Number.isFinite(Number(r.duration)) && Number(r.duration) > 0) out.duration = Number(r.duration);
  return out;
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
    intro: sanitizeMediaRef(src.intro),
    outro: sanitizeMediaRef(src.outro),
  };
}

export const emptyBrand = () => ({ logos: [], colors: [], font: '', color: '', intro: null, outro: null });

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
  return b.logos.length > 0 || b.colors.length > 0 || !!b.font || !!b.intro || !!b.outro;
}

// --- Brand pack (P2-40): the versioned, portable form of a kit -------------
// A pack file is { kind: 'cutflow.brand-pack', schemaVersion: 1, brand, assets }.
// `brand` keeps absolute paths as recorded on the exporting machine; `assets`
// is the manifest that relinks them on import: each logo / intro / outro
// becomes a media asset with a pack-relative path (logos/<name>,
// intro/<name>, outro/<name>) and, when the exporter could hash the file,
// its SHA-256. A font travels as a font asset by family name.

export function brandPackAssets(brand, hashes = {}) {
  const b = sanitizeBrand(brand);
  const assets = [];
  for (const l of b.logos) assets.push({ kind: 'media', name: l.name, relPath: `logos/${l.name}`, ...(hashes[l.path] ? { sha256: hashes[l.path] } : {}) });
  if (b.intro) assets.push({ kind: 'media', name: b.intro.name, relPath: `intro/${b.intro.name}`, ...(hashes[b.intro.path] ? { sha256: hashes[b.intro.path] } : {}) });
  if (b.outro) assets.push({ kind: 'media', name: b.outro.name, relPath: `outro/${b.outro.name}`, ...(hashes[b.outro.path] ? { sha256: hashes[b.outro.path] } : {}) });
  if (b.font) assets.push({ kind: 'font', name: b.font, relPath: `fonts/${b.font}.ttf` });
  return sanitizeAssets(assets);
}

export function serializeBrandPack(brand, hashes = {}) {
  const b = sanitizeBrand(brand);
  return JSON.stringify({ kind: BRAND_PACK_KIND, schemaVersion: BRAND_PACK_SCHEMA_VERSION, brand: b, assets: brandPackAssets(b, hashes) }, null, 2);
}

// Parse pack file text: { brand, assets, errors }. A newer schemaVersion is
// a hard error; invalid entries are reported, never thrown.
export function parseBrandPack(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { brand: null, assets: [], errors: [`invalid JSON: ${e.message}`] }; }
  const errors = [];
  if (data?.kind !== BRAND_PACK_KIND) errors.push(`kind must be '${BRAND_PACK_KIND}'`);
  if (data?.schemaVersion !== BRAND_PACK_SCHEMA_VERSION) {
    errors.push(typeof data?.schemaVersion === 'number' && data.schemaVersion > BRAND_PACK_SCHEMA_VERSION
      ? `schemaVersion ${data.schemaVersion} is newer than supported ${BRAND_PACK_SCHEMA_VERSION}`
      : `schemaVersion must be ${BRAND_PACK_SCHEMA_VERSION}`);
  }
  if (errors.length) return { brand: null, assets: [], errors };
  return { brand: sanitizeBrand(data.brand), assets: sanitizeAssets(data.assets), errors: [] };
}

// Relink an imported pack against a resolver (see relinkAssets): resolve(asset)
// -> { path, sha256 } | null. Media assets resolve to the path the resolver
// found; a font resolves by family name. Returns { brand, missing, unverified }:
// the brand with resolved paths swapped in, and the assets that could not be
// found (those references stay as recorded, listed for the user to repair).
export async function relinkBrandPack(pack, resolve) {
  const { resolved, missing, unverified } = await relinkAssets(pack.assets || [], resolve);
  const byRel = new Map(resolved.map(({ asset, path }) => [asset.relPath, path]));
  const brand = sanitizeBrand(pack.brand);
  const relinkedLogos = brand.logos.map((l) => {
    const p = byRel.get(`logos/${l.name}`);
    return p ? { ...l, path: p } : l;
  });
  const relink = (ref, dir) => (ref && byRel.get(`${dir}/${ref.name}`) ? { ...ref, path: byRel.get(`${dir}/${ref.name}`) } : ref);
  return {
    brand: { ...brand, logos: relinkedLogos, intro: relink(brand.intro, 'intro'), outro: relink(brand.outro, 'outro') },
    missing,
    unverified,
  };
}
