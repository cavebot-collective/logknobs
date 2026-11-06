#!/usr/bin/env python3
"""
logknobs brand asset generator.

The mark is authored parametrically rather than drawn, because the knob glyph
is not decoration -- it is the product's central control, and the SAME geometry
is reused by the live UI (knob.js renders from these same constants). A traced
raster would give wobbly paths and no shared source of truth.

The wordmark substitutes a rotary knob for each 'o' in "logknobs". There are
two, and they are set to different angles on purpose: a panel of knobs at
identical positions reads as decoration, while knobs at different positions
reads as a panel in use. The angles are the two that matter to the product --
the first 'o' at the minimum of its sweep, the second near maximum.

Geometry, all in a 100-unit glyph box so it scales with font-size:
  - body      r=42, monoline stroke, matching the wordmark's stem weight
  - indicator a radius line from the hub to the rim, at the knob's angle
  - ticks     marks around the sweep arc, evidence the control is discrete
Sweep runs -135deg..+135deg (270deg total), the convention for a physical
panel knob: the dead zone points down, so "off" is unambiguous.
"""
from __future__ import annotations
import math, pathlib, sys, json

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
OUT.mkdir(parents=True, exist_ok=True)

# --- tunables: config, never code constants -------------------------------
CFG = {
    "knob.radius": 42,
    "knob.stroke": 11,
    "knob.hub.radius": 5,
    "knob.indicator.inset": 9,
    "knob.sweep.start_deg": -135,
    "knob.sweep.end_deg": 135,
    "knob.tick.count": 7,
    "knob.tick.len": 7,
    "knob.tick.gap": 9,
    "wordmark.angle.first_o": -135,   # first 'o' parked at minimum
    "wordmark.angle.second_o": 68,    # second 'o' turned up
}
INK, ACCENT, MUTE = "#e8eaed", "#e8b04a", "#7d8a9a"


def pol(cx, cy, r, deg):
    a = math.radians(deg - 90)              # 0deg = up
    return cx + r * math.sin(math.radians(deg)), cy - r * math.cos(math.radians(deg))


def knob(cx, cy, scale=1.0, angle=0.0, ink=INK, accent=ACCENT, ticks=True, mute=MUTE):
    """One knob glyph. Returns SVG fragment; all geometry derives from CFG."""
    R = CFG["knob.radius"] * scale
    sw = CFG["knob.stroke"] * scale
    hub = CFG["knob.hub.radius"] * scale
    p = [f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{R:.2f}" fill="none" '
         f'stroke="{ink}" stroke-width="{sw:.2f}"/>']
    if ticks:
        n, tl = CFG["knob.tick.count"], CFG["knob.tick.len"] * scale
        r0 = R + CFG["knob.tick.gap"] * scale + sw / 2
        a0, a1 = CFG["knob.sweep.start_deg"], CFG["knob.sweep.end_deg"]
        for i in range(n):
            a = a0 + (a1 - a0) * i / (n - 1)
            x0, y0 = pol(cx, cy, r0, a); x1, y1 = pol(cx, cy, r0 + tl, a)
            on = a <= angle + 0.01
            p.append(f'<line x1="{x0:.2f}" y1="{y0:.2f}" x2="{x1:.2f}" y2="{y1:.2f}" '
                     f'stroke="{accent if on else mute}" stroke-width="{sw*0.42:.2f}" '
                     f'stroke-linecap="round"/>')
    ix, iy = pol(cx, cy, R - CFG["knob.indicator.inset"] * scale - sw / 2, angle)
    p.append(f'<line x1="{cx:.2f}" y1="{cy:.2f}" x2="{ix:.2f}" y2="{iy:.2f}" '
             f'stroke="{accent}" stroke-width="{sw*0.85:.2f}" stroke-linecap="round"/>')
    p.append(f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{hub:.2f}" fill="{accent}"/>')
    return "\n    ".join(p)


# --- wordmark -------------------------------------------------------------
# The letters are SET, not drawn. An earlier revision hand-rolled monoline
# glyphs for l/g/k/n/b/s and produced a broken 'k' and an oversized 'b' bowl --
# drawing a typeface was scope creep, and badly done scope creep. The word is
# now set in the same monospace stack the app itself uses, so the mark and the
# product share a voice, and only the two 'o's are replaced by knob geometry.
#
# Consequence, stated rather than hidden: these SVGs depend on a system font.
# That is correct for web and app use. A path-outlined lockup for print or
# embroidery requires choosing and licensing a face first, and is NOT produced
# here -- shipping a "final" logo with an unresolved font dependency silently
# would be the failure mode.
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace"
ADV = 104          # monospace advance at 100-unit em, measured below
BASE = 116         # baseline within the 150-unit box
# The knob must sit on the letters' optical center, not the box's. Monospace
# x-height is ~0.52em, so at font-size 132 the x-height band centers about
# 34 units above the baseline. An earlier revision centered at y=58 and the
# knobs visibly floated above the word.
O_CY = BASE - 34
O_SCALE = 0.84


def wordmark(ink=INK, accent=ACCENT, mute=MUTE, ticks=True):
    """l o g k n o b s -- letters set in monospace, both o's replaced by knobs."""
    seq = "logknobs"
    angles = [CFG["wordmark.angle.first_o"], CFG["wordmark.angle.second_o"]]
    parts, ki = [], 0
    for i, ch in enumerate(seq):
        x = i * ADV
        if ch == "o":
            cx = x + ADV / 2
            parts.append(f'<g transform="translate({cx-50:.1f},0)">'
                         + knob(50, O_CY, O_SCALE, angles[ki], ink, accent, ticks, mute) + "</g>")
            ki += 1
        else:
            parts.append(f'<text x="{x + ADV/2:.1f}" y="{BASE}" font-family="{FONT}" '
                         f'font-size="132" font-weight="500" fill="{ink}" '
                         f'text-anchor="middle" letter-spacing="0">{ch}</text>')
    return len(seq) * ADV, "\n  ".join(parts)


def svg(body, w, h, extra="", sized=False):
    # No width/height by default: an explicit size defeats CSS sizing, which is
    # how every real consumer (favicon, app header, README) places these.
    dim = f' width="{w:.0f}" height="{h:.0f}"' if sized else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}"'
            f'{dim} role="img">{extra}\n  {body}\n</svg>\n')


def main():
    files = {}
    # 1. full lockup, dark-surface
    w, body = wordmark()
    files["logknobs-wordmark.svg"] = svg(body, w, 150, '<title>logknobs</title>')
    # small-size lockup: ticks fill in and turn to fuzz below ~180px, so the
    # sub-180px variant drops them rather than rendering mud
    ws, bodys = wordmark(ticks=False)
    files["logknobs-wordmark-small.svg"] = svg(bodys, ws, 150, '<title>logknobs</title>')
    # 2. light-surface variant
    w2, body2 = wordmark(ink="#1b2430", accent="#c07f12", mute="#9aa7b5")
    files["logknobs-wordmark-light.svg"] = svg(body2, w2, 150, '<title>logknobs</title>')
    # 3. monochrome (single ink: print, embroidery, favicons at 1 color)
    w3, body3 = wordmark(ink="#000", accent="#000", mute="#000")
    files["logknobs-wordmark-mono.svg"] = svg(body3, w3, 150, '<title>logknobs</title>')
    # 4. app mark: one knob, no ticks below 32px (they fill in and turn to mud)
    files["logknobs-mark.svg"] = svg(knob(64, 64, 1.28, 68), 128, 128, '<title>logknobs mark</title>')
    files["logknobs-mark-small.svg"] = svg(knob(64, 64, 1.28, 68, ticks=False), 128, 128,
                                           '<title>logknobs mark</title>')
    # 5. favicon: mark on the app's terminal background, square
    fav = (f'<rect width="128" height="128" rx="26" fill="#121821"/>\n  '
           + knob(64, 64, 1.16, 68, ticks=False))
    files["logknobs-favicon.svg"] = svg(fav, 128, 128, '<title>logknobs</title>')

    for name, content in files.items():
        (OUT / name).write_text(content)
    (OUT / "brand-tokens.json").write_text(json.dumps(
        {"config": CFG, "colors": {"ink": INK, "accent": ACCENT, "mute": MUTE,
                                   "surface": "#121821", "panel": "#232d3b"}}, indent=1))
    print(f"wrote {len(files)} SVGs + brand-tokens.json to {OUT}")
    for n in files:
        print(f"  {n:<34} {len((OUT/n).read_text())} bytes")


if __name__ == "__main__":
    main()
