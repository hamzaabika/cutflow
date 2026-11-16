// Filter looks <-> .cutflowpack bridge (B-F10): the portable, versioned
// home for filter-look presets.
//
// The legacy filter presets (src/fx/presets.js, localStorage-only, LUTs
// excluded) and the v1 CreativePresets (src/presets/, portable as .json
// files with LUT asset relinking) both predate packs. This bridge puts
// filter-target CreativePresets onto .cutflowpack v1 (src/packs.js), which
// is the versioned, hash-checked, shareable format:
//   CreativePreset { target:'filter', variant, params:{intensity, adjust},
//                    assets:[{kind:'lut', name, relPath}] }
//     <-> pack preset { kind:'filter', id, name,
//                       data:{ variant, intensity, adjust, lut? } }
//         + pack asset { name, sha256, size, data? } for the .cube bytes.
//
// LUT bytes are supplied by the caller (the Pack Manager reads them with
// window.api.readLut); this module never touches the disk. A preset whose
// LUT bytes are missing is still convertible, but the pack it lands in
// fails validatePack — a pack must be self-contained, so a dangling LUT ref
// can never ship. Pure logic, shared by the renderer and node tests.
import { buildManifest, validatePack } from '../packs.js';
import { lutAsset } from './assets.js';
import { newCreativePreset, sanitizeCreativePreset } from './schema.js';

const slug = (s) => String(s || 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'preset';

// A filter-target CreativePreset -> a pack 'filter' preset entry, or null
// when the preset is not a filter look. `assetBlobs` maps a LUT file name to
// { sha256, size, data? } (base64) for the pack asset list; the caller
// collects them with exportFilterPresetsToPackAssets().
export function creativePresetToPackPreset(p, assetBlobs = {}) {
  if (!p || p.target !== 'filter' || typeof p.variant !== 'string' || !p.variant) return null;
  const lut = typeof p.variant === 'string' && p.variant.startsWith('lut:') ? p.variant.slice(4) : null;
  const data = {
    variant: p.variant,
    intensity: Number.isFinite(p.params?.intensity) ? p.params.intensity : 100,
    adjust: p.params?.adjust && typeof p.params.adjust === 'object' ? { ...p.params.adjust } : {},
  };
  if (lut) data.lut = lut;
  return { kind: 'filter', id: slug(p.name), name: p.name, data };
}

// The pack asset entries a list of filter presets needs. `readLut` is an
// async (fileName) -> { text } | { error } (window.api.readLut in the app);
// returns { assets, skipped } — a preset whose LUT cannot be read is
// skipped, never exported dangling (its name lands in `skipped`).
export async function collectFilterPackAssets(presets, readLut, sha256Hex) {
  const assets = [];
  const skipped = [];
  const seen = new Set();
  for (const p of presets || []) {
    if (!p || p.target !== 'filter' || typeof p.variant !== 'string') continue;
    if (!p.variant.startsWith('lut:')) continue;
    const file = p.variant.slice(4);
    if (seen.has(file)) continue;
    seen.add(file);
    const res = await readLut({ bundled: file });
    if (!res || res.error || typeof res.text !== 'string') { skipped.push(p.name); continue; }
    const bytes = new TextEncoder().encode(res.text);
    // Base64 without Buffer (the renderer has no node Buffer): chunked so a
    // ~1 MB .cube does not blow the argument stack.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    assets.push({
      name: file,
      sha256: await sha256Hex(bytes),
      size: bytes.length,
      data: btoa(binary),
    });
  }
  return { assets, skipped };
}

// A pack 'filter' preset entry -> a CreativePreset, or null. `packAssets`
// is the pack's asset list (names only are needed): a preset whose LUT is
// not among them is still converted, but reported in `missingLuts` by the
// caller — the installed preset keeps its asset entry, and the existing
// relink flow (src/presets/assets.js) reports it missing, never silently
// substitutes another file.
export function packPresetToCreativePreset(entry) {
  if (!entry || entry.kind !== 'filter' || !entry.data || typeof entry.data.variant !== 'string') return null;
  const assets = [];
  if (typeof entry.data.lut === 'string' && entry.data.lut) {
    const a = lutAsset(entry.data.lut);
    if (a) assets.push(a);
  }
  return sanitizeCreativePreset(newCreativePreset({
    name: entry.name,
    target: 'filter',
    variant: entry.data.variant,
    params: {
      intensity: Number.isFinite(entry.data.intensity) ? entry.data.intensity : 100,
      adjust: entry.data.adjust && typeof entry.data.adjust === 'object' ? { ...entry.data.adjust } : {},
    },
    assets: assets.length ? assets : undefined,
    source: 'user',
  }));
}

// Whole-pack conversion: a parsed .cutflowpack manifest -> the filter looks
// it carries, as CreativePresets. Returns { presets, errors, missingLuts }.
// A manifest that fails validatePack converts nothing (errors lists why).
export function importFilterPresetsFromPack(manifest) {
  const v = validatePack(manifest);
  if (!v.ok) return { presets: [], errors: v.errors, missingLuts: [] };
  const assetNames = new Set((manifest.assets || []).map((a) => a && a.name));
  const presets = [];
  const errors = [];
  const missingLuts = [];
  for (const entry of manifest.presets || []) {
    if (entry.kind !== 'filter') continue;
    const cp = packPresetToCreativePreset(entry);
    if (!cp) { errors.push(`filter preset '${entry.name || entry.id}': cannot convert`); continue; }
    if (typeof entry.data?.lut === 'string' && entry.data.lut && !assetNames.has(entry.data.lut)) missingLuts.push(entry.data.lut);
    presets.push(cp);
  }
  return { presets, errors, missingLuts };
}

// Whole-pack conversion the other way: filter-target CreativePresets ->
// a .cutflowpack v1 manifest. `assetBlobs` maps LUT file name to
// { sha256, size, data? }; presets whose LUT has no blob are left out and
// named in `skipped`, so the manifest always validates.
export function exportFilterPresetsToPack(list, { name = 'Filter looks', assetBlobs = {} } = {}) {
  const presets = [];
  const assets = [];
  const skipped = [];
  const seenAssets = new Set();
  for (const p of list || []) {
    if (!p || p.target !== 'filter') continue;
    const entry = creativePresetToPackPreset(p, assetBlobs);
    if (!entry) { skipped.push(p.name); continue; }
    if (entry.data.lut) {
      const blob = assetBlobs[entry.data.lut];
      if (!blob) { skipped.push(p.name); continue; }
      if (!seenAssets.has(entry.data.lut)) {
        seenAssets.add(entry.data.lut);
        assets.push({ name: entry.data.lut, sha256: blob.sha256, size: blob.size, ...(blob.data ? { data: blob.data } : {}) });
      }
    }
    presets.push(entry);
  }
  return { manifest: buildManifest({ name, presets, assets }), skipped };
}
