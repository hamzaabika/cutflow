// TR-03 — transition boundary / zero-handle / short-media handling.
// transitionFit is the single source of truth for the Inspector Transition
// panel and ClipInspector warnings; transitionDur (the export clamp) must
// always agree with fit.effective.
import { transitionDur, transitionFit } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// Plain clips: (out - in) / speed.
const clip = (len, transition) => ({ in: 0, out: len, speed: 1, ...(transition ? { transition } : {}) });

// ok: 0.5s transition into a 4s clip after a 4s clip — max 2s, fits.
{
  const clips = [clip(4), clip(4, { type: 'fade', duration: 0.5 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'ok', `ok state (got ${fit.state})`);
  ok(near(fit.max, 2) && near(fit.effective, 0.5) && near(fit.requested, 0.5), `ok numbers max=${fit.max} effective=${fit.effective}`);
  ok(near(transitionDur(clips, 1), fit.effective), 'transitionDur agrees with fit.effective (ok)');
}

// clamped: 1.5s transition, neighbours 4s and 1s — max 0.5s, plays at 0.5s.
{
  const clips = [clip(4), clip(1, { type: 'fade', duration: 1.5 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'clamped', `clamped state (got ${fit.state})`);
  ok(near(fit.max, 0.5) && near(fit.effective, 0.5) && near(fit.requested, 1.5), `clamped numbers max=${fit.max} effective=${fit.effective} requested=${fit.requested}`);
  ok(near(transitionDur(clips, 1), 0.5), 'transitionDur clamps to 0.5s');
}

// clamped by the PREVIOUS clip being short (0.4s prev, 4s next, 1s requested).
{
  const clips = [clip(0.4), clip(4, { type: 'fade', duration: 1 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'clamped' && near(fit.max, 0.2) && near(fit.effective, 0.2), `prev-short clamps to max=${fit.max}`);
}

// zero-handle: next clip trimmed to 0s — no room for any transition.
{
  const clips = [clip(4), clip(0, { type: 'fade', duration: 0.5 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'zero', `zero state for 0s next clip (got ${fit.state})`);
  ok(near(fit.max, 0) && near(fit.effective, 0), `zero numbers max=${fit.max} effective=${fit.effective}`);
  ok(near(transitionDur(clips, 1), 0), 'transitionDur is 0 (transition skipped on export)');
}

// zero-handle: previous clip 0s.
{
  const clips = [clip(0), clip(4, { type: 'fade', duration: 0.5 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'zero' && near(fit.prevLen, 0), 'zero state for 0s previous clip');
}

// none: no transition, first clip, or type 'none'.
{
  const clips = [clip(4), clip(4)];
  ok(transitionFit(clips, 1).state === 'none', 'none state without a transition');
  ok(transitionFit(clips, 0).state === 'none', 'none state on the first clip');
  const clips2 = [clip(4), clip(4, { type: 'none', duration: 0.5 })];
  ok(transitionFit(clips2, 1).state === 'none', "none state for type 'none'");
}

// boundary: requested exactly at max is ok, not clamped.
{
  const clips = [clip(2), clip(2, { type: 'fade', duration: 1 })];
  const fit = transitionFit(clips, 1);
  ok(fit.state === 'ok' && near(fit.max, 1), 'requested == max is ok');
}

if (fails.length) { console.log(`\ntest-transition-fit: FAIL (${fails.length})`); process.exit(1); }
console.log('\ntest-transition-fit: PASS');
