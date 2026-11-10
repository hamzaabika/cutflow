# AGENTS.md — working on Cutflow

Guidance for AI coding agents (and humans) contributing to this repository.

## The originality rule

**Never copy another application's code, assets, icons, wording, or layout.**
Concept-level inspiration from other editors is allowed; every implementation,
asset, and text must be original work created for Cutflow. If a change would
not be defensible as written-from-scratch, do not ship it.

The Cutflow name and logo are the author's brand — they are not covered by
the MIT license grant and may not be used to brand another product.

## Working conventions

- **Push after every completed, verified feature.** This repo is synced with
  text-only snapshot pushes (binaries travel by other routes — ask before
  adding any binary file).
- **Never build/package an installer** (`.deb` / `.exe` / `.dmg`) unless Hamza
  explicitly says "build". Public releases are built by GitHub Actions from
  the `release/vX.Y.Z` branch; local packaging is for development checks only.
  Release builds exclude the bundled content pack — that difference lives in
  `scripts/prepare-release-config.cjs`, never edit the dev default in
  `package.json` to remove the pack.
- **Verify in the real app before claiming a feature works.** Drive the actual
  UI (the dev instance exposes a test harness), measure the result, and
  report failures as failures — with the reason, not a softened summary.
- **Test battery baseline:** 141 PASS / 5 FAIL of 146 suite files (re-measured
  2026-11-10, 10/10 step 5 — CapCut-pattern shell + home + stickers expansion
  + forgotten-features sweep: the four new suites test-fx-thumbs,
  test-markers, test-caption-replace and test-fillers PASS; test-stickers
  extended; the failure set is unchanged — the increase is the new suites,
  not recovered failures. See the step-5 entry in
  ~/workspace/capcut-re/held-changes.md. Earlier republications: 137/5 of 142
  at 10/10 step 4 — feature-gap closure: the six new suites
  test-layout-collapse, test-fx-eviction, test-backups, test-silence,
  test-bridge-derivatives and test-mcp-http PASS; the failure set is
  unchanged. battery-step4/results.txt itself reads 136/6: the sixth failure,
  test-tplmotion-export, was probe drift from step 3's chip-count labels,
  fixed in the harness in step 4; it passes standalone on the final tree —
  see the step-4 entry in ~/workspace/capcut-re/held-changes.md. Earlier
  republications: 129/5 of 134 at the 10/10 performance step (suites
  test-hwencode, test-perfmode, test-remux). Earlier republications:
  126/5 of 131 at R5 — home redesign: the two new suites test-home-store and
  test-home-list PASS; the failure set is unchanged. Earlier republications:
  124/5 of 129 at Sprint 12; 122/5 of 127 at Sprint 11 — productivity: the three new suites test-keymap,
  test-scopes and test-keystrokes PASS; the failure set is unchanged. The
  first Sprint 11 battery run read 92/35 because /tmp (a 512 MB tmpfs)
  filled mid-run and every later disk-writing suite failed ENOSPC; with
  /tmp cleaned the same tree measures 122/5 — battery runs on this VM
  must babysit /tmp); the 5 failures are environment-only
  (Windows-only suites, a telemetry endpoint unset, a live-network 429, and a
  missing local fixture in the sandbox). Battery-run artifacts on record:
  test-transition-packs-export failed inside the Sprint 9 battery run on a
  mid-transition sample that had been calibrated to the pre-Sprint-9 export
  frame timing (the silent 25 fps re-grid); the sample was corrected to the
  effect definition's own separation point and the suite passes standalone
  on the same tree. (Sprint 8's run had the equivalent artifact:
  test-textsmooth-export, a headless GPU-process init crash, passing
  standalone.) The R4 battery sheet (battery-r4/results.txt) reads 109/11
  because it ran before that step's completion-probe updates landed: the five
  app-driven export suites (test-tracking, test-textanim-export,
  test-textanim-word-export, test-textsmooth-export, test-tplmotion-export)
  polled the retired modal's completion heading — the smoke probes now read
  the export jobs tray — and test-fx-parity's blur presence guard was
  recalibrated (reasoning in the suite). All six pass standalone on the
  final R4 tree. A change that moves this number needs an explanation in
  the commit message.
- **One editor on the tree at a time.** Perf, crop and UI workstreams do not
  edit the tree concurrently; coordinate through the maintainer.
- **Numbers come from disk.** Any benchmark or verification figure you cite
  must be re-read from its evidence file in the same step that cites it.

## Layout

- `src/` — React renderer (store + dispatch, panels, timeline, preview).
- `electron/` — main process: export engine (`ffmpeg.cjs`, `layers.cjs`),
  captions, templates, pack and update feeds (host-gated, renderer never
  supplies URLs).
- `shared/` — LUTs and shared data. `bundled-templates/` — generated template
  packages (regenerate with `scripts/make-bundled-templates.cjs`, never
  hand-edit the media).
