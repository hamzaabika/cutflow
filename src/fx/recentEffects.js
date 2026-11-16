// Recently-used effects (FB-28 · P1-43).
//
// A most-recent-first list of effect ids the user actually applied (max 8),
// persisted on this PC. This is the RECENT EFFECTS list — distinct by name
// from the Composer's recent PRESETS (CC-07): the two lists never share a
// storage key, a label, or an entry.
const KEY = 'cutflow.recentEffects.v1';
const MAX = 8;

export function loadRecentEffects(storage) {
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    const raw = store?.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX) : [];
  } catch { return []; }
}

export function recordRecentEffect(id, storage) {
  const next = [id, ...loadRecentEffects(storage).filter((x) => x !== id)].slice(0, MAX);
  try {
    const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    store?.setItem(KEY, JSON.stringify(next));
  } catch { /* persistence is a convenience */ }
  return next;
}
