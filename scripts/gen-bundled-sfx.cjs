// Generates Cutflow's bundled sound effects (shared/sfx/*.mp3) and the renderer
// registry (src/sfx.js) from synthesis recipes — 10/10 step 3.
//
// Every sound is 100% original: synthesized procedurally with the app's own FFmpeg
// from oscillators and filtered noise (chirps, decaying partials, band-swept noise
// segments). No samples, no downloads, no third-party audio. Re-running this script
// reproduces the same files and registry (durations are probed from the output).
//
// Usage: node scripts/gen-bundled-sfx.cjs
// The bundled synthesized SFX were removed 2026-11-13 at Hamza's order: he does
// not want AI-generated/synthesized sounds in the library. The 34 recipes, the
// registry (src/sfx.js), the manifest and the generated files are gone; this
// script is kept only as a record and a no-op, so re-running it never
// regenerates anything. shared/sfx/export-done.mp3 is untouched: it is Hamza's
// own timer-end sound, the export-finished chime, not a library SFX.
console.log('bundled SFX removed — nothing to generate (see header note)');
