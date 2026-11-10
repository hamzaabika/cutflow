// Customisable keyboard shortcuts (Sprint 11, parity-matrix §9 row
// "Customisable shortcuts"). This module is the ONE source of truth for the
// editor's key bindings: the action catalogue with its shipped defaults, the
// chord algebra (event -> chord, chord parsing/formatting), resolution of the
// user's stored overrides over the defaults, and event matching.
//
// A chord is a canonical string: modifiers in Ctrl, Alt, Shift order joined
// with '+', then the key token — 'Ctrl+Shift+S', 'Space', 'Delete', 'Q'.
// Key tokens come from KeyboardEvent.key: single characters are uppercased,
// named keys keep their DOM spelling ('ArrowLeft', 'Home', 'Backspace', ...),
// and the space bar is 'Space' (matched via e.code, like the old handler).
//
// Persistence: only the DIFF from the defaults is stored (settings.cjs,
// settings.json `keymap`), as { actionId: [chord, ...] } — an action the user
// unbound is stored as an empty array, which must NOT fall back to defaults.
// resolveKeymap() sanitises anything it is given: unknown actions, malformed
// chords and duplicate chords are dropped, never thrown on, so a hand-edited
// or corrupt settings file can only ever cost a binding, never the editor.
//
// Matching (actionForEvent) is deliberately at least as permissive as the
// hardcoded handler this replaced: exact chord first, then the chord with
// Shift removed, then Alt removed, then both — Shift/Alt act as parameters
// (Shift+arrows seek coarsely, Ctrl+Alt+S is Save-as) rather than wholly
// different keys. Ctrl is never stripped: Ctrl+<key> is a different command
// from <key>, not a variant of it.

export const MOD_ORDER = ['Ctrl', 'Alt', 'Shift'];

// Named (non-printable) keys a chord may use, in their canonical spelling.
export const NAMED_KEYS = [
  'Space', 'Delete', 'Backspace', 'Escape', 'Enter', 'Tab', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
];
const NAMED_BY_LOWER = Object.fromEntries(NAMED_KEYS.map((k) => [k.toLowerCase(), k]));

// The editor's remappable actions. `defaults` order is display order for
// hints (first binding is the one menus show). Component-local keys
// (Escape closes a dialog, Enter confirms) are UI chrome, not editor
// actions, and are deliberately not in this catalogue.
export const KEY_ACTIONS = [
  { id: 'play', label: 'Play / pause', defaults: ['Space'] },
  { id: 'split', label: 'Split clip at playhead', defaults: ['S', 'Ctrl+B'] },
  { id: 'trimLeft', label: 'Delete left of playhead', defaults: ['Q'] },
  { id: 'trimRight', label: 'Delete right of playhead', defaults: ['W'] },
  { id: 'remove', label: 'Delete selection', defaults: ['Delete', 'Backspace'] },
  { id: 'duplicate', label: 'Duplicate clip', defaults: ['Ctrl+D'] },
  { id: 'copy', label: 'Copy clip', defaults: ['Ctrl+C'] },
  { id: 'cut', label: 'Cut clip', defaults: ['Ctrl+X'] },
  { id: 'paste', label: 'Paste clip', defaults: ['Ctrl+V'] },
  { id: 'extractAudio', label: 'Detach audio', defaults: ['Ctrl+Shift+S'] },
  { id: 'save', label: 'Save project (with Alt: Save as)', defaults: ['Ctrl+S', 'Ctrl+Alt+S'] },
  { id: 'undo', label: 'Undo', defaults: ['Ctrl+Z'] },
  { id: 'redo', label: 'Redo', defaults: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'seekBack', label: 'Step back (Shift: 1 second)', defaults: ['ArrowLeft'] },
  { id: 'seekFwd', label: 'Step forward (Shift: 1 second)', defaults: ['ArrowRight'] },
  { id: 'seekStart', label: 'Go to start', defaults: ['Home'] },
  { id: 'marker', label: 'Marker at playhead', defaults: ['M'] },
  { id: 'toolRazor', label: 'Razor tool', defaults: ['B'] },
  { id: 'toolSelect', label: 'Select tool', defaults: ['V', 'Escape'] },
  { id: 'fullscreen', label: 'Full-screen player', defaults: ['F'] },
  { id: 'toggleDock', label: 'Show / hide the left panel', defaults: ['Ctrl+1'] },
  { id: 'toggleInspector', label: 'Show / hide the properties panel', defaults: ['Ctrl+2'] },
];
export const KEY_ACTION_IDS = KEY_ACTIONS.map((a) => a.id);
const ACTION_BY_ID = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a]));

// Normalise one key token (the non-modifier part of a chord). Returns the
// canonical token or null when the token cannot be bound.
export function parseKeyToken(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const named = NAMED_BY_LOWER[raw.toLowerCase()];
  if (named) return named;
  if (raw.length === 1 && raw !== '+' && !/[\s]/.test(raw)) return raw.toUpperCase();
  return null;
}

// Parse a chord string into its canonical form ('ctrl + s' -> 'Ctrl+S').
// Returns null for anything malformed: unknown modifier, missing key,
// duplicated modifier, a modifier as the key.
export function parseChord(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const keyRaw = parts[parts.length - 1];
  const key = parseKeyToken(keyRaw);
  if (!key) return null;
  const mods = new Set();
  for (const p of parts.slice(0, -1)) {
    const m = MOD_ORDER.find((x) => x.toLowerCase() === p.toLowerCase());
    if (!m || mods.has(m)) return null;
    mods.add(m);
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

// The chord a KeyboardEvent represents, or null when the event is not a
// bindable key press (a modifier on its own, a dead/IME key).
export function chordFromEvent(e) {
  if (!e || typeof e.key !== 'string') return null;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  if (e.key === 'Dead' || e.key === 'Process' || e.key === 'Unidentified') return null;
  const key = e.code === 'Space' || e.key === ' ' ? 'Space' : parseKeyToken(e.key);
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

// Sanitise a stored overrides object: known actions only, canonical chords
// only, no chord repeated inside one action. Anything unusable is dropped.
export function sanitizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of KEY_ACTION_IDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const list = Array.isArray(raw[id]) ? raw[id] : [];
    const seen = new Set();
    const chords = [];
    for (const c of list) {
      const canon = parseChord(c);
      if (canon && !seen.has(canon)) { seen.add(canon); chords.push(canon); }
    }
    out[id] = chords;
  }
  return out;
}

// The effective keymap: stored overrides replace an action's bindings
// wholesale (an explicit empty array means "unbound"); untouched actions
// keep their defaults. If two actions claim the same chord, the earlier
// action in the catalogue keeps it — the Settings UI prevents creating
// that state (its conflict flow steals explicitly), so this only arbitrates
// hand-edited or stale files. Returns { bindings, byChord, overrides }.
export function resolveKeymap(rawOverrides) {
  const overrides = sanitizeOverrides(rawOverrides);
  const bindings = {};
  for (const a of KEY_ACTIONS) {
    bindings[a.id] = Object.prototype.hasOwnProperty.call(overrides, a.id)
      ? [...overrides[a.id]]
      : [...a.defaults];
  }
  const byChord = {};
  for (const a of KEY_ACTIONS) {
    for (const chord of bindings[a.id]) {
      if (!byChord[chord]) byChord[chord] = a.id;
    }
  }
  return { bindings, byChord, overrides };
}

// The diff to persist for a bindings table: only actions whose bindings
// differ from the shipped defaults.
export function diffOverrides(bindings) {
  const out = {};
  for (const a of KEY_ACTIONS) {
    const cur = bindings[a.id] || [];
    const same = cur.length === a.defaults.length && cur.every((c, i) => c === a.defaults[i]);
    if (!same) out[a.id] = [...cur];
  }
  return out;
}

// Which action a key event fires under an effective keymap (see the header
// for the strip-Shift/Alt fallback). Returns the action id or null.
export function actionForEvent(map, e) {
  const chord = chordFromEvent(e);
  if (!chord) return null;
  if (map.byChord[chord]) return map.byChord[chord];
  const parts = chord.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const variants = [
    mods.filter((m) => m !== 'Shift'),
    mods.filter((m) => m !== 'Alt'),
    mods.filter((m) => m !== 'Shift' && m !== 'Alt'),
  ];
  for (const v of variants) {
    const candidate = [...v, key].join('+');
    if (candidate !== chord && map.byChord[candidate]) return map.byChord[candidate];
  }
  return null;
}

// Display forms. Chords read 'Ctrl+Shift+S'; a few keys get compact glyphs
// so hints fit menus and toolbars ('Del', 'Esc', arrows).
const KEY_GLYPHS = { Delete: 'Del', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
export function formatChord(chord) {
  if (!chord) return '';
  const parts = chord.split('+');
  parts[parts.length - 1] = KEY_GLYPHS[parts[parts.length - 1]] || parts[parts.length - 1];
  return parts.join('+');
}
// 'S / Ctrl+B' — every binding of an action, for tooltips and lists.
export function bindingHint(map, id) {
  return (map.bindings[id] || []).map(formatChord).join(' / ');
}
// The one binding menus show, or '' when the action is unbound.
export function firstBinding(map, id) {
  const list = map.bindings[id] || [];
  return list.length ? formatChord(list[0]) : '';
}
export const actionLabel = (id) => (ACTION_BY_ID[id] ? ACTION_BY_ID[id].label : id);

// ---- Renderer-wide current keymap --------------------------------------
// App owns loading/persisting; any component (Preview's F key, toolbar and
// menu hint renderers) reads the same effective map here instead of
// threading props through the whole tree. It starts at the defaults, so
// hints are correct before settings have loaded.
let current = resolveKeymap(null);
export function getCurrentKeymap() { return current; }
export function setCurrentKeymap(map) { current = map || resolveKeymap(null); return current; }
export function applyKeymapOverrides(overrides) { return setCurrentKeymap(resolveKeymap(overrides)); }

// While Settings is capturing a key for a rebind, editor shortcuts must
// stand down (the key being bound must not also fire its old action).
let captureActive = false;
export function setKeyCaptureActive(on) { captureActive = !!on; }
export function isKeyCaptureActive() { return captureActive; }
