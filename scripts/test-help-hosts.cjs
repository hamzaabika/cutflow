// P2-30 unit test: the app:openHelp allowlist (electron/main.cjs) must include the
// update-feed hosts, or About's "open in browser" silently no-ops for the feed links.
// Reads the HELP_HOSTS set literal out of main.cjs source (main.cjs needs Electron,
// so it cannot be required from plain Node).
// Usage: node scripts/test-help-hosts.cjs
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8');
const m = src.match(/const HELP_HOSTS = new Set\(\[([^\]]*)\]\)/);
assert.ok(m, 'HELP_HOSTS set not found in main.cjs');
const hosts = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

assert.ok(hosts.includes('clipcrafts.pages.dev'), 'feed host clipcrafts.pages.dev missing from HELP_HOSTS');
assert.ok(hosts.includes('getcutflow.pages.dev'), 'feed host getcutflow.pages.dev missing from HELP_HOSTS');
assert.ok(hosts.includes('github.com'), 'github.com must stay allowlisted');
assert.ok(!hosts.includes('example.com'), 'example.com must NOT be allowlisted');
// The handler's fallthrough is a hard false, not a silent undefined.
assert.ok(/return false;\n\}/.test(src.slice(src.indexOf("ipcMain.handle('app:openHelp'"))), 'openHelp fallthrough must return false');

console.log('HELP HOSTS OK (' + hosts.length + ' hosts)');
