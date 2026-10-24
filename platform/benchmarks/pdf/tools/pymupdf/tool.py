import pymupdf


def run(payload):
    doc = pymupdf.open(payload["pdf"])
    if doc.needs_pass:
        doc.authenticate("")
    parts = []
    for page in doc:
        tables = list(page.find_tables().tables)
        boxes = [pymupdf.Rect(t.bbox) for t in tables]
        for x0, y0, x1, y1, text, *_ in page.get_text("blocks"):
            r = pymupdf.Rect(x0, y0, x1, y1)
            if not any(b.intersects(r) for b in boxes):
                parts.append(text.strip())
        parts.extend(t.to_markdown() for t in tables)
    return {"markdown": "\n\n".join(p for p in parts if p)}
