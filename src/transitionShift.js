// Transition Shifter (P2-09): stagger / sync several transitions across a cut
// with one control. Pure logic — the inspector dispatches the returned
// updates as one updateMany (one undo step), and the preview / export read
// the same clip.transition.duration the single-clip slider writes, so the
// shifted values render identically in both.
export const TRANSITION_MIN = 0.2;
export const TRANSITION_MAX = 2;
const clampDur = (d) => Math.min(TRANSITION_MAX, Math.max(TRANSITION_MIN, Math.round(d * 20) / 20));

// Plan the new durations for every transitioned clip in [from, to]:
// 'sync'    — every transition takes `duration`;
// 'stagger' — the first takes `duration`, each next adds `step`.
// Returns { updates: [{ index, id, transition }], count, durations }.
export function planTransitionShift(clips, { mode = 'sync', duration = 0.5, step = 0.1, from = 0, to = Infinity } = {}) {
  const updates = [];
  const durations = [];
  let k = 0;
  (clips || []).forEach((c, i) => {
    if (i < 1 || !c || !c.transition) return;
    if (i < from || i > to) return;
    const d = clampDur(mode === 'stagger' ? duration + step * k : duration);
    k++;
    durations.push(d);
    updates.push({ index: i, id: c.id, transition: { ...c.transition, duration: d } });
  });
  return { updates, count: updates.length, durations };
}

// New clips array with the plan applied (for tests / dry runs).
export function applyTransitionShift(clips, opts) {
  const { updates } = planTransitionShift(clips, opts);
  const byId = new Map(updates.map((u) => [u.id, u.transition]));
  return (clips || []).map((c) => (byId.has(c.id) ? { ...c, transition: byId.get(c.id) } : c));
}
