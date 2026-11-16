# Darija caption eval — Whisper base, local, Hamza's own audio

First run: 2026-11-15. Model: **whisper base (ggml-base.bin)**, run locally via
`electron/whisper.cjs` `transcribe()` with `language: 'ar'`, 16 kHz mono WAV,
no cloud, no download. Harness: `scripts/eval-darija.mjs`. Set:
`scripts/darija-eval-set.json`. Results: `scripts/darija-eval-results.json`.

## Method

- Ground truth is **Hamza's own dictated script only** (his words, written before
  the edit, with timings where the script had them). Whisper-derived transcripts
  are NOT ground truth — scoring against them would be circular.
- Timed samples (ecom, promo): the hypothesis is the transcribed words whose
  midpoint falls in `[start − 0.3 s, end + 0.3 s]` of the reference cue.
  Timestamp error is `|hyp first word start − ref start|` and
  `|hyp last word end − ref end|`.
- Untimed samples (nettworki-v1): the whole transcript is aligned to the 8
  reference units in script order by global word-level DP; aggregate WER is
  exact, per-unit insertion attribution is approximate by one unit.
- WER/CER use the shared Darija normalisation from `src/proofread.js`
  (`normalizeDarija`: diacritics stripped, alef variants folded, ة→ه, ى→ي,
  punctuation stripped, Latin lowercased). WER is word-level
  (substitutions / deletions / insertions over reference words); CER is
  character-level over the same normalised text.

## Sources (all Hamza's own voice, local files, no downloads)

| source | audio | ground truth | samples | duration |
|---|---|---|---|---|
| ecom | `edit_20261112_ecom/raw/raw_to_edit.mov` | `edit_20261112_ecom/raw/script.srt` (dictated, timed) | 9 | 48.03 s |
| promo | `edit_20261112/raw/raw_to_edit.mp4` | `edit_20261112/build/script.srt.md` (dictated, timed) | 8 | 35.47 s |
| nettworki-v1 | `edit_20261105_nettworki/build/raw.wav` | `edit_20261105_nettworki/build/script.md` (dictated, untimed) | 8 | 40.96 s |

Total: **25 samples**, 124.46 s of audio.

## Results — Whisper base (`language: 'ar'`)

<!--RESULTS-->

## What the numbers mean

<!--INTERPRETATION-->

## Shortfall — the 40–100 target was NOT met

Only 25 samples have verifiable dictated-script ground truth in local material.
The candidates that would close the gap were excluded for cause, and are listed
in `scripts/darija-eval-set.json` under `excluded`:

- `user/files/video_3.srt` (23 cues) + `video_3_2_z5wz.mp4` — provenance
  unverified; the SRT may itself be Whisper output.
- `user/files/captions.srt` (31 cues) — no paired audio.
- `user/files/yassine_captions.srt` — not Hamza's voice; consent unconfirmed.
- `user/files/voice_over.wav` — no reference transcript.
- Nettworki v2 transcript (32 segments) — Whisper output only, no dictated
  script found for that video.
- `raw_to_edit.words.json`, promo `build/transcript.json` (+ transcript2/3),
  `transcripts/hook_a/transcript.txt`, the Nettworki `.srt` files — all
  Whisper-derived, circular as ground truth.

Including any of them needs Hamza's confirmation that the SRT/text is
hand-written or dictated, not model output.

## Not evaluated

- **Whisper turbo and the Darija-tuned model**: their files are not present
  locally (`~/.config/ClipCraft/whisper/` holds base only) and downloading
  audio/models for the eval set is forbidden by the task. Do NOT claim one
  model is best — no comparison exists yet. The Darija model is the obvious
  next run once its file is available locally.
- Cloud caption engines (Groq / OpenAI / Deepgram / ElevenLabs): not run in
  this eval; they need a provider key and upload audio, so they are a separate
  decision, not a local benchmark.

## Reproducing

```sh
TMPDIR=~/workspace/.tmp-battery node scripts/eval-darija.mjs
```

Writes `scripts/darija-eval-results.json` and prints a per-sample table.
Expect it to be slow on this VM: the first run took ~44 min wall for the
48 s ecom file under heavy CPU contention (12:38 CPU for the Whisper run
itself). Do not `SIGSTOP` the child whisper process mid-run unless you
`SIGCONT` it afterwards — the harness waits for it.
