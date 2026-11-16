// P2-30 unit test: shell:open / shell:show path validation (electron/shellOpen.cjs).
// Legitimate files (export outputs, logs) pass; executables, unknown extensions,
// system paths, symlinks escaping to them, and the app's own userData (for open)
// are refused. Usage: node scripts/test-shell-open.cjs
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canShow, canOpen } = require('../electron/shellOpen.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-shell-'));
const userData = path.join(tmp, 'userData');
fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
const mk = (rel, mode = 0o644) => {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'x');
  fs.chmodSync(f, mode);
  return f;
};
const mp4 = mk('Downloads/export.mp4');
const zip = mk('Downloads/project.zip');
const log = mk('userData/logs/crash.log');
const settings = mk('userData/settings.json');
const sh = mk('Downloads/evil.sh', 0o755);
const deb = mk('Downloads/evil.deb', 0o755);
const exe = mk('Downloads/evil.exe');
const txt = mk('Downloads/note.txt');
const link = path.join(tmp, 'Downloads', 'link.mp4');
fs.symlinkSync('/etc/passwd', link);

assert.equal(canOpen(mp4, userData), true, 'mp4 export opens');
assert.equal(canOpen(zip, userData), true, 'zip export opens');
assert.equal(canOpen(txt, userData), true, 'txt opens');
assert.equal(canOpen(sh, userData), false, 'executable .sh refused');
assert.equal(canOpen(deb, userData), false, 'executable .deb refused');
assert.equal(canOpen(exe, userData), false, 'unknown extension refused');
assert.equal(canOpen(settings, userData), false, 'settings.json under userData refused for open');
assert.equal(canOpen(log, userData), false, 'userData log refused for open (logs go through show)');
assert.equal(canOpen('/etc/passwd', userData), false, 'system file refused');
assert.equal(canOpen(link, userData), false, 'symlink escaping to /etc refused');
assert.equal(canOpen(path.join(tmp, 'missing.mp4'), userData), false, 'missing file refused');
assert.equal(canOpen(null, userData), false, 'non-string refused');

assert.equal(canShow(mp4, userData), true, 'mp4 reveals');
assert.equal(canShow(log, userData), true, 'userData log reveals (the show-log flow)');
assert.equal(canShow(settings, userData), true, 'show only reveals the folder, so settings.json reveals');
assert.equal(canShow('/etc/passwd', userData), false, 'system file does not reveal');
assert.equal(canShow(link, userData), false, 'symlink escaping to /etc does not reveal');

console.log('SHELL OPEN OK');
