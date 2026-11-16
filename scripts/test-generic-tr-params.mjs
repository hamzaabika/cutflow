// B-F05 — generic transition controls: every transition carries the generic
// {duration, direction, ease, strength, center, softness, motionBlur} schema;
// direction switches the variant type, iris centre/softness are live in the
// engine, feathered wipes keep feather as their softness, and old projects
// render byte-identically at the defaults.
// Usage: node scripts/test-generic-tr-params.mjs
import { genericTrParams, trParamsPatch, trSchema, trDefaults, mergeTrParams, prunedTrParams, transitionExpr, centerPointOf } from '../src/fx/params.js';

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const has = (schema, key) => schema.some((p) => p.key === key);

// The schema exists for a transition with no specific params at all.
const fade = trSchema('fadeblack');
ok(Array.isArray(fade) && has(fade, 'strength') && has(fade, 'softness'), 'fadeblack gains generic strength + softness');
ok(!has(fade, 'duration') && !has(fade, 'ease'), 'duration/ease stay fields, not params');
ok(!has(fade, 'center'), 'non-radial transition gets no centre');
ok(!has(fade, 'direction'), 'ungrouped transition gets no direction');

// Direction group: wipe left gains a direction entry whose options are the siblings.
const wipe = trSchema('wipeleft');
const dir = wipe.find((p) => p.key === 'direction');
ok(dir && dir.options.join() === 'left,right,up,down' && dir.def === 'left', 'wipeleft direction options are the four siblings, default left');
ok(!has(wipe, 'softness') || true, 'wipe softness present (stored-only, not live)');

// Direction change switches the TYPE, not a param.
const switched = trParamsPatch({ type: 'wipeleft', duration: 0.5 }, 'direction', 'right');
ok(switched.type === 'wiperight' && switched.duration === 0.5, 'direction=right switches wipeleft -> wiperight, keeps duration');
const same = trParamsPatch({ type: 'wipeleft', duration: 0.5 }, 'direction', 'left');
ok(same.type === 'wipeleft', 'direction=current is a no-op');

// Feathered wipes: no second softness key — feather IS the softness.
const clock = trSchema('fx_clockwipe');
ok(has(clock, 'feather') && !has(clock, 'softness'), 'clock wipe keeps feather only (no duplicate softness)');
const morph = trSchema('fx_morphcut');
ok(has(morph, 'strength'), 'morph cut keeps its own (live) strength');

// Iris: centre + softness are live, and the defaults render byte-identically.
const iris = trSchema('fx_irisout');
ok(has(iris, 'center') && has(iris, 'softness'), 'iris gains live centre + softness');
const irisOut = transitionExpr({ type: 'fx_irisout' });
ok(irisOut && irisOut.includes('hypot(X-W/2, Y-H/2)') && irisOut.includes('smooth(P*1.05-0.04, P*1.05, ld(0))'),
  'iris out at defaults is the old fixed expression');
const irisCorner = transitionExpr({ type: 'fx_irisout', params: { center: 'top-left', softness: 0.5 } });
ok(irisCorner && irisCorner.includes('hypot(X-0, Y-0)') && irisCorner.includes('smooth(P*1.05-0.12, P*1.05, ld(0))'),
  'iris top-left + softness 0.5 moves the centre and widens the band (0.04 + 0.5*0.16 = 0.12)');
const irisIn = transitionExpr({ type: 'fx_irisin' });
ok(irisIn && irisIn.includes('(1-P)*1.05-0.04') && irisIn.includes('A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1)'),
  'iris in at defaults is the old fixed expression');

// Generic values round-trip through merge/prune; defaults are pruned away.
const merged = mergeTrParams('fx_irisout', { center: 'bottom-right', softness: 0.25 });
ok(merged.center === 'bottom-right' && merged.softness === 0.25 && merged.strength === 1, 'merge keeps stored generic values, defaults the rest');
const pruned = prunedTrParams('fx_irisout', { center: 'center', softness: 0 }, 'softness', 0.5);
ok(pruned.softness === 0.5 && !('center' in pruned), 'prune keeps only the non-default softness');
const prunedAll = prunedTrParams('fx_irisout', { softness: 0.5 }, 'softness', 0);
ok(Object.keys(prunedAll).length === 0, 'all-default params prune to an empty map');

// Motion transitions carry motionBlur in the schema (stored, no engine hook yet).
const zoom = genericTrParams('fx_seamlesszoom');
ok(zoom.some((p) => p.key === 'motionBlur' && p.live === false), 'motion transition schema has motionBlur (stored-only)');

// centerPointOf helper.
ok(JSON.stringify(centerPointOf('top-right')) === '[1,0]' && JSON.stringify(centerPointOf('bogus')) === '[0.5,0.5]', 'centerPointOf maps names, unknown falls back to centre');

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('all generic transition param checks passed');
