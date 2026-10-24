"""Outcome pricing: sell verified results, buy attempts.

The platform quotes one price per *successful* result. Behind the quote it
tries Workers in effective-price order until one passes the acceptance check,
paying for every attempt. Capability-card success probabilities are the risk
model; the margin is the underwriting fee.
"""

from __future__ import annotations

from dataclasses import dataclass

from .registry import Listing
from .router import success_probability


@dataclass
class Attempt:
    key: str
    price_usd: float
    p_success: float


def chain_economics(attempts: list[Attempt], check_cost_usd: float = 0.0) -> dict:
    """Expected spend and success probability when attempts run in order and stop at the first success."""
    p_reach = 1.0
    expected_cost = 0.0
    for a in attempts:
        expected_cost += p_reach * (a.price_usd + check_cost_usd)
        p_reach *= 1.0 - a.p_success
    return {"expected_cost_usd": expected_cost, "p_success": 1.0 - p_reach, "attempts": len(attempts)}


def outcome_quote(
    candidates: list[Listing],
    scenario: str | None = None,
    *,
    max_attempts: int = 3,
    margin: float = 0.15,
    check_cost_usd: float = 0.0001,
    min_success: float = 0.9,
) -> dict:
    """Price per verified result for a request, or a refusal if the chain is too unreliable to underwrite."""
    chain = [Attempt(l.key, l.price_usd, success_probability(l.card, scenario)) for l in candidates[:max_attempts]]
    if not chain:
        return {"ok": False, "reason": "没有可用的 Worker"}
    econ = chain_economics(chain, check_cost_usd)
    if econ["p_success"] < min_success:
        return {"ok": False, "reason": f"成功率 {econ['p_success']:.2%} 低于承保线 {min_success:.0%}", **econ}
    # The buyer pays only on success, so failed requests are funded by successful ones.
    cost_per_success = econ["expected_cost_usd"] / econ["p_success"]
    price = cost_per_success * (1 + margin)
    return {
        "ok": True,
        "price_per_success_usd": round(price, 6),
        "expected_cost_usd": round(econ["expected_cost_usd"], 6),
        "cost_per_success_usd": round(cost_per_success, 6),
        "p_success": round(econ["p_success"], 4),
        "margin": margin,
        "chain": [a.__dict__ for a in chain],
    }
