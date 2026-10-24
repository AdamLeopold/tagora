"""Load published capability cards into a registry (used by the API image and local dev).

    python -m tagora.bootstrap --split hidden
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

from .ledger import Ledger, canonical
from .manifest import load_manifest
from .registry import Listing, Registry
from .seeding import add_tee_variant

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "benchmarks" / "pdf" / "tools"
RESULTS = ROOT / "benchmarks" / "pdf" / "results"
# Authors who also deploy their tool on confidential-computing hardware.
TEE_TOOLS = ("tagora-hybrid", "pymupdf", "pdfplumber", "pypdf")


def bootstrap(registry: Registry, ledger: Ledger, split: str = "hidden") -> list[str]:
    dirs = {load_manifest(d).name: d for d in TOOLS.iterdir() if (d / "tagora.toml").exists()}
    keys = []
    for f in sorted((RESULTS / split).glob("*.json")):
        if f.name == "summary.json" or "@" in f.stem:
            continue
        card = json.loads(f.read_text(encoding="utf-8"))["card"]
        d = dirs.get(card["name"])
        if d is None:
            continue
        m = load_manifest(d)
        base = registry.put(
            Listing(card["tool"], m.name, m.version, m.category, m.author, m.license, m.upstream, str(d), m.entrypoint,
                    card["code_hash"], card["hardware"], card["tier"], m.price_usd, m.claim_text, card)
        )
        listings = [base] + ([add_tee_variant(registry, base)] if d.name in TEE_TOOLS else [])
        for l in listings:
            ledger.append("listing", {"tool": l.key, "code_hash": l.code_hash, "card_hash": hashlib.sha256(canonical(l.card).encode()).hexdigest(), "overall": l.card["quality"]["overall"]})
            keys.append(l.key)
    return keys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", default="hidden")
    ap.add_argument("--var", default=os.environ.get("TAGORA_VAR", str(ROOT / "var")))
    ap.add_argument("--fresh", action="store_true", help="drop existing listings first")
    args = ap.parse_args()
    var = Path(args.var)
    var.mkdir(parents=True, exist_ok=True)
    if args.fresh and (var / "registry.db").exists():
        (var / "registry.db").unlink()
    keys = bootstrap(Registry(var / "registry.db"), Ledger(var / "ledger.db"), args.split)
    print(f"registered {len(keys)} listings")
    for k in keys:
        print("  ", k)


if __name__ == "__main__":
    main()
