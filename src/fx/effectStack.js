// Effect-stack controls (FB-26 · P1-41): reorder, solo, bypass, reset and
// before/after comparison for the effects stacked on one clip.
//
// State lives on the clip, next to the other per-effect maps:
//   clip.fxBypass: { [fxId]: true } — the effect is skipped by preview and
//     export alike (its timing/params/keys are kept, so un-bypassing restores
//     exactly the old look).
//   clip.fxSolo: { [fxId]: true } — when ANY effect on the clip is soloed,
//     only the soloed ones render (solo wins over bypass).
// Order is clip.effects itself: the array order is the render order in
// pixelPasses / drawOverlayPasses (src/fx/apply.js), so reordering the array
// reorders the render, in preview and export alike — there is no second
// order to keep in sync. Free Effects-track objects bypass through their
// existing `disabled` flag instead (freeOn already skips disabled objects).
//
// Every helper here is pure (array/map in, array/map/patch out); the UI
// dispatches the patches as ordinary 'update' actions, so each stack edit
// is one undo step.
export function clipFxVisible(clip, id) {
  const solo = clip.fxSolo || {};
  if (Object.values(solo).some(Boolean)) return !!solo[id];
  return !(clip.fxBypass || {})[id];
}

// The clip's effects in render order, skipping bypassed / non-soloed ones.
export function visibleClipEffects(clip) {
  return (clip.effects || []).filter((id) => clipFxVisible(clip, id));
}

// Move one effect one step in the stack (-1 up / +1 down). Out-of-range or
// missing ids return the list unchanged.
export function moveEffect(effects, id, dir) {
  const list = [...(effects || [])];
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

// Toggle one flag in a per-effect map; an emptied map becomes undefined so
// the project stays sparse (an absent entry IS the default, as everywhere).
export function toggleFxFlag(map, id) {
  const next = { ...(map || {}) };
  if (next[id]) delete next[id]; else next[id] = true;
  return Object.keys(next).length ? next : undefined;
}

// The patch that resets ONE effect to its authored state: strength, params,
// timing window, region and intensity keys all go, as do its solo/bypass
// flags. The effect itself stays on the clip.
export function resetEffectPatch(clip, fx) {
  const drop = (map) => {
    if (!map || !(fx in map)) return undefined; // unchanged: omit from patch
    const next = { ...map };
    delete next[fx];
    return Object.keys(next).length ? next : undefined;
  };
  const patch = {};
  const fxStrength = drop(clip.fxStrength);
  if (fxStrength !== undefined || clip.fxStrength?.[fx] !== undefined) patch.fxStrength = fxStrength;
  const fxParams = drop(clip.fxParams);
  if (fxParams !== undefined || clip.fxParams?.[fx] !== undefined) patch.fxParams = fxParams;
  const fxTiming = drop(clip.fxTiming);
  if (fxTiming !== undefined || clip.fxTiming?.[fx] !== undefined) patch.fxTiming = fxTiming;
  const fxRegions = drop(clip.fxRegions);
  if (fxRegions !== undefined || clip.fxRegions?.[fx] !== undefined) patch.fxRegions = fxRegions;
  const fxKeys = drop(clip.fxKeys);
  if (fxKeys !== undefined || clip.fxKeys?.[fx] !== undefined) patch.fxKeys = fxKeys;
  const fxBypass = drop(clip.fxBypass);
  if (fxBypass !== undefined || clip.fxBypass?.[fx] !== undefined) patch.fxBypass = fxBypass;
  const fxSolo = drop(clip.fxSolo);
  if (fxSolo !== undefined || clip.fxSolo?.[fx] !== undefined) patch.fxSolo = fxSolo;
  return patch;
}

// Before/after comparison: bypass every effect on the clip (the "before"),
// keeping the previous bypass map so it can be restored exactly.
export function compareOnPatch(clip) {
  const next = {};
  for (const id of clip.effects || []) next[id] = true;
  return { fxBypass: next };
}
