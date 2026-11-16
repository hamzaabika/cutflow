# Creative Composer — recipe authoring guide

**Applies to:** Cutflow at HEAD `2ec51ae`. A "recipe" is a `CreativePreset`:
one JSON object that reproduces a look on any clip. This guide is for
authors — people writing presets by hand, building preset packs, or adding
built-ins. For day-to-day use, see
`docs/creative-composer-user-controls.md` (the panel does all of this
without touching JSON).

## 1. The recipe format (schema v1)

```json
{
  "kind": "cutflow.creative-preset",
  "schemaVersion": 1,
  "id": "cp_...",
  "name": "Vivid Pop",
  "target": "filter",
  "family": "look",
  "variant": "vivid",
  "params": { "intensity": 80, "adjust": {} },
  "source": "user",
  "createdAt": "2026-11-15T00:00:00.000Z",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

Rules enforced by `src/presets/schema.js` (violations make the preset
invalid, never silently fixed):

- `kind` must be exactly `cutflow.creative-preset`; `schemaVersion` must
  be exactly `1`. A future version must bump the number — v1 readers
  reject newer versions rather than guessing.
- `name`: non-empty, max 80 characters.
- `target`: one of `filter`, `text`, `caption`, `audio`, `transition`.
  `family` derives from the target (`look`, `title`, `caption-style`,
  `voice`, `crossfade`) — do not invent families.
- `variant` names the built-in the recipe wraps, or `null` where the
  recipe is pure parameters (a caption style, a custom audio chain).
  The variant **must exist** in the app's catalogs or the recipe is
  rejected: filter → `FILTERS` (or `lut:<file>.cube`), text/caption →
  `TEXT_TEMPLATES`, audio → `AUDIO_PRESETS`, transition → `TRANSITIONS`.
- `params` holds only that target's keys (see §2). Unknown keys are
  dropped; numeric leaves are clamped to the registry limits.
- `id`: any non-empty string; import gives a clashing id (same id, different
  name/target) a fresh one. Use `cp_` + random suffix for new recipes.
- Optional `notes` (max 500 chars) and optional `assets` (LUT/font/media
  manifest, P2-17 — see §4).

A whole library is one file:

```json
{ "kind": "cutflow.creative-preset-list", "schemaVersion": 1, "presets": [ … ] }
```

## 2. Parameters per target

| Target | `params` keys | Limits |
|---|---|---|
| `filter` | `intensity` (number), `adjust` (Adjust object, same keys as the Adjust panel) | intensity 0–100 |
| `text` | `style` (text patch: `size`, `opacity`, `font`, `color`, …) | size 8–300, opacity 0–1 |
| `caption` | `style` (caption patch incl. `highlight: {mode, color}`, `bubble`) | size 8–300, opacity 0–1 |
| `audio` | `audioFx` (chain object, normalized by `normalizeAudioFx`) | pitch −12…+12, high-pass 0–300 |
| `transition` | `duration` (seconds) | 0.2–2 |

Defaults come from `defaultParams(target, variant)` in
`src/presets/registry.js` — e.g. a transition recipe defaults to the
transition's own duration, an audio recipe to its preset's chain. When in
doubt, omit a key and let the default stand.

## 3. Authoring a recipe, step by step

1. **Start from a real clip, not from a blank file.** Build the look in
   the app (filter + Adjust, or text + animation, or audio chain), then
   **Composer → Save** with a name and the right type. The panel writes
   a valid v1 recipe for you — hand-edit from that, not from memory.
2. **Name it like the thing it does, in your own words.** `Warm Sunset
   Fade`, not a copied pack name or a brand's preset name. Original
   shaders, patterns, timing, and names only — inspiration is fine,
   repackaging someone else's paid pack, preset, MOGRT/AEP, or wording is
   not. (Mister Horse is inspiration only; never fetch or repackage paid
   packs.)
3. **Keep one recipe = one idea.** A recipe that bundles a filter + a
   transition + a caption style is three recipes. One idea per recipe is
   what makes them combinable — and what makes a broken one diagnosable.
4. **Prefer parameters over variants.** If the look is "Vivid, but
   gentler", write a `filter` recipe with `variant: "vivid"` and
   `intensity: 55` — do not invent a new look id. New built-in variants
   (new filter/effect/transition ids) are engine work, not recipe work.
5. **Determinism is mandatory.** If the recipe uses an effect with a
   `seed` parameter, set it explicitly. Never depend on wall-clock time,
   randomness without a seed, or the order presets were applied in. The
   same project must export the same frames every time.
6. **Declare assets, don't embed them.** A recipe that needs a LUT or a
   font lists it in `assets` (`{kind: 'lut', name: '<file>.cube'}` /
   `{kind: 'font', name: '<family>'}`); the file itself travels beside
   the `.json` or as a `.cutflowpack`. Missing assets are reported on
   import, never silently substituted — so name them exactly.

## 4. Worked examples

**A filter recipe (Vivid, softer):**

```json
{
  "kind": "cutflow.creative-preset", "schemaVersion": 1,
  "id": "cp_softvivid01", "name": "Soft Vivid",
  "target": "filter", "variant": "vivid",
  "params": { "intensity": 55, "adjust": { "saturation": 10 } },
  "source": "user",
  "createdAt": "2026-11-15T00:00:00.000Z",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

**A caption recipe (pill subtitle, word pop):**

```json
{
  "kind": "cutflow.creative-preset", "schemaVersion": 1,
  "id": "cp_pillpop01", "name": "Pill Pop Subtitle",
  "target": "caption", "variant": "cap-subtitle",
  "params": { "style": { "bubble": "pill", "bubbleColor": "#16161f",
    "highlight": { "mode": "scale", "color": "#a78bfa" }, "size": 64 } },
  "source": "user",
  "createdAt": "2026-11-15T00:00:00.000Z",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

**A transition recipe (Fade, slower):**

```json
{
  "kind": "cutflow.creative-preset", "schemaVersion": 1,
  "id": "cp_slowfade01", "name": "Slow Fade",
  "target": "transition", "variant": "fade",
  "params": { "duration": 1.2 },
  "source": "user",
  "createdAt": "2026-11-15T00:00:00.000Z",
  "updatedAt": "2026-11-15T00:00:00.000Z"
}
```

## 5. Testing a recipe before sharing it

Run this checklist — it is the CSV's `validation` column, and a recipe
that fails any line is not done:

1. **Applies** — import the `.json` into a clean library; the preset
   appears under its target; clicking it applies to the right clip kind.
2. **Previews** — the preview changes the way the recipe promises (and
   only where it promises — an HSL recipe must not shift other colours).
3. **Exports** — export a short clip with the recipe applied; the exported
   frame matches the preview frame within codec tolerance (the parity
   suites' method: `scripts/test-fx-parity.cjs`). A look that exists only
   in the preview is a bug.
4. **Editable** — every parameter the recipe claims is offered as a
   slider/control with the registry's limits, and moving it live-updates
   the preview.
5. **Undo/redo** — applying the recipe is one undo step; undo restores the
   clip exactly.
6. **Save/reopen** — save the project, reopen it: the clip still carries
   the recipe's settings and renders identically.
7. **Deterministic** — export twice; the frames are identical.
8. **Appropriate resolution** — the recipe behaves at 1080p and at 9:16,
   not just at the size it was authored at (effect radii scale with width;
   text sizes are absolute — check both).

Automated help: `node scripts/test-creative-presets.mjs` (schema/registry/
capture/apply), `node scripts/test-gap-f-verify.mjs` (§7 rows: apply +
preview + export per recipe family).

## 6. Do not author these

- Recipes wrapping the 19 removed transitions or `cap-goldquote-hadith`
  — removed by Hamza's order; they stay removed.
- Recipes that need synthesized / AI-generated SFX — no synthesized
  audio, ever; use real licensed/original audio.
- Recipes that rename, copy, or re-skin another app's preset/pack names,
  wording, or layout. Original work only.
- A "multi-pass bloom" recipe that is really `fx_bloom1` relabelled —
  adapted mappings stay labelled adapted until a real named renderer
  exists (CC-01 owns true multi-pass bloom).
- Recipes with a `variant` that does not exist yet, hoping the engine
  will grow it. The engine grows first; the recipe follows.
