// On-screen keystroke display (Sprint 11, parity-matrix §9 row).
// The overlay may only ever show chord LABELS (modifier names + key
// names). This suite pins the silence rules of src/keystrokes.js: nothing
// from a password field at all, no typed characters or editing keys from
// text fields — the display must never become a transcript of what the
// user types.
import fs from 'node:fs';

const { strokeLabel } = await import('../src/keystrokes.js');

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const ev = (key, mods = {}) => ({ key, code: mods.code || '', ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift });

// --- The silence rules ------------------------------------------------------------------
ok(strokeLabel(ev('x'), { inPassword: true }) === null, 'password: a character shows nothing');
ok(strokeLabel(ev('s', { ctrl: true }), { inPassword: true }) === null, 'password: even a combo shows nothing');
ok(strokeLabel(ev('F5'), { inPassword: true }) === null, 'password: function keys show nothing');
ok(strokeLabel(ev('a'), { inText: true }) === null, 'text field: a typed character shows nothing');
ok(strokeLabel(ev('A', { shift: true }), { inText: true }) === null, 'text field: a typed capital shows nothing');
ok(strokeLabel(ev(' ', { code: 'Space' }), { inText: true }) === null, 'text field: the space bar is typing, not a shortcut');
ok(strokeLabel(ev('Backspace'), { inText: true }) === null && strokeLabel(ev('Enter'), { inText: true }) === null,
  'text field: editing keys (Backspace, Enter) show nothing');
ok(strokeLabel(ev('ArrowLeft'), { inText: true }) === null, 'text field: caret movement shows nothing');

// --- What does show -----------------------------------------------------------------------
ok(strokeLabel(ev('s', { ctrl: true }), { inText: true }) === 'Ctrl+S', 'combos are commands: Ctrl+S shows even from a text field');
ok(strokeLabel(ev('z', { ctrl: true, shift: true }), {}) === 'Ctrl+Shift+Z', 'combo label: modifiers in Ctrl, Alt, Shift order');
ok(strokeLabel(ev('a'), {}) === 'A', 'outside text: a shortcut letter shows (it fired an action, not text)');
ok(strokeLabel(ev(' ', { code: 'Space' }), {}) === 'Space', 'outside text: Space shows (play/pause)');
ok(strokeLabel(ev('Escape'), { inText: true }) === 'Esc', 'mode keys show from a text field too (Escape leaves the field)');
ok(strokeLabel(ev('Backspace'), {}) === 'Backspace', 'outside text: Backspace is the delete shortcut and shows');
ok(strokeLabel(ev('F5'), {}) === 'F5', 'function keys show');
ok(strokeLabel(ev('Control', { ctrl: true }), {}) === null, 'a modifier on its own shows nothing');
ok(strokeLabel(ev('Dead'), {}) === null, 'dead/IME keys show nothing');

// --- Wiring -----------------------------------------------------------------------------------
{
  const overlay = fs.readFileSync(new URL('../src/components/KeystrokesOverlay.jsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/components/SettingsDialog.jsx', import.meta.url), 'utf8');
  ok(overlay.includes('strokeLabel') && overlay.includes('isKeyCaptureActive'), 'wiring: the overlay labels via strokeLabel and stands down during a rebind capture');
  ok(dialog.includes('Show keystrokes on screen'), 'wiring: the toggle lives in Settings > Keyboard with its on/off state visible');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nKEYSTROKES OK');
process.exit(fails.length ? 1 : 0);
