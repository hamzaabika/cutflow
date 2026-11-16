// Workspaces (P2-37): preset definitions, stored-value parsing, and the
// per-workspace arrangement resolution — pure, no DOM.
// Usage: node scripts/test-workspaces.mjs
import { WORKSPACES, WORKSPACE_IDS, workspaceById, parseWorkspaceState, parseWorkspacesValue, defaultWorkspacesValue, stateFor } from '../src/useWorkspaces.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

ok(WORKSPACE_IDS.length === 6, `six workspaces defined: ${WORKSPACE_IDS.join(',')}`);
ok(['short-form', 'youtube', 'audio', 'captions', 'color'].every((id) => WORKSPACE_IDS.includes(id)), 'all five named workspaces present');
ok(new Set(WORKSPACES.map((w) => w.tab)).size >= 4, 'presets spread across panels (not all one tab)');
for (const w of WORKSPACES) {
  ok(['media', 'audio', 'text', 'captions', 'stickers', 'effects', 'transitions', 'filters', 'adjust', 'composer', 'brand', 'forge'].includes(w.tab), `${w.id} preset tab is a real panel: ${w.tab}`);
  ok([w.sizes.left, w.sizes.right, w.sizes.bottom].every((n) => Number.isFinite(n) && n > 0), `${w.id} preset sizes are finite positive numbers`);
}
ok(workspaceById('nope').id === 'default', 'unknown workspace id falls back to default');
ok(workspaceById('audio').tab === 'audio', 'audio workspace opens the Audio panel');
ok(workspaceById('color').tab === 'adjust', 'color workspace opens the Adjust panel');
ok(workspaceById('short-form').tab === 'captions', 'short-form workspace opens the Captions panel');

// Parsing: valid values survive, corrupt ones are discarded, never crash.
ok(parseWorkspaceState({ tab: 'audio', sizes: { left: 420, right: 330, bottom: 460 }, collapsed: { left: false, right: false } })?.tab === 'audio', 'valid saved state parses');
ok(parseWorkspaceState({ tab: 'audio', sizes: { left: NaN, right: 330, bottom: 460 } }) === null, 'NaN size rejected');
ok(parseWorkspaceState({ tab: '', sizes: { left: 1, right: 1, bottom: 1 } }) === null, 'empty tab rejected');
ok(parseWorkspaceState(null) === null && parseWorkspaceState('x') === null, 'non-object state rejected');
const parsed = parseWorkspacesValue({ active: 'audio', states: { audio: { tab: 'audio', sizes: { left: 500, right: 300, bottom: 500 }, collapsed: { left: true, right: false } }, bogus: { tab: 'media', sizes: { left: 1, right: 1, bottom: 1 } } } });
ok(parsed.active === 'audio' && parsed.states.audio.sizes.left === 500 && !parsed.states.bogus, 'stored value parses, unknown workspace dropped');
ok(parseWorkspacesValue({ active: 'nope', states: {} }).active === 'default', 'unknown active workspace falls back to default');
ok(parseWorkspacesValue(null) === null, 'null value rejected (caller falls back to defaults)');

// Resolution: a saved arrangement wins; an unsaved workspace gets its preset.
const base = defaultWorkspacesValue();
ok(stateFor(base, 'audio').tab === 'audio', 'default value resolves the audio preset');
const withSave = { ...base, states: { ...base.states, audio: { tab: 'effects', sizes: { left: 600, right: 300, bottom: 300 }, collapsed: { left: false, right: false } } } };
ok(stateFor(withSave, 'audio').tab === 'effects' && stateFor(withSave, 'audio').sizes.left === 600, 'saved arrangement overrides the preset (switch preserves panel state)');
ok(stateFor(withSave, 'color').tab === 'adjust', 'an untouched workspace still resolves its preset');

if (failures) { console.log(`test-workspaces: FAIL (${failures} failures)`); process.exit(1); }
console.log('test-workspaces: PASS');
