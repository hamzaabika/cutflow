// FB-18 (P1-24) — human-readable export errors.
//
// Export failures used to surface raw ffmpeg text as the primary message:
// "FFmpeg failed (code 1):\n<3000 chars of log>" (electron/ffmpeg.cjs).
// Skipped-clip reporting is done (P0-01); this finishes the item: every
// failure is classified into a stable code, the failing clip is identified
// when the log names its file, and the raw log is kept — behind a details
// toggle in the tray, never as the primary message.
//
// The main process returns { code, clipName, raw } (no localised strings —
// the renderer owns i18n and maps `code` to `exportErr.<code>`). The
// classifier is pure, so the suite pins it without Electron.
//
// Signature table (matched against the ffmpeg log + message, in order —
// the first match wins; more specific failures first):
//   diskFull        — No space left / disk full / ENOSPC
//   permission      — Permission denied / EACCES / operation not permitted
//   missingInput    — No such file / Invalid data found when processing input
//   badDimensions   — not divisible by 2 / invalid dimensions / Invalid argument
//                     naming a size
//   encoderMissing  — Unknown encoder / codec not found / No encoder
//   outOfMemory     — Cannot allocate memory / Out of memory
//   unsupportedCodec— Invalid data / unsupported codec / could not find tag
//   interrupted     — Broken pipe / killed by signal (the encode died
//                     mid-flight; distinct from a user cancel, which never
//                     reaches this classifier)
//   unknown         — anything else; the raw log is the only detail, and the
//                     tray says so plainly instead of dressing it up.
const path = require('path');

const SIGNATURES = [
  { code: 'diskFull', re: /no space left|disk full|enospc/i },
  { code: 'permission', re: /permission denied|eacces|operation not permitted/i },
  { code: 'missingInput', re: /no such file or directory|invalid data found when processing input|could not find .*\.mp4|no such file/i },
  { code: 'badDimensions', re: /not divisible by 2|invalid.*dimension|width.*not.*divisible|height.*not.*divisible/i },
  { code: 'encoderMissing', re: /unknown encoder|codec .* not found|no encoder|encoder .* not found/i },
  { code: 'outOfMemory', re: /cannot allocate memory|out of memory|failed to allocate/i },
  { code: 'unsupportedCodec', re: /unsupported codec|could not find tag|invalid data found/i },
  { code: 'interrupted', re: /broken pipe|killed|terminated|signal 9|signal 15/i },
];

function allClips(project) {
  if (!project || typeof project !== 'object') return [];
  const out = [];
  for (const track of ['videoClips', 'overlayClips', 'audioClips', 'stickerClips', 'textClips']) {
    for (const c of project[track] || []) if (c && typeof c === 'object') out.push(c);
  }
  return out;
}

// The failing clip: the log usually names the input file it choked on.
// Match a media basename (or full path) in the log, then the clip that uses
// that media. Returns { clipName, clipId } or nulls when nothing matches —
// a missing identification is reported as "unknown clip", never guessed.
function identifyClip(log, project) {
  const text = String(log || '');
  if (!text || !project) return { clipName: null, clipId: null };
  const media = Array.isArray(project.media) ? project.media : [];
  for (const m of media) {
    if (!m || typeof m.path !== 'string' || !m.path) continue;
    const base = path.basename(m.path);
    if (base && text.includes(base)) {
      const clip = allClips(project).find((c) => c.mediaId === m.id);
      return { clipName: m.name || base, clipId: clip ? clip.id : null };
    }
    if (text.includes(m.path)) {
      const clip = allClips(project).find((c) => c.mediaId === m.id);
      return { clipName: m.name || base, clipId: clip ? clip.id : null };
    }
  }
  return { clipName: null, clipId: null };
}

function humanizeExportError({ message = '', log = '', project = null } = {}) {
  const text = `${message}\n${log}`;
  const sig = SIGNATURES.find((s) => s.re.test(text));
  const { clipName, clipId } = identifyClip(text, project);
  return {
    code: sig ? sig.code : 'unknown',
    clipName,
    clipId,
    raw: String(message || log || 'Export failed.').slice(0, 3000),
  };
}

// Attach the classification to an Error in place (ffmpeg.cjs reject sites
// and the main-process export handlers). The message stays the raw text —
// the renderer replaces it with the human string when a code is present.
function attachExportError(err, { log = '', project = null } = {}) {
  if (!err || typeof err !== 'object') return err;
  const h = humanizeExportError({ message: err.message || '', log, project });
  err.exportCode = h.code;
  err.exportClip = h.clipName;
  err.exportClipId = h.clipId;
  err.exportRaw = h.raw;
  return err;
}

module.exports = { SIGNATURES, humanizeExportError, attachExportError, identifyClip };
