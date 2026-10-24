from markitdown import MarkItDown


def run(payload):
    return {"markdown": MarkItDown(enable_plugins=False).convert(payload["pdf"]).text_content}
