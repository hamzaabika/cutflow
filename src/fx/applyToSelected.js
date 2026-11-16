// Apply-to-selected helper (FB-28 · P1-43) — the ONE shared module for
// applying an effect to every selected clip.
//
// Both the Effects panel (this stream) and the Composer panel (CC-07,
// Stream D) apply effects to a multi-selection through here, so the two
// surfaces can never diverge: one updateMany, one undo step, and a clip
// that already has the effect is left untouched (no duplicate, no reset of
// its existing strength/params).
import { selectedPictures } from '../look.js';

// updateMany updates adding fxId to every selected picture clip that does
// not already carry it. Empty selection → [] (the caller falls back to its
// single-target behaviour).
export function effectUpdatesForSelection(project, selection, fxId) {
  return selectedPictures(project, selection)
    .filter((it) => !(it.clip.effects || []).includes(fxId))
    .map((it) => ({
      track: it.track,
      id: it.clip.id,
      patch: { effects: [...(it.clip.effects || []), fxId] },
    }));
}

// The clips an apply-to-all would touch (for counts / button labels).
export function applyToSelectedTargets(project, selection, fxId) {
  return selectedPictures(project, selection).filter((it) => !(it.clip.effects || []).includes(fxId));
}
