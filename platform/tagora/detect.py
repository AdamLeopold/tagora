"""Local pre-routing analysis: which scenario does this PDF fall into?

Runs on the caller's machine before anything is sent, so routing can use the
scenario-specific success rates on the capability cards without the document
leaving the device. Only the scenario label is shared with the router.
"""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf

CJK = re.compile(r"[一-鿿]")


def _two_columns(page) -> bool:
    blocks = [b for b in page.get_text("blocks") if b[4].strip() and (b[2] - b[0]) > 40]
    if len(blocks) < 4:
        return False
    mid = page.rect.width / 2
    left = sum(1 for b in blocks if b[2] <= mid + 6)
    right = sum(1 for b in blocks if b[0] >= mid - 6)
    spanning = len(blocks) - left - right
    # both halves carry text and (almost) nothing crosses the gutter
    return left >= 1 and right >= 1 and left + right >= 3 and spanning <= 1


def detect_scenario(path: str | Path, max_pages: int = 5) -> dict:
    doc = pymupdf.open(path)
    if doc.needs_pass:
        doc.authenticate("")
    pages = list(doc)[:max_pages]
    text = "".join(p.get_text() for p in pages)
    has_images = any(p.get_images() for p in pages)
    signals = {"pages": doc.page_count, "chars": len(text.strip()), "images": has_images}
    if len(text.strip()) < 20 * max(1, len(pages)) and has_images:
        return {"scenario": "scanned", **signals}
    cjk = len(CJK.findall(text)) / max(1, len(text.strip()))
    signals["cjk_ratio"] = round(cjk, 3)
    if cjk > 0.3:
        return {"scenario": "chinese", **signals}
    if any(p.find_tables().tables for p in pages):
        return {"scenario": "table", **signals}
    if any(_two_columns(p) for p in pages):
        return {"scenario": "multicol", **signals}
    return {"scenario": "plain", **signals}


def acceptable(markdown: str, pages: int) -> bool:
    """A cheap, content-free acceptance check the caller can run on any result."""
    return len((markdown or "").strip()) >= 40 * max(1, min(pages, 20))
