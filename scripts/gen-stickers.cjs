// Generates Cutflow's bundled sticker set (shared/stickers/*.png) and the renderer
// registry (src/stickers.js) — 10/10 step 3.
//
// Every sticker is original art drawn for Cutflow by this script (Python PIL):
// flat shapes, thick ink outlines, one bright palette — badges, arrows, shapes,
// frames, social marks and word seals in a single drawing style. No downloaded
// art, no traced assets. Re-running reproduces the same set.
// Usage: node scripts/gen-stickers.cjs
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shared', 'stickers');
const REGISTRY = path.join(ROOT, 'src', 'stickers.js');
const PY = path.join(__dirname, '.gen-stickers.py');

const DRAW_SRC = String.raw`
import json, math, sys
from PIL import Image, ImageDraw, ImageFont

INK = (31, 36, 48, 255)
WHITE = (255, 255, 255, 255)
VIOLET = (130, 92, 251, 255)
CORAL = (249, 112, 102, 255)
AMBER = (245, 158, 11, 255)
TEAL = (20, 184, 166, 255)
SKY = (56, 189, 248, 255)
PINK = (236, 72, 153, 255)
LIME = (132, 204, 22, 255)
GOLD = (250, 204, 21, 255)
RED = (239, 68, 68, 255)
GREEN = (34, 197, 94, 255)
SLATE = (100, 116, 139, 255)
CREAM = (255, 244, 214, 255)
S = 480

def canvas():
    return Image.new('RGBA', (S, S), (0, 0, 0, 0))

def star_pts(cx, cy, r_out, r_in, n, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def heart_pts(cx, cy, w, h):
    pts = []
    for t in range(0, 101):
        th = math.pi * 2 * t / 100
        x = 16 * math.sin(th) ** 3
        y = 13 * math.cos(th) - 5 * math.cos(2 * th) - 2 * math.cos(3 * th) - math.cos(4 * th)
        pts.append((cx + x * w / 34, cy - y * h / 34))
    return pts

def font(size):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)

def text_center(d, cx, cy, s, fnt, fill, stroke=10, stroke_fill=INK):
    d.text((cx, cy), s, font=fnt, fill=fill, anchor='mm', stroke_width=stroke, stroke_fill=stroke_fill)

def badge_star(d):
    d.polygon(star_pts(240, 230, 185, 118, 12), fill=AMBER, outline=INK, width=14)

def badge_seal(d):
    d.ellipse([70, 60, 410, 400], fill=VIOLET, outline=INK, width=14)
    d.ellipse([112, 102, 368, 358], outline=WHITE, width=10)
    d.polygon(star_pts(240, 230, 92, 38, 5), fill=WHITE)

def badge_ribbon(d):
    d.polygon([(168, 300), (216, 470), (264, 396), (312, 470), (328, 292)], fill=SKY, outline=INK, width=10)
    d.ellipse([105, 55, 375, 325], fill=CORAL, outline=INK, width=14)
    d.ellipse([140, 90, 340, 290], outline=WHITE, width=9)
    d.polygon(star_pts(240, 190, 62, 26, 5), fill=WHITE)

def badge_shield(d):
    d.polygon([(240, 40), (390, 90), (390, 250), (240, 445), (90, 250), (90, 90)], fill=SKY, outline=INK, width=14)
    d.line([(175, 245), (225, 300), (315, 185)], fill=WHITE, width=34, joint='curve')

def badge_burst_pink(d):
    d.polygon(star_pts(240, 240, 195, 140, 16), fill=PINK, outline=INK, width=12)

def badge_hex(d):
    pts = [(240 + 165 * math.cos(math.pi / 6 + i * math.pi / 3), 240 + 165 * math.sin(math.pi / 6 + i * math.pi / 3)) for i in range(6)]
    d.polygon(pts, fill=TEAL, outline=INK, width=14)
    d.polygon([(258, 130), (180, 268), (232, 268), (208, 352), (300, 205), (244, 205)], fill=GOLD, outline=INK, width=8)

def badge_medal(d):
    d.polygon([(185, 20), (240, 130), (295, 20), (330, 20), (268, 165), (212, 165), (150, 20)], fill=CORAL, outline=INK, width=9)
    d.ellipse([110, 140, 370, 400], fill=GOLD, outline=INK, width=14)
    d.ellipse([140, 170, 340, 370], outline=(180, 120, 10, 255), width=8)
    d.polygon(star_pts(240, 270, 68, 28, 5), fill=WHITE, outline=INK, width=6)

def badge_tag(img):
    tag = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    td = ImageDraw.Draw(tag)
    td.rounded_rectangle([110, 150, 420, 330], radius=36, fill=LIME, outline=INK, width=13)
    td.ellipse([142, 208, 190, 256], fill=WHITE, outline=INK, width=9)
    img.alpha_composite(tag.rotate(24, resample=Image.BICUBIC, center=(240, 240)))
    return img

def badge_crown(d):
    d.polygon([(90, 350), (70, 160), (165, 245), (240, 110), (315, 245), (410, 160), (390, 350)], fill=GOLD, outline=INK, width=14)
    d.rectangle([90, 350, 390, 392], fill=GOLD, outline=INK, width=12)
    for cx in (110, 240, 370):
        d.ellipse([cx - 17, 118, cx + 17, 152], fill=CORAL, outline=INK, width=7)

def badge_bolt(d):
    d.ellipse([75, 75, 405, 405], fill=INK)
    d.ellipse([75, 75, 405, 405], outline=AMBER, width=10)
    d.polygon([(262, 105), (160, 272), (222, 272), (196, 380), (330, 200), (262, 200)], fill=AMBER)

def arrow_block(d, pts, color):
    d.polygon(pts, fill=color, outline=INK, width=13)

def arrow_right(d):
    arrow_block(d, [(60, 185), (265, 185), (265, 110), (425, 240), (265, 370), (265, 295), (60, 295)], CORAL)

def arrow_up(d):
    arrow_block(d, [(185, 420), (185, 215), (110, 215), (240, 55), (370, 215), (295, 215), (295, 420)], PINK)

def arrow_down(d):
    arrow_block(d, [(185, 60), (185, 265), (110, 265), (240, 425), (370, 265), (295, 265), (295, 60)], SKY)

def arrow_curved(d):
    d.arc([80, 90, 420, 430], start=300, end=165, fill=TEAL, width=44)
    d.polygon([(88, 168), (168, 96), (196, 200)], fill=TEAL, outline=INK, width=10)

def arrow_loop(d):
    d.arc([95, 95, 385, 385], start=40, end=330, fill=VIOLET, width=40)
    d.polygon([(330, 62), (398, 138), (296, 148)], fill=VIOLET, outline=INK, width=10)

def arrow_zigzag(d):
    d.line([(55, 350), (185, 350), (255, 200), (330, 200)], fill=LIME, width=46, joint='curve')
    d.polygon([(308, 128), (420, 188), (330, 262)], fill=LIME, outline=INK, width=10)

def arrow_double(d):
    for off in (0, 95):
        d.polygon([(90 + off, 130), (245 + off, 240), (90 + off, 350), (90 + off, 268), (160 + off, 240), (90 + off, 212)], fill=AMBER, outline=INK, width=10)

def arrow_swoosh(d):
    d.arc([40, 130, 460, 470], start=185, end=330, fill=INK, width=30)
    d.polygon([(392, 130), (448, 226), (348, 224)], fill=INK)

def shape_heart(d):
    d.polygon(heart_pts(240, 250, 340, 340), fill=RED, outline=INK, width=12)
    d.ellipse([140, 130, 205, 195], fill=(255, 255, 255, 120))

def shape_star(d):
    d.polygon(star_pts(240, 240, 180, 76, 5), fill=GOLD, outline=INK, width=14)

def shape_sparkle(d):
    d.polygon(star_pts(240, 240, 190, 42, 4), fill=VIOLET, outline=INK, width=12)
    d.polygon(star_pts(375, 105, 52, 14, 4), fill=AMBER)

def shape_bubble(d):
    d.rounded_rectangle([60, 90, 420, 330], radius=52, fill=WHITE, outline=INK, width=13)
    d.polygon([(150, 322), (150, 420), (255, 322)], fill=WHITE, outline=INK, width=12)
    d.rectangle([150, 308, 255, 330], fill=WHITE)

def shape_cloud(d):
    boxes = ([110, 210, 370, 340], [140, 150, 270, 300], [225, 130, 360, 300])
    for box in boxes:
        d.ellipse(box, fill=WHITE, outline=INK, width=11)
    for box in boxes:  # erase the internal outline seams, keep the outer silhouette
        d.ellipse([box[0] + 11, box[1] + 11, box[2] - 11, box[3] - 11], fill=WHITE)
    d.rectangle([130, 250, 350, 332], fill=WHITE)
    d.line([(118, 336), (362, 336)], fill=INK, width=11)

def shape_sun(d):
    for i in range(8):
        a = i * math.pi / 4
        x1, y1 = 240 + 128 * math.cos(a), 240 + 128 * math.sin(a)
        x2, y2 = 240 + 185 * math.cos(a), 240 + 185 * math.sin(a)
        d.line([(x1, y1), (x2, y2)], fill=AMBER, width=30)
    d.ellipse([125, 125, 355, 355], fill=AMBER, outline=INK, width=13)
    d.ellipse([185, 205, 205, 225], fill=INK)
    d.ellipse([275, 205, 295, 225], fill=INK)
    d.arc([195, 235, 285, 300], start=15, end=165, fill=INK, width=10)

def shape_moon(d):
    d.ellipse([105, 70, 375, 410], fill=SLATE, outline=INK, width=12)
    d.ellipse([190, 45, 430, 385], fill=(0, 0, 0, 0))
    d.polygon(star_pts(350, 330, 44, 18, 4), fill=GOLD)

def moon_cut(img):
    cut = Image.new('L', (S, S), 0)
    cd = ImageDraw.Draw(cut)
    cd.ellipse([198, 38, 438, 392], fill=255)
    alpha = img.split()[3]
    from PIL import ImageChops
    img.putalpha(ImageChops.subtract(alpha, cut))
    return img

def shape_check(d):
    d.ellipse([85, 85, 395, 395], fill=GREEN, outline=INK, width=14)
    d.line([(160, 245), (222, 310), (325, 175)], fill=WHITE, width=40, joint='curve')

def frame_corners(d):
    L, T, R, B, A, Wd = 52, 52, 428, 428, 105, 26
    for (x, y, sx, sy) in [(L, T, 1, 1), (R, T, -1, 1), (L, B, 1, -1), (R, B, -1, -1)]:
        d.line([(x + sx * A, y), (x, y), (x, y + sy * A)], fill=VIOLET, width=Wd, joint='curve')

def frame_rounded(d):
    d.rounded_rectangle([45, 45, 435, 435], radius=48, outline=TEAL, width=22)

def frame_tape(img):
    d = ImageDraw.Draw(img)
    d.rectangle([95, 95, 385, 385], outline=WHITE, width=30)
    d.rectangle([95, 95, 385, 385], outline=INK, width=6)
    tape = Image.new('RGBA', (170, 56), (245, 197, 66, 170))
    t1 = tape.rotate(38, resample=Image.BICUBIC, expand=True)
    img.paste(t1, (28, 38), t1)
    t2 = tape.rotate(-142, resample=Image.BICUBIC, expand=True)
    img.paste(t2, (296, 306), t2)
    return img

def frame_circle(d):
    d.ellipse([50, 50, 430, 430], outline=CORAL, width=24)

def frame_dashed(d):
    import math as _m
    x0, y0, x1, y1, r = 55, 55, 425, 425, 40
    # dashed rounded rect via many short line segments along the straight edges
    for x in range(x0 + r, x1 - r, 34):
        d.line([(x, y0), (x + 20, y0)], fill=INK, width=13)
        d.line([(x, y1), (x + 20, y1)], fill=INK, width=13)
    for y in range(y0 + r, y1 - r, 34):
        d.line([(x0, y), (x0, y + 20)], fill=INK, width=13)
        d.line([(x1, y), (x1, y + 20)], fill=INK, width=13)
    for (cx, cy, a0) in [(x0 + r, y0 + r, 180), (x1 - r, y0 + r, 270), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90)]:
        d.arc([cx - r, cy - r, cx + r, cy + r], start=a0, end=a0 + 90, fill=INK, width=13)

def frame_banner(d):
    d.polygon([(60, 175), (420, 175), (420, 305), (60, 305)], fill=SKY, outline=INK, width=12)
    d.polygon([(60, 205), (18, 178), (18, 332), (60, 305)], fill=(30, 130, 190, 255), outline=INK, width=10)
    d.polygon([(420, 205), (462, 178), (462, 332), (420, 305)], fill=(30, 130, 190, 255), outline=INK, width=10)

def social_play(d):
    d.rounded_rectangle([85, 85, 395, 395], radius=64, fill=CORAL, outline=INK, width=13)
    d.polygon([(205, 165), (205, 315), (330, 240)], fill=WHITE)

def social_like(d):
    d.ellipse([60, 60, 420, 420], fill=PINK, outline=INK, width=12)
    d.polygon(heart_pts(240, 255, 210, 210), fill=WHITE)

def social_bell(d):
    d.polygon([(240, 80), (330, 150), (345, 300), (375, 345), (105, 345), (135, 300), (150, 150)], fill=AMBER, outline=INK, width=12)
    d.ellipse([218, 52, 262, 96], fill=AMBER, outline=INK, width=9)
    d.ellipse([205, 345, 275, 400], fill=CORAL, outline=INK, width=9)

def social_comment(d):
    d.rounded_rectangle([70, 95, 410, 320], radius=48, fill=TEAL, outline=INK, width=13)
    d.polygon([(140, 312), (140, 405), (235, 312)], fill=TEAL, outline=INK, width=11)
    d.rectangle([140, 296, 235, 318], fill=TEAL)
    for cx in (155, 240, 325):
        d.ellipse([cx - 21, 186, cx + 21, 228], fill=WHITE)

def social_share(d):
    d.rounded_rectangle([80, 220, 300, 400], radius=26, outline=SKY, width=20)
    d.arc([150, 60, 420, 300], start=270, end=20, fill=SKY, width=34)
    d.polygon([(368, 44), (436, 128), (338, 140)], fill=SKY, outline=INK, width=9)

def social_rating(d):
    d.ellipse([60, 60, 420, 420], fill=GOLD, outline=INK, width=12)
    d.polygon(star_pts(240, 240, 105, 44, 5), fill=WHITE, outline=INK, width=7)

def word_new(d):
    d.polygon(star_pts(240, 240, 200, 132, 12), fill=VIOLET, outline=INK, width=12)
    text_center(d, 240, 244, 'NEW', font(104), WHITE, stroke=8)

def word_sale(d):
    d.rounded_rectangle([52, 150, 428, 330], radius=34, fill=CORAL, outline=INK, width=13)
    text_center(d, 240, 246, 'SALE', font(118), WHITE, stroke=8)

def word_wow(d):
    d.polygon(star_pts(240, 240, 198, 128, 14), fill=PINK, outline=INK, width=12)
    text_center(d, 240, 246, 'WOW!', font(92), WHITE, stroke=8)

def word_live(img):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([52, 168, 428, 312], radius=72, fill=INK)
    d.ellipse([92, 208, 152, 268], fill=RED)
    text_center(d, 268, 244, 'LIVE', font(96), WHITE, stroke=0)
    return img

def word_top(d):
    d.polygon([(60, 170), (420, 170), (385, 240), (420, 310), (60, 310), (95, 240)], fill=AMBER, outline=INK, width=12)
    text_center(d, 240, 246, 'TOP', font(104), INK, stroke=0)

def word_50(d):
    d.ellipse([70, 70, 410, 410], fill=VIOLET, outline=INK, width=13)
    d.ellipse([100, 100, 380, 380], outline=WHITE, width=8)
    text_center(d, 240, 246, '50%', font(110), WHITE, stroke=7)

# ---- Step 5 growth: faces, celebration, pointers, more of every shelf ----
# Same hand as the original set: flat fills, thick ink outlines, one palette.

def face_base(d, color):
    d.ellipse([64, 64, 416, 416], fill=color, outline=INK, width=13)

def face_happy(d):
    face_base(d, GOLD)
    d.ellipse([150, 190, 196, 236], fill=INK)
    d.ellipse([284, 190, 330, 236], fill=INK)
    d.arc([165, 235, 315, 345], start=15, end=165, fill=INK, width=13)

def face_laugh(d):
    face_base(d, AMBER)
    d.arc([138, 196, 202, 246], start=180, end=360, fill=INK, width=12)
    d.arc([278, 196, 342, 246], start=180, end=360, fill=INK, width=12)
    d.pieslice([170, 262, 310, 372], start=0, end=180, fill=INK)
    d.pieslice([196, 316, 284, 368], start=0, end=180, fill=CORAL)

def face_wink(d):
    face_base(d, SKY)
    d.ellipse([150, 190, 196, 236], fill=INK)
    d.arc([272, 196, 342, 242], start=0, end=180, fill=INK, width=12)
    d.arc([172, 240, 308, 340], start=20, end=160, fill=INK, width=13)

def face_love(d):
    face_base(d, PINK)
    d.polygon(heart_pts(172, 208, 74, 74), fill=WHITE, outline=INK, width=7)
    d.polygon(heart_pts(308, 208, 74, 74), fill=WHITE, outline=INK, width=7)
    d.arc([180, 248, 300, 338], start=15, end=165, fill=INK, width=12)

def face_wow(d):
    face_base(d, VIOLET)
    d.ellipse([138, 168, 204, 246], fill=WHITE, outline=INK, width=9)
    d.ellipse([276, 168, 342, 246], fill=WHITE, outline=INK, width=9)
    d.ellipse([163, 196, 181, 220], fill=INK)
    d.ellipse([299, 196, 317, 220], fill=INK)
    d.ellipse([206, 288, 274, 368], fill=INK)
    d.ellipse([222, 322, 258, 360], fill=CORAL)

def face_cool(d):
    face_base(d, TEAL)
    d.rounded_rectangle([110, 168, 228, 238], radius=22, fill=INK)
    d.rounded_rectangle([252, 168, 370, 238], radius=22, fill=INK)
    d.line([228, 190, 252, 190], fill=INK, width=12)
    d.line([84, 182, 110, 190], fill=INK, width=12)
    d.line([370, 190, 396, 182], fill=INK, width=12)
    d.arc([182, 268, 318, 348], start=30, end=150, fill=INK, width=12)

def face_sleepy(d):
    face_base(d, SLATE)
    d.line([140, 214, 200, 214], fill=INK, width=12)
    d.line([280, 214, 340, 214], fill=INK, width=12)
    d.ellipse([216, 292, 264, 340], outline=INK, width=11)
    text_center(d, 356, 116, 'Z', font(84), WHITE, stroke=7)
    text_center(d, 402, 66, 'Z', font(56), WHITE, stroke=6)

def face_star(d):
    face_base(d, CORAL)
    d.polygon(star_pts(172, 208, 40, 17, 5), fill=GOLD, outline=INK, width=6)
    d.polygon(star_pts(308, 208, 40, 17, 5), fill=GOLD, outline=INK, width=6)
    d.pieslice([178, 258, 302, 356], start=0, end=180, fill=INK)
    d.pieslice([204, 312, 276, 350], start=0, end=180, fill=WHITE)

def celeb_balloon(d):
    d.ellipse([130, 52, 350, 292], fill=CORAL, outline=INK, width=13)
    d.ellipse([168, 92, 226, 168], fill=WHITE)
    d.polygon([(224, 292), (256, 292), (240, 326)], fill=CORAL, outline=INK, width=9)
    d.arc([196, 318, 284, 430], start=90, end=270, fill=INK, width=8)

def celeb_gift(d):
    d.rectangle([104, 208, 376, 408], fill=TEAL, outline=INK, width=13)
    d.rectangle([84, 148, 396, 216], fill=TEAL, outline=INK, width=13)
    d.rectangle([218, 148, 262, 408], fill=GOLD)
    d.ellipse([152, 62, 240, 140], outline=GOLD, width=20)
    d.ellipse([240, 62, 328, 140], outline=GOLD, width=20)

def celeb_hat(d):
    d.polygon([(240, 84), (128, 356), (352, 356)], fill=VIOLET, outline=INK, width=13)
    d.polygon([(240, 84), (186, 218), (294, 218)], fill=PINK)
    d.polygon([(168, 284), (312, 284), (352, 356), (128, 356)], outline=INK, width=10)
    d.ellipse([206, 36, 274, 104], fill=GOLD, outline=INK, width=10)
    d.rectangle([110, 356, 370, 396], fill=AMBER, outline=INK, width=11)
    for (cx, cy, col) in ((84, 120, CORAL), (398, 150, TEAL), (410, 300, GOLD), (66, 268, SKY)):
        d.ellipse([cx - 13, cy - 13, cx + 13, cy + 13], fill=col, outline=INK, width=6)

def celeb_cake(d):
    d.rectangle([88, 268, 392, 396], fill=CREAM, outline=INK, width=13)
    d.rectangle([128, 176, 352, 272], fill=PINK, outline=INK, width=13)
    d.rectangle([88, 268, 392, 300], fill=CORAL)
    for cx in (168, 240, 312):
        d.rectangle([cx - 9, 108, cx + 9, 176], fill=SKY, outline=INK, width=7)
        d.ellipse([cx - 13, 66, cx + 13, 112], fill=GOLD, outline=INK, width=7)
    for cx in (140, 220, 300, 360):
        d.ellipse([cx - 11, 330, cx + 11, 352], fill=TEAL, outline=INK, width=5)

def celeb_firework(d):
    import math as _m
    cols = [CORAL, GOLD, SKY, PINK, TEAL, AMBER]
    for i in range(12):
        a = i * _m.pi / 6
        x1 = 240 + 52 * _m.cos(a); y1 = 240 + 52 * _m.sin(a)
        x2 = 240 + 168 * _m.cos(a); y2 = 240 + 168 * _m.sin(a)
        d.line([x1, y1, x2, y2], fill=cols[i % 6], width=15)
        d.ellipse([x2 - 14, y2 - 14, x2 + 14, y2 + 14], fill=cols[(i + 2) % 6], outline=INK, width=6)
    d.ellipse([216, 216, 264, 264], fill=GOLD, outline=INK, width=9)

def celeb_confetti(d):
    import math as _m
    pieces = [(90, 90, CORAL, 20), (180, 66, SKY, -30), (300, 96, GOLD, 40), (392, 80, TEAL, 10),
              (120, 210, AMBER, 55), (396, 216, PINK, -20), (86, 330, TEAL, 30), (200, 300, CORAL, -45),
              (330, 330, SKY, 15), (410, 396, AMBER, 60), (150, 410, PINK, -10), (268, 412, LIME, 35)]
    for (cx, cy, col, rot) in pieces:
        a = _m.radians(rot)
        pts = []
        for (dx, dy) in ((-26, -10), (26, -10), (26, 10), (-26, 10)):
            pts.append((cx + dx * _m.cos(a) - dy * _m.sin(a), cy + dx * _m.sin(a) + dy * _m.cos(a)))
        d.polygon(pts, fill=col, outline=INK, width=6)
    d.arc([150, 130, 330, 330], start=300, end=130, fill=VIOLET, width=13)
    d.arc([110, 90, 380, 380], start=320, end=120, fill=CORAL, width=11)

def celeb_clover(d):
    for (cx, cy) in ((186, 180), (294, 180), (186, 288), (294, 288)):
        d.polygon(heart_pts(cx, cy, 118, 118), fill=GREEN, outline=INK, width=9)
    d.arc([238, 250, 380, 440], start=80, end=170, fill=INK, width=11)

def celeb_balloons(d):
    d.ellipse([196, 44, 396, 244], fill=AMBER, outline=INK, width=12)
    d.ellipse([84, 84, 284, 284], fill=VIOLET, outline=INK, width=13)
    d.ellipse([116, 118, 164, 182], fill=WHITE)
    d.polygon([(172, 284), (196, 284), (184, 312)], fill=VIOLET, outline=INK, width=8)
    d.polygon([(284, 244), (308, 244), (296, 272)], fill=AMBER, outline=INK, width=8)
    d.arc([150, 300, 240, 430], start=80, end=250, fill=INK, width=8)
    d.arc([262, 262, 340, 430], start=90, end=260, fill=INK, width=8)

def ptr_cursor(d):
    d.polygon([(150, 56), (150, 356), (218, 292), (262, 396), (314, 372), (268, 272), (368, 272)],
              fill=WHITE, outline=INK, width=13)
    for (x1, y1, x2, y2) in ((240, 40, 240, 84), (330, 76, 300, 112), (120, 76, 148, 112)):
        d.line([x1, y1, x2, y2], fill=AMBER, width=13)

def ptr_pin(d):
    d.polygon([(240, 428), (148, 268), (332, 268)], fill=RED)
    d.ellipse([110, 56, 370, 316], fill=RED, outline=INK, width=13)
    d.ellipse([184, 130, 296, 242], fill=WHITE, outline=INK, width=10)

def ptr_target(d):
    d.ellipse([70, 70, 410, 410], fill=WHITE, outline=INK, width=13)
    d.ellipse([126, 126, 354, 354], fill=RED, outline=INK, width=9)
    d.ellipse([182, 182, 298, 298], fill=WHITE, outline=INK, width=9)
    d.ellipse([216, 216, 264, 264], fill=RED, outline=INK, width=7)

def ptr_flag(d):
    d.line([128, 52, 128, 428], fill=INK, width=15)
    d.polygon([(128, 66), (368, 116), (128, 196)], fill=CORAL, outline=INK, width=12)
    d.ellipse([106, 408, 150, 452], outline=INK, width=10)

def ptr_magnet(d):
    d.arc([104, 64, 376, 400], start=180, end=360, fill=RED, width=64)
    d.rectangle([72, 232, 136, 356], fill=RED, outline=INK, width=11)
    d.rectangle([344, 232, 408, 356], fill=RED, outline=INK, width=11)
    d.rectangle([72, 300, 136, 356], fill=WHITE, outline=INK, width=9)
    d.rectangle([344, 300, 408, 356], fill=WHITE, outline=INK, width=9)

def ptr_refresh(d):
    d.arc([104, 104, 376, 376], start=300, end=140, fill=TEAL, width=30)
    d.arc([104, 104, 376, 376], start=120, end=320, fill=TEAL, width=30)
    d.polygon([(330, 66), (398, 138), (296, 148)], fill=TEAL, outline=INK, width=9)
    d.polygon([(150, 414), (82, 342), (184, 332)], fill=TEAL, outline=INK, width=9)

def social_thumb(d):
    d.polygon([(128, 428), (104, 236), (168, 224), (196, 96), (238, 60), (276, 84), (272, 190),
               (388, 190), (404, 226), (376, 428)], fill=AMBER, outline=INK, width=13)
    d.rectangle([64, 224, 130, 428], fill=SKY, outline=INK, width=12)

def social_follow(d):
    d.ellipse([168, 62, 280, 174], fill=SKY, outline=INK, width=12)
    d.pieslice([104, 186, 344, 420], start=180, end=360, fill=SKY, outline=INK, width=12)
    d.ellipse([286, 262, 422, 398], fill=GREEN, outline=INK, width=11)
    d.line([354, 300, 354, 360], fill=WHITE, width=15)
    d.line([324, 330, 384, 330], fill=WHITE, width=15)

def social_hash(d):
    d.line([176, 66, 128, 414], fill=VIOLET, width=30)
    d.line([320, 66, 272, 414], fill=VIOLET, width=30)
    d.line([66, 182, 414, 158], fill=INK, width=26)
    d.line([66, 322, 414, 298], fill=INK, width=26)

def social_link(d):
    d.rounded_rectangle([66, 176, 268, 304], radius=62, outline=SKY, width=30)
    d.rounded_rectangle([212, 176, 414, 304], radius=62, outline=TEAL, width=30)

def social_tv(d):
    d.rounded_rectangle([66, 96, 414, 342], radius=30, fill=INK)
    d.polygon([(208, 164), (208, 274), (300, 219)], fill=WHITE)
    d.line([168, 396, 312, 396], fill=INK, width=14)
    d.line([240, 342, 240, 396], fill=INK, width=14)

def social_nodes(d):
    d.line([150, 150, 330, 110], fill=VIOLET, width=16)
    d.line([150, 150, 300, 330], fill=VIOLET, width=16)
    d.line([330, 110, 300, 330], fill=VIOLET, width=16)
    d.ellipse([84, 84, 216, 216], fill=SKY, outline=INK, width=12)
    d.ellipse([268, 48, 392, 172], fill=CORAL, outline=INK, width=12)
    d.ellipse([238, 268, 362, 392], fill=AMBER, outline=INK, width=12)

def badge_gem(d):
    d.polygon([(96, 168), (176, 84), (304, 84), (384, 168), (240, 400)], fill=SKY, outline=INK, width=13)
    d.line([96, 168, 384, 168], fill=WHITE, width=9)
    d.line([176, 84, 208, 168], fill=WHITE, width=7)
    d.line([304, 84, 272, 168], fill=WHITE, width=7)
    d.line([208, 168, 240, 400], fill=WHITE, width=7)
    d.line([272, 168, 240, 400], fill=WHITE, width=7)

def badge_rosette(d):
    d.polygon([(188, 300), (150, 446), (232, 408), (262, 446), (296, 300)], fill=CORAL, outline=INK, width=10)
    d.ellipse([88, 64, 392, 368], fill=GOLD, outline=INK, width=13)
    d.ellipse([138, 114, 342, 318], fill=AMBER, outline=INK, width=9)
    d.polygon(star_pts(240, 216, 62, 26, 5), fill=WHITE, outline=INK, width=7)

def badge_taghot(d):
    d.polygon([(96, 150), (262, 84), (414, 236), (248, 402), (96, 316)], fill=CORAL, outline=INK, width=13)
    d.ellipse([140, 140, 186, 186], fill=WHITE, outline=INK, width=8)
    text_center(d, 268, 268, 'HOT', font(84), WHITE, stroke=7)

def badge_flag(d):
    d.line([110, 60, 110, 420], fill=INK, width=14)
    d.polygon([(110, 72), (392, 118), (110, 196)], fill=AMBER, outline=INK, width=12)
    d.polygon(star_pts(196, 122, 30, 13, 5), fill=WHITE, outline=INK, width=5)

def word_yes(d):
    d.polygon(star_pts(240, 240, 202, 140, 12), fill=LIME, outline=INK, width=12)
    text_center(d, 240, 246, 'YES!', font(100), WHITE, stroke=8)

def word_omg(d):
    d.polygon(star_pts(240, 240, 200, 130, 14), fill=SKY, outline=INK, width=12)
    text_center(d, 240, 246, 'OMG', font(104), WHITE, stroke=8)

def word_go(d):
    d.rounded_rectangle([56, 156, 424, 324], radius=80, fill=GREEN, outline=INK, width=13)
    text_center(d, 240, 246, 'GO!', font(118), WHITE, stroke=8)

def word_vip(d):
    d.rounded_rectangle([76, 140, 404, 340], radius=28, fill=GOLD, outline=INK, width=13)
    d.rectangle([76, 196, 404, 212], fill=INK)
    d.rectangle([76, 268, 404, 284], fill=INK)
    text_center(d, 240, 246, 'VIP', font(104), INK, stroke=0)

def shape_flower(d):
    import math as _m
    for i in range(6):
        a = i * _m.pi / 3
        cx = 240 + 84 * _m.cos(a); cy = 240 + 84 * _m.sin(a)
        d.ellipse([cx - 56, cy - 56, cx + 56, cy + 56], fill=PINK, outline=INK, width=10)
    d.ellipse([192, 192, 288, 288], fill=GOLD, outline=INK, width=11)

def shape_leaf(d):
    d.polygon([(120, 360), (140, 160), (340, 80), (400, 110), (380, 320), (220, 400)],
              fill=GREEN, outline=INK, width=12)
    d.line([140, 380, 360, 120], fill=INK, width=10)

def shape_snow(d):
    import math as _m
    for i in range(6):
        a = i * _m.pi / 3
        x2 = 240 + 150 * _m.cos(a); y2 = 240 + 150 * _m.sin(a)
        d.line([240, 240, x2, y2], fill=SKY, width=17)
        mx = 240 + 96 * _m.cos(a); my = 240 + 96 * _m.sin(a)
        for s in (-1, 1):
            ba = a + s * _m.pi / 5
            d.line([mx, my, mx + 52 * _m.cos(ba), my + 52 * _m.sin(ba)], fill=SKY, width=13)
    d.ellipse([222, 222, 258, 258], fill=WHITE, outline=INK, width=8)

def shape_note(d):
    d.ellipse([104, 320, 216, 400], fill=TEAL, outline=INK, width=11)
    d.line([205, 336, 205, 108], fill=INK, width=14)
    d.polygon([(205, 108), (330, 140), (330, 226), (205, 194)], fill=VIOLET, outline=INK, width=10)
    d.ellipse([268, 348, 356, 414], fill=PINK, outline=INK, width=10)

def frame_polaroid(d):
    d.rectangle([96, 56, 384, 424], fill=WHITE, outline=INK, width=13)
    d.rectangle([126, 86, 354, 316], fill=SKY, outline=INK, width=9)
    d.ellipse([286, 116, 330, 160], fill=GOLD, outline=INK, width=6)
    d.polygon([(126, 316), (216, 226), (282, 282), (322, 246), (354, 316)], fill=TEAL)

def frame_ticket(img):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([56, 128, 424, 352], radius=26, fill=AMBER, outline=INK, width=13)
    d.line([150, 150, 150, 330], fill=INK, width=8)
    text_center(d, 292, 246, 'TICKET', font(58), INK, stroke=0)
    d.ellipse([30, 208, 82, 260], fill=(0, 0, 0, 0))
    d.ellipse([398, 208, 450, 260], fill=(0, 0, 0, 0))
    d.arc([30, 208, 82, 260], start=90, end=270, fill=INK, width=10)
    d.arc([398, 208, 450, 260], start=270, end=90, fill=INK, width=10)
    return img

PAINTERS = {
  'badge-star': badge_star, 'badge-seal': badge_seal, 'badge-ribbon': badge_ribbon,
  'badge-shield': badge_shield, 'badge-burst': badge_burst_pink, 'badge-hex': badge_hex,
  'badge-medal': badge_medal, 'badge-crown': badge_crown, 'badge-bolt': badge_bolt,
  'arrow-right': arrow_right, 'arrow-up': arrow_up, 'arrow-down': arrow_down,
  'arrow-curved': arrow_curved, 'arrow-loop': arrow_loop, 'arrow-zigzag': arrow_zigzag,
  'arrow-double': arrow_double, 'arrow-swoosh': arrow_swoosh,
  'shape-heart': shape_heart, 'shape-star': shape_star, 'shape-sparkle': shape_sparkle,
  'shape-bubble': shape_bubble, 'shape-cloud': shape_cloud, 'shape-sun': shape_sun,
  'shape-check': shape_check,
  'frame-corners': frame_corners, 'frame-rounded': frame_rounded, 'frame-circle': frame_circle,
  'frame-dashed': frame_dashed, 'frame-banner': frame_banner,
  'social-play': social_play, 'social-like': social_like, 'social-bell': social_bell,
  'social-comment': social_comment, 'social-share': social_share, 'social-rating': social_rating,
  'word-new': word_new, 'word-sale': word_sale, 'word-wow': word_wow, 'word-top': word_top,
  'word-50': word_50,
  'face-happy': face_happy, 'face-laugh': face_laugh, 'face-wink': face_wink,
  'face-love': face_love, 'face-wow': face_wow, 'face-cool': face_cool,
  'face-sleepy': face_sleepy, 'face-star': face_star,
  'celeb-balloon': celeb_balloon, 'celeb-gift': celeb_gift, 'celeb-hat': celeb_hat,
  'celeb-cake': celeb_cake, 'celeb-firework': celeb_firework, 'celeb-confetti': celeb_confetti,
  'celeb-clover': celeb_clover, 'celeb-balloons': celeb_balloons,
  'ptr-cursor': ptr_cursor, 'ptr-pin': ptr_pin, 'ptr-target': ptr_target,
  'ptr-flag': ptr_flag, 'ptr-magnet': ptr_magnet, 'ptr-refresh': ptr_refresh,
  'social-thumb': social_thumb, 'social-follow': social_follow, 'social-hash': social_hash,
  'social-link': social_link, 'social-tv': social_tv, 'social-nodes': social_nodes,
  'badge-gem': badge_gem, 'badge-rosette': badge_rosette, 'badge-taghot': badge_taghot,
  'badge-flag': badge_flag,
  'word-yes': word_yes, 'word-omg': word_omg, 'word-go': word_go, 'word-vip': word_vip,
  'shape-flower': shape_flower, 'shape-leaf': shape_leaf, 'shape-snow': shape_snow,
  'shape-note': shape_note,
  'frame-polaroid': frame_polaroid,
}
SPECIAL = ['badge-tag', 'shape-moon', 'frame-tape', 'word-live', 'frame-ticket']

def main():
    out_dir, ids = sys.argv[1], sys.argv[2:]
    for sid in ids:
        img = canvas()
        d = ImageDraw.Draw(img)
        if sid == 'badge-tag':
            img = badge_tag(img)
        elif sid == 'shape-moon':
            shape_moon(d)
            img = moon_cut(img)
        elif sid == 'frame-tape':
            img = frame_tape(img)
        elif sid == 'word-live':
            img = word_live(img)
        elif sid == 'frame-ticket':
            img = frame_ticket(img)
        else:
            PAINTERS[sid](d)
        img.save(f'{out_dir}/{sid}.png', optimize=True)
    print('drawn', len(ids))

main()
`;

// The sticker catalogue: id, display name, shelf. Order = panel order.
const DEFS = [
  ['badge-star', 'Starburst Badge', 'Badges'], ['badge-seal', 'Round Seal', 'Badges'],
  ['badge-ribbon', 'Award Ribbon', 'Badges'], ['badge-shield', 'Shield', 'Badges'],
  ['badge-burst', 'Pop Burst', 'Badges'], ['badge-hex', 'Hex Badge', 'Badges'],
  ['badge-medal', 'Gold Medal', 'Badges'], ['badge-tag', 'Price Tag', 'Badges'],
  ['badge-crown', 'Crown', 'Badges'], ['badge-bolt', 'Bolt Badge', 'Badges'],
  ['arrow-right', 'Arrow Right', 'Arrows'], ['arrow-up', 'Arrow Up', 'Arrows'],
  ['arrow-down', 'Arrow Down', 'Arrows'], ['arrow-curved', 'Curved Arrow', 'Arrows'],
  ['arrow-loop', 'Loop Arrow', 'Arrows'], ['arrow-zigzag', 'Zigzag Arrow', 'Arrows'],
  ['arrow-double', 'Double Arrow', 'Arrows'], ['arrow-swoosh', 'Swoosh Arrow', 'Arrows'],
  ['shape-heart', 'Heart', 'Shapes'], ['shape-star', 'Star', 'Shapes'],
  ['shape-sparkle', 'Sparkle', 'Shapes'], ['shape-bubble', 'Speech Bubble', 'Shapes'],
  ['shape-cloud', 'Cloud', 'Shapes'], ['shape-sun', 'Sun', 'Shapes'],
  ['shape-moon', 'Moon', 'Shapes'], ['shape-check', 'Check Disc', 'Shapes'],
  ['frame-corners', 'Corner Frame', 'Frames'], ['frame-rounded', 'Rounded Frame', 'Frames'],
  ['frame-tape', 'Taped Photo', 'Frames'], ['frame-circle', 'Circle Frame', 'Frames'],
  ['frame-dashed', 'Dashed Frame', 'Frames'], ['frame-banner', 'Banner Ribbon', 'Frames'],
  ['social-play', 'Play Button', 'Social'], ['social-like', 'Like Heart', 'Social'],
  ['social-bell', 'Bell', 'Social'], ['social-comment', 'Comment Bubble', 'Social'],
  ['social-share', 'Share Arrow', 'Social'], ['social-rating', 'Rating Star', 'Social'],
  ['word-new', 'New Burst', 'Words'], ['word-sale', 'Sale Tag', 'Words'],
  ['word-wow', 'Wow Burst', 'Words'], ['word-live', 'Live Pill', 'Words'],
  ['word-top', 'Top Ribbon', 'Words'], ['word-50', '50% Seal', 'Words'],
  // Step 5 growth: two new shelves (Faces, Celebration) + more of every shelf.
  ['face-happy', 'Happy Face', 'Faces'], ['face-laugh', 'Laughing Face', 'Faces'],
  ['face-wink', 'Wink Face', 'Faces'], ['face-love', 'Love Face', 'Faces'],
  ['face-wow', 'Wow Face', 'Faces'], ['face-cool', 'Cool Face', 'Faces'],
  ['face-sleepy', 'Sleepy Face', 'Faces'], ['face-star', 'Star Face', 'Faces'],
  ['celeb-balloon', 'Balloon', 'Celebration'], ['celeb-gift', 'Gift Box', 'Celebration'],
  ['celeb-hat', 'Party Hat', 'Celebration'], ['celeb-cake', 'Cake', 'Celebration'],
  ['celeb-firework', 'Firework', 'Celebration'], ['celeb-confetti', 'Confetti', 'Celebration'],
  ['celeb-clover', 'Clover', 'Celebration'], ['celeb-balloons', 'Balloons', 'Celebration'],
  ['ptr-cursor', 'Click Cursor', 'Arrows'], ['ptr-pin', 'Map Pin', 'Arrows'],
  ['ptr-target', 'Target', 'Arrows'], ['ptr-flag', 'Marker Flag', 'Arrows'],
  ['ptr-magnet', 'Magnet', 'Arrows'], ['ptr-refresh', 'Refresh Arrows', 'Arrows'],
  ['social-thumb', 'Thumbs Up', 'Social'], ['social-follow', 'Follow', 'Social'],
  ['social-hash', 'Hashtag', 'Social'], ['social-link', 'Link Chain', 'Social'],
  ['social-tv', 'Screen Play', 'Social'], ['social-nodes', 'Share Nodes', 'Social'],
  ['badge-gem', 'Gem', 'Badges'], ['badge-rosette', 'Rosette', 'Badges'],
  ['badge-taghot', 'Hot Tag', 'Badges'], ['badge-flag', 'Pennant', 'Badges'],
  ['word-yes', 'Yes Burst', 'Words'], ['word-omg', 'OMG Burst', 'Words'],
  ['word-go', 'Go Pill', 'Words'], ['word-vip', 'VIP Tag', 'Words'],
  ['shape-flower', 'Flower', 'Shapes'], ['shape-leaf', 'Leaf', 'Shapes'],
  ['shape-snow', 'Snowflake', 'Shapes'], ['shape-note', 'Music Note', 'Shapes'],
  ['frame-polaroid', 'Polaroid Frame', 'Frames'], ['frame-ticket', 'Ticket Frame', 'Frames'],
];

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(PY, DRAW_SRC);
execFileSync('python3', [PY, OUT, ...DEFS.map((d) => d[0])], { stdio: 'inherit' });
fs.rmSync(PY, { force: true });

const items = DEFS.map(([id, name, cat]) => {
  const file = path.join(OUT, `${id}.png`);
  const bytes = fs.statSync(file).size;
  return { id, name, cat, file: `${id}.png`, w: 480, h: 480, bytes };
});
const total = items.reduce((a, i) => a + i.bytes, 0);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generator: 'scripts/gen-stickers.cjs', items }, null, 2) + '\n');
const reg = `// Bundled stickers — GENERATED by scripts/gen-stickers.cjs; do not hand-edit.
// Original art drawn for Cutflow by that script (flat shapes, ink outlines, one
// palette) and shipped as transparent PNGs in shared/stickers/.
export const STICKER_CATS = ${JSON.stringify([...new Set(DEFS.map((d) => d[2]))])};
export const STICKERS = ${JSON.stringify(items.map(({ bytes, ...rest }) => rest), null, 2)};
export const stickerById = (id) => STICKERS.find((s) => s.id === id) || null;
`;
fs.writeFileSync(REGISTRY, reg);
console.log(`stickers OK: ${items.length} stickers, ${total} bytes total, registry written`);
