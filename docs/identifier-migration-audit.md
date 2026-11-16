# Identifier migration audit — ClipCraft → Cutflow (FB-22 / P1-40)

Date: 2026-11-15. Scope: AUDIT ONLY. **Nothing was renamed by this item.**
Branch `cc-f4`, commit for this item: see `git log`.

## 1. What was verified

### 1.1 Update feeds — both serve the same, current payload

Fetched 2026-11-15 ~17:51 UTC (browser text fetch, not a claim from source):

| Feed URL | version | download_url | sha256 |
|---|---|---|---|
| `https://clipcrafts.pages.dev/version.json` | 2.1.0 | `github.com/hamzaabika/cutflow/releases/download/v2.1.0/cutflow_2.1.0_amd64.deb` | `721d4ed3…95708` |
| `https://getcutflow.pages.dev/version.json` | 2.1.0 | same | same |
| `https://clipcrafts.pages.dev/version.json?platform=linux` | 2.1.0 | same | same |
| `https://getcutflow.pages.dev/version.json?platform=linux` | 2.1.0 | same | same |

Both feeds are live, in sync, and carry a checksum (so FB-21's refuse-by-default
path is not triggered by either feed today). The `?platform=` query the app
sends (`electron/updates.cjs` `check()`) does not change the served payload
on either host today — both return the same Linux `.deb` URL.

**Consequence:** switching the in-app default feed from `clipcrafts` to
`getcutflow` is safe *content-wise* today. It is NOT a one-line change (see §3).

### 1.2 Brand names shown in the app UI

- The renderer contains **zero** occurrences of the string `ClipCraft`
  (`grep -r ClipCraft src/` → no matches). The UI says Cutflow everywhere:
  About ("About Cutflow"), Welcome ("Welcome to Cutflow"), productName
  `Cutflow` in `package.json` and `electron-builder.release.json`.
- The public site is Cutflow throughout: `README.md` links
  `getcutflow.pages.dev` (site, logo, screenshots, demo) and the GitHub
  release `hamzaabika/cutflow/releases/tag/v2.1.0`. The README never points
  users at `clipcrafts.pages.dev`.

### 1.3 Legacy identifiers still live in the tree

| Identifier | Where | What it controls |
|---|---|---|
| `app.setName('ClipCraft')` | `electron/main.cjs:3` | The app's userData dir on Linux: `~/.config/ClipCraft`. Verified present on this machine; no `~/.config/Cutflow` exists. Settings, autosave slots, versions, drafts all live under it. |
| `appId: com.clipcraft.app` | `package.json:93`, `electron-builder.release.json:2` | Installer identity on Windows (NSIS) / macOS (bundle id) and the Snap/desktop identity chain. |
| Updater default `clipcrafts.pages.dev/version.json` | `electron/updates.cjs:47` (`SITE`) | Where About → Check for updates looks. `LINK_HOSTS` (same file:51) allows `clipcrafts.pages.dev` but **not** `getcutflow.pages.dev` — a feed move that only changed `SITE` would have its download/notes links rejected by `safeLink` and fall back to the old site. |
| `.clipcraft.json` | `electron/main.cjs:748` (save dialog default), `electron/projectzip.cjs:67`, `electron/draftsafety.cjs`, `src/recents.js:17` | The project-file extension users see in save/open dialogs and in project ZIPs. |
| `clipcraft.recents` / `clipcraft.recovery` / `clipcraft.trash` | `src/App.jsx` | localStorage keys for recents, crash recovery, trash. |
| `CLIPCRAFT_UPDATE_URL`, `CLIPCRAFT_SOUNDZA_URL`, `CLIPCRAFT_BUNDLED_PACK_DIR`, `CLIPCRAFT_ASSETS_DIR` | `electron/updates.cjs`, `electron/soundza.cjs`, others | Env-var overrides (dev/test). `FVE_*` vars are the majority; the `CLIPCRAFT_*` ones are the only ones carrying the old name. |
| `clipcrafts.pages.dev` in `HELP_HOSTS` | `electron/main.cjs:1649` | "Open in browser" allowlist — `getcutflow.pages.dev` is already present there too. |
| Already migrated | `name: cutflow` in `snap/snapcraft.yaml`, `productName: Cutflow`, GitHub repo `hamzaabika/cutflow`, release assets `cutflow_2.1.0_amd64.deb` | The public-facing install surface is Cutflow already; the residue is internal identity + data paths. |

### 1.4 userData continuity — Linux, verified live

`scripts/test-identifier-upgrade-live.mjs` seeds a fake "old install" into
`~/.config/ClipCraft/` (a `settings.json` with language `fr` and one autosave
slot + index) and boots the current build twice against it. Both launches
read the seeded settings (`settingsGet().language === 'fr'`) and list the
seeded slot, and no `~/.config/Cutflow` directory is ever created. That is
the upgrade-in-place guarantee under the CURRENT identifiers: an installed
user's settings, autosaves and versions survive a reinstall of the same
build, because nothing in the path changed.

The Windows/macOS equivalents are **unrunnable here** (no Windows or macOS
hardware, no such installer to run) — see §4.

## 2. What a rename would break (the reason this is an audit, not a rename)

1. **userData path.** `app.setName('ClipCraft')` → `setName('Cutflow')`
   moves userData from `~/.config/ClipCraft` to `~/.config/Cutflow` on Linux
   (analogous moves on macOS `~/Library/Application Support/ClipCraft` and
   Windows `%APPDATA%\ClipCraft`). Every installed user's settings, autosave
   slots, version history, drafts, GPU fingerprint and cached packs would
   silently become invisible — the app would look factory-fresh and their
   unsaved work would be orphaned on disk, not deleted. A rename MUST ship a
   first-run migration that copies/moves the old dir (see §3).
2. **appId.** Changing `com.clipcraft.app` changes the Windows uninstall/
   upgrade identity and the macOS bundle id: the OS treats it as a *different
   app*. An in-place upgrade becomes a side-by-side install; the old entry
   stays in Add/Remove Programs / Applications until manually removed.
   electron-builder's `appId` is also what the auto-update feed keys on.
3. **Project extension.** Renaming `.clipcraft.json` → `.cutflow.json`
   breaks: file associations on installed machines, every existing project
   file on disk, project ZIPs already shared, and the open/save dialogs.
   The old extension must keep opening (and ideally keep saving) for at
   least one major version.
4. **Feed + link allowlist.** `SITE` and `LINK_HOSTS` must move together
   (§1.3). The old feed must keep serving the same payload (it does today)
   until every shipped build's default has moved, or older builds lose
   updates.
5. **localStorage keys.** `clipcraft.*` keys live in the Chromium profile
   *inside* userData, so they move with the userData migration — but only
   if the migration moves the whole profile dir, not just `settings.json`.
   Renaming the keys themselves would wipe recents/recovery/trash for
   everyone; there is no reason to rename them.
6. **Env vars.** `CLIPCRAFT_*` are dev/test overrides; renaming them breaks
   scripts and CI that set them. Keep them as aliases if the public name
   changes.

## 3. Migration plan (to be executed only on Hamza's explicit order)

Phase 0 — before any rename, ship one release that:
- keeps every identifier as-is;
- adds a first-run migration in `electron/main.cjs`: if
  `~/.config/Cutflow` does not exist and `~/.config/ClipCraft` does, copy
  (not move — keep the old dir as a fallback for one version) the whole
  userData dir, then write a `migrated-from-clipcraft` marker. Same logic
  on macOS/Windows with their userData paths. Log the migration; surface
  it in About ("Migrated your data from the previous install").
- adds `.cutflow.json` as an *additional* openable extension while
  `.clipcraft.json` remains the save default.

Phase 1 — the rename release:
- `app.setName('Cutflow')`, `appId: com.cutflow.app` (new), `SITE` →
  `getcutflow.pages.dev/version.json`, add `getcutflow.pages.dev` to
  `LINK_HOSTS` (keep `clipcrafts.pages.dev` in it for the transition),
  save-dialog default `.cutflow.json` (still opening `.clipcraft.json`),
  `CLIPCRAFT_*` env vars kept as aliases of `CUTFLOW_*`.
- Keep the old feed (`clipcrafts.pages.dev/version.json`) serving the
  current payload for at least two releases so pre-rename builds can still
  update.
- Ship the phase-0 migration in this release so a user jumping straight
  from a pre-rename build gets their data.

Phase 2 — one major version later, after telemetry/support confirms no
migration failures:
- drop the old feed, drop `clipcrafts.pages.dev` from `LINK_HOSTS`,
  stop copying the old userData dir (leave it on disk; never delete user
  data), stop writing `.clipcraft.json` (still open it).

Rollback: if the rename release is pulled, users already migrated keep
working — the old dir was copied, not moved, in phase 0, and the old
builds still read it. The only un-rollbackable piece is a changed `appId`
on Windows/macOS (the OS keeps two entries); that is why the appId change
is the last thing to flip and needs its own release note.

## 4. What is NOT verified here

- **Windows/macOS upgrade-in-place.** Unrunnable on this Linux VM: no
  Windows/macOS hardware, no NSIS/DMG installer to run, no way to observe
  the OS-level app identity or `%APPDATA%` /
  `~/Library/Application Support` migration. The Linux tests are the
  buildable core; the other two platforms need a real machine of each.
- **The Snap upgrade path.** Snap name is already `cutflow`; the Snap
  store handles the upgrade, and the confined userData path is Snap-owned.
  Not re-tested here (out of scope for a rename audit — the Snap identity
  already matches).
- **Feed behaviour under `?platform=darwin` / `?platform=win32`.** Only
  `?platform=linux` and the bare URL were fetched; the other platforms'
  payloads are assumed identical from the same static file, not verified.

## 5. Tests

- `scripts/test-identifier-audit.mjs` — static assertions on the current
  state (no rename has happened): setName, appId, productName, feed
  default host, the `LINK_HOSTS` gap, `.clipcraft.json` as the save
  extension, zero `ClipCraft` strings in `src/`, README advertising
  `getcutflow`, `clipcraft.*` localStorage keys, Snap name `cutflow`.
- `scripts/test-identifier-upgrade-live.mjs` — Linux upgrade-in-place:
  seeds an old install's userData, boots the current build twice, asserts
  settings + autosave slot survive and no `~/.config/Cutflow` appears.
