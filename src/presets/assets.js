// Portable preset assets (P2-17): the asset manifest that makes a preset
// file survive a move to another machine. An asset entry names a file a
// preset depends on — a LUT .cube, a font file, or a media file — with the
// relative path inside the pack, a SHA-256 checksum, and the size in bytes.
// Relinking never guesses: an asset resolves only when a candidate file
// exists at the recorded relative path (or under a user-chosen base folder)
// AND its checksum matches; otherwise it is reported missing, and the
// preset still imports — the missing asset is listed, never silently
// substituted (a wrong LUT/font would change the render).

export const ASSET_KINDS = ['lut', 'font', 'media'];

const cleanRelPath = (p) => {
  if (typeof p !== 'string' || !p) return null;
  const norm = p.replace(/\\/g, '/').trim();
  if (!norm || norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) return null;
  const parts = norm.split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) return null;
  if (parts.length > 6) return null;
  return parts.join('/');
};

const isHex64 = (s) => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);

export function sanitizeAsset(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  if (!ASSET_KINDS.includes(a.kind)) return null;
  const name = typeof a.name === 'string' ? a.name.trim() : '';
  if (!name || name.length > 120 || name.includes('/') || name.includes('\\')) return null;
  const relPath = cleanRelPath(a.relPath || a.name);
  if (!relPath) return null;
  const out = { kind: a.kind, name, relPath };
  if (isHex64(a.sha256)) out.sha256 = a.sha256;
  if (Number.isFinite(a.size) && a.size >= 0) out.size = Math.floor(a.size);
  return out;
}

export function sanitizeAssets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  return list.map(sanitizeAsset).filter(Boolean).filter((a) => {
    const k = `${a.kind}:${a.relPath}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 8);
}

// SHA-256 of bytes (Uint8Array / ArrayBuffer / string). Uses WebCrypto where
// available (renderer + Node 18+); falls back to node:crypto in plain Node.
export async function sha256Hex(bytes) {
  const buf = typeof bytes === 'string'
    ? new TextEncoder().encode(bytes)
    : bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

// Build an asset entry for a bundled LUT file (relPath is pack-relative).
export const lutAsset = (file) => sanitizeAsset({ kind: 'lut', name: file, relPath: `luts/${file}` });
// Build an asset entry for a font the preset's style names (no file ships
// with the preset — the font is relinked by family name on import).
export const fontAsset = (family) => (typeof family === 'string' && family.trim()
  ? sanitizeAsset({ kind: 'font', name: family.trim(), relPath: `fonts/${family.trim()}.ttf` }) : null);

// Relink a manifest against a resolver: resolve(asset) -> { path, sha256 } |
// null. A resolver that cannot checksum returns { path } and the entry is
// treated as present-but-unverified. Returns { resolved: [{asset, path}],
// missing: [asset], unverified: [asset] }.
export async function relinkAssets(assets, resolve) {
  const resolved = [];
  const missing = [];
  const unverified = [];
  for (const a of sanitizeAssets(assets)) {
    let hit = null;
    try { hit = await resolve(a); } catch { hit = null; }
    if (!hit || !hit.path) { missing.push(a); continue; }
    if (a.sha256 && hit.sha256 && hit.sha256 !== a.sha256) { missing.push(a); continue; }
    if (a.sha256 && !hit.sha256) unverified.push(a);
    resolved.push({ asset: a, path: hit.path });
  }
  return { resolved, missing, unverified };
}

// A resolver over an in-memory map of relPath -> { path, sha256 } (used by
// tests and by the import UI when the user points at a folder's manifest).
export const mapResolver = (map) => async (asset) => map?.[asset.relPath] || null;
