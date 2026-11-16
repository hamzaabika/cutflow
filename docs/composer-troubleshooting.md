# Creative Composer — troubleshooting

Problems with the composer controls added in the 2026-11-15 gap build
(Stream B), the likeliest cause, and the fix. Check the cheap cause
first — most of these are a setting, not a bug.

## Effects

### A bypassed effect still shows in the preview
- **Cause:** the eye toggle bypasses one effect; another effect in the
  stack is producing the look you see.
- **Fix:** hold **Hold: before / after** — if the look disappears, an
  effect is responsible; bypass them one by one to find it. If the look
  stays with all effects bypassed, it is the clip's filter or grade,
  not an effect (Adjust → filter / Color).

### Reorder buttons are greyed out
- **Cause:** the effect is already at the top (up) or bottom (down) of
  the stack. That is the edge, not a failure.

### Paste stack does nothing
- **Cause:** nothing was copied yet this session (the clipboard is
  session-only), or the copied stack came from a clip with no effects.
- **Fix:** open a clip with effects, click **Copy stack**, then paste.
  The clipboard does not survive restarting the app.

### The before/after button leaves effects bypassed
- **Cause:** the pointer left the button while held (pointer-leave ends
  the compare and restores the bypass map; a drag that starts on the
  button and ends elsewhere can leave the restore to the pointer-up
  that never arrives).
- **Fix:** press Ctrl+Z once — the whole compare is one undo step, so
  one undo restores the exact previous bypass state.

## Frame hold

### The hold does nothing — the picture keeps moving
- **Cause 1:** the hold frame is outside the clip's source window
  (`in`–`out`). Out-of-range holds are ignored by design (the clip
  renders normally instead of failing the export).
- **Fix:** set the hold frame between the clip's In and Out, or use
  "Hold frame at playhead" while the playhead is inside the clip.
- **Cause 2:** the clip has a speed curve. Frame hold does not apply to
  curved clips.
- **Fix:** use a constant speed for that clip, or split the clip and put
  the hold on the constant part.

### The export fails on a clip with a hold
- Frame hold never fails an export by itself — invalid holds fall back
  to normal rendering. If the export fails, the cause is elsewhere
  (missing media, an unrelated effect); check the export tray error.

## J / L cuts and linked audio

### The Linked audio section is missing
- **Cause:** the clip has no linked audio (no `linkId`). Only clips
  created by detaching audio, or imported with audio, have a partner.
- **Fix:** select the clip, use the detach/extract audio action first,
  then the section appears.

### J-cut does nothing
- **Cause:** the audio is already at its start — J-cut clamps at
  audio start ≥ 0 and cannot start audio before the file begins.
- **Fix:** trim the video's In later (or the audio's In earlier) to
  make room, then J-cut.

## Split screen / Pan & Zoom

### "Apply split screen" is greyed out
- **Cause:** no partner clip is chosen, or the partner is the clip
  itself. The partner list only shows other picture clips.
- **Fix:** choose a different clip from the Partner dropdown.

### Pan & Zoom applies but the picture does not move
- **Cause 1:** start zoom and end zoom are equal and pan is 0 — the
  move has zero distance.
- **Fix:** set end zoom higher than start zoom (e.g. 1 → 1.15) or a
  non-zero pan.
- **Cause 2:** the `fx_panzoom` effect was bypassed afterwards.
- **Fix:** check Adjust → Effects; the eye next to Pan & Zoom must be open.

## Speed

### Speed will not go above 16× (or below 0.05×)
- **Cause:** an old project or an old dialog. The range is 0.1–100×.
- **Fix:** use the Speed / Duration dialog (clip menu) — it clamps to
  0.1–100×. The inspector chips only offer the common rates; type a
  value in the dialog instead.

## Audio presets

### Merge sounds the same as Replace
- **Cause:** the preset sets every field your chain had, so there is
  nothing to keep — or the preset's fields are all at their defaults,
  so Merge changes nothing.
- **Fix:** that is the correct behaviour. Merge only matters when you
  have tweaks the preset does not touch (e.g. your EQ while the preset
  only sets the compressor).

### A/B sounds identical on both sides
- **Cause:** the preset produced the same chain as the one before it
  (see above), or the preview render has not landed yet and both sides
  play the original sound.
- **Fix:** wait for the "preview ready" note, then toggle again.

## Transcript

### No words are underlined at 60%
- **Cause:** the words have no confidence scores (no Whisper word
  timestamps on this transcript). Words without a score are unknown,
  never low-confidence.
- **Fix:** nothing to fix — the summary says so. Re-transcribe with
  word timestamps to get scores.

### "Check text" finds nothing on an Arabic caption
- **Cause:** the proofreader's capital rule skips Arabic (Arabic script
  has no case). Only whitespace / doubled-word / punctuation-spacing
  rules apply.
- **Fix:** expected behaviour.

### The speaker box does not save
- **Cause:** the label commits on blur (clicking away), not on every
  keystroke — typing and immediately undoing, or closing the panel
  mid-edit, drops the edit.
- **Fix:** click outside the box after typing.

## Source Monitor

### Insert adds the whole clip, not the marked range
- **Cause:** no marks were set. With no marks, Insert inserts the whole
  clip — that is the documented fallback.
- **Fix:** press **Mark In** and **Mark Out** first; the Insert button
  shows the range it will insert.

### The monitor does not appear when I click a card
- **Cause:** the card was Ctrl/Cmd-clicked (multi-select) or the click
  landed on a card action (add / menu). Only a plain click peeks.
- **Fix:** plain-click the card body. Close with the ✕ in the monitor.

## Q / W trim

### Q / W does nothing
- **Cause 1:** the playhead is at (or within ~0.1 s of) a clip edge.
  Q/W needs a real piece on both sides to split.
- **Fix:** move the playhead inside the clip.
- **Cause 2:** no clip is selected and the playhead is over a gap.
- **Fix:** click the clip first, then Q/W.

### Q/W leaves a gap instead of closing up
- **Cause:** the track magnet is off. The magnet is the ripple.
- **Fix:** turn the magnet on for that lane (Timeline toolbar, magnet
  icon) and Q/W again, or turn it on and the gap closes.

## LUT / FCPXML export

### The exported .cube looks different from the grade
- **Cause:** HSL, sharpen, clarity, vignette and particles are not
  baked into a LUT (they have no LUT equivalent). The file only carries
  the pointwise grade (saturation, temp/tint, exposure, contrast,
  tones, fade, curves).
- **Fix:** expected. For an exact match, keep the grade in Cutflow
  instead of round-tripping through a LUT.

### The .fcpxml opens in Final Cut but has no effects
- **Cause:** by design — FCPXML 1.9 here carries clips, audio and
  captions only. Effects, grades, LUTs, transitions and speed curves
  are not represented (the file's own note says so).
- **Fix:** rebuild the look in Final Cut, or export the finished video
  from Cutflow instead.

## Demo project

### The demo project opens but the media is missing
- **Cause:** the `media/` folder was not copied with the `.json` — the
  project references `media/clip-a.mp4` and `media/clip-b.mp4` by
  relative path.
- **Fix:** keep the whole `docs/composer-demo/` folder together, or
  relink the two clips (Media tab → relink).
