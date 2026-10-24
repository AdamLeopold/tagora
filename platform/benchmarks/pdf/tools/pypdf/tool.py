from pypdf import PdfReader


def run(payload):
    reader = PdfReader(payload["pdf"])
    if reader.is_encrypted:
        reader.decrypt("")
    return {"markdown": "\n\n".join(page.extract_text() or "" for page in reader.pages)}
