from pypdf import PdfReader


def run(payload):
    reader = PdfReader(payload["pdf"])
    if reader.is_encrypted:
        reader.decrypt("")
    return {"markdown": "\n\n".join(page.extract_text(extraction_mode="layout") or "" for page in reader.pages)}
