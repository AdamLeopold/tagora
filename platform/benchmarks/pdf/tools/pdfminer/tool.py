from pdfminer.high_level import extract_text


def run(payload):
    return {"markdown": extract_text(payload["pdf"], password="")}
