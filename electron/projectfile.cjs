const fs = require('fs');
const path = require('path');

// Generated files (thumbnails, waveform, preview proxy) recorded in a saved project may be gone (cache cleaned,
// another PC): drop them so they are made again, instead of the player showing black without sound.
const GENERATED = { thumb: ['thumb', 'thumbCount', 'thumbInterval', 'thumbW', 'thumbH'], wave: ['wave'], proxy: ['proxy'] };
// cacheDir: where generated files live now; a file moved there (older versions used another folder) is found again.
function checkGenerated(projectJson, cacheDir) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    p.media = (p.media || []).map((m) => {
      const out = { ...m };
      for (const [key, fields] of Object.entries(GENERATED)) {
        if (!out[key] || fs.existsSync(out[key])) continue;
        const moved = cacheDir && path.join(cacheDir, path.basename(out[key]));
        if (moved && fs.existsSync(moved)) {
          out[key] = moved;
          changed = true;
        } else {
          fields.forEach((f) => delete out[f]);
          if (key === 'proxy') out.optimizing = true;
          changed = true;
        }
      }
      return out;
    });
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}

// Projects saved before the rotation fix have the stored (not turned) size of phone videos: probe those again.
async function refreshSizes(projectJson, probe) {
  try {
    const p = JSON.parse(projectJson);
    let changed = false;
    for (const m of p.media || []) {
      if (m.type !== 'video' || (m.rotation !== undefined && m.hdr !== undefined && m.colorSpace !== undefined) || !fs.existsSync(m.path)) continue;
      try {
        const info = await probe(m.path);
        changed = true;
        Object.assign(m, { width: info.width, height: info.height, rotation: info.rotation, hdr: info.hdr, colorSpace: info.colorSpace, colorPrimaries: info.colorPrimaries, colorTransfer: info.colorTransfer, colorRange: info.colorRange });
      } catch {
        // keep what the project says
      }
    }
    return changed ? JSON.stringify(p) : projectJson;
  } catch {
    return projectJson;
  }
}

// Source media whose file is gone (moved, renamed, on an unplugged drive): the entries
// stay in the project (clips reference them by id), but every frame would render black
// until the user points the project at the file's new home — the relink flow. Returns
// one record per missing item: { id, name, path, type, duration, width, height } —
// duration/size ride along so a folder scan can verify a same-name candidate really
// is the same media before anything is repointed.
function findMissingMedia(projectJson) {
  try {
    const p = JSON.parse(projectJson);
    return (p.media || [])
      .filter((m) => m && typeof m.path === 'string' && m.path && !fs.existsSync(m.path))
      .map((m) => ({
        id: m.id,
        name: m.name || path.basename(m.path),
        path: m.path,
        type: m.type || '',
        duration: m.duration || 0,
        width: m.width || 0,
        height: m.height || 0,
      }));
  } catch {
    return [];
  }
}

// Bounded recursive scan of a folder the user picked for relink: maps each wanted
// basename (lowercased) to the candidate paths found. Depth/entry bounds keep a
// careless pick (a whole drive) from walking forever; unreadable folders are skipped.
function scanMediaFolder(rootDir, wantedNames, opts = {}) {
  const maxDepth = opts.maxDepth ?? 6;
  const maxEntries = opts.maxEntries ?? 20000;
  const wanted = new Set((wantedNames || []).map((n) => String(n).toLowerCase()));
  const found = new Map();
  let seen = 0;
  const walk = (dir, depth) => {
    if (depth > maxDepth || seen >= maxEntries) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= maxEntries) return;
      seen += 1;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) walk(full, depth + 1);
      } else if (e.isFile() && wanted.has(e.name.toLowerCase())) {
        if (!found.has(e.name.toLowerCase())) found.set(e.name.toLowerCase(), []);
        found.get(e.name.toLowerCase()).push(full);
      }
    }
  };
  if (rootDir) walk(rootDir, 0);
  return found;
}

module.exports = { checkGenerated, refreshSizes, findMissingMedia, scanMediaFolder };
