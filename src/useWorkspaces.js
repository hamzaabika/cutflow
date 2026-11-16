// Workspaces (P2-37, UX-05): named panel arrangements — Short-form, YouTube,
// Audio, Captions, Color — plus the Default arrangement. A workspace is a
// saved { left tab, panel sizes, collapsed flags }: switching saves the
// arrangement you leave and restores the one you return to, so panel state
// survives the switch; Reset restores the active workspace's shipped preset
// in one click. Stored in localStorage `clipcraft.workspaces.v1` (per-user
// convenience only, like `clipcraft.layout`); a torn or hand-edited value
// falls back to the presets, never to a broken layout.
import { useCallback, useEffect, useRef, useState } from 'react';

export const WORKSPACE_KEY = 'clipcraft.workspaces.v1';

// Shipped presets. Sizes are the useLayout numbers (px; bottom = timeline
// height). bottom is a fraction-free px value so a preset is identical on
// any window height; useLayout clamps it to the window on load.
export const WORKSPACES = [
  { id: 'default', tab: 'media', sizes: { left: 460, right: 330, bottom: 380 }, collapsed: { left: false, right: false } },
  { id: 'short-form', tab: 'captions', sizes: { left: 400, right: 300, bottom: 340 }, collapsed: { left: false, right: false } },
  { id: 'youtube', tab: 'media', sizes: { left: 460, right: 360, bottom: 400 }, collapsed: { left: false, right: false } },
  { id: 'audio', tab: 'audio', sizes: { left: 420, right: 330, bottom: 460 }, collapsed: { left: false, right: false } },
  { id: 'captions', tab: 'captions', sizes: { left: 540, right: 300, bottom: 340 }, collapsed: { left: false, right: false } },
  { id: 'color', tab: 'adjust', sizes: { left: 380, right: 440, bottom: 340 }, collapsed: { left: false, right: false } },
];

export const WORKSPACE_IDS = WORKSPACES.map((w) => w.id);
export const workspaceById = (id) => WORKSPACES.find((w) => w.id === id) || WORKSPACES[0];

// A saved arrangement is valid only when its numbers are finite and its tab
// is a real panel id; anything else is discarded so a corrupt entry can cost
// a saved arrangement, never the editor.
export function parseWorkspaceState(v) {
  if (!v || typeof v !== 'object') return null;
  const { tab, sizes, collapsed } = v;
  if (typeof tab !== 'string' || !tab) return null;
  if (!sizes || ![sizes.left, sizes.right, sizes.bottom].every((n) => Number.isFinite(n))) return null;
  return {
    tab,
    sizes: { left: sizes.left, right: sizes.right, bottom: sizes.bottom },
    collapsed: { left: collapsed?.left === true, right: collapsed?.right === true },
  };
}

export function parseWorkspacesValue(v) {
  if (!v || typeof v !== 'object') return null;
  const active = typeof v.active === 'string' && WORKSPACE_IDS.includes(v.active) ? v.active : 'default';
  const states = {};
  if (v.states && typeof v.states === 'object') {
    for (const [id, st] of Object.entries(v.states)) {
      if (!WORKSPACE_IDS.includes(id)) continue;
      const parsed = parseWorkspaceState(st);
      if (parsed) states[id] = parsed;
    }
  }
  return { active, states };
}

export function defaultWorkspacesValue() {
  return {
    active: 'default',
    states: Object.fromEntries(WORKSPACES.map((w) => [w.id, { tab: w.tab, sizes: { ...w.sizes }, collapsed: { ...w.collapsed } }])),
  };
}

function load() {
  try {
    const parsed = parseWorkspacesValue(JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null'));
    if (parsed) {
      // A stored value that predates a preset (or lost one to corruption)
      // still gets every preset as its fallback.
      const base = defaultWorkspacesValue();
      return { active: parsed.active, states: { ...base.states, ...parsed.states } };
    }
  } catch { /* defaults */ }
  return defaultWorkspacesValue();
}

// The arrangement the editor should show for a workspace id: the saved one,
// or the shipped preset when nothing was ever saved for it.
export function stateFor(value, id) {
  const preset = workspaceById(id);
  return value.states[id] || { tab: preset.tab, sizes: { ...preset.sizes }, collapsed: { ...preset.collapsed } };
}

// React hook: owns the active workspace + the saved arrangement of each one.
// `snapshot` is the live editor state { tab, sizes, collapsed } the caller
// passes in; it is saved (debounced) under the active workspace so a switch
// away and back restores exactly what was left.
export function useWorkspaces(snapshot) {
  const [value, setValue] = useState(load);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(value)); } catch { /* not saved: fine */ }
  }, [value]);

  // Save the live arrangement under the active workspace, debounced so a
  // panel drag writes once when it settles instead of once per pointer move.
  useEffect(() => {
    if (!snapshot) return;
    const t = setTimeout(() => {
      setValue((v) => {
        const cur = parseWorkspaceState(snapshot);
        if (!cur) return v;
        const prev = v.states[v.active];
        if (prev && prev.tab === cur.tab && prev.sizes.left === cur.sizes.left && prev.sizes.right === cur.sizes.right
          && prev.sizes.bottom === cur.sizes.bottom && prev.collapsed.left === cur.collapsed.left && prev.collapsed.right === cur.collapsed.right) return v;
        return { ...v, states: { ...v.states, [v.active]: cur } };
      });
    }, 400);
    return () => clearTimeout(t);
  }, [snapshot?.tab, snapshot?.sizes?.left, snapshot?.sizes?.right, snapshot?.sizes?.bottom, snapshot?.collapsed?.left, snapshot?.collapsed?.right]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switch to a workspace: returns the arrangement to apply ({ tab, sizes,
  // collapsed }). The live arrangement is saved under the workspace being
  // left first, so returning restores it.
  const applyWorkspace = useCallback((id) => {
    const target = WORKSPACE_IDS.includes(id) ? id : 'default';
    let next = null;
    setValue((v) => {
      const cur = parseWorkspaceState(snapshotRef.current);
      const states = { ...v.states };
      if (cur) states[v.active] = cur;
      next = stateFor({ ...v, states }, target);
      return { active: target, states };
    });
    return next || stateFor(defaultWorkspacesValue(), target);
  }, []);

  // Reset the ACTIVE workspace to its shipped preset, in one click; returns
  // the preset arrangement to apply.
  const resetWorkspace = useCallback(() => {
    const preset = workspaceById(value.active);
    const next = { tab: preset.tab, sizes: { ...preset.sizes }, collapsed: { ...preset.collapsed } };
    setValue((v) => ({ ...v, states: { ...v.states, [v.active]: next } }));
    return next;
  }, [value.active]);

  return { workspace: value.active, applyWorkspace, resetWorkspace };
}
