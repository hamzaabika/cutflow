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

// A project whose media paths are relative (a project ZIP's bundled JSON
// writes assets/<basename>): resolve them against the project file's own
// folder so the media is found on the receiving machine. Absolute paths
// pass through untouched; a relative path that still does not resolve is
// left as-is and surfaces as missing through the relink flow.
function resolveRelativeMedia(projectJson, baseDir) {
  try {
    const p = JSON.parse(projectJson);
    if (!baseDir || !Array.isArray(p.media)) return projectJson;
    let changed = false;
    p.media = p.media.map((m) => {
      if (!m || typeof m.path !== 'string' || !m.path || path.isAbsolute(m.path)) return m;
      const abs = path.resolve(baseDir, m.path);
      if (abs === m.path) return m;
      changed = true;
      return { ...m, path: abs };
    });
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

// P1-54 — packaged-project report: a project ZIP's bundled JSON writes its
// media paths relative to the project file (assets/<basename>), while a
// project saved on this PC writes absolute paths. A project is "packaged"
// when ANY media path is relative — that is the signature the open-time
// report uses to say "this came from a package". Pure (no disk access), so
// the test suite can pin it without the main process.
function isPackagedProject(projectJson) {
  try {
    const p = JSON.parse(projectJson);
    return Array.isArray(p.media) && p.media.some((m) => m && typeof m.path === 'string' && m.path && !path.isAbsolute(m.path));
  } catch {
    return false;
  }
}

// ---- Project schema versions + migrations (FB-19 / P1-27). ----
// Projects saved before this change carry no schemaVersion at all (v0);
// the current schema is v1. Old projects must OPEN correctly under the
// current schema — silently dropping a field the editor now expects, or
// crashing on a shape it no longer writes, is a data-loss bug, not a
// cosmetic one. migrateProject is pure (no disk access) so the suite pins
// it without the main process:
//   migrateProject(json) -> { json, migrated, fromVersion, toVersion,
//                             changes, newer }
// - Unparseable input passes through unchanged (the caller — draftsafety's
//   fallback chain — decides what a corrupt file means, not the migrator).
// - A version NEWER than this build also passes through unchanged with
//   newer:true: a future build's project must not be silently rewritten
//   by an older one.
// - v0 -> v1: stamp schemaVersion 1; ensure every clip/media array the
//   editor iterates exists; fill clip defaults the editor assumes
//   (speed 1, volume 1, filter 'none', muted false); normalise the legacy
//   string transition ("dissolve") to { type, duration }; derive
//   width/height from ratio when absent (16:9 -> 1920x1080, 9:16 ->
//   1080x1920, 1:1 -> 1080x1080, else 1920x1080); fps defaults to 30.
//   Nothing else is rewritten: media paths, clip timings, effect settings
//   and text content pass through byte-for-byte in meaning.
const PROJECT_SCHEMA_VERSION = 1;
const CLIP_ARRAYS = ['videoClips', 'overlayClips', 'audioClips', 'stickerClips', 'effectClips', 'textClips'];
const RATIO_SIZE = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:3': [1440, 1080], '21:9': [2560, 1080] };
function migrateProject(projectJson) {
  let p;
  try { p = JSON.parse(projectJson); } catch { return { json: projectJson, migrated: false, fromVersion: null, toVersion: PROJECT_SCHEMA_VERSION, changes: ['unparseable: left unchanged'], newer: false }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { json: projectJson, migrated: false, fromVersion: null, toVersion: PROJECT_SCHEMA_VERSION, changes: ['not an object: left unchanged'], newer: false };
  const fromVersion = Number.isInteger(p.schemaVersion) ? p.schemaVersion : 0;
  if (fromVersion > PROJECT_SCHEMA_VERSION) return { json: projectJson, migrated: false, fromVersion, toVersion: PROJECT_SCHEMA_VERSION, changes: ['newer than this build: left unchanged'], newer: true };
  if (fromVersion === PROJECT_SCHEMA_VERSION) return { json: projectJson, migrated: false, fromVersion, toVersion: PROJECT_SCHEMA_VERSION, changes: [], newer: false };
  const changes = [];
  // v0 -> v1
  if (!Array.isArray(p.media)) { p.media = []; changes.push('media[] created'); }
  for (const track of CLIP_ARRAYS) {
    if (!Array.isArray(p[track])) { p[track] = []; changes.push(`${track}[] created`); }
  }
  for (const track of ['videoClips', 'overlayClips', 'audioClips']) {
    for (const c of p[track]) {
      if (!c || typeof c !== 'object') continue;
      if (c.speed === undefined) { c.speed = 1; changes.push(`clip ${c.id || '?'}: speed defaulted to 1`); }
      if (c.volume === undefined) { c.volume = 1; changes.push(`clip ${c.id || '?'}: volume defaulted to 1`); }
      if (c.muted === undefined) { c.muted = false; changes.push(`clip ${c.id || '?'}: muted defaulted to false`); }
      if (track !== 'audioClips' && c.filter === undefined) { c.filter = 'none'; changes.push(`clip ${c.id || '?'}: filter defaulted to 'none'`); }
      if (typeof c.transition === 'string') {
        c.transition = { type: c.transition, duration: 0.5 };
        changes.push(`clip ${c.id || '?'}: string transition normalised to { type, duration }`);
      }
    }
  }
  if (p.fps === undefined) { p.fps = 30; changes.push('fps defaulted to 30'); }
  if (p.width === undefined || p.height === undefined) {
    const [w, h] = RATIO_SIZE[p.ratio] || [1920, 1080];
    if (p.width === undefined) p.width = w;
    if (p.height === undefined) p.height = h;
    changes.push(`size derived from ratio ${p.ratio || '16:9'} -> ${p.width}x${p.height}`);
  }
  if (typeof p.name !== 'string' || !p.name) { p.name = 'Untitled'; changes.push('name defaulted to Untitled'); }
  if (p.background === undefined) { p.background = '#000000'; changes.push('background defaulted to #000000'); }
  p.schemaVersion = PROJECT_SCHEMA_VERSION;
  changes.unshift(`schema v${fromVersion} -> v${PROJECT_SCHEMA_VERSION}`);
  return { json: JSON.stringify(p), migrated: true, fromVersion, toVersion: PROJECT_SCHEMA_VERSION, changes, newer: false };
}

module.exports = { checkGenerated, refreshSizes, findMissingMedia, scanMediaFolder, resolveRelativeMedia, isPackagedProject, migrateProject, PROJECT_SCHEMA_VERSION };

