// Animated effects and transitions, written from scratch for Cutflow.
//
// Transitions and "pixel" effects are expressions (see expr.js): the export prints them for FFmpeg (xfade custom /
// geq) and the preview compiles the very same text to JavaScript, so both show the same picture. Sizes are always
// relative to W and H so a smaller preview canvas gives the same look. In transitions P goes 0 -> 1, A(x,y) is the
// outgoing clip and B(x,y) the incoming one; in effects T is the time in the clip and S(x,y) the source picture.

// Rounded-rectangle test (1 inside, 0 outside) for centre (cx, cy), half size (hw, hh), corner radius r.
const inRound = (cx, cy, hw, hh, r) =>
  `lt(hypot(max(abs(X-(${cx}))-(${hw})+(${r}),0),max(abs(Y-(${cy}))-(${hh})+(${r}),0))+min(max(abs(X-(${cx}))-(${hw})+(${r}),abs(Y-(${cy}))-(${hh})+(${r})),0)-(${r}),0)`;

// ---- Transitions from Transition Studio (github.com/Rhitottam/transition-studio, MIT, (c) 2025 rhitottaM) ----
// Its license:
//
// MIT License
//
// Copyright (c) 2025 rhitottaM
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
// Its WebGL shaders rewritten in this expression language. Changes: every one starts exactly on the outgoing clip
// and ends exactly on the incoming one (ripple, kaleidoscope and dreamy fade their effect in and out; page curl,
// diamond and crosshatch reach the whole frame), sizes follow the frame height (the same look at any resolution),
// rotations / circles keep the picture's proportions, and computed sample points get half a pixel so rounding never
// lands on the neighbouring pixel. The rise and fall of an effect is 4P(1-P) rather than
// sin(PI*P): it is exactly 0 at both ends, so the last frame is not shifted by a rounding error.
const inFrame = (x, y) => `between(${x}, 0, W)*between(${y}, 0, H)`;
// 9-tap horizontal blur of clip F (A or B) at X, Y, d pixels apart (weights of the original, which add up to 0.98:
// divided by that so the picture keeps its brightness).
const blur9 = (F, d) => `(${[[-4, 0.05], [-3, 0.09], [-2, 0.12], [-1, 0.15], [0, 0.16], [1, 0.15], [2, 0.12], [3, 0.09], [4, 0.05]]
  .map(([k, w]) => `${w}*${F}(X+(${k})*${d}, Y)`).join('+')})/0.98`;
// 3x3 box blur of clip F, d pixels apart (the original's 7x7 dreamy blur, lighter).
const box9 = (F, d) => [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => `${F}(X+(${i})*${d}, Y+(${j})*${d})`)).join('+');
// 10 samples towards the center (radial blur), amount a.
const radial10 = (F, a) => Array.from({ length: 10 }, (_, i) => `${F}(W/2+(X-W/2)*(1-(${a})*${i / 20})+0.5, H/2+(Y-H/2)*(1-(${a})*${i / 20})+0.5)`).join('+');

// ---- Helpers for the transition packs (below): offset multi-tap blurs and rotation / zoom sampling. ----
// 9-tap blur of clip F along X, centred at X + off, tap distance d (same weights as blur9).
const TAPW = [[-4, 0.05], [-3, 0.09], [-2, 0.12], [-1, 0.15], [0, 0.16], [1, 0.15], [2, 0.12], [3, 0.09], [4, 0.05]];
const hblurAt = (F, off, d) => `(${TAPW.map(([k, w]) => `${w}*${F}(X+(${off})+(${k})*(${d}), Y)`).join('+')})/0.98`;
const vblurAt = (F, off, d) => `(${TAPW.map(([k, w]) => `${w}*${F}(X, Y+(${off})+(${k})*(${d}))`).join('+')})/0.98`;
// Zoom blur of F: the frame is scaled by z (sampling a 1/z region) and streaked towards the centre by b
// (6 taps along the ray, b = 0 is a plain zoom; at z = 1 and b = 0 every tap is the pixel itself).
const zoomBlur = (F, z, b) => `(${Array.from({ length: 6 }, (_, i) => `${F}(W/2+(X-W/2)/(${z})*(1-(${b})*${(i / 5).toFixed(3)})+0.5, H/2+(Y-H/2)/(${z})*(1-(${b})*${(i / 5).toFixed(3)})+0.5)`).join('+')})/6`;
// Sample F rotated by angle a around the centre (the picture turns the other way), and an arc blur of F:
// 5 taps spread along the rotation arc around the base angle.
const rotSmp = (F, a) => `${F}(W/2+(X-W/2)*cos(${a})+(Y-H/2)*sin(${a})+0.5, H/2-(X-W/2)*sin(${a})+(Y-H/2)*cos(${a})+0.5)`;
const spinBlur = (F, ang, spread) => `(${[-1, -0.5, 0, 0.5, 1].map((k) => rotSmp(F, `(${ang})+(${spread})*${k}`)).join('+')})/5`;

export const STUDIO_TRANSITIONS = [
  { id: 'fx_wipeup', name: 'Wipe Up', duration: 0.6, expr: 'if(gt(Y, H*(1-P)), B(X, Y), A(X, Y))' },
  { id: 'fx_wipedown', name: 'Wipe Down', duration: 0.6, expr: 'if(lt(Y, H*P), B(X, Y), A(X, Y))' },
  {
    id: 'fx_diamond', name: 'Diamond Wipe', duration: 0.8,
    expr: `st(0, abs(X/W-0.5)+abs(Y/H-0.5)); st(1, smooth(P*1.06-0.05, P*1.06-0.01, ld(0)));
      B(X, Y)*(1-ld(1)) + A(X, Y)*ld(1)`,
  },
  { id: 'fx_slideup', name: 'Slide Up', duration: 0.6, expr: 'st(0, H*(1-P)); if(gte(Y, ld(0)), B(X, Y-ld(0)), A(X, Y))' },
  { id: 'fx_slidedown', name: 'Slide Down', duration: 0.6, expr: 'st(0, H*(1-P)); if(lte(Y, H-ld(0)), B(X, Y+ld(0)), A(X, Y))' },
  {
    id: 'fx_zoomin', name: 'Zoom In', duration: 0.7,
    // The next clip grows from the middle over the current one.
    expr: `st(0, max(P, 0.001)); st(1, W/2+(X-W/2)/ld(0)+0.5); st(2, H/2+(Y-H/2)/ld(0)+0.5);
      A(X, Y)*(1-P) + if(${inFrame('ld(1)', 'ld(2)')}, B(ld(1), ld(2)), 0)*P`,
  },
  {
    id: 'fx_zoomout', name: 'Zoom Out', duration: 0.7,
    // The current clip shrinks into the middle, uncovering the next one.
    expr: `st(0, max(1-P, 0.001)); st(1, W/2+(X-W/2)/ld(0)+0.5); st(2, H/2+(Y-H/2)/ld(0)+0.5);
      if(${inFrame('ld(1)', 'ld(2)')}, A(ld(1), ld(2)), 0)*(1-P) + B(X, Y)*P`,
  },
  {
    id: 'fx_spinout', name: 'Scale & Rotate', duration: 0.8,
    // The current clip turns a quarter and shrinks to half while the next one shows through.
    expr: `st(0, P*PI/2); st(1, 1-P*0.5); st(2, X-W/2); st(3, Y-H/2);
      st(4, (ld(2)*cos(ld(0))-ld(3)*sin(ld(0)))/ld(1)+W/2+0.5); st(5, (ld(2)*sin(ld(0))+ld(3)*cos(ld(0)))/ld(1)+H/2+0.5);
      if(${inFrame('ld(4)', 'ld(5)')}, A(ld(4), ld(5)), 0)*(1-P) + B(X, Y)*P`,
  },
  {
    id: 'fx_pixelate', name: 'Pixelate', duration: 0.8,
    expr: `st(0, max(1, (1+49*(4*P*(1-P)))*H/720)); st(1, floor(X/ld(0))*ld(0)+ld(0)/2); st(2, floor(Y/ld(0))*ld(0)+ld(0)/2);
      A(ld(1), ld(2))*(1-P) + B(ld(1), ld(2))*P`,
  },
  {
    id: 'fx_blur', name: 'Blur', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*20*H/720); (${blur9('A', 'ld(0)')})*(1-P) + (${blur9('B', 'ld(0)')})*P`,
  },
  {
    id: 'fx_glitch', name: 'Glitch', duration: 0.6,
    // Rows jump sideways with a red / blue split, strongest in the middle.
    expr: `st(0, (hash(floor(Y/(H*0.015))*1.37+floor(P*30)*7.13)-0.5)*(4*P*(1-P))*0.3*W);
      A(X+ld(0)*C(2, 1, 1), Y)*(1-P) + B(X-ld(0)*C(1, 1, 2), Y)*P`,
  },
  {
    id: 'fx_ripple', name: 'Ripple', duration: 1,
    expr: `st(0, hypot(X-W/2, Y-H/2)/H); st(1, sin((ld(0)-P)*30)*0.02*H*(4*P*(1-P))); st(2, max(ld(0)*H, 0.001));
      st(3, X+(X-W/2)/ld(2)*ld(1)+0.5); st(4, Y+(Y-H/2)/ld(2)*ld(1)+0.5);
      A(ld(3), ld(4))*(1-P) + B(ld(3), ld(4))*P`,
  },
  {
    id: 'fx_swirl', name: 'Swirl', duration: 1,
    // The current clip twists away from the middle; the next one untwists into place.
    expr: `st(0, X-W/2); st(1, Y-H/2); st(2, hypot(ld(0), ld(1))); st(3, atan2(ld(1), ld(0)));
      st(4, 2*PI*max(0, 1-ld(2)/H)); st(5, ld(3)+P*ld(4)); st(6, ld(3)+(1-P)*ld(4));
      A(W/2+ld(2)*cos(ld(5))+0.5, H/2+ld(2)*sin(ld(5))+0.5)*(1-P) + B(W/2+ld(2)*cos(ld(6))+0.5, H/2+ld(2)*sin(ld(6))+0.5)*P`,
  },
  {
    id: 'fx_kaleido', name: 'Kaleidoscope', duration: 1.2,
    // Six mirrored slices around the middle, fading in and out while the clips cross.
    expr: `st(0, hypot(X-W/2, Y-H/2)); st(1, atan2(Y-H/2, X-W/2)+PI); st(2, PI/3);
      st(3, floor(ld(1)/ld(2))); st(4, ld(1)-ld(3)*ld(2)); st(4, if(lt(fract(ld(3)/2), 0.25), ld(2)-ld(4), ld(4)));
      st(5, W/2+ld(0)*cos(ld(4))+0.5); st(6, H/2+ld(0)*sin(ld(4))+0.5); st(7, smooth(0, 1, P)); st(8, (4*P*(1-P)));
      (A(X, Y)*(1-ld(7)) + B(X, Y)*ld(7))*(1-ld(8)) + (A(ld(5), ld(6))*(1-ld(7)) + B(ld(5), ld(6))*ld(7))*ld(8)`,
  },
  {
    id: 'fx_dreamy', name: 'Dreamy', duration: 1.2,
    // A soft glow with a violet tint at the middle of the cross.
    expr: `st(0, (4*P*(1-P))); st(1, 4*H/720);
      st(2, A(X, Y)*(1-ld(0)) + (${box9('A', 'ld(1)')})/9*ld(0)); st(3, B(X, Y)*(1-ld(0)) + (${box9('B', 'ld(1)')})/9*ld(0));
      ld(2)*(1-P) + ld(3)*P + C(26, 13, 38)*ld(0)`,
  },
  {
    id: 'fx_pagecurl', name: 'Page Curl', duration: 1,
    // The page lifts from the right with a shadow on its edge and uncovers the next one.
    expr: `st(0, 1.3-P*1.7); st(1, X/W); st(2, smooth(ld(0)-0.3, ld(0)+0.1, ld(1)));
      st(3, smooth(ld(0), ld(0)+0.2, ld(1))*(1-smooth(ld(0)+0.2, ld(0)+0.4, ld(1))));
      A(X, Y)*(1-ld(3)*0.6)*(1-ld(2)) + B(X, Y)*ld(2)`,
  },
  {
    id: 'fx_warp', name: 'Directional Warp', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*0.1*W*sin(Y/H*10)); A(X+ld(0), Y)*(1-P) + B(X-ld(0), Y)*P`,
  },
  {
    id: 'fx_tiles', name: 'Mosaic Tiles', duration: 1,
    // The frame splits into tiles (largest mid-way, single pixels at both ends) that flip one by one to the next clip.
    expr: `st(0, max(1, H*0.08*(4*P*(1-P)))); st(1, floor(X/ld(0))); st(2, floor(Y/ld(0)));
      st(3, ld(1)*ld(0)+ld(0)/2); st(4, ld(2)*ld(0)+ld(0)/2);
      if(lt(hash(ld(1)*12.9898+ld(2)*78.233), P), B(ld(3), ld(4)), A(ld(3), ld(4)))`,
  },
  {
    id: 'fx_radialblur', name: 'Radial Blur', duration: 0.8,
    expr: `st(0, (4*P*(1-P))*2); (${radial10('A', 'ld(0)')})/10*(1-P) + (${radial10('B', 'ld(0)')})/10*P`,
  },
  {
    id: 'fx_crosshatch', name: 'Crosshatch', duration: 1,
    // Diagonal stripes reveal the next clip, getting finer until it fills the frame.
    expr: `st(0, 5+45*P); st(1, (X*0.7071-Y*0.7071)/100*ld(0)); st(2, gte(fract(ld(1)), 0.5));
      st(3, min(1, ld(2)*smooth(0, 0.6, P) + smooth(0.5, 1, P)));
      A(X, Y)*(1-ld(3)) + B(X, Y)*ld(3)`,
  },
  {
    id: 'fx_clockwipe', name: 'Clock Wipe', duration: 0.8,
    // A hand sweeps clockwise from the top; the next clip is whatever the hand has passed (Sprint 12, original).
    expr: `st(0, mod(atan2(X - W/2, -(Y - H/2)) + 6.28319, 6.28319)/6.28319);
      if(lt(ld(0), P), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_bandwipe', name: 'Band Wipe', duration: 0.8,
    // Eight horizontal bands wipe left-to-right, each starting a beat after the one above (Sprint 12, original).
    expr: `st(0, floor(Y/(H/8))); st(1, clip(P*1.7 - ld(0)*0.09, 0, 1));
      if(lt(X, W*ld(1)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_zoomthrough', name: 'Zoom Through', duration: 0.8,
    // The current clip rushes toward the viewer and dissolves as the next one settles back from a punch-in (Sprint 12, original).
    expr: `st(0, 1 + P*1.5); st(1, 1 + (1 - P)*2);
      A(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))*(1 - P) + B(W/2 + (X - W/2)/ld(1), H/2 + (Y - H/2)/ld(1))*P`,
  },
  {
    id: 'fx_spinfall', name: 'Spin Fall', duration: 0.9,
    // The current clip spins, shrinks and fades away over the next one (Sprint 12, original).
    expr: `st(0, P*1.1); st(1, 1 - P*0.45); st(2, W/2 + ((X - W/2)*cos(ld(0)) - (Y - H/2)*sin(ld(0)))/ld(1) + 0.5); st(3, H/2 + ((X - W/2)*sin(ld(0)) + (Y - H/2)*cos(ld(0)))/ld(1) + 0.5);
      if(${inFrame('ld(2)', 'ld(3)')}, A(ld(2), ld(3)), B(X, Y))*(1 - P) + B(X, Y)*P`,
  },
];

// ---- Transition packs: five packs of real engine transitions (Seamless, Mask & Reveal, Light & Glow,
// Distortion, Cinematic). Every one is written in the same expression language as the studio set, so the
// WebGL preview and the export render the identical motion. Each starts exactly on A and ends exactly
// on B: every blur / warp / shake amount is multiplied by a bell (4P(1-P) or sin(PI*P)) that is 0 at
// both ends, and every travel covers exactly one frame width / height at P = 1.
export const PACK_TRANSITIONS = [
  // -- Seamless: fast travel with blur coupled to the travel speed.
  {
    id: 'fx_whipleft', name: 'Whip Pan Left', duration: 0.5, pack: 'seamless',
    // Both clips race left; the 9-tap horizontal blur grows with the bell of speed, so mid-travel frames smear.
    expr: `st(0, W*P); st(1, (4*P*(1-P))*16*H/720);
      if(lt(X, W-ld(0)), ${hblurAt('A', 'ld(0)', 'ld(1)')}, ${hblurAt('B', 'ld(0)-W', 'ld(1)')})`,
  },
  {
    id: 'fx_whipright', name: 'Whip Pan Right', duration: 0.5, pack: 'seamless',
    expr: `st(0, W*P); st(1, (4*P*(1-P))*16*H/720);
      if(gte(X, ld(0)), ${hblurAt('A', '-ld(0)', 'ld(1)')}, ${hblurAt('B', 'W-ld(0)', 'ld(1)')})`,
  },
  {
    id: 'fx_whipup', name: 'Whip Pan Up', duration: 0.5, pack: 'seamless',
    expr: `st(0, H*P); st(1, (4*P*(1-P))*16*H/720);
      if(lt(Y, H-ld(0)), ${vblurAt('A', 'ld(0)', 'ld(1)')}, ${vblurAt('B', 'ld(0)-H', 'ld(1)')})`,
  },
  {
    id: 'fx_whipdown', name: 'Whip Pan Down', duration: 0.5, pack: 'seamless',
    expr: `st(0, H*P); st(1, (4*P*(1-P))*16*H/720);
      if(gte(Y, ld(0)), ${vblurAt('A', '-ld(0)', 'ld(1)')}, ${vblurAt('B', 'H-ld(0)', 'ld(1)')})`,
  },
  {
    id: 'fx_zoomblur', name: 'Zoom Blur', duration: 0.7, pack: 'seamless',
    // A punches in while its rays streak; B falls back from the same zoom, streaks fading as it lands.
    expr: `${zoomBlur('A', '1+0.9*P', '0.3*P')}*(1-P) + ${zoomBlur('B', '1+0.9*(1-P)', '0.3*(1-P)')}*P`,
  },
  {
    id: 'fx_spinblur', name: 'Spin Blur', duration: 0.8, pack: 'seamless',
    // A spins away, B counter-spins in; both are blurred along the rotation arc, most at mid-turn.
    expr: `${spinBlur('A', '-0.9*P', '0.55*P')}*(1-P) + ${spinBlur('B', '0.9*(1-P)', '0.55*(1-P)')}*P`,
  },
  {
    id: 'fx_warppush', name: 'Warp Push', duration: 0.6, pack: 'seamless',
    // A push left whose seam ripples: the travel coordinate itself is bent by a sine of Y, strongest mid-way.
    expr: `st(0, W*P); st(1, (4*P*(1-P))*0.06*W*sin(Y/H*PI*3)); st(2, X+ld(0)+ld(1));
      if(lt(ld(2), W), A(ld(2), Y), B(ld(2)-W, Y))`,
  },
  {
    id: 'fx_warpsmoothl', name: 'Smooth Warp Left', duration: 0.7, pack: 'seamless',
    // An eased push left with a gentle lens bulge across the frame that swells and settles.
    expr: `st(0, smooth(0, 1, P)); st(1, X+W*ld(0)+(4*P*(1-P))*0.07*W*sin(PI*X/W));
      if(lt(ld(1), W), A(ld(1), Y), B(ld(1)-W, Y))`,
  },
  {
    id: 'fx_warpsmoothr', name: 'Smooth Warp Right', duration: 0.7, pack: 'seamless',
    expr: `st(0, smooth(0, 1, P)); st(1, X-W*ld(0)+(4*P*(1-P))*0.07*W*sin(PI*X/W));
      if(gte(ld(1), 0), A(ld(1), Y), B(ld(1)+W, Y))`,
  },
  // -- Mask & Reveal: shaped reveals.
  {
    id: 'fx_blinds', name: 'Venetian Blinds', duration: 0.8, pack: 'reveal',
    // Eight horizontal slats; each slat's opening grows top-down, later slats a touch behind the first.
    expr: `st(0, H/8); st(1, floor(Y/ld(0))); st(2, clip(P*1.18-ld(1)*0.02, 0, 1));
      if(lt(fract(Y/ld(0)), ld(2)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_gridreveal', name: 'Grid Reveal', duration: 0.9, pack: 'reveal',
    // A 6x4 grid; every cell opens from its own centre at its own hashed moment, so the reveal ripples cell by cell.
    expr: `st(0, floor(X/(W/6))); st(1, floor(Y/(H/4)));
      st(2, (X-ld(0)*(W/6))/(W/6)); st(3, (Y-ld(1)*(H/4))/(H/4));
      st(4, clip(P*1.7-hash(ld(0)*7.13+ld(1)*3.71)*0.7, 0, 1));
      if(lt(max(abs(ld(2)-0.5), abs(ld(3)-0.5)), ld(4)*0.56), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_barndoors', name: 'Barn Doors', duration: 0.8, pack: 'reveal',
    // The two halves of A slide out to the sides like doors, uncovering B already in place behind them.
    expr: `st(0, W*0.5*(1-P)); st(1, W*0.5*P);
      if(lt(X, ld(0)), A(X+ld(1), Y), if(gt(X, W-ld(0)), A(X-ld(1), Y), B(X, Y)))`,
  },
  {
    id: 'fx_chevron', name: 'Chevron Wipe', duration: 0.7, pack: 'reveal',
    // An arrowhead boundary sweeps left to right, its tip at mid-height.
    expr: `st(0, W*(1.6*P-0.3)-abs(Y-H/2)/H*W*0.5);
      if(lt(X, ld(0)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_irisout', name: 'Circle Reveal Out', duration: 0.8, pack: 'reveal',
    // A true iris: B opens as a soft-edged circle from the centre over A.
    expr: `st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));
      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))`,
  },
  {
    id: 'fx_irisin', name: 'Circle Reveal In', duration: 0.8, pack: 'reveal',
    // The reverse iris: A shrinks away as a closing circle into the centre, B around it.
    expr: `st(0, hypot(X-W/2, Y-H/2)/(0.5*hypot(W, H)+1)); st(1, smooth((1-P)*1.05-0.04, (1-P)*1.05, ld(0)));
      A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_diamondreveal', name: 'Diamond Reveal', duration: 0.9, pack: 'reveal',
    // A diamond grows from the centre while rotating into its final orientation, B inside it.
    expr: `st(0, (X-W/2)/H); st(1, (Y-H/2)/H); st(2, (1-P)*0.6);
      st(3, ld(0)*cos(ld(2))+ld(1)*sin(ld(2))); st(4, -ld(0)*sin(ld(2))+ld(1)*cos(ld(2)));
      st(5, (abs(ld(3))+abs(ld(4)))*H/(0.78*hypot(W, H)));
      st(6, smooth(P*1.06-0.05, P*1.06-0.01, ld(5)));
      A(X, Y)*ld(6) + B(X, Y)*(1-ld(6))`,
  },
  {
    id: 'fx_rects', name: 'Rectangles', duration: 0.8, pack: 'reveal',
    // A 6x4 grid of rectangular blocks sweeps across (left first, top rows a touch ahead); as each
    // block flips to B its reveal edge flashes one of two colors — warm or cyan by block parity.
    expr: `st(0, W/6); st(1, H/4); st(2, floor(X/ld(0))); st(3, floor(Y/ld(1)));
      st(4, clip((P-(ld(2)+ld(3)*0.35)/6.05*0.8)/0.2, 0, 1));
      st(5, fract(X/ld(0))); st(6, fract((ld(2)+ld(3))/2)*2);
      if(lt(ld(5), ld(4)),
        if(lt(ld(4)-ld(5), 0.18),
          if(lt(ld(4), 1), B(X, Y)*0.15 + if(lt(ld(6), 0.5), C(255, 210, 90), C(90, 200, 255))*0.85, B(X, Y)),
          B(X, Y)),
        A(X, Y))`,
  },
  {
    id: 'fx_circlecorner', name: 'Circles From Corner', duration: 0.8, pack: 'reveal',
    // An iris anchored at the top-left corner instead of the centre: B opens as a soft-edged
    // circle from the corner across A.
    expr: `st(0, hypot(X, Y)/(hypot(W, H)+1)); st(1, smooth(P*1.05-0.04, P*1.05, ld(0)));
      A(X, Y)*ld(1) + B(X, Y)*(1-ld(1))`,
  },
  {
    id: 'fx_diagstripes', name: 'Diagonal Stripes', duration: 0.8, pack: 'reveal',
    // Seven diagonal bands sweep across in sequence; inside each band B wipes in along the diagonal.
    expr: `st(0, (X*0.7071+Y*0.7071)/(0.7071*(W+H))); st(1, floor(ld(0)*7)); st(2, fract(ld(0)*7));
      st(3, clip((P-ld(1)/7*0.65)/0.35, 0, 1));
      if(lt(ld(2), ld(3)), B(X, Y), A(X, Y))`,
  },
  // -- Light & Glow.
  {
    id: 'fx_glowdissolve', name: 'Glow Dissolve', duration: 1, pack: 'glowpack',
    // Both clips soften into a box blur and lift in brightness as they cross, with a warm glow at the peak.
    expr: `st(0, 4*P*(1-P)); st(1, 4*H/720);
      st(2, A(X, Y)*(1-ld(0)) + (${box9('A', 'ld(1)')}/9)*ld(0));
      st(3, B(X, Y)*(1-ld(0)) + (${box9('B', 'ld(1)')}/9)*ld(0));
      (ld(2)*(1-P) + ld(3)*P)*(1+0.3*ld(0)) + C(255, 244, 230)*ld(0)*0.15`,
  },
  {
    id: 'fx_flaresweep', name: 'Lens Flare Sweep', duration: 1.1, pack: 'glowpack',
    // A flare ball with an anamorphic streak and a ghost orb crosses the frame; the clips cross under its peak.
    expr: `st(0, 4*P*(1-P)); st(1, smooth(0.34, 0.66, P));
      st(2, A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1));
      st(3, W*(-0.25+1.5*P));
      st(4, exp(-pow((X-ld(3))/(W*0.16), 2))*exp(-pow((Y-H*0.42)/(H*0.3), 2)));
      st(5, exp(-pow((Y-H*0.42)/(H*0.035), 2)));
      st(6, exp(-pow((X-(W-ld(3)*0.55))/(W*0.05), 2))*exp(-pow((Y-H*0.58)/(H*0.09), 2)));
      st(7, min(1, (ld(4)*1.1+ld(5)*0.4+ld(6)*0.5)*ld(0)));
      ld(2)*(1-ld(7)) + C(255, 240, 214)*ld(7)`,
  },
  {
    id: 'fx_lightburn', name: 'Light Burn', duration: 0.9, pack: 'glowpack',
    // A overexposes hotter and hotter (a warm tint rides the exposure) until B fades in out of the blow-out.
    expr: `st(0, smooth(0, 0.5, P)); st(1, smooth(0.45, 0.7, P));
      st(2, A(X, Y)*(1+2.4*ld(0)) + C(255, 196, 130)*ld(0)*0.35);
      ld(2)*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_flashframe', name: 'Flash Frame', duration: 0.6, pack: 'glowpack',
    // Strobe flashes (white frames pulsing around the cut) hide a hard cut at the middle.
    expr: `st(0, 4*P*(1-P)); st(1, ld(0)*pow(0.5+0.5*sin(P*44), 3));
      st(2, if(lt(P, 0.5), A(X, Y), B(X, Y)));
      ld(2)*(1-ld(1)) + C(255, 250, 238)*ld(1)`,
  },
  {
    id: 'fx_prismleak', name: 'Prism Leak', duration: 1, pack: 'glowpack',
    // A diagonal light front crosses; at the front the channels split apart (red one way, blue the other,
    // per-channel offsets via C()) and a pink / blue wash leaks in, then everything settles onto B.
    expr: `st(0, 4*P*(1-P)); st(1, (X/W+Y/H)*0.7); st(2, -0.3+1.9*P);
      st(3, ld(0)*exp(-pow(ld(1)-ld(2), 2)/0.03));
      st(4, ld(3)*W*0.045);
      st(5, smooth(0.3, 0.7, P));
      st(6, A(X+ld(4)*C(1, 0, -1), Y+ld(4)*C(1, 0, -1)*0.6)*(1-ld(5)) + B(X+ld(4)*C(1, 0, -1), Y+ld(4)*C(1, 0, -1)*0.6)*ld(5));
      ld(6) + C(255, 130, 190)*ld(3)*0.12 + C(120, 200, 255)*ld(3)*0.08`,
  },
  // -- Distortion.
  {
    id: 'fx_ripplewave', name: 'Ripple Wave', duration: 0.9, pack: 'distortion',
    // Travelling waves on both axes bend both clips as they cross (the warp peaks mid-way, flat at the ends).
    expr: `st(0, (4*P*(1-P))*0.035*H);
      st(1, sin(Y/H*22-P*12.56)*ld(0)); st(2, cos(X/W*16-P*9.42)*ld(0)*0.7);
      st(3, smooth(0, 1, P));
      A(X+ld(1), Y+ld(2))*(1-ld(3)) + B(X+ld(1), Y+ld(2))*ld(3)`,
  },
  {
    id: 'fx_impactshake', name: 'Impact Shake', duration: 0.6, pack: 'distortion',
    // A hard cut at the middle lands with an impact: the frame punches in slightly and shakes, decay set by sin(PI*P).
    expr: `st(0, sin(PI*P));
      st(1, (hash(floor(P*26)+3.1)-0.5)*ld(0)*W*0.07);
      st(2, (hash(floor(P*26)+7.7)-0.5)*ld(0)*H*0.07);
      st(3, 1+0.1*ld(0));
      if(lt(P, 0.5), A(W/2+(X-W/2)/ld(3)+ld(1), H/2+(Y-H/2)/ld(3)+ld(2)), B(W/2+(X-W/2)/ld(3)+ld(1), H/2+(Y-H/2)/ld(3)+ld(2)))`,
  },
  {
    id: 'fx_rgbslidel', name: 'RGB Split Slide Left', duration: 0.6, pack: 'distortion',
    // A slide left where the channels travel on staggered clocks (per-channel progress via C()), so the
    // seam fringes red / green / blue before the channels land together on B.
    expr: `st(0, C(0, 0.05, 0.1)); st(1, clip((P-ld(0))/0.9, 0, 1)); st(2, X+W*ld(1));
      if(lt(ld(2), W), A(ld(2), Y), B(ld(2)-W, Y))`,
  },
  {
    id: 'fx_rgbslider', name: 'RGB Split Slide Right', duration: 0.6, pack: 'distortion',
    expr: `st(0, C(0, 0.05, 0.1)); st(1, clip((P-ld(0))/0.9, 0, 1)); st(2, X-W*ld(1));
      if(gte(ld(2), 0), A(ld(2), Y), B(ld(2)+W, Y))`,
  },
  {
    id: 'fx_pixelstretch', name: 'Pixel Stretch', duration: 0.7, pack: 'distortion',
    // Thin row bands drag sideways by hashed amounts (a pixel-stretch smear; a true pixel sort needs a
    // per-row accumulation a per-pixel expression cannot do, so this is the honest streak version).
    expr: `st(0, 4*P*(1-P)); st(1, floor(Y/(H*0.045)));
      st(2, ld(0)*(hash(ld(1)*3.77)-0.35)*W*0.22);
      st(3, smooth(0, 1, P));
      A(X-ld(2), Y)*(1-ld(3)) + B(X-ld(2), Y)*ld(3)`,
  },
  {
    id: 'fx_stretchwarp', name: 'Stretch Warp', duration: 0.7, pack: 'distortion',
    // The frame stretches wide (and squeezes a little vertically) at mid-transition while the clips cross.
    expr: `st(0, 4*P*(1-P)); st(1, 1+1.6*ld(0));
      st(2, W/2+(X-W/2)/ld(1)); st(3, H/2+(Y-H/2)*(1+0.25*ld(0)));
      st(4, smooth(0, 1, P));
      A(ld(2), ld(3))*(1-ld(4)) + B(ld(2), ld(3))*ld(4)`,
  },
  // -- Cinematic.
  {
    id: 'fx_filmroll', name: 'Film Roll', duration: 0.9, pack: 'cinematic',
    // The strip rolls up like film through a gate: a dark seam bar, a whisper of gate jitter and flicker.
    expr: `st(0, 4*P*(1-P)); st(1, H*(1-P));
      st(2, (hash(floor(P*22)+1.3)-0.5)*ld(0)*H*0.012);
      st(3, if(gte(Y+ld(2), ld(1)), B(X, Y+ld(2)-ld(1)), A(X, Y+ld(2))));
      st(4, ld(3)*(1-0.22*ld(0)*hash(floor(P*22)+4.9)));
      st(5, exp(-pow((Y-ld(1))/(H*0.018), 2))*ld(0));
      ld(4)*(1-ld(5)) + 10*ld(5)`,
  },
  {
    id: 'fx_projector', name: 'Projector Flicker Cut', duration: 0.8, pack: 'cinematic',
    // An old projector cut: brightness flicker, small frame jumps and a warm tint, all dying out after the cut.
    expr: `st(0, 4*P*(1-P));
      st(1, (hash(floor(P*30)+2.2)-0.5)*ld(0)*H*0.02);
      st(2, if(lt(P, 0.5), A(X, Y+ld(1)), B(X, Y+ld(1))));
      ld(2)*(1-0.3*ld(0)*(0.5+0.5*sin(P*46))) + C(255, 214, 150)*0.06*ld(0)`,
  },
  {
    id: 'fx_letterbox', name: 'Letterbox Close / Open', duration: 0.9, pack: 'cinematic',
    // Black bars close to a slit at the middle (where the cut hides) and open again on the next clip.
    expr: `st(0, sin(PI*P)*H*0.44);
      if(lt(Y, ld(0)), 0, if(gt(Y, H-ld(0)), 0, if(lt(P, 0.5), A(X, Y), B(X, Y))))`,
  },
  {
    id: 'fx_dipcolor', name: 'Dip to Color', duration: 0.8, pack: 'cinematic',
    // A dips into a deep violet and B rises out of it (a coloured dip, where fadeblack dips to black).
    expr: `st(0, smooth(0.02, 0.5, P)); st(1, smooth(0.5, 0.98, P));
      (A(X, Y)*(1-ld(0)) + C(56, 24, 120)*ld(0))*(1-ld(1)) + B(X, Y)*ld(1)`,
  },
  {
    id: 'fx_freezepush', name: 'Freeze Frame Push', duration: 0.9, pack: 'cinematic',
    // A becomes a bordered still card that shrinks and is pushed off to the left, uncovering B in place.
    expr: `st(0, smooth(0, 1, P)); st(1, 1-0.5*ld(0)); st(2, W/2-W*ld(0));
      st(3, H*0.012*ld(0));
      st(4, ${inRound('ld(2)', 'H/2', 'W/2*ld(1)', 'H/2*ld(1)', 'H*0.03*ld(0)+0.001')});
      st(5, ${inRound('ld(2)', 'H/2', 'W/2*ld(1)-ld(3)', 'H/2*ld(1)-ld(3)', 'H*0.02*ld(0)+0.001')});
      if(ld(5), A(W/2+(X-ld(2))/ld(1), H/2+(Y-H/2)/ld(1)), if(ld(4), 245, B(X, Y)))`,
  },
];

// Library mega-growth (10/10 step 3): 36 more shared-engine transitions, written to the same
// contract as the studio set — each starts exactly on the outgoing clip and ends exactly on the
// incoming one (mask sweeps use a normalized metric whose maximum the sweep range covers, so
// no corner is left behind at P = 1 and nothing shows early at P = 0).
const wipeK = (d) => `st(0, ${d}); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)`;
const GROWTH_TRANSITIONS = [
  { id: 'fx_wipewest', name: 'Wipe From Left', duration: 0.6, expr: wipeK('X/W') },
  { id: 'fx_wipeeast', name: 'Wipe From Right', duration: 0.6, expr: wipeK('1 - X/W') },
  { id: 'fx_wipecenter', name: 'Wipe From Center', duration: 0.7, expr: wipeK('abs(X/W - 0.5)*2') },
  { id: 'fx_wipecorners', name: 'Wipe From Corners', duration: 0.8, expr: wipeK('1 - max(abs(X/W - 0.5), abs(Y/H - 0.5))*2') },
  { id: 'fx_venetianv', name: 'Venetian Columns', duration: 0.9, expr: wipeK('abs(fract(X/(W/14)) - 0.5)*2') },
  { id: 'fx_venetianh', name: 'Venetian Rows', duration: 0.9, expr: wipeK('abs(fract(Y/(H/10)) - 0.5)*2') },
  {
    id: 'fx_blindslide', name: 'Blinds Slide', duration: 0.9,
    expr: `st(0, mod(floor(X/(W/9)), 2)); st(1, (1 - P)*H);
      if(ld(0), if(lt(Y, H - ld(1)), B(X, Y + ld(1)), A(X, Y)), if(gt(Y, ld(1)), B(X, Y - ld(1)), A(X, Y)))`,
  },
  { id: 'fx_checker', name: 'Checkerboard', duration: 1, expr: wipeK('hash(floor(X/(W/8))*3.17 + floor(Y/(H/6))*7.71)') },
  {
    id: 'fx_stripsdown', name: 'Strips Down', duration: 0.9,
    expr: `st(0, floor(X/(W/10))); st(1, (1 - P)*H*(1 + 0.4*hash(ld(0)*3.31)));
      if(lt(Y, H - ld(1)), B(X, Y + ld(1)), A(X, Y))`,
  },
  {
    id: 'fx_stripsup', name: 'Strips Up', duration: 0.9,
    expr: `st(0, floor(X/(W/10))); st(1, (1 - P)*H*(1 + 0.4*hash(ld(0)*3.31)));
      if(gt(Y, ld(1)), B(X, Y - ld(1)), A(X, Y))`,
  },
  {
    id: 'fx_orbitwipe', name: 'Orbit Wipe', duration: 1.1,
    expr: `st(0, W/2 + cos(P*6.2832)*W*0.18); st(1, H/2 + sin(P*6.2832)*H*0.18);
      st(2, hypot(X - ld(0), Y - ld(1))/hypot(W, H)); st(3, smooth(P*0.74 - 0.03, P*0.74 - 0.01, ld(2)));
      B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)`,
  },
  {
    id: 'fx_squircle', name: 'Squircle Wipe', duration: 0.9,
    expr: `st(0, abs((X - W/2)/(W/2))); st(1, abs((Y - H/2)/(H/2)));
      st(2, min(sqrt(sqrt(ld(0)*ld(0)*ld(0)*ld(0) + ld(1)*ld(1)*ld(1)*ld(1))), 1));
      st(3, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(2))); B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)`,
  },
  {
    id: 'fx_starwipe', name: 'Star Wipe', duration: 1,
    expr: `st(0, atan2(Y - H/2, X - W/2)); st(1, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H))*(0.8 + 0.2*cos(ld(0)*5)));
      st(2, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(1))); B(X, Y)*(1 - ld(2)) + A(X, Y)*ld(2)`,
  },
  {
    id: 'fx_heartwipe', name: 'Heart Wipe', duration: 1,
    expr: `st(0, (X/W - 0.5)*2.3); st(1, (0.54 - Y/H)*2.3);
      st(2, pow(ld(0)*ld(0) + ld(1)*ld(1) - 1, 3) - ld(0)*ld(0)*ld(1)*ld(1)*ld(1));
      st(3, smooth(-1.25 + P*5.3, -1.0 + P*5.3, ld(2))); B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)`,
  },
  { id: 'fx_diamondout', name: 'Diamond Out', duration: 0.8, expr: wipeK('1 - (abs(X/W - 0.5) + abs(Y/H - 0.5))') },
  { id: 'fx_crosswipe', name: 'Cross Wipe', duration: 0.9, expr: wipeK('min(abs(X - W/2)/(W/2), abs(Y - H/2)/(H/2))') },
  {
    id: 'fx_slidediag', name: 'Slide Diagonal', duration: 0.7,
    expr: `st(0, 1 - P); st(1, X/W*0.5 + Y/H*0.5);
      if(gt(ld(1), ld(0)), B(clip(X - ld(0)*W, 0, W - 1), clip(Y - ld(0)*H, 0, H - 1)), A(X, Y))`,
  },
  {
    id: 'fx_pushdiag', name: 'Push Diagonal', duration: 0.7,
    expr: `st(0, 1 - P); st(1, X/W*0.5 + Y/H*0.5); st(2, X + P*W*0.5); st(3, Y + P*H*0.5);
      if(gt(ld(1), ld(0)), B(clip(X - ld(0)*W, 0, W - 1), clip(Y - ld(0)*H, 0, H - 1)),
        if(${inFrame('ld(2)', 'ld(3)')}, A(ld(2), ld(3)), B(X, Y)))`,
  },
  {
    id: 'fx_zoompunch', name: 'Zoom Punch', duration: 0.6,
    expr: `st(0, smooth(0.15, 0.85, P)); st(1, 0.55 + 0.45*ld(0));
      A(X, Y)*(1 - ld(0)) + B(W/2 + (X - W/2)/ld(1), H/2 + (Y - H/2)/ld(1))*ld(0)`,
  },
  {
    id: 'fx_spinwise', name: 'Spin In', duration: 0.9,
    expr: `A(X, Y)*(1 - P) + (${spinBlur('B', '(1 - P)*0.85', '(1 - P)*0.05')})*P`,
  },
  {
    id: 'fx_spinback', name: 'Spin Out', duration: 0.9,
    expr: `(${spinBlur('A', 'P*0.85', 'P*0.05')})*(1 - P) + B(X, Y)*P`,
  },
  {
    id: 'fx_fliplr', name: 'Flip Horizontal', duration: 0.8,
    expr: `st(0, P*2); st(1, (P - 0.5)*2);
      if(lt(P, 0.5),
        if(lt(abs(X - W/2), (1 - ld(0))*W/2), A(W/2 + (X - W/2)/max(1 - ld(0), 0.02), Y), C(12, 12, 16)),
        if(lt(abs(X - W/2), max(ld(1), 0)*W/2), B(W/2 + (X - W/2)/max(ld(1), 0.02), Y), C(12, 12, 16)))`,
  },
  {
    id: 'fx_flipud', name: 'Flip Vertical', duration: 0.8,
    expr: `st(0, P*2); st(1, (P - 0.5)*2);
      if(lt(P, 0.5),
        if(lt(abs(Y - H/2), (1 - ld(0))*H/2), A(X, H/2 + (Y - H/2)/max(1 - ld(0), 0.02)), C(12, 12, 16)),
        if(lt(abs(Y - H/2), max(ld(1), 0)*H/2), B(X, H/2 + (Y - H/2)/max(ld(1), 0.02)), C(12, 12, 16)))`,
  },
  {
    id: 'fx_rollleft', name: 'Roll Left', duration: 0.7,
    expr: `st(0, X + P*W); if(lt(ld(0), W), A(ld(0), Y), B(ld(0) - W, Y))`,
  },
  {
    id: 'fx_rollup', name: 'Roll Up', duration: 0.7,
    expr: `st(0, Y + P*H); if(lt(ld(0), H), A(X, ld(0)), B(X, ld(0) - H))`,
  },
  {
    id: 'fx_blurvert', name: 'Blur Vertical', duration: 0.8,
    expr: `(${vblurAt('A', '0', '(4*P*(1 - P))*16*H/720')})*(1 - P) + (${vblurAt('B', '0', '(4*P*(1 - P))*16*H/720')})*P`,
  },
  {
    id: 'fx_blurzoom', name: 'Blur Zoom', duration: 0.9,
    expr: `(${zoomBlur('A', '1 + 0.22*(4*P*(1 - P))', '0.3*(4*P*(1 - P))')})*(1 - P) + (${zoomBlur('B', '1 + 0.22*(4*P*(1 - P))', '0.3*(4*P*(1 - P))')})*P`,
  },
  {
    id: 'fx_pixeldissolve', name: 'Pixel Dissolve', duration: 1,
    expr: `st(0, max(1, H*0.035*(4*P*(1 - P)) + 1)); st(1, floor(X/ld(0))); st(2, floor(Y/ld(0)));
      st(3, ld(1)*ld(0) + ld(0)/2); st(4, ld(2)*ld(0) + ld(0)/2);
      if(lt(hash(ld(1)*12.9898 + ld(2)*78.233), P), B(ld(3), ld(4)), A(ld(3), ld(4)))`,
  },
  {
    id: 'fx_melt', name: 'Melt Down', duration: 1,
    expr: `st(0, P*1.28 - 0.18 + 0.05*sin(X/(H*0.09) + P*7)); st(1, smooth(-0.04, 0.04, Y/H - ld(0)));
      B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)`,
  },
  { id: 'fx_vortex', name: 'Vortex Wipe', duration: 1.1, expr: wipeK('fract((atan2(Y - H/2, X - W/2) + PI)/6.28319 + hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H))*1.2)') },
  {
    id: 'fx_prismwipe', name: 'Prism Wipe', duration: 0.8,
    expr: `st(0, X/W); st(1, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(0))); st(2, clip(1 - abs(ld(0) - P)*16, 0, 1));
      A(X, Y)*ld(1) + B(X + C(W*0.012, 0, -W*0.012)*ld(2), Y)*(1 - ld(1))`,
  },
  {
    id: 'fx_hexwipe', name: 'Hexagon Wipe', duration: 0.9,
    expr: `st(0, abs((X - W/2)/(W/2))); st(1, abs((Y - H/2)/(H/2)));
      st(2, min(max(ld(0)*0.9 + ld(1)*0.44, ld(1)), 1));
      st(3, smooth(P*1.06 - 0.05, P*1.06 - 0.01, ld(2))); B(X, Y)*(1 - ld(3)) + A(X, Y)*ld(3)`,
  },
  {
    id: 'fx_waveslide', name: 'Wave Slide', duration: 0.9,
    expr: `st(0, W*(1.02 - 1.04*P) + sin(Y/(H*0.14) - P*5)*W*0.045*(4*P*(1 - P)));
      st(1, smooth(-W*0.012, W*0.012, ld(0) - X)); B(X, Y)*(1 - ld(1)) + A(X, Y)*ld(1)`,
  },
  {
    id: 'fx_curtainfall', name: 'Curtain Fall', duration: 0.8,
    expr: `st(0, P*H/2);
      if(lt(abs(Y - H/2), ld(0)), B(X, Y), if(lt(Y, H/2), A(X, Y + ld(0)), A(X, Y - ld(0))))`,
  },
  {
    id: 'fx_gridspin', name: 'Grid Spin', duration: 1.1,
    expr: `st(0, floor(X/(W/6))); st(1, floor(Y/(H/4))); st(2, (ld(0) + 0.5)*(W/6)); st(3, (ld(1) + 0.5)*(H/4));
      st(4, clip(P*1.5 - hash(ld(0)*12.9898 + ld(1)*78.233)*0.5, 0, 1)); st(5, (1 - ld(4))*1.35);
      st(6, ld(2) + (X - ld(2))*cos(ld(5)) + (Y - ld(3))*sin(ld(5)));
      st(7, ld(3) - (X - ld(2))*sin(ld(5)) + (Y - ld(3))*cos(ld(5)));
      A(X, Y)*(1 - ld(4)) + if(${inFrame('ld(6)', 'ld(7)')}, B(ld(6), ld(7)), B(X, Y))*ld(4)`,
  },
  {
    id: 'fx_stepfade', name: 'Step Fade', duration: 0.8,
    expr: `st(0, (floor(P*5) + smooth(0.55, 1, fract(P*5)))/5); A(X, Y)*(1 - ld(0)) + B(X, Y)*ld(0)`,
  },
];

export const FX_TRANSITIONS = [
  // The four classic transitions whose FFmpeg xfade forms measurably diverge from the
  // preview's shapes (Sprint 6 investigation, measurements pinned in
  // scripts/test-transition-parity.cjs): xfade's dissolve is a per-pixel dither, its
  // fadeblack/fadewhite dip on a curve that is NOT the preview's two linear halves,
  // and its circleopen is a soft radial blend, not the preview's hard circle. They live
  // here so ONE expression defines them in the preview and the export. The expressions
  // reproduce the preview's documented shapes:
  //   dissolve   - a real dither dissolve: a pixel shows B once the progress passes its
  //                hash threshold — the dither xfade performs, thresholded by the
  //                shared hash() so preview and export scatter identically. (The old
  //                CSS preview drew dissolve as a plain blend, indistinguishable from
  //                Crossfade on screen; the unified form is the true dissolve.)
  //   fadeblack  - two linear halves through black: A * (1 - 2P), then B * (2P - 1).
  //   fadewhite  - the same dip through white (255).
  //   circleopen - B inside a hard circle of radius P * 75% of the CSS reference length
  //                (the frame diagonal / sqrt(2) = 0.53033 of the full diagonal), A outside.
  { id: 'dissolve', name: 'Dissolve', duration: 0.5, expr: 'if(lt(hash(X*12.9898 + Y*78.233), P), B(X, Y), A(X, Y))' },
  { id: 'fadeblack', name: 'Fade to Black', duration: 0.5, expr: 'if(lt(P, 0.5), A(X, Y)*(1 - 2*P), B(X, Y)*(2*P - 1))' },
  { id: 'fadewhite', name: 'Fade to White', duration: 0.5, expr: 'if(lt(P, 0.5), A(X, Y)*(1 - 2*P) + 510*P, B(X, Y)*(2*P - 1) + 510*(1 - P))' },
  { id: 'circleopen', name: 'Circle', duration: 0.5, expr: 'if(lt(hypot(X - W/2, Y - H/2)/hypot(W, H), P*0.53033), B(X, Y), A(X, Y))' },
  {
    id: 'fx_mosaic', name: 'Mosaic Wipe', duration: 1,
    // Blocks grow towards the middle of the transition while a ragged edge sweeps left to right.
    expr: `st(0, max(1, floor(H*0.07*sin(PI*P))));
      st(1, floor(X/ld(0))*ld(0)+ld(0)/2);
      st(2, floor(Y/ld(0))*ld(0)+ld(0)/2);
      st(3, W*(-0.25+1.5*P)+(hash(floor(Y/ld(0))+0.5)-0.5)*W*0.35);
      if(lt(ld(1), ld(3)), B(ld(1), ld(2)), A(ld(1), ld(2)))`,
  },
  {
    id: 'fx_snapback', name: 'Snap Back', duration: 0.8,
    // The outgoing clip punches in, the incoming one snaps back from the same zoom.
    expr: `st(0, smooth(0, 0.55, P)); st(1, 1-smooth(0.45, 1, P));
      st(2, 1+1.6*ld(0)*ld(0)); st(3, 1+1.6*ld(1)*ld(1));
      st(4, smooth(0.44, 0.56, P));
      A(W/2+(X-W/2)/ld(2), H/2+(Y-H/2)/ld(2))*(1-ld(4)) + B(W/2+(X-W/2)/ld(3), H/2+(Y-H/2)/ld(3))*ld(4)`,
  },
  {
    id: 'fx_flare', name: 'Flare Wipe', duration: 1.2,
    // A warm lens flare sweeps across and washes the picture out while the clips cross.
    expr: `st(0, smooth(0, 0.5, P)*(1-smooth(0.5, 1, P)));
      st(1, smooth(0.38, 0.62, P));
      st(2, A(X, Y)*(1-ld(1)) + B(X, Y)*ld(1));
      st(3, hypot((X-W*(-0.3+1.6*P))/W, (Y-H*0.38)/H*0.7));
      st(4, min(1, ld(0)*(1.3*exp(-ld(3)*ld(3)*9)+0.45)));
      ld(2) + (C(255, 236, 205)-ld(2))*ld(4)`,
  },
  {
    id: 'fx_comic', name: 'Comic Cut', duration: 0.8,
    // A torn diagonal cut with halftone dots along the tear reveals the next clip.
    expr: `st(0, W*(1.5*P-0.25) + (Y-H/2)*0.35 + (abs(fract(Y/(H*0.07))-0.5)-0.25)*W*0.06);
      st(1, W*0.05*sin(PI*P));
      st(2, X-ld(0));
      st(3, lt(hypot(fract(X/(W*0.014))-0.5, fract(Y/(W*0.014))-0.5), 0.32));
      if(lt(ld(2), -ld(1)), B(X, Y), if(gt(ld(2), ld(1)), A(X, Y), if(ld(3), 25, 245)))`,
  },
  {
    id: 'fx_brush', name: 'Brush Cuts', duration: 1.2,
    // Diagonal brush strokes paint the next clip in, one after another, with ragged ends.
    expr: `st(0, (X*0.8+Y*0.6)/W);
      st(1, floor(((Y*0.8-X*0.6)/H+1.2)*3.2));
      st(2, P*2.1-hash(ld(1)*1.7)*0.8-0.1);
      st(3, (hash(floor(ld(0)*55)+ld(1)*13.1)-0.5)*0.06 + (hash(floor((Y*0.8-X*0.6)/H*90))-0.5)*0.05);
      if(lt(ld(0)+ld(3), ld(2)), B(X, Y), A(X, Y))`,
  },
  {
    id: 'fx_phone', name: 'Phone Reveal', duration: 1.6,
    // A phone rises with the next clip on its screen, then zooms until the screen fills the frame.
    expr: `st(0, smooth(0, 0.5, P)); st(1, smooth(0.55, 1, P));
      st(2, H*0.42+(H*0.08+1)*ld(1)); st(3, H*0.2016+(W*0.5+1-H*0.2016)*ld(1));
      st(4, H*1.6-H*1.1*ld(0)); st(5, H*0.03*(1-ld(1)));
      st(6, ${inRound('W/2', 'ld(4)', 'ld(3)', 'ld(2)', 'H*0.06*(1-ld(1))+0.001')});
      st(7, ${inRound('W/2', 'ld(4)', 'ld(3)-ld(5)', 'ld(2)-ld(5)', 'H*0.05*(1-ld(1))+0.001')});
      st(8, max(2*(ld(3)-ld(5)-ld(1))/W, 2*(ld(2)-ld(5)-ld(1))/H));
      if(ld(7), B(W/2+(X-W/2)/ld(8), H/2+(Y-ld(4))/ld(8)), if(ld(6), C(18, 18, 22), A(X, Y)))`,
  },
  {
    id: 'fx_swipe', name: 'Finger Swipe', duration: 1.6,
    // The clip shrinks into a card, a finger swipes it away and the next card slides in and opens up.
    expr: `st(0, 1-0.38*smooth(0, 0.3, P)); st(1, -W*1.05*smooth(0.32, 0.68, P));
      st(2, 0.62+0.38*smooth(0.72, 1, P)); st(3, W*1.05*(1-smooth(0.32, 0.68, P)));
      st(4, ${inRound('W/2+ld(3)', 'H/2', 'W/2*ld(2)+1', 'H/2*ld(2)+1', 'H*0.07*(1-smooth(0.72, 1, P))+0.001')});
      st(5, ${inRound('W/2+ld(1)', 'H/2', 'W/2*ld(0)+1', 'H/2*ld(0)+1', 'H*0.07*smooth(0, 0.3, P)+0.001')});
      st(6, lt(hypot(X-(W/2+ld(3)+W*0.2*ld(2)), Y-H*0.7), H*0.055)*between(P, 0.28, 0.74));
      if(ld(6), C(238, 192, 160), if(ld(4), B(W/2+(X-W/2-ld(3))/ld(2), H/2+(Y-H/2)/ld(2)), if(ld(5), A(W/2+(X-W/2-ld(1))/ld(0), H/2+(Y-H/2)/ld(0)), 236)))`,
  },
  // The five transition packs (Seamless / Mask & Reveal / Light & Glow / Distortion / Cinematic).
  ...PACK_TRANSITIONS,
  // From Transition Studio (above).
  ...STUDIO_TRANSITIONS,
  // Library mega-growth (10/10 step 3).
  ...GROWTH_TRANSITIONS,
];

// Effects that change the picture itself (geq in the export, canvas pixels in the preview).

// ---- Per-effect parameters (parity-matrix §5) ----
// A parameterised entry carries `params` — a typed schema [{ key, name, min, max,
// def, step, fmt? }] — and `make(values)`, which builds its expression from values.
// `expr` is always make(defaults): byte-identical to the hand-written expression it
// replaced, so any project saved before parameters existed renders exactly as
// before (a missing stored value IS the default, everywhere — see fx/params.js).
// fmt is a display hint for the inspector ('pct' renders the value as a percentage).
export const pf = (n) => { const v = Math.round(n * 100000) / 100000; return Object.is(v, -0) ? '0' : String(v); };
const withParams = (entry, params, make) => ({ ...entry, params, make, expr: make(Object.fromEntries(params.map((p) => [p.key, p.def]))) });

export const PIXEL_EFFECTS = [
  // Colour bleed, scan lines and grain all the time; every couple of seconds a tracking burst bends the lines.
  withParams({ id: 'fx_vhs', name: 'VHS Noise', icon: '📼' },
    [{ key: 'grain', name: 'Grain', min: 0, max: 60, def: 30, step: 1 }],
    (v) => `st(0, lt(fract(T/2.3), 0.12) + gt(hash(floor(T*5)+0.3), 0.93));
      st(1, (sin(Y/H*34+T*42)*0.014 + (hash(floor(Y/(H*0.025))+floor(T*30)*0.37)-0.5)*0.05)*W*min(ld(0), 1) + sin(Y/H*7+T*3)*W*0.0016);
      st(2, W*(0.0035+0.006*min(ld(0), 1)));
      st(3, S(X+ld(1)+C(ld(2), 0, -ld(2)), Y));
      (ld(3)*(1-0.22*min(ld(0), 1)) + 40*min(ld(0), 1) + C(-6, 0, 12) + (hash(X*0.37+Y*1.31+floor(T*30)*7.1)-0.5)*${pf(v.grain)})
        * (1-0.12*fract(floor(Y/max(1, H/240))/2)*2)`),
  {
    id: 'fx_striped', name: 'Striped Erosion', icon: '▤',
    // Glitch bursts: horizontal bands tear sideways, with magenta streaks and colour fringes.
    expr: `st(0, gt(hash(floor(T*6)+0.7), 0.55));
      st(1, hash(floor(Y/(H/22))*3.1+floor(T*12)*0.77));
      st(2, if(gt(ld(1), 0.7), (ld(1)-0.85)*W*0.7, 0)*ld(0));
      if(ld(0)*gt(ld(1), 0.955), C(205, 70, 255), S(X+ld(2)+C(W*0.006, 0, -W*0.006)*ld(0), Y))`,
  },
  {
    id: 'fx_bwgrit', name: 'BW Grit', icon: '🎞',
    // Hard black-and-white film: contrast, grain, flicker, frame jitter, scratches and dust.
    expr: `st(0, (hash(floor(T*12)+0.2)-0.5)*W*0.005);
      st(1, (L(X+ld(0), Y)-128)*1.4+128);
      st(1, ld(1)*(0.9+0.1*hash(floor(T*24)+3.3)) + (hash(X*0.71+Y*1.93+floor(T*24)*3.3)-0.5)*44);
      st(2, lt(abs(X-W*hash(floor(T*8)+11.1)), W*0.0016)*gt(hash(floor(T*8)+5.5), 0.35));
      st(3, gt(hash(floor(X/(W*0.005))*7.7+floor(Y/(W*0.005))*3.1+floor(T*12)*1.3), 0.9986));
      if(ld(2), 232, if(ld(3), 18, ld(1)))`,
  },
  // The clip starts zoomed in and rushes back with a radial blur (first 0.7 s).
  withParams({ id: 'fx_zoomblast', name: 'Zoom Blast', icon: '💥' },
    [{ key: 'amount', name: 'Blast', min: 0, max: 4, def: 2.2, step: 0.05 }],
    (v) => `if(gt(T, 0.7), S(X, Y),
      st(0, 1+${pf(v.amount)}*(1-smooth(0, 0.7, T))^2);
      (S(W/2+(X-W/2)/ld(0), H/2+(Y-H/2)/ld(0)) + S(W/2+(X-W/2)/(ld(0)*1.05), H/2+(Y-H/2)/(ld(0)*1.05))
        + S(W/2+(X-W/2)/(ld(0)*1.1), H/2+(Y-H/2)/(ld(0)*1.1)) + S(W/2+(X-W/2)/(ld(0)*1.15), H/2+(Y-H/2)/(ld(0)*1.15)))/4)`),
  // ---- The expanded library: parameterized families built from the same primitives. Every
  // variant carries its own constants/structure (the sampling suite proves pairwise-distinct
  // frames across the whole library — no tile is a rename of another tile's render).
  ...pixelLibrary(),
  ...pixelGrowth(),
];

// Builders for the expanded pixel library (defined below the classic four for readability).
function crossBlur(r) {
  return `st(0, H*${r}); (S(X, Y) + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0)))/5`;
}
function blurN(r) {
  return `st(0, H*${r}); (S(X, Y)*2 + S(X+ld(0), Y) + S(X-ld(0), Y) + S(X, Y+ld(0)) + S(X, Y-ld(0))
    + S(X+ld(0), Y+ld(0)) + S(X-ld(0), Y-ld(0)) + S(X+ld(0), Y-ld(0)) + S(X-ld(0), Y+ld(0)))/10`;
}
function leak(fx, fy, cr, cg, cb, inten, ph) {
  return `st(0, clip(1 - hypot(X - W*${fx}, Y - H*${fy})/(H*1.05), 0, 1));
    S(X, Y) + C(${cr}, ${cg}, ${cb}) * ld(0) * ld(0) * ${inten} * (0.8 + 0.2*sin(T*0.6 + ${ph}))`;
}
function kaleido(n) {
  return `st(0, atan2(Y - H/2, X - W/2)); st(1, hypot(X - W/2, Y - H/2)); st(2, 6.28319/${n});
    st(3, ld(2)/2 - abs(mod(ld(0) + 6.28319, ld(2)) - ld(2)/2));
    S(W/2 + ld(1)*cos(ld(3)), H/2 + ld(1)*sin(ld(3)))`;
}
function radialTaps(scales) {
  const taps = scales.map((s) => `S(W/2+(X-W/2)*${s}, H/2+(Y-H/2)*${s})`).join(' + ');
  return `(${taps})/${scales.length}`;
}
function twirl(amt, rad) {
  return `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, ${amt}*max(0, 1 - ld(0)/${rad}));
    st(2, cos(ld(1))); st(3, sin(ld(1)));
    S(W/2 + (X - W/2)*ld(2) - (Y - H/2)*ld(3), H/2 + (X - W/2)*ld(3) + (Y - H/2)*ld(2))`;
}
function pixelLibrary() {
  return [
  // -- Glitch & Digital --
  withParams({ id: 'fx_rgb2', name: 'RGB Split Light', icon: '🔀' }, [{ key: 'shift', name: 'Shift', min: 0, max: 0.03, def: 0.003, step: 0.0005, fmt: 'pct' }], (v) => `S(X + C(W*${pf(v.shift)}, 0, -W*${pf(v.shift)}), Y)`),
  withParams({ id: 'fx_rgb6', name: 'RGB Split Heavy', icon: '🔀' }, [{ key: 'shift', name: 'Shift', min: 0, max: 0.03, def: 0.009, step: 0.0005, fmt: 'pct' }], (v) => `S(X + C(W*${pf(v.shift)}, 0, -W*${pf(v.shift)}) + (hash(floor(T*24)+0.5)-0.5)*W*0.002, Y)`),
  withParams({ id: 'fx_rgb8', name: 'RGB Split Extreme', icon: '🔀' }, [{ key: 'shift', name: 'Shift', min: 0, max: 0.04, def: 0.02, step: 0.0005, fmt: 'pct' }], (v) => `S(X + C(W*${pf(v.shift)}, 0, -W*${pf(v.shift)}) + (hash(floor(Y/(H/9))*1.7+floor(T*18)*0.53)-0.5)*W*0.004, Y)`),
  withParams({ id: 'fx_rgbv', name: 'RGB Split Vertical', icon: '🔀' }, [{ key: 'shift', name: 'Shift', min: 0, max: 0.03, def: 0.006, step: 0.0005, fmt: 'pct' }], (v) => `S(X, Y + C(H*${pf(v.shift)}, 0, -H*${pf(v.shift)}))`),
  { id: 'fx_slices', name: 'Slice Shift', icon: '🍰', expr: `st(0, hash(floor(Y/(H/14))*3.3+floor(T*8)*0.91)); S(X + if(gt(ld(0), 0.55), (ld(0)-0.55)*W*0.5, 0), Y)` },
  { id: 'fx_slicesbig', name: 'Slice Shift Wide', icon: '🍰', expr: `st(0, hash(floor(Y/(H/6))*5.1+floor(T*5)*0.77)); S(X + if(gt(ld(0), 0.45), (ld(0)-0.5)*W*0.9, 0), Y)` },
  { id: 'fx_mosh', name: 'Datamosh Smear', icon: '🫠', expr: `st(0, hash(floor(X/(W/9))*7.7+floor(T*2)*0.31)); S(X + if(gt(ld(0), 0.62), (ld(0)-0.62)*W*0.55, 0), Y)` },
  withParams({ id: 'fx_mosaic60', name: 'Mosaic Fine', icon: '🧩' }, [{ key: 'cells', name: 'Cells across', min: 8, max: 240, def: 90, step: 1 }], (v) => `st(0, max(2, W/${Math.round(v.cells)})); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`),
  withParams({ id: 'fx_mosaic24', name: 'Mosaic Medium', icon: '🧩' }, [{ key: 'cells', name: 'Cells across', min: 8, max: 240, def: 36, step: 1 }], (v) => `st(0, max(2, W/${Math.round(v.cells)})); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`),
  withParams({ id: 'fx_mosaic10', name: 'Mosaic Chunky', icon: '🧩' }, [{ key: 'cells', name: 'Cells across', min: 8, max: 240, def: 14, step: 1 }], (v) => `st(0, max(2, W/${Math.round(v.cells)})); S(floor(X/ld(0))*ld(0)+ld(0)/2, floor(Y/ld(0))*ld(0)+ld(0)/2)`),
  withParams({ id: 'fx_poster4', name: 'Posterize 4', icon: '🎛' }, [{ key: 'levels', name: 'Levels', min: 2, max: 16, def: 4, step: 1 }], (v) => { const q = Math.max(2, Math.round(256 / v.levels)); return `floor(S(X, Y)/${q})*${q} + ${Math.floor(q / 2)}`; }),
  withParams({ id: 'fx_poster6', name: 'Posterize 6', icon: '🎛' }, [{ key: 'levels', name: 'Levels', min: 2, max: 16, def: 6, step: 1 }], (v) => { const q = Math.max(2, Math.round(256 / v.levels)); return `floor(S(X, Y)/${q})*${q} + ${Math.floor(q / 2)}`; }),
  withParams({ id: 'fx_solar', name: 'Solarize', icon: '☀' }, [{ key: 'threshold', name: 'Threshold', min: 0, max: 255, def: 130, step: 1 }], (v) => `if(gt(S(X, Y), ${pf(v.threshold)}), 255 - S(X, Y), S(X, Y))`),
  { id: 'fx_invert', name: 'Negative', icon: '◐', expr: `255 - S(X, Y)` },
  withParams({ id: 'fx_bitcut', name: 'Bit Crush', icon: '👾' }, [{ key: 'steps', name: 'Steps', min: 2, max: 32, def: 8, step: 1 }], (v) => { const q = Math.max(2, Math.round(256 / v.steps)); return `floor(S(X, Y)/${q})*${q}*(0.82 + 0.18*fract(Y/2))`; }),
  withParams({ id: 'fx_scanline', name: 'Scanlines', icon: '📺' }, [{ key: 'amount', name: 'Darkening', min: 0, max: 0.9, def: 0.38, step: 0.01, fmt: 'pct' }], (v) => `S(X, Y) * (1 - ${pf(v.amount)}*fract(floor(Y/max(1, H/220))/2)*2)`),
  { id: 'fx_crt', name: 'CRT Grille', icon: '📺', expr: `S(X, Y) * if(lt(fract(X/3), 0.34), C(1.15, 0.62, 0.62), if(lt(fract(X/3), 0.67), C(0.62, 1.15, 0.62), C(0.62, 0.62, 1.15)))` },
  { id: 'fx_vhstrack', name: 'VHS Tracking Band', icon: '📼', expr: `st(0, fract(T*0.14)*1.15 - 0.06); st(1, clip(1 - abs(Y/H - ld(0))/0.09, 0, 1)); S(X + ld(1)*W*0.02*sin(Y*0.4 + T*30), Y) * (1 + ld(1)*0.35) + ld(1)*22` },
  // Ordered-dither print: each channel is thresholded against a fixed 4x4 pattern (Sprint 12, original).
  { id: 'fx_dither', name: 'Dither Print', icon: '🎲', expr: `st(0, mod(mod(floor(X/3), 4)*5 + mod(floor(Y/3), 4)*11, 16)/16); if(gt(S(X, Y)/255, ld(0)), 255, 0)` },
  // -- Blur & Focus --
  withParams({ id: 'fx_soft1', name: 'Soft Blur', icon: '🌫' }, [{ key: 'radius', name: 'Radius', min: 0.001, max: 0.02, def: 0.004, step: 0.0005, fmt: 'pct' }], (v) => crossBlur(Number(pf(v.radius)))),
  withParams({ id: 'fx_soft2', name: 'Dream Blur', icon: '🌫' }, [{ key: 'radius', name: 'Radius', min: 0.001, max: 0.03, def: 0.01, step: 0.0005, fmt: 'pct' }], (v) => `${blurN(Number(pf(v.radius)))} * 1.02 + 4`),
  withParams({ id: 'fx_soft3', name: 'Gauze Blur', icon: '🌫' }, [{ key: 'radius', name: 'Radius', min: 0.001, max: 0.04, def: 0.02, step: 0.0005, fmt: 'pct' }], (v) => `${blurN(Number(pf(v.radius)))} * 1.03 + 7`),
  withParams({ id: 'fx_mblurh', name: 'Motion Blur H', icon: '💨' }, [{ key: 'radius', name: 'Length', min: 0.001, max: 0.03, def: 0.009, step: 0.0005, fmt: 'pct' }], (v) => `st(0, H*${pf(v.radius)}); (S(X - ld(0)*2, Y) + S(X - ld(0), Y) + S(X, Y) + S(X + ld(0), Y) + S(X + ld(0)*2, Y))/5`),
  withParams({ id: 'fx_mblurv', name: 'Motion Blur V', icon: '💨' }, [{ key: 'radius', name: 'Length', min: 0.001, max: 0.03, def: 0.009, step: 0.0005, fmt: 'pct' }], (v) => `st(0, H*${pf(v.radius)}); (S(X, Y - ld(0)*2) + S(X, Y - ld(0)) + S(X, Y) + S(X, Y + ld(0)) + S(X, Y + ld(0)*2))/5`),
  withParams({ id: 'fx_mblurd', name: 'Motion Blur Diagonal', icon: '💨' }, [{ key: 'radius', name: 'Length', min: 0.001, max: 0.03, def: 0.008, step: 0.0005, fmt: 'pct' }], (v) => `st(0, H*${pf(v.radius)}); (S(X - ld(0), Y - ld(0)) + S(X - ld(0)/2, Y - ld(0)/2) + S(X, Y) + S(X + ld(0)/2, Y + ld(0)/2) + S(X + ld(0), Y + ld(0)))/5`),
  withParams({ id: 'fx_radial1', name: 'Radial Blur', icon: '🌀' }, [{ key: 'amount', name: 'Spread', min: 0, max: 0.12, def: 0.04, step: 0.005, fmt: 'pct' }], (v) => radialTaps([0, 1, 2, 3].map((i) => Number(pf(1 - i * v.amount))))),
  withParams({ id: 'fx_radial2', name: 'Radial Blur Strong', icon: '🌀' }, [{ key: 'amount', name: 'Spread', min: 0, max: 0.12, def: 0.06, step: 0.005, fmt: 'pct' }], (v) => radialTaps([0, 1, 2, 3, 4].map((i) => Number(pf(1 - i * v.amount))))),
  { id: 'fx_tilt', name: 'Tilt Shift', icon: '🎯', expr: `st(1, clip(abs(Y - H*0.46)/(H*0.42), 0, 1)); S(X, Y)*(1 - ld(1)) + (${crossBlur(0.008)})*ld(1)` },
  { id: 'fx_tiltwide', name: 'Tilt Shift Wide', icon: '🎯', expr: `st(1, clip(abs(Y - H*0.5)/(H*0.3), 0, 1)); S(X, Y)*(1 - ld(1)) + (${blurN(0.012)})*ld(1)` },
  { id: 'fx_spinblur2', name: 'Spin Blur Soft', icon: '🌀', expr: `(S(W/2 + (X - W/2)*0.99875 - (Y - H/2)*0.04998, H/2 + (X - W/2)*0.04998 + (Y - H/2)*0.99875) + S(X, Y) + S(W/2 + (X - W/2)*0.99875 + (Y - H/2)*0.04998, H/2 - (X - W/2)*0.04998 + (Y - H/2)*0.99875))/3` },
  // -- Distortion & Mirror --
  withParams({ id: 'fx_kaleido4', name: 'Kaleidoscope 4', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 4, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  withParams({ id: 'fx_kaleido6', name: 'Kaleidoscope 6', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 6, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  withParams({ id: 'fx_kaleido8', name: 'Kaleidoscope 8', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 8, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  withParams({ id: 'fx_kaleido12', name: 'Kaleidoscope 12', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 12, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  { id: 'fx_mirrorquad', name: 'Mirror Quad', icon: '🪞', expr: `S(W/2 - abs(X - W/2), H/2 - abs(Y - H/2))` },
  withParams({ id: 'fx_twirl1', name: 'Twirl', icon: '🌪' }, [{ key: 'amount', name: 'Twist', min: 0, max: 4, def: 0.9, step: 0.05 }], (v) => twirl(Number(pf(v.amount)), 1)),
  withParams({ id: 'fx_twirl2', name: 'Twirl Strong', icon: '🌪' }, [{ key: 'amount', name: 'Twist', min: 0, max: 5, def: 2.3, step: 0.05 }], (v) => twirl(Number(pf(v.amount)), 0.55)),
  withParams({ id: 'fx_bulge', name: 'Bulge', icon: '🔍' }, [{ key: 'amount', name: 'Bulge', min: 0, max: 1, def: 0.4, step: 0.01, fmt: 'pct' }], (v) => `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, 1 - ${pf(v.amount)}*max(0, 1 - ld(0)*ld(0))); S(W/2 + (X - W/2)*ld(1), H/2 + (Y - H/2)*ld(1))`),
  withParams({ id: 'fx_pinch', name: 'Pinch', icon: '🤏' }, [{ key: 'amount', name: 'Pinch', min: 0, max: 1, def: 0.45, step: 0.01, fmt: 'pct' }], (v) => `st(0, hypot(X - W/2, Y - H/2)/(0.72*hypot(W, H))); st(1, 1 + ${pf(v.amount)}*max(0, 1 - ld(0)*ld(0))); S(W/2 + (X - W/2)*ld(1), H/2 + (Y - H/2)*ld(1))`),
  { id: 'fx_squeeze', name: 'Squeeze In', icon: '↔', expr: `S(X*1.18 - W*0.09, Y)` },
  { id: 'fx_stretchx', name: 'Stretch Wide', icon: '↔', expr: `S(X*0.84 + W*0.08, Y)` },
  withParams({ id: 'fx_wavewarp', name: 'Wave Warp', icon: '〰' }, [{ key: 'amount', name: 'Wave depth', min: 0, max: 0.03, def: 0.008, step: 0.0005, fmt: 'pct' }], (v) => `S(X + sin(Y/H*12.56 + T*2.2)*W*${pf(v.amount)}, Y)`),
  // Fisheye: the sampling radius compresses toward the centre, magnifying the middle of the frame (Sprint 12, original).
  { id: 'fx_fisheye', name: 'Fisheye', icon: '🐟', expr: `st(0, (X - W/2)/(W/2)); st(1, (Y - H/2)/(H/2)); st(2, ld(0)*ld(0) + ld(1)*ld(1)); st(3, 1/(1 + 0.55*ld(2))); S(W/2 + (X - W/2)*ld(3), H/2 + (Y - H/2)*ld(3))` },
  // Stained glass: jittered cell sampling with dark grout lines between the panes (Sprint 12, original).
  { id: 'fx_stainedglass', name: 'Stained Glass', icon: '🪟', expr: `st(0, max(2, W/26)); st(1, floor(X/ld(0))); st(2, floor(Y/ld(0))); st(3, (ld(1) + 0.25 + 0.5*hash(ld(1)*3.7 + ld(2)*9.1))*ld(0)); st(4, (ld(2) + 0.25 + 0.5*hash(ld(1)*5.3 + ld(2)*1.9))*ld(0)); st(5, min(min(fract(X/ld(0)), 1 - fract(X/ld(0))), min(fract(Y/ld(0)), 1 - fract(Y/ld(0))))); S(ld(3), ld(4))*(0.22 + 0.78*smooth(0.02, 0.09, ld(5)))*1.12` },
  { id: 'fx_tunnel', name: 'Tunnel Pulse', icon: '🚇', expr: `st(0, 0.78 + 0.1*sin(T*1.6)); S(W/2 + (X - W/2)*ld(0), H/2 + (Y - H/2)*ld(0))` },
  { id: 'fx_prism', name: 'Prism Fringe', icon: '🌈', expr: `S(W/2 + (X - W/2)*(1 + C(0.025, 0, -0.025)), H/2 + (Y - H/2)*(1 + C(0.025, 0, -0.025)))` },
  // -- Film & Vintage --
  withParams({ id: 'fx_grainfine', name: 'Fine Grain', icon: '🎞' }, [{ key: 'amount', name: 'Grain', min: 0, max: 80, def: 16, step: 1 }], (v) => `S(X, Y) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*${pf(v.amount)}`),
  withParams({ id: 'fx_grainheavy', name: 'Heavy Grain', icon: '🎞' }, [{ key: 'amount', name: 'Grain', min: 0, max: 120, def: 52, step: 1 }], (v) => `S(X, Y) + (hash(floor(X/3)*1.37 + floor(Y/3)*2.11 + floor(T*18)*7.7) - 0.5)*${pf(v.amount)}`),
  { id: 'fx_sepia', name: 'Sepia', icon: '📜', expr: `L(X, Y)*C(1.08, 0.87, 0.6) + C(16, 9, 2)` },
  { id: 'fx_faded', name: 'Faded Film', icon: '📜', expr: `(S(X, Y)*0.5 + L(X, Y)*0.5)*0.8 + 34` },
  { id: 'fx_bleach', name: 'Bleach Bypass', icon: '📜', expr: `(S(X, Y)*0.45 + L(X, Y)*0.55)*1.3 - 26` },
  { id: 'fx_infrared', name: 'Infrared', icon: '🌡', expr: `L(X, Y)*C(1.15, 0.3, 0.42) + (255 - L(X, Y))*C(0.08, 0.28, 0.55)` },
  { id: 'fx_duotone', name: 'Duotone Blue-Gold', icon: '🎨', expr: `L(X, Y)*C(0.82, 0.68, 0.28) + C(22, 20, 54)` },
  withParams({ id: 'fx_halftone', name: 'Halftone', icon: '🗞' }, [{ key: 'cells', name: 'Dots across', min: 24, max: 400, def: 110, step: 1 }], (v) => `st(0, max(2, W/${Math.round(v.cells)})); st(1, hypot(fract(X/ld(0)) - 0.5, fract(Y/ld(0)) - 0.5)); S(X, Y) * (0.3 + 0.7*clip(0.72 - ld(1) + L(X, Y)/255*0.45, 0, 1))`),
  { id: 'fx_scratch', name: 'Scratches & Dust', icon: '🎞', expr: `st(0, W*0.31 + sin(T*0.9)*W*0.012); st(1, W*0.68 + cos(T*0.7)*W*0.014); st(2, lt(abs(X - ld(0)), W*0.0024) + lt(abs(X - ld(1)), W*0.0018)); st(3, gt(hash(floor(X/(W*0.005))*7.7 + floor(Y/(W*0.005))*3.1 + floor(T*11)*1.3), 0.9965)); if(ld(3), 240, S(X, Y) * (1 - 0.4*clip(ld(2), 0, 1)) * (0.965 + 0.055*hash(floor(T*11) + 0.7)) + ld(2)*7)` },
  { id: 'fx_flicker', name: 'Film Flicker', icon: '🎞', expr: `S(X + (hash(floor(T*14) + 0.2) - 0.5)*W*0.004, Y) * (0.9 + 0.16*hash(floor(T*14) + 3.3))` },
  { id: 'fx_oldphoto', name: 'Old Photo', icon: '📜', expr: `(L(X, Y)*C(1.05, 0.85, 0.58) + C(14, 8, 2)) * (0.7 + 0.3*clip(1 - hypot(X - W/2, Y - H/2)/(0.75*hypot(W, H)), 0, 1)) + (hash(X*1.37 + Y*2.11 + floor(T*9)*7.7) - 0.5)*14` },
  { id: 'fx_noir', name: 'Noir Contrast', icon: '🎬', expr: `st(0, (L(X, Y) - 128)*1.65 + 128); (ld(0) - 128)*1.2 + 128` },
  // Emboss: a diagonal light carved from the luma slope, on mid-grey (Sprint 12, original).
  { id: 'fx_emboss', name: 'Emboss', icon: '🗿', expr: `clip((L(X + 2, Y + 2) - L(X - 2, Y - 2))*1.6 + 128, 0, 255)` },
  // Crosshatch: pencil lines at two angles that thicken as the picture darkens (Sprint 12, original).
  { id: 'fx_hatchlines', name: 'Crosshatch', icon: '✏', expr: `st(0, L(X, Y)/255); st(1, lt(fract((X + Y)/7), clip(0.75 - ld(0), 0, 0.75))); st(2, lt(fract((X - Y)/7), clip(0.45 - ld(0), 0, 0.45))); clip(245 - 200*max(ld(1), ld(2))*(1.05 - ld(0)), 0, 255)` },
  // Pop quarters: the frame splits into four tinted panels over posterised luma (Sprint 12, original).
  { id: 'fx_warhol', name: 'Pop Quarters', icon: '🖼', expr: `st(0, floor(L(X, Y)/64)/3); if(lt(Y, H/2), if(lt(X, W/2), C(60, 200, 255)*(0.3 + 0.7*ld(0)), C(255, 90, 200)*(0.3 + 0.7*ld(0))), if(lt(X, W/2), C(255, 200, 40)*(0.3 + 0.7*ld(0)), C(120, 255, 120)*(0.3 + 0.7*ld(0))))` },
  // Blueprint: white line work on drafting blue, with a faint sheet grid (Sprint 12, original).
  { id: 'fx_blueprint', name: 'Blueprint', icon: '📐', expr: `st(0, clip((abs(L(X + 1, Y) - L(X - 1, Y)) + abs(L(X, Y + 1) - L(X, Y - 1)))*2.0, 0, 255)); C(16, 48, 116) + C(0.82, 0.9, 1)*ld(0) + (lt(mod(X, 48), 1) + lt(mod(Y, 48), 1))*12` },
  // -- Light & Glow --
  { id: 'fx_leaktl', name: 'Light Leak Top Left', icon: '🌅', expr: leak(0, 0, 255, 150, 60, 0.85, 0) },
  { id: 'fx_leaktr', name: 'Light Leak Top Right', icon: '🌅', expr: leak(1, 0, 255, 160, 70, 0.85, 2.1) },
  { id: 'fx_leakbl', name: 'Light Leak Bottom', icon: '🌅', expr: leak(0.5, 1.15, 255, 110, 40, 0.95, 4.2) },
  { id: 'fx_leakcool', name: 'Light Leak Cool', icon: '🌅', expr: leak(1, 0.3, 90, 160, 255, 0.8, 1.3) },
  { id: 'fx_leakmagenta', name: 'Light Leak Magenta', icon: '🌅', expr: leak(0.15, 1, 255, 70, 190, 0.8, 5.3) },
  { id: 'fx_leakedge', name: 'Edge Burn', icon: '🔥', expr: `st(0, clip((Y/H - 0.55)/0.45, 0, 1)); S(X, Y) + C(255, 120, 30)*ld(0)*ld(0)*0.75*(0.85 + 0.15*sin(T*3.1))` },
  { id: 'fx_bloom1', name: 'Soft Bloom', icon: '✨', expr: `S(X, Y) + (${crossBlur(0.006)})*0.45` },
  { id: 'fx_bloom2', name: 'Glow Bloom', icon: '✨', expr: `S(X, Y)*1.05 + (${blurN(0.014)})*0.7 + 6` },
  { id: 'fx_spotlight', name: 'Spotlight', icon: '🔦', expr: `S(X, Y) * (0.4 + 0.95*clip(1 - hypot(X - W/2, Y - H/2)/(0.62*hypot(W, H)), 0, 1))` },
  { id: 'fx_whitevig', name: 'White Vignette', icon: '🤍', expr: `st(0, smooth(0.3, 0.78, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H)))); S(X, Y)*(1 - ld(0)) + 255*ld(0)` },
  { id: 'fx_washgold', name: 'Golden Wash', icon: '🌇', expr: `S(X, Y)*0.85 + C(96, 58, 8)*(Y/H)` },
  { id: 'fx_washteal', name: 'Teal Wash', icon: '🌊', expr: `S(X, Y)*0.85 + C(6, 62, 66)*(1 - Y/H)` },
  { id: 'fx_glowpulse', name: 'Glow Pulse', icon: '✨', expr: `(S(X, Y) + (${crossBlur(0.005)})*0.3) * (1 + 0.13*sin(T*2.6))` },
  // Thermal camera: luma mapped through a five-stop false-colour ramp of our own (Sprint 12, original).
  { id: 'fx_thermal', name: 'Thermal Camera', icon: '🌡', expr: `st(0, L(X, Y)/255); if(lt(ld(0), 0.25), C(10 + 440*ld(0), 0, 40 + 480*ld(0)), if(lt(ld(0), 0.5), C(120 + 440*(ld(0) - 0.25), 240*(ld(0) - 0.25), 160 - 520*(ld(0) - 0.25)), if(lt(ld(0), 0.75), C(230 + 100*(ld(0) - 0.5), 60 + 440*(ld(0) - 0.5), 30 - 40*(ld(0) - 0.5)), C(255, 170 + 340*(ld(0) - 0.75), 20 + 840*(ld(0) - 0.75)))))` },
  // Neon edges: the luma gradient, amplified and tinted electric cyan-green on black (Sprint 12, original).
  { id: 'fx_neonedge', name: 'Neon Edges', icon: '🔋', expr: `st(0, clip((abs(L(X + 1, Y) - L(X - 1, Y)) + abs(L(X, Y + 1) - L(X, Y - 1)))*1.8, 0, 255)); C(ld(0)*0.25, ld(0)*0.95, ld(0))` },
  // Night vision: green phosphor gain, a bright centre falloff and sensor grain (Sprint 12, original).
  { id: 'fx_nightvision', name: 'Night Vision', icon: '🔭', expr: `L(X, Y)*C(0.34, 1.08, 0.38)*(0.72 + 0.4*clip(1 - hypot(X - W/2, Y - H/2)/(0.75*hypot(W, H)), 0, 1)) + (hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5)*22 + 10` },
  // -- Motion --
  { id: 'fx_shake1', name: 'Camera Shake', icon: '📳', expr: `S(X + sin(T*43)*W*0.004 + sin(T*97)*W*0.0015, Y + cos(T*37)*H*0.005)` },
  { id: 'fx_shake2', name: 'Impact Tremor', icon: '📳', expr: `S(X + sin(T*61)*W*0.011 + sin(T*131)*W*0.003, Y + cos(T*53)*H*0.012)` },
  { id: 'fx_jitter', name: 'Frame Jitter', icon: '📳', expr: `st(0, hash(floor(T*12) + 0.4)); st(1, hash(floor(T*12) + 8.4)); S(X + (ld(0) - 0.5)*W*0.012, Y + (ld(1) - 0.5)*H*0.012)` },
  { id: 'fx_drift', name: 'Handheld Drift', icon: '📳', expr: `S(X + sin(T*0.45)*W*0.02 + sin(T*1.3)*W*0.004, Y + cos(T*0.38)*H*0.018)` },
  { id: 'fx_pulsezoom', name: 'Pulse Zoom', icon: '💓', expr: `st(0, 1 + 0.07*sin(T*2.2)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))` },
  { id: 'fx_breathe', name: 'Breathing', icon: '💓', expr: `st(0, 1 + 0.022*sin(T*0.9)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))*1.03` },
  { id: 'fx_strobe', name: 'Strobe', icon: '⚡', expr: `S(X, Y) * if(gt(sin(T*22), 0.1), 1.12, 0.45)` },
  { id: 'fx_spinslow', name: 'Slow Sway', icon: '💓', expr: `st(0, sin(T*0.7)*0.045); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + (X - W/2)*ld(1) + (Y - H/2)*ld(2), H/2 - (X - W/2)*ld(2) + (Y - H/2)*ld(1))` },
  { id: 'fx_zoomslow', name: 'Slow Zoom', icon: '💓', expr: `st(0, 1 + 0.3*smooth(0, 6, T)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))` },
  ];
}

// ---- Library mega-growth (10/10 step 3): a second parameterized expansion, same rules as
// pixelLibrary() above — every variant carries its own constants/structure, parameters where
// the schema applies, and the sampling suite proves pairwise-distinct frames library-wide.
function pixelGrowth() {
  return [
  // -- Glitch & Digital --
  withParams({ id: 'fx_rgdiag', name: 'RGB Split Diagonal', icon: '🔀' }, [{ key: 'shift', name: 'Shift', min: 0, max: 0.03, def: 0.005, step: 0.0005, fmt: 'pct' }], (v) => `S(X + C(W*${pf(v.shift)}, 0, -W*${pf(v.shift)}), Y + C(H*${pf(v.shift)}, 0, -H*${pf(v.shift)}))`),
  withParams({ id: 'fx_chromazoom', name: 'Chroma Zoom', icon: '🌈' }, [{ key: 'spread', name: 'Spread', min: 0, max: 0.09, def: 0.03, step: 0.002, fmt: 'pct' }], (v) => `S(W/2 + (X - W/2)*(1 + C(${pf(v.spread)}, 0, -${pf(v.spread)})), H/2 + (Y - H/2)*(1 + C(${pf(v.spread)}, 0, -${pf(v.spread)})))`),
  { id: 'fx_blockglitch', name: 'Block Glitch', icon: '🧱', expr: `st(0, floor(X/(W/8))); st(1, floor(Y/(H/5))); st(2, hash(ld(0)*3.17 + ld(1)*7.71 + floor(T*7)*1.31)); st(3, hash(ld(0)*9.13 + ld(1)*1.93 + floor(T*7)*2.17)); S(X + if(gt(ld(3), 0.72), (ld(2) - 0.5)*W*0.16, 0), Y)` },
  withParams({ id: 'fx_rowshift', name: 'Row Shift', icon: '↔' }, [{ key: 'amount', name: 'Shift', min: 0, max: 0.03, def: 0.008, step: 0.0005, fmt: 'pct' }], (v) => `S(X + if(lt(fract(Y/(H/28)), 0.5), 1, -1)*W*${pf(v.amount)}*(0.6 + 0.4*sin(T*2.4)), Y)`),
  withParams({ id: 'fx_meltpixels', name: 'Pixel Melt', icon: '🫠' }, [{ key: 'drip', name: 'Drip', min: 0, max: 1, def: 0.5, step: 0.02, fmt: 'pct' }], (v) => { const top = 40; const bot = Math.round(40 - 30 * v.drip); return `st(0, max(2, W/(${top} - ${top - bot}*Y/H))); st(1, floor(Y/ld(0))*ld(0) + ld(0)/2); S(floor(X/ld(0))*ld(0) + ld(0)/2, ld(1) + ld(0)*0.35)`; }),
  withParams({ id: 'fx_quantize', name: 'Color Quantize', icon: '🎛' }, [{ key: 'levels', name: 'Levels', min: 2, max: 12, def: 5, step: 1 }], (v) => { const q = Math.round(256 / v.levels); const qg = Math.round(q * 1.27); const qb = Math.round(q * 1.7); return `floor(S(X, Y)/C(${q}, ${qg}, ${qb}))*C(${q}, ${qg}, ${qb}) + C(${Math.round(q / 2)}, ${Math.round(qg / 2)}, ${Math.round(qb / 2)})`; }),
  { id: 'fx_edgelines', name: 'Edge Lines', icon: '✒', expr: `st(0, clip((abs(L(X + 1, Y) - L(X - 1, Y)) + abs(L(X, Y + 1) - L(X, Y - 1)))*1.5, 0, 255)); ld(0)*C(1, 0.98, 0.94) + S(X, Y)*0.1 + 6` },
  withParams({ id: 'fx_ascii', name: 'ASCII Blocks', icon: '🔡' }, [{ key: 'cells', name: 'Cells across', min: 16, max: 120, def: 52, step: 1 }], (v) => `st(0, max(2, W/${Math.round(v.cells)})); st(1, floor(X/ld(0))*ld(0) + ld(0)/2); st(2, floor(Y/ld(0))*ld(0) + ld(0)/2); st(3, floor(L(ld(1), ld(2))/32)); st(4, min(fract(X/ld(0)), min(fract(Y/ld(0)), min(1 - fract(X/ld(0)), 1 - fract(Y/ld(0)))))); (ld(3)*36 + 8)*(0.35 + 0.65*smooth(0.03, 0.14, ld(4)))`),
  { id: 'fx_interlace', name: 'Interlace Weave', icon: '🪢', expr: `S(X, Y + if(lt(fract(Y/2), 0.5), 1.5, -1.5))*(0.9 + 0.1*fract(Y/2))` },
  { id: 'fx_tornframe', name: 'Torn Frame', icon: '🖼', expr: `st(0, clip(min(X, min(Y, min(W - X, H - Y)))/(H*0.16), 0, 1)); st(1, (hash(floor(Y/(H/9))*3.7 + floor(T*3)*0.77) - 0.5)*W*0.03*(1 - ld(0))); S(X + ld(1), Y + (hash(floor(X/(W/9))*5.3 + floor(T*3)*0.91) - 0.5)*H*0.03*(1 - ld(0)))*(0.82 + 0.18*ld(0))` },
  // -- Blur & Focus --
  withParams({ id: 'fx_boxblur', name: 'Box Blur', icon: '🌫' }, [{ key: 'radius', name: 'Radius', min: 0.001, max: 0.03, def: 0.011, step: 0.0005, fmt: 'pct' }], (v) => `st(0, H*${pf(v.radius)}); (S(X, Y) + S(X + ld(0), Y) + S(X - ld(0), Y) + S(X, Y + ld(0)) + S(X, Y - ld(0)) + S(X + ld(0), Y + ld(0)) + S(X - ld(0), Y - ld(0)) + S(X + ld(0), Y - ld(0)) + S(X - ld(0), Y + ld(0)))/9`),
  { id: 'fx_depthband', name: 'Depth Band', icon: '🎯', expr: `st(1, clip(abs((X/W + Y/H)*0.5 - 0.62)/0.42, 0, 1)); S(X, Y)*(1 - ld(1)*0.92) + (${blurN(0.013)})*ld(1)*0.92` },
  { id: 'fx_miniature', name: 'Miniature', icon: '🎯', expr: `st(1, clip(abs(Y - H*0.52)/(H*0.34), 0, 1)); st(2, S(X, Y) + (S(X, Y) - L(X, Y))*0.35); ld(2)*(1 - ld(1)) + ((${blurN(0.016)})*1.04 + 4)*ld(1)` },
  { id: 'fx_spinblur1', name: 'Spin Blur', icon: '🌀', expr: `(S(W/2 + (X - W/2)*0.9759 + (Y - H/2)*0.21823, H/2 - (X - W/2)*0.21823 + (Y - H/2)*0.9759) + S(W/2 + (X - W/2)*0.99396 + (Y - H/2)*0.10978, H/2 - (X - W/2)*0.10978 + (Y - H/2)*0.99396) + S(X, Y) + S(W/2 + (X - W/2)*0.99396 - (Y - H/2)*0.10978, H/2 + (X - W/2)*0.10978 + (Y - H/2)*0.99396) + S(W/2 + (X - W/2)*0.9759 - (Y - H/2)*0.21823, H/2 + (X - W/2)*0.21823 + (Y - H/2)*0.9759))/5` },
  withParams({ id: 'fx_zoomtrails', name: 'Zoom Trails', icon: '🌀' }, [{ key: 'amount', name: 'Trails', min: 0, max: 0.12, def: 0.05, step: 0.005, fmt: 'pct' }], (v) => radialTaps([0, 1, 2, 3].map((i) => Number(pf(1 + i * v.amount))))),
  withParams({ id: 'fx_frost', name: 'Frosted Glass', icon: '❄' }, [{ key: 'grain', name: 'Grain size', min: 0.001, max: 0.03, def: 0.008, step: 0.0005, fmt: 'pct' }], (v) => `S(X + (hash(floor(X/3)*1.37 + floor(Y/3)*2.11) - 0.5)*W*${pf(v.grain)}, Y + (hash(floor(X/3)*3.71 + floor(Y/3)*1.13) - 0.5)*H*${pf(v.grain)})`),
  withParams({ id: 'fx_hexblur', name: 'Hex Blur', icon: '⬡' }, [{ key: 'radius', name: 'Radius', min: 0.001, max: 0.03, def: 0.01, step: 0.0005, fmt: 'pct' }], (v) => `st(0, H*${pf(v.radius)}); (S(X, Y)*2 + S(X + ld(0), Y) + S(X + ld(0)/2, Y + ld(0)*0.866) + S(X - ld(0)/2, Y + ld(0)*0.866) + S(X - ld(0), Y) + S(X - ld(0)/2, Y - ld(0)*0.866) + S(X + ld(0)/2, Y - ld(0)*0.866))/8`),
  withParams({ id: 'fx_sharpen', name: 'Sharpen', icon: '🔪' }, [{ key: 'amount', name: 'Amount', min: 0, max: 1.6, def: 0.7, step: 0.05, fmt: 'pct' }], (v) => `S(X, Y)*(1 + ${pf(v.amount)}) - (${blurN(0.005)})*${pf(v.amount)}`),
  // -- Distortion & Mirror --
  withParams({ id: 'fx_kaleido5', name: 'Kaleidoscope 5', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 5, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  withParams({ id: 'fx_kaleido10', name: 'Kaleidoscope 10', icon: '🔮' }, [{ key: 'segments', name: 'Segments', min: 3, max: 16, def: 10, step: 1 }], (v) => kaleido(Math.round(v.segments))),
  { id: 'fx_mirrorh', name: 'Mirror Horizontal', icon: '🪞', expr: `S(X, H/2 - abs(Y - H/2))` },
  withParams({ id: 'fx_mirrorseam', name: 'Mirror Seam', icon: '🪞' }, [{ key: 'drift', name: 'Seam drift', min: 0, max: 0.3, def: 0.08, step: 0.005, fmt: 'pct' }], (v) => `st(0, W*(0.5 + ${pf(v.drift)}*sin(T*0.6))); S(if(gt(X, ld(0)), 2*ld(0) - X, X), Y)`),
  { id: 'fx_floorreflect', name: 'Floor Reflection', icon: '🪞', expr: `if(gt(Y, H*0.74), S(X, H*1.48 - Y)*0.5 + C(6, 8, 14)*(1 - (Y/H - 0.74)*2), S(X, Y))` },
  withParams({ id: 'fx_wavev', name: 'Wave Warp Vertical', icon: '〰' }, [{ key: 'amount', name: 'Wave depth', min: 0, max: 0.03, def: 0.008, step: 0.0005, fmt: 'pct' }], (v) => `S(X, Y + sin(X/W*12.56 + T*2.0)*H*${pf(v.amount)})`),
  withParams({ id: 'fx_pond', name: 'Pond Ripple', icon: '💧' }, [{ key: 'rings', name: 'Rings', min: 4, max: 40, def: 18, step: 1 }], (v) => `st(0, hypot(X - W/2, Y - H/2)); st(1, sin(ld(0)/(H*0.5)*${pf(v.rings)}*3.14159 - T*3.2)*H*0.006*clip(1 - ld(0)/(0.75*hypot(W, H)), 0, 1)); st(2, max(ld(0), 0.001)); S(X + (X - W/2)/ld(2)*ld(1), Y + (Y - H/2)/ld(2)*ld(1))`),
  { id: 'fx_barrelroll', name: 'Barrel Roll', icon: '🛢', expr: `st(0, sin(T*0.45)*0.13); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + ((X - W/2)*ld(1) + (Y - H/2)*ld(2))/1.18, H/2 + (-(X - W/2)*ld(2) + (Y - H/2)*ld(1))/1.18)` },
  withParams({ id: 'fx_skew', name: 'Skew Slide', icon: '📐' }, [{ key: 'tilt', name: 'Tilt', min: 0, max: 0.5, def: 0.16, step: 0.01 }], (v) => `S(X + (Y - H/2)*(${pf(v.tilt)} + 0.03*sin(T*0.8)), Y)`),
  // -- Film & Vintage --
  withParams({ id: 'fx_colorgrain', name: 'Color Grain', icon: '🎞' }, [{ key: 'amount', name: 'Grain', min: 0, max: 110, def: 30, step: 1 }], (v) => `S(X, Y) + C(hash(X*1.37 + Y*2.11 + floor(T*24)*7.7) - 0.5, hash(X*2.53 + Y*1.07 + floor(T*24)*3.9) - 0.5, hash(X*1.91 + Y*3.17 + floor(T*24)*5.3) - 0.5)*${pf(v.amount)}`),
  withParams({ id: 'fx_hardvig', name: 'Hard Vignette', icon: '🎬' }, [{ key: 'strength', name: 'Strength', min: 0, max: 1, def: 0.55, step: 0.01, fmt: 'pct' }], (v) => `st(0, smooth(0.52, 0.78, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H)))); S(X, Y)*(1 - ${pf(v.strength)}*ld(0))`),
  { id: 'fx_fadedblue', name: 'Faded Blues', icon: '📜', expr: `S(X, Y)*0.7 + L(X, Y)*0.1 + C(16, 24, 42)` },
  { id: 'fx_xprocess', name: 'Cross Process', icon: '🧪', expr: `S(X, Y)*C(1.22, 1.06, 0.88) - L(X, Y)*C(0.12, 0.02, 0.1) + C(6, 2, 0)` },
  { id: 'fx_deepsepia', name: 'Deep Sepia', icon: '📜', expr: `st(0, clip(1 - hypot(X - W/2, Y - H/2)/(0.78*hypot(W, H)), 0.35, 1)); (L(X, Y)*1.12 - 12)*C(1.1, 0.8, 0.48)*ld(0) + C(8, 4, 0)` },
  { id: 'fx_softmono', name: 'Soft Mono', icon: '🤍', expr: `st(0, H*0.005); (L(X, Y)*2 + L(X + ld(0), Y) + L(X - ld(0), Y) + L(X, Y + ld(0)) + L(X, Y - ld(0)))/6*0.94 + 15` },
  withParams({ id: 'fx_technicolor', name: 'Technicolor', icon: '🌈' }, [{ key: 'pop', name: 'Colour pop', min: 0, max: 1.6, def: 0.85, step: 0.05, fmt: 'pct' }], (v) => `(S(X, Y) + (S(X, Y) - L(X, Y))*${pf(v.pop)})*1.06 - 6`),
  { id: 'fx_filmborder', name: 'Film Border', icon: '🎞', expr: `st(0, smooth(0, H*0.075, min(X, min(Y, min(W - X, H - Y))))); S(X, Y)*(0.25 + 0.75*ld(0))*C(1.03, 0.99, 0.94) + (1 - ld(0))*C(12, 9, 6)` },
  { id: 'fx_agedpaper', name: 'Aged Paper', icon: '📜', expr: `st(0, hash(floor(X/(W/5))*3.31 + floor(Y/(H/5))*7.77)); st(1, clip(1 - hypot(X - W/2, Y - H/2)/(0.8*hypot(W, H)), 0, 1)); (S(X, Y)*C(1.06, 0.94, 0.72) + C(18, 10, 2))*(0.78 + 0.22*ld(1))*(1 - 0.16*ld(0)) + (hash(X*1.37 + Y*2.11) - 0.5)*9` },
  // -- Light & Glow --
  { id: 'fx_leakstrip', name: 'Leak Strip', icon: '🌅', expr: `st(0, clip(1 - abs(Y/H - 0.38)/0.3, 0, 1)); S(X, Y) + C(255, 140, 50)*ld(0)*ld(0)*0.55*(0.85 + 0.15*sin(T*0.9 + X/W*2.5))` },
  { id: 'fx_leakdiag', name: 'Diagonal Leak', icon: '🌅', expr: `st(0, clip(1 - abs(X/W - Y/H)/0.55, 0, 1)); S(X, Y) + C(255, 120, 130)*ld(0)*ld(0)*0.5*(0.85 + 0.15*sin(T*0.7))` },
  withParams({ id: 'fx_sunglow', name: 'Sun Glow', icon: '☀' }, [{ key: 'glow', name: 'Glow', min: 0, max: 1.4, def: 0.8, step: 0.02, fmt: 'pct' }], (v) => `st(0, clip(1 - hypot(X - W*0.8, Y - H*0.14)/(H*0.95), 0, 1)); S(X, Y)*(1 + ld(0)*0.25*${pf(v.glow)}) + C(255, 226, 160)*ld(0)*ld(0)*0.85*${pf(v.glow)}`),
  { id: 'fx_halo', name: 'Halo Ring', icon: '💫', expr: `st(0, hypot(X - W/2, Y - H/2)/(0.71*hypot(W, H))); st(1, clip(1 - abs(ld(0) - 0.44)/0.13, 0, 1)); S(X, Y) + C(190, 215, 255)*ld(1)*ld(1)*0.5` },
  { id: 'fx_starburst', name: 'Starburst', icon: '✴', expr: `st(0, atan2(Y - H/2, X - W/2)); st(1, sin(ld(0)*6 + T*0.4)); st(2, ld(1)*ld(1)); st(3, clip(1 - hypot(X - W/2, Y - H/2)/(0.75*hypot(W, H)), 0, 1)); S(X, Y) + C(255, 240, 200)*ld(2)*ld(2)*ld(3)*0.4` },
  { id: 'fx_prismglow', name: 'Prism Glow', icon: '🔆', expr: `S(X, Y) + (S(X + C(W*0.008, 0, -W*0.008), Y) + S(X - C(W*0.008, 0, -W*0.008), Y))/2*0.5` },
  { id: 'fx_fogglow', name: 'Fog Glow', icon: '🌫', expr: `st(0, smooth(0.42, 1, Y/H + 0.08*sin(X/W*7 + T*0.5))); S(X, Y)*(1 - ld(0)*0.3) + C(205, 222, 242)*ld(0)*0.5` },
  { id: 'fx_moonlight', name: 'Moonlight', icon: '🌙', expr: `S(X, Y)*C(0.8, 0.94, 1.24) + smooth(150, 255, L(X, Y))*C(12, 18, 34) + 4` },
  withParams({ id: 'fx_candle', name: 'Candle Glow', icon: '🕯' }, [{ key: 'flicker', name: 'Flicker', min: 0, max: 1, def: 0.5, step: 0.02, fmt: 'pct' }], (v) => `st(0, clip(1 - hypot(X - W/2, Y - H*1.05)/H, 0, 1)); S(X, Y)*(1 + ld(0)*0.12) + C(255, 170, 80)*ld(0)*ld(0)*(0.5 + ${pf(v.flicker)}*0.24*sin(T*11) + ${pf(v.flicker)}*0.18*sin(T*23 + 1.7))`),
  // -- Motion --
  { id: 'fx_rollshake', name: 'Rolling Shake', icon: '📳', expr: `st(0, sin(T*31)*0.008 + sin(T*57)*0.004); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + (X - W/2)*ld(1) + (Y - H/2)*ld(2), H/2 - (X - W/2)*ld(2) + (Y - H/2)*ld(1))` },
  { id: 'fx_quake', name: 'Quake', icon: '📳', expr: `st(0, hash(floor(T*5) + 0.31)); st(1, hash(floor(T*5) + 4.77)); st(2, (ld(0) - 0.5)*0.021); st(3, cos(ld(2))); st(4, sin(ld(2))); st(5, 1.04 + (ld(1) - 0.5)*0.05); S(W/2 + ((X - W/2)*ld(3) + (Y - H/2)*ld(4))/ld(5) + (ld(0) - 0.5)*W*0.038, H/2 + (-(X - W/2)*ld(4) + (Y - H/2)*ld(3))/ld(5) + (ld(1) - 0.5)*H*0.033)` },
  withParams({ id: 'fx_zoomburst', name: 'Zoom Burst', icon: '💥' }, [{ key: 'power', name: 'Power', min: 0, max: 0.4, def: 0.16, step: 0.01, fmt: 'pct' }], (v) => `st(0, 1 + ${pf(v.power)}*pow(max(0, sin(T*1.4)), 6)); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))`),
  { id: 'fx_panleft', name: 'Slow Pan', icon: '🎥', expr: `S(W/2 + (X - W/2)/1.14 + sin(T*0.3)*W*0.05, H/2 + (Y - H/2)/1.14)` },
  { id: 'fx_tiltup2', name: 'Slow Tilt', icon: '🎥', expr: `S(W/2 + (X - W/2)/1.14, H/2 + (Y - H/2)/1.14 + sin(T*0.26 + 1.3)*H*0.045)` },
  { id: 'fx_orbit', name: 'Orbit Sway', icon: '🪐', expr: `st(0, sin(T*0.55)*0.02); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + ((X - W/2)*ld(1) + (Y - H/2)*ld(2)) + sin(T*0.55)*W*0.03, H/2 + (-(X - W/2)*ld(2) + (Y - H/2)*ld(1)) + cos(T*0.55)*H*0.026)` },
  { id: 'fx_glitchshake', name: 'Glitch Shake', icon: '📳', expr: `st(0, hash(floor(T*9) + 0.13)); st(1, if(gt(ld(0), 0.45), (ld(0) - 0.45)*1.6, 0)); S(X + C(W*0.014, 0, -W*0.014)*ld(1) + (ld(0) - 0.5)*W*0.01, Y + (hash(floor(T*9) + 2.9) - 0.5)*H*0.008)` },
  withParams({ id: 'fx_heartbeat', name: 'Heartbeat Zoom', icon: '💓' }, [{ key: 'beat', name: 'Beat', min: 0, max: 0.25, def: 0.09, step: 0.005, fmt: 'pct' }], (v) => `st(0, 1.03 + ${pf(v.beat)}*(pow(max(0, sin(T*2.6)), 3) + 0.55*pow(max(0, sin(T*2.6 + 0.55)), 8))); S(W/2 + (X - W/2)/ld(0), H/2 + (Y - H/2)/ld(0))`),
  { id: 'fx_spinpulse', name: 'Spin Pulse', icon: '🌀', expr: `st(0, sin(T*1.25)*0.3); st(1, cos(ld(0))); st(2, sin(ld(0))); S(W/2 + ((X - W/2)*ld(1) + (Y - H/2)*ld(2))/1.3, H/2 + (-(X - W/2)*ld(2) + (Y - H/2)*ld(1))/1.3)` },
  ];
}

// ---- Effects drawn on top of the clip (canvas; the export renders them with the text layer). ----
const rnd = (n) => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

function drawSnow(ctx, W, H, t, count = 170, wind = 0.06) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const depth = 0.35 + rnd(i * 3.7) * 0.65; // nearer flakes are bigger, faster and blurrier
    const speed = (0.18 + 0.35 * depth) * H;
    const y = ((rnd(i * 1.3) * H + t * speed) % (H * 1.1)) - H * 0.05;
    const x = ((rnd(i * 7.1) * W + t * W * wind * depth + Math.sin(t * 1.7 + i) * W * 0.01) % (W * 1.05)) - W * 0.02;
    const r = Math.max(1, H * 0.0035 * depth);
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.55 * depth})`;
    ctx.lineWidth = r;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - W * 0.004 * depth, y - speed * 0.02);
    ctx.stroke();
  }
  ctx.restore();
}

function star(ctx, x, y, s, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(0.15, `rgba(225,240,255,${a * 0.8})`);
  g.addColorStop(1, 'rgba(160,200,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255,255,255,${a * 0.9})`;
  ctx.lineWidth = Math.max(1, s * 0.05);
  for (const [dx, dy, k] of [[1, 0, 2.2], [0, 1, 2.2], [0.7, 0.7, 1], [0.7, -0.7, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x - dx * s * k, y - dy * s * k);
    ctx.lineTo(x + dx * s * k, y + dy * s * k);
    ctx.stroke();
  }
}

function drawLimelight(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const period = 1.6 + rnd(i * 2.3) * 1.8;
    const phase = ((t + rnd(i * 5.1) * period) % period) / period;
    const a = Math.sin(Math.PI * phase) ** 2;
    if (a < 0.02) continue;
    const x = W * rnd(i * 9.7 + Math.floor((t + rnd(i * 5.1) * period) / period) * 0.37);
    const y = H * rnd(i * 4.4 + Math.floor((t + rnd(i * 5.1) * period) / period) * 0.91) * 0.85;
    star(ctx, x, y, H * (0.012 + 0.03 * rnd(i * 1.9)) * (0.6 + 0.4 * a), a);
  }
  ctx.restore();
}

function drawFire(ctx, W, H, t, heat = 1) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createLinearGradient(0, H, 0, H * 0.55);
  glow.addColorStop(0, `rgba(255,110,20,${0.55 * heat})`);
  glow.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  for (let i = 0; i < 260; i++) {
    const life = 0.7 + rnd(i * 2.9) * 0.8;
    const age = ((t + rnd(i * 6.1) * life) % life) / life; // 0 just born .. 1 gone
    const x = W * rnd(i * 3.3) + Math.sin(t * 3 + i) * W * 0.01 * age;
    const y = H * (1.02 - age * (0.22 + 0.25 * rnd(i * 8.8)) * heat);
    const r = H * (0.05 + 0.05 * rnd(i * 1.1)) * (1 - age * 0.7);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = (1 - age) * 0.5;
    g.addColorStop(0, `rgba(255,${200 - age * 120},${60 - age * 50},${a})`);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBurning(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const f = 0.75 + 0.25 * Math.sin(t * 9) * Math.sin(t * 5.3 + 1);
  for (const [cx, cy, r] of [[0, H, H * 0.9], [W, H * 0.9, H * 0.8], [W * 0.5, H * 1.1, H * 0.7]]) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,150,40,${0.6 * f})`);
    g.addColorStop(0.5, `rgba(255,80,10,${0.25 * f})`);
    g.addColorStop(1, 'rgba(255,40,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  for (let i = 0; i < 60; i++) { // embers
    const life = 1.5 + rnd(i * 4.1) * 1.5;
    const age = ((t + rnd(i * 7.3) * life) % life) / life;
    const x = W * rnd(i * 2.2) + Math.sin(t * 2 + i) * W * 0.03;
    const y = H * (1 - age * 0.9);
    ctx.fillStyle = `rgba(255,${170 + 60 * rnd(i)},80,${(1 - age) * 0.9})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, H * 0.003 * (1 + rnd(i * 9))), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawRain(ctx, W, H, t, { n, len, speed, alpha }) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = `rgba(190, 215, 255, ${alpha})`;
  for (let i = 0; i < n; i++) {
    const depth = 0.4 + rnd(i * 3.1) * 0.6;
    const v = speed * (0.6 + 0.5 * depth) * H;
    const y = ((rnd(i * 1.7) * H + t * v) % (H * 1.15)) - H * 0.08;
    const x = ((rnd(i * 6.3) * W + t * v * 0.18) % (W * 1.1)) - W * 0.05;
    ctx.lineWidth = Math.max(1, H * 0.0016 * depth);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - H * len * 0.18 * depth, y - H * len * depth);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDust(ctx, W, H, t, rgb, n) {
  ctx.save();
  for (let i = 0; i < n; i++) {
    const depth = 0.3 + rnd(i * 2.9) * 0.7;
    const x = (rnd(i * 5.7) * W + Math.sin(t * 0.22 * depth + i * 1.7) * W * 0.02 + t * W * 0.008 * depth) % W;
    const y = (rnd(i * 3.9) * H - t * H * 0.012 * depth + H) % H;
    const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + depth) + i * 2.3);
    ctx.fillStyle = `${rgb}${(0.1 + 0.3 * depth) * tw})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.7, H * 0.0028 * depth), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSparkles(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const period = 1.1 + rnd(i * 2.7) * 1.6;
    const phase = ((t + rnd(i * 4.3) * period) % period) / period;
    const a = Math.sin(Math.PI * phase) ** 2;
    if (a < 0.03) continue;
    const cyc = Math.floor((t + rnd(i * 4.3) * period) / period);
    const x = W * rnd(i * 8.9 + cyc * 0.31);
    const y = H * rnd(i * 3.3 + cyc * 0.77);
    const s = H * (0.014 + 0.03 * rnd(i * 1.3)) * (0.5 + 0.5 * a);
    const g = ctx.createRadialGradient(x, y, 0, x, y, s);
    g.addColorStop(0, `rgba(255, 240, 200, ${a})`);
    g.addColorStop(0.25, `rgba(255, 205, 110, ${a * 0.7})`);
    g.addColorStop(1, 'rgba(255, 180, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 235, 190, ${a * 0.85})`;
    ctx.lineWidth = Math.max(1, s * 0.06);
    for (const [dx, dy, k] of [[1, 0, 2], [0, 1, 2], [0.7, 0.7, 0.9], [0.7, -0.7, 0.9]]) {
      ctx.beginPath();
      ctx.moveTo(x - dx * s * k, y - dy * s * k);
      ctx.lineTo(x + dx * s * k, y + dy * s * k);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawEmbers(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 110; i++) {
    const life = 1.6 + rnd(i * 3.7) * 2.2;
    const age = ((t + rnd(i * 6.7) * life) % life) / life;
    const x = W * rnd(i * 2.6) + Math.sin(t * 1.8 + i * 1.3) * W * 0.015;
    const y = H * (1.02 - age * 0.96);
    const a = (1 - age) * (0.35 + 0.55 * rnd(i * 5.1));
    const r = Math.max(0.8, H * 0.0032 * (1 - age * 0.5) * (0.6 + rnd(i * 8.2)));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(255, ${170 + Math.floor(60 * rnd(i * 4.4))}, 70, ${a})`);
    g.addColorStop(1, 'rgba(255, 90, 20, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawAsh(ctx, W, H, t) {
  ctx.save();
  for (let i = 0; i < 130; i++) {
    const depth = 0.35 + rnd(i * 3.3) * 0.65;
    const y = ((rnd(i * 1.9) * H + t * H * 0.05 * depth) % (H * 1.08)) - H * 0.04;
    const x = (rnd(i * 6.9) * W + Math.sin(t * 0.9 + i * 2.1) * W * 0.012 * depth) % W;
    const grey = 150 + Math.floor(80 * rnd(i * 7.7));
    ctx.fillStyle = `rgba(${grey}, ${grey}, ${grey + 6}, ${0.25 + 0.4 * depth})`;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.8, H * 0.0026 * depth), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFog(ctx, W, H, t) {
  ctx.save();
  for (const [baseY, hgt, spd, alpha, ph] of [[0.78, 0.34, 0.021, 0.16, 0], [0.6, 0.3, -0.013, 0.11, 2.4], [0.9, 0.26, 0.03, 0.13, 4.7]]) {
    const cx = W * (0.5 + 0.5 * Math.sin(t * spd * 6.28 + ph));
    const g = ctx.createRadialGradient(cx, H * baseY, 0, cx, H * baseY, W * 0.55);
    g.addColorStop(0, `rgba(225, 232, 242, ${alpha})`);
    g.addColorStop(1, 'rgba(225, 232, 242, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * (baseY - hgt / 2), W, H * hgt);
  }
  ctx.restore();
}

function drawConfetti(ctx, W, H, t) {
  const COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#facc15'];
  ctx.save();
  for (let i = 0; i < 120; i++) {
    const depth = 0.45 + rnd(i * 2.3) * 0.55;
    const fall = (0.14 + 0.13 * depth) * H;
    const y = ((rnd(i * 1.4) * H + t * fall) % (H * 1.12)) - H * 0.06;
    const x = (rnd(i * 5.3) * W + Math.sin(t * 1.4 + i) * W * 0.014) % W;
    const w = W * 0.008 * depth;
    const h = H * 0.011 * depth;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (1 + rnd(i * 7.9) * 2) + i);
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-w / 2, -h / 2, w, h * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + i * 1.9))));
    ctx.restore();
  }
  ctx.restore();
}

function drawFireflies(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 42; i++) {
    const x = W * (0.5 + 0.42 * Math.sin(t * (0.11 + rnd(i * 3.1) * 0.14) + i * 2.39));
    const y = H * (0.55 + 0.36 * Math.sin(t * (0.09 + rnd(i * 5.7) * 0.12) + i * 4.13));
    const pulse = Math.max(0, Math.sin(t * (0.7 + rnd(i * 7.3)) + i * 1.71)) ** 3;
    if (pulse < 0.04) continue;
    const r = H * 0.016 * (0.6 + rnd(i * 9.1));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(220, 255, 150, ${0.75 * pulse})`);
    g.addColorStop(0.3, `rgba(170, 240, 90, ${0.35 * pulse})`);
    g.addColorStop(1, 'rgba(140, 220, 60, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const OVERLAY_EFFECTS = [
  { id: 'fx_snow', name: 'Snow Storm', icon: '❄', draw: drawSnow },
  { id: 'fx_limelight', name: 'Limelight', icon: '✦', draw: drawLimelight },
  { id: 'fx_fire', name: 'Fire Burn', icon: '🔥', draw: (c, W, H, t) => drawFire(c, W, H, t, 1) },
  { id: 'fx_burning', name: 'Burning Glow', icon: '🌅', draw: drawBurning },
  // -- Weather & particles, parameterized off the same canvas machinery --
  { id: 'fx_snowlight', name: 'Snowfall Light', icon: '🌨', draw: (c, W, H, t) => drawSnow(c, W, H, t, 70, 0.03) },
  { id: 'fx_blizzard', name: 'Blizzard', icon: '🌨', draw: (c, W, H, t) => drawSnow(c, W, H, t, 320, 0.22) },
  { id: 'fx_rain', name: 'Rain', icon: '🌧', draw: (c, W, H, t) => drawRain(c, W, H, t, { n: 130, len: 0.05, speed: 1.15, alpha: 0.34 }) },
  { id: 'fx_downpour', name: 'Downpour', icon: '🌧', draw: (c, W, H, t) => drawRain(c, W, H, t, { n: 330, len: 0.085, speed: 1.7, alpha: 0.46 }) },
  { id: 'fx_dust', name: 'Dust Motes', icon: '✨', draw: (c, W, H, t) => drawDust(c, W, H, t, 'rgba(235,235,245,', 90) },
  { id: 'fx_golddust', name: 'Golden Dust', icon: '✨', draw: (c, W, H, t) => drawDust(c, W, H, t, 'rgba(255,205,120,', 90) },
  { id: 'fx_sparkles', name: 'Sparkles', icon: '✦', draw: drawSparkles },
  { id: 'fx_embers', name: 'Rising Embers', icon: '🔥', draw: drawEmbers },
  { id: 'fx_ash', name: 'Ash Fall', icon: '🌋', draw: drawAsh },
  { id: 'fx_fog', name: 'Fog Banks', icon: '🌫', draw: drawFog },
  { id: 'fx_confetti', name: 'Confetti', icon: '🎉', draw: drawConfetti },
  { id: 'fx_fireflies', name: 'Fireflies', icon: '🪲', draw: drawFireflies },
  // -- Library mega-growth (10/10 step 3): more weather & particle overlays, drawn with the
  // same deterministic rnd() machinery; each has its own shapes, palette and motion.
  { id: 'fx_bokeh', name: 'Bokeh Lights', icon: '🔮', draw: drawBokeh },
  { id: 'fx_petals', name: 'Petal Fall', icon: '🌸', draw: drawPetals },
  { id: 'fx_bubbles', name: 'Soap Bubbles', icon: '🫧', draw: drawBubbles },
  { id: 'fx_leaves', name: 'Leaf Drift', icon: '🍃', draw: drawLeaves },
  { id: 'fx_hearts', name: 'Floating Hearts', icon: '💗', draw: drawHearts },
  { id: 'fx_starfall', name: 'Star Shower', icon: '⭐', draw: drawStarfall },
  { id: 'fx_sunrays', name: 'Sun Rays', icon: '🌤', draw: drawSunrays },
  { id: 'fx_windowrain', name: 'Window Rain', icon: '💧', draw: drawWindowRain },
];

export const isPixelFx = (id) => PIXEL_EFFECTS.some((e) => e.id === id);
export const isOverlayFx = (id) => OVERLAY_EFFECTS.some((e) => e.id === id);
export const fxTransition = (id) => FX_TRANSITIONS.find((t) => t.id === id);

// ---- Mega-growth overlay painters (10/10 step 3). Deterministic in t like the painters
// above: the same rnd() seeds drive every frame, so preview and export agree. ----

function drawBokeh(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cols = ['255,190,90', '255,120,150', '120,190,255', '170,255,200', '230,200,255'];
  for (let i = 0; i < 15; i++) {
    const r = H * (0.05 + rnd(i * 3.1) * 0.11);
    const x = ((rnd(i * 7.7) + t * 0.008 * (0.5 + rnd(i * 1.3))) % 1) * (W + r * 2) - r;
    const y = rnd(i * 5.3) * H + Math.sin(t * 0.4 + i * 1.7) * H * 0.02;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const c = cols[i % cols.length];
    g.addColorStop(0, `rgba(${c},0.30)`);
    g.addColorStop(0.7, `rgba(${c},0.12)`);
    g.addColorStop(1, `rgba(${c},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

function drawPetals(ctx, W, H, t) {
  ctx.save();
  for (let i = 0; i < 26; i++) {
    const speed = 0.03 + rnd(i * 2.9) * 0.035;
    const y = ((rnd(i * 4.1) + t * speed) % 1) * (H + 20) - 10;
    const x = rnd(i * 6.3) * W + Math.sin(t * 0.9 + i * 2.1) * W * 0.03;
    const s = H * (0.014 + rnd(i * 8.7) * 0.016);
    const rot = t * (0.6 + rnd(i * 1.9)) + i * 1.37;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = `rgba(255,${150 + Math.floor(rnd(i * 3.3) * 60)},${180 + Math.floor(rnd(i * 5.9) * 50)},0.75)`;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawBubbles(ctx, W, H, t) {
  ctx.save();
  ctx.lineWidth = Math.max(1, H * 0.0035);
  for (let i = 0; i < 20; i++) {
    const speed = 0.025 + rnd(i * 3.7) * 0.04;
    const y = H - ((rnd(i * 9.1) + t * speed) % 1) * (H + 30) + 15;
    const x = rnd(i * 4.7) * W + Math.sin(t * 1.3 + i * 2.9) * W * 0.012;
    const r = H * (0.02 + rnd(i * 6.1) * 0.045);
    ctx.strokeStyle = 'rgba(200,230,255,0.55)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(x, y, r, -2.4, -1.5); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.12, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}

function drawLeaves(ctx, W, H, t) {
  ctx.save();
  const cols = ['92,160,60', '120,180,70', '70,140,50', '150,190,80'];
  for (let i = 0; i < 18; i++) {
    const speed = 0.022 + rnd(i * 5.7) * 0.03;
    const y = ((rnd(i * 2.3) + t * speed) % 1) * (H + 24) - 12;
    const x = rnd(i * 8.9) * W + Math.sin(t * 0.7 + i * 1.9) * W * 0.045;
    const s = H * (0.02 + rnd(i * 4.3) * 0.02);
    const rot = Math.sin(t * 0.8 + i * 2.3) * 0.9 + i;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.fillStyle = `rgba(${cols[i % cols.length]},0.8)`;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.8, 0, 0, s);
    ctx.quadraticCurveTo(-s * 0.8, 0, 0, -s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,90,30,0.6)';
    ctx.lineWidth = Math.max(1, H * 0.002);
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(0, s); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

function drawHearts(ctx, W, H, t) {
  ctx.save();
  const cols = ['255,90,130', '255,120,160', '240,70,100', '255,150,180'];
  for (let i = 0; i < 14; i++) {
    const speed = 0.02 + rnd(i * 6.7) * 0.03;
    const y = H - ((rnd(i * 3.9) + t * speed) % 1) * (H + 30) + 15;
    const x = rnd(i * 5.1) * W + Math.sin(t * 1.1 + i * 2.7) * W * 0.015;
    const s = H * (0.02 + rnd(i * 7.3) * 0.022) * (1 + 0.12 * Math.sin(t * 3 + i * 1.3));
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = `rgba(${cols[i % cols.length]},0.78)`;
    ctx.beginPath();
    ctx.moveTo(0, s * 0.85);
    ctx.bezierCurveTo(-s * 1.25, 0, -s * 0.7, -s, 0, -s * 0.35);
    ctx.bezierCurveTo(s * 0.7, -s, s * 1.25, 0, 0, s * 0.85);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawStarfall(ctx, W, H, t) {
  ctx.save();
  for (let i = 0; i < 24; i++) {
    const speed = 0.045 + rnd(i * 4.9) * 0.05;
    const y = ((rnd(i * 8.3) + t * speed) % 1) * (H + 16) - 8;
    const x = rnd(i * 2.7) * W + ((rnd(i * 6.9) + t * speed * 0.4) % 1) * W * 0.1;
    const r = H * (0.012 + rnd(i * 3.5) * 0.014);
    const tw = 0.55 + 0.45 * Math.sin(t * 4 + i * 2.1);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(t * 0.5 + i);
    ctx.fillStyle = `rgba(255,225,130,${0.75 * tw})`;
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const ang = k * 0.62832 - 1.5708;
      const rad = k % 2 ? r * 0.45 : r;
      const px = Math.cos(ang) * rad; const py = Math.sin(ang) * rad;
      if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawSunrays(ctx, W, H, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cx = W * 0.08; const cy = -H * 0.05;
  const len = Math.hypot(W, H) * 1.05;
  for (let i = 0; i < 12; i++) {
    const a = 0.25 + i * 0.145 + Math.sin(t * 0.11) * 0.05 + t * 0.008;
    const wdt = 0.055 + (i % 3) * 0.03;
    ctx.fillStyle = `rgba(255,230,170,${i % 2 ? 0.05 : 0.09})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a - wdt) * len, cy + Math.sin(a - wdt) * len);
    ctx.lineTo(cx + Math.cos(a + wdt) * len, cy + Math.sin(a + wdt) * len);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawWindowRain(ctx, W, H, t) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < 42; i++) {
    const x = rnd(i * 7.9) * W;
    const speed = 0.008 + rnd(i * 3.3) * 0.05;
    const y = ((rnd(i * 5.7) + t * speed) % 1.15) * H;
    const r = H * (0.006 + rnd(i * 9.3) * 0.009);
    const trail = r * (3 + rnd(i * 2.1) * 5);
    ctx.strokeStyle = 'rgba(190,220,250,0.35)';
    ctx.lineWidth = Math.max(1, r * 0.5);
    ctx.beginPath(); ctx.moveTo(x, y - trail); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = 'rgba(210,235,255,0.65)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.3, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}
