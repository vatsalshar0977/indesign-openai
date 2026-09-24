# ANGST — the book pipeline

Everything here is generated in code. No InDesign, no AI imagery.

    python3 -m venv /tmp/bookenv
    /tmp/bookenv/bin/pip install reportlab pillow numpy fonttools brotli

    /tmp/bookenv/bin/python book/art/make_art.py          # draw all 31 plates
    /tmp/bookenv/bin/python book/make_book.py \
        --spec book/angst.json --images book/images --out book/ANGST.pdf

Output: `ANGST.pdf` — 297 × 297 mm, 24 mm margins, ~27 pages.

## What is what

| Path | |
|---|---|
| `angst.json` | the book: title, trim, fonts, colours, chapters and all copy |
| `make_book.py` | JSON → print-ready PDF (cover, title page, contents with page numbers, chapter openers, running heads, folios, image grids) |
| `art/make_art.py` | every plate, drawn computationally |
| `fonts/` | Anton (display), Source Serif 4 (body), Inter (labels), converted from OFL packages |
| `images/` | generated plates, one JPEG per figure |

## How the plates are drawn

No stock or AI imagery. Each plate is composed from printmaking techniques,
combined per figure:

- **hatch / cross-hatch** — ruled lines clipped to a shape
- **stipple** — density-weighted dots
- **bead speckle** — paired light/dark dots for thermocol foam
- **radial line work** — lines converging on or radiating from a point
- **spiral arms** — logarithmic vortex arms (the Vertigo plate and the cover)
- **contour banding** — cross-sections ruled across a ribbon form
- **thorns** — tapered spikes (armour: hedgehog, thorn-wrapped head)
- **woodcut faceting** — flat cut planes with hard edges
- **mezzotint gradient** — smooth tonal ramp composited through a mask
- **grain + vignette** — paper texture

Each plate renders at 2× and downsamples, so lines stay smooth at 297 mm.

## Swapping in your own photographs

Every figure is referenced by filename in `angst.json`. Drop a JPEG with the
same name into `images/` and rebuild — nothing else changes. To see which
image goes where:

    /tmp/bookenv/bin/python -c "import json;print('\n'.join(
        b.get('file','') for c in json.load(open('book/angst.json'))['chapters']
        for b in c['blocks'] if b.get('file')))"

## Editing the book

`angst.json` is the only file you need to touch for content:

- `chapters[]` — one entry per chapter; `title`, `epigraph`, `blocks[]`
- block types: `text`, `heading`, `quote`, `image`, `gallery`, `spacer`, `pagebreak`, `rule`
- `trim`, `margin_mm` — page geometry
- `fonts`, `display`, `label`, `body` — typography
- `colors`, `paper`, `cover` — palette and cover treatment
