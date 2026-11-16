# Creative Composer — user controls

What the user can control in the composer, where each control lives, and
what it does. This is the control surface for the features added in the
2026-11-15 gap build (Stream B); controls that already existed are listed
only where a new feature composes with them.

## Inspector levels (ClipInspector, video tab)

The video tab has three levels above the sub-tabs:

- **Basic** — Transform, Blend, Crop, Frame hold, Linked audio, Split
  screen, Pan & Zoom. The essentials for a quick edit.
- **Advanced** — everything Basic shows, plus segment easing, the keyframe
  graph, track matte, Stabilize, Motion Tracking and Pin to Track.
- **Presets** — the clip's look filter + intensity and its effect stack
  (bypass / reorder / copy / paste / before-after). For applying a look
  fast, without opening Adjust.

## Effect stack (Adjust → Effects, and Presets level)

- **Bypass (eye)** — one effect off, settings kept. Preview and export
  both render it as absent. Bypass is per effect, not per clip.
- **Reorder (up / down arrows)** — the stack order is the render order.
- **Copy stack / Paste stack** — copies the whole stack (effects +
  parameters + strengths) to another clip. The clipboard is session-only;
  it is not saved with the project.
- **Hold: before / after** — hold the button to see the clip with every
  effect bypassed; release restores the exact previous bypass state.
  It is one undo step.

## Frame hold (video tab, Basic)

Freezes one source frame while the clip's audio keeps playing. Set the
hold frame (source seconds) and the duration (timeline seconds), then
"Hold frame at playhead". "Clear hold" removes it. A hold outside the
clip's source window is ignored (the clip renders normally) — it never
fails an export. Frame hold does not apply to clips with a speed curve.

## Linked audio — J / L cuts (video tab, Basic)

Shown only when the clip has linked audio. **J-cut** starts the audio
early (−0.5 s / −1 s); **L-cut** runs the audio past the cut (+0.5 s /
+1 s). The four trim buttons edit the audio clip on its own — the
picture never moves. J/L cuts clamp at the audio start (audio never
starts before 0).

## Split screen (video tab, Basic)

Pick a partner picture clip and a layout (Left / Right, Right / Left,
Top / Bottom, Bottom / Top), then "Apply split screen". Both clips go to
half size on opposite halves. This is an effect-style tool, not the
removed `fx_split` transition.

## Pan & Zoom (video tab, Basic)

A Ken Burns move across the whole clip: start zoom, end zoom, pan X/Y.
"Apply Pan & Zoom" adds the `fx_panzoom` effect with those parameters;
tune it afterwards in Adjust → Effects.

## Speed (clip menu → Speed / Duration, and inspector Speed tab)

Constant speed from **0.1× to 100×**. Named presets: **Montage 4×**,
**Hero 0.5×**, **Bullet 10×**. Applying a constant speed replaces a
speed curve on that clip. A linked audio partner follows automatically.

## Audio presets — Replace vs Merge + A/B (AudioFx panel)

Above the preset list: **Replace** swaps the whole audio chain for the
preset; **Merge** only overwrites the settings the preset sets, keeping
your other tweaks. After applying a preset, **A · before / B · preset**
toggles the live chain between the state before the preset and the state
with it, so both sides are heard through the real render. Editing any
slider clears the A/B pair.

## Transcript quality (Captions tab → Transcript)

- **Confidence threshold slider** (default 60%): words below it are
  underlined in the transcript and counted in the summary. Words with no
  confidence score are unknown, never low-confidence. Low-confidence words
  are flagged, never auto-fixed.
- **Speaker** — a text box per sentence. Type a name, click away, and the
  caption carries that speaker label. Labels are never guessed.
- **Check text** — runs the rule-based proofreader (whitespace, doubled
  words, spacing around punctuation, sentence capitals — Latin only).
  "Apply all" applies the fixes in one undo step; "Dismiss" drops them.

## Source Monitor (Media tab)

Click a media card to peek it: the Source Monitor appears above the
grid with a preview, scrub bar, **Mark In / Mark Out** and **Insert at
playhead**. With marks set, only the marked range is inserted; with no
marks, the whole clip is inserted at the playhead.

## Q / W trim (Timeline)

**Q** deletes everything before the playhead in the selected clip (or
the clip under the playhead); **W** deletes everything after it. The
track magnet is the ripple: magnet on closes the space, magnet off
leaves a gap on the video track. The toolbar has the same two buttons
(←| and |→). Too close to a clip edge, Q/W does nothing.

## LUT and FCPXML export

- **Grade panel → Export grade as .cube**: bakes the current grade
  sliders into a 17³ `.cube` LUT. HSL, sharpen, clarity, vignette and
  particles are not baked (they have no LUT equivalent).
- **Export dialog → Interchange → Export .fcpxml**: Final Cut Pro XML
  1.9 of the timeline (clips, audio, captions). Effects, grades, LUTs,
  transitions and speed curves are not carried over — the file says so.

## Demo project

`docs/composer-demo/composer-vertical-demo.json` — the five-beat vertical
sample timeline (Glow, Film Burn, Flicker, Zoom, caption highlight).
Open it from File → Open project with its `media/` folder beside it.
