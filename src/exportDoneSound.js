// Export-finished sound: Hamza's own timer-end sound (shared/sfx/export-done.mp3,
// his file timer-end.mp3 copied verbatim — NOT synthesized, NOT in the bundled SFX
// registry or the timeline SFX library) played when a video or audio export
// completes successfully. Best-effort by design — a missing file, a denied settings
// read, or a blocked play() never fails or delays the export; the sound is only
// skipped, never retried. The user turns it off in Settings › Quality.
import { toFileUrl } from './store.js';

let audio = null;

export async function playExportDoneSound() {
  try {
    const st = await window.api?.settingsGet?.();
    if (st && st.exportSound === false) return false;
    const p = await window.api?.bundledPath?.('sfx', 'export-done.mp3');
    if (!p) return false;
    if (!audio) audio = new Audio();
    audio.src = toFileUrl(p);
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
