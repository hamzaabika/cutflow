// Catalog of looks shared by the UI. Filters are GPU looks (src/fx/filters.js), the same in the player and the
// export. The legacy Adjust settings and the classic effects are shader passes too (src/fx/adjust.js and
// the classic shader forms in src/fx/params.js) — one engine for preview and export (Sprint 6 unification).
import { FX_TRANSITIONS, OVERLAY_EFFECTS, PIXEL_EFFECTS } from './fx/catalog.js';
import { FILTER_LOOKS } from './fx/filters.js';

export const FILTERS = FILTER_LOOKS.map(({ id, name, cat }) => ({ id, name, cat }));

// Effects grouped by the §B creative categories. Only categories with real effects in this
// engine are listed — there are no Beauty, Background or AI effects in the engine (yet).
export const EFFECT_GROUPS = ['Glitch & Digital', 'Blur & Focus', 'Distortion & Mirror', 'Film & Vintage', 'Light & Glow', 'Particles & Weather', 'Motion'];
const PIXEL_GROUPS = { fx_vhs: 'Film & Vintage', fx_striped: 'Glitch & Digital', fx_bwgrit: 'Film & Vintage', fx_zoomblast: 'Motion',
  // The expanded library (src/fx/catalog.js pixelLibrary()).
  fx_rgb2: 'Glitch & Digital', fx_rgb6: 'Glitch & Digital', fx_rgb8: 'Glitch & Digital', fx_rgbv: 'Glitch & Digital',
  fx_slices: 'Glitch & Digital', fx_slicesbig: 'Glitch & Digital', fx_mosh: 'Glitch & Digital',
  fx_mosaic60: 'Glitch & Digital', fx_mosaic24: 'Glitch & Digital', fx_mosaic10: 'Glitch & Digital',
  fx_poster4: 'Glitch & Digital', fx_poster6: 'Glitch & Digital', fx_solar: 'Glitch & Digital', fx_invert: 'Glitch & Digital',
  fx_bitcut: 'Glitch & Digital', fx_scanline: 'Glitch & Digital', fx_crt: 'Glitch & Digital', fx_vhstrack: 'Glitch & Digital', fx_dither: 'Glitch & Digital',
  fx_soft1: 'Blur & Focus', fx_soft2: 'Blur & Focus', fx_soft3: 'Blur & Focus',
  fx_mblurh: 'Blur & Focus', fx_mblurv: 'Blur & Focus', fx_mblurd: 'Blur & Focus',
  fx_radial1: 'Blur & Focus', fx_radial2: 'Blur & Focus', fx_tilt: 'Blur & Focus', fx_tiltwide: 'Blur & Focus', fx_spinblur2: 'Blur & Focus',
  fx_kaleido4: 'Distortion & Mirror', fx_kaleido6: 'Distortion & Mirror', fx_kaleido8: 'Distortion & Mirror', fx_kaleido12: 'Distortion & Mirror',
  fx_mirrorquad: 'Distortion & Mirror', fx_twirl1: 'Distortion & Mirror', fx_twirl2: 'Distortion & Mirror',
  fx_bulge: 'Distortion & Mirror', fx_pinch: 'Distortion & Mirror', fx_squeeze: 'Distortion & Mirror', fx_stretchx: 'Distortion & Mirror',
  fx_wavewarp: 'Distortion & Mirror', fx_tunnel: 'Distortion & Mirror', fx_prism: 'Distortion & Mirror',
  fx_fisheye: 'Distortion & Mirror', fx_stainedglass: 'Distortion & Mirror',
  fx_grainfine: 'Film & Vintage', fx_grainheavy: 'Film & Vintage', fx_sepia: 'Film & Vintage', fx_faded: 'Film & Vintage',
  fx_bleach: 'Film & Vintage', fx_infrared: 'Film & Vintage', fx_duotone: 'Film & Vintage', fx_halftone: 'Film & Vintage',
  fx_scratch: 'Film & Vintage', fx_flicker: 'Film & Vintage', fx_oldphoto: 'Film & Vintage', fx_noir: 'Film & Vintage',
  fx_emboss: 'Film & Vintage', fx_hatchlines: 'Film & Vintage', fx_warhol: 'Film & Vintage', fx_blueprint: 'Film & Vintage',
  fx_leaktl: 'Light & Glow', fx_leaktr: 'Light & Glow', fx_leakbl: 'Light & Glow', fx_leakcool: 'Light & Glow',
  fx_leakmagenta: 'Light & Glow', fx_leakedge: 'Light & Glow', fx_bloom1: 'Light & Glow', fx_bloom2: 'Light & Glow',
  fx_spotlight: 'Light & Glow', fx_whitevig: 'Light & Glow', fx_washgold: 'Light & Glow', fx_washteal: 'Light & Glow', fx_glowpulse: 'Light & Glow',
  fx_thermal: 'Light & Glow', fx_neonedge: 'Light & Glow', fx_nightvision: 'Light & Glow',
  fx_shake1: 'Motion', fx_shake2: 'Motion', fx_jitter: 'Motion', fx_drift: 'Motion',
  fx_pulsezoom: 'Motion', fx_breathe: 'Motion', fx_strobe: 'Motion', fx_spinslow: 'Motion', fx_zoomslow: 'Motion',
  // Library mega-growth (10/10 step 3).
  fx_rgdiag: 'Glitch & Digital', fx_chromazoom: 'Glitch & Digital', fx_blockglitch: 'Glitch & Digital', fx_rowshift: 'Glitch & Digital',
  fx_meltpixels: 'Glitch & Digital', fx_quantize: 'Glitch & Digital', fx_edgelines: 'Glitch & Digital', fx_ascii: 'Glitch & Digital',
  fx_interlace: 'Glitch & Digital', fx_tornframe: 'Glitch & Digital',
  fx_boxblur: 'Blur & Focus', fx_depthband: 'Blur & Focus', fx_miniature: 'Blur & Focus', fx_spinblur1: 'Blur & Focus',
  fx_zoomtrails: 'Blur & Focus', fx_frost: 'Blur & Focus', fx_hexblur: 'Blur & Focus', fx_sharpen: 'Blur & Focus',
  fx_kaleido5: 'Distortion & Mirror', fx_kaleido10: 'Distortion & Mirror', fx_mirrorh: 'Distortion & Mirror', fx_mirrorseam: 'Distortion & Mirror',
  fx_floorreflect: 'Distortion & Mirror', fx_wavev: 'Distortion & Mirror', fx_pond: 'Distortion & Mirror', fx_barrelroll: 'Distortion & Mirror', fx_skew: 'Distortion & Mirror',
  fx_colorgrain: 'Film & Vintage', fx_hardvig: 'Film & Vintage', fx_fadedblue: 'Film & Vintage', fx_xprocess: 'Film & Vintage',
  fx_deepsepia: 'Film & Vintage', fx_softmono: 'Film & Vintage', fx_technicolor: 'Film & Vintage', fx_filmborder: 'Film & Vintage', fx_agedpaper: 'Film & Vintage',
  fx_leakstrip: 'Light & Glow', fx_leakdiag: 'Light & Glow', fx_sunglow: 'Light & Glow', fx_halo: 'Light & Glow',
  fx_starburst: 'Light & Glow', fx_prismglow: 'Light & Glow', fx_fogglow: 'Light & Glow', fx_moonlight: 'Light & Glow', fx_candle: 'Light & Glow',
  fx_rollshake: 'Motion', fx_quake: 'Motion', fx_zoomburst: 'Motion', fx_panleft: 'Motion',
  fx_tiltup2: 'Motion', fx_orbit: 'Motion', fx_glitchshake: 'Motion', fx_heartbeat: 'Motion', fx_spinpulse: 'Motion' };

const OVERLAY_GROUPS = { fx_snow: 'Particles & Weather', fx_fire: 'Particles & Weather', fx_limelight: 'Light & Glow', fx_burning: 'Light & Glow',
  fx_snowlight: 'Particles & Weather', fx_blizzard: 'Particles & Weather', fx_rain: 'Particles & Weather', fx_downpour: 'Particles & Weather',
  fx_dust: 'Particles & Weather', fx_golddust: 'Particles & Weather', fx_sparkles: 'Particles & Weather', fx_embers: 'Particles & Weather',
  fx_ash: 'Particles & Weather', fx_fog: 'Particles & Weather', fx_confetti: 'Particles & Weather', fx_fireflies: 'Particles & Weather',
  fx_bokeh: 'Particles & Weather', fx_petals: 'Particles & Weather', fx_bubbles: 'Particles & Weather', fx_leaves: 'Particles & Weather',
  fx_hearts: 'Particles & Weather', fx_starfall: 'Particles & Weather', fx_sunrays: 'Light & Glow', fx_windowrain: 'Particles & Weather' };
export const EFFECTS = [
  { id: 'mirror', name: 'Mirror', icon: '⇋', group: 'Distortion & Mirror' },
  { id: 'flipv', name: 'Flip', icon: '⇵', group: 'Distortion & Mirror' },
  { id: 'vignette', name: 'Vignette', icon: '◉', group: 'Light & Glow' },
  { id: 'grain', name: 'Grain', icon: '░', group: 'Film & Vintage' },
  { id: 'blur', name: 'Blur', icon: '◌', group: 'Blur & Focus' },
  { id: 'pixel', name: 'Pixel', icon: '▦', group: 'Distortion & Mirror' },
  // Animated effects (src/fx/catalog.js): group shows them in the Effects panel.
  ...PIXEL_EFFECTS.map(({ id, name, icon }) => ({ id, name, icon, group: PIXEL_GROUPS[id] || 'Glitch & Digital' })),
  ...OVERLAY_EFFECTS.map(({ id, name, icon }) => ({ id, name, icon, group: OVERLAY_GROUPS[id] || 'Particles & Weather' })),
];

export const TRANSITIONS = [
  // Native: rendered by FFmpeg's xfade in the export and by transitionStyles in the
  // preview — the five types whose xfade behaviour was measured to match the preview
  // formulas exactly (pinned in scripts/test-transition-parity.cjs, Sprint 6).
  { id: 'fade', name: 'Crossfade' },
  { id: 'wipeleft', name: 'Wipe Left' },
  { id: 'wiperight', name: 'Wipe Right' },
  { id: 'slideleft', name: 'Slide Left' },
  { id: 'slideright', name: 'Slide Right' },
  // Everything below — including the former natives dissolve / fadeblack / fadewhite /
  // circleopen, whose xfade forms diverge from the preview — is a shared-engine
  // transition: one expression, drawn identically by the preview and the export.
  ...FX_TRANSITIONS.map(({ id, name, duration }) => ({ id, name, duration, fx: true })),
];

export const ANIMATIONS = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade' },
  { id: 'pop', name: 'Pop' },
  { id: 'slideup', name: 'Slide Up' },
];

export const RATIOS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '4:3': [4, 3], '21:9': [21, 9] };

export function sizeFor(ratio, shortSide) {
  const [a, b] = RATIOS[ratio] || RATIOS['16:9'];
  const even = (n) => Math.round(n / 2) * 2;
  return a >= b ? { width: even((shortSide * a) / b), height: shortSide } : { width: shortSide, height: even((shortSide * b) / a) };
}

export const DEFAULT_ADJUST = { brightness: 0, contrast: 1, saturation: 1, hue: 0, blur: 0 };

// There is deliberately no CSS look path any more: the Adjust settings and the classic
// effects are shader passes in the shared renderer (src/fx/adjust.js, src/fx/apply.js),
// so the preview and the export draw the same picture. (clipCss, the CSS approximation
// this file used to export, was removed in the Sprint 6 unification.)

// Opacity / transform for a text clip's in/out animation at local time lt (seconds into the clip).
export function textAnim(clip, lt) {
  const d = Math.min(0.4, clip.duration / 2);
  const kin = Math.min(1, lt / d);
  const kout = Math.min(1, (clip.duration - lt) / d);
  const k = Math.max(0, Math.min(kin, kout));
  switch (clip.anim) {
    case 'fade': return { opacity: k, transform: '' };
    case 'pop': return { opacity: k, transform: `scale(${0.6 + 0.4 * k})` };
    case 'slideup': return { opacity: k, transform: `translateY(${(1 - k) * 40}%)` };
    default: return { opacity: 1, transform: '' };
  }
}
