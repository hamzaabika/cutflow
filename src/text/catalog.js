// Text styles: templates (complete looks), bubbles, effects, animations and caption highlight modes.
// Every entry is pure data interpreted by src/text/render.js.

export const TEXT_EFFECTS = [
  { id: 'none', name: 'None' },
  { id: 'glow', name: 'Glow' },
  { id: 'neon', name: 'Neon' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'gradientH', name: 'Gradient Across' },
  { id: 'gradientMid', name: 'Gradient Middle' },
  { id: 'chrome', name: 'Chrome' },
  { id: 'fire', name: 'Fire' },
  { id: 'ice', name: 'Ice' },
  { id: 'shadow3d', name: '3D' },
  { id: 'retro', name: 'Retro' },
  { id: 'double', name: 'Double Outline' },
  { id: 'hollow', name: 'Hollow' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'soft', name: 'Soft Shadow' },
  { id: 'emboss', name: 'Emboss' },
];

export const BUBBLES = [
  { id: 'none', name: 'None' },
  { id: 'rounded', name: 'Rounded' },
  { id: 'pill', name: 'Pill' },
  { id: 'speech', name: 'Speech' },
  { id: 'thought', name: 'Thought' },
  { id: 'tag', name: 'Tag' },
  { id: 'ribbon', name: 'Ribbon' },
  { id: 'sticky', name: 'Sticky Note' },
  { id: 'frame', name: 'Frame' },
  { id: 'marker', name: 'Marker' },
  { id: 'underline', name: 'Underline' },
  { id: 'brackets', name: 'Brackets' },
];

export const ANIM_IN = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade In' },
  { id: 'pop', name: 'Pop' },
  { id: 'zoomIn', name: 'Zoom In' },
  { id: 'zoomOut', name: 'Zoom Out' },
  { id: 'slideUp', name: 'Slide Up' },
  { id: 'slideDown', name: 'Slide Down' },
  { id: 'slideLeft', name: 'Slide Left' },
  { id: 'slideRight', name: 'Slide Right' },
  { id: 'blurIn', name: 'Blur In' },
  { id: 'drop', name: 'Drop' },
  { id: 'springSettle', name: 'Spring Settle' }, // P3-06: true damped spring
  { id: 'gravityDrop', name: 'Gravity Drop' }, // P3-06: true gravity bounce
  { id: 'rotateIn', name: 'Rotate In' },
  { id: 'stretch', name: 'Stretch' },
  { id: 'flip', name: 'Flip' },
  { id: 'typewriter', name: 'Typewriter' },
  { id: 'wordPop', name: 'Word Pop' },
  { id: 'wordRise', name: 'Word Rise' },
  { id: 'wordSpin', name: 'Word Spin' },
  { id: 'waveIn', name: 'Wave In' },
  { id: 'flicker', name: 'Flicker' },
  // CC-03: the safe-flicker envelope (flickerSoft — weak uneven pulses, then
  // a smooth hold; degrades to a plain fade under Reduce Flashing), the RGB
  // split reveal (rgbGlitch), the word-by-word scan (scan) and the per-word
  // flicker (wordFlicker). Scan / wordFlicker are unit kinds the renderer
  // plays per word, never per character — Arabic shaping stays intact.
  { id: 'flickerSoft', name: 'Soft Flicker' },
  { id: 'rgbGlitch', name: 'RGB Glitch' },
  { id: 'scan', name: 'Character Scan' },
  { id: 'wordFlicker', name: 'Word Flicker' },
  { id: 'glitchIn', name: 'Glitch In' },
  { id: 'slideUpSmooth', name: 'Slide Up Smooth' },
  { id: 'slideDownSmooth', name: 'Slide Down Smooth' },
  { id: 'slideLeftSmooth', name: 'Slide Left Smooth' },
  { id: 'slideRightSmooth', name: 'Slide Right Smooth' },
  { id: 'slideUpBlur', name: 'Slide Up Blur' },
  { id: 'slideDownBlur', name: 'Slide Down Blur' },
  { id: 'slideLeftBlur', name: 'Slide Left Blur' },
  { id: 'slideRightBlur', name: 'Slide Right Blur' },
  { id: 'zoomBlur', name: 'Zoom Blur' },
  { id: 'blurPop', name: 'Blur Pop' },
  { id: 'softFade', name: 'Soft Fade' },
  { id: 'elasticPop', name: 'Elastic Pop' },
  { id: 'bounceUp', name: 'Bounce Up' },
  { id: 'flipSide', name: 'Flip Side' },
  { id: 'tiltIn', name: 'Tilt In' },
  { id: 'spinIn', name: 'Spin In' },
  { id: 'trackingIn', name: 'Tracking In' },
  { id: 'fadeUp', name: 'Fade Up' },
  { id: 'fadeDown', name: 'Fade Down' },
  { id: 'fadeLeft', name: 'Fade Left' },
  { id: 'fadeRight', name: 'Fade Right' },
  { id: 'glideUp', name: 'Glide Up' },
  { id: 'settleUp', name: 'Settle Up' },
  { id: 'scaleTrack', name: 'Scale & Tracking' },
  { id: 'growCenter', name: 'Scale From Center' },
  { id: 'slideRotate', name: 'Slide & Rotate' },
  { id: 'charSlideUp', name: 'Chars Slide Up' },
  { id: 'charSlideDown', name: 'Chars Slide Down' },
  { id: 'charFade', name: 'Fade Characters' },
  { id: 'decode', name: 'Decode' },
  { id: 'charFlicker', name: 'Flicker Characters' },
  { id: 'maskedLineReveal', name: 'Masked Line Reveal' },
  { id: 'lightSweepReveal', name: 'Light Sweep Reveal' },
];

export const ANIM_OUT = [
  { id: 'none', name: 'None' },
  { id: 'fade', name: 'Fade Out' },
  { id: 'pop', name: 'Pop Out' },
  { id: 'zoomIn', name: 'Zoom Out' },
  { id: 'zoomOut', name: 'Shrink' },
  { id: 'slideUp', name: 'Slide Up' },
  { id: 'slideDown', name: 'Slide Down' },
  { id: 'slideLeft', name: 'Slide Left' },
  { id: 'slideRight', name: 'Slide Right' },
  { id: 'blurIn', name: 'Blur Out' },
  { id: 'rotateIn', name: 'Rotate Out' },
  { id: 'stretch', name: 'Squeeze' },
  { id: 'typewriter', name: 'Erase' },
  { id: 'wordPop', name: 'Word Pop Out' },
  { id: 'wordSpin', name: 'Word Spin Out' },
  { id: 'flicker', name: 'Flicker' },
  { id: 'flickerSoft', name: 'Soft Flicker' },
  { id: 'rgbGlitch', name: 'RGB Glitch' },
  { id: 'scan', name: 'Character Scan' },
  { id: 'wordFlicker', name: 'Word Flicker' },
  { id: 'glitchIn', name: 'Glitch Out' },
  { id: 'slideUpSmooth', name: 'Slide Up Smooth' },
  { id: 'slideDownSmooth', name: 'Slide Down Smooth' },
  { id: 'slideLeftSmooth', name: 'Slide Left Smooth' },
  { id: 'slideRightSmooth', name: 'Slide Right Smooth' },
  { id: 'slideUpBlur', name: 'Slide Up Blur' },
  { id: 'slideDownBlur', name: 'Slide Down Blur' },
  { id: 'slideLeftBlur', name: 'Slide Left Blur' },
  { id: 'slideRightBlur', name: 'Slide Right Blur' },
  { id: 'zoomBlur', name: 'Zoom Blur' },
  { id: 'blurPop', name: 'Blur Pop' },
  { id: 'softFade', name: 'Soft Fade' },
  { id: 'elasticPop', name: 'Elastic Pop' },
  { id: 'bounceUp', name: 'Bounce Down' },
  { id: 'drop', name: 'Fly Up' },
  { id: 'flip', name: 'Flip Up' },
  { id: 'flipSide', name: 'Flip Side' },
  { id: 'tiltIn', name: 'Tilt Out' },
  { id: 'spinIn', name: 'Spin Out' },
  { id: 'trackingIn', name: 'Tracking Out' },
  { id: 'wordRise', name: 'Word Fall' },
  { id: 'waveIn', name: 'Letters Out' },
  { id: 'fadeUp', name: 'Fade Up' },
  { id: 'fadeDown', name: 'Fade Down' },
  { id: 'fadeLeft', name: 'Fade Left' },
  { id: 'fadeRight', name: 'Fade Right' },
  { id: 'glideUp', name: 'Glide Up' },
  { id: 'settleUp', name: 'Settle Down' },
  { id: 'scaleTrack', name: 'Tracking Scale' },
  { id: 'growCenter', name: 'Scale To Center' },
  { id: 'slideRotate', name: 'Slide & Rotate' },
  { id: 'charSlideUp', name: 'Chars Slide Up' },
  { id: 'charSlideDown', name: 'Chars Slide Down' },
  { id: 'charFade', name: 'Fade Characters' },
  { id: 'decode', name: 'Decode' },
  { id: 'charFlicker', name: 'Flicker Characters' },
  { id: 'charScatter', name: 'Character Scatter' },
];

export const ANIM_LOOP = [
  { id: 'none', name: 'None' },
  { id: 'pulse', name: 'Pulse' },
  { id: 'heartbeat', name: 'Heartbeat' },
  { id: 'float', name: 'Float' },
  { id: 'swing', name: 'Swing' },
  { id: 'shake', name: 'Shake' },
  { id: 'wave', name: 'Wave' },
  { id: 'jelly', name: 'Jelly' },
  { id: 'blink', name: 'Blink' },
  { id: 'rainbow', name: 'Rainbow' },
  { id: 'glitch', name: 'Glitch' },
  { id: 'lightsweep', name: 'Light Sweep Loop' },
  { id: 'typeOsc', name: 'Gentle Type Oscillation' },
  { id: 'tracking', name: 'Tracking' },
];

// How the spoken word is emphasised in captions (uses word timings from auto captions,
// or an even split of the clip duration for typed text).
export const HIGHLIGHTS = [
  { id: 'none', name: 'None' },
  { id: 'color', name: 'Color' },
  { id: 'box', name: 'Box' },
  { id: 'scale', name: 'Scale Up' },
  { id: 'karaoke', name: 'Word Sweep' },
  { id: 'marker', name: 'Marker' },
  { id: 'reveal', name: 'Word Reveal' },
  { id: 'single', name: 'One Word' },
  { id: 'phrase', name: 'Phrase Box' },
  { id: 'arrive', name: 'Arriving Word' },
];

const stroke = (width, color = '#000000') => ({ width, color });
const shadow = (color = '#000000', blur = 10, y = 4, opacity = 0.7) => ({ on: true, color, blur, x: 0, y, opacity });
const bg = (color = '#000000', opacity = 0.6, radius = 14, mode = 'block') => ({ on: true, color, opacity, radius, padding: 0.3, mode });
const NO_BG = { on: false };
const NO_SHADOW = { on: false };
const anim = (inId, outId = 'fade', loop = 'none') => ({ animIn: { id: inId, dur: 0.35 }, animOut: { id: outId, dur: 0.25 }, animLoop: { id: loop, speed: 1 } });

// Templates set a complete look. `caption: true` ones are tuned for auto captions.
export const TEXT_TEMPLATES = [
  // Captions
  { id: 'cap-classic', name: 'Essential', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), bg: NO_BG, effect: 'soft', bubble: 'none', highlight: { mode: 'none' }, ...anim('fade') } },
  { id: 'cap-hormozi', name: 'Impact Pop', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, color: '#ffffff', stroke: stroke(8), shadow: shadow('#000000', 0, 6, 1), bg: NO_BG, effect: 'none', bubble: 'none', highlight: { mode: 'scale', color: '#a78bfa' }, ...anim('pop', 'none') } },
  { id: 'cap-beast', name: 'Bold Stomp', cat: 'Captions', caption: true, patch: { font: 'luckiest', bold: false, uppercase: true, color: '#ffffff', stroke: stroke(10), shadow: shadow('#000000', 0, 8, 1), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#ffcf3f' }, ...anim('pop', 'none', 'none') } },
  { id: 'cap-rainbow', name: 'Rainbow Word', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), bg: NO_BG, effect: 'none', bubble: 'none', highlight: { mode: 'color', color: '#ff5252', colors: ['#ff5252', '#ff9f1c', '#4ade80', '#a78bfa', '#22d3ee'] }, ...anim('pop', 'fade') } },
  // Video 2's red emphasis line on its own: a bold italic serif in red, words
  // popping in one by one out of blur with a soft red glow. The white line it
  // answers pairs with the existing Essential (cap-classic) template.
  { id: 'cap-redpunch', name: 'Red Punch', cat: 'Captions', caption: true, patch: { font: 'playfair', bold: true, italic: true, color: '#CE0120', stroke: stroke(3), shadow: NO_SHADOW, bg: NO_BG, effect: 'glow', glowColor: '#CE0120', bubble: 'none', highlight: { mode: 'none' }, animIn: { id: 'wordPop', dur: 0.6 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'cap-karaoke', name: 'Word Sweep', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'karaoke', color: '#825cfb' }, ...anim('fade') } },
  { id: 'cap-boxed', name: 'Word Box', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 8, 2, 0.6), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'box', color: '#ffffff', bg: '#7c3aed' }, ...anim('pop', 'fade') } },
  // Video 1's centre cell on its own: white all-caps on one constant solid teal
  // block behind the whole line (a block background, not per-word boxes).
  { id: 'cap-tealblock', name: 'Teal Block', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 8, 2, 0.6), effect: 'none', bubble: 'none', bg: bg('#49A098', 1, 4, 'block'), highlight: { mode: 'none' }, ...anim('pop', 'fade') } },
  // Video 1's black-box cell on its own: same word-pop mechanism as Word Box,
  // but the box behind the active word is near-black.
  { id: 'cap-blackbox', name: 'Black Box', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 8, 2, 0.6), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'box', color: '#ffffff', bg: '#111111' }, ...anim('pop', 'fade') } },
  { id: 'cap-marker', name: 'Highlighter', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#111111', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'rounded', bubbleColor: '#ffffff', bg: NO_BG, highlight: { mode: 'marker', color: '#111111', bg: '#ffe14d' }, ...anim('pop', 'fade') } },
  { id: 'cap-oneword', name: 'One Word', cat: 'Captions', caption: true, patch: { font: 'anton', bold: false, uppercase: true, size: 110, color: '#ffffff', stroke: stroke(8), shadow: shadow('#000000', 0, 7, 1), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'single', color: '#ffd400' }, y: 0.62, ...anim('pop', 'none') } },
  { id: 'cap-reveal', name: 'Word Reveal', cat: 'Captions', caption: true, patch: { font: 'oswald', bold: true, uppercase: true, color: '#ffffff', stroke: stroke(6), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'reveal', color: '#ffffff' }, ...anim('none', 'fade') } },
  { id: 'cap-subtitle', name: 'Subtitle', cat: 'Captions', caption: true, patch: { font: 'segoe', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.65, 8, 'line'), highlight: { mode: 'none' }, ...anim('none', 'none') } },
  { id: 'cap-neon', name: 'Neon', cat: 'Captions', caption: true, patch: { font: 'righteous', bold: false, color: '#ffffff', stroke: stroke(3, '#ff2bd6'), shadow: NO_SHADOW, effect: 'neon', glowColor: '#ff2bd6', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#7df9ff' }, ...anim('flicker', 'fade') } },
  { id: 'cap-gradient', name: 'Gradient', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffd400', color2: '#ff3d81', stroke: stroke(5), shadow: shadow(), effect: 'gradient', bubble: 'none', bg: NO_BG, highlight: { mode: 'scale', color: '#ffffff' }, ...anim('pop') } },
  { id: 'cap-y2k', name: 'Y2K', cat: 'Captions', caption: true, patch: { font: 'bangers', bold: false, uppercase: true, color: '#ffffff', stroke: stroke(6, '#ff4fd8'), shadow: shadow('#4f2bff', 0, 6, 1), effect: 'chrome', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#c6ff3d' }, ...anim('pop', 'pop', 'none') } },
  { id: 'cap-minimal', name: 'Minimal', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: false, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 2, 0.8), effect: 'soft', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, ...anim('blurIn', 'fade') } },
  { id: 'cap-arabic', name: 'Arabic Bold', cat: 'Captions', caption: true, previewText: 'صُنع بواسطة Cutflow', patch: { font: 'cairo', bold: true, color: '#ffffff', stroke: stroke(6), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#ffd400' }, ...anim('pop') } },
  { id: 'cap-arabic-box', name: 'Arabic Box', cat: 'Captions', caption: true, previewText: 'صُنع بواسطة Cutflow', patch: { font: 'tajawal', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.7, 12, 'line'), highlight: { mode: 'box', color: '#111111', bg: '#ffd400' }, ...anim('fade') } },
  // Video 3 part 2's gold quote on its own: gold Arabic rising word by word, and
  // once the final phrase has fully appeared a red box lands behind the whole
  // phrase and stays (a phrase highlight, not a per-word box).
  { id: 'cap-goldquote', name: 'Gold Quote', cat: 'Captions', caption: true, previewText: 'النجاح يبدأ بخطوة والثقة تصنع الفرق', patch: { font: 'cairo', bold: true, color: '#B98531', stroke: stroke(4), shadow: shadow('#000000', 10, 2, 0.7), bg: NO_BG, effect: 'none', bubble: 'none', highlight: { mode: 'phrase', from: -3, to: -1, color: '#B98531', bg: '#CE0120' }, animIn: { id: 'wordRise', dur: 0.7 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  // Video 3 part 2's hadith on its own: same gold quote, but the final phrase
  // is four words («والناكح الذي يريد العفاف»), so the red box spans the last 4.
  { id: 'cap-spin', name: 'Spin Caption', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, size: 64, color: '#ffffff', stroke: stroke(5), shadow: shadow('#000000', 12, 3, 0.8), bg: NO_BG, effect: 'none', bubble: 'none', highlight: { mode: 'none' }, animIn: { id: 'wordSpin', dur: 0.8 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  // Neon Pop Duo: two-line caption — white Inter line 1 popping in word by
  // word with a neon blur-in and a seeded baseline float, then a red Playfair
  // italic line 2 typing in character by character. Arabic animates per word
  // on both lines (never per letter). All tokens live in src/text/duo.js
  // DEFAULT_DUO; the patch's `duo` only overrides what differs, so a variant
  // is a data clone (e.g. duo: { speed: 1.3, line2: { color: '#FFD400' } }).
  // patch.text is the tile sample AND the new clip's text (the test's
  // standard-line rule skips templates with patch.text).
  { id: 'neon-pop-duo', name: 'Neon Pop Duo', cat: 'Captions', caption: true, patch: { font: 'inter', size: 64, y: 0.6, duration: 3, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, ...anim('none', 'none'), text: 'Bezaf dyal lmgharba\nMachi Professionnel', duo: {} } },
  // Neon Pop Duo Bounce: the same preset, same tokens, same sample text —
  // only duo.bounce is on, so line-1 words DROP from above the baseline,
  // land, and bounce once — no scale pop, scale stays 1.0. Line-2 typing is
  // untouched. The original stays bounce-off, exactly as it was.
  { id: 'neon-pop-duo-bounce', name: 'Neon Pop Duo Bounce', cat: 'Captions', caption: true, patch: { font: 'inter', size: 64, y: 0.6, duration: 3, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, ...anim('none', 'none'), text: 'Bezaf dyal lmgharba\nMachi Professionnel', duo: { bounce: true } } },
  // Brand Caption Packs (P2-25): professional creator subtitles — Arabic,
  // Darija, bilingual and English. All four are word-by-word (wordPop /
  // wordRise entrances, per-word highlights) and tuned for 9:16: base y 0.78
  // sits inside the 9:16 safe zone, and the explicit responsive override pins
  // it there even if the base moves. The bilingual one is the Duo two-line
  // model — Arabic line 1 (Cairo Medium via the rtl tokens), Latin line 2
  // (Montserrat, gold); Arabic animates per word on both lines, never per letter.
  { id: 'cap-brand-ar', name: 'Brand Arabic', cat: 'Brand', caption: true, previewText: 'النجاح يبدأ بخطوة', patch: { font: 'cairo', bold: true, size: 64, y: 0.78, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#ffd400' }, animIn: { id: 'wordPop', dur: 0.6 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, responsive: { '9:16': { x: 0.5, y: 0.78 } } } },
  { id: 'cap-brand-darija', name: 'Brand Darija', cat: 'Brand', caption: true, previewText: 'هاد الفيديو غادي يعجبك', patch: { font: 'tajawal', bold: true, size: 64, y: 0.78, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'box', color: '#ffffff', bg: '#CE0120' }, animIn: { id: 'wordRise', dur: 0.7 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, responsive: { '9:16': { x: 0.5, y: 0.78 } } } },
  { id: 'cap-brand-bilingual', name: 'Brand Bilingual', cat: 'Brand', caption: true, patch: { font: 'inter', size: 64, y: 0.6, duration: 3, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, ...anim('none', 'none'), text: 'النجاح يبدأ بخطوة\nSuccess starts with a step', duo: { line1: { color: '#FFFFFF' }, line2: { font: 'montserrat', bold: true, italic: false, color: '#FFD400' } } } },
  { id: 'cap-brand-en', name: 'Brand English', cat: 'Brand', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, size: 64, y: 0.78, color: '#ffffff', stroke: stroke(6), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#ffd400' }, animIn: { id: 'wordPop', dur: 0.6 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, responsive: { '9:16': { x: 0.5, y: 0.78 } } } },
  // Titles
  { id: 'title-bold', name: 'Big Title', cat: 'Titles', patch: { font: 'anton', bold: false, uppercase: true, size: 120, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 20, 6, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('zoomOut', 'fade') } },
  { id: 'title-3d', name: '3D Pop', cat: 'Titles', patch: { font: 'luckiest', uppercase: true, size: 110, color: '#ffd400', color2: '#c2410c', stroke: stroke(5, '#3b1d00'), shadow: NO_SHADOW, effect: 'shadow3d', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('drop', 'pop', 'float') } },
  { id: 'title-retro', name: 'Retro', cat: 'Titles', patch: { font: 'righteous', uppercase: true, size: 100, color: '#ffe08a', color2: '#ff5f6d', stroke: stroke(0), shadow: NO_SHADOW, effect: 'retro', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('slideUp', 'fade') } },
  { id: 'title-fire', name: 'Fire', cat: 'Titles', patch: { font: 'bebas', size: 130, color: '#ffe66b', color2: '#ff3b0a', stroke: stroke(0), shadow: NO_SHADOW, effect: 'fire', glowColor: '#ff6a00', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('blurIn', 'fade', 'pulse') } },
  { id: 'title-ice', name: 'Ice', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 96, color: '#ffffff', color2: '#4fc3ff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'ice', glowColor: '#7fdcff', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('zoomIn', 'fade') } },
  { id: 'title-glitch', name: 'Glitch', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 110, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'glitch', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('glitchIn', 'glitchIn', 'glitch') } },
  { id: 'title-elegant', name: 'Elegant', cat: 'Titles', patch: { font: 'playfair', bold: false, italic: true, size: 96, color: '#f5e6c8', stroke: stroke(0), shadow: shadow('#000000', 18, 3, 0.6), effect: 'soft', bubble: 'none', bg: NO_BG, letterSpacing: 2, y: 0.5, ...anim('fade', 'fade') } },
  { id: 'title-hollow', name: 'Outline', cat: 'Titles', patch: { font: 'anton', uppercase: true, size: 130, color: '#ffffff', stroke: stroke(4, '#ffffff'), shadow: NO_SHADOW, effect: 'hollow', bubble: 'none', bg: NO_BG, letterSpacing: 4, y: 0.5, ...anim('stretch', 'fade') } },
  { id: 'title-neon', name: 'Neon Sign', cat: 'Titles', patch: { font: 'pacifico', size: 100, color: '#ffffff', stroke: stroke(2, '#00e5ff'), shadow: NO_SHADOW, effect: 'neon', glowColor: '#00e5ff', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('flicker', 'flicker', 'blink') } },
  { id: 'title-typewriter', name: 'Typewriter', cat: 'Titles', patch: { font: 'consolas', size: 64, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 6, 2, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  // Animation Composer §5/§9: a terminal-style scramble (decode), a per-letter cascade
  // (charSlideUp) and a per-letter flicker (charFlicker) — three distinct title motions.
  { id: 'title-decode', name: 'Decode', cat: 'Titles', patch: { font: 'consolas', size: 64, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 6, 2, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'decode', dur: 1.0 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'title-cascade', name: 'Cascade', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 3, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'charSlideUp', dur: 0.7 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  // --- Pinterest showreel (pin 849280442274636383) --------------------------------
  // Each beat is its own preset. Colours measured from the source frames (10fps,
  // ~/workspace/text-preset-video/pinterest/frames10/): the settled words are black,
  // the "grey" words in early notes were fade-in transients. Gradients run left to right.
  // Typewriter ~60-100 ms/letter, word stagger ~150-250 ms/word, exits fast blur/slide ~300 ms.
  { id: 'pin-type-violet', name: 'Violet Type', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#C22A45', color2: '#6B1ACE', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'blurIn', dur: 0.35 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-type-coral', name: 'Coral Type', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#EA7A7C', color2: '#E23C3F', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradient', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-type-magenta', name: 'Magenta Type', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#E475C0', color2: '#DC269E', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradient', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-type-smear', name: 'Violet Smear', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#4A08E5', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'slideLeftBlur', dur: 0.4 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-type-cursor', name: 'Cursor Type', cat: 'Titles', patch: { font: 'montserrat', bold: false, size: 64, color: '#1A1A1A', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 1.2 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 }, cursor: { color: '#E25AB1' } } },
  { id: 'pin-rise-gradient', name: 'Rise Gradient', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 80, color: '#1A1A1A', color2: '#B23584', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'wordRise', dur: 0.9 }, animOut: { id: 'blurIn', dur: 0.35 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-rise-large', name: 'Rise Large', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#1A1A1A', color2: '#A63592', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'wordRise', dur: 1.0 }, animOut: { id: 'blurIn', dur: 0.35 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-rise-fall', name: 'Rise and Fall', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 80, color: '#A12B3C', color2: '#5E37AF', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'wordRise', dur: 0.9 }, animOut: { id: 'wordRise', dur: 0.7 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-rise-heavy', name: 'Rise Heavy', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#1A1A1C', color2: '#9C1E93', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'wordRise', dur: 0.9 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-rise-flash', name: 'Rise Flash', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 80, color: '#1A1A1A', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'arrive', color: '#A93A7B' }, animIn: { id: 'wordRise', dur: 0.9 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-zoom-title', name: 'Zoom Title', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 120, color: '#1A1A1A', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'zoomBlur', dur: 1.0 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-slide-type', name: 'Slide Type', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 110, color: '#1A1A1A', color2: '#8A8A8C', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientH', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'slideUpBlur', dur: 0.7, unit: 'char' }, animOut: { id: 'slideLeftBlur', dur: 0.4 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'pin-slide-line', name: 'Slide Line', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 80, color: '#1A1A1A', color2: '#C52B56', stroke: stroke(0), shadow: NO_SHADOW, effect: 'gradientMid', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'slideLeftBlur', dur: 0.7 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'title-flicker', name: 'Flicker', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 3, 0.7), effect: 'glow', glowColor: '#ffffff', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'charFlicker', dur: 1.0 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'title-arabic', name: 'Arabic Title', cat: 'Titles', patch: { font: 'lalezar', size: 120, color: '#ffffff', color2: '#ffb300', stroke: stroke(0), shadow: shadow('#000000', 16, 5, 0.7), effect: 'gradient', bubble: 'none', bg: NO_BG, y: 0.5, text: 'عنوان رائع', ...anim('pop', 'fade') } },
  // Labels & social
  { id: 'label-speech', name: 'Speech', cat: 'Labels', patch: { font: 'poppins', bold: true, size: 56, color: '#111111', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'speech', bubbleColor: '#ffffff', bg: NO_BG, y: 0.3, ...anim('pop', 'pop', 'float') } },
  { id: 'label-thought', name: 'Thought', cat: 'Labels', patch: { font: 'caveat', bold: true, size: 64, color: '#222222', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'thought', bubbleColor: '#ffffff', bg: NO_BG, y: 0.3, ...anim('pop', 'fade', 'float') } },
  { id: 'label-tag', name: 'Tag', cat: 'Labels', patch: { font: 'montserrat', bold: true, uppercase: true, size: 48, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'tag', bubbleColor: '#ef4444', bg: NO_BG, x: 0.3, y: 0.2, ...anim('slideRight', 'slideLeft') } },
  { id: 'label-ribbon', name: 'Ribbon', cat: 'Labels', patch: { font: 'oswald', bold: true, uppercase: true, size: 54, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'ribbon', bubbleColor: '#2563eb', bg: NO_BG, y: 0.2, ...anim('stretch', 'fade') } },
  { id: 'label-sticky', name: 'Sticky Note', cat: 'Labels', patch: { font: 'marker', size: 52, color: '#1f2937', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'sticky', bubbleColor: '#fde047', bg: NO_BG, y: 0.35, ...anim('drop', 'fade', 'swing') } },
  { id: 'label-subscribe', name: 'Subscribe', cat: 'Labels', patch: { text: 'SUBSCRIBE', font: 'montserrat', bold: true, size: 54, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'pill', bubbleColor: '#ff0000', bg: NO_BG, y: 0.8, ...anim('pop', 'pop', 'heartbeat') } },
  { id: 'label-frame', name: 'Frame', cat: 'Labels', patch: { font: 'bebas', size: 70, letterSpacing: 6, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'frame', bubbleColor: '#ffffff', bg: NO_BG, y: 0.5, ...anim('zoomIn', 'fade') } },
  { id: 'label-brackets', name: 'Brackets', cat: 'Labels', patch: { font: 'poppins', bold: true, size: 60, color: '#ffffff', stroke: stroke(0), shadow: shadow(), effect: 'none', bubble: 'brackets', bubbleColor: '#ffd400', bg: NO_BG, y: 0.5, ...anim('stretch', 'fade') } },
  { id: 'label-comic', name: 'Comic', cat: 'Labels', patch: { font: 'bangers', uppercase: true, size: 80, color: '#ffe600', stroke: stroke(6, '#111111'), shadow: shadow('#111111', 0, 6, 1), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.4, ...anim('pop', 'pop', 'shake') } },
  // The Craft set: Cutflow's own clean geometric system — duotone violet gradients,
  // pill chips, accent rules and quiet sans type. (Ids keep their original mat- prefix:
  // saved projects and bundled template packages reference them.)
  { id: 'mat-duo-title', name: 'Violet Duo', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 104, color: '#ffffff', color2: '#825cfb', stroke: stroke(0), shadow: shadow('#000000', 16, 5, 0.65), effect: 'gradient', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('slideUpSmooth', 'fade') } },
  { id: 'mat-pill-label', name: 'Craft Pill', cat: 'Labels', patch: { font: 'poppins', bold: true, size: 52, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'pill', bubbleColor: '#6d28e0', bg: NO_BG, y: 0.24, ...anim('pop', 'fade') } },
  { id: 'mat-accent-bar', name: 'Accent Rule', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 84, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 12, 4, 0.6), effect: 'none', bubble: 'underline', bubbleColor: '#825cfb', bg: NO_BG, y: 0.5, ...anim('slideRight', 'fade') } },
  { id: 'mat-caption-chip', name: 'Craft Chip', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#16161f', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'rounded', bubbleColor: '#ffffff', bg: NO_BG, highlight: { mode: 'color', color: '#6d28e0' }, ...anim('pop', 'fade') } },
  { id: 'mat-quote', name: 'Soft Quote', cat: 'Titles', patch: { font: 'poppins', bold: false, size: 72, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 3, 0.7), effect: 'soft', bubble: 'none', bg: NO_BG, letterSpacing: 1, y: 0.5, ...anim('fade', 'fade') } },
  { id: 'mat-lower-third', name: 'Violet Third', cat: 'Labels', patch: { font: 'montserrat', bold: true, size: 60, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#6d28e0', 0.92, 10, 'line'), x: 0.3, y: 0.8, ...anim('slideRight', 'fade') } },
  { id: 'mat-big-number', name: 'Big Violet', cat: 'Titles', patch: { font: 'anton', uppercase: true, size: 150, color: '#a78bfa', stroke: stroke(0), shadow: shadow('#000000', 18, 6, 0.6), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('zoomIn', 'fade') } },
  { id: 'mat-minimal', name: 'Air Sans', cat: 'Titles', patch: { font: 'poppins', bold: false, uppercase: true, size: 66, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 2, 0.55), effect: 'none', bubble: 'none', bg: NO_BG, letterSpacing: 6, y: 0.5, ...anim('blurIn', 'fade') } },
  { id: 'mat-duo-caption', name: 'Duo Pop', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, uppercase: true, color: '#ffffff', color2: '#825cfb', stroke: stroke(4), shadow: shadow(), effect: 'gradient', bubble: 'none', bg: NO_BG, highlight: { mode: 'scale', color: '#ffd54a' }, ...anim('pop', 'fade') } },
  { id: 'mat-chip-dark', name: 'Night Chip', cat: 'Labels', patch: { font: 'bebas', size: 58, letterSpacing: 2, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'pill', bubbleColor: '#16161f', bg: NO_BG, y: 0.3, ...anim('pop', 'pop') } },
  { id: 'mat-headline-bar', name: 'Headline Block', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 86, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#111118', 0.88, 8, 'block'), y: 0.5, ...anim('slideUpSmooth', 'fade') } },
  { id: 'mat-caption-clean', name: 'Clean Line', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.55, 12, 'line'), highlight: { mode: 'none' }, ...anim('fade', 'fade') } },
  // The Motion set (W3): complete templates built on the slide family of the animation
  // engine — each pairs its typography with the slide it is named for, at a duration
  // that lets the move read (0.5–0.7 s instead of the snappy default 0.35 s).
  { id: 'mot-slide-up', name: 'Slide Up', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 16, 5, 0.65), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'slideUp', dur: 0.5 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-smooth-slide', name: 'Smooth Slide', cat: 'Titles', patch: { font: 'poppins', bold: true, size: 92, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 4, 0.6), effect: 'soft', bubble: 'underline', bubbleColor: '#825cfb', bg: NO_BG, y: 0.5, animIn: { id: 'slideUpSmooth', dur: 0.65 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-slide-down', name: 'Slide Down', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 100, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'slideDown', dur: 0.5 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-smooth-left', name: 'Smooth Left', cat: 'Titles', patch: { font: 'bebas', size: 104, letterSpacing: 2, color: '#ffffff', stroke: stroke(0), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, x: 0.32, y: 0.5, animIn: { id: 'slideLeftSmooth', dur: 0.6 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-smooth-right', name: 'Smooth Right', cat: 'Titles', patch: { font: 'bebas', size: 104, letterSpacing: 2, color: '#ffffff', stroke: stroke(0), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, x: 0.68, y: 0.5, animIn: { id: 'slideRightSmooth', dur: 0.6 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-rise-fade', name: 'Rise & Fade', cat: 'Titles', patch: { font: 'poppins', bold: false, size: 84, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 3, 0.7), effect: 'soft', bubble: 'none', bg: NO_BG, letterSpacing: 1, y: 0.5, animIn: { id: 'fadeUp', dur: 0.7 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'mot-slide-blur', name: 'Slide Blur', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 96, color: '#ffffff', color2: '#a78bfa', stroke: stroke(0), shadow: shadow(), effect: 'gradient', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'slideUpBlur', dur: 0.6 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  // The Studio set (Sprint 12): Cutflow's teal-and-ink system — deep teal chips,
  // ink-dark blocks and one warm amber accent. Original patches on the same
  // template engine; nothing here mirrors another product's caption styles.
  { id: 'stu-teal-chip', name: 'Teal Chip', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'rounded', bubbleColor: '#0f766e', bg: NO_BG, highlight: { mode: 'color', color: '#fbbf24' }, ...anim('pop', 'fade') } },
  { id: 'stu-ink-line', name: 'Ink Line', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#101418', 0.82, 10, 'line'), highlight: { mode: 'box', color: '#101418', bg: '#5eead4' }, ...anim('fade', 'fade') } },
  { id: 'stu-teal-title', name: 'Teal Title', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 102, color: '#ffffff', color2: '#2dd4bf', stroke: stroke(0), shadow: shadow('#000000', 16, 5, 0.65), effect: 'gradient', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('slideUpSmooth', 'fade') } },
  { id: 'stu-amber-rule', name: 'Amber Rule', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 88, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 12, 4, 0.6), effect: 'none', bubble: 'underline', bubbleColor: '#f59e0b', bg: NO_BG, y: 0.5, ...anim('slideRight', 'fade') } },
  { id: 'stu-name-third', name: 'Studio Third', cat: 'Labels', patch: { font: 'poppins', bold: true, size: 58, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#0f766e', 0.94, 10, 'line'), x: 0.3, y: 0.8, ...anim('slideRight', 'fade') } },
  { id: 'stu-tag-amber', name: 'Amber Tag', cat: 'Labels', patch: { font: 'montserrat', bold: true, uppercase: true, size: 48, color: '#101418', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'tag', bubbleColor: '#fbbf24', bg: NO_BG, x: 0.3, y: 0.2, ...anim('slideRight', 'slideLeft') } },
  // The Noir set (10/10 step 3): editorial black-and-white — serif headlines, mono labels,
  // hard white chips on ink. An original identity on the same template engine.
  { id: 'noir-headline', name: 'Noir Headline', cat: 'Titles', patch: { font: 'playfair', bold: false, size: 108, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 16, 4, 0.65), effect: 'none', bubble: 'none', bg: NO_BG, letterSpacing: 1, y: 0.5, ...anim('trackingIn', 'fade') } },
  { id: 'noir-mono', name: 'Noir Mono', cat: 'Labels', patch: { font: 'consolas', bold: false, uppercase: true, size: 44, color: '#f5f5f5', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.85, 4), letterSpacing: 6, x: 0.28, y: 0.16, ...anim('fade', 'fade') } },
  { id: 'noir-caption', name: 'Noir Caption', cat: 'Captions', caption: true, patch: { font: 'playfair', bold: false, italic: true, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 2, 0.75), effect: 'soft', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#d4d4d4' }, ...anim('fade', 'fade') } },
  { id: 'noir-quote', name: 'Noir Quote', cat: 'Titles', patch: { font: 'playfair', bold: false, italic: true, size: 84, color: '#e8e8e8', stroke: stroke(0), shadow: shadow('#000000', 12, 3, 0.6), effect: 'none', bubble: 'frame', bubbleColor: '#ffffff', bg: NO_BG, y: 0.5, ...anim('fadeUp', 'fade') } },
  { id: 'noir-stamp', name: 'Noir Stamp', cat: 'Labels', patch: { font: 'oswald', bold: true, uppercase: true, size: 52, color: '#111111', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'tag', bubbleColor: '#ffffff', bg: NO_BG, x: 0.72, y: 0.16, ...anim('pop', 'fade') } },
  { id: 'noir-rule', name: 'Noir Rule', cat: 'Titles', patch: { font: 'montserrat', bold: true, uppercase: true, size: 92, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 4, 0.6), effect: 'none', bubble: 'underline', bubbleColor: '#ffffff', bg: NO_BG, letterSpacing: 8, y: 0.5, ...anim('trackingIn', 'fade') } },
  { id: 'noir-type', name: 'Noir Type', cat: 'Titles', patch: { font: 'consolas', bold: false, size: 72, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.7, 6, 'line'), y: 0.5, animIn: { id: 'typewriter', dur: 1.1 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'noir-line', name: 'Noir Line', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.8, 4, 'line'), highlight: { mode: 'box', color: '#000000', bg: '#ffffff' }, ...anim('fade', 'fade') } },
  // The Zest set (10/10 step 3): warm citrus — amber and orange rounded chips, cream serif
  // quotes, hard-shadow display type. Original patches, nothing recoloured from other sets.
  { id: 'zest-pop', name: 'Zest Pop', cat: 'Titles', patch: { font: 'bangers', bold: false, size: 118, color: '#ffb020', color2: '#ff7847', stroke: stroke(4, '#7c2d12'), shadow: shadow('#431407', 0, 7, 0.9), effect: 'gradient', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('elasticPop', 'fade') } },
  { id: 'zest-chip', name: 'Zest Chip', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#1a1207', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'rounded', bubbleColor: '#ffb020', bg: NO_BG, highlight: { mode: 'color', color: '#ff7847' }, ...anim('pop', 'fade') } },
  { id: 'zest-tag', name: 'Zest Tag', cat: 'Labels', patch: { font: 'montserrat', bold: true, uppercase: true, size: 46, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'tag', bubbleColor: '#f97316', bg: NO_BG, x: 0.3, y: 0.2, ...anim('slideRight', 'fade') } },
  { id: 'zest-title', name: 'Citrus Title', cat: 'Titles', patch: { font: 'luckiest', bold: false, uppercase: true, size: 104, color: '#fef08a', stroke: stroke(6, '#9a3412'), shadow: shadow('#431407', 0, 8, 1), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('bounceUp', 'fade') } },
  { id: 'zest-third', name: 'Zest Third', cat: 'Labels', patch: { font: 'poppins', bold: true, size: 56, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#ea580c', 0.95, 10, 'line'), x: 0.3, y: 0.8, ...anim('slideRight', 'fade') } },
  { id: 'zest-word', name: 'Zest Word', cat: 'Captions', caption: true, patch: { font: 'anton', bold: false, uppercase: true, color: '#ffffff', stroke: stroke(7, '#7c2d12'), shadow: shadow('#431407', 0, 5, 0.9), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'scale', color: '#ffb020' }, ...anim('pop', 'none') } },
  { id: 'zest-quote', name: 'Zest Quote', cat: 'Titles', patch: { font: 'caveat', bold: false, size: 96, color: '#ffedd5', stroke: stroke(0), shadow: shadow('#000000', 12, 3, 0.65), effect: 'soft', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('fadeUp', 'fade') } },
  { id: 'zest-marker', name: 'Zest Marker', cat: 'Labels', patch: { font: 'marker', bold: false, size: 64, color: '#111111', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'marker', bubbleColor: '#fde047', bg: NO_BG, x: 0.5, y: 0.24, ...anim('pop', 'pop', 'float') } },
  // The Slate set (10/10 step 3): cool grey-blue minimal — wide tracking, thin weights,
  // steel chips and one sky accent. Built for quiet, technical videos.
  { id: 'slate-title', name: 'Slate Title', cat: 'Titles', patch: { font: 'montserrat', bold: false, uppercase: true, size: 96, color: '#e2e8f0', color2: '#7dd3fc', stroke: stroke(0), shadow: shadow('#020617', 14, 4, 0.7), effect: 'gradient', bubble: 'none', bg: NO_BG, letterSpacing: 6, y: 0.5, ...anim('slideUpSmooth', 'fade') } },
  { id: 'slate-chip', name: 'Slate Chip', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#0f172a', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'pill', bubbleColor: '#cbd5e1', bg: NO_BG, highlight: { mode: 'color', color: '#38bdf8' }, ...anim('fade', 'fade') } },
  { id: 'slate-label', name: 'Slate Label', cat: 'Labels', patch: { font: 'montserrat', bold: true, uppercase: true, size: 42, color: '#f1f5f9', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#334155', 0.9, 6), letterSpacing: 5, x: 0.26, y: 0.14, ...anim('slideDown', 'fade') } },
  { id: 'slate-third', name: 'Slate Third', cat: 'Labels', patch: { font: 'poppins', bold: false, size: 54, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#475569', 0.92, 8, 'line'), x: 0.3, y: 0.82, ...anim('slideRightSmooth', 'fade') } },
  { id: 'slate-ghost', name: 'Slate Ghost', cat: 'Titles', patch: { font: 'anton', bold: false, uppercase: true, size: 120, color: '#ffffff', stroke: stroke(3, '#94a3b8'), shadow: NO_SHADOW, effect: 'hollow', bubble: 'none', bg: NO_BG, letterSpacing: 3, y: 0.5, ...anim('blurIn', 'fade') } },
  { id: 'slate-caption', name: 'Slate Caption', cat: 'Captions', caption: true, patch: { font: 'segoe', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#0f172a', 0.72, 6, 'line'), highlight: { mode: 'none' }, ...anim('fade', 'fade') } },
  { id: 'slate-quote', name: 'Slate Quote', cat: 'Titles', patch: { font: 'playfair', bold: false, italic: true, size: 88, color: '#e0f2fe', stroke: stroke(0), shadow: shadow('#020617', 12, 3, 0.65), effect: 'soft', bubble: 'none', bg: NO_BG, y: 0.5, ...anim('fade', 'fade') } },
  { id: 'slate-num', name: 'Slate Number', cat: 'Labels', patch: { font: 'oswald', bold: true, size: 84, color: '#7dd3fc', stroke: stroke(0), shadow: shadow('#020617', 10, 3, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, x: 0.5, y: 0.3, ...anim('zoomIn', 'fade') } },
  // Six more caption styles (10/10 step 3) — the Captions shelf's own range: typed, bounced,
  // framed, glowing, Arabic neon and a news lower-third.
  { id: 'cap-type', name: 'Type On', cat: 'Captions', caption: true, patch: { font: 'consolas', bold: false, color: '#ffffff', stroke: stroke(4), shadow: shadow('#000000', 8, 2, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'typewriter', dur: 0.9 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'cap-bounce', name: 'Bounce Word', cat: 'Captions', caption: true, patch: { font: 'bangers', bold: false, uppercase: true, color: '#ffffff', stroke: stroke(7), shadow: shadow('#000000', 0, 6, 1), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'scale', color: '#4ade80' }, ...anim('bounceUp', 'none') } },
  { id: 'cap-frame', name: 'Frame Line', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'frame', bubbleColor: '#ffffff', bg: NO_BG, highlight: { mode: 'color', color: '#facc15' }, ...anim('fade', 'fade') } },
  { id: 'cap-glowsoft', name: 'Soft Glow', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffffff', stroke: stroke(2, '#4c1d95'), shadow: NO_SHADOW, effect: 'glow', glowColor: '#825cfb', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#c4b5fd' }, ...anim('blurIn', 'fade') } },
  { id: 'cap-arabic-glow', name: 'Arabic Glow', cat: 'Captions', caption: true, previewText: 'صُنع بواسطة Cutflow', patch: { font: 'cairo', bold: true, color: '#ffffff', stroke: stroke(3, '#0e7490'), shadow: NO_SHADOW, effect: 'neon', glowColor: '#22d3ee', bubble: 'none', bg: NO_BG, highlight: { mode: 'color', color: '#fde047' }, ...anim('pop', 'fade') } },
  { id: 'cap-news', name: 'News Lower', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#b91c1c', 0.92, 4, 'line'), highlight: { mode: 'box', color: '#ffffff', bg: '#111827' }, ...anim('slideRight', 'fade') } },
  // --- CC-03: flicker / decode / scan presets (flk-) --------------------------------
  // All thirteen reuse the text layer model (animIn/animOut/animLoop + the
  // existing engines): the safe-flicker envelope (flickerSoft), decode,
  // the RGB split (rgbGlitch), the word scan and the per-word flicker.
  // Character motion is word-level for Arabic — the renderer never splits
  // joined script into characters (see src/text/render.js + flicker.js).
  { id: 'flk-soft-neon', name: 'Soft Neon Flicker', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'neon', glowColor: '#22d3ee', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'flickerSoft', dur: 1.2 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-startup-neon', name: 'Startup Neon', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'neon', glowColor: '#ff2bd6', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'flickerSoft', dur: 1.6 }, animOut: { id: 'fade', dur: 0.4 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-flicker-reveal', name: 'Flicker Reveal', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 110, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'flickerSoft', dur: 1.0 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-flicker-out', name: 'Flicker Out', cat: 'Titles', patch: { font: 'anton', bold: false, uppercase: true, size: 120, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 20, 6, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'fade', dur: 0.3 }, animOut: { id: 'flickerSoft', dur: 0.9 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-digital-decode', name: 'Digital Decode', cat: 'Titles', patch: { font: 'consolas', size: 64, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 6, 2, 0.8), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'decode', dur: 1.2 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-terminal-resolve', name: 'Terminal Resolve', cat: 'Titles', patch: { font: 'consolas', size: 64, color: '#4ade80', stroke: stroke(0), shadow: shadow('#000000', 6, 2, 0.8), effect: 'none', bubble: 'none', bg: bg('#000000', 0.65, 8, 'line'), y: 0.5, animIn: { id: 'decode', dur: 1.4 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-signal-error', name: 'Signal Error', cat: 'Titles', patch: { font: 'consolas', bold: true, size: 72, color: '#ff5a5a', stroke: stroke(0), shadow: shadow('#000000', 6, 2, 0.8), effect: 'glitch', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'rgbGlitch', dur: 0.9 }, animOut: { id: 'glitchIn', dur: 0.4 }, animLoop: { id: 'glitch', speed: 1 } } },
  { id: 'flk-rgb-glitch', name: 'RGB Glitch Reveal', cat: 'Titles', patch: { font: 'oswald', bold: true, uppercase: true, size: 110, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'glitch', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'rgbGlitch', dur: 0.8 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-char-scan', name: 'Character Scan', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 3, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'scan', dur: 1.0 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-word-flicker', name: 'Word Flicker', cat: 'Captions', caption: true, patch: { font: 'montserrat', bold: true, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, highlight: { mode: 'none' }, animIn: { id: 'wordFlicker', dur: 0.9 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-electric-subtitle', name: 'Electric Subtitle', cat: 'Captions', caption: true, patch: { font: 'poppins', bold: true, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: bg('#000000', 0.65, 8, 'line'), highlight: { mode: 'box', color: '#ffffff', bg: '#2563eb' }, animIn: { id: 'flickerSoft', dur: 0.7 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 } } },
  { id: 'flk-gentle-pulse', name: 'Gentle Pulse', cat: 'Titles', patch: { font: 'poppins', bold: true, size: 88, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 14, 3, 0.7), effect: 'soft', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'softFade', dur: 0.6 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'pulse', speed: 0.5 } } },
  { id: 'flk-slow-neon', name: 'Slow Staggered Neon', cat: 'Titles', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'neon', glowColor: '#c084fc', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'flickerSoft', dur: 1.8, unit: 'word' }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 } } },
  // --- CC-06: animated graphics (gfx-) --------------------------------------------
  // Each carries a `graphic` spec (see src/text/graphic.js) drawn by
  // drawGraphicClip in render.js — the duo pattern, not a second system.
  // The clip text stays editable: the number counts to the value in the
  // text, the timer counts down from the duration in the text, the ring's
  // label is the text, and the rest render the text itself. No audio ships
  // with a graphic — a user-supplied SFX goes on the audio track instead.
  { id: 'gfx-minimal-title', name: 'Minimal Title', cat: 'Graphics', patch: { font: 'poppins', bold: false, uppercase: true, size: 72, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 2, 0.55), effect: 'none', bubble: 'none', bg: NO_BG, letterSpacing: 6, y: 0.5, animIn: { id: 'fadeUp', dur: 0.7 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 }, graphic: { kind: 'title', rule: true, ruleColor: '#ffffff' } } },
  { id: 'gfx-editorial-third', name: 'Editorial Lower Third', cat: 'Graphics', patch: { font: 'poppins', bold: true, size: 58, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, x: 0.3, y: 0.8, animIn: { id: 'slideRightSmooth', dur: 0.7 }, animOut: { id: 'fade', dur: 0.3 }, animLoop: { id: 'none', speed: 1 }, text: 'Your Name\nYour Role', graphic: { kind: 'lowerThird', accent: '#CE0120' } } },
  { id: 'gfx-rounded-label', name: 'Rounded Label', cat: 'Graphics', patch: { font: 'poppins', bold: true, size: 56, color: '#111111', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, y: 0.3, animIn: { id: 'pop', dur: 0.5 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, graphic: { kind: 'label', shape: 'rounded', fill: '#ffffff' } } },
  { id: 'gfx-outline-label', name: 'Outline Label', cat: 'Graphics', patch: { font: 'anton', bold: false, uppercase: true, size: 84, color: '#ffffff', stroke: stroke(4, '#ffffff'), shadow: NO_SHADOW, effect: 'hollow', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'zoomIn', dur: 0.5 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, graphic: { kind: 'label', shape: 'outline', frame: '#ffffff' } } },
  { id: 'gfx-callout-arrow', name: 'Callout Arrow', cat: 'Graphics', patch: { font: 'poppins', bold: true, size: 54, color: '#ffffff', stroke: stroke(5), shadow: shadow(), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.3, animIn: { id: 'fadeUp', dur: 0.6 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, text: 'Look here', graphic: { kind: 'callout', color: '#ffd400', arrow: { dx: 0.16, dy: 0.24 } } } },
  { id: 'gfx-kinetic-number', name: 'Kinetic Number', cat: 'Graphics', patch: { font: 'anton', bold: false, size: 150, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 18, 6, 0.6), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'fade', dur: 0.3 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, text: '1,250', graphic: { kind: 'number', from: 0, decimals: 0, prefix: '', suffix: '' } } },
  { id: 'gfx-progress-ring', name: 'Progress Ring', cat: 'Graphics', patch: { font: 'montserrat', bold: true, size: 64, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 2, 0.55), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'fade', dur: 0.3 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, text: 'Progress', graphic: { kind: 'ring', color: '#825cfb', track: 'rgba(255,255,255,0.25)' } } },
  { id: 'gfx-timer-countdown', name: 'Timer Countdown', cat: 'Graphics', patch: { font: 'consolas', bold: true, size: 110, color: '#ffffff', stroke: stroke(0), shadow: shadow('#000000', 10, 3, 0.7), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'fade', dur: 0.3 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, text: '0:10', graphic: { kind: 'timer', seconds: 10 } } },
  { id: 'gfx-text-box-pop', name: 'Text Box Pop', cat: 'Graphics', patch: { font: 'montserrat', bold: true, size: 72, color: '#ffffff', stroke: stroke(0), shadow: NO_SHADOW, effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'pop', dur: 0.5 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, graphic: { kind: 'boxpop', fill: '#111118', radius: 16 } } },
  { id: 'gfx-two-line-scale', name: 'Two-Line Scale Reveal', cat: 'Graphics', patch: { font: 'montserrat', bold: true, size: 96, color: '#ffffff', color2: '#ffd400', stroke: stroke(0), shadow: shadow('#000000', 14, 4, 0.6), effect: 'none', bubble: 'none', bg: NO_BG, y: 0.5, animIn: { id: 'fade', dur: 0.4 }, animOut: { id: 'fade', dur: 0.25 }, animLoop: { id: 'none', speed: 1 }, text: 'Big ideas\nSmall steps', graphic: { kind: 'twoline', line2Scale: 0.72 } } },
];


// Browsing rows for the Templates panel. A template can live in several rows.
const TAGS = {
  Trending: ['cap-hormozi', 'cap-beast', 'cap-karaoke', 'cap-boxed', 'cap-oneword', 'cap-y2k', 'title-3d', 'label-subscribe'],
  Basics: ['cap-classic', 'cap-subtitle', 'cap-minimal', 'title-bold', 'title-elegant', 'title-typewriter'],
  Word: ['cap-karaoke', 'cap-boxed', 'cap-tealblock', 'cap-blackbox', 'cap-marker', 'cap-oneword', 'cap-reveal', 'cap-hormozi', 'cap-beast', 'cap-rainbow', 'cap-redpunch', 'cap-spin', 'neon-pop-duo', 'neon-pop-duo-bounce', 'pin-type-violet', 'pin-type-coral', 'pin-type-magenta', 'pin-type-smear', 'pin-type-cursor', 'pin-rise-gradient', 'pin-rise-large', 'pin-rise-fall', 'pin-rise-heavy', 'pin-rise-flash', 'pin-zoom-title', 'pin-slide-type', 'pin-slide-line'],
  Pinterest: ['pin-type-violet', 'pin-type-coral', 'pin-type-magenta', 'pin-type-smear', 'pin-type-cursor', 'pin-rise-gradient', 'pin-rise-large', 'pin-rise-fall', 'pin-rise-heavy', 'pin-rise-flash', 'pin-zoom-title', 'pin-slide-type', 'pin-slide-line'],
  Glow: ['cap-neon', 'cap-gradient', 'neon-pop-duo', 'neon-pop-duo-bounce', 'title-fire', 'title-ice', 'title-neon', 'title-glitch'],
  Flicker: ['flk-soft-neon', 'flk-startup-neon', 'flk-flicker-reveal', 'flk-flicker-out', 'flk-digital-decode', 'flk-terminal-resolve', 'flk-signal-error', 'flk-rgb-glitch', 'flk-char-scan', 'flk-word-flicker', 'flk-electric-subtitle', 'flk-gentle-pulse', 'flk-slow-neon'],
  Graphics: ['gfx-minimal-title', 'gfx-editorial-third', 'gfx-rounded-label', 'gfx-outline-label', 'gfx-callout-arrow', 'gfx-kinetic-number', 'gfx-progress-ring', 'gfx-timer-countdown', 'gfx-text-box-pop', 'gfx-two-line-scale'],
  Arabic: ['cap-arabic', 'cap-arabic-box', 'title-arabic', 'cap-arabic-glow', 'cap-goldquote', 'cap-brand-ar', 'cap-brand-darija', 'cap-brand-bilingual'],
  Craft: ['mat-duo-title', 'mat-pill-label', 'mat-accent-bar', 'mat-caption-chip', 'mat-quote', 'mat-lower-third', 'mat-big-number', 'mat-minimal', 'mat-duo-caption', 'mat-chip-dark', 'mat-headline-bar', 'mat-caption-clean'],
  Motion: ['mot-slide-up', 'mot-smooth-slide', 'mot-slide-down', 'mot-smooth-left', 'mot-smooth-right', 'mot-rise-fade', 'mot-slide-blur', 'title-retro', 'mat-duo-title', 'mat-headline-bar'],
  Studio: ['stu-teal-chip', 'stu-ink-line', 'stu-teal-title', 'stu-amber-rule', 'stu-name-third', 'stu-tag-amber'],
  Noir: ['noir-headline', 'noir-mono', 'noir-caption', 'noir-quote', 'noir-stamp', 'noir-rule', 'noir-type', 'noir-line'],
  Zest: ['zest-pop', 'zest-chip', 'zest-tag', 'zest-title', 'zest-third', 'zest-word', 'zest-quote', 'zest-marker'],
  Slate: ['slate-title', 'slate-chip', 'slate-label', 'slate-third', 'slate-ghost', 'slate-caption', 'slate-quote', 'slate-num'],
};
TEXT_TEMPLATES.forEach((t) => {
  t.tags = [t.cat, ...Object.keys(TAGS).filter((k) => TAGS[k].includes(t.id))];
});

export const TEMPLATE_CATEGORIES = ['All', 'Favorites', 'Trending', 'Craft', 'Studio', 'Noir', 'Zest', 'Slate', 'Motion', 'Basics', 'Word', 'Glow', 'Flicker', 'Graphics', 'Captions', 'Brand', 'Titles', 'Labels', 'Arabic'];

