// Accessibility (P2-39, UX-07): setting resolution (explicit choice wins,
// unset follows the OS), the CSS hooks, the meter label size, and the text
// renderer's reduced-motion degrade. The settings store itself
// (electron/settings.cjs) needs Electron, so it is covered by the live app
// check; the pure resolution + the shipped rules are pinned here.
// Usage: node scripts/test-accessibility.mjs
import fs from 'node:fs';
import { resolveAccessibility } from '../src/accessibility.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

// Resolution: explicit true/false wins over the OS; null follows it.
// (In plain Node there is no window, so the OS default is false.)
ok(resolveAccessibility({ reduceMotion: true, reduceFlashing: false }).reduceMotion === true, 'explicit reduceMotion=true wins');
ok(resolveAccessibility({ reduceMotion: false, reduceFlashing: true }).reduceFlashing === true, 'explicit reduceFlashing=true wins');
ok(resolveAccessibility({ reduceMotion: null, reduceFlashing: null }).reduceMotion === false, 'unset follows the OS (false in Node)');
ok(resolveAccessibility({}).reduceFlashing === false, 'missing keys follow the OS');
ok(resolveAccessibility(null).reduceMotion === false, 'null settings follow the OS');

// The CSS hooks the classes drive.
const css = src('../src/styles.css');
ok(css.includes('html.reduce-motion *'), 'reduce-motion CSS rule present');
ok(css.includes('animation-duration: 0.01ms'), 'reduce-motion stills animations/transitions');
ok(css.includes('html.reduce-flashing .flash'), 'reduce-flashing hides the transition flash overlay');

// The meter labels: the spec called out 8.5 px as too small.
const meter = src('../src/components/AudioMeter.jsx');
ok(!meter.includes('8.5px'), 'AudioMeter no longer uses 8.5px labels');
ok(meter.includes("11px system-ui"), 'AudioMeter tick + channel labels are 11px');
ok(meter.includes('aria-label'), 'AudioMeter canvas carries an accessible label');

// The text renderer degrades flicker/glitch to fades under reduced motion.
const render = src('../src/text/render.js');
ok(render.includes('setTextReducedMotion'), 'text renderer exposes a reduced-motion flag');
ok(render.includes("case 'flicker': s.alpha = textReducedMotion() ? p :"), 'flicker anim degrades to a fade');
ok(render.includes('textReducedMotion() || (hsh % 4) !== 0'), 'per-char flicker blink is gated');

// The setting is stored, exposed, and wired end to end.
const settings = src('../electron/settings.cjs');
ok(settings.includes('getReduceMotion') && settings.includes('getReduceFlashing'), 'settings store has reduceMotion/reduceFlashing getters');
ok(settings.includes('reduceMotion: getReduceMotion()'), 'getPublic exposes reduceMotion');
const main = src('../electron/main.cjs');
ok(main.includes("settings:setReduceMotion") && main.includes("settings:setReduceFlashing"), 'main registers the setting IPC handlers');
const preload = src('../electron/preload.cjs');
ok(preload.includes('settingsSetReduceMotion') && preload.includes('settingsSetReduceFlashing'), 'preload exposes the setting setters');
const dialog = src('../src/components/SettingsDialog.jsx');
ok(dialog.includes('AccessibilitySettings') && dialog.includes("section === 'accessibility'"), 'Settings has an Accessibility section');
const app = src('../src/App.jsx');
ok(app.includes('applyAccessibilitySettings'), 'App applies the accessibility settings on load / settings change');

if (failures) { console.log(`test-accessibility: FAIL (${failures} failures)`); process.exit(1); }
console.log('test-accessibility: PASS');
