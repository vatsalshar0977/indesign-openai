#!/usr/bin/env python3
"""
Typeset a book from a JSON spec into a print-ready PDF (square / any trim).

    python3 -m venv /tmp/bookenv && /tmp/bookenv/bin/pip install reportlab pillow numpy
    /tmp/bookenv/bin/python book/art/make_art.py          # draw the plates
    /tmp/bookenv/bin/python book/make_book.py --spec book/angst.json \
        --images book/images --out book/ANGST.pdf

Spec format (see book/book.json for a minimal example):

{
  "title": "ANGST", "subtitle": "…", "author": "…",
  "trim":   {"width_mm": 297, "height_mm": 297, "margin_mm": 24},
  "paper":  "#faf8f4",
  "cover":  {"image": "cover.jpg", "background": "#0e1013", "title_color": "#f4f4f2",
             "scrim": true, "scrim_alpha": 0.55, "kicker": "…"},
  "fonts":  {"Anton": "fonts/Anton-Regular.ttf", …},
  "body":    {"font": "SourceSerif4", "size_pt": 11.5, "leading_pt": 18.5},
  "display": {"font": "Anton", "size_pt": 40},
  "label":   {"font": "Inter", "size_pt": 8.5},
  "colors": {"ink": "#1a1a1a", "muted": "#6b6b6b", "accent": "#a33820"},
  "chapters": [{"title": "…", "epigraph": "…", "blocks": [ … ]}],
  "colophon": "…"
}

Block types: text, heading, quote, image, gallery, spacer, pagebreak, rule.
"""

import argparse
import json
import os
import sys

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm as MM
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (BaseDocTemplate, Frame, Image, NextPageTemplate,
                                    PageBreak, PageTemplate, Paragraph, Spacer, Table,
                                    TableStyle)
    from PIL import Image as PILImage
except ImportError:
    sys.exit("Missing libraries. Run:\n"
             "  python3 -m venv /tmp/bookenv && /tmp/bookenv/bin/pip install reportlab pillow\n"
             "then use /tmp/bookenv/bin/python to run this script.")


# ------------------------------------------------------------------ fonts
def register_fonts(spec, book_dir):
    fonts = spec.get("fonts") or {}
    for name, rel in fonts.items():
        path = rel if os.path.isabs(rel) else os.path.join(book_dir, rel)
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
        else:
            print(f"  ! font not found, falling back: {path}")
    fam = spec.get("families") or {}
    for family, members in fam.items():
        try:
            pdfmetrics.registerFontFamily(family, **members)
        except Exception as exc:
            print(f"  ! font family {family}: {exc}")


# ------------------------------------------------------------------ helpers
def hex_color(value, default):
    try:
        return colors.HexColor(value)
    except Exception:
        return default


def fit_image(path, max_w, max_h):
    """Return (width, height) in points that fits inside the box, keeping ratio."""
    with PILImage.open(path) as img:
        w, h = img.size
    ratio = min(max_w / w, max_h / h)
    return w * ratio, h * ratio


def tracked_width(text, font, size, tracking):
    return (sum(pdfmetrics.stringWidth(ch, font, size) for ch in text)
            + tracking * max(0, len(text) - 1))


def draw_tracked(canvas, text, font, size, x, y, tracking, color=None):
    """Glyph-by-glyph tracking (reportlab 5 has no canvas.setCharSpace)."""
    canvas.setFont(font, size)
    if color is not None:
        canvas.setFillColor(color)
    for ch in text:
        canvas.drawString(x, y, ch)
        x += pdfmetrics.stringWidth(ch, font, size) + tracking


def centred_text(canvas, text, font, size, y, page_w, color, char_space=0.0):
    w = tracked_width(text, font, size, char_space)
    draw_tracked(canvas, text, font, size, (page_w - w) / 2.0, y, char_space, color)


def spiral_mark(canvas, cx, cy, r0, r1, turns, arms, alpha=0.10, width=0.5):
    """A faint engraved vortex drawn with the PDF canvas itself."""
    canvas.saveState()
    canvas.setStrokeColor(colors.Color(0.08, 0.08, 0.10, alpha=alpha))
    canvas.setLineWidth(width)
    import math
    for k in range(arms):
        phase = 2 * math.pi * k / arms
        path = canvas.beginPath()
        steps = 240
        for i in range(steps + 1):
            t = i / steps
            a = phase + turns * 2 * math.pi * t
            r = r0 * (r1 / r0) ** t
            x, y = cx + math.cos(a) * r, cy + math.sin(a) * r
            if i == 0:
                path.moveTo(x, y)
            else:
                path.lineTo(x, y)
        canvas.drawPath(path, stroke=1, fill=0)
    canvas.restoreState()


def hairline(width, color):
    t = Table([[""]], colWidths=[width], rowHeights=[1])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.7, color),
                           ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


# ------------------------------------------------------------------ blocks
def opener_story(chapter, styles, content_h):
    out = [Spacer(1, content_h * 0.26),
           Paragraph(f"{chapter.get('_index', 1):02d}", styles["opener_number"]),
           Spacer(1, 8),
           hairline(54, styles["_accent"]),
           Spacer(1, 22),
           Paragraph(chapter.get("title", ""), styles["chapter_heading"]),
           Spacer(1, 14)]
    if chapter.get("epigraph"):
        out.append(Paragraph(chapter["epigraph"], styles["epigraph"]))
    return out


def blocks_story(chapter, styles, images_dir, content_w, content_h, body_cfg):
    out = []
    text_style = styles["body"]
    caption_style = styles["caption"]
    for block in chapter.get("blocks", []):
        kind = block.get("type", "text")

        if kind == "text":
            for para in [p.strip() for p in str(block.get("text", "")).split("\n\n") if p.strip()]:
                out.append(Paragraph(para.replace("\n", "<br/>"), text_style))
                out.append(Spacer(1, body_cfg.get("paragraph_space_pt", 8)))

        elif kind == "heading":
            out.append(Spacer(1, 10))
            out.append(Paragraph(block.get("text", ""), styles["section_heading"]))
            out.append(Spacer(1, 5))

        elif kind == "quote":
            out.append(Spacer(1, 14))
            out.append(hairline(40, styles["_accent"]))
            out.append(Spacer(1, 10))
            out.append(Paragraph(block.get("text", ""), styles["quote"]))
            if block.get("attribution"):
                out.append(Spacer(1, 6))
                out.append(Paragraph(block["attribution"], styles["attribution"]))
            out.append(Spacer(1, 14))

        elif kind == "rule":
            out.append(Spacer(1, 8))
            out.append(hairline(content_w * float(block.get("width", 0.25)),
                                styles["_rule"]))
            out.append(Spacer(1, 8))

        elif kind == "image":
            rel = block.get("file") or block.get("path") or ""
            path = rel if os.path.isabs(rel) else (os.path.join(images_dir, rel) if rel else "")
            box_h = min(float(block.get("height_mm", 130)) * MM, content_h * 0.82)
            frame = frame_for(cv_path(path), styles, content_w, box_h,
                              caption_style, block.get("caption"),
                              str(block.get("file") or "image"))
            out.append(Spacer(1, 8))
            out.append(frame)
            out.append(Spacer(1, 12))

        elif kind == "gallery":
            items = block.get("images") or []
            cols = max(1, int(block.get("cols", 2)))
            gutter = float(block.get("gutter_mm", 8)) * MM
            cell_h = float(block.get("cell_height_mm", 90)) * MM
            cell_w = (content_w - gutter * (cols - 1)) / float(cols)
            cap_h = (caption_style.fontSize * 1.35 + 6) if any(
                (i if isinstance(i, str) else i.get("caption")) for i in items) else 0.0
            img_h = max(20 * MM, cell_h - cap_h)
            rows = [items[i:i + cols] for i in range(0, len(items), cols)]
            data, cmds = [], []
            for row in rows:
                cells = []
                for item in row:
                    if isinstance(item, str):
                        rel, cap = item, ""
                    else:
                        rel, cap = (item.get("file") or ""), (item.get("caption") or "")
                    path = rel if os.path.isabs(rel) else (os.path.join(images_dir, rel) if rel else "")
                    flow = []
                    if cv_path(path):
                        w, h = fit_image(path, cell_w, img_h)
                        img = Image(path, width=w, height=h)
                        img.hAlign = "CENTER"
                        flow.append(img)
                    else:
                        flow.append(placeholder(cell_w, img_h, styles, cap))
                        print(f"  ! image missing, drew a placeholder: {path or '(none)'}")
                    if cap:
                        flow.append(Spacer(1, 5))
                        flow.append(Paragraph(cap, caption_style))
                    cells.append(flow)
                while len(cells) < cols:
                    cells.append("")
                data.append(cells)
            grid = Table(data, colWidths=[cell_w] * cols, rowHeights=[cell_h] * len(rows))
            cmds += [("VALIGN", (0, 0), (-1, -1), "TOP"),
                     ("LEFTPADDING", (0, 0), (-1, -1), 0),
                     ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                     ("TOPPADDING", (0, 0), (-1, -1), 0),
                     ("BOTTOMPADDING", (0, 0), (-1, -1), gutter / 2.0)]
            grid.setStyle(TableStyle(cmds))
            out.append(Spacer(1, 8))
            out.append(grid)
            out.append(Spacer(1, 12))

        elif kind == "spacer":
            out.append(Spacer(1, float(block.get("height_mm", 6)) * MM))

        elif kind == "pagebreak":
            out.append(PageBreak())

    return out


def cv_path(path):
    return path if path and os.path.exists(path) else None


def placeholder(w, h, styles, label=""):
    frame = Table([[""]], colWidths=[w], rowHeights=[h])
    frame.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#c2bdb4")),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f2efe9")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2ded6"))]))
    return frame


def frame_for(path, styles, content_w, box_h, caption_style, caption, label):
    """One image (or placeholder) with its caption, as a single flowable stack."""
    if path:
        w, h = fit_image(path, content_w, box_h)
        img = Image(path, width=w, height=h)
        img.hAlign = "CENTER"
        body, pad = img, (content_w - w) / 2.0
    else:
        body, pad = placeholder(content_w, box_h, styles, label), 0.0
        print(f"  ! image missing, drew a placeholder: {label}")
    flow = [[body]]
    if caption:
        flow.append([Spacer(1, 6)])
        flow.append([Paragraph(caption, caption_style)])
    t = Table(flow, colWidths=[content_w])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("ALIGN", (0, 0), (-1, -1), "CENTER")]))
    return t


# ------------------------------------------------------------------ document
def build(spec, book_dir, images_dir, out_path, toc_pages=None, record=None):
    trim = spec.get("trim") or {}
    page_w = float(trim.get("width_mm", 210)) * MM
    page_h = float(trim.get("height_mm", 210)) * MM
    margin = float(trim.get("margin_mm", 22)) * MM

    body_cfg = spec.get("body") or {}
    disp_cfg = spec.get("display") or {}
    label_cfg = spec.get("label") or {}
    body_font = body_cfg.get("font", "Helvetica")
    disp_font = disp_cfg.get("font", body_font)
    label_font = label_cfg.get("font", body_font)

    body_size = float(body_cfg.get("size_pt", 11))
    leading = float(body_cfg.get("leading_pt", body_size * 1.6))
    ink = hex_color((spec.get("colors") or {}).get("ink", "#1a1a1a"), colors.HexColor("#1a1a1a"))
    muted = hex_color((spec.get("colors") or {}).get("muted", "#6b6b6b"), colors.HexColor("#6b6b6b"))
    accent = hex_color((spec.get("colors") or {}).get("accent", "#a33820"), colors.HexColor("#a33820"))
    paper = hex_color(spec.get("paper", "#ffffff"), colors.white)
    rule = colors.Color(0.45, 0.44, 0.41, alpha=0.35)

    register_fonts(spec, book_dir)

    base = getSampleStyleSheet()
    cover_cfg = spec.get("cover") or {}
    styles = {
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName=body_font,
                               fontSize=body_size, leading=leading, alignment=TA_JUSTIFY,
                               textColor=ink,
                               firstLineIndent=float(body_cfg.get("first_line_indent_pt", 0))),
        "chapter_heading": ParagraphStyle("chapter_heading", parent=base["Title"],
                                          fontName=disp_font,
                                          fontSize=float(disp_cfg.get("size_pt", 40)),
                                          leading=float(disp_cfg.get("size_pt", 40)) * 1.15,
                                          alignment=TA_CENTER, textColor=ink, spaceAfter=6),
        "opener_number": ParagraphStyle("opener_number", parent=base["BodyText"],
                                        fontName=disp_font,
                                        fontSize=float(disp_cfg.get("size_pt", 40)) * 0.52,
                                        leading=float(disp_cfg.get("size_pt", 40)) * 0.6,
                                        alignment=TA_CENTER, textColor=accent),
        "section_heading": ParagraphStyle("section_heading", parent=base["Heading2"],
                                          fontName=label_font,
                                          fontSize=float(label_cfg.get("size_pt", 8.5)) + 1.5,
                                          leading=float(label_cfg.get("size_pt", 8.5)) * 2.0,
                                          textColor=ink, spaceBefore=6, spaceAfter=3),
        "quote": ParagraphStyle("quote", parent=base["BodyText"], fontName=body_font,
                                fontSize=body_size * 1.22, leading=leading * 1.25,
                                leftIndent=26, rightIndent=26, alignment=TA_CENTER,
                                textColor=ink),
        "attribution": ParagraphStyle("attribution", parent=base["BodyText"],
                                      fontName=label_font,
                                      fontSize=float(label_cfg.get("size_pt", 8.5)),
                                      leading=float(label_cfg.get("size_pt", 8.5)) * 1.5,
                                      alignment=TA_CENTER, textColor=muted),
        "caption": ParagraphStyle("caption", parent=base["BodyText"], fontName=label_font,
                                  fontSize=float(label_cfg.get("size_pt", 8.5)),
                                  leading=float(label_cfg.get("size_pt", 8.5)) * 1.45,
                                  alignment=TA_CENTER, textColor=muted,
                                  spaceBefore=2),
        "epigraph": ParagraphStyle("epigraph", parent=base["BodyText"], fontName=body_font,
                                   fontSize=body_size * 1.02, leading=body_size * 1.65,
                                   alignment=TA_CENTER, textColor=muted),
        "toc_entry": ParagraphStyle("toc_entry", parent=base["BodyText"], fontName=body_font,
                                    fontSize=body_size * 1.05, leading=body_size * 2.1,
                                    textColor=ink),
        "toc_number": ParagraphStyle("toc_number", parent=base["BodyText"], fontName=disp_font,
                                     fontSize=body_size * 1.1, leading=body_size * 2.1,
                                     textColor=accent),
        "title_page_title": ParagraphStyle("title_page_title", parent=base["Title"],
                                           fontName=disp_font,
                                           fontSize=float(disp_cfg.get("size_pt", 40)) * 1.5,
                                           leading=float(disp_cfg.get("size_pt", 40)) * 1.6,
                                           alignment=TA_CENTER, textColor=ink),
        "title_page_sub": ParagraphStyle("title_page_sub", parent=base["Normal"],
                                         fontName=body_font, fontSize=body_size * 1.15,
                                         leading=body_size * 1.8, alignment=TA_CENTER,
                                         textColor=muted),
        "colophon": ParagraphStyle("colophon", parent=base["BodyText"], fontName=label_font,
                                   fontSize=float(label_cfg.get("size_pt", 8.5)) + 0.5,
                                   leading=float(label_cfg.get("size_pt", 8.5)) * 1.9,
                                   alignment=TA_CENTER, textColor=muted),
        "_accent": accent,
        "_rule": rule,
    }

    title = spec.get("title", "Untitled")
    author = spec.get("author", "")
    content_w = page_w - 2 * margin
    content_h = page_h - 2 * margin
    state = {"chapter": "", "index": 0}
    chapters = spec.get("chapters", [])

    # ---------------------------------------------------------- page frames
    def page_bg(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(paper)
        canvas.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        canvas.restoreState()

    def running_head(canvas, doc, head):
        canvas.saveState()
        lsize = float(label_cfg.get("size_pt", 8.5))
        canvas.setFont(label_font, lsize)
        canvas.setFillColor(muted)
        if head:
            canvas.drawString(margin, page_h - margin * 0.62, head.upper())
        canvas.drawRightString(page_w - margin, page_h - margin * 0.62, title.upper())
        canvas.setStrokeColor(rule)
        canvas.setLineWidth(0.5)
        canvas.line(margin, page_h - margin * 0.78, page_w - margin, page_h - margin * 0.78)
        canvas.restoreState()

    def folio(canvas, doc):
        canvas.saveState()
        canvas.setFont(label_font, float(label_cfg.get("size_pt", 8.5)) + 0.5)
        canvas.setFillColor(muted)
        canvas.drawCentredString(page_w / 2.0, margin * 0.52, str(canvas.getPageNumber()))
        canvas.restoreState()

    def make_body(head):
        def body_page(canvas, doc):
            page_bg(canvas, doc)
            running_head(canvas, doc, head)
            folio(canvas, doc)
        return body_page

    def make_opener(index):
        def opener_page(canvas, doc):
            page_bg(canvas, doc)
            if record is not None:
                record[int(index)] = int(canvas.getPageNumber())
            spiral_mark(canvas, page_w / 2.0, page_h * 0.30, page_h * 0.20, page_h * 0.006,
                        turns=2.6, arms=26, alpha=0.07, width=0.5)
            folio(canvas, doc)
        return opener_page

    def front_page(canvas, doc):
        page_bg(canvas, doc)
        folio(canvas, doc)

    def cover_page(canvas, doc):
        canvas.saveState()
        canvas.setFillColor(hex_color(cover_cfg.get("background", "#0e1013"),
                                      colors.HexColor("#0e1013")))
        canvas.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        img_rel = cover_cfg.get("image")
        if img_rel:
            path = img_rel if os.path.isabs(img_rel) else os.path.join(images_dir, img_rel)
            if os.path.exists(path):
                canvas.drawImage(path, 0, 0, width=page_w, height=page_h,
                                 preserveAspectRatio=True, anchor="c", mask="auto")
        # scrim: strongest at the foot, so the title block always reads
        bands = 90
        top = float(cover_cfg.get("scrim_start", 0.10))
        strength = float(cover_cfg.get("scrim_alpha", 0.62))
        for i in range(bands):
            t = i / (bands - 1)
            y0 = page_h * (1.0 - top) * t
            h = page_h * (1.0 - top) / bands + 1
            a = strength * ((1.0 - t) ** 1.7)
            canvas.setFillColor(colors.Color(0.02, 0.02, 0.03, alpha=a))
            canvas.rect(0, y0, page_w, h, stroke=0, fill=1)
        canvas.restoreState()

        tcol = hex_color(cover_cfg.get("title_color", "#f4f4f2"), colors.white)
        scol = hex_color(cover_cfg.get("subtitle_color", "#c9c9c4"), colors.white)
        acol = hex_color(cover_cfg.get("author_color", "#9a9a95"), colors.white)
        dsize = float(cover_cfg.get("title_size_pt", disp_cfg.get("size_pt", 40) * 2.3))

        kicker = cover_cfg.get("kicker") or spec.get("kicker")
        if kicker:
            centred_text(canvas, kicker.upper(), label_font, 9.5,
                         page_h - margin * 1.5, page_w, acol, 4.0)

        centred_text(canvas, title.upper(), disp_font, dsize,
                     page_h * float(cover_cfg.get("title_y", 0.30)), page_w, tcol,
                     float(cover_cfg.get("title_tracking", dsize * 0.06)))

        y = page_h * float(cover_cfg.get("title_y", 0.30)) - 14
        canvas.setStrokeColor(colors.Color(1, 1, 1, alpha=0.35))
        canvas.setLineWidth(0.8)
        canvas.line(page_w / 2.0 - 42, y, page_w / 2.0 + 42, y)

        if spec.get("subtitle"):
            centred_text(canvas, spec["subtitle"].upper(), label_font, 12.5,
                         y - 26, page_w, scol, 5.0)
        if author:
            centred_text(canvas, author.upper(), label_font, 10.5,
                         margin * 1.35, page_w, acol, 3.0)

    doc = BaseDocTemplate(out_path, pagesize=(page_w, page_h),
                          leftMargin=margin, rightMargin=margin,
                          topMargin=margin, bottomMargin=margin,
                          title=title, author=author)
    frame_cover = Frame(0, 0, page_w, page_h, id="cover", leftPadding=margin,
                        rightPadding=margin, topPadding=margin, bottomPadding=margin)
    frame_body = Frame(margin, margin, content_w, content_h, id="body")
    templates = [
        PageTemplate(id="Cover", frames=[frame_cover], onPage=cover_page),
        PageTemplate(id="Front", frames=[frame_body], onPage=front_page),
    ]
    for i, chapter in enumerate(chapters):
        templates.append(PageTemplate(id=f"Opener{i}", frames=[frame_body],
                                      onPage=make_opener(i)))
        templates.append(PageTemplate(id=f"Body{i}", frames=[frame_body],
                                      onPage=make_body(chapter.get("title", ""))))
    doc.addPageTemplates(templates)

    story = []

    # ------------------------------------------------------------- cover
    # Each section names the template of the NEXT section, then breaks.
    story.append(Spacer(1, 1))                     # page 1 = Cover
    story.append(NextPageTemplate("Front"))
    story.append(PageBreak())

    # --------------------------------------------------------- title page
    story.append(Spacer(1, content_h * 0.30))
    story.append(Paragraph(title.upper(), styles["title_page_title"]))
    story.append(Spacer(1, 10))
    story.append(hairline(70, accent))
    story.append(Spacer(1, 18))
    if spec.get("subtitle"):
        story.append(Paragraph(spec["subtitle"], styles["title_page_sub"]))
    story.append(Spacer(1, content_h * 0.16))
    if spec.get("kicker"):
        story.append(Paragraph(spec["kicker"].upper(), styles["attribution"]))
        story.append(Spacer(1, 14))
    if author:
        story.append(Paragraph(author, styles["attribution"]))
    story.append(NextPageTemplate("Front"))
    story.append(PageBreak())

    # --------------------------------------------------------------- toc
    if spec.get("toc", True):
        story.append(Paragraph("Contents", styles["section_heading"]))
        story.append(Spacer(1, 14))
        for i, chapter in enumerate(chapters, start=1):
            num = f"{i:02d}"
            page = (toc_pages or {}).get(i - 1)
            row = Table([[Paragraph(num, styles["toc_number"]),
                          Paragraph(chapter.get("title", ""), styles["toc_entry"]),
                          Paragraph(str(page) if page else "", styles["toc_entry"])]],
                        colWidths=[content_w * 0.10, content_w * 0.76, content_w * 0.14])
            row.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ("ALIGN", (2, 0), (2, 0), "RIGHT"),
                ("LINEBELOW", (0, 0), (-1, -1), 0.35, rule)]))
            story.append(row)
        story.append(NextPageTemplate("Opener0" if chapters else "Front"))
        story.append(PageBreak())

    # ---------------------------------------------------------- chapters
    for i, chapter in enumerate(chapters):
        chapter = dict(chapter)
        chapter["_index"] = i + 1
        story.extend(opener_story(chapter, styles, content_h))
        story.append(NextPageTemplate(f"Body{i}"))
        story.append(PageBreak())
        story.extend(blocks_story(chapter, styles, images_dir, content_w,
                                  content_h, body_cfg))
        story.append(NextPageTemplate(f"Opener{i + 1}" if i + 1 < len(chapters) else "Front"))
        story.append(PageBreak())

    # ------------------------------------------------------------ colophon
    if spec.get("colophon"):
        story.append(Spacer(1, content_h * 0.42))
        story.append(hairline(50, accent))
        story.append(Spacer(1, 16))
        story.append(Paragraph(spec["colophon"], styles["colophon"]))

    doc.build(story)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Typeset a book (JSON spec -> print-ready PDF).")
    ap.add_argument("--spec", default="book/book.json")
    ap.add_argument("--images", default="book/images")
    ap.add_argument("--out", default="book/book.pdf")
    args = ap.parse_args()

    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)
    book_dir = os.path.dirname(os.path.abspath(args.spec))

    pages = {}
    build(spec, book_dir, args.images, args.out, toc_pages=None, record=pages)
    build(spec, book_dir, args.images, args.out, toc_pages=dict(pages), record=None)

    size = os.path.getsize(args.out)
    print(f"  wrote {args.out} ({size // 1024} KB)")


if __name__ == "__main__":
    main()
