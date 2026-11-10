// On-screen keystroke display (Sprint 11, parity-matrix §9 row): what the
// overlay may show for a key event. The rule that matters is the matrix's:
// NEVER capture text content. So this module only ever produces chord
// labels built from modifier names and key NAMES — a printable character
// is shown solely when it was pressed outside any text field (where it is
// an editor shortcut, not text), and nothing at all is shown for keys
// pressed into a password field, not even combos: a password field gets
// complete silence.
import { chordFromEvent, formatChord } from './keymap.js';

// Keys that are text editing in a field: showing them would narrate the
// user's typing ('Backspace Backspace x') without ever showing a shortcut.
const TEXT_EDITING_KEYS = new Set([
  'Space', 'Backspace', 'Delete', 'Enter', 'Tab',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
]);

// e: a KeyboardEvent (or a stand-in with the same fields).
// ctx: { inText, inPassword } — the event target is a text-entry element /
// a password field. Returns the label to display, or null to stay silent.
export function strokeLabel(e, ctx = {}) {
  if (ctx.inPassword) return null;
  const chord = chordFromEvent(e);
  if (!chord) return null;
  const parts = chord.split('+');
  const key = parts[parts.length - 1];
  const hasComboMod = parts.length > 1 && parts.slice(0, -1).some((m) => m === 'Ctrl' || m === 'Alt');
  // Combos (Ctrl/Alt + anything) are commands, never content — always shown.
  if (hasComboMod) return formatChord(chord);
  if (ctx.inText) {
    // In a text field, only mode-level keys are shown; characters and
    // editing keys belong to the text, not to the shortcut layer.
    if (key.length === 1 || TEXT_EDITING_KEYS.has(key)) return null;
    return formatChord(chord); // Escape, F-keys, ...
  }
  return formatChord(chord);
}
