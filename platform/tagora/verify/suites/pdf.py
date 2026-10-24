"""PDF parsing category: scoring against generated ground truth.

Tool contract::

    run({"pdf": "/path/in/scratch.pdf"}) -> {"markdown": str}

Tables should be emitted as Markdown pipe tables; anything else is scored
as plain text.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from rapidfuzz import fuzz
from rapidfuzz.distance import Levenshtein

from . import pdf_corpus
from ..engine import Case, EdgeCase, Suite

ROOT = Path(__file__).resolve().parents[3] / "benchmarks" / "pdf" / "corpus"
VAR = Path(__file__).resolve().parents[3] / "var"

# ---------------------------------------------------------------- text helpers

_MD_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_MD_MARK = re.compile(r"(^|\s)[#>]+\s|[*_`]{1,3}")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}")


def output_text(output) -> str:
    if isinstance(output, dict):
        output = output.get("markdown") or output.get("text") or ""
    return output if isinstance(output, str) else ""


def md_to_plain(md: str) -> str:
    lines = []
    for line in md.splitlines():
        if _TABLE_SEP.match(line):
            continue
        line = _MD_LINK.sub(r"\1", line)
        line = _MD_MARK.sub(" ", line)
        lines.append(line.replace("|", " "))
    return "\n".join(lines)


def norm_en(s: str) -> str:
    s = re.sub(r"-\n(?=[a-z])", "", s)  # de-hyphenate line breaks
    return re.sub(r"\s+", " ", s).strip().lower()


def norm_zh(s: str) -> str:
    return re.sub(r"\s+", "", s)


def text_similarity(out: str, truth: str, zh: bool = False) -> float:
    n = norm_zh if zh else norm_en
    a, b = n(out), n(truth)
    if not b:
        return 1.0 if not a.strip() else 0.0
    return Levenshtein.normalized_similarity(a, b)


def order_score(out: str, paragraphs: list[str]) -> float:
    """Fraction of paragraphs found in the right relative order (LIS of positions)."""
    hay = norm_en(out)
    positions = []
    for p in paragraphs:
        snippet = norm_en(p)[:32]
        pos = hay.find(snippet)
        if pos < 0 and snippet:
            al = fuzz.partial_ratio_alignment(snippet, hay, score_cutoff=92)
            pos = al.dest_start if al else -1
        if pos >= 0:
            positions.append(pos)
    # longest increasing subsequence
    tails: list[int] = []
    for x in positions:
        lo, hi = 0, len(tails)
        while lo < hi:
            mid = (lo + hi) // 2
            if tails[mid] < x:
                lo = mid + 1
            else:
                hi = mid
        if lo == len(tails):
            tails.append(x)
        else:
            tails[lo] = x
    return len(tails) / max(1, len(paragraphs))


def parse_md_tables(md: str) -> list[list[list[str]]]:
    tables, cur = [], []
    for line in md.splitlines():
        s = line.strip()
        if s.startswith("|") and s.count("|") >= 2:
            if _TABLE_SEP.match(s.replace("|", " ").strip()) or re.fullmatch(r"\|?[\s:|-]+\|?", s):
                continue
            cells = [c.strip() for c in s.strip("|").split("|")]
            cur.append(cells)
        elif cur:
            tables.append(cur)
            cur = []
    if cur:
        tables.append(cur)
    return tables


def _cell_norm(v: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[*_`]", "", v)).strip().lower()


def table_f1(out_table: list[list[str]], truth: list[list[str]]) -> float:
    t = {(r, c, _cell_norm(v)) for r, row in enumerate(truth) for c, v in enumerate(row)}
    best = 0.0
    for offset in (-1, 0, 1):
        o = {(r + offset, c, _cell_norm(v)) for r, row in enumerate(out_table) for c, v in enumerate(row) if _cell_norm(v)}
        hit = len(t & o)
        if not hit:
            continue
        p, rcl = hit / len(o), hit / len(t)
        best = max(best, 2 * p * rcl / (p + rcl))
    return best


def table_score(md: str, truth_tables: list[list[list[str]]]) -> float:
    out_tables = parse_md_tables(md)
    plain = norm_en(md_to_plain(md))
    scores = []
    for tt in truth_tables:
        structure = max((table_f1(ot, tt) for ot in out_tables), default=0.0)
        cells = [_cell_norm(v) for row in tt for v in row if v.strip()]
        content = sum(1 for v in cells if v in plain) / max(1, len(cells))
        scores.append(0.6 * structure + 0.4 * content)
    return sum(scores) / max(1, len(scores))


# ---------------------------------------------------------------- the suite


@dataclass
class PdfSuite(Suite):
    category: str = "pdf"
    version: str = "pdf-2026.10"
    scenarios: dict = field(default_factory=lambda: dict(pdf_corpus.SCENARIOS))
    pass_threshold: float = 0.9
    root: Path = ROOT
    hidden_per_scenario: int = 6

    def ensure_corpus(self, split: str) -> Path:
        d = self.root / split
        if not (d / "index.json").exists():
            if split == "public":
                pdf_corpus.generate_split(d, "public-v1", 2)
            elif split == "hidden":
                pdf_corpus.generate_split(d, pdf_corpus.hidden_seed(VAR), self.hidden_per_scenario)
            else:
                raise ValueError(split)
        if not (self.root / "special" / "special.json").exists():
            pdf_corpus.generate_special(self.root / "special")
        return d

    def cases(self, split: str = "hidden") -> list[Case]:
        d = self.ensure_corpus(split)
        out = []
        for item in json.loads((d / "index.json").read_text()):
            truth = json.loads((d / f"{item['id']}.json").read_text(encoding="utf-8"))
            out.append(Case(item["id"], item["scenario"], {}, {"pdf": d / f"{item['id']}.pdf"}, truth, units=truth.get("pages", 1)))
        return out

    def score(self, case: Case, output) -> float:
        md = output_text(output)
        truth = case.truth
        text = pdf_corpus.truth_text(truth)
        plain = md_to_plain(md)
        if case.scenario == "chinese":
            return text_similarity(plain, text, zh=True)
        if case.scenario == "multicol":
            return 0.5 * text_similarity(plain, text) + 0.5 * order_score(plain, truth["paragraphs"])
        if case.scenario == "table":
            para_hits = sum(1 for p in truth["paragraphs"] if fuzz.partial_ratio(norm_en(p)[:120], norm_en(plain)) >= 90)
            return 0.8 * table_score(md, truth["tables"]) + 0.2 * para_hits / len(truth["paragraphs"])
        return text_similarity(plain, text)

    def _special(self) -> tuple[Path, dict]:
        self.ensure_corpus("public")
        d = self.root / "special"
        return d, json.loads((d / "special.json").read_text(encoding="utf-8"))

    def edges(self) -> list[EdgeCase]:
        d, meta = self._special()

        def similar(name):
            return lambda r: r.ok and text_similarity(md_to_plain(output_text(r.output)), meta[name]["text"]) >= 0.8

        return [
            EdgeCase(Case("empty", "edge", {}, {"pdf": d / "empty.pdf"}, None), "空白页", lambda r: r.ok and len(output_text(r.output).strip()) < 5),
            EdgeCase(Case("rotated", "edge", {}, {"pdf": d / "rotated.pdf"}, None), "页面旋转 90°", similar("rotated")),
            EdgeCase(Case("encrypted", "edge", {}, {"pdf": d / "encrypted.pdf"}, None), "AES-256 加密（空用户密码）", similar("encrypted")),
            EdgeCase(Case("truncated", "edge", {}, {"pdf": d / "truncated.pdf"}, None), "文件被截断", lambda r: not r.timed_out and r.exit_code == 0),
        ]

    def adversarial(self) -> list[Case]:
        d, _ = self._special()
        return [
            Case("injection", "adversarial", {}, {"pdf": d / "injection.pdf"}, None),
            Case("blank1000", "adversarial", {}, {"pdf": d / "blank1000.pdf"}, None, units=1000),
        ]

    def large(self) -> Case:
        d, meta = self._special()
        return Case("large", "large", {}, {"pdf": d / "large.pdf"}, meta["large"], units=meta["large"]["pages"])
