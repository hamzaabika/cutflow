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
- **Test battery baseline:** 152 PASS / 5 FAIL of 157 suite files (re-measured 2026-11-15, P0-07 — the 12 stale suites fixed: test-export-formats, test-backups, test-keystrokes, test-mcp-http, test-textanim, test-encoder, test-silence (all i18n drift) plus the five app-driven export suites test-textanim-export, test-textanim-word-export, test-textsmooth-export, test-tplmotion-export, test-tracking (the smoke entry clicked the retired Home '[aria-label="New 16:9 project"]' card; it now clicks the '.home-create' tile); new suite test-blend-psnr PASSES. The failure set is unchanged — the same 5 environment-only failures as 2026-11-10 (Windows-only captions/fonts suites, a telemetry endpoint unset, a live-network 429, and a missing local fixture). P2-31 (2026-11-15) deletes test-telemetry.cjs with the telemetry module, so the suite count drops to 156 and the failure set to 4 (the "telemetry endpoint unset" failure was that suite) — arithmetic, not a re-run; re-measure the battery before quoting new totals. P2 (re-measured 2026-11-15, post-merge + fixes): **211 PASS / 9 FAIL of 220 suites** (~/workspace/capcut-re/battery-p2-20261115-fixverify/results.txt; the first P2 battery read 208/13 of 221 — the 7 merge-interaction failures were fixed after it: clipmenu anchor, Clear Voice double-conversion, fx-thumbs stills, media-browser label, transition-parity count, p2e-live reframe, composer-live expectation). The 9: the 4 pre-existing environment failures from P0 (Windows-only captions/captions-linux/fonts, live-network 429 in test-library), the 2 demucs feasibility probes (OOM on this 6 GB cell), test-p2b-interp (environmental flake — ffmpeg child signal death, passes on retry ~4/5 standalone), test-p2-ui-live (harness race on the rate check — fixed after the battery, 34/34 standalone) and test-textstream (empty log in the battery; Xvfb was found dead right after — passes standalone). Suite count 220, not 221: test-p2-32-live.mjs went away with the P2-32 revert (Hamza: keep MyInstants). Battery runs on this VM need Xvfb :99 up, TMPDIR on disk (~/workspace/.tmp-battery — /tmp is a 512 MB tmpfs and the P0-05 enhance guard refuses jobs when it fills), and VK_ICD_FILENAMES pointing at the extracted Mesa lavapipe ICD (~/workspace/vulkan/lvp_icd.json — the VM image ships no Vulkan ICD); without those, test-export-sound-live / test-i18n-live / test-recorder-mic fail on missing X and test-enhance fails on vkCreateInstance. Results: ~/workspace/capcut-re/battery-p0-20261115-rerun/results.txt. Earlier: 141 PASS / 5 FAIL of 146 (re-measured
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
