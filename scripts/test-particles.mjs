// MisterHorse P2-1 — true 2D particle system: deterministic closed-form sim,
// preset/config resolution, schema, and a canvas draw smoke test (stub ctx).
import { PARTICLE_PRESETS, PARTICLE_SCHEMA, PARTICLE_DEFAULTS, resolveParticleConfig, particleCount, particleAt, drawParticles } from '../src/fx/particles.js';
import { fxSchema, fxDefaults, mergeFxParams } from '../src/fx/params.js';
import { OVERLAY_EFFECTS } from '../src/fx/catalog.js';
import { EFFECTS } from '../src/effects.js';

const fails = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails.push(msg); };
const W = 1920; const H = 1080;

// 1. Eight presets, unique ids, every one drawable.
ok(PARTICLE_PRESETS.length === 8, `8 presets (got ${PARTICLE_PRESETS.length})`);
ok(new Set(PARTICLE_PRESETS.map((p) => p.id)).size === 8, 'preset ids unique');
for (const p of PARTICLE_PRESETS) {
  ok(['circle', 'flake', 'streak', 'rect', 'glow'].includes(p.shape), `${p.id}: shape ${p.shape}`);
  ok(['down', 'up', 'float', 'burst'].includes(p.dir), `${p.id}: dir ${p.dir}`);
  ok(Array.isArray(p.colors) && p.colors.length >= 2, `${p.id}: has a palette`);
}

// 2. Determinism: the same (particle, t) always gives the same state.
{
  const cfg = resolveParticleConfig({ preset: 'embers', count: 200 });
  const a = particleAt(cfg, 5, 1.23, W, H);
  const b = particleAt(cfg, 5, 1.23, W, H);
  ok(JSON.stringify(a) === JSON.stringify(b), 'particleAt is deterministic');
  const c = particleAt(cfg, 6, 1.23, W, H);
  ok(JSON.stringify(a) !== JSON.stringify(c), 'different particles differ');
  const d = particleAt(cfg, 5, 2.23, W, H);
  ok(JSON.stringify(a) !== JSON.stringify(d), 'the same particle moves over time');
}

// 3. Bounds + ranges: every preset, every sampled time, particles stay near
//    the frame, alpha in [0,1], size positive.
{
  let checked = 0; let bad = 0;
  for (const preset of PARTICLE_PRESETS) {
    const cfg = resolveParticleConfig({ preset: preset.id });
    for (let t = 0; t <= 10; t += 0.5) {
      for (let i = 0; i < particleCount(cfg); i += 7) {
        const p = particleAt(cfg, i, t, W, H);
        if (!p) continue;
        checked++;
        // Particles exit past the bottom (down) or top (up) before they are
        // reborn at the emitter, so y may run to 1.5H; x stays near the frame.
        if (!(p.x >= -0.25 * W && p.x <= 1.25 * W && p.y >= -0.25 * H && p.y <= 1.5 * H)) bad++;
        if (!(p.alpha >= 0 && p.alpha <= 1 && p.r > 0)) bad++;
      }
    }
  }
  ok(checked > 3000, `sampled ${checked} live particle states`);
  ok(bad === 0, `all sampled states in bounds (bad=${bad})`);
}

// 4. Config resolution: defaults, clamping, unknown preset fallback.
{
  const d = resolveParticleConfig(undefined);
  ok(d.preset === 'snowfall' && d.count === 150 && d.speed === 1 && d.opacity === 0.9, 'defaults resolve');
  ok(JSON.stringify(d) === JSON.stringify(PARTICLE_DEFAULTS), 'defaults equal PARTICLE_DEFAULTS');
  const c = resolveParticleConfig({ preset: 'rain', count: 9999, speed: -1, wind: 5 });
  ok(c.preset === 'rain' && c.count === 600 && c.speed === 0.2 && c.wind === 1, 'out-of-range values clamp');
  ok(resolveParticleConfig({ preset: 'nope' }).preset === 'snowfall', 'unknown preset falls back to snowfall');
  ok(particleCount(resolveParticleConfig({ count: 42 })) === 42, 'count respected');
}

// 5. Schema + param plumbing: the inspector sees the preset options and the
//    six sliders; merge keeps valid option strings and drops invalid ones.
{
  const schema = fxSchema('fx_particles');
  ok(Array.isArray(schema) && schema.length === 8, `schema has 8 entries (got ${schema?.length})`);
  const preset = schema.find((p) => p.key === 'preset');
  ok(preset && preset.options.length === 8 && preset.def === 'snowfall', 'preset is an 8-option entry');
  const defs = fxDefaults('fx_particles');
  ok(defs.preset === 'snowfall' && defs.count === 150, 'fxDefaults matches PARTICLE_DEFAULTS');
  ok(mergeFxParams('fx_particles', { preset: 'rain' }).preset === 'rain', 'merge keeps a valid preset');
  ok(mergeFxParams('fx_particles', { preset: 'nope' }).preset === 'snowfall', 'merge drops an invalid preset');
  ok(mergeFxParams('fx_particles', { count: 700 }).count === 600, 'merge clamps count');
}

// 6. Catalog + library: the effect is an overlay, in the Particles & Weather group.
{
  const entry = OVERLAY_EFFECTS.find((e) => e.id === 'fx_particles');
  ok(!!entry && entry.name === 'Particle System', 'fx_particles is an overlay effect');
  const lib = EFFECTS.find((e) => e.id === 'fx_particles');
  ok(!!lib && lib.group === 'Particles & Weather', 'fx_particles is in the effects library');
}

// 7. Draw smoke test on a stub canvas context: every preset draws, and the
//    draw count scales with the configured count.
function stubCtx() {
  const calls = { arc: 0, fillRect: 0, stroke: 0, fill: 0, gradient: 0 };
  const grad = { addColorStop() {} };
  return {
    calls,
    save() {}, restore() {}, beginPath() {}, closePath() {},
    arc() { calls.arc++; }, fill() { calls.fill++; }, fillRect() { calls.fillRect++; },
    stroke() { calls.stroke++; }, moveTo() {}, lineTo() {}, translate() {}, rotate() {},
    createRadialGradient() { calls.gradient++; return grad; },
    set globalAlpha(v) {}, set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set globalCompositeOperation(v) {},
  };
}
{
  for (const preset of PARTICLE_PRESETS) {
    const ctx = stubCtx();
    drawParticles(ctx, W, H, 1.5, { preset: preset.id });
    const total = ctx.calls.arc + ctx.calls.fillRect + ctx.calls.stroke;
    ok(total > 20, `${preset.id}: draws ${total} shapes at t=1.5`);
  }
  const small = stubCtx(); drawParticles(small, W, H, 1.5, { preset: 'snowfall', count: 10 });
  const big = stubCtx(); drawParticles(big, W, H, 1.5, { preset: 'snowfall', count: 300 });
  const tot = (c) => c.calls.arc + c.calls.fillRect + c.calls.stroke;
  ok(tot(big) > tot(small) * 5, `draw count scales with count (10 -> ${tot(small)}, 300 -> ${tot(big)})`);
  const def = stubCtx(); drawParticles(def, W, H, 0.5, undefined);
  ok(tot(def) > 20, 'undefined config draws the snowfall defaults');
}

if (fails.length) { console.log(`\ntest-particles: FAIL (${fails.length})`); process.exit(1); }
console.log('\ntest-particles: PASS');
