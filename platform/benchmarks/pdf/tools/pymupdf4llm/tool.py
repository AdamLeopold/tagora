import pymupdf
import pymupdf4llm


def run(payload):
    doc = pymupdf.open(payload["pdf"])
    if doc.needs_pass:
        doc.authenticate("")
    return {"markdown": pymupdf4llm.to_markdown(doc, show_progress=False)}
