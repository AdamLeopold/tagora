"""Tune routing and pricing parameters on real benchmark outcomes.

The router only ever sees the *public* split (what a capability card can
claim from a small sample); outcomes are drawn from the *hidden* split. That
mirrors production: cards are estimates, live traffic is the truth.

    python -m tagora.sim            # writes benchmarks/pdf/results/sim.json
"""

from __future__ import annotations

import itertools
import json
import math
import random
import statistics
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "benchmarks" / "pdf" / "results"
THRESHOLD = 0.9


@dataclass
class ToolData:
    name: str
    price: float
    compute_per_case: float
    public: dict[str, list[bool]]  # scenario -> successes
    hidden: dict[str, list[tuple[str, bool]]]  # scenario -> (doc id, success)


def load() -> list[ToolData]:
    tools = []
    for f in sorted((RESULTS / "hidden").glob("*.json")):
        if f.name == "summary.json" or "@" in f.stem:
            continue
        hidden = json.loads(f.read_text())
        pub_f = RESULTS / "public" / f.name
        if not pub_f.exists():
            continue
        public = json.loads(pub_f.read_text())
        pub: dict[str, list[bool]] = {}
        for c in public["cases"]:
            pub.setdefault(c["scenario"], []).append(c["score"] >= THRESHOLD)
        hid: dict[str, list[tuple[str, bool]]] = {}
        for c in hidden["cases"]:
            hid.setdefault(c["scenario"], []).append((c["id"], c["score"] >= THRESHOLD))
        card = hidden["card"]
        tools.append(ToolData(card["name"], card["cost"]["list_price_usd"], card["cost"]["compute_usd_per_case"], pub, hid))
    return tools


def p_hat(successes: list[bool], a: float, b: float) -> float:
    return (sum(successes) + a) / (len(successes) + a + b)


# ------------------------------------------------------------ 1. prior calibration


def calibrate(tools: list[ToolData]) -> dict:
    grid = [0.0, 0.1, 0.25, 0.5, 1.0, 2.0, 4.0]
    rows = []
    for a, b in itertools.product(grid, grid):
        losses, brier = [], []
        for t in tools:
            for scn, outcomes in t.hidden.items():
                p = p_hat(t.public.get(scn, []), a, b) if (a + b) > 0 or t.public.get(scn) else 0.5
                p = min(max(p, 1e-6), 1 - 1e-6)
                for _, y in outcomes:
                    losses.append(-(math.log(p) if y else math.log(1 - p)))
                    brier.append((p - y) ** 2)
        rows.append({"a": a, "b": b, "log_loss": statistics.fmean(losses), "brier": statistics.fmean(brier)})
    rows.sort(key=lambda r: r["log_loss"])
    mle = next(r for r in rows if r["a"] == 0 and r["b"] == 0)
    return {"best": rows[0], "laplace": next(r for r in rows if r["a"] == 1 and r["b"] == 1), "mle_no_prior": mle, "top5": rows[:5]}


# ------------------------------------------------------------ 2. routing strategies


def requests(tools: list[ToolData]) -> list[tuple[str, str]]:
    any_tool = tools[0]
    return [(scn, doc) for scn, docs in any_tool.hidden.items() for doc, _ in docs]


def outcome(t: ToolData, scn: str, doc: str) -> bool:
    return dict(t.hidden[scn])[doc]


def order(tools: list[ToolData], scn: str, strategy: str, a: float, b: float, rng: random.Random) -> list[ToolData]:
    p = {t.name: p_hat(t.public.get(scn, []), a, b) for t in tools}
    if strategy == "effective":
        return sorted(tools, key=lambda t: (t.price / max(p[t.name], 1e-6), t.price))
    if strategy == "cheapest":
        return sorted(tools, key=lambda t: t.price)
    if strategy == "best_overall":  # what a README-reader with a leaderboard would do
        overall = {t.name: statistics.fmean(sum(v) / len(v) for v in t.public.values()) for t in tools}
        return sorted(tools, key=lambda t: -overall[t.name])
    shuffled = tools[:]
    rng.shuffle(shuffled)
    return shuffled


def simulate_routing(tools: list[ToolData], a: float, b: float, max_attempts: int = 3) -> dict:
    out = {}
    for strategy in ("effective", "cheapest", "best_overall", "random"):
        rng = random.Random(7)
        spend, ok, attempts = 0.0, 0, 0
        reqs = requests(tools)
        for scn, doc in reqs:
            for t in order(tools, scn, strategy, a, b, rng)[:max_attempts]:
                spend += t.price
                attempts += 1
                if outcome(t, scn, doc):
                    ok += 1
                    break
        out[strategy] = {
            "requests": len(reqs),
            "success_rate": ok / len(reqs),
            "spend_usd": round(spend, 6),
            "usd_per_verified_result": round(spend / ok, 6) if ok else None,
            "attempts_per_request": round(attempts / len(reqs), 3),
        }
    return out


# ------------------------------------------------------------ 3. underwriting margin


def underwrite(tools: list[ToolData], a: float, b: float, max_attempts: int = 3, resamples: int = 2000) -> dict:
    """Quote = expected cost per success × (1 + margin), estimated from public cards; settle on hidden outcomes."""
    reqs = requests(tools)
    per_req = []
    for scn, doc in reqs:
        chain = order(tools, scn, "effective", a, b, random.Random(0))[:max_attempts]
        reach, exp_cost, p_fail = 1.0, 0.0, 1.0
        for t in chain:
            p = p_hat(t.public.get(scn, []), a, b)
            exp_cost += reach * t.price
            reach *= 1 - p
        p_succ = 1 - reach
        quote_base = exp_cost / max(p_succ, 1e-6)
        cost, success = 0.0, False
        for t in chain:
            cost += t.price
            if outcome(t, scn, doc):
                success = True
                break
        per_req.append((quote_base, cost, success))
    rng = random.Random(11)
    table = []
    for margin in [0.0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5]:
        def profit(sample):
            return sum((q * (1 + margin) if s else 0.0) - c for q, c, s in sample)

        base = profit(per_req)
        losses = sum(1 for _ in range(resamples) if profit([rng.choice(per_req) for _ in per_req]) < 0)
        revenue = sum(q * (1 + margin) for q, _, s in per_req if s)
        table.append({"margin": margin, "profit_usd": round(base, 6), "revenue_usd": round(revenue, 6), "p_loss": round(losses / resamples, 4)})
    safe = next((r for r in table if r["p_loss"] < 0.05), table[-1])
    return {"margins": table, "recommended_margin": safe["margin"], "requests": len(per_req)}


def main() -> None:
    tools = load()
    cal = calibrate(tools)
    a, b = cal["best"]["a"], cal["best"]["b"]
    result = {
        "tools": [t.name for t in tools],
        "threshold": THRESHOLD,
        "calibration": cal,
        "routing": {"prior": {"a": a, "b": b}, "results": simulate_routing(tools, a, b)},
        "routing_laplace": simulate_routing(tools, 1.0, 1.0),
        "underwriting": underwrite(tools, a, b),
        "compute_vs_price": [
            {
                "tool": t.name,
                "list_price_usd": t.price,
                "compute_usd_per_case": t.compute_per_case,
                "price_to_compute": round(t.price / t.compute_per_case, 1) if t.compute_per_case else None,
            }
            for t in tools
        ],
    }
    (RESULTS / "sim.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(json.dumps({k: result[k] for k in ("calibration", "routing", "underwriting")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
