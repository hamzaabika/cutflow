// Transition-honesty catalog acceptance test (FB-10 · P1-07).
// Run: node scripts/test-transition-catalog.mjs
import assert from 'assert/strict';
import { CATALOG135 } from '../src/fx/catalog135.js';
import {
  TRANSITION_CATALOG, catalogCounts, catalogEntryBySlug, engineVariantCounts,
  groupedTransitionCatalog, realOnlyCatalog,
} from '../src/fx/transitionCatalog.js';
import { TRANSITIONS } from '../src/effects.js';

const engine = new Set(TRANSITIONS.map((t) => t.id));

// Every entry carries the honest catalog contract.
assert.equal(TRANSITION_CATALOG.length, 135, '135 catalog entries');
for (const e of TRANSITION_CATALOG) {
  assert.ok(e.slug && e.displayName && e.engineId && e.engineName, `${e.slug} has names`);
  assert.ok(engine.has(e.engineId), `${e.slug} engineId exists`);
  assert.ok(e.status === 'implemented' || e.status === 'adapted', `${e.slug} has a status`);
  assert.ok(Array.isArray(e.supportedParams) && e.supportedParams.includes('duration'), `${e.slug} supports duration`);
  assert.equal(e.requiresMedia, true, `${e.slug} requires media (joins two clips)`);
  assert.ok(typeof e.previewHash === 'string' && e.previewHash.length > 0, `${e.slug} has a preview hash`);
  assert.ok(e.family && e.collection, `${e.slug} is grouped`);
}
// The catalog matches the underlying 135 mapping one-to-one.
assert.deepEqual(
  TRANSITION_CATALOG.map((e) => [e.slug, e.engineId, e.status]),
  CATALOG135.map((e) => [e.slug, e.engineId, e.status]),
  'catalog mirrors catalog135 mapping',
);
// Counts: 45 implemented / 90 adapted over 41 distinct engine ids used
// (of 130 engine transitions in total) — the "135 unique algorithms" claim
// is false by construction.
const counts = catalogCounts();
assert.equal(counts.entries, 135);
assert.equal(counts.implemented, 45, `implemented count (got ${counts.implemented})`);
assert.equal(counts.adapted, 90, `adapted count (got ${counts.adapted})`);
assert.equal(counts.engineTransitions, 130, `engine transitions (got ${counts.engineTransitions})`);
assert.equal(counts.mappedEngineIds, 41, `distinct engine ids used (got ${counts.mappedEngineIds})`);
assert.ok(counts.mappedEngineIds < counts.entries, 'distinct algorithms behind the names < catalog names');
// Grouping covers every entry exactly once, in family order.
const groups = groupedTransitionCatalog();
assert.equal(groups.reduce((n, g) => n + g.entries.length, 0), 135, 'groups cover all entries');
assert.equal(new Set(groups.flatMap((g) => g.entries.map((e) => e.slug))).size, 135, 'no entry in two groups');
// Real-only filter keeps exactly the implemented entries.
assert.equal(realOnlyCatalog().length, 45, 'real-only filter keeps 45');
assert.ok(realOnlyCatalog().every((e) => e.status === 'implemented'));
// Variant counts: several catalog names share one engine id; the total of
// distinct engine ids used is 41.
const variants = engineVariantCounts();
assert.equal(Object.keys(variants).length, 41, '41 engine ids in variant map');
assert.ok(Object.values(variants).every((n) => n >= 1));
assert.ok(Object.values(variants).some((n) => n > 1), 'some engines have several catalog variants');
// Lookups.
assert.equal(catalogEntryBySlug('cross-dissolve').engineId, 'dissolve');
assert.equal(catalogEntryBySlug('cross-dissolve').status, 'implemented');
assert.equal(catalogEntryBySlug('datamosh').status, 'adapted');
assert.equal(catalogEntryBySlug('no-such-slug'), null);
// supportedParams never promises a control the engine cannot honour:
// 'ease' only on fx transitions, schema keys only where a schema exists.
for (const e of TRANSITION_CATALOG) {
  if (e.supportedParams.includes('ease')) assert.ok(engine.has(e.engineId) && TRANSITIONS.find((t) => t.id === e.engineId)?.fx, `${e.slug}: ease only on fx transitions`);
}
console.log(`transition-catalog OK: 135 entries, ${counts.implemented} implemented, ${counts.adapted} adapted, ${counts.mappedEngineIds} distinct engine transitions used (of ${counts.engineTransitions} in the engine)`);
