"""Phase 0 benchmark: verify every PDF tool and publish capability cards.

    python benchmarks/pdf/run.py --split hidden          # the real benchmark
    python benchmarks/pdf/run.py --split public --tools pypdf pdfplumber

Cards (scores, never the hidden documents) go to benchmarks/pdf/results/<split>/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

from tagora.ledger import Ledger, canonical  # noqa: E402
from tagora.registry import Listing, Registry  # noqa: E402
from tagora.verify.engine import verify_tool  # noqa: E402
from tagora.verify.suites.pdf import PdfSuite  # noqa: E402

TOOLS = HERE / "tools"
VAR = HERE.parents[1] / "var"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="hidden", choices=["public", "hidden"])
    ap.add_argument("--tools", nargs="*")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--hardware", default="cpu-arm64")
    args = ap.parse_args()

    out_dir = HERE / "results" / args.split
    out_dir.mkdir(parents=True, exist_ok=True)
    VAR.mkdir(exist_ok=True)
    registry = Registry(VAR / "registry.db")
    ledger = Ledger(VAR / "ledger.db")
    suite = PdfSuite()

    names = args.tools or sorted(p.name for p in TOOLS.iterdir() if (p / "tagora.toml").exists())
    summary = []
    for name in names:
        t0 = time.time()
        card, results = verify_tool(TOOLS / name, suite, hardware=args.hardware, split=args.split, workers=args.workers)
        card["verify_seconds"] = round(time.time() - t0, 1)
        (out_dir / f"{name}.json").write_text(
            json.dumps({"card": card, "cases": [r.to_dict() | {"events": len(r.run.events)} for r in results]}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        listing = registry.put(
            Listing(
                tool_id=card["tool"],
                name=card["name"],
                version=card["version"],
                category="pdf",
                author=card["author"],
                license=card["license"],
                upstream=card["upstream"],
                tool_dir=str((TOOLS / name).resolve()),
                entrypoint="tool:run",
                code_hash=card["code_hash"],
                hardware=args.hardware,
                tier=card["tier"],
                price_usd=card["cost"]["list_price_usd"],
                claim_text=card["claim"]["text"],
                card=card,
            )
        )
        ledger.append(
            "listing",
            {
                "tool": listing.key,
                "code_hash": card["code_hash"],
                "card_hash": hashlib.sha256(canonical(card).encode()).hexdigest(),
                "overall": card["quality"]["overall"],
                "split": args.split,
            },
        )
        q = card["quality"]
        row = {
            "tool": name,
            "overall": q["overall"],
            "success": q["success_rate"],
            **{f"s_{k}": v for k, v in q["by_scenario"].items()},
            "robust": card["robustness"]["score"],
            "egress": card["security"]["egress"],
            "cpu_s": card["performance"]["cpu_mean_s"],
            "usd_per_verified": card["cost"]["compute_usd_per_verified_result"],
            "secs": card["verify_seconds"],
        }
        summary.append(row)
        print(json.dumps(row, ensure_ascii=False))
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    ok, bad, why = ledger.verify()
    print(f"ledger height={ledger.height()} valid={ok} {why if not ok else ''}")


if __name__ == "__main__":
    main()
