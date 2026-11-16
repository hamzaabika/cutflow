# Creative Composer — recipe authoring guide

A **recipe** is a named editing style: a whole edit from one word
("edit it Orbit style"). Recipes live in `src/agent/motionGuide.js` as
`EDIT_STYLES` entries and are returned by FlowAI's `edit_style` tool.
This guide is for authors adding a new one.

## The entry format

```js
my_style: {
  emoji: '🌙',                       // one emoji, for the style card
  tag: 'One-line hook',             // what the camera / edit does
  title: 'Moon Drift',              // display name
  aliases: ['moon', 'drift'],       // words users might say instead
  look: 'Dreamy camera that slowly circles the subject; smooth, floating, cinematic.',
  recipe: `1. remove_silences (min_silence_sec 0.5). set_filter "dreamy" on every clip.
2. Every main clip: set_transform scale 1.1, then add_keyframes x and y on a small circle …
3. …`,
},
```

- `look` is one or two sentences a human can picture. No tool calls in it.
- `recipe` is numbered steps, each step one or more **real tool calls**
  (see below). Keep it to 5–8 steps; a recipe that needs 12 steps is two
  recipes.
- Steps run in order. Say which clips a step applies to ("every main
  clip", "short clips under 3 s", "the title at the start") — never assume
  the agent knows.

## The tool-call vocabulary

Only call tools that exist in `src/agent/tools.js`, with argument names
exactly as defined there. The common ones:

| Call | What it does |
|---|---|
| `remove_silences` | Cut silences (`min_silence_sec`, `keep_padding_sec`) |
| `set_filter` | A filter id from the shipped list (`list_options filters`) |
| `set_effects` | Effect ids from the shipped catalog (`list_options effects`) |
| `add_transition` | A transition id from the shipped catalog |
| `add_text` / `edit_text` | Text / caption clips; `anim_in`, `anim_out`, `anim_loop` ids from `src/fx/textAnim.js` |
| `add_scene` | A colour / gradient scene |
| `set_transform` / `add_keyframes` | Scale / position / rotation, with an easing (`spring`, `back`, `out`, `inout`) |
| `add_captions` | Auto captions, then `edit_text` to style them |
| `search_sounds` / `add_sound` | SFX and music from the shipped library |
| `transcribe` | Word timings, for timing text and zooms to speech |
| `zoom` | `style: "cut"` (punch-in 1.2–1.35) or `"smooth"` |

## Rules (non-negotiable)

1. **Real ids only.** Every filter, effect, transition, animation and
   sound id in a recipe must exist in the shipped catalog / library.
   Verify with `list_options` (or grep `src/fx/catalog.js`,
   `src/fx/textAnim.js`, `src/text/catalog.js`) before submitting.
   An invented id fails silently at runtime and the user sees nothing.
2. **Never use a removed id.** The 19 removed transitions
   (`fx_flash`, `fx_filmburn`, `fx_tricolour`, `fx_vhstracking`,
   `fx_zoomspin`, `fx_zoomrotatein`, `fx_zoomrotshake`, `fx_shakeblur`,
   `fx_zoommosaic`, `fx_shakedistort`, `fx_lightleak`, `fx_rollright`,
   `fx_rolldown`, `fx_split`, `fx_tvstatic`, `fx_fanwipe`,
   `fx_elasticcircle`, `fx_zoomtwirl`, `fx_panrotate`) and
   `cap-goldquote-hadith` are gone. Do not write them into a recipe,
   even as a "film burn" — use `fx_lightburn` for a burn-style cut.
3. **No MOGRT / AEP / paid-pack claims.** Recipes are built from
   Cutflow's own tools and library. Never name a third-party pack, preset
   or template file as a source.
4. **No synthesized SFX.** `search_sounds` only finds sounds that ship
   in the library. Do not promise a generated sound.
5. **Timing principles** (from `MOTION_GUIDE.principles`, in the same
   file): enter in 0.3–0.6 s, hold at least 1.5 s to read (≈0.3 s per
   word), exit in 0.2–0.4 s; stagger elements by 0.1–0.2 s; never move
   everything at once; one focal point at a time; text inside the middle
   80% of the frame; on 9:16 keep captions above y 0.8.
6. **Arabic and Darija:** animate Arabic by word or by line, never by
   letter (letters must stay joined). Use Arabic fonts (`cairo`,
   `tajawal`, `almarai`, `lalezar` for titles, `amiri` for elegant).
   Align right for lists and lower thirds; slide from the right.
7. **Sound design:** music 0.15–0.25 under speech (0.6–0.8 without),
   fades in/out 1–2 s; SFX at most every 3–5 s, placed 0.05 s before the
   visual event; whoosh for moves, pop for text appearing, ding for list
   items, impact for big reveals. Meme sounds only at a joke, never
   under speech.
8. **Zooms:** one strong moment every 5–10 s, 1–3 s each; never zoom two
   moments back to back (leave ≥3 s between).

## How to test a recipe before submitting

1. Apply the recipe by hand to `docs/composer-demo/` (the vertical demo
   project) or a fresh 3-clip timeline, following your own steps literally.
2. Check every step runs: each id resolves, each sound is found, each
   caption lands where the step says it should.
3. Export 5–10 s and watch it: does the edit read as the `look` promises?
   If a step does nothing visible, delete it — a recipe is judged by the
   edit, not the step count.
4. Run the step through FlowAI once (`edit_style` with the new name) and
   confirm the agent picks it up by name and by at least one alias.

## Example skeleton

```js
quiet_interview: {
  emoji: '🎙️',
  tag: 'Calm, steady, no tricks',
  title: 'Quiet Interview',
  aliases: ['interview', 'calm', 'talking head'],
  look: 'A steady talking head with quiet captions and no camera tricks; the words do the work.',
  recipe: `1. remove_silences (min_silence_sec 0.5).
2. Every main clip: set_filter "cinematic".
3. add_captions in the video's language; edit_text "captions": bold font "montserrat", size 70-90, highlight "karaoke" #ffd400, y 0.72 on 9:16 / 0.85 on 16:9.
4. One zoom per 10 s on a key claim: zoom style "smooth", scale 1.15.
5. Music: search_sounds music "ambient", volume 0.2 under speech, fade_in_sec 1, fade_out_sec 2.`,
},
```
