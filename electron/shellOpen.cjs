// Which files the renderer may ask the OS to open or reveal (P2-30).
// The old handlers only checked "the path exists" — a renderer (or a
// compromised webview) could ask the OS to open any file on disk, including
// an executable download or the app's own settings (API keys). The rules:
//   - show (reveal in the file manager): any existing regular file, except
//     under system roots. Revealing never executes or displays the file, so
//     the app's own log folder under userData stays reachable on purpose.
//   - open (launch the default handler — can execute): only a known-safe
//     extension, with no execute bits, never under a system root, and never
//     under the app's userData dir (settings/keys live there; the only
//     userData files the UI ever surfaces are logs, and those go through
//     show, not open).
// Pure module (fs/path only) so the rules are unit-testable from plain Node.
const fs = require('fs');
const path = require('path');

const OPEN_EXTS = new Set([
  '.mp4', '.mov', '.webm', '.gif', '.mkv', '.avi', // video
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', // audio
  '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.svg', // images
  '.pdf', '.txt', '.log', '.md', '.srt', '.vtt', '.ass', // documents
  '.zip', // project export
]);

const SYSTEM_ROOTS = {
  linux: ['/etc', '/usr', '/bin', '/sbin', '/boot', '/proc', '/sys', '/dev', '/lib', '/lib64', '/var', '/root'],
  darwin: ['/etc', '/usr', '/bin', '/sbin', '/System', '/Library', '/private', '/var'],
  win32: [],
};

function underSystemRoot(real) {
  if (process.platform === 'win32') {
    const windir = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();
    const low = real.toLowerCase();
    return low === windir || low.startsWith(`${windir}\\`)
      || /^(c:\\program files|c:\\program files \(x86\))\\/i.test(low);
  }
  const roots = SYSTEM_ROOTS[process.platform] || SYSTEM_ROOTS.linux;
  return roots.some((r) => real === r || real.startsWith(`${r}/`));
}

// Resolve symlinks and confirm the path is an existing regular file; null otherwise.
function existingFile(file) {
  if (typeof file !== 'string' || !file) return null;
  let real;
  try { real = fs.realpathSync(file); } catch { return null; }
  try { if (!fs.statSync(real).isFile()) return null; } catch { return null; }
  return real;
}

function canShow(file) {
  const real = existingFile(file);
  return !!real && !underSystemRoot(real);
}

function canOpen(file, userDataDir) {
  const real = existingFile(file);
  if (!real || underSystemRoot(real)) return false;
  if (userDataDir) {
    const base = path.resolve(userDataDir);
    if (real === base || real.startsWith(`${base}${path.sep}`)) return false;
  }
  if (!OPEN_EXTS.has(path.extname(real).toLowerCase())) return false;
  try {
    if (fs.statSync(real).mode & 0o111) return false; // never launch an executable bit
  } catch {
    return false;
  }
  return true;
}

module.exports = { canShow, canOpen, OPEN_EXTS };
