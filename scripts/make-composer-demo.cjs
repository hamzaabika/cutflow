// Master Stage 7 #3 — Creative-composer demo (vertical sample timeline).
// Builds docs/composer-demo/: two generated 1080x1920 test clips + a project
// JSON that shows the five demo beats against the current engine:
//
//   1. Glow        — clip A carries fx_bloom2 (Glow Bloom).
//   2. Film Burn   — clip B enters with fx_lightburn (Light Burn). The
//                    fx_filmburn TRANSITION is one of the 19 removed
//                    transitions and is NOT used; Light Burn is the
//                    never-removed burn-style A→B transition and stands in.
//   3. Flicker     — the caption's animIn is the 'flicker' text animation.
//   4. Zoom        — clip C enters with the fx_zoomin transition.
//   5. Caption highlight — the caption uses the Word Box highlight
//                    (highlight.mode 'box') with word timings.
//
// Nothing here duplicates CC-01/CC-02 effect work: every id is looked up in
// the shipped catalog and the script fails loudly on an unknown one.
//
// Usage: node scripts/make-composer-demo.cjs [--regenerate-media]
//   --regenerate-media re-renders the test clips with ffmpeg (needs ffmpeg
//   on PATH); without it, existing media files are reused.
const { execFileSync } = require('node:child_process');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const ROOT = join(__dirname, '..');
const DIR = join(ROOT, 'docs', 'composer-demo');
const MEDIA = join(DIR, 'media');
const REGEN = process.argv.includes('--regenerate-media');

async function main() {
  const { normalizeProject } = await import('../src/store.js');
  const { PIXEL_EFFECTS, FX_TRANSITIONS } = await import('../src/fx/catalog.js');

  mkdirSync(MEDIA, { recursive: true });

  const clips = [
    { file: 'clip-a.mp4', hue: 'h=0', label: 'A' },
    { file: 'clip-b.mp4', hue: 'h=60', label: 'B' },
  ];
  for (const c of clips) {
    const out = join(MEDIA, c.file);
    if (existsSync(out) && !REGEN) continue;
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=3',
      '-vf', `hue=${c.hue},format=yuv420p`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ], { stdio: 'inherit' });
    console.log('rendered', c.file);
  }

  const project = {
    name: 'Composer vertical demo',
    width: 1080, height: 1920, ratio: '9:16', resolution: 1080, fps: 30,
    background: '#000000',
    media: [
      { id: 'demo-a', name: 'clip-a.mp4', path: 'media/clip-a.mp4', type: 'video', duration: 3, width: 1080, height: 1920 },
      { id: 'demo-b', name: 'clip-b.mp4', path: 'media/clip-b.mp4', type: 'video', duration: 3, width: 1080, height: 1920 },
    ],
    // Beat 1 — Glow: fx_bloom2 on clip A.
    // Beat 2 — Film Burn A→B: fx_lightburn transition into clip B (+ Dream Bloom).
    // Beat 4 — Zoom: fx_zoomin transition into clip C.
    videoClips: [
      { id: 'demo-v1', mediaId: 'demo-a', in: 0, out: 3, speed: 1, effects: ['fx_bloom2'] },
      { id: 'demo-v2', mediaId: 'demo-b', in: 0, out: 3, speed: 1, effects: ['fx_dreambloom'], transition: { type: 'fx_lightburn', duration: 0.9 } },
      { id: 'demo-v3', mediaId: 'demo-a', in: 0, out: 3, speed: 1, effects: [], transition: { type: 'fx_zoomin', duration: 0.7 } },
    ],
    // Beats 3 + 5 — Flicker in + Word Box highlight, word-timed.
    textClips: [
      {
        id: 'demo-cap1', text: 'Glow burn flicker zoom', start: 0.5, duration: 8, caption: true,
        font: 'montserrat', bold: true, color: '#ffffff', size: 81, y: 0.8,
        stroke: { width: 5, color: '#000000' }, shadow: { color: '#000000', blur: 12, x: 0, y: 3, opacity: 0.8 },
        highlight: { mode: 'box', color: '#ffffff', bg: '#7c3aed' },
        animIn: { id: 'flicker', dur: 0.6 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 },
        words: [
          { text: 'Glow', start: 0, end: 1.9 },
          { text: 'burn', start: 2, end: 3.9 },
          { text: 'flicker', start: 4, end: 5.9 },
          { text: 'zoom', start: 6, end: 8 },
        ],
      },
    ],
    audioClips: [], overlayClips: [], effectClips: [], stickerClips: [],
  };

  // --- Validation: the demo must load through the app's own normalizer, and
  // every effect / transition id must exist in the shipped catalog. ----------
  const blocked = ['fx_filmburn'];
  const usedFx = project.videoClips.flatMap((c) => c.effects || []);
  const usedTr = project.videoClips.map((c) => c.transition?.type).filter(Boolean);
  for (const id of usedFx) {
    if (!PIXEL_EFFECTS.some((e) => e.id === id)) throw new Error(`demo effect not in catalog: ${id}`);
    if (blocked.includes(id)) throw new Error(`demo uses blocked id: ${id}`);
  }
  for (const id of usedTr) {
    if (!FX_TRANSITIONS.some((e) => e.id === id)) throw new Error(`demo transition not in catalog: ${id}`);
    if (blocked.includes(id)) throw new Error(`demo uses blocked id: ${id}`);
  }
  const loaded = normalizeProject(project);
  if (loaded.width !== 1080 || loaded.height !== 1920) throw new Error('demo is not vertical 1080x1920');
  if (loaded.videoClips.length !== 3 || loaded.textClips.length !== 1) throw new Error('demo clips lost in normalize');
  if (loaded.textClips[0].animIn?.id !== 'flicker') throw new Error('demo caption lost its flicker anim');
  if (loaded.textClips[0].highlight?.mode !== 'box') throw new Error('demo caption lost its highlight');

  writeFileSync(join(DIR, 'composer-vertical-demo.json'), `${JSON.stringify(project, null, 2)}\n`);
  console.log('make-composer-demo: PASS — docs/composer-demo/composer-vertical-demo.json');
  console.log('  beats: glow fx_bloom2 / burn fx_lightburn (fx_filmburn NOT used) / flicker anim / zoom fx_zoomin / caption box highlight');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
