from pathlib import Path

from tagora.verify.engine import verify_tool
from tagora.verify.suites.pdf import PdfSuite, order_score, parse_md_tables, table_f1, text_similarity

TOOLS = Path(__file__).resolve().parents[1] / "benchmarks" / "pdf" / "tools"


def test_text_similarity_normalises_whitespace_and_case():
    assert text_similarity("Hello   World", "hello world") == 1.0
    assert text_similarity("", "something") == 0.0
    assert text_similarity("你 好\n世界", "你好世界", zh=True) == 1.0


def test_order_score_penalises_shuffled_paragraphs():
    paras = [f"paragraph number {i} with enough words to make a snippet" for i in range(6)]
    assert order_score("\n".join(paras), paras) == 1.0
    shuffled = [paras[i] for i in (3, 0, 4, 1, 5, 2)]
    assert order_score("\n".join(shuffled), paras) < 0.7


def test_markdown_tables_parse_and_score():
    md = "intro\n\n| A | B |\n|---|---|\n| 1 | x |\n| 2 | y |\n\nafter"
    tables = parse_md_tables(md)
    assert tables == [[["A", "B"], ["1", "x"], ["2", "y"]]]
    assert table_f1(tables[0], [["A", "B"], ["1", "x"], ["2", "y"]]) == 1.0
    assert table_f1(tables[0], [["A", "B"], ["1", "z"], ["3", "y"]]) < 0.8


def test_engine_produces_a_card_on_the_public_split():
    card, results = verify_tool(TOOLS / "pypdf", PdfSuite(), split="public", workers=4)
    assert card["schema"] == "tagora.card/v1"
    assert len(card["code_hash"]) == 64
    q = card["quality"]["by_scenario"]
    assert q["plain"] > 0.95 and q["chinese"] > 0.95
    assert q["scanned"] == 0.0  # no text layer, no OCR
    assert card["security"]["egress"] is False
    assert not [e for e in card["security"]["runtime_events"] if e["kind"] == "fs_read_home"]
    assert card["cost"]["compute_usd_per_case"] > 0
    assert len(results) == 10
