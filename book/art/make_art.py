#!/usr/bin/env python3
"""
Procedural plate generator for the ANGST booklet.

Nothing here is AI-generated. Every plate is drawn computationally with a
small set of printmaking / drawing techniques that are combined per plate:

    hatch / cross-hatch   parallel ruled lines clipped to a shape
    stipple               random dots, density-weighted
    bead speckle          two-tone dots (thermocol foam)
    radial line work      lines converging on or radiating from a point
    spiral arms           logarithmic vortex arms (vertigo)
    contour banding       cross-sections ruled across a ribbon form
    woodcut faceting      flat cut planes with hard edges
    mezzotint gradient    smooth tonal ramp composited through a mask
    grain / vignette      final paper texture

Run:
    /tmp/bookenv/bin/python book/art/make_art.py            # all plates
    /tmp/bookenv/bin/python book/art/make_art.py cover      # one plate
"""

import math
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ------------------------------------------------------------------ palette
BONE = (243, 241, 236)
PAPER = (247, 245, 241)
INK = (22, 22, 26)
INK_SOFT = (58, 58, 64)
GREY = (140, 138, 130)
CLAY = (198, 190, 175)
CLAY_MID = (170, 160, 143)
CLAY_DARK = (126, 117, 101)
TEAL = (30, 92, 88)
TEAL_DARK = (19, 61, 58)
OXIDE = (162, 56, 32)
OXIDE_D = (116, 36, 20)
CHAR = (14, 16, 20)
CHAR2 = (26, 28, 34)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "images")
OUT = os.path.normpath(OUT)


# ------------------------------------------------------------------ canvas
class Cv:
    """A square, supersampled drawing surface."""

    def __init__(self, final, bg=BONE, ss=2):
        self.final = final
        self.ss = ss
        self.w = final * ss
        self.img = Image.new("RGB", (self.w, self.w), bg)

    def layer(self):
        return Image.new("RGBA", (self.w, self.w), (0, 0, 0, 0))

    def paste(self, lay, mask=None):
        if mask is not None:
            a = np.asarray(lay.split()[-1], dtype=np.uint16)
            m = np.asarray(mask.convert("L"), dtype=np.uint16)
            lay = lay.copy()
            lay.putalpha(Image.fromarray(((a * m) // 255).astype(np.uint8)))
        self.img = Image.alpha_composite(self.img.convert("RGBA"), lay).convert("RGB")

    def finish(self, grain=5.0, vign=0.35):
        w = self.w
        arr = np.asarray(self.img).astype(np.float32)
        if grain:
            arr += np.random.normal(0.0, grain, (w, w, 1)).astype(np.float32)
        if vign:
            yy, xx = np.mgrid[0:w, 0:w].astype(np.float32)
            d = np.sqrt((xx - w / 2) ** 2 + (yy - w / 2) ** 2) / (w / 2.0)
            arr *= (1.0 - vign * 0.55 * np.clip(d - 0.55, 0, None) / 0.45)[..., None]
        self.img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        if self.ss != 1:
            self.img = self.img.resize((self.final, self.final), Image.LANCZOS)
        return self.img


# ------------------------------------------------------------------ masks
def poly_mask(cv, polys, blur=1.2):
    m = Image.new("L", (cv.w, cv.w), 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        if len(p) >= 3:
            d.polygon(p, fill=255)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur * cv.ss))
    return m


def shape_mask(cv, draw_fn, blur=1.2):
    m = Image.new("L", (cv.w, cv.w), 0)
    draw_fn(ImageDraw.Draw(m), cv.w)
    if blur:
        m = m.filter(ImageFilter.GaussianBlur(blur * cv.ss))
    return m


def radial_grad(w, cx, cy, r, invert=False):
    yy, xx = np.mgrid[0:w, 0:w].astype(np.float32)
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / r
    t = np.clip(d, 0, 1)
    if invert:
        t = 1.0 - t
    return t


def linear_grad(w, angle_deg):
    a = math.radians(angle_deg)
    yy, xx = np.mgrid[0:w, 0:w].astype(np.float32)
    t = xx * math.cos(a) + yy * math.sin(a)
    return (t - t.min()) / max(1e-6, (t.max() - t.min()))


# ------------------------------------------------------------------ shading
def shade(cv, mask, dark, angle_deg=45, strength=0.65, gamma=1.4):
    """Smooth tonal ramp, darkening towards `angle_deg` (45 = bottom-right)."""
    w = cv.w
    t = linear_grad(w, angle_deg) ** gamma
    m = np.asarray(mask.convert("L"), dtype=np.float32) / 255.0
    a = np.clip(m * t * strength * 255.0, 0, 255).astype(np.uint8)
    lay = Image.new("RGBA", (w, w), dark + (255,))
    lay.putalpha(Image.fromarray(a))
    cv.img = Image.alpha_composite(cv.img.convert("RGBA"), lay).convert("RGB")


def glow(cv, cx, cy, r, color, strength=0.5, gamma=2.0):
    w = cv.w
    t = (1.0 - radial_grad(w, cx, cy, r)) ** gamma
    a = np.clip(t * strength * 255.0, 0, 255).astype(np.uint8)
    lay = Image.new("RGBA", (w, w), color + (255,))
    lay.putalpha(Image.fromarray(a))
    cv.img = Image.alpha_composite(cv.img.convert("RGBA"), lay).convert("RGB")


def fill_poly(cv, polys, color):
    m = poly_mask(cv, polys, blur=0.6)
    lay = Image.new("RGBA", (cv.w, cv.w), color + (255,))
    cv.paste(lay, m)


# ------------------------------------------------------------------ techniques
def hatch(lay, w, spacing, width, color, angle=45, jitter=0.0, seed=0):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    a = math.radians(angle)
    ux, uy = math.cos(a), math.sin(a)
    nx, ny = -math.sin(a), math.cos(a)
    L, cx, cy = w * 0.8, w / 2.0, w / 2.0
    step = w / 16.0
    o = -L
    while o < L:
        pts = []
        t = -L
        while t < L:
            jx = rnd.uniform(-jitter, jitter) if jitter else 0.0
            jy = rnd.uniform(-jitter, jitter) if jitter else 0.0
            pts.append((cx + ux * t + nx * o + jx, cy + uy * t + ny * o + jy))
            t += step
        d.line(pts, fill=color, width=width, joint="curve")
        o += spacing
    return lay


def crosshatch(lay, w, spacing, width, color, seed=0):
    hatch(lay, w, spacing, width, color, angle=38, jitter=1.2, seed=seed)
    hatch(lay, w, spacing, width, color, angle=128, jitter=1.2, seed=seed + 7)
    return lay


def stipple(lay, w, n, rmin, rmax, color, seed=0, weight=None, box=None):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    x0, y0, x1, y1 = box or (0, 0, w, w)
    for _ in range(n):
        x = rnd.uniform(x0, x1)
        y = rnd.uniform(y0, y1)
        if weight is not None and rnd.random() > weight(x, y):
            continue
        r = rnd.uniform(rmin, rmax)
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)
    return lay


def bead_speckle(lay, w, n, rmin, rmax, seed=0, light=(255, 255, 255, 46),
                 dark=(70, 66, 58, 40), box=None):
    """Thermocol: paired light/dark dots that read as expanded-foam beads."""
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    x0, y0, x1, y1 = box or (0, 0, w, w)
    for _ in range(n):
        x = rnd.uniform(x0, x1)
        y = rnd.uniform(y0, y1)
        r = rnd.uniform(rmin, rmax)
        d.ellipse([x - r, y - r, x + r, y + r], fill=dark)
        d.ellipse([x - r * 1.25, y - r * 1.3, x + r * 0.5, y + r * 0.4], fill=light)
    return lay


def radial_lines(lay, cx, cy, count, r0, r1, width, color, seed=0, jitter=0.02,
                 taper=True):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    for i in range(count):
        a = 2 * math.pi * i / count + rnd.uniform(-jitter, jitter)
        rr = r1 * rnd.uniform(0.75, 1.15)
        ca, sa = math.cos(a), math.sin(a)
        if taper:
            steps = 8
            for s in range(steps):
                t0, t1 = s / steps, (s + 1) / steps
                ww = max(1, int(width * (1.0 - t0) + 1))
                d.line([(cx + ca * (r0 + (rr - r0) * t0), cy + sa * (r0 + (rr - r0) * t0)),
                        (cx + ca * (r0 + (rr - r0) * t1), cy + sa * (r0 + (rr - r0) * t1))],
                       fill=color, width=ww)
        else:
            d.line([(cx + ca * r0, cy + sa * r0), (cx + ca * rr, cy + sa * rr)],
                   fill=color, width=width)
    return lay


def thorns(lay, cx, cy, count, r0, r1, base, color, seed=0, curve=0.0):
    """Tapered spikes — the 'armour' technique."""
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    for i in range(count):
        a = 2 * math.pi * i / count + rnd.uniform(-0.02, 0.02)
        ln = r1 * rnd.uniform(0.55, 1.0)
        bw = base * rnd.uniform(0.6, 1.35)
        ca, sa = math.cos(a), math.sin(a)
        px, py = -sa, ca
        p1 = (cx + ca * r0 + px * bw, cy + sa * r0 + py * bw)
        p2 = (cx + ca * r0 - px * bw, cy + sa * r0 - py * bw)
        mid = (cx + ca * (r0 + ln * 0.55) + px * bw * curve,
               cy + sa * (r0 + ln * 0.55) + py * bw * curve)
        tip = (cx + ca * (r0 + ln), cy + sa * (r0 + ln))
        d.polygon([p1, mid, tip, mid, p2], fill=color)
    return lay


def spiral_arms(lay, cx, cy, arms, turns, r0, r1, color, width0, width1,
                alpha0, alpha1, seed=0, seg=180, wobble=0.0):
    """Logarithmic vortex arms — the 'vertigo' technique."""
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    for k in range(arms):
        phase = 2 * math.pi * k / arms
        pts = []
        for i in range(seg + 1):
            t = i / seg
            th = phase + turns * 2 * math.pi * t
            r = r0 * (r1 / r0) ** t
            r *= 1.0 + (rnd.uniform(-wobble, wobble) if wobble else 0.0)
            pts.append((cx + math.cos(th) * r, cy + math.sin(th) * r))
        step = max(1, seg // 26)
        for i in range(0, seg, step):
            t = i / seg
            wd = max(1, int(width0 + (width1 - width0) * t))
            al = int(alpha0 + (alpha1 - alpha0) * t)
            d.line(pts[i:i + step + 1], fill=color + (al,), width=wd, joint="curve")
    return lay


def scratch(lay, w, n, color, seed=0, width=(1, 3), length=(0.4, 1.1)):
    rnd = random.Random(seed)
    d = ImageDraw.Draw(lay)
    for _ in range(n):
        x = rnd.uniform(-0.1, 1.1) * w
        y = rnd.uniform(-0.1, 1.1) * w
        a = rnd.uniform(-0.5, 0.5) + math.pi / 2
        ln = rnd.uniform(*length) * w
        pts = []
        steps = 12
        for i in range(steps + 1):
            t = i / steps
            pts.append((x + math.cos(a) * ln * t + math.sin(t * 6) * 3,
                        y + math.sin(a) * ln * t))
        d.line(pts, fill=color, width=rnd.randint(*width), joint="curve")
    return lay


# ------------------------------------------------------------------ ribbon
def ribbon(pts, th):
    """Offset a centreline by a varying half-width. Returns (poly, left, right)."""
    n = len(pts)
    left, right = [], []
    for i, (p, t) in enumerate(zip(pts, th)):
        i0, i1 = max(0, i - 1), min(n - 1, i + 1)
        dx, dy = pts[i1][0] - pts[i0][0], pts[i1][1] - pts[i0][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        left.append((p[0] + nx * t, p[1] + ny * t))
        right.append((p[0] - nx * t, p[1] - ny * t))
    return left + right[::-1], left, right


def contour_bands(lay, left, right, color, width=1, every=6, alpha=90):
    """Rule cross-sections across a ribbon — the 'modelled form' technique."""
    d = ImageDraw.Draw(lay)
    for i in range(0, len(left), every):
        d.line([left[i], right[i]], fill=color + (alpha,), width=width)
    return lay


def ellipse_pts(cx, cy, rx, ry, n=140, rot=0.0, a0=0.0, a1=2 * math.pi):
    out = []
    for i in range(n):
        a = a0 + (a1 - a0) * i / (n - 1)
        x, y = math.cos(a) * rx, math.sin(a) * ry
        out.append((cx + x * math.cos(rot) - y * math.sin(rot),
                    cy + x * math.sin(rot) + y * math.cos(rot)))
    return out


def ground_shadow(cv, cx, cy, rx, ry, strength=0.30):
    m = Image.new("L", (cv.w, cv.w), 0)
    ImageDraw.Draw(m).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=255)
    m = m.filter(ImageFilter.GaussianBlur(cv.w * 0.022))
    a = (np.asarray(m, dtype=np.float32) * strength).astype(np.uint8)
    lay = Image.new("RGBA", (cv.w, cv.w), (90, 88, 82, 255))
    lay.putalpha(Image.fromarray(a))
    cv.img = Image.alpha_composite(cv.img.convert("RGBA"), lay).convert("RGB")


def outline(cv, pts, color=INK, width=2.2, alpha=210, closed=True):
    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    d.line(pts + ([pts[0]] if closed else []), fill=color + (alpha,),
           width=int(width * cv.ss), joint="curve")
    cv.paste(lay)


# ================================================================== COVER
def cover_art(final=2400, ss=2):
    cv = Cv(final, bg=CHAR, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.44

    # faint furnace glow behind the vortex
    glow(cv, cx, cy, w * 0.62, CHAR2, strength=0.95, gamma=1.2)
    glow(cv, cx, cy, w * 0.20, OXIDE_D, strength=0.30, gamma=2.2)

    # outer field: radial line work + hatching, denser at the edges
    lay = cv.layer()
    radial_lines(lay, cx, cy, 720, w * 0.30, w * 1.05, 1, (232, 230, 224), 14,
                 jitter=0.01, taper=False)
    lay.putalpha(Image.fromarray(
        (np.asarray(lay.split()[-1], dtype=np.float32) *
         np.clip(radial_grad(w, cx, cy, w * 0.95) * 1.6, 0, 1) * 0.22).astype(np.uint8)))
    cv.paste(lay)

    lay = cv.layer()
    crosshatch(lay, w, int(15 * ss), max(1, int(1.1 * ss)), (226, 224, 218, 255), seed=3)
    a = (np.asarray(lay.split()[-1], dtype=np.float32) *
         np.clip(radial_grad(w, cx, cy, w * 0.8) * 1.5, 0, 1) * 0.16).astype(np.uint8)
    lay.putalpha(Image.fromarray(a))
    cv.paste(lay)

    # the vortex
    lay = cv.layer()
    spiral_arms(lay, cx, cy, arms=64, turns=2.55, r0=w * 0.50, r1=w * 0.018,
                color=(236, 233, 226), width0=int(4.2 * ss), width1=1,
                alpha0=6, alpha1=96, seed=11, wobble=0.012)
    cv.paste(lay)

    lay = cv.layer()
    for i in range(46):
        r = w * (0.035 + 0.0105 * i)
        pts = []
        for j in range(200):
            a = 2 * math.pi * j / 199
            rr = r * (1 + 0.030 * math.sin(a * 3 + i * 0.55) + 0.012 * math.sin(a * 7))
            pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
        ImageDraw.Draw(lay).line(pts + [pts[0]], fill=(228, 225, 218, 22),
                                 width=max(1, int(1.2 * ss)), joint="curve")
    cv.paste(lay)

    # armour: a ring of thorns tearing outward
    lay = cv.layer()
    thorns(lay, cx, cy, 190, w * 0.24, w * 0.30, w * 0.0055, (238, 235, 228, 78),
           seed=5, curve=0.25)
    cv.paste(lay)
    lay = cv.layer()
    thorns(lay, cx, cy, 96, w * 0.40, w * 0.22, w * 0.0040, (232, 229, 222, 44),
           seed=9, curve=-0.3)
    cv.paste(lay)

    # dust and damage
    lay = cv.layer()
    stipple(lay, w, 26000, 0.5 * ss, 2.4 * ss, (240, 238, 232, 40), seed=21,
            weight=lambda x, y: 0.55 + 0.9 * (1.0 - min(1.0, math.hypot(x - cx, y - cy) / (w * 0.45))))
    cv.paste(lay)

    lay = cv.layer()
    scratch(lay, w, 16, (236, 233, 226, 30), seed=4, width=(1, max(2, int(3 * ss))),
            length=(0.5, 1.2))
    cv.paste(lay)

    # the void at the centre, and an oxide ring around it
    t = radial_grad(w, cx, cy, w * 0.17)
    a = np.clip((1.0 - t) ** 1.5 * 255, 0, 255).astype(np.uint8)
    lay = Image.new("RGBA", (w, w), (4, 4, 6, 255))
    lay.putalpha(Image.fromarray(a))
    cv.img = Image.alpha_composite(cv.img.convert("RGBA"), lay).convert("RGB")

    lay = cv.layer()
    ImageDraw.Draw(lay).ellipse([cx - w * 0.145, cy - w * 0.145, cx + w * 0.145, cy + w * 0.145],
                                outline=OXIDE + (70,), width=max(1, int(1.6 * ss)))
    cv.paste(lay)

    return cv.finish(grain=6.0, vign=0.55)


# ================================================================== CHAPTER 1
def _plate_frame(cv, cx, cy, r, tint=None):
    if tint:
        glow(cv, cx, cy, r * 1.5, tint, strength=0.20, gamma=2.0)


def plate_spines(final=1200, ss=2):
    """Hedgehog — armour as a field of tapered spines."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy, R = w * 0.5, w * 0.56, w * 0.30
    body = ellipse_pts(cx, cy, R * 1.02, R * 0.86)
    fill_poly(cv, [body], CLAY_MID)
    m = poly_mask(cv, [body], blur=1.0)
    shade(cv, m, CLAY_DARK, angle_deg=45, strength=0.75)
    lay = cv.layer()
    hatch(lay, w, int(9 * ss), max(1, int(1.0 * ss)), (70, 66, 58, 130), angle=62,
          jitter=1.0, seed=2)
    cv.paste(lay, m)

    lay = cv.layer()
    thorns(lay, cx, cy, 240, R * 0.86, R * 0.52, w * 0.0042, (34, 32, 30, 220), seed=1)
    cv.paste(lay)
    lay = cv.layer()
    thorns(lay, cx, cy, 170, R * 0.70, R * 0.40, w * 0.0032, (34, 32, 30, 110), seed=6)
    cv.paste(lay)
    outline(cv, body, INK, 2.0, 190)
    ground_shadow(cv, cx, cy + R * 0.98, R * 0.95, R * 0.10)
    return cv.finish(grain=5.0, vign=0.30)


def plate_bands(final=1200, ss=2):
    """Armadillo — the plated shell, drawn as concentric banded arcs."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy, R = w * 0.5, w * 0.55, w * 0.32

    def shell(d, ww):
        d.pieslice([cx - R, cy - R, cx + R, cy + R], 195, 345, fill=255)
    m = shape_mask(cv, shell, blur=1.4)
    lay = Image.new("RGBA", (w, w), CLAY_MID + (255,))
    cv.paste(lay, m)
    shade(cv, m, CLAY_DARK, angle_deg=60, strength=0.7)

    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    rings = 9
    for i in range(rings):
        rr = R * (0.30 + 0.72 * i / (rings - 1))
        d.arc([cx - rr, cy - rr, cx + rr, cy + rr], 195, 345,
              fill=(30, 28, 26, 190), width=max(1, int(1.8 * ss)))
    for k in range(15):
        a = math.radians(196 + 148 * k / 14)
        d.line([(cx + math.cos(a) * R * 0.30, cy + math.sin(a) * R * 0.30),
                (cx + math.cos(a) * R * 1.02, cy + math.sin(a) * R * 1.02)],
               fill=(30, 28, 26, 150), width=max(1, int(1.4 * ss)))
    cv.paste(lay, m)

    lay = cv.layer()
    hatch(lay, w, int(7 * ss), max(1, int(1.0 * ss)), (60, 56, 50, 120), angle=20,
          jitter=0.8, seed=8)
    cv.paste(lay, m)
    ground_shadow(cv, cx, cy + R * 1.02, R * 0.95, R * 0.10)
    return cv.finish(grain=5.0, vign=0.30)


def plate_shell(final=1200, ss=2):
    """Turtle — the closed box: a domed carapace of plate cells."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy, R = w * 0.5, w * 0.56, w * 0.33
    dome = ellipse_pts(cx, cy, R, R * 0.78)
    fill_poly(cv, [dome], CLAY_MID)
    m = poly_mask(cv, [dome], blur=1.0)
    shade(cv, m, CLAY_DARK, angle_deg=45, strength=0.72)

    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    rings = [0.30, 0.58, 0.82, 0.98]
    for r in rings:
        pts = ellipse_pts(cx, cy, R * r, R * 0.78 * r, n=90)
        d.line(pts + [pts[0]], fill=(32, 30, 28, 175), width=max(1, int(1.6 * ss)),
               joint="curve")
    for k in range(2, 9):
        a = math.pi + math.pi * k / 9.0
        d.line([(cx + math.cos(a) * R * 0.30, cy + math.sin(a) * R * 0.78 * 0.30),
                (cx + math.cos(a) * R * 1.0, cy + math.sin(a) * R * 0.78 * 1.0)],
               fill=(32, 30, 28, 150), width=max(1, int(1.4 * ss)))
    cv.paste(lay, m)
    lay = cv.layer()
    stipple(lay, w, 9000, 0.6 * ss, 1.8 * ss, (46, 42, 38, 90), seed=3,
            box=(cx - R, cy - R * 0.8, cx + R, cy + R * 0.8))
    cv.paste(lay, m)
    outline(cv, dome, INK, 2.2, 200)
    ground_shadow(cv, cx, cy + R * 0.84, R * 0.98, R * 0.10)
    return cv.finish(grain=5.0, vign=0.30)


def plate_flight(final=1200, ss=2):
    """Kangaroo in fire — flight, drawn as speed streaks and embers."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.54
    glow(cv, cx, cy * 0.9, w * 0.55, OXIDE, strength=0.16, gamma=2.4)

    body = [(cx - w * 0.30, cy + w * 0.10), (cx - w * 0.20, cy - w * 0.06),
            (cx - w * 0.02, cy - w * 0.14), (cx + w * 0.14, cy - w * 0.20),
            (cx + w * 0.22, cy - w * 0.10), (cx + w * 0.16, cy - w * 0.02),
            (cx + w * 0.26, cy + w * 0.06), (cx + w * 0.34, cy + w * 0.20),
            (cx + w * 0.12, cy + w * 0.13), (cx - w * 0.02, cy + w * 0.20),
            (cx - w * 0.10, cy + w * 0.30), (cx - w * 0.06, cy + w * 0.12),
            (cx - w * 0.22, cy + w * 0.16)]
    fill_poly(cv, [body], (44, 40, 38))
    lay = cv.layer()
    for i in range(70):
        y = cy - w * 0.34 + (w * 0.70) * i / 69
        x0 = cx - w * 0.46
        ln = w * (0.22 + 0.42 * random.Random(i).random())
        d = ImageDraw.Draw(lay)
        d.line([(x0, y), (x0 + ln, y - w * 0.04)], fill=(38, 34, 32, 60),
               width=max(1, int(1.1 * ss)))
    cv.paste(lay)
    lay = cv.layer()
    stipple(lay, w, 2600, 0.6 * ss, 2.6 * ss, (OXIDE + (170,)), seed=17,
            box=(cx - w * 0.45, cy - w * 0.36, cx + w * 0.45, cy + w * 0.34))
    cv.paste(lay)
    return cv.finish(grain=5.5, vign=0.34)


def plate_cling(final=1200, ss=2):
    """Rescued koala — clinging: a small form locked around a vertical arm."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.52
    bar = [(cx - w * 0.075, cy - w * 0.40), (cx + w * 0.075, cy - w * 0.40),
           (cx + w * 0.075, cy + w * 0.40), (cx - w * 0.075, cy + w * 0.40)]
    fill_poly(cv, [bar], (206, 200, 190))
    m = poly_mask(cv, [bar], blur=1.0)
    shade(cv, m, CLAY_DARK, angle_deg=0, strength=0.55, gamma=1.0)

    body = ellipse_pts(cx - w * 0.16, cy + w * 0.02, w * 0.16, w * 0.20)
    fill_poly(cv, [body], CLAY_MID)
    mb = poly_mask(cv, [body], blur=1.0)
    shade(cv, mb, CLAY_DARK, angle_deg=20, strength=0.7)
    lay = cv.layer()
    hatch(lay, w, int(8 * ss), max(1, int(1.0 * ss)), (66, 62, 56, 110), angle=70,
          jitter=1.2, seed=4)
    cv.paste(lay, mb)

    for off, rad in ((-0.20, 0.055), (-0.05, 0.05), (0.06, 0.048)):
        pts = ellipse_pts(cx + w * off, cy + w * 0.03, w * rad, w * rad * 0.6)
        fill_poly(cv, [pts], CLAY)
        outline(cv, pts, INK, 1.6, 150)

    # arms wrapping the bar
    for a0, a1 in ((190, 360), (200, 350)):
        pts, th = [], []
        for i in range(30):
            t = i / 29
            a = math.radians(a0 + (a1 - a0) * t)
            rr = w * (0.16 + 0.06 * math.sin(t * math.pi))
            pts.append((cx + math.cos(a) * rr, cy + w * 0.02 + math.sin(a) * rr * 0.8))
            th.append(w * (0.045 - 0.018 * t))
        poly, L, R = ribbon(pts, th)
        fill_poly(cv, [poly], CLAY_MID)
        mm = poly_mask(cv, [poly], blur=0.8)
        shade(cv, mm, CLAY_DARK, angle_deg=45, strength=0.6)
        lay = cv.layer()
        contour_bands(lay, L, R, (60, 56, 50), width=max(1, int(1.0 * ss)),
                      every=4, alpha=110)
        cv.paste(lay, mm)
        outline(cv, poly, INK, 1.6, 160, closed=True)

    outline(cv, body, INK, 2.0, 190)
    head = ellipse_pts(cx - w * 0.20, cy - w * 0.14, w * 0.085, w * 0.075)
    fill_poly(cv, [head], CLAY)
    outline(cv, head, INK, 1.8, 190)
    for dx in (-0.055, 0.02):
        e = ellipse_pts(cx + w * dx * 1.6 - w * 0.20, cy - w * 0.16, w * 0.026, w * 0.026)
        fill_poly(cv, [e], (30, 28, 26))
    return cv.finish(grain=5.0, vign=0.30)


def plate_spiral(final=1200, ss=2, dark=False):
    """Vertigo — the spiral, the fall."""
    cv = Cv(final, bg=BONE if not dark else CHAR, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.5
    ink = (26, 24, 22) if not dark else (236, 233, 226)
    lay = cv.layer()
    spiral_arms(lay, cx, cy, arms=34, turns=3.1, r0=w * 0.46, r1=w * 0.012,
                color=ink, width0=int(3.4 * ss), width1=1, alpha0=85, alpha1=225,
                seed=13, wobble=0.010)
    cv.paste(lay)
    lay = cv.layer()
    for i in range(30):
        r = w * (0.02 + 0.0145 * i)
        pts = ellipse_pts(cx, cy, r, r, n=140)
        ImageDraw.Draw(lay).line(pts + [pts[0]], fill=ink + (40,),
                                 width=max(1, int(1.0 * ss)), joint="curve")
    cv.paste(lay)
    lay = cv.layer()
    stipple(lay, w, 12000, 0.5 * ss, 1.9 * ss, ink + (60,), seed=19,
            weight=lambda x, y: 0.35 + 1.0 * (1.0 - min(1.0, math.hypot(x - cx, y - cy) / (w * 0.42))))
    cv.paste(lay)
    return cv.finish(grain=5.0, vign=0.34)


def plate_scream(final=1200, ss=2):
    """The screaming face — radial burst around a dark open mouth."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.46
    glow(cv, cx, cy, w * 0.42, OXIDE, strength=0.22, gamma=2.0)

    face = ellipse_pts(cx, cy, w * 0.27, w * 0.33)
    fill_poly(cv, [face], (214, 206, 196))
    m = poly_mask(cv, [face], blur=1.2)
    shade(cv, m, (150, 84, 66), angle_deg=45, strength=0.55)

    lay = cv.layer()
    radial_lines(lay, cx, cy + w * 0.06, 260, w * 0.06, w * 0.62, max(1, int(1.8 * ss)),
                 (26, 24, 22, 190), seed=7, jitter=0.02)
    cv.paste(lay, m)

    mouth = ellipse_pts(cx, cy + w * 0.10, w * 0.085, w * 0.135)
    fill_poly(cv, [mouth], (16, 14, 14))
    for dx in (-0.135, 0.135):
        e = ellipse_pts(cx + w * dx, cy - w * 0.07, w * 0.052, w * 0.042)
        fill_poly(cv, [e], (18, 16, 16))
    for dx in (-0.135, 0.135):
        e = ellipse_pts(cx + w * dx, cy - w * 0.07, w * 0.030, w * 0.030)
        fill_poly(cv, [e], (238, 236, 230))

    lay = cv.layer()
    hatch(lay, w, int(8 * ss), max(1, int(1.1 * ss)), (26, 24, 22, 90), angle=100,
          jitter=1.4, seed=5)
    cv.paste(lay, m)
    outline(cv, face, INK, 2.2, 190)
    return cv.finish(grain=5.5, vign=0.34)


def plate_hood(final=1200, ss=2):
    """The covered head — a figure hiding inside its own cloth."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.52
    shoulders = [(cx - w * 0.34, cy + w * 0.42), (cx - w * 0.26, cy + w * 0.02),
                 (cx - w * 0.16, cy - w * 0.16), (cx, cy - w * 0.22),
                 (cx + w * 0.16, cy - w * 0.16), (cx + w * 0.26, cy + w * 0.02),
                 (cx + w * 0.34, cy + w * 0.42)]
    fill_poly(cv, [shoulders], (52, 50, 48))
    m = poly_mask(cv, [shoulders], blur=1.2)
    shade(cv, m, (10, 10, 12), angle_deg=45, strength=0.7)

    hood = ellipse_pts(cx, cy - w * 0.16, w * 0.20, w * 0.21)
    fill_poly(cv, [hood], (30, 28, 30))
    lay = cv.layer()
    for i in range(26):
        t = i / 25
        pts = ellipse_pts(cx, cy - w * 0.16 + w * 0.006 * i,
                          w * (0.20 - 0.004 * i), w * (0.21 - 0.005 * i), n=90,
                          a0=math.pi * 0.05, a1=math.pi * 0.95)
        ImageDraw.Draw(lay).line(pts, fill=(120, 116, 110, 70),
                                 width=max(1, int(1.1 * ss)), joint="curve")
    cv.paste(lay, poly_mask(cv, [hood], blur=1.0))
    outline(cv, hood, (200, 198, 192), 1.8, 120)

    lay = cv.layer()
    hatch(lay, w, int(11 * ss), max(1, int(1.0 * ss)), (232, 230, 224, 60), angle=35,
          jitter=1.0, seed=12)
    cv.paste(lay, m)
    return cv.finish(grain=5.0, vign=0.36)


# ================================================================== CLAY
def clay_centreline(kind, cx, cy, S):
    """Return (points, half-width list) for one gesture study."""
    pts, th = [], []
    if kind == "hook":
        for i in range(90):
            t = i / 89
            a = math.radians(-30 + 265 * t)
            r = S * (0.34 - 0.16 * t)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 1.05))
            th.append(S * (0.105 - 0.082 * t ** 0.8))
    elif kind == "coil":
        for i in range(140):
            t = i / 139
            a = math.radians(-140 + 430 * t)
            r = S * (0.30 - 0.20 * t)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
            th.append(S * (0.085 - 0.030 * t))
    elif kind == "bulb":
        for i in range(80):
            t = i / 79
            y = cy - S * 0.26 + S * 0.62 * t
            pts.append((cx + math.sin(t * 3.0) * S * 0.03, y))
            th.append(S * 0.20 * math.sin(math.pi * (0.10 + 0.72 * t)) ** 0.75
                      * (1.0 - 0.55 * t))
    elif kind == "knee":
        for i in range(60):
            t = i / 59
            x = cx - S * 0.28 + S * 0.30 * t
            y = cy - S * 0.22 + S * 0.16 * t
            pts.append((x, y))
            th.append(S * 0.085)
        for i in range(60):
            t = i / 59
            x = cx + S * 0.02 + S * 0.26 * t
            y = cy - S * 0.06 + S * 0.28 * t
            pts.append((x, y))
            th.append(S * 0.072)
    elif kind == "tube":
        for i in range(110):
            t = i / 109
            x = cx - S * 0.30 + S * 0.60 * t
            y = cy + math.sin(t * math.pi * 2.0) * S * 0.20 - S * 0.02
            pts.append((x, y))
            th.append(S * 0.062)
    else:  # ball
        for i in range(150):
            t = i / 149
            a = math.radians(0 + 520 * t)
            r = S * (0.055 + 0.22 * t)
            pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
            th.append(S * (0.115 - 0.070 * t))
    return pts, th


def draw_clay(cv, kind, cx, cy, S, seed=0):
    pts, th = clay_centreline(kind, cx, cy, S)
    poly, L, R = ribbon(pts, th)
    fill_poly(cv, [poly], CLAY)
    m = poly_mask(cv, [poly], blur=0.9)
    shade(cv, m, CLAY_DARK, angle_deg=50, strength=0.85, gamma=1.5)
    glow(cv, cx - S * 0.12, cy - S * 0.18, S * 0.5, (255, 253, 246), strength=0.35, gamma=2.0)
    lay = cv.layer()
    contour_bands(lay, L, R, (86, 80, 70), width=max(1, int(1.0 * cv.ss)), every=5, alpha=95)
    cv.paste(lay, m)
    lay = cv.layer()
    hatch(lay, cv.w, int(10 * cv.ss), max(1, int(1.0 * cv.ss)), (92, 86, 76, 80),
          angle=118, jitter=1.0, seed=seed)
    cv.paste(lay, m)
    lay = cv.layer()
    stipple(lay, cv.w, 2600, 0.6 * cv.ss, 1.9 * cv.ss, (60, 55, 48, 70), seed=seed + 3)
    cv.paste(lay, m)
    outline(cv, poly, INK, 1.9, 205, closed=True)
    ground_shadow(cv, cx, cy + S * 0.40, S * 0.32, S * 0.035, strength=0.26)


def clay_plate(kind, final=1200, ss=2):
    cv = Cv(final, bg=BONE, ss=ss)
    draw_clay(cv, kind, cv.w * 0.5, cv.w * 0.52, cv.w * 0.80, seed=hash(kind) % 90)
    return cv.finish(grain=5.0, vign=0.30)


def clay_board(final=1400, ss=2):
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    kinds = ["hook", "coil", "bulb", "knee", "tube", "ball"]
    for i, k in enumerate(kinds):
        col, row = i % 3, i // 3
        cx = w * (0.20 + 0.30 * col)
        cy = w * (0.30 + 0.40 * row)
        draw_clay(cv, k, cx, cy, w * 0.34, seed=i * 11)
    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    for x in (0.35, 0.65):
        d.line([(w * x, w * 0.06), (w * x, w * 0.94)], fill=(150, 146, 138, 90),
               width=max(1, int(0.8 * ss)))
    d.line([(w * 0.06, w * 0.5), (w * 0.94, w * 0.5)], fill=(150, 146, 138, 90),
           width=max(1, int(0.8 * ss)))
    cv.paste(lay)
    return cv.finish(grain=5.0, vign=0.26)


# ================================================================== SURFACE
def surf_raincoat(final=1200, ss=2):
    """Teal raincoat — shelter as surface (weave + folds)."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.54
    body = [(cx - w * 0.30, cy + w * 0.40), (cx - w * 0.24, cy - w * 0.04),
            (cx - w * 0.14, cy - w * 0.18), (cx, cy - w * 0.24),
            (cx + w * 0.14, cy - w * 0.18), (cx + w * 0.24, cy - w * 0.04),
            (cx + w * 0.30, cy + w * 0.40)]
    fill_poly(cv, [body], TEAL)
    m = poly_mask(cv, [body], blur=1.2)
    shade(cv, m, TEAL_DARK, angle_deg=45, strength=0.75, gamma=1.3)

    lay = cv.layer()
    hatch(lay, w, int(7 * ss), max(1, int(1.0 * ss)), (232, 238, 236, 60), angle=0, jitter=0.6, seed=2)
    hatch(lay, w, int(7 * ss), max(1, int(1.0 * ss)), (232, 238, 236, 60), angle=90, jitter=0.6, seed=3)
    cv.paste(lay, m)

    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    for i in range(9):
        x = cx - w * 0.26 + w * 0.065 * i
        pts = [(x + math.sin(t * 3 + i) * w * 0.012, cy - w * 0.16 + w * 0.58 * t)
               for t in [j / 18 for j in range(19)]]
        d.line(pts, fill=(10, 40, 38, 150), width=max(1, int(1.6 * ss)), joint="curve")
    cv.paste(lay, m)
    hood = ellipse_pts(cx, cy - w * 0.22, w * 0.15, w * 0.13, a0=math.pi, a1=2 * math.pi)
    fill_poly(cv, [hood], TEAL_DARK)
    outline(cv, body, (16, 40, 38), 2.0, 190)
    ground_shadow(cv, cx, cy + w * 0.42, w * 0.30, w * 0.03)
    return cv.finish(grain=5.0, vign=0.30)


def surf_scarf(final=1200, ss=2):
    """Hooded scarf — the head wrapped and hidden."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.52
    head = ellipse_pts(cx, cy, w * 0.17, w * 0.20)
    fill_poly(cv, [head], (198, 190, 180))
    mh = poly_mask(cv, [head], blur=1.0)
    shade(cv, mh, (130, 124, 114), angle_deg=45, strength=0.6)

    for i, (rad, thick, shade_col) in enumerate(
            [(0.235, 0.062, (168, 160, 148)), (0.205, 0.055, (150, 142, 130)),
             (0.175, 0.048, (132, 124, 114)), (0.150, 0.042, (118, 110, 100))]):
        pts, th = [], []
        for k in range(70):
            t = k / 69
            a = math.radians(20 + 330 * t)
            rr = w * (rad - 0.02 * t)
            pts.append((cx + math.cos(a) * rr * 1.05,
                        cy + math.sin(a) * rr * 0.95 + w * 0.03 * t))
            th.append(w * (thick - 0.012 * t))
        poly, L, R = ribbon(pts, th)
        fill_poly(cv, [poly], shade_col)
        mm = poly_mask(cv, [poly], blur=0.8)
        shade(cv, mm, (78, 72, 64), angle_deg=60, strength=0.7)
        lay = cv.layer()
        contour_bands(lay, L, R, (70, 64, 58), width=max(1, int(1.0 * ss)), every=4, alpha=100)
        cv.paste(lay, mm)
        outline(cv, poly, INK, 1.7, 170, closed=True)
    return cv.finish(grain=5.0, vign=0.32)


def surf_thorn(final=1200, ss=2):
    """Thorn-wrapped head."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.52
    head = ellipse_pts(cx, cy, w * 0.16, w * 0.19)
    fill_poly(cv, [head], (206, 198, 188))
    mh = poly_mask(cv, [head], blur=1.0)
    shade(cv, mh, (140, 132, 122), angle_deg=45, strength=0.6)
    outline(cv, head, INK, 1.8, 170)

    lay = cv.layer()
    thorns(lay, cx, cy, 120, w * 0.185, w * 0.20, w * 0.0055, (40, 36, 32, 225), seed=2, curve=0.15)
    cv.paste(lay)
    lay = cv.layer()
    thorns(lay, cx, cy, 74, w * 0.20, w * 0.13, w * 0.0042, (40, 36, 32, 150), seed=8, curve=-0.2)
    cv.paste(lay)
    for dx in (-0.075, 0.075):
        e = ellipse_pts(cx + w * dx, cy - w * 0.02, w * 0.022, w * 0.016)
        fill_poly(cv, [e], (26, 24, 22))
    return cv.finish(grain=5.0, vign=0.32)


def surf_knife(final=1200, ss=2):
    """Knife-shadow behind the shower curtain — threat without a face."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    for i in range(46):
        x = w * (0.04 + 0.92 * i / 45)
        amp = w * 0.012 * (1 + 0.8 * math.sin(i * 0.9))
        pts = [(x + amp * math.sin(t * 5 + i), w * 0.05 + w * 0.90 * t)
               for t in [j / 24 for j in range(25)]]
        lay = cv.layer()
        ImageDraw.Draw(lay).line(pts, fill=(150, 146, 138, 120),
                                 width=max(1, int(1.2 * ss)), joint="curve")
        cv.paste(lay)

    blade = [(w * 0.56, w * 0.18), (w * 0.70, w * 0.30), (w * 0.58, w * 0.72),
             (w * 0.52, w * 0.70), (w * 0.545, w * 0.30)]
    fill_poly(cv, [blade], (36, 34, 32))
    m = poly_mask(cv, [blade], blur=6.0)
    lay = Image.new("RGBA", (w, w), (20, 20, 24, 255))
    a = (np.asarray(m, dtype=np.float32) * 0.55).astype(np.uint8)
    lay.putalpha(Image.fromarray(a))
    lay = lay.filter(ImageFilter.GaussianBlur(w * 0.012))
    cv.img = Image.alpha_composite(cv.img.convert("RGBA"), lay).convert("RGB")

    handle = [(w * 0.545, w * 0.70), (w * 0.585, w * 0.72), (w * 0.60, w * 0.88),
              (w * 0.555, w * 0.88)]
    fill_poly(cv, [handle], (58, 52, 46))
    outline(cv, blade, (240, 238, 232), 1.6, 150, closed=True)
    return cv.finish(grain=5.5, vign=0.36)


def surf_lungs(final=1200, ss=2):
    """Lungs ashtray — dread made solid."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.54
    dish = ellipse_pts(cx, cy + w * 0.14, w * 0.32, w * 0.11)
    fill_poly(cv, [dish], (176, 168, 158))
    md = poly_mask(cv, [dish], blur=1.0)
    shade(cv, md, (110, 102, 92), angle_deg=45, strength=0.6, gamma=1.0)
    rim = ellipse_pts(cx, cy + w * 0.10, w * 0.32, w * 0.11)
    fill_poly(cv, [rim], (198, 190, 180))
    outline(cv, rim, INK, 1.8, 170)

    for sgn in (-1, 1):
        lobe = []
        for i in range(70):
            t = i / 69
            a = math.radians(-100 + 200 * t)
            r = w * (0.115 + 0.045 * math.sin(t * 3.1))
            lobe.append((cx + sgn * (w * 0.055 + math.cos(a) * r * 0.85),
                         cy - w * 0.10 + math.sin(a) * r * 1.25))
        fill_poly(cv, [lobe], (168, 96, 84))
        m = poly_mask(cv, [lobe], blur=0.9)
        shade(cv, m, (108, 52, 42), angle_deg=45, strength=0.8)
        lay = cv.layer()
        hatch(lay, w, int(8 * ss), max(1, int(1.0 * ss)), (86, 40, 32, 120), angle=70,
              jitter=1.0, seed=(3 if sgn < 0 else 9))
        cv.paste(lay, m)
        outline(cv, lobe, (86, 34, 28), 1.8, 180, closed=False)

    lay = cv.layer()
    stipple(lay, w, 4200, 0.5 * ss, 2.0 * ss, (48, 44, 40, 120), seed=15,
            box=(cx - w * 0.30, cy + w * 0.06, cx + w * 0.30, cy + w * 0.22))
    cv.paste(lay)
    ground_shadow(cv, cx, cy + w * 0.27, w * 0.30, w * 0.035)
    return cv.finish(grain=5.0, vign=0.32)


# ================================================================== FOAM / FINAL FORM
def final_form_pts(cx, cy, S):
    """The resolved object: a mass curling inward with one hooked limb."""
    pts, th = [], []
    for i in range(120):
        t = i / 119
        a = math.radians(-40 + 250 * t)
        r = S * (0.40 - 0.30 * t ** 0.85)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r * 0.95))
        th.append(S * (0.145 - 0.118 * t ** 0.7))
    return pts, th


def draw_object(cv, cx, cy, S, stage=3, seed=0):
    """stage 0 rough block · 1 cut · 2 sanded · 3 finished."""
    w = cv.w
    ss = cv.ss
    pts, th = final_form_pts(cx, cy, S)
    poly, L, R = ribbon(pts, th)

    if stage == 0:  # blocked out: a rough mass with cut facets
        block = [(cx - S * 0.44, cy - S * 0.30), (cx + S * 0.30, cy - S * 0.42),
                 (cx + S * 0.46, cy + S * 0.16), (cx + S * 0.12, cy + S * 0.42),
                 (cx - S * 0.40, cy + S * 0.34)]
        fill_poly(cv, [block], (222, 218, 210))
        m = poly_mask(cv, [block], blur=0.8)
        shade(cv, m, (150, 144, 134), angle_deg=45, strength=0.7, gamma=1.0)
        lay = cv.layer()
        d = ImageDraw.Draw(lay)
        rnd = random.Random(seed)
        for _ in range(11):
            px = cx + rnd.uniform(-S * 0.42, S * 0.42)
            py = cy + rnd.uniform(-S * 0.38, S * 0.38)
            quad = [(px, py),
                    (px + rnd.uniform(-S * 0.22, S * 0.22), py + rnd.uniform(-S * 0.16, S * 0.10)),
                    (px + rnd.uniform(-S * 0.18, S * 0.24), py + rnd.uniform(S * 0.02, S * 0.24)),
                    (px + rnd.uniform(-S * 0.24, S * 0.10), py + rnd.uniform(-S * 0.02, S * 0.16))]
            d.polygon(quad, fill=(196, 190, 180, 130), outline=(120, 114, 104, 120))
        cv.paste(lay, m)
        shape = [block]
    else:
        fill_poly(cv, [poly], (228, 224, 216) if stage < 3 else (232, 228, 220))
        m = poly_mask(cv, [poly], blur=0.9)
        shade(cv, m, (146, 140, 130), angle_deg=50,
              strength=0.80 if stage < 3 else 0.62,
              gamma=1.6 if stage >= 2 else 1.1)
        if stage == 1:
            lay = cv.layer()
            d = ImageDraw.Draw(lay)
            for i in range(0, len(L), 14):
                d.line([L[i], R[i]], fill=(120, 114, 104, 150),
                       width=max(1, int(1.6 * ss)))
            cv.paste(lay, m)
        shape = [poly]

    m = poly_mask(cv, shape, blur=0.8)
    dens = {0: 26000, 1: 20000, 2: 12000, 3: 6000}[stage]
    lay = cv.layer()
    bead_speckle(lay, w, dens, 0.5 * ss, (2.2 if stage < 2 else 1.5) * ss, seed=seed)
    cv.paste(lay, m)

    if stage >= 2:
        lay = cv.layer()
        contour_bands(lay, L if stage >= 1 else [], R if stage >= 1 else [],
                      (110, 104, 94), width=max(1, int(0.9 * ss)),
                      every=7, alpha=(80 if stage == 3 else 120))
        cv.paste(lay, poly_mask(cv, [poly], blur=0.8))
        glow(cv, cx - S * 0.16, cy - S * 0.22, S * 0.55, (255, 255, 252),
             strength=0.42 if stage == 3 else 0.22, gamma=2.0)

    outline(cv, shape[0], INK, 2.0, 200, closed=True)
    ground_shadow(cv, cx, cy + S * 0.46, S * 0.40, S * 0.045, strength=0.28)


def foam_plate(stage, final=1200, ss=2):
    cv = Cv(final, bg=BONE, ss=ss)
    draw_object(cv, cv.w * 0.5, cv.w * 0.52, cv.w * 0.82, stage=stage, seed=stage * 7)
    return cv.finish(grain=5.0, vign=0.30)


def foam_detail(final=1200, ss=2):
    """Close-up: the cut facet against the sanded hollow."""
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.5
    mass = [(w * 0.06, w * 0.92), (w * 0.10, w * 0.30), (w * 0.34, w * 0.16),
            (w * 0.62, w * 0.20), (w * 0.88, w * 0.44), (w * 0.90, w * 0.88)]
    fill_poly(cv, [mass], (224, 220, 212))
    m = poly_mask(cv, [mass], blur=1.0)
    shade(cv, m, (140, 134, 124), angle_deg=45, strength=0.7, gamma=1.4)

    lay = cv.layer()
    d = ImageDraw.Draw(lay)
    rnd = random.Random(5)
    for _ in range(16):
        px = rnd.uniform(w * 0.10, w * 0.88)
        py = rnd.uniform(w * 0.18, w * 0.90)
        s = rnd.uniform(w * 0.06, w * 0.20)
        d.polygon([(px, py), (px + s, py + s * rnd.uniform(-0.4, 0.3)),
                   (px + s * rnd.uniform(0.7, 1.3), py + s * rnd.uniform(0.7, 1.2)),
                   (px - s * 0.2, py + s * 0.8)],
                  fill=(200, 194, 184, 110), outline=(118, 112, 102, 130))
    cv.paste(lay, m)
    lay = cv.layer()
    bead_speckle(lay, w, 34000, 0.6 * ss, 2.6 * ss, seed=6)
    cv.paste(lay, m)
    hollow = ellipse_pts(w * 0.60, w * 0.52, w * 0.26, w * 0.22)
    lay = cv.layer()
    hatch(lay, w, int(6 * ss), max(1, int(1.1 * ss)), (110, 104, 94, 110), angle=125,
          jitter=1.0, seed=4)
    cv.paste(lay, poly_mask(cv, [hollow], blur=2.0))
    return cv.finish(grain=5.5, vign=0.34)


# ================================================================== MOCKUPS
def mock_plate(view, final=1200, ss=2):
    cv = Cv(final, bg=BONE, ss=ss)
    w = cv.w
    cx, cy = w * 0.5, w * 0.52
    S = w * 0.40 if view == "top" else w * 0.82

    if view == "top":
        lay = cv.layer()
        spiral_arms(lay, cx, cy, arms=3, turns=2.3, r0=S * 0.95, r1=S * 0.06,
                    color=(60, 56, 50), width0=int(3.0 * ss), width1=int(3.0 * ss),
                    alpha0=200, alpha1=200, seed=1, seg=220, wobble=0.004)
        cv.paste(lay)
        m = Image.new("L", (w, w), 0)
        ImageDraw.Draw(m).ellipse([cx - S, cy - S, cx + S, cy + S], fill=255)
        m = m.filter(ImageFilter.GaussianBlur(3 * ss))
        lay = cv.layer()
        hatch(lay, w, int(9 * ss), max(1, int(1.0 * ss)), (120, 114, 104, 120), angle=95,
              jitter=0.8, seed=2)
        cv.paste(lay, m)
        ImageDraw.Draw(cv.img).ellipse([cx - S, cy - S, cx + S, cy + S],
                                       outline=(30, 28, 26), width=int(2.0 * ss))
    elif view == "silhouette":
        pts, th = final_form_pts(cx, cy, S)
        poly, _, _ = ribbon(pts, th)
        fill_poly(cv, [poly], (26, 24, 24))
    elif view == "grid":
        pts, th = final_form_pts(cx, cy, S)
        poly, L, R = ribbon(pts, th)
        fill_poly(cv, [poly], (224, 219, 209))
        m = poly_mask(cv, [poly], blur=0.9)
        shade(cv, m, (148, 142, 132), angle_deg=50, strength=0.6, gamma=1.6)
        lay = cv.layer()
        contour_bands(lay, L, R, (112, 106, 96), width=max(1, int(0.9 * ss)), every=7, alpha=80)
        cv.paste(lay, m)
        glow(cv, cx - S * 0.16, cy - S * 0.22, S * 0.55, (255, 255, 252), strength=0.4, gamma=2.0)
        lay = cv.layer()
        bead_speckle(lay, w, 5000, 0.5 * ss, 1.4 * ss, seed=4)
        cv.paste(lay, m)
        outline(cv, poly, INK, 2.0, 200)
        lay = cv.layer()
        d = ImageDraw.Draw(lay)
        for i in range(9):
            x = w * (0.08 + 0.84 * i / 8)
            d.line([(x, w * 0.86), (x, w * 0.90)], fill=(110, 106, 98, 170),
                   width=max(1, int(1.2 * ss)))
        d.line([(w * 0.08, w * 0.88), (w * 0.92, w * 0.88)], fill=(110, 106, 98, 170),
               width=max(1, int(1.2 * ss)))
        cv.paste(lay)
        ground_shadow(cv, cx, cy + S * 0.46, S * 0.40, S * 0.045, strength=0.26)
    elif view == "front":
        pts, th = final_form_pts(cx, cy, S)
        poly, L, R = ribbon(pts, th)
        fill_poly(cv, [poly], (224, 219, 209))
        m = poly_mask(cv, [poly], blur=0.9)
        shade(cv, m, (150, 144, 134), angle_deg=75, strength=0.7, gamma=1.5)
        lay = cv.layer()
        contour_bands(lay, L, R, (112, 106, 96), width=max(1, int(0.9 * ss)), every=7, alpha=85)
        cv.paste(lay, m)
        glow(cv, cx - S * 0.16, cy - S * 0.22, S * 0.55, (255, 255, 252), strength=0.40, gamma=2.0)
        lay = cv.layer()
        bead_speckle(lay, w, 6000, 0.5 * ss, 1.5 * ss, seed=4)
        cv.paste(lay, m)
        outline(cv, poly, INK, 2.0, 200)
        ground_shadow(cv, cx, cy + S * 0.46, S * 0.40, S * 0.045, strength=0.28)
    else:  # three-quarter
        pts, th = final_form_pts(cx, cy, S)
        pts = [(cx + (p[0] - cx) * 0.86, cy + (p[1] - cy) * 1.02) for p in pts]
        th = [t * 0.94 for t in th]
        poly, L, R = ribbon(pts, th)
        fill_poly(cv, [poly], (222, 217, 206))
        m = poly_mask(cv, [poly], blur=0.9)
        shade(cv, m, (144, 138, 128), angle_deg=45, strength=0.78, gamma=1.4)
        lay = cv.layer()
        contour_bands(lay, L, R, (110, 104, 94), width=max(1, int(0.9 * ss)), every=7, alpha=90)
        cv.paste(lay, m)
        glow(cv, cx - S * 0.20, cy - S * 0.26, S * 0.55, (255, 255, 252), strength=0.38, gamma=2.0)
        lay = cv.layer()
        bead_speckle(lay, w, 6500, 0.5 * ss, 1.5 * ss, seed=9)
        cv.paste(lay, m)
        outline(cv, poly, INK, 2.0, 205)
        ground_shadow(cv, cx + S * 0.10, cy + S * 0.46, S * 0.42, S * 0.05, strength=0.30)
    return cv.finish(grain=5.0, vign=0.30)


# ================================================================== driver
PLATES = {
    "cover": lambda: cover_art(),
    "angst-hedgehog": lambda: plate_spines(),
    "angst-armadillo": lambda: plate_bands(),
    "angst-turtle": lambda: plate_shell(),
    "angst-kangaroo": lambda: plate_flight(),
    "angst-koala": lambda: plate_cling(),
    "angst-vertigo": lambda: plate_spiral(),
    "angst-panic": lambda: plate_scream(),
    "angst-hood": lambda: plate_hood(),
    "clay-board": lambda: clay_board(),
    "clay-hook": lambda: clay_plate("hook"),
    "clay-coil": lambda: clay_plate("coil"),
    "clay-bulb": lambda: clay_plate("bulb"),
    "clay-knee": lambda: clay_plate("knee"),
    "clay-tube": lambda: clay_plate("tube"),
    "clay-ball": lambda: clay_plate("ball"),
    "surf-raincoat": lambda: surf_raincoat(),
    "surf-scarf": lambda: surf_scarf(),
    "surf-thorn": lambda: surf_thorn(),
    "surf-knife": lambda: surf_knife(),
    "surf-lungs": lambda: surf_lungs(),
    "foam-1": lambda: foam_plate(0),
    "foam-2": lambda: foam_plate(1),
    "foam-3": lambda: foam_plate(2),
    "foam-4": lambda: foam_plate(3),
    "foam-detail": lambda: foam_detail(),
    "mock-1": lambda: mock_plate("front"),
    "mock-2": lambda: mock_plate("three-quarter"),
    "mock-3": lambda: mock_plate("top"),
    "mock-4": lambda: mock_plate("grid"),
    "mock-5": lambda: mock_plate("silhouette"),
}


def main(argv):
    os.makedirs(OUT, exist_ok=True)
    names = [a for a in argv[1:] if a in PLATES] or list(PLATES)
    for name in names:
        img = PLATES[name]()
        path = os.path.join(OUT, name + ".jpg")
        img.save(path, "JPEG", quality=90, optimize=True, progressive=True)
        print(f"  {name}.jpg  {img.size[0]}px  {os.path.getsize(path)//1024} KB")
    print(f"{len(names)} plate(s) -> {OUT}")


if __name__ == "__main__":
    main(sys.argv)
