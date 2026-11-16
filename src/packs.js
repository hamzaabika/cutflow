// Creative Pack Manager (P2-14): versioned preset packs with an asset
// manifest and safe validation. Pure logic (no fs, no DOM) so the renderer
// and node tests share it; electron/packs.cjs does the disk work.
//
// A pack is one JSON file (.cutflowpack) or a folder with pack.json +
// presets/*.json + assets/*. The manifest:
//
//   { format: 'cutflow-pack', version: 1, name, cutflowVersion, createdAt,
//     description?, presets: [{ kind, id, name, data }], assets: [{ name, sha256, size, data? }] }
//
// Preset kinds: 'text' (a text-clip style patch), 'anim' (an anim in/out/
// combo preset), 'transition' ({ type, duration }), 'effect' (an fx id list),
// 'filter' (a filter look: { variant, intensity?, adjust?, lut? } — the LUT,
// when the variant is 'lut:<file>.cube', rides as a pack asset; see
// src/presets/packBridge.js for the CreativePreset conversion).
// Assets may ride inline as base64 `data` (single-file packs) or as files
// in the pack folder; either way the manifest's sha256 is the truth and a
// missing asset is reported, never silently skipped.
export const PACK_FORMAT = 'cutflow-pack';
export const PACK_VERSION = 1;
export const PACK_EXT = '.cutflowpack';
export const PRESET_KINDS = ['text', 'anim', 'transition', 'effect', 'filter'];
export const MAX_PACK_BYTES = 25 * 1024 * 1024;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_PRESETS = 200;
export const MAX_ASSETS = 100;

export const EXECUTABLE_EXTS = new Set([
  'js', 'mjs', 'cjs', 'exe', 'dll', 'sh', 'bat', 'cmd', 'ps1', 'py', 'rb', 'pl',
  'html', 'htm', 'wasm', 'scr', 'com', 'msi', 'app', 'jar', 'vbs', 'wsf',
]);
// Asset types a pack may carry (images, audio, video, LUTs, fonts).
export const ASSET_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg',
  'mp3', 'wav', 'ogg', 'flac', 'm4a',
  'mp4', 'mov', 'webm',
  'cube', 'ttf', 'otf', 'woff', 'woff2',
]);

const extOf = (name) => String(name).split('.').pop().toLowerCase();
// A safe asset path: a bare file name (or one subfolder deep), no traversal,
// no absolute paths, no backslashes, no drive letters, no NUL.
export function isSafeAssetName(name) {
  if (typeof name !== 'string' || !name || name.length > 200) return false;
  if (name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  if (parts.length > 2 || parts.some((p) => !p || p === '.' || p === '..')) return false;
  return true;
}
export function isExecutableName(name) {
  return EXECUTABLE_EXTS.has(extOf(name));
}
export const isAllowedAssetName = (name) => isSafeAssetName(name) && !isExecutableName(name) && ASSET_EXTS.has(extOf(name));

const ID_RE = /^[a-z0-9][a-z0-9-_]{0,63}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

// One preset entry: { kind, id, name, data }. Returns an error string or null.
export function validatePreset(p, i) {
  if (!p || typeof p !== 'object') return `presets[${i}]: not an object`;
  if (!PRESET_KINDS.includes(p.kind)) return `presets[${i}]: unknown kind ${JSON.stringify(p.kind)}`;
  if (typeof p.id !== 'string' || !ID_RE.test(p.id)) return `presets[${i}]: bad id ${JSON.stringify(p.id)}`;
  if (typeof p.name !== 'string' || !p.name.trim()) return `presets[${i}]: missing name`;
  if (!p.data || typeof p.data !== 'object') return `presets[${i}]: missing data`;
  if (p.kind === 'transition' && typeof p.data.type !== 'string') return `presets[${i}]: transition needs a type`;
  if (p.kind === 'effect' && !Array.isArray(p.data.fx)) return `presets[${i}]: effect needs an fx list`;
  if (p.kind === 'filter') {
    // A filter look: { variant, intensity?, adjust?, lut? }. variant is a
    // filter id or 'lut:<file>.cube'; lut (when set) names the pack asset
    // carrying the .cube — the cross-check in validatePack() requires it.
    if (typeof p.data.variant !== 'string' || !p.data.variant) return `presets[${i}]: filter needs a variant`;
    if (p.data.intensity !== undefined && !(Number.isFinite(p.data.intensity) && p.data.intensity >= 0 && p.data.intensity <= 100)) return `presets[${i}]: filter intensity must be 0-100`;
    if (p.data.adjust !== undefined && (typeof p.data.adjust !== 'object' || Array.isArray(p.data.adjust))) return `presets[${i}]: filter adjust must be an object`;
    if (p.data.lut !== undefined && typeof p.data.lut !== 'string') return `presets[${i}]: filter lut must be an asset name`;
  }
  return null;
}

// Validate a parsed pack manifest (structure + names + sizes). Returns
// { ok, errors, warnings }. Hash/content checks against real bytes happen
// in electron/packs.cjs, which has the files.
export function validatePack(pack) {
  const errors = [];
  const warnings = [];
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['pack is not an object'], warnings };
  if (pack.format !== PACK_FORMAT) errors.push(`format must be ${PACK_FORMAT}`);
  if (pack.version !== PACK_VERSION) errors.push(`version must be ${PACK_VERSION}`);
  if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 100) errors.push('name is missing or too long');
  if (pack.cutflowVersion !== undefined && typeof pack.cutflowVersion !== 'string') errors.push('cutflowVersion must be a string');
  if (!Array.isArray(pack.presets)) errors.push('presets must be an array');
  else {
    if (pack.presets.length > MAX_PRESETS) errors.push(`too many presets (${pack.presets.length} > ${MAX_PRESETS})`);
    const ids = new Set();
    pack.presets.forEach((p, i) => {
      const e = validatePreset(p, i);
      if (e) errors.push(e);
      else if (ids.has(`${p.kind}:${p.id}`)) errors.push(`presets[${i}]: duplicate ${p.kind} id ${p.id}`);
      else ids.add(`${p.kind}:${p.id}`);
    });
  }
  if (pack.assets !== undefined && !Array.isArray(pack.assets)) errors.push('assets must be an array');
  else {
    const assets = pack.assets || [];
    // A filter preset's LUT must ride in the pack: a dangling `lut` ref
    // would install a look that can never render. (The byte-level hash
    // check still happens in electron/packs.cjs on import.)
    if (Array.isArray(pack.presets)) {
      const assetNames = new Set(assets.map((a) => a && a.name));
      pack.presets.forEach((p, i) => {
        if (p && p.kind === 'filter' && typeof p.data?.lut === 'string' && !assetNames.has(p.data.lut)) {
          errors.push(`presets[${i}]: filter LUT asset '${p.data.lut}' is not in the pack`);
        }
      });
    }
    if (assets.length > MAX_ASSETS) errors.push(`too many assets (${assets.length} > ${MAX_ASSETS})`);
    const names = new Set();
    let total = 0;
    assets.forEach((a, i) => {
      if (!a || typeof a !== 'object') { errors.push(`assets[${i}]: not an object`); return; }
      if (!isSafeAssetName(a.name)) { errors.push(`assets[${i}]: unsafe name ${JSON.stringify(a.name)}`); return; }
      if (isExecutableName(a.name)) { errors.push(`assets[${i}]: executable payload rejected (${a.name})`); return; }
      if (!ASSET_EXTS.has(extOf(a.name))) errors.push(`assets[${i}]: unsupported type (${a.name})`);
      if (names.has(a.name)) errors.push(`assets[${i}]: duplicate name ${a.name}`);
      names.add(a.name);
      if (typeof a.sha256 !== 'string' || !SHA_RE.test(a.sha256)) errors.push(`assets[${i}]: bad sha256 for ${a.name}`);
      if (typeof a.size !== 'number' || a.size < 0 || a.size > MAX_ASSET_BYTES) errors.push(`assets[${i}]: bad size for ${a.name}`);
      else total += a.size;
      if (a.data !== undefined && typeof a.data !== 'string') errors.push(`assets[${i}]: inline data must be base64`);
    });
    if (total > MAX_PACK_BYTES) errors.push(`pack too large (${total} bytes > ${MAX_PACK_BYTES})`);
  }
  if (pack.description !== undefined && typeof pack.description !== 'string') errors.push('description must be a string');
  if (!errors.length && !(pack.presets || []).length && !(pack.assets || []).length) warnings.push('pack has no presets and no assets');
  return { ok: errors.length === 0, errors, warnings };
}

// A fresh manifest for export. Presets/assets are validated by the caller.
export function buildManifest({ name, description = '', presets = [], assets = [], cutflowVersion = '' }) {
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: String(name || 'Untitled pack').slice(0, 100),
    cutflowVersion: String(cutflowVersion || ''),
    createdAt: new Date().toISOString(),
    description: String(description || '').slice(0, 500),
    presets,
    assets,
  };
}
