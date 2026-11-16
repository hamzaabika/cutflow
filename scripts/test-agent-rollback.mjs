// FlowAI atomic rollback + per-track summary (A-F9): a run that fails mid-way
// (provider error, cancel, step cap) never leaves a half-applied edit behind —
// the history jumps back to its starting depth in one dispatch — and every run
// reports a per-track summary of what it added / removed / changed.
// Usage: node scripts/test-agent-rollback.mjs
import { runAgent, summarizeProjectDiff } from '../src/agent/runAgent.js';
import { emptyProject, historyReducer } from '../src/store.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

// A minimal live-store harness: the same historyReducer the app uses.
function harness() {
  let state = { past: [], present: emptyProject(), future: [], gestureStart: null };
  const dispatch = (a) => { state = historyReducer(state, a); };
  return {
    dispatch,
    getProject: () => state.present,
    historyDepth: () => state.past.length,
    pastLen: () => state.past.length,
  };
}
const scriptedApi = (steps) => {
  let i = 0;
  return {
    mcpTools: async () => ({}),
    agentStep: async () => steps[Math.min(i++, steps.length - 1)],
  };
};
const callStep = (calls) => ({ ok: true, provider: 'ollama', content: { role: 'model', parts: [{ text: 'working' }] }, calls, text: '' });
const doneStep = (text) => ({ ok: true, provider: 'ollama', content: { role: 'model', parts: [{ text }] }, calls: [], text });

// --- summarizeProjectDiff is pure and per-track ---
const before = emptyProject();
const after = emptyProject();
after.textClips = [{ id: 't1', text: 'Hello', start: 0, duration: 3 }];
after.videoClips = [{ id: 'v1', mediaId: 'm1', in: 0, out: 5 }];
const s = summarizeProjectDiff(before, after);
ok(s.lists.textClips.added === 1 && s.lists.videoClips.added === 1, 'summary counts added clips per track');
ok(s.added === 2 && s.removed === 0 && s.changed === 0, 'summary totals added clips');
const changed = structuredClone(after);
changed.textClips[0] = { ...changed.textClips[0], text: 'Hi' };
const s2 = summarizeProjectDiff(after, changed);
ok(s2.lists.textClips.changed === 1 && s2.changed === 1, 'summary counts a changed clip');
ok(summarizeProjectDiff(after, after).added === 0, 'identical projects summarise to no changes');

// --- undoTo jumps the history back to a depth in one dispatch ---
{
  const h = harness();
  h.dispatch({ type: 'addText', clipId: 'a', at: 0, patch: { text: 'one', duration: 3 } });
  h.dispatch({ type: 'addText', clipId: 'b', at: 3, patch: { text: 'two', duration: 3 } });
  ok(h.pastLen() === 2 && h.getProject().textClips.length === 2, 'two edits push two history steps');
  h.dispatch({ type: 'undoTo', depth: 0 });
  ok(h.pastLen() === 0 && h.getProject().textClips.length === 0, 'undoTo depth 0 restores the pre-run project');
  ok(h.getProject().textClips.length === 0, 'undoTo leaves no trace of the rolled-back edits');
  h.dispatch({ type: 'redo' });
  ok(h.getProject().textClips.length === 1, 'the rolled-back run stays redoable (first step back)');
  h.dispatch({ type: 'undoTo', depth: 5 });
  ok(h.getProject().textClips.length === 1, 'undoTo past the end is a no-op');
}

// --- a failed multi-step run rolls back atomically ---
{
  const h = harness();
  const api = scriptedApi([
    callStep([{ name: 'add_text', args: { text: 'Hello' } }]),
    { ok: false, error: 'provider exploded' },
  ]);
  const events = [];
  const result = await runAgent({
    contents: [{ role: 'user', parts: [{ text: 'add a title' }] }],
    ctx: { getProject: h.getProject, dispatch: h.dispatch, api, settle: async () => {}, historyDepth: h.historyDepth },
    onEvent: (ev) => events.push(ev),
    isCanceled: () => false,
  });
  ok(!!result.error, 'a provider failure surfaces as an error');
  ok(result.rolledBack === true, 'the failed run reports rolledBack');
  ok(result.changed === false, 'a rolled-back run reports no net change');
  ok(result.summary?.lists?.textClips?.added === 1, 'the summary reports what the failed run attempted (1 text clip)');
  ok(h.getProject().textClips.length === 0, 'the project is back to its pre-run state after rollback');
  ok(h.pastLen() === 0, 'the history depth is back to its starting depth');
}

// --- a cancelled run rolls back too ---
{
  const h = harness();
  let calls = 0;
  let mutated = false;
  const api = {
    mcpTools: async () => ({}),
    agentStep: async () => { calls++; return callStep([{ name: 'add_text', args: { text: `Title ${calls}` } }]); },
  };
  const result = await runAgent({
    contents: [{ role: 'user', parts: [{ text: 'keep adding titles' }] }],
    ctx: { getProject: h.getProject, dispatch: h.dispatch, api, settle: async () => {}, historyDepth: h.historyDepth },
    // Cancel only once the first mutation has landed, so the rollback has
    // something to undo (a cancel before any tool runs is a plain no-op).
    onEvent: (ev) => { if (ev.name === 'add_text' && ev.status === 'done') mutated = true; },
    isCanceled: () => mutated,
  });
  ok(result.canceled === true && result.rolledBack === true, 'a cancelled run rolls back');
  ok(result.summary?.lists?.textClips?.added === 1, 'the cancelled run still reports what it attempted');
  ok(h.getProject().textClips.length === 0 && h.pastLen() === 0, 'cancel leaves the project and history untouched');
}

// --- a successful run keeps its edits and reports the summary ---
{
  const h = harness();
  const api = scriptedApi([
    callStep([{ name: 'add_text', args: { text: 'Hello' } }]),
    doneStep('Done.'),
  ]);
  const result = await runAgent({
    contents: [{ role: 'user', parts: [{ text: 'add a title' }] }],
    ctx: { getProject: h.getProject, dispatch: h.dispatch, api, settle: async () => {}, historyDepth: h.historyDepth },
    onEvent: () => {},
    isCanceled: () => false,
  });
  ok(!result.error && result.changed === true && result.rolledBack !== true, 'a successful run is not rolled back');
  ok(result.summary?.lists?.textClips?.added === 1, 'a successful run reports its per-track summary');
  ok(h.getProject().textClips.length === 1, 'a successful run keeps its edit');
}

if (failures) { console.error(`test-agent-rollback: ${failures} failure(s)`); process.exit(1); }
console.log('test-agent-rollback: PASS');
