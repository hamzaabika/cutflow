// Generates Cutflow's own bundled LUTs (cf-*.cube) into shared/luts/.
//
// These LUTs are 100% original: each is a closed-form colour transform written
// for Cutflow (Sprint 12), evaluated procedurally over a 17^3 grid — no sampled
// footage, no third-party LUT data, nothing downloaded. Re-running this script
// reproduces the shipped files byte-for-byte.
//
// The five slay-*.cube files beside them are a separate, attributed third-party
// set (CC BY 4.0, see LICENSE-slay-CC-BY-4.0.txt) and are NOT touched here.
// Usage: node scripts/gen-bundled-luts.cjs
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 17;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sat = ([r, g, b], s) => { const y = luma(r, g, b); return [y + (r - y) * s, y + (g - y) * s, y + (b - y) * s]; };

// Each look: (r, g, b) in [0, 1] -> [r, g, b] in [0, 1].
const LOOKS = [
  {
    file: 'cf-01-teak.cube', title: 'Cutflow Teak',
    // Warm wood: gentle gamma lift, saturation up a touch, shadows warmed, a whisper of gold in the highlights.
    apply(r, g, b) {
      let c = sat([Math.pow(r, 0.92), Math.pow(g, 0.92), Math.pow(b, 0.92)], 1.05);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] + sh * 0.055 + y * y * 0.02, c[1] + sh * 0.015, c[2] - sh * 0.05];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-02-glacier.cube', title: 'Cutflow Glacier',
    // Cold and clean: desaturated a fraction, shadows pushed blue, highlights lifted clear.
    apply(r, g, b) {
      let c = sat([r, g, b], 0.94);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] * 1.015 - sh * 0.035, c[1] * 1.015 + sh * 0.012, c[2] * 1.015 + sh * 0.05];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-03-rose.cube', title: 'Cutflow Rose',
    // Soft portrait blush: a mild S-curve and pink warmed into the highlights only.
    apply(r, g, b) {
      const curve = (v) => v * 0.82 + 0.18 * (v * v * (3 - 2 * v));
      let c = sat([curve(r), curve(g), curve(b)], 1.02);
      const y = luma(...c);
      c = [c[0] + y * y * 0.07, c[1] - y * y * 0.015, c[2] + y * y * 0.02];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-04-slate.cube', title: 'Cutflow Slate',
    // Desaturated blue-grey: lifted blacks, colour pulled back, shadows cooled.
    apply(r, g, b) {
      let c = sat([r, g, b], 0.55).map((v) => 0.055 + v * 0.9);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] - sh * 0.02, c[1], c[2] + sh * 0.045];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-05-ember.cube', title: 'Cutflow Ember',
    // Warm ember: saturation up, shadows pushed orange, a gentle warm gamma.
    apply(r, g, b) {
      let c = sat([Math.pow(r, 0.95), Math.pow(g, 0.96), Math.pow(b, 0.97)], 1.12);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] + sh * 0.07, c[1] + sh * 0.02, c[2] - sh * 0.045];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-06-lagoon.cube', title: 'Cutflow Lagoon',
    // Lagoon teal: shadows to teal, highlights toward cyan glass.
    apply(r, g, b) {
      let c = sat([r, g, b], 1.08);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] - sh * 0.05 + y * y * 0.01, c[1] + sh * 0.045 + y * y * 0.05, c[2] + sh * 0.07 + y * y * 0.06];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-07-velvet.cube', title: 'Cutflow Velvet',
    // Velvet portrait: a deeper S-curve, rich reds in the midtones, blacks near-crushed.
    apply(r, g, b) {
      const curve = (v) => v * 0.68 + 0.32 * (v * v * (3 - 2 * v));
      let c = sat([curve(r), curve(g), curve(b)], 1.1);
      const y = luma(...c); const mid = 1 - Math.abs(y - 0.5) * 2;
      c = [c[0] + mid * 0.035, c[1] - mid * 0.008, c[2] - mid * 0.012];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-08-mono.cube', title: 'Cutflow Mono',
    // Warm monochrome: pure luma through a contrast curve, tinted like darkroom paper.
    apply(r, g, b) {
      const y0 = luma(r, g, b);
      const y = y0 * 0.8 + 0.2 * (y0 * y0 * (3 - 2 * y0));
      return [clamp01(y * 1.07 + 0.004), clamp01(y * 0.99), clamp01(y * 0.87)];
    },
  },
  {
    file: 'cf-09-goldenhour.cube', title: 'Cutflow Golden Hour',
    // Late sun: strong gold gains and a warm bloom in the highlights.
    apply(r, g, b) {
      let c = sat([r * 1.12, g * 0.99, b * 0.8], 1.06);
      const y = luma(...c);
      c = [c[0] + y * y * 0.07, c[1] + y * y * 0.028, c[2] - y * y * 0.01];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-10-forest.cube', title: 'Cutflow Forest',
    // Deep greens: green channel forward, shadows sunk toward pine.
    apply(r, g, b) {
      let c = sat([r * 0.97, g * 1.09, b * 0.95], 1.15);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] - sh * 0.03, c[1] + sh * 0.03, c[2] - sh * 0.01];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-11-candy.cube', title: 'Cutflow Candy',
    // Candy pop: high saturation, a lift in the blacks, magenta kissed highlights.
    apply(r, g, b) {
      let c = sat([r, g, b], 1.45).map((v) => 0.03 + v * 0.96);
      const y = luma(...c);
      c = [c[0] + y * y * 0.05, c[1] - y * y * 0.01, c[2] + y * y * 0.045];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-12-denim.cube', title: 'Cutflow Denim',
    // Faded denim: colour pulled back, shadows dyed blue, a worn lift.
    apply(r, g, b) {
      let c = sat([r, g, b], 0.7).map((v) => 0.045 + v * 0.92);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] - sh * 0.045, c[1] - sh * 0.012, c[2] + sh * 0.055];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-13-noir.cube', title: 'Cutflow Noir LUT',
    // Hard noir: a strong S-curve, colour drained to a third, blacks crushed.
    apply(r, g, b) {
      const curve = (v) => { const s = v * v * (3 - 2 * v); return v * 0.45 + 0.55 * s; };
      let c = sat([curve(r), curve(g), curve(b)], 0.35);
      return c.map((v) => clamp01(Math.pow(v, 1.06)));
    },
  },
  {
    file: 'cf-14-peach.cube', title: 'Cutflow Peach',
    // Soft peach skin: gentle gains, a small lift, a kind curve.
    apply(r, g, b) {
      const curve = (v) => v * 0.88 + 0.12 * (v * v * (3 - 2 * v));
      let c = sat([curve(r) * 1.06, curve(g) * 0.98, curve(b) * 0.91], 1.04).map((v) => 0.02 + v * 0.97);
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-15-arctic.cube', title: 'Cutflow Arctic',
    // Bright ice: exposure up, blue deep in the shadows, icy highlights.
    apply(r, g, b) {
      let c = sat([r * 1.07, g * 1.07, b * 1.08], 0.9);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] - sh * 0.05, c[1] + sh * 0.005, c[2] + sh * 0.075 + y * y * 0.05];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-16-vintage70.cube', title: 'Cutflow Vintage 70',
    // Seventies print: lifted warm blacks, colour at three quarters, soft gamma.
    apply(r, g, b) {
      let c = sat([Math.pow(r, 1.04), Math.pow(g, 1.03), Math.pow(b, 1.02)], 0.72);
      c = [0.085 + c[0] * 0.9, 0.055 + c[1] * 0.9, 0.02 + c[2] * 0.88];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-17-neon.cube', title: 'Cutflow Neon',
    // Neon night: per-channel curves at different strengths and electric gains.
    apply(r, g, b) {
      const cr = (v) => v * 0.6 + 0.4 * (v * v * (3 - 2 * v));
      const cb = (v) => v * 0.78 + 0.22 * (v * v * (3 - 2 * v));
      let c = sat([cr(r) * 1.06, cb(g) * 0.94, cr(b) * 1.13], 1.3);
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-18-sepia.cube', title: 'Cutflow Sepia',
    // Classic sepia matrix, evaluated in closed form.
    apply(r, g, b) {
      return [
        clamp01(0.393 * r + 0.769 * g + 0.189 * b),
        clamp01(0.349 * r + 0.686 * g + 0.168 * b),
        clamp01(0.272 * r + 0.534 * g + 0.131 * b),
      ];
    },
  },
  {
    file: 'cf-19-meadow.cube', title: 'Cutflow Meadow',
    // Spring meadow: bright gamma, green-gold shadows, lively saturation.
    apply(r, g, b) {
      let c = sat([Math.pow(r, 0.9), Math.pow(g, 0.88), Math.pow(b, 0.92)], 1.2);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] + sh * 0.02, c[1] + sh * 0.045, c[2] - sh * 0.03];
      return c.map(clamp01);
    },
  },
  {
    file: 'cf-20-dusk.cube', title: 'Cutflow Dusk',
    // Violet dusk: shadows sink into purple, highlights keep a pink afterglow.
    apply(r, g, b) {
      let c = sat([r, g, b], 1.05).map((v) => 0.025 + v * 0.95);
      const y = luma(...c); const sh = 1 - y;
      c = [c[0] + sh * 0.045 + y * y * 0.04, c[1] - sh * 0.03, c[2] + sh * 0.08 + y * y * 0.015];
      return c.map(clamp01);
    },
  },
];

const outDir = path.join(__dirname, '..', 'shared', 'luts');
for (const look of LOOKS) {
  const lines = [
    `# ${look.title} — an original LUT authored for Cutflow.`,
    '# Generated procedurally by scripts/gen-bundled-luts.cjs from a closed-form',
    '# transform written for this product. No third-party data.',
    `TITLE "${look.title}"`,
    `LUT_3D_SIZE ${SIZE}`,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0',
  ];
  // .cube order: red changes fastest, then green, then blue.
  for (let b = 0; b < SIZE; b++) for (let g = 0; g < SIZE; g++) for (let r = 0; r < SIZE; r++) {
    const [ro, go, bo] = look.apply(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1));
    lines.push(`${ro.toFixed(6)} ${go.toFixed(6)} ${bo.toFixed(6)}`);
  }
  const file = path.join(outDir, look.file);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  console.log(`wrote ${look.file} (${SIZE}^3 = ${SIZE ** 3} entries)`);
}
