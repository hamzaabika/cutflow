// True 2D particle system (MisterHorse P2-1) — original work, built for Cutflow.
// The old weather overlays were hardcoded canvas paintings (a fixed flake
// count, one baked motion); this is a real system: seeded emitters with
// velocity, gravity, wind, sway, life and fade, eight presets, and six
// tunable knobs in the inspector. It is deterministic and closed-form —
// particle i's state at time t is a pure function of its seed and t, so
// scrubbing, preview and export agree frame-for-frame with no frame-order
// dependence and no per-frame state to keep.
//
// Shapes are vector-drawn (circle / flake / streak / rect / glow); no image
// sprites yet — a custom-sprite slot would need media plumbing and is left
// open rather than faked.

// Deterministic 0..1 hash of a number (the same family as the catalog's rnd).
const hash01 = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// One preset = the character of the system: shape, direction, base fall
// speed (fraction of frame height per second), life, base size, sway and
// spin. The inspector sliders scale these bases, they do not replace them.
export const PARTICLE_PRESETS = [
  { id: 'snowfall', name: 'Snowfall', shape: 'flake', dir: 'down', fall: 0.09, life: 9, size: 1.0, sway: 0.6, spin: 0.4, colors: ['#ffffff', '#e8eef7', '#d6e2f2'] },
  { id: 'rain', name: 'Rain', shape: 'streak', dir: 'down', fall: 0.75, life: 1.2, size: 1.0, sway: 0.05, spin: 0, colors: ['#b8c7d9', '#9fb4cc', '#d3deeb'] },
  { id: 'embers', name: 'Embers', shape: 'circle', dir: 'up', fall: 0.16, life: 4, size: 0.9, sway: 0.35, spin: 0, glow: true, colors: ['#ff9a3c', '#ff6b1a', '#ffd166', '#ff3d00'] },
  { id: 'sparks', name: 'Sparks', shape: 'streak', dir: 'burst', fall: 0.5, life: 0.9, size: 0.8, sway: 0, spin: 0, colors: ['#ffe08a', '#ffffff', '#ffb347'] },
  { id: 'confetti', name: 'Confetti', shape: 'rect', dir: 'down', fall: 0.16, life: 6, size: 1.0, sway: 0.5, spin: 2.5, colors: ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'] },
  { id: 'bubbles', name: 'Bubbles', shape: 'circle', dir: 'up', fall: 0.10, life: 8, size: 1.1, sway: 0.4, spin: 0, colors: ['#ffffff', '#bfe9ff', '#dff3ff'] },
  { id: 'fireflies', name: 'Fireflies', shape: 'glow', dir: 'float', fall: 0.05, life: 7, size: 1.0, sway: 0.8, spin: 0, colors: ['#dcff96', '#aaf05a', '#fff3a0'] },
  { id: 'dust', name: 'Dust', shape: 'circle', dir: 'float', fall: 0.02, life: 12, size: 0.7, sway: 0.5, spin: 0, colors: ['#f5efe0', '#e8ddc4', '#ffffff'] },
];
export const PRESET_BY_ID = Object.fromEntries(PARTICLE_PRESETS.map((p) => [p.id, p]));

// Inspector defaults — preset-independent, so the sparse param storage
// (only non-default values are kept) stays correct when the preset changes.
export const PARTICLE_DEFAULTS = { preset: 'snowfall', count: 150, speed: 1, size: 1, gravity: 1, wind: 0, opacity: 0.9, sway: 0.5 };

// The inspector schema for fx_particles (src/fx/params.js fxSchema).
export const PARTICLE_SCHEMA = [
  { key: 'preset', name: 'Preset', options: PARTICLE_PRESETS.map((p) => p.id), optionLabels: Object.fromEntries(PARTICLE_PRESETS.map((p) => [p.id, p.name])), def: 'snowfall' },
  { key: 'count', name: 'Count', min: 10, max: 600, def: 150, step: 10 },
  { key: 'speed', name: 'Speed', min: 0.2, max: 3, def: 1, step: 0.05 },
  { key: 'size', name: 'Size', min: 0.3, max: 3, def: 1, step: 0.05 },
  { key: 'gravity', name: 'Gravity', min: 0, max: 2, def: 1, step: 0.05 },
  { key: 'wind', name: 'Wind', min: -1, max: 1, def: 0, step: 0.05 },
  { key: 'opacity', name: 'Opacity', min: 0.1, max: 1, def: 0.9, step: 0.01, fmt: 'pct' },
  { key: 'sway', name: 'Sway', min: 0, max: 1, def: 0.5, step: 0.01, fmt: 'pct' },
];

const clampNum = (v, min, max, fb) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fb;
};

// Stored (sparse) values merged over the defaults, validated and clamped.
// Unknown presets fall back to snowfall; out-of-range numbers clamp.
export function resolveParticleConfig(stored) {
  const v = { ...PARTICLE_DEFAULTS, ...(stored || {}) };
  return {
    preset: PRESET_BY_ID[v.preset] ? v.preset : 'snowfall',
    count: Math.round(clampNum(v.count, 10, 600, 150)),
    speed: clampNum(v.speed, 0.2, 3, 1),
    size: clampNum(v.size, 0.3, 3, 1),
    gravity: clampNum(v.gravity, 0, 2, 1),
    wind: clampNum(v.wind, -1, 1, 0),
    opacity: clampNum(v.opacity, 0.1, 1, 0.9),
    sway: clampNum(v.sway, 0, 1, 0.5),
  };
}

export const particleCount = (cfg) => cfg.count;

// State of particle i at time t (seconds) in a W x H frame, or null when it
// is fully faded. Closed-form: the particle loops its life — born at the
// emitter with a per-particle offset, it travels, then is reborn — so the
// same (i, t) always gives the same state.
export function particleAt(cfg, i, t, W, H) {
  const preset = PRESET_BY_ID[cfg.preset] || PRESET_BY_ID.snowfall;
  const depth = 0.45 + hash01(i * 2.3 + 1.7) * 0.55; // near particles: bigger, faster
  const life = preset.life * (0.6 + hash01(i * 3.1 + 4.2) * 0.8);
  const born = hash01(i * 7.7 + 9.1) * life;
  const age = (t + born) % life;
  const ph = age / life;
  // Fade in over the first 8% of life, out over the last 25%.
  const env = Math.min(1, ph / 0.08) * (1 - smooth01((ph - 0.75) / 0.25));
  if (env <= 0) return null;
  const fall = preset.fall * cfg.speed * depth;
  const swayAmp = preset.sway * cfg.sway * W * 0.02;
  const swayFreq = 0.9 + hash01(i * 5.3 + 2.2) * 1.4;
  const seed = hash01(i * 11.3 + 6.6);
  // Gravity as a bounded factor on the travel, not a raw acceleration: a
  // 0.5*g*age^2 term would fling long-lived particles (snowfall, 9s) far past
  // the frame. Gravity 1 is the preset's own fall; 2 adds up to 30% more
  // travel by end of life (down) or slows the rise by the same (up); 0 does
  // the opposite. The burst's life is under ~1.3s, so its small quadratic
  // pull-down below stays bounded.
  const gravF = 1 + (cfg.gravity - 1) * 0.3 * (age / life);
  const g = cfg.gravity * 0.06 * H; // gravity pull-down, px/s^2 (burst only)
  const windX = cfg.wind * age * W * 0.2;
  const swayX = Math.sin(age * swayFreq + seed * 6.283) * swayAmp;
  let x; let y; let angle = Math.PI / 2;
  if (preset.dir === 'down') {
    x = seed * W * 1.1 - W * 0.05 + windX + swayX;
    y = -H * 0.06 + fall * age * H * gravF;
  } else if (preset.dir === 'up') {
    x = seed * W + windX * 0.75 + swayX;
    y = H * 1.06 - fall * age * H * (2 - gravF);
  } else if (preset.dir === 'burst') {
    angle = seed * Math.PI * 2;
    const r = fall * age * H * 0.5;
    x = W / 2 + Math.cos(angle) * r + windX;
    y = H / 2 + Math.sin(angle) * r + 0.5 * g * age * age;
  } else { // float: slow drift around a home point, pulsing alpha
    const hx = W * (0.2 + 0.6 * seed);
    const hy = H * (0.2 + 0.6 * hash01(i * 3.7 + 8.4));
    x = hx + Math.sin(age * 0.5 + seed * 6.283) * W * 0.06 * (0.5 + cfg.sway) + windX * 0.5;
    y = hy + Math.cos(age * 0.4 + seed * 6.283) * H * 0.06 - age * 0.004 * H;
    angle = 0;
  }
  const pulse = preset.dir === 'float'
    ? (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(age * 1.3 + seed * 6.283)) ** 2)
    : 1;
  const alpha = Math.min(1, Math.max(0, cfg.opacity * env * pulse * (preset.dir === 'float' ? 0.85 : 1)));
  if (alpha <= 0.01) return null;
  return {
    x, y,
    r: Math.max(0.5, preset.size * cfg.size * depth * H * 0.011),
    alpha,
    rot: seed * 6.283 + age * preset.spin,
    angle,
    color: preset.colors[Math.floor(hash01(i * 13.7 + 5.5) * preset.colors.length) % preset.colors.length],
    shape: preset.shape,
    glow: !!preset.glow || preset.shape === 'glow',
  };
}

const smooth01 = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function drawShape(ctx, p) {
  ctx.globalAlpha = p.alpha;
  if (p.shape === 'circle' || p.shape === 'flake') {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    if (p.shape === 'flake') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(0.6, p.r * 0.18);
      ctx.beginPath();
      ctx.moveTo(p.x - p.r * 1.6, p.y); ctx.lineTo(p.x + p.r * 1.6, p.y);
      ctx.moveTo(p.x, p.y - p.r * 1.6); ctx.lineTo(p.x, p.y + p.r * 1.6);
      ctx.stroke();
    }
    return;
  }
  if (p.shape === 'glow') {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
    g.addColorStop(0, p.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (p.shape === 'streak') {
    const len = p.r * 6;
    const dx = Math.cos(p.angle) * len;
    const dy = Math.sin(p.angle) * len;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(0.8, p.r * 0.35);
    ctx.beginPath();
    ctx.moveTo(p.x - dx / 2, p.y - dy / 2);
    ctx.lineTo(p.x + dx / 2, p.y + dy / 2);
    ctx.stroke();
    return;
  }
  // rect: a tumbling vector tile.
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rot);
  ctx.fillStyle = p.color;
  ctx.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
  ctx.restore();
}

// Canvas draw for the overlay pass (preview and export share it): stored is
// the instance's sparse param map (clip.fxParams[fx] / effect clip .params),
// undefined = the snowfall defaults.
export function drawParticles(ctx, W, H, t, stored) {
  const cfg = resolveParticleConfig(stored);
  const n = particleCount(cfg);
  ctx.save();
  if (cfg.preset === 'embers' || cfg.preset === 'fireflies' || cfg.preset === 'sparks') ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const p = particleAt(cfg, i, t, W, H);
    if (p) drawShape(ctx, p);
  }
  ctx.restore();
}
