#!/usr/bin/env python3
"""
Typeset a book from a JSON spec into a print-ready PDF (square / any trim size).

    python3 -m venv /tmp/bookenv && /tmp/bookenv/bin/pip install reportlab pillow
    /tmp/bookenv/bin/python book/make_book.py --spec book/book.json --images book/images \\
        --out book/my-book.pdf

Spec format (book.json):
{
  "title": "My Book",
  "subtitle": "A short subtitle",
  "author": "Your Name",
  "trim":   {"width_mm": 297, "height_mm": 297, "margin_mm": 22},
  "cover":  {"image": "cover.jpg", "title_color": "#1a1a1a", "background": "#ffffff"},
  "body":   {"font": "Helvetica", "size_pt": 11, "leading_pt": 16, "first_line_indent_pt": 14},
  "chapters": [
    {"title": "Chapter One",
     "blocks": [
       {"type": "text", "text": "Paragraph one …"},
       {"type": "image", "file": "photo1.jpg", "caption": "A caption", "fit": "contain"},
       {"type": "heading", "text": "A section heading"},
       {"type": "quote", "text": "Something someone said", "attribution": "— Someone"},
       {"type": "spacer", "height_mm": 6},
       {"type": "pagebreak"}
     ]}
  ]
}
"""

import argparse
import json
import os
import sys

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
    from reportlab.lib.pagesizes import mm
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


# ---------------------------------------------------------------- fonts

def register_fonts(spec, book_dir):
    """Optional: {"fonts": {"MyFont": "fonts/MyFont-Regular.ttf"}} in the spec."""
    for name, rel in (spec.get("fonts") or {}).items():
        path = rel if os.path.isabs(rel) else os.path.join(book_dir, rel)
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
        else:
            print(f"  ! font not found, using fallback: {path}")


# ---------------------------------------------------------------- helpers

def hex_color(value, default):
    try:
        return colors.HexColor(value)
    except Exception:
        return default


def fit_image(path, max_w, max_h):
    """Return (width, height) in points that fits inside the box, preserving ratio."""
    with PILImage.open(path) as img:
        w, h = img.size
    ratio = min(max_w / w, max_h / h)
    return w * ratio, h * ratio


def story_for_chapter(chapter, styles, images_dir, content_w, content_h, body_cfg):
    out = []
    heading_style = styles["chapter_heading"]
    text_style = styles["body"]
    caption_style = styles["caption"]

    if chapter.get("title"):
        out.append(Spacer(1, content_h * 0.18))
        out.append(Paragraph(chapter["title"], heading_style))
        out.append(Spacer(1, 10))
        if chapter.get("epigraph"):
            out.append(Paragraph(chapter["epigraph"], styles["epigraph"]))
        out.append(PageBreak())

    for block in chapter.get("blocks", []):
        kind = block.get("type", "text")

        if kind == "text":
            for para in [p.strip() for p in str(block.get("text", "")).split("\n\n") if p.strip()]:
                out.append(Paragraph(para.replace("\n", "<br/>"), text_style))
                out.append(Spacer(1, body_cfg.get("paragraph_space_pt", 7)))

        elif kind == "heading":
            out.append(Spacer(1, 6))
            out.append(Paragraph(block.get("text", ""), styles["section_heading"]))
            out.append(Spacer(1, 4))

        elif kind == "quote":
            out.append(Spacer(1, 6))
            out.append(Paragraph(block.get("text", ""), styles["quote"]))
            if block.get("attribution"):
                out.append(Paragraph(block["attribution"], styles["attribution"]))
            out.append(Spacer(1, 8))

        elif kind == "image":
            rel = block.get("file") or block.get("path") or ""
            path = rel if os.path.isabs(rel) else os.path.join(images_dir, rel)
            height_mm = float(block.get("height_mm", 130))
            box_h = min(height_mm * MM, content_h * 0.8)
            if rel and os.path.exists(path):
                w, h = fit_image(path, content_w, box_h)
                img = Image(path, width=w, height=h)
                img.hAlign = "CENTER"
                out.append(Spacer(1, 8))
                out.append(img)
            else:
                # placeholder frame so the layout survives missing artwork
                frame = Table([[""]], colWidths=[content_w], rowHeights=[box_h])
                frame.setStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#b9b9b9")),
                                ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e0e0e0"))])
                out.append(Spacer(1, 8))
                out.append(frame)
                print(f"  ! image missing, drew a placeholder: {path}")
            if block.get("caption"):
                out.append(Spacer(1, 4))
                out.append(Paragraph(block["caption"], caption_style))
            out.append(Spacer(1, 10))

        elif kind == "gallery":
            items = block.get("images") or []
            cols = max(1, int(block.get("cols", 2)))
            gutter = float(block.get("gutter_mm", 8)) * MM
            cell_h = float(block.get("cell_height_mm", 90)) * MM
            cell_w = (content_w - gutter * (cols - 1)) / float(cols)
            cap_h = (caption_style.fontSize * 1.2 + 6) if any(
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
                    if rel and os.path.exists(path):
                        w, h = fit_image(path, cell_w, img_h)
                        img = Image(path, width=w, height=h)
                        img.hAlign = "CENTER"
                        flow.append(img)
                    else:
                        frame = Table([[""]], colWidths=[cell_w], rowHeights=[img_h])
                        frame.setStyle([("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#b9b9b9")),
                                        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e3e3e3"))])
                        flow.append(frame)
                        print(f"  ! image missing, drew a placeholder: {path or '(none)'}")
                    if cap:
                        flow.append(Spacer(1, 4))
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
            out.append(Spacer(1, 10))

        elif kind == "spacer":
            out.append(Spacer(1, float(block.get("height_mm", 6)) * MM))

        elif kind == "pagebreak":
            out.append(PageBreak())

    return out


# ---------------------------------------------------------------- document

def build(spec, book_dir, images_dir, out_path):
    trim = spec.get("trim") or {}
    page_w = float(trim.get("width_mm", 210)) * MM
    page_h = float(trim.get("height_mm", 210)) * MM
    margin = float(trim.get("margin_mm", 22)) * MM

    body_cfg = spec.get("body") or {}
    body_font = body_cfg.get("font", "Helvetica")
    body_size = float(body_cfg.get("size_pt", 11))
    leading = float(body_cfg.get("leading_pt", body_size * 1.45))
    ink = hex_color((spec.get("colors") or {}).get("ink", "#1a1a1a"), colors.HexColor("#1a1a1a"))
    muted = hex_color((spec.get("colors") or {}).get("muted", "#6b6b6b"), colors.HexColor("#6b6b6b"))

    register_fonts(spec, book_dir)

    base = getSampleStyleSheet()
    cover_cfg = spec.get("cover") or {}
    styles = {
        "body": ParagraphStyle("body", parent=base["BodyText"], fontName=body_font, fontSize=body_size,
                               leading=leading, alignment=TA_JUSTIFY, textColor=ink,
                               firstLineIndent=float(body_cfg.get("first_line_indent_pt", 14))),
        "chapter_heading": ParagraphStyle("chapter_heading", parent=base["Title"], fontName=body_font,
                                          fontSize=body_size * 2.4, leading=body_size * 2.9,
                                          alignment=TA_CENTER, textColor=ink, spaceAfter=6),
        "section_heading": ParagraphStyle("section_heading", parent=base["Heading2"], fontName=body_font,
                                          fontSize=body_size * 1.25, leading=body_size * 1.6,
                                          textColor=ink, spaceBefore=4, spaceAfter=4),
        "quote": ParagraphStyle("quote", parent=base["BodyText"], fontName=body_font, fontSize=body_size * 1.05,
                                leading=leading * 1.15, leftIndent=18, rightIndent=18, textColor=muted),
        "attribution": ParagraphStyle("attribution", parent=base["BodyText"], fontName=body_font,
                                      fontSize=body_size * 0.85, leading=body_size * 1.2,
                                      alignment=TA_CENTER, textColor=muted),
        "caption": ParagraphStyle("caption", parent=base["BodyText"], fontName=body_font,
                                  fontSize=body_size * 0.82, leading=body_size * 1.15,
                                  alignment=TA_CENTER, textColor=muted),
        "epigraph": ParagraphStyle("epigraph", parent=base["BodyText"], fontName=body_font,
                                   fontSize=body_size * 0.95, leading=body_size * 1.4,
                                   alignment=TA_CENTER, textColor=muted),
        "toc_entry": ParagraphStyle("toc_entry", parent=base["BodyText"], fontName=body_font,
                                    fontSize=body_size, leading=body_size * 1.9, textColor=ink),
        "cover_title": ParagraphStyle("cover_title", parent=base["Title"], fontName=body_font,
                                      fontSize=46, leading=54, alignment=TA_CENTER,
                                      textColor=hex_color(cover_cfg.get("title_color"), ink)),
        "cover_subtitle": ParagraphStyle("cover_subtitle", parent=base["Normal"], fontName=body_font,
                                         fontSize=15, leading=22, alignment=TA_CENTER,
                                         textColor=hex_color(cover_cfg.get("subtitle_color"), muted)),
        "cover_author": ParagraphStyle("cover_author", parent=base["Normal"], fontName=body_font,
                                       fontSize=13, leading=20, alignment=TA_CENTER,
                                       textColor=hex_color(cover_cfg.get("author_color"), muted)),
        "placeholder": ParagraphStyle("placeholder", parent=base["BodyText"], fontName=body_font,
                                      fontSize=body_size * 0.8, leading=body_size * 1.1,
                                      alignment=TA_CENTER, textColor=colors.HexColor("#9a9a9a")),
    }

    title = spec.get("title", "Untitled")
    author = spec.get("author", "")
    content_w = page_w - 2 * margin
    content_h = page_h - 2 * margin

    # ---------------------------------------------------------- page frames
    def decorate(canvas, doc, show_number=True, head=""):
        canvas.saveState()
        if show_number:
            canvas.setFont(body_font, body_size * 0.85)
            canvas.setFillColor(muted)
            canvas.drawCentredString(page_w / 2.0, margin * 0.55, str(canvas.getPageNumber()))
            if head:
                canvas.setFont(body_font, body_size * 0.75)
                canvas.drawString(margin, page_h - margin * 0.6, head)
                canvas.drawRightString(page_w - margin, page_h - margin * 0.6, title)
        canvas.restoreState()

    def cover_page(canvas, doc):
        canvas.saveState()
        cover = spec.get("cover") or {}
        bg = hex_color(cover.get("background", "#ffffff"), colors.white)
        canvas.setFillColor(bg)
        canvas.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        img_rel = cover.get("image")
        if img_rel:
            path = img_rel if os.path.isabs(img_rel) else os.path.join(images_dir, img_rel)
            if os.path.exists(path):
                canvas.drawImage(path, 0, 0, width=page_w, height=page_h,
                                 preserveAspectRatio=True, anchor="c", mask="auto")
                if cover.get("scrim", True):
                    canvas.setFillColor(colors.Color(0, 0, 0, alpha=float(cover.get("scrim_alpha", 0.28))))
                    canvas.rect(0, 0, page_w, page_h, stroke=0, fill=1)
        canvas.restoreState()

    def body_page(canvas, doc):
        decorate(canvas, doc, show_number=True)

    def opener_page(canvas, doc):
        decorate(canvas, doc, show_number=True)

    doc = BaseDocTemplate(out_path, pagesize=(page_w, page_h),
                          leftMargin=margin, rightMargin=margin,
                          topMargin=margin, bottomMargin=margin,
                          title=title, author=author)
    frame_cover = Frame(0, 0, page_w, page_h, id="cover", leftPadding=margin, rightPadding=margin,
                        topPadding=margin, bottomPadding=margin)
    frame_body = Frame(margin, margin, content_w, content_h, id="body")
    doc.addPageTemplates([
        PageTemplate(id="Cover", frames=[frame_cover], onPage=cover_page),
        PageTemplate(id="Body", frames=[frame_body], onPage=body_page),
        PageTemplate(id="Opener", frames=[frame_body], onPage=opener_page),
    ])

    story = []

    # ------------------------------------------------------------- cover
    cover = spec.get("cover") or {}
    story.append(Spacer(1, content_h * 0.30))
    if cover.get("image"):
        story.append(Spacer(1, content_h * 0.12))
    story.append(Paragraph(title, styles["cover_title"]))
    if spec.get("subtitle"):
        story.append(Spacer(1, 12))
        story.append(Paragraph(spec["subtitle"], styles["cover_subtitle"]))
    if author:
        story.append(Spacer(1, content_h * 0.22))
        story.append(Paragraph(author, styles["cover_author"]))
    story.append(NextPageTemplate("Body"))
    story.append(PageBreak())

    # --------------------------------------------------------------- toc
    if spec.get("toc", True):
        story.append(Paragraph("Contents", styles["section_heading"]))
        story.append(Spacer(1, 8))
        for i, chapter in enumerate(spec.get("chapters", []), start=1):
            story.append(Paragraph(f"{i:02d}&nbsp;&nbsp;{chapter.get('title', '')}", styles["toc_entry"]))
        story.append(PageBreak())

    # ---------------------------------------------------------- chapters
    for chapter in spec.get("chapters", []):
        story.extend(story_for_chapter(chapter, styles, images_dir, content_w, content_h, body_cfg))
        story.append(PageBreak())

    # ------------------------------------------------------------ colophon
    if spec.get("colophon"):
        story.append(Paragraph(spec["colophon"], styles["caption"]))

    doc.build(story)
    return out_path


def main():
    ap = argparse.ArgumentParser(description="Typeset a book (JSON spec -> print-ready PDF).")
    ap.add_argument("--spec", default="book/book.json")
    ap.add_argument("--images", default="book/images")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    spec_path = args.spec
    with open(spec_path, encoding="utf-8") as fh:
        spec = json.load(fh)
    book_dir = os.path.dirname(os.path.abspath(spec_path))
    images_dir = args.images if os.path.isabs(args.images) else os.path.join(book_dir, os.path.basename(args.images.rstrip("/")) or "images")
    out_path = args.out or os.path.join(book_dir, f"{spec.get('title', 'book').lower().replace(' ', '-')}.pdf")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    build(spec, book_dir, images_dir, out_path)
    size_kb = os.path.getsize(out_path) / 1024
    print(f"  wrote {out_path} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
