// Panel collapse (10/10 step 4, closing the R1 deferral): the left dock and
// the right inspector collapse to a slim rail, the state persists per user in
// the layout's storage key, the player takes the freed width, and the toggles
// are ordinary keymap actions. The pure layout model (src/useLayout.js) is
// exercised directly; the App wiring is pinned by source assertions, the
// pattern the other surface suites use.
// Usage: node scripts/test-layout-collapse.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// useLayout reads window/localStorage lazily (inside functions); stub them
// before the import so clampLayout/load can run headlessly if reached.
globalThis.window = { innerWidth: 1600, innerHeight: 900 };
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { parseLayoutValue, serializeLayout, effectiveWidths, clampLayout, COLLAPSED_W } = await import('../src/useLayout.js');
const { resolveKeymap, actionForEvent } = await import('../src/keymap.js');

// ---- Stored-value validation ------------------------------------------------
{
  const legacy = parseLayoutValue({ left: 460, right: 330, bottom: 340 });
  ok(legacy && eq(legacy.sizes, { left: 460, right: 330, bottom: 340 }), 'a pre-collapse stored layout parses (sizes kept)');
  ok(legacy && eq(legacy.collapsed, { left: false, right: false }), 'a pre-collapse stored layout loads EXPANDED (absence = open)');
  const folded = parseLayoutValue({ left: 460, right: 330, bottom: 340, collapsed: { left: true, right: false } });
  ok(folded && folded.collapsed.left === true && folded.collapsed.right === false, 'stored collapsed flags are honoured per panel');
  ok(parseLayoutValue(null) === null && parseLayoutValue('x') === null, 'non-object stored values are refused');
  ok(parseLayoutValue({ left: 460, right: 330 }) === null, 'a torn stored value (missing size) is refused, not half-applied');
  ok(parseLayoutValue({ left: NaN, right: 330, bottom: 340 }) === null, 'a NaN size refuses the whole value');
  const sloppy = parseLayoutValue({ left: 460, right: 330, bottom: 340, collapsed: { left: 'yes' } });
  ok(sloppy && sloppy.collapsed.left === false, 'a non-boolean collapsed flag reads as expanded (strict true only)');
}

// ---- Persistence round-trip ---------------------------------------------------
{
  const sizes = { left: 512, right: 288, bottom: 301 };
  const collapsed = { left: true, right: false };
  const text = JSON.stringify(serializeLayout(sizes, collapsed));
  const back = parseLayoutValue(JSON.parse(text));
  ok(eq(back.sizes, sizes) && eq(back.collapsed, collapsed), 'serialize -> parse round-trips sizes and collapsed state exactly');
  const backOpen = parseLayoutValue(JSON.parse(JSON.stringify(serializeLayout(sizes, { left: false, right: false }))));
  ok(eq(backOpen.collapsed, { left: false, right: false }), 'an expanded state round-trips as expanded');
}

// ---- Effective widths: the workspace gain is real ------------------------------
{
  const sizes = clampLayout({ left: 460, right: 330, bottom: 340 });
  ok(eq(effectiveWidths(sizes, { left: false, right: false }), { left: 460, right: 330 }), 'expanded panels take their stored sizes');
  const one = effectiveWidths(sizes, { left: true, right: false });
  ok(one.left === COLLAPSED_W && one.right === 330, 'a collapsed dock contributes only its rail width');
  ok(sizes.left - one.left > 400, `collapsing the dock hands the player real width (${sizes.left - one.left}px of ${sizes.left})`);
  const both = effectiveWidths(sizes, { left: true, right: true });
  ok(both.left === COLLAPSED_W && both.right === COLLAPSED_W, 'both panels can collapse at once');
  ok(COLLAPSED_W < 40, 'the rail is slim (a button strip, not a shrunken panel)');
}

// ---- The toggles are keymap actions --------------------------------------------
{
  const map = resolveKeymap(null);
  ok(eq(map.bindings.toggleDock, ['Ctrl+1']) && eq(map.bindings.toggleInspector, ['Ctrl+2']), 'the collapse toggles ship on Ctrl+1 / Ctrl+2');
  const ev = (key, mods = {}) => ({ key, code: mods.code || '', ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta });
  ok(actionForEvent(map, ev('1', { ctrl: true, code: 'Digit1' })) === 'toggleDock', 'Ctrl+1 fires the dock toggle');
  ok(actionForEvent(map, ev('2', { ctrl: true, code: 'Digit2' })) === 'toggleInspector', 'Ctrl+2 fires the inspector toggle');
  const unbound = resolveKeymap({ toggleDock: [] });
  ok(actionForEvent(unbound, ev('1', { ctrl: true, code: 'Digit1' })) === null, 'an unbound toggle stays unbound (the keymap owns the binding)');
}

// ---- Wiring (source assertions, the surface-suite pattern) ----------------------
{
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const app = fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
  const layout = fs.readFileSync(path.join(root, 'src', 'useLayout.js'), 'utf8');
  ok(app.includes("togglePanel('left')") && app.includes("togglePanel('right')"), 'App wires both panel toggles');
  ok(app.includes('effWidths.left') && app.includes('effWidths.right'), 'the workspace grid uses the effective (collapse-aware) widths');
  ok(app.includes('panel-rail') && app.includes('panel-hide-btn'), 'App renders the expand rail and the hide buttons');
  ok(app.includes("case 'toggleDock'") && app.includes("case 'toggleInspector'"), 'the key handler dispatches the two toggle actions');
  ok(layout.includes('collapsed') && layout.includes("KEY = 'clipcraft.layout'"), 'the collapsed state persists in the layout storage key');
  const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
  ok(css.includes('.panel-rail') && css.includes('.panel-hide-btn'), 'the rail and hide-button styles exist');
}

console.log(failures ? `LAYOUT COLLAPSE FAIL — ${failures} assertion(s)` : 'LAYOUT COLLAPSE OK — collapse model, persistence, effective widths, keymap toggles, wiring');
process.exit(failures ? 1 : 0);
