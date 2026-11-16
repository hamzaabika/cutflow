// Project Backups (10/10 step 4, Filmora merge row 10): the timed auto-backup
// cadence over the S7 version store + the Backups restore browser. The store
// (electron/versions.cjs) is driven with an injected clock, exactly the calls
// the versions:autoBackup IPC makes (source 'auto-backup', never forced):
//
//   1. A cadence tick records a snapshot; a tick inside the throttle window
//      with changed content is skipped (the cadence is a timeline, not a
//      snapshot per tick); a tick after the window records again.
//   2. Unchanged content never duplicates, at any tick.
//   3. An explicit save inside the window still records (force beats throttle).
//   4. A recorded backup reads back byte-identical — the restore round-trip
//      the Backups browser performs (list -> read -> load).
//   5. Wiring: the IPC, the preload bridge, the renderer's 5-minute cadence
//      and the browser's labels are all in place (source assertions).
// Usage: node scripts/test-backups.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listVersions, recordVersion, readVersion, MIN_INTERVAL } = require('../electron/versions.cjs');

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-backups-'));
const root = path.join(dir, 'versions');
const ID = 'proj-backups';
const doc = (name) => JSON.stringify({ id: ID, name, videoClips: [], media: [] });
const tick = (json, now) => recordVersion(root, ID, json, { source: 'auto-backup', boundFile: null, force: false, now });

const T0 = 1_700_000_000_000;

// ---- 1+2. The cadence ---------------------------------------------------------
{
  const first = tick(doc('One'), T0);
  ok(!!first && first.source === 'auto-backup', 'the first cadence tick records an auto-backup');
  ok(tick(doc('Two'), T0 + 60_000) === null, 'a tick inside the throttle window is skipped (changed content waits)');
  ok(listVersions(root, ID).length === 1, 'the skipped tick left no snapshot');
  const second = tick(doc('Two'), T0 + MIN_INTERVAL + 1000);
  ok(!!second, 'a tick after the window records the changed state');
  ok(listVersions(root, ID).length === 2, 'two snapshots after two effective ticks');
  ok(tick(doc('Two'), T0 + 2 * MIN_INTERVAL + 2000) === null, 'an unchanged project never duplicates, however many ticks pass');
  ok(listVersions(root, ID).length === 2, 'the dedupe held the count');
  const entries = listVersions(root, ID);
  ok(entries[0].source === 'auto-backup' && entries[1].source === 'auto-backup', 'both snapshots carry the auto-backup source the browser labels');
}

// ---- 3. Explicit saves are never throttled ------------------------------------
{
  const saved = recordVersion(root, ID, doc('Three'), { source: 'save', boundFile: '/x/p.clipcraft.json', force: true, now: T0 + 2 * MIN_INTERVAL + 3000 });
  ok(!!saved && saved.source === 'save', 'an explicit save inside the window still records (force)');
  ok(listVersions(root, ID)[0].boundFile === '/x/p.clipcraft.json', 'the save snapshot keeps its bound file for the browser line');
}

// ---- 4. Restore round-trip ------------------------------------------------------
{
  const entries = listVersions(root, ID);
  const raw = readVersion(root, ID, entries[1].file); // the 'Two' auto-backup
  ok(raw === doc('Two'), 'a backup reads back byte-identical to what the tick recorded');
  const parsed = JSON.parse(raw);
  ok(parsed.id === ID && parsed.name === 'Two', 'the restored document is the project the tick saw');
  ok(readVersion(root, ID, '../escape.json') === null, 'the store still refuses names it did not mint');
}

// ---- 5. Wiring ------------------------------------------------------------------
{
  const repo = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(repo, 'electron', 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(repo, 'electron', 'preload.cjs'), 'utf8');
  const app = fs.readFileSync(path.join(repo, 'src', 'App.jsx'), 'utf8');
  const dialog = fs.readFileSync(path.join(repo, 'src', 'components', 'HistoryDialog.jsx'), 'utf8');
  const topbar = fs.readFileSync(path.join(repo, 'src', 'components', 'TopBar.jsx'), 'utf8');
  ok(main.includes("ipcMain.handle('versions:autoBackup'") && main.includes("source: 'auto-backup'"), 'main exposes the auto-backup IPC with the auto-backup source');
  ok(preload.includes('versionsAutoBackup'), 'preload bridges versionsAutoBackup');
  ok(app.includes('versionsAutoBackup') && app.includes('5 * 60 * 1000'), 'the renderer runs the five-minute cadence while editing');
  ok(dialog.includes('Project backups') && dialog.includes("'auto-backup': 'Auto backup'"), 'the browser is titled Project backups and labels auto backups');
  ok(topbar.includes('aria-label="Project backups"'), 'the TopBar entry point is the Project backups button');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `BACKUPS FAIL — ${failures} assertion(s)` : 'BACKUPS OK — timed cadence over the version store, restore round-trip, browser wiring');
process.exit(failures ? 1 : 0);
