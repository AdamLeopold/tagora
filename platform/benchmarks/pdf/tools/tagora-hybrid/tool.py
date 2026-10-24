"""A composition built to fill the gaps the benchmark found in single tools.

v0.2 changes, each driven by a failing scenario on the public split:

* multi-column: text blocks are ordered by layout (column, then y) instead of
  trusting the content-stream order, which many exporters scramble.
* scanned: the page is deskewed with a projection-profile search, split into
  text lines by horizontal projection, and each line goes straight to the
  recognition model (RapidOCR's detector merged tightly spaced lines).
  Long run-together ASCII tokens are re-segmented with wordninja.
"""

import numpy as np
import pymupdf

_ocr_engine = None
GUTTER = 6  # points of slack around the page midline


def _engine():
    global _ocr_engine
    if _ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _ocr_engine = RapidOCR()
    return _ocr_engine


# ------------------------------------------------------------------ layout


def _order_blocks(blocks, width):
    """Two-column pages read left column then right column, segment by segment."""
    mid = width / 2
    left = [b for b in blocks if b[2] <= mid + GUTTER]
    right = [b for b in blocks if b[0] >= mid - GUTTER]
    if len(left) < 2 or len(right) < 2:
        return sorted(blocks, key=lambda b: (round(b[1], 1), b[0]))
    full = sorted((b for b in blocks if b not in left and b not in right), key=lambda b: b[1])
    out, top = [], -1.0
    for brk in [*full, None]:
        bottom = brk[1] if brk else float("inf")
        out += sorted((b for b in left if top <= b[1] < bottom), key=lambda b: b[1])
        out += sorted((b for b in right if top <= b[1] < bottom), key=lambda b: b[1])
        if brk:
            out.append(brk)
            top = brk[3]
    return out


# ------------------------------------------------------------------ OCR


def _deskew(im):
    from PIL import Image

    small = im.resize((max(1, im.width // 3), max(1, im.height // 3)))
    best = (-1.0, 0.0)
    for angle in np.arange(-1.5, 1.51, 0.1):
        v = (255 - np.asarray(small.rotate(angle, fillcolor=255), dtype=np.float32)).sum(1).var()
        if v > best[0]:
            best = (v, float(angle))
    return im.rotate(best[1], fillcolor=255, resample=Image.BICUBIC)


def _line_crops(im):
    arr = 255 - np.asarray(im, dtype=np.float32)
    profile = arr.sum(1)
    if profile.max() <= 0:
        return []
    thr = profile.max() * 0.02
    spans, start = [], None
    for y, on in enumerate(profile > thr):
        if on and start is None:
            start = y
        elif not on and start is not None:
            if y - start > 4:
                spans.append((start, y))
            start = None
    crops = []
    for a, b in spans:
        cols = np.where(arr[a:b].sum(0) > thr * 0.01)[0]
        if len(cols):
            crops.append(im.crop((max(0, cols[0] - 4), max(0, a - 4), min(im.width, cols[-1] + 4), min(im.height, b + 4))))
    return crops


def _resegment(text):
    import wordninja

    return " ".join(
        " ".join(wordninja.split(w)) if len(w) > 12 and w.isascii() and w.isalpha() else w for w in text.split()
    )


def _ocr(page):
    from PIL import Image

    pix = page.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY)
    im = _deskew(Image.frombytes("L", (pix.width, pix.height), pix.samples))
    lines = []
    for crop in _line_crops(im):
        res, _ = _engine()(np.array(crop.convert("RGB")), use_det=False, use_cls=False)
        if res and res[0][0].strip():
            lines.append(_resegment(res[0][0]))
    return "\n".join(lines)


# ------------------------------------------------------------------ entry


def run(payload):
    doc = pymupdf.open(payload["pdf"])
    if doc.needs_pass:
        doc.authenticate("")
    parts = []
    for page in doc:
        blocks = [b for b in page.get_text("blocks") if b[4].strip()]
        if not blocks:
            if page.get_images():
                parts.append(_ocr(page))
            continue
        tables = list(page.find_tables().tables)
        boxes = [pymupdf.Rect(t.bbox) for t in tables]
        body = [b for b in blocks if not any(x.intersects(pymupdf.Rect(b[:4])) for x in boxes)]
        parts += [b[4].strip() for b in _order_blocks(body, page.rect.width)]
        parts += [t.to_markdown() for t in tables]
    return {"markdown": "\n\n".join(p for p in parts if p)}
