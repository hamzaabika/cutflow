// Insert editing (Sprint 10): the store's insertClip action — an insert
// splits whatever straddles the point (through the linked split, so a
// detached-audio partner splits with it) and pushes everything at or after
// the point right by the inserted length, on every track kind. Linked pairs
// move together; an audio clip linked to a main-track picture absorbs the
// shift into its linkOff. Locked layers refuse the whole edit. One dispatch
// is one undo step.
import { emptyProject, historyReducer, videoLayout } from '../src/store.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const run = (p, a) => historyReducer({ past: [], present: p, future: [] }, a);
const vid = (id, dur = 10) => ({ id, mediaId: 'm1', in: 0, out: dur, speed: 1, volume: 1, muted: false, filter: 'none', adjust: {}, effects: [], transition: null });

function project() {
  const p = emptyProject();
  return {
    ...p,
    media: [{ id: 'm1', path: '/x/v.mp4', type: 'video', duration: 60, width: 320, height: 180, hasAudio: true }],
    videoClips: [vid('A'), vid('B')],
    overlayClips: [
      { ...vid('O1'), start: 5, out: 4, transform: { scale: 0.5, x: 0, y: 0 } },
      { ...vid('O2'), start: 12, out: 3, transform: { scale: 0.5, x: 0, y: 0 } },
    ],
    audioClips: [
      { id: 'AU1', mediaId: 'm1', start: 5, in: 0, out: 4, volume: 1, fadeIn: 0, fadeOut: 0 },
      { id: 'AU2', mediaId: 'm1', start: 12, in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0 },
    ],
    textClips: [
      { id: 'T1', text: 'one', start: 5, duration: 4, y: 0.5 },
      { id: 'T2', text: 'two', start: 12, duration: 3, y: 0.5 },
    ],
    effectClips: [
      { id: 'E1', fx: 'flash', start: 5, duration: 3 },
      { id: 'E2', fx: 'flash', start: 12, duration: 2 },
    ],
  };
}
const totalLen = (p) => { const v = videoLayout(p.videoClips); return v.length ? v[v.length - 1].end : 0; };

// --- Main track: insert inside a clip splits it and pushes the rest -------
{
  const st = run(project(), { type: 'insertClip', track: 'video', at: 15, clip: vid('NEW'), splitId: 'B-r' });
  const lay = videoLayout(st.present.videoClips);
  ok(st.present.videoClips.length === 4, `main insert splits the straddler (got ${st.present.videoClips.length} clips)`);
  ok(lay.map((l) => l.clip.id).join(',') === 'A,B,NEW,B-r', `order A, B-left, NEW, B-right (got ${lay.map((l) => l.clip.id).join(',')})`);
  ok(near(totalLen(st.present), 30), `duration grows by the inserted length: 30 (got ${totalLen(st.present)})`);
  const left = st.present.videoClips.find((c) => c.id === 'B');
  const right = st.present.videoClips.find((c) => c.id === 'B-r');
  ok(near(left.out, 5) && near(right.in, 5), 'the split lands at the insert point in source time');
  ok(st.past.length === 1, 'one undo step');
  const undone = historyReducer(st, { type: 'undo' });
  ok(undone.present.videoClips.length === 2 && near(totalLen(undone.present), 20), 'undo restores the two original clips');
}

// --- Main track: insert on a boundary does not split -----------------------
{
  const st = run(project(), { type: 'insertClip', track: 'video', at: 10, clip: vid('NEW'), splitId: 'X-r' });
  ok(st.present.videoClips.length === 3, 'boundary insert adds one clip, no split');
  ok(videoLayout(st.present.videoClips).map((l) => l.clip.id).join(',') === 'A,NEW,B', 'the new clip sits between A and B');
}

// --- Audio track: straddler splits, later clips shift ----------------------
{
  const clip = { id: 'NA', mediaId: 'm1', in: 0, out: 2, volume: 1, fadeIn: 0, fadeOut: 0 };
  const st = run(project(), { type: 'insertClip', track: 'audio', at: 6, clip, splitId: 'AU1-r' });
  const byId = Object.fromEntries(st.present.audioClips.map((c) => [c.id, c]));
  ok(near(byId.AU1.start, 5) && near(byId.AU1.out, 1), 'AU1 left half keeps [5,6)');
  ok(near(byId['AU1-r'].start, 8) && near(byId['AU1-r'].in, 1), 'AU1 right half pushed past the insert');
  ok(near(byId.NA.start, 6), 'the new clip lands at the insert point');
  ok(near(byId.AU2.start, 14), 'AU2 shifts by the inserted length');
}

// --- Overlay / text / effect tracks ----------------------------------------
{
  const st = run(project(), { type: 'insertClip', track: 'overlay', at: 6, clip: { ...vid('NO'), out: 2, transform: { scale: 0.5, x: 0, y: 0 } }, splitId: 'O1-r' });
  const byId = Object.fromEntries(st.present.overlayClips.map((c) => [c.id, c]));
  ok(near(byId['O1-r'].start, 8) && near(byId.O2.start, 14) && near(byId.NO.start, 6), 'overlay: straddler splits, later clips shift, new clip at the point');
}
{
  const st = run(project(), { type: 'insertClip', track: 'text', at: 6, clip: { id: 'NT', text: 'new', duration: 2, y: 0.5 }, splitId: 'T1-r' });
  const byId = Object.fromEntries(st.present.textClips.map((c) => [c.id, c]));
  ok(near(byId.T1.duration, 1) && near(byId['T1-r'].start, 8) && near(byId.T2.start, 14) && near(byId.NT.start, 6), 'text: straddler splits, later clips shift');
}
{
  const st = run(project(), { type: 'insertClip', track: 'effect', at: 6, clip: { id: 'NE', fx: 'flash', duration: 2 }, splitId: 'E1-r' });
  const byId = Object.fromEntries(st.present.effectClips.map((c) => [c.id, c]));
  ok(near(byId.E1.duration, 1) && near(byId['E1-r'].start, 8) && near(byId.E2.start, 14) && near(byId.NE.start, 6), 'effect: straddler splits, later clips shift');
}

// --- Locked layers refuse ---------------------------------------------------
{
  const locked = run(project(), { type: 'setLayerState', track: 'audio', layer: 0, patch: { locked: true } }).present;
  const st = run(locked, { type: 'insertClip', track: 'audio', at: 6, clip: { id: 'NA', mediaId: 'm1', in: 0, out: 2, volume: 1 }, splitId: 'AU1-r' });
  ok(st.present === locked && st.past.length === 0, 'insert onto a locked layer is refused, no history step');
  const lockedMain = run(project(), { type: 'setLayerState', track: 'video', layer: 0, patch: { locked: true } }).present;
  const st2 = run(lockedMain, { type: 'insertClip', track: 'video', at: 5, clip: vid('NEW'), splitId: 'A-r' });
  ok(st2.present === lockedMain, 'insert onto the locked main track is refused');
}

// --- Linked pairs move together ---------------------------------------------
{
  const p = project();
  p.overlayClips = [{ ...vid('P'), start: 4, out: 6, transform: { scale: 0.5, x: 0, y: 0 }, linkId: 'L1' }];
  p.audioClips = [{ id: 'PA', mediaId: 'm1', start: 4, in: 0, out: 6, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L1', linkOff: 0, linkInOff: 0 }];
  const clip = { id: 'NA', mediaId: 'm1', in: 0, out: 2, volume: 1, fadeIn: 0, fadeOut: 0 };
  const st = run(p, { type: 'insertClip', track: 'audio', at: 2, clip, splitId: 'PA-r' });
  const pic = st.present.overlayClips.find((c) => c.id === 'P');
  const aud = st.present.audioClips.find((c) => c.id === 'PA');
  ok(near(aud.start, 6) && near(pic.start, 6), `insert before a linked pair shifts BOTH members (pic ${pic.start}, aud ${aud.start})`);
  ok(near(aud.start - pic.start, aud.linkOff || 0), 'the pair invariant start == picStart + linkOff holds');
}
{
  // Audio linked to a MAIN-track picture: the picture cannot shift (its
  // start is positional), so the audio absorbs the shift into linkOff.
  const p = project();
  p.audioClips = [{ id: 'PA', mediaId: 'm1', start: 0, in: 0, out: 10, volume: 1, fadeIn: 0, fadeOut: 0, linkId: 'L2', linkOff: 0, linkInOff: 0 }];
  p.videoClips = [{ ...vid('V'), linkId: 'L2' }];
  const clip = { id: 'NA', mediaId: 'm1', in: 0, out: 3, volume: 1, fadeIn: 0, fadeOut: 0 };
  const st = run(p, { type: 'insertClip', track: 'audio', at: 0, clip, splitId: 'PA-r' });
  const aud = st.present.audioClips.find((c) => c.id === 'PA');
  const picStart = videoLayout(st.present.videoClips).find((l) => l.clip.id === 'V').start;
  ok(near(aud.start, 3) && near(aud.linkOff, 3), 'main-linked audio shifts and linkOff absorbs it');
  ok(near(aud.start, picStart + aud.linkOff), 'the pair invariant holds as data after the shift');
}

console.log(fails.length ? `\n${fails.length} FAILURES` : '\nINSERT EDIT OK');
process.exit(fails.length ? 1 : 0);
