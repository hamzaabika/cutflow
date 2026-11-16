// CC-04 motion / keyframe primitives (MASTER-SPEC §5): the NEW pieces this
// stream built — copy/paste of a whole motion (keyframes + in/out/combo
// animation) to another layer, and the keyboard shortcuts for keyframe work.
// The pre-existing primitives (copyKeyframes/pasteKeyframes, bulk actions,
// multi-select drag in the Keyframe Graph) are pinned by
// scripts/test-keyframe-actions.mjs and test-keyframe-graph.mjs; this suite
// only covers what CC-04 added.
// Run: node scripts/test-cc04-keyframes.mjs   (plain Node)
import assert from 'node:assert';
import {
  KEY_PROPS, addKeys, copyMotion, getMotionClipboard, keyTimes, moveKeys,
  nextKeyTime, pasteMotion, prevKeyTime, setMotionClipboard,
} from '../src/anim.js';
import { KEY_ACTIONS, actionForEvent, chordFromEvent, resolveKeymap } from '../src/keymap.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks += 1; };

const base = { id: 'c', mediaId: 'm', in: 0, out: 4, speed: 1, transform: { scale: 1, x: 0, y: 0, rot: 0 } };
const withMotion = {
  ...base,
  anim: { in: { type: 'pop_in', duration: 0.6 }, out: { type: 'fade_out', duration: 0.4 } },
  keyframes: {
    scale: [{ t: 0, v: 1 }, { t: 2, v: 2 }],
    x: [{ t: 1, v: 0.2 }],
  },
};

// ---- copyMotion / pasteMotion (new in CC-04) ----
const copied = copyMotion(withMotion);
ok(copied && copied.version === 1, 'copyMotion returns versioned data');
ok(getMotionClipboard() === copied, 'copyMotion stores the module motion clipboard');
ok(copied.anim && copied.anim.in.type === 'pop_in' && copied.anim.out.type === 'fade_out', 'copyMotion carries the in/out animation');
ok(copied.keys && copied.keys.props.scale, 'copyMotion carries the keyframes');
const target = { ...base, in: 0, out: 4, speed: 1 };
const pasted = pasteMotion(target, copied, 1);
ok(pasted && pasted.anim && pasted.anim.in.type === 'pop_in', 'pasteMotion applies the source animation to the target layer');
const pastedClip = { ...target, ...pasted };
ok(JSON.stringify(keyTimes(pastedClip)) === JSON.stringify([1, 2, 3]), 'pasteMotion lands the first key at the playhead (1, 2, 3)');
ok(pastedClip.keyframes.scale.find((k) => k.t === 3).v === 2, 'pasteMotion carries key values');
ok(copyMotion({ ...base }) === null, 'copyMotion of a clip with no motion returns null');
ok(pasteMotion(target, null, 0) === null, 'pasteMotion rejects a null clipboard');
ok(pasteMotion(target, { version: 99, keys: null, anim: null }, 0) === null, 'pasteMotion rejects a bad version');
ok(setMotionClipboard({ version: 2 }) === null, 'setMotionClipboard rejects a bad version');
// Anim-only copy: a clip with an animation but no keyframes still pastes.
const animOnly = copyMotion({ ...base, anim: { combo: { type: 'pulse' } } });
ok(animOnly && animOnly.anim.combo.type === 'pulse' && !animOnly.keys, 'copyMotion works with animation only');
const animPasted = pasteMotion(target, animOnly, 0);
ok(animPasted.anim.combo.type === 'pulse' && !animPasted.keyframes, 'pasteMotion of animation-only data touches no keyframes');

// ---- prev/next keyframe jump (new in CC-04) ----
const jumped = { ...base, keyframes: { scale: [{ t: 1, v: 1 }, { t: 2, v: 2 }, { t: 3, v: 3 }] } };
ok(prevKeyTime(jumped, 2) === 1, 'prevKeyTime from a key goes to the earlier key');
ok(nextKeyTime(jumped, 2) === 3, 'nextKeyTime from a key goes to the later key');
ok(prevKeyTime(jumped, 1) === null, 'prevKeyTime at the first key is null');
ok(nextKeyTime(jumped, 3) === null, 'nextKeyTime at the last key is null');
ok(prevKeyTime(jumped, 1.5) === 1 && nextKeyTime(jumped, 1.5) === 2, 'jump works between keys');
ok(prevKeyTime({ ...base }, 2) === null && nextKeyTime({ ...base }, 2) === null, 'jump with no keys is null');

// ---- moveKeys moves every property's key at one instant (timeline Shift-drag) ----
const multi = {
  ...base,
  keyframes: { scale: [{ t: 1, v: 1 }, { t: 3, v: 2 }], x: [{ t: 1, v: 0.1 }, { t: 2, v: 0.2 }], rot: [{ t: 1, v: 10 }] },
};
const moved = moveKeys(multi, 1, 1.5);
const movedClip = { ...multi, ...moved };
ok(JSON.stringify(keyTimes(movedClip)) === JSON.stringify([1.5, 2, 3]), 'moveKeys moves all properties at that instant together');
ok(movedClip.keyframes.rot[0].v === 10, 'moveKeys keeps the dragged values');

// ---- Keyboard shortcuts (new in CC-04) ----
const ids = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.defaults]));
for (const [id, want] of [
  ['kfAdd', ['I']], ['kfDelete', ['D']], ['kfPrev', ['[']], ['kfNext', [']']],
  ['kfNudgeBack', ['Alt+ArrowLeft']], ['kfNudgeFwd', ['Alt+ArrowRight']],
]) {
  ok(ids[id] && JSON.stringify(ids[id]) === JSON.stringify(want), `keymap: ${id} defaults to ${want.join(', ')}`);
}
const map = resolveKeymap(null);
const ev = (key, extra = {}) => ({ key, code: `Key${key.toUpperCase()}`, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...extra });
ok(chordFromEvent(ev('i')) === 'I', 'chordFromEvent: i -> I');
ok(chordFromEvent(ev('[')) === '[', 'chordFromEvent: [ stays [');
ok(actionForEvent(map, ev('i')) === 'kfAdd', 'I fires kfAdd');
ok(actionForEvent(map, ev('d')) === 'kfDelete', 'D fires kfDelete');
ok(actionForEvent(map, ev('[')) === 'kfPrev', '[ fires kfPrev');
ok(actionForEvent(map, ev(']')) === 'kfNext', '] fires kfNext');
ok(actionForEvent(map, { key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }) === 'kfNudgeBack', 'Alt+Left fires kfNudgeBack');
ok(actionForEvent(map, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }) === 'kfNudgeFwd', 'Alt+Right fires kfNudgeFwd');
// No chord is claimed by two actions (the keymap suite pins the count; this
// pins the CC-04 additions specifically).
const seen = new Map();
let dup = null;
for (const a of KEY_ACTIONS) for (const c of a.defaults) { if (seen.has(c)) dup = c; seen.set(c, a.id); }
ok(!dup, `no chord claimed twice${dup ? ` (duplicate: ${dup})` : ''}`);

console.log(`test-cc04-keyframes: PASS (${checks} checks)`);
