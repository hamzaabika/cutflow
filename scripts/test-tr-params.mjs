// TR-02 — parametric transition inspector: the converted transitions render
// byte-for-byte (modulo whitespace) what they rendered before parameters,
// non-default values change the expression, and feathering never moves the
// end-point coverage inward (no pixel flips early at P = 0 or late at P = 1).
// Legacy expressions are snapshots of the pre-change catalog (git HEAD).
import { FX_TRANSITIONS } from '../src/fx/catalog.js';
import { trSchema, trDefaults, mergeTrParams, transitionExpr } from '../src/fx/params.js';

const LEGACY = {
 "fx_wipewest": "st(0, X/W); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_wipeeast": "st(0, 1 - X/W); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_wipecenter": "st(0, abs(X/W - 0.5)*2); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_wipecorners": "st(0, 1 - max(abs(X/W - 0.5), abs(Y/H - 0.5))*2); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_venetianv": "st(0, abs(fract(X/(W/14)) - 0.5)*2); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_venetianh": "st(0, abs(fract(Y/(H/10)) - 0.5)*2); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_checker": "st(0, hash(floor(X/(W/8))*3.17 + floor(Y/(H/6))*7.71)); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_diamondout": "st(0, 1 - (abs(X/W - 0.5) + abs(Y/H - 0.5))); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_crosswipe": "st(0, min(abs(X - W/2)/(W/2), abs(Y - H/2)/(H/2))); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)",
 "fx_diamond": "st(0, abs(X/W-0.5)+abs(Y/H-0.5)); st(1, smooth(P*1.06-0.05, P*1.06-0.01, ld(0)));\n      B(X, Y)*(1-ld(1)) + A(X, Y)*ld(1)",
 "fx_irisout": "st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));\n      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))",
 "fx_irisin": "st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth((1-P)*1.05-0.04, (1-P)*1.05, ld(0)));\n      A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1)",
 "fx_circlecorner": "st(0, hypot(X, Y)/(hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));\n      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))",
 "fx_diamondreveal": "st(0, (X-W/2)/H); st(1, (Y-H/2)/H); st(2, (1-P)*0.6);\n      st(3, ld(0)*cos(ld(2))+ld(1)*sin(ld(2))); st(4, -ld(0)*sin(ld(2))+ld(1)*cos(ld(2)));\n      st(5, (abs(ld(3))+abs(ld(4)))*H/(0.78*hypot(W, H)));\n      st(6, smooth(P*1.06-0.05, P*1.06-0.01, ld(5)));\n      A(X, Y)*ld(6) + B(X, Y)*(1-ld(6))",
 "fx_squircle": "st(0, abs((X - W/2)/(W/2))); st(1, abs((Y - H/2)/(H/2)));\n      st(2, min(sqrt(sqrt(ld(0)*ld(0)*ld(0)*ld(0) + ld(1)*ld(1)*ld(1)*ld(1))), 1));\n      st(3, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(2))); B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)",
 "fx_starwipe": "st(0, atan2(Y - H/2, X - W/2)); st(1, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H))*(0.8 + 0.2*cos(ld(0)*5)));\n      st(2, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(1))); B(X, Y)*(1 - ld(2)) + A(X, Y)*ld(2)",
 "fx_orbitwipe": "st(0, W/2 + cos(P*6.2832)*W*0.18); st(1, H/2 + sin(P*6.2832)*H*0.18);\n      st(2, hypot(X - ld(0), Y - ld(1))/hypot(W, H)); st(3, smooth(P*0.74 - 0.03, P*0.74 - 0.01, ld(2)));\n      B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)",
 "fx_pixelate": "st(0, max(1, (1+49*(4*P*(1-P)))*H/720)); st(1, floor(X/ld(0))*ld(0)+ld(0)/2); st(2, floor(Y/ld(0))*ld(0)+ld(0)/2);\n      A(ld(1), ld(2))*(1-P) + B(ld(1), ld(2))*P",
 "fx_blur": "st(0, (4*P*(1-P))*20*H/720); ((0.05*A(X+(-4)*ld(0), Y)+0.09*A(X+(-3)*ld(0), Y)+0.12*A(X+(-2)*ld(0), Y)+0.15*A(X+(-1)*ld(0), Y)+0.16*A(X+(0)*ld(0), Y)+0.15*A(X+(1)*ld(0), Y)+0.12*A(X+(2)*ld(0), Y)+0.09*A(X+(3)*ld(0), Y)+0.05*A(X+(4)*ld(0), Y))/0.98)*(1-P) + ((0.05*B(X+(-4)*ld(0), Y)+0.09*B(X+(-3)*ld(0), Y)+0.12*B(X+(-2)*ld(0), Y)+0.15*B(X+(-1)*ld(0), Y)+0.16*B(X+(0)*ld(0), Y)+0.15*B(X+(1)*ld(0), Y)+0.12*B(X+(2)*ld(0), Y)+0.09*B(X+(3)*ld(0), Y)+0.05*B(X+(4)*ld(0), Y))/0.98)*P",
 "fx_glitch": "st(0, (hash(floor(Y/(H*0.015))*1.37+floor(P*30)*7.13)-0.5)*(4*P*(1-P))*0.3*W);\n      A(X+ld(0)*C(2, 1, 1), Y)*(1-P) + B(X-ld(0)*C(1, 1, 2), Y)*P",
 "fx_ripple": "st(0, hypot(X-W/2, Y-H/2)/H); st(1, sin((ld(0)-P)*30)*0.02*H*(4*P*(1-P))); st(2, max(ld(0)*H, 0.001));\n      st(3, X+(X-W/2)/ld(2)*ld(1)+0.5); st(4, Y+(Y-H/2)/ld(2)*ld(1)+0.5);\n      A(ld(3), ld(4))*(1-P) + B(ld(3), ld(4))*P",
 "fx_warp": "st(0, (4*P*(1-P))*0.1*W*sin(Y/H*10)); A(X+ld(0), Y)*(1-P) + B(X-ld(0), Y)*P",
 "fx_tiles": "st(0, max(1, H*0.08*(4*P*(1-P)))); st(1, floor(X/ld(0))); st(2, floor(Y/ld(0)));\n      st(3, ld(1)*ld(0)+ld(0)/2); st(4, ld(2)*ld(0)+ld(0)/2);\n      if(lt(hash(ld(1)*12.9898+ld(2)*78.233), P), B(ld(3), ld(4)), A(ld(3), ld(4)))",
 "fx_radialblur": "st(0, (4*P*(1-P))*2); (A(W/2+(X-W/2)*(1-(ld(0))*0)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.05)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.05)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.1)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.1)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.15)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.15)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.2)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.2)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.25)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.25)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.3)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.3)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.35)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.35)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.4)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.4)+0.5)+A(W/2+(X-W/2)*(1-(ld(0))*0.45)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.45)+0.5))/10*(1-P) + (B(W/2+(X-W/2)*(1-(ld(0))*0)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.05)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.05)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.1)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.1)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.15)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.15)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.2)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.2)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.25)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.25)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.3)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.3)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.35)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.35)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.4)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.4)+0.5)+B(W/2+(X-W/2)*(1-(ld(0))*0.45)+0.5, H/2+(Y-H/2)*(1-(ld(0))*0.45)+0.5))/10*P",
 "fx_zoomblur": "(A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*0.000)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*0.000)+0.5)+A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*0.200)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*0.200)+0.5)+A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*0.400)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*0.400)+0.5)+A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*0.600)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*0.600)+0.5)+A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*0.800)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*0.800)+0.5)+A(W/2+(X-W/2)/(1+0.9*P)*(1-(0.3*P)*1.000)+0.5, H/2+(Y-H/2)/(1+0.9*P)*(1-(0.3*P)*1.000)+0.5))/6*(1-P) + (B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.000)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.000)+0.5)+B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.200)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.200)+0.5)+B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.400)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.400)+0.5)+B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.600)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.600)+0.5)+B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.800)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*0.800)+0.5)+B(W/2+(X-W/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*1.000)+0.5, H/2+(Y-H/2)/(1+0.9*(1-P))*(1-(0.3*(1-P))*1.000)+0.5))/6*P"
};
const FEATHER_IDS = ["fx_wipewest", "fx_wipeeast", "fx_wipecenter", "fx_wipecorners", "fx_venetianv", "fx_venetianh", "fx_checker", "fx_diamondout", "fx_crosswipe", "fx_diamond", "fx_irisout", "fx_irisin", "fx_circlecorner", "fx_diamondreveal", "fx_squircle", "fx_starwipe", "fx_orbitwipe"];
const STRENGTH_IDS = ["fx_pixelate", "fx_blur", "fx_glitch", "fx_ripple", "fx_warp", "fx_tiles", "fx_radialblur", "fx_zoomblur"];

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const norm = (s) => s.replace(/\s+/g, '');
const byId = Object.fromEntries(FX_TRANSITIONS.map((t) => [t.id, t]));

// 1. Coverage: the parametric set grew from 5 to 30 of 114 transitions.
const parametric = FX_TRANSITIONS.filter((t) => t.params);
ok(parametric.length >= 30, `parametric transitions: ${parametric.length} of ${FX_TRANSITIONS.length} (was 5)`);
ok(new Set(parametric.map((t) => t.id)).size === parametric.length, 'no duplicate parametric ids');

// 2. Defaults reproduce the legacy expression exactly (modulo whitespace),
//    through make(defaults), trSchema defaults, and transitionExpr with no params.
for (const [id, legacy] of Object.entries(LEGACY)) {
  const entry = byId[id];
  ok(!!entry, `${id}: still in catalog`);
  if (!entry) continue;
  ok(Array.isArray(entry.params) && entry.params.length > 0, `${id}: has a param schema`);
  ok(typeof entry.make === 'function', `${id}: has make()`);
  const defs = trDefaults(id);
  ok(norm(entry.make(defs)) === norm(legacy), `${id}: make(defaults) == legacy`);
  ok(norm(transitionExpr({ type: id })) === norm(legacy), `${id}: transitionExpr() == legacy`);
  // The CATALOG schema for the entry is one slider (feather or strength).
  // trSchema() adds B-F05's generic entries on top (strength / softness /
  // centre / direction), so its length is larger — the specific key must
  // still be present and live there. (Merge note: this assertion used to
  // read trSchema's length; B-F05 landed after TR-02 was written.)
  ok(entry.params && entry.params.length === 1 && (entry.params[0].key === 'feather' || entry.params[0].key === 'strength'), `${id}: catalog schema is one ${entry.params?.[0]?.key} slider`);
  const schema = trSchema(id);
  ok(schema && schema.some((p) => p.key === entry.params[0].key && p.live), `${id}: specific param is live in trSchema`);
}

// 3. Non-default values change the expression (and prune back to default).
for (const id of FEATHER_IDS) {
  const a = transitionExpr({ type: id, params: { feather: 0.2 } });
  ok(norm(a) !== norm(LEGACY[id]), `${id}: feather 0.2 changes the expression`);
  ok(norm(transitionExpr({ type: id, params: mergeTrParams(id, { feather: 0 }) })) === norm(LEGACY[id]), `${id}: feather 0 prunes to legacy`);
}
for (const id of STRENGTH_IDS) {
  const a = transitionExpr({ type: id, params: { strength: 1.5 } });
  ok(norm(a) !== norm(LEGACY[id]), `${id}: strength 1.5 changes the expression`);
  ok(norm(transitionExpr({ type: id, params: mergeTrParams(id, { strength: 1 }) })) === norm(LEGACY[id]), `${id}: strength 1 prunes to legacy`);
}

// 4. Endpoint coverage never regresses with feather: extract the smooth band
//    from the legacy and feathered expressions and compare its edges at the
//    two ends (P = 0 and P = 1). For prog 'P' bands: the high edge at P = 0
//    must not rise above the legacy high edge (nothing flips early) and the
//    low edge at P = 1 must not fall below the legacy low edge (nothing flips
//    late). For the reverse-iris band (prog '1-P') the roles swap.
const bandOf = (expr) => {
  const m = expr.match(/smooth\(([^,]+),\s*([^,]+),\s*ld\(\d+\)\)/);
  if (!m) return null;
  return { lo: new Function('P', `return ${m[1]}`), hi: new Function('P', `return ${m[2]}`), loRaw: m[1] };
};
for (const id of FEATHER_IDS) {
  const legacyBand = bandOf(LEGACY[id]);
  const feathered = transitionExpr({ type: id, params: { feather: 0.3 } });
  const band = bandOf(feathered);
  ok(!!legacyBand && !!band, `${id}: smooth band found in both forms`);
  if (!legacyBand || !band) continue;
  const reverse = legacyBand.loRaw.includes('(1-P)');
  if (!reverse) {
    ok(band.hi(0) <= legacyBand.hi(0) + 1e-9, `${id}: feathered hi(0)=${band.hi(0)} <= legacy ${legacyBand.hi(0)}`);
    ok(band.lo(1) >= legacyBand.lo(1) - 1e-9, `${id}: feathered lo(1)=${band.lo(1)} >= legacy ${legacyBand.lo(1)}`);
  } else {
    ok(band.lo(0) >= legacyBand.lo(0) - 1e-9, `${id}: reverse feathered lo(0)=${band.lo(0)} >= legacy ${legacyBand.lo(0)}`);
    ok(band.hi(1) <= legacyBand.hi(1) + 1e-9, `${id}: reverse feathered hi(1)=${band.hi(1)} <= legacy ${legacyBand.hi(1)}`);
  }
}

if (fails.length) { console.log(`\ntest-tr-params: FAIL (${fails.length})`); process.exit(1); }
console.log('\ntest-tr-params: PASS');
