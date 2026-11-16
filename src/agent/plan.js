// Non-destructive AI editing (P1-31, Hamza's upgrade B): FlowAI builds a plan
// against a CLONED project and the user reviews it before anything touches the
// real project. The plan is a list of tool calls (name + args) plus the planned
// project they produce; Apply swaps the whole planned document in with one
// undo step (store 'applyPlan'); Discard drops it.
//
// Guarantees the design rests on:
//  - Nothing is dispatched to the real store until Apply. A provider failure,
//    retry or timeout mid-run leaves a partial plan (or none) and the real
//    project exactly as it was.
//  - Invalid timestamps are rejected inside the tools (bounds checks, P1-30)
//    — a bad step reports its error in the review instead of corrupting the plan.
//  - Per-step toggles recompute the plan by replaying the enabled steps from
//    the original project, so a step later in the list always sees the times
//    the earlier enabled steps produced.
import { historyReducer, projectDuration, uid } from '../store.js';
import { createToolRunner, describeStepFor, mutatesTool } from './tools.js';
import { describeCall } from './runAgent.js';

export const TRACK_LISTS = ['videoClips', 'overlayClips', 'textClips', 'audioClips', 'effectClips'];

// Structural diff between two project documents, same shape as the bridge's
// diffProjects (electron/bridge.cjs) so the review UI can share its lines:
// per-track added / removed / changed, caption text spelled out, duration shift.
export function diffPlan(before, after) {
  const diff = { lists: {}, added: 0, removed: 0, changed: 0, changes: [], captionText: [], durationBefore: projectDuration(before), durationAfter: projectDuration(after), truncated: false };
  if (before.name !== after.name) diff.nameChanged = { from: before.name || '', to: after.name || '' };
  for (const key of TRACK_LISTS) {
    const b = new Map((before[key] || []).map((c) => [c.id, c]));
    const a = new Map((after[key] || []).map((c) => [c.id, c]));
    const counts = { added: 0, removed: 0, changed: 0 };
    for (const [id, clip] of a) {
      if (!b.has(id)) { counts.added += 1; continue; }
      const prev = b.get(id);
      if (JSON.stringify(prev) === JSON.stringify(clip)) continue;
      counts.changed += 1;
      if (diff.changes.length < 100) {
        const fields = Object.keys(clip).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(clip[k]));
        diff.changes.push({ list: key, clipId: id, fields });
        if (key === 'textClips' && fields.includes('text')) diff.captionText.push({ clipId: id, from: String(prev.text || ''), to: String(clip.text || '') });
      } else diff.truncated = true;
    }
    for (const id of b.keys()) if (!a.has(id)) counts.removed += 1;
    diff.lists[key] = counts;
    diff.added += counts.added; diff.removed += counts.removed; diff.changed += counts.changed;
  }
  return diff;
}

// A runAgent context that edits a clone, never the live project.
//   - dispatch runs historyReducer against a draft { past, present, future }.
//   - addProbed mirrors the app's: same file twice reuses the draft media entry;
//     it never calls the real addItems, so no media lands in the live project.
//   - startExport is deliberately absent: export_video reports "not available"
//     in a plan (the export runs on the real project, after Apply, if asked).
//   - no onConfirm: the plan review IS the confirmation; bounds checks inside
//     the tools still reject invalid calls.
//   - undoOwn undoes inside the draft only.
export function createPlanRun(baseProject, api, extra = {}) {
  let draft = { past: [], present: structuredClone(baseProject), future: [], gestureStart: null };
  const dispatch = (a) => { draft = historyReducer(draft, a); };
  const ctx = {
    getProject: () => draft.present,
    dispatch,
    api,
    settle: async () => {},
    // Font ids come from the app (extra.fontIds); the plan must validate fonts
    // exactly like a direct run, never with an empty list.
    fontIds: extra.fontIds || (() => []),
    addProbed: (res) => {
      if (!res?.path) return null;
      const m = draft.present.media.find((x) => x.path === res.path);
      if (m) return m;
      const item = { ...res, id: uid() };
      dispatch({ type: 'addMedia', items: [item] });
      return item;
    },
    undoOwn: () => {
      if (!draft.past.length) return false;
      dispatch({ type: 'undo' });
      return true;
    },
  };
  return { ctx, getPlannedProject: () => draft.present, getDraft: () => draft };
}

// Replay the enabled steps from the original project and describe each one
// against the project it actually saw (so a destructive step's numbers match
// the times the earlier steps produced). Returns the planned project, the
// per-step results and the diff — the same shape the live run produces, so the
// review dialog can recompute after a toggle without re-asking the model.
export async function replayPlan(baseProject, api, steps, extra = {}) {
  const run = createPlanRun(baseProject, api, extra);
  const runner = createToolRunner(run.ctx);
  const results = [];
  for (const step of steps) {
    // A switched-off step stays in the list (unchecked) so the user can switch
    // it back on — it just does not run, and the steps after it see the times
    // without it.
    if (!step.enabled) { results.push({ ...step, skipped: true }); continue; }
    const before = run.getPlannedProject();
    const durBefore = projectDuration(before);
    const res = await runner.run(step.tool, step.args || {});
    const after = run.getPlannedProject();
    // The summary is described against the project the step actually saw. For
    // remove_silences that runs silence detection a second time (once for the
    // step, once for the words) — same params, same answer, a few seconds on
    // a long video; accepted rather than duplicating the sentence.
    const desc = await describeStepFor(before, api, step.tool, step.args || {});
    results.push({
      ...step,
      ok: !res.error,
      error: res.error || null,
      durationBefore: durBefore,
      durationAfter: projectDuration(after),
      summary: desc?.error ? null : (desc?.text || describeCall(step.tool, step.args || {})),
      summaryError: desc?.error || null,
    });
  }
  const planned = run.getPlannedProject();
  return { project: planned, steps: results, diff: diffPlan(baseProject, planned) };
}

// One line per recorded tool call for the review list. `mutating` decides
// whether the call belongs in the plan at all (reads, searches and the
// export opener are not plan steps).
export function planStepFromCall(name, args) {
  return { tool: name, args: args || {}, enabled: true, mutating: mutatesTool(name), label: describeCall(name, args || {}) };
}
