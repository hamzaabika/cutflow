// Customisable keyboard shortcuts (Sprint 11, parity-matrix §9 row).
//   - The catalogue ships the bindings existing users already have; the
//     defaults must be internally consistent (no chord claimed twice).
//   - Overrides replace an action's bindings wholesale (an explicit empty
//     array unbinds); malformed input is dropped, never thrown on.
//   - A remap fires: the resolved action for the new key is the action, and
//     the old key no longer fires it. Persistence round-trips through the
//     real settings store (electron/settings.cjs against a temp dir), so a
//     restart reads the same bindings back.
//   - Wiring: App's handler, Preview's full-screen key and the Settings
//     rebind surface all resolve through the same keymap module.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const km = await import('../src/keymap.js');
const { KEY_ACTIONS, parseChord, chordFromEvent, resolveKeymap, diffOverrides, actionForEvent, bindingHint, firstBinding, formatChord } = km;

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ev = (key, mods = {}) => ({ key, code: mods.code || '', ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });

// --- Catalogue -----------------------------------------------------------------
{
  // 22 since 10/10 step 4: toggleDock / toggleInspector (panel collapse) joined
  // the catalogue — the pin moves WITH the growth, as it exists to catch LOSS.
  ok(KEY_ACTIONS.length === 22, `catalogue: 22 remappable actions (got ${KEY_ACTIONS.length})`);
  ok(KEY_ACTIONS.every((a) => a.defaults.length >= 1), 'catalogue: every action ships at least one default binding');
  const seen = new Map();
  let dup = null;
  for (const a of KEY_ACTIONS) for (const c of a.defaults) { if (seen.has(c)) dup = c; seen.set(c, a.id); }
  ok(!dup, `catalogue: no chord claimed by two actions in the defaults${dup ? ` (duplicate: ${dup})` : ''}`);
  const defaults = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.defaults]));
  ok(eq(resolveKeymap(null).bindings, defaults), 'defaults: resolving no overrides reproduces the shipped bindings exactly');
  ok(eq(resolveKeymap(undefined).overrides, {}), 'defaults: no overrides stored for an untouched keymap');
}

// --- Chord algebra ---------------------------------------------------------------
{
  ok(parseChord('ctrl+s') === 'Ctrl+S', 'parse: modifiers canonicalised (ctrl+s -> Ctrl+S)');
  ok(parseChord('shift + ctrl + S') === 'Ctrl+Shift+S', 'parse: modifier order normalised to Ctrl, Alt, Shift');
  ok(parseChord('space') === 'Space' && parseChord('delete') === 'Delete' && parseChord('f5') === 'F5', 'parse: named keys canonicalised');
  ok(parseChord('Ctrl+') === null && parseChord('') === null && parseChord('Foo+S') === null && parseChord('Ctrl+Ctrl+S') === null,
    'parse: malformed chords refused (trailing +, empty, unknown modifier, duplicated modifier)');
  ok(chordFromEvent(ev('s', { ctrl: true })) === 'Ctrl+S', 'event: Ctrl+S');
  ok(chordFromEvent(ev('S', { ctrl: true, shift: true })) === 'Ctrl+Shift+S', 'event: Ctrl+Shift+S (key case normalised)');
  ok(chordFromEvent(ev(' ', { code: 'Space' })) === 'Space', 'event: space bar via e.code');
  ok(chordFromEvent(ev('s', { meta: true })) === 'Ctrl+S', 'event: Cmd folds into Ctrl (macOS)');
  ok(chordFromEvent(ev('Control', { ctrl: true })) === null && chordFromEvent(ev('Dead')) === null,
    'event: a modifier on its own and dead keys are not chords');
}

// --- Resolution: remap, unbind, arbitration --------------------------------------
{
  const map = resolveKeymap({ split: ['Ctrl+K'] });
  ok(eq(map.bindings.split, ['Ctrl+K']), 'remap: the override replaces the defaults wholesale');
  ok(actionForEvent(map, ev('k', { ctrl: true })) === 'split', 'remap fires: Ctrl+K now splits');
  ok(actionForEvent(map, ev('s')) === null && actionForEvent(map, ev('b', { ctrl: true })) === null,
    'remap fires: the old keys (S, Ctrl+B) no longer split');

  const unbound = resolveKeymap({ split: [] });
  ok(eq(unbound.bindings.split, []), 'unbind: an explicit empty list stays unbound (no fallback to defaults)');
  ok(actionForEvent(unbound, ev('s')) === null, 'unbind: the action fires on nothing');

  const dirty = resolveKeymap({ nope: ['Ctrl+Q'], split: ['bogus chord!', 'Ctrl+K', 'Ctrl+K', 42] });
  ok(!('nope' in dirty.bindings) && eq(dirty.bindings.split, ['Ctrl+K']),
    'sanitise: unknown actions, invalid chords, duplicates and non-strings are dropped');

  const clash = resolveKeymap({ play: ['Ctrl+Z'] });
  ok(clash.byChord['Ctrl+Z'] === 'play', 'arbitration: a chord claimed twice goes to the earlier catalogue action (the Settings conflict flow prevents this state)');

  ok(eq(diffOverrides(resolveKeymap({ split: ['Ctrl+K'], play: [] }).bindings), { play: [], split: ['Ctrl+K'] }),
    'diff: only actions differing from the defaults are persisted');
  ok(eq(diffOverrides(resolveKeymap(null).bindings), {}), 'diff: defaults persist as an empty object');
}

// --- Matching semantics (what existing users keep) --------------------------------
{
  const map = resolveKeymap(null);
  ok(actionForEvent(map, ev('s', { ctrl: true })) === 'save', 'match: Ctrl+S saves');
  ok(actionForEvent(map, ev('s', { ctrl: true, alt: true })) === 'save', 'match: Ctrl+Alt+S is the Save-as binding of the same action');
  ok(actionForEvent(map, ev('s', { ctrl: true, shift: true })) === 'extractAudio', 'match: exact Ctrl+Shift+S wins over the strip-Shift fallback');
  ok(actionForEvent(map, ev(' ', { code: 'Space' })) === 'play', 'match: Space plays');
  ok(actionForEvent(map, ev('S', { shift: true })) === 'split', 'match: Shift+S still splits (Shift is a parameter, not a new key)');
  ok(actionForEvent(map, ev('s', { alt: true })) === 'split', 'match: Alt+S still splits (legacy fallthrough kept)');
  ok(actionForEvent(map, ev('z', { ctrl: true })) === 'undo' && actionForEvent(map, ev('z', { ctrl: true, shift: true })) === 'redo' && actionForEvent(map, ev('y', { ctrl: true })) === 'redo',
    'match: Ctrl+Z undo, Ctrl+Shift+Z / Ctrl+Y redo');
  ok(actionForEvent(map, ev('q', { ctrl: true })) === null, 'match: Ctrl is never stripped (Ctrl+Q is not Q)');
  ok(actionForEvent(map, ev('ArrowLeft', { shift: true })) === 'seekBack', 'match: Shift+Arrow still seeks (the handler reads Shift for the coarse step)');
  ok(actionForEvent(map, ev('f')) === 'fullscreen', 'match: F is the full-screen action the preview resolves');
}

// --- Hint rendering ----------------------------------------------------------------
{
  const map = resolveKeymap(null);
  ok(bindingHint(map, 'split') === 'S / Ctrl+B', `hints: split reads "S / Ctrl+B" (got "${bindingHint(map, 'split')}")`);
  ok(firstBinding(map, 'remove') === 'Del' && firstBinding(map, 'extractAudio') === 'Ctrl+Shift+S', 'hints: the menu binding is the first binding, compactly formatted');
  ok(formatChord('ArrowLeft') === '←' && formatChord('Escape') === 'Esc', 'hints: arrows and Escape get compact glyphs');
  ok(firstBinding(resolveKeymap({ split: [] }), 'split') === '', 'hints: an unbound action has no hint to show');
}

// --- Persistence through the real settings store -----------------------------------
{
  const require = createRequire(import.meta.url);
  const smoke = fs.mkdtempSync(path.join(os.tmpdir(), 'fve-keymap-'));
  process.env.FVE_SMOKE = smoke;
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath, filename: electronPath, loaded: true,
    exports: {
      app: { getPath: () => smoke },
      safeStorage: { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
    },
  };
  const settingsPath = require.resolve('../electron/settings.cjs');
  delete require.cache[settingsPath];
  const settings = require(settingsPath);
  ok(eq(settings.getKeymap(), {}), 'store: a fresh install has no stored overrides');
  settings.setKeymap({ split: ['Ctrl+K'], play: [], junk: 'not-a-list', cut: ['Ctrl+X', 7] });
  ok(eq(settings.getKeymap(), { split: ['Ctrl+K'], play: [], cut: ['Ctrl+X'] }),
    `store: setKeymap sanitises and persists (got ${JSON.stringify(settings.getKeymap())})`);
  ok(settings.getPublic().keystrokes === false, 'store: keystroke display defaults to off');
  settings.setKeystrokes(true);
  ok(settings.getPublic().keystrokes === true, 'store: keystroke display toggles on and is public');
  // A restart: drop the module and read the file back cold.
  delete require.cache[settingsPath];
  const again = require(settingsPath);
  ok(eq(again.getKeymap(), { split: ['Ctrl+K'], play: [], cut: ['Ctrl+X'] }) && again.getKeymap().play.length === 0,
    'store: bindings survive a restart (read back from settings.json)');
  ok(resolveKeymap(again.getKeymap()).bindings.split[0] === 'Ctrl+K', 'store: the persisted diff resolves to the remapped binding');
  fs.rmSync(smoke, { recursive: true, force: true });
}

// --- Wiring -------------------------------------------------------------------------
{
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const preview = fs.readFileSync(new URL('../src/components/Preview.jsx', import.meta.url), 'utf8');
  const dialog = fs.readFileSync(new URL('../src/components/SettingsDialog.jsx', import.meta.url), 'utf8');
  const preload = fs.readFileSync(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  ok(app.includes('actionForEvent(getCurrentKeymap(), e)'), 'wiring: the App key handler resolves through the shared keymap');
  ok(app.includes('applyKeymapOverrides') && app.includes('KeystrokesOverlay'), 'wiring: App loads the persisted keymap and mounts the keystroke overlay');
  ok(preview.includes("actionForEvent(getCurrentKeymap(), e) !== 'fullscreen'"), 'wiring: the preview full-screen key resolves through the same keymap');
  ok(dialog.includes('settingsSetKeymap') && dialog.includes('settingsSetKeystrokes'), 'wiring: Settings persists rebindings and the keystroke toggle');
  ok(preload.includes('settingsSetKeymap') && main.includes("'settings:setKeymap'"), 'wiring: preload + main carry the keymap IPC');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nKEYMAP OK');
process.exit(fails.length ? 1 : 0);
