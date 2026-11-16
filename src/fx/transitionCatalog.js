// Honest grouped transition catalog (FB-10 · P1-07).
//
// The 135-name reference library is NOT 135 unique algorithms: it maps onto
// 123 real engine transitions, 45 of them implemented as named and 90 adapted
// (the closest real engine behaviour — see src/fx/catalog135.js), and the 135
// names use only 41 distinct engine ids between them. This module
// is the single source of truth that says so, in data the UI can render:
//
//   { slug, displayName, engineId, engineName, status, family, collection,
//     supportedParams, requiresMedia, previewHash }
//
// - displayName: the catalog name (the reference-library name, never the
//   engine name passed off as the catalog name).
// - status: 'implemented' (the engine performs the named behaviour) or
//   'adapted' (the tile runs the closest real engine transition; the UI must
//   badge it "Adapted" and must never present it as a real implementation).
// - supportedParams: the parameter keys this transition really accepts —
//   'duration' always, 'ease' for fx transitions, plus the schema keys of
//   trSchema(engineId). Nothing else is offered as a control (FB-11).
// - requiresMedia: every transition joins two clips, so every entry needs a
//   previous clip's media — true throughout, recorded explicitly so a
//   first-clip tile can say why it cannot apply.
// - previewHash: a stable hash of the engine id + default parameter values,
//   so a tile can tell whether its cached preview still matches the catalog.
//
// The counts the UI may advertise are counts() — entries, implemented,
// adapted, and uniqueEngineIds (123). "135 unique algorithms" must never
// appear in UI copy: 135 is the number of reference names, not algorithms.
import { CATALOG135, CATALOG_FAMILIES } from './catalog135.js';
import { collectionFor } from './collections.js';
import { trSchema } from './params.js';
import { TRANSITIONS } from '../effects.js';

const ENGINE = new Map(TRANSITIONS.map((t) => [t.id, t]));

// djb2 over a short string — stable across runs, no crypto needed.
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function supportedParamsFor(engineId) {
  const params = ['duration'];
  const schema = trSchema(engineId);
  if (schema) for (const p of schema) params.push(p.key);
  if (ENGINE.get(engineId)?.fx) params.push('ease');
  return params;
}

export const TRANSITION_CATALOG = CATALOG135.map((e) => {
  const schema = trSchema(e.engineId);
  const defaults = schema ? Object.fromEntries(schema.map((p) => [p.key, p.def])) : {};
  return {
    slug: e.slug,
    displayName: e.name,
    engineId: e.engineId,
    engineName: e.engineName,
    status: e.status,
    family: e.family,
    collection: collectionFor(e),
    pack: null,
    behavior: e.behavior,
    bestFor: e.bestFor || null,
    supportedParams: supportedParamsFor(e.engineId),
    // A transition always joins two clips: it needs the previous clip's media.
    requiresMedia: true,
    previewHash: hashString(JSON.stringify({ engine: e.engineId, defaults, dur: e.duration })),
  };
});

export const TRANSITION_CATALOG_FAMILIES = CATALOG_FAMILIES;

// Entries grouped by family, families in catalog order.
export function groupedTransitionCatalog(entries = TRANSITION_CATALOG) {
  const groups = CATALOG_FAMILIES.map((family) => ({
    family,
    entries: entries.filter((e) => e.family === family),
  }));
  return groups.filter((g) => g.entries.length);
}

// Only the entries the engine performs as named — the "real effects only" filter.
export function realOnlyCatalog(entries = TRANSITION_CATALOG) {
  return entries.filter((e) => e.status === 'implemented');
}

// How many catalog names share one engine transition (the "variant" count a
// tile shows, e.g. "3 variants share this engine"). Engine ids with a single
// catalog name map to 1.
export function engineVariantCounts(entries = TRANSITION_CATALOG) {
  const counts = {};
  for (const e of entries) counts[e.engineId] = (counts[e.engineId] || 0) + 1;
  return counts;
}

export function catalogEntryBySlug(slug) {
  return TRANSITION_CATALOG.find((e) => e.slug === slug) || null;
}

export function catalogEntryByEngine(engineId) {
  return TRANSITION_CATALOG.filter((e) => e.engineId === engineId);
}

// The counts the UI may advertise. engineTransitions (123) is the number of
// distinct transitions the ENGINE has; mappedEngineIds (41) is how many of
// them the 135 catalog names actually use — most adapted names share a
// handful of engines (dissolve, wipeleft, fx_glitch, …). Never advertise 135
// unique algorithms: 135 is the number of reference names, and the distinct
// algorithms behind them number 41.
export function catalogCounts(entries = TRANSITION_CATALOG) {
  const implemented = entries.filter((e) => e.status === 'implemented').length;
  return {
    entries: entries.length,
    implemented,
    adapted: entries.length - implemented,
    engineTransitions: TRANSITIONS.length,
    mappedEngineIds: new Set(entries.map((e) => e.engineId)).size,
  };
}
