import numpy as np
import pymupdf
from rapidocr_onnxruntime import RapidOCR

_engine = None


def _ocr(page):
    global _engine
    _engine = _engine or RapidOCR()
    pix = page.get_pixmap(dpi=200)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)[:, :, :3]
    result, _ = _engine(img)
    lines = sorted(result or [], key=lambda r: (round(r[0][0][1] / 12), r[0][0][0]))
    return "\n".join(r[1] for r in lines)


def run(payload):
    doc = pymupdf.open(payload["pdf"])
    if doc.needs_pass:
        doc.authenticate("")
    return {"markdown": "\n\n".join(_ocr(p) for p in doc)}
