import pdfplumber


def _md(rows):
    rows = [[(c or "").replace("\n", " ").strip() for c in r] for r in rows if r]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def run(payload):
    parts = []
    with pdfplumber.open(payload["pdf"], password="") as pdf:
        for page in pdf.pages:
            tables = page.find_tables()
            rest = page
            for t in tables:
                rest = rest.outside_bbox(t.bbox)
            parts.append(rest.extract_text() or "")
            parts.extend(_md(t.extract()) for t in tables)
    return {"markdown": "\n\n".join(p for p in parts if p)}
