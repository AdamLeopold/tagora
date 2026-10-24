"""Routing: pick Workers by what the capability card measured, never by README.

Default strategy ranks by *effective price* = list price ÷ P(success), so a
cheap tool that usually fails is more expensive than a pricier one that works.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .registry import Listing, Registry

# Beta prior on success probability, calibrated in tagora.sim: estimating from
# the public split and scoring on the hidden split, (0.1, 0.0) minimised log
# loss (0.145 vs 0.343 for Laplace). Tools behave almost deterministically per
# scenario, so a weak prior wins. B is kept at 0.1 so a tool with no data
# starts at 0.5 rather than a confident 1.0.
PRIOR_A = 0.1
PRIOR_B = 0.1

STRATEGIES = ("effective", "quality", "price", "speed")


def success_probability(card: dict, scenario: str | None = None, a: float = PRIOR_A, b: float = PRIOR_B) -> float:
    q = card["quality"]
    n_total = card["suite"]["cases"]
    scenarios = q["by_scenario"]
    if scenario and scenario in scenarios:
        n = max(1, round(n_total / max(1, len(scenarios))))
        rate = q.get("success_by_scenario", {}).get(scenario)
        if rate is None:  # older cards: approximate from mean scenario score
            rate = 1.0 if scenarios[scenario] >= card["suite"]["pass_threshold"] else 0.0
    else:
        n, rate = n_total, q["success_rate"]
    return (rate * n + a) / (n + a + b)


def effective_price(listing: Listing, scenario: str | None = None) -> float:
    return listing.price_usd / max(1e-6, success_probability(listing.card, scenario))


@dataclass
class RouteRequest:
    category: str
    sensitive: bool = False
    strategy: str = "effective"
    k: int = 1
    scenario: str | None = None
    min_overall: float = 0.0
    max_price_usd: float | None = None


@dataclass
class RouteDecision:
    picked: list[Listing]
    ranked: list[dict]
    excluded: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"picked": [p.key for p in self.picked], "ranked": self.ranked, "excluded": self.excluded}


def eligibility(listing: Listing, req: RouteRequest) -> str | None:
    card = listing.card
    sec = card["security"]
    if sec.get("hosting_blocked"):
        return "许可证禁止托管"
    if req.sensitive and listing.tier != "trusted":
        return "普通档不接敏感数据"
    if req.sensitive and sec.get("egress"):
        return "能力卡记录了出网行为"
    if card["quality"]["overall"] < req.min_overall:
        return f"总分 {card['quality']['overall']:.2f} 低于要求 {req.min_overall:.2f}"
    if req.max_price_usd is not None and listing.price_usd > req.max_price_usd:
        return "超出预算"
    if req.scenario and success_probability(card, req.scenario, a=0, b=0) == 0:
        return f"在「{req.scenario}」场景从未通过验收"
    return None


def route(registry: Registry, req: RouteRequest) -> RouteDecision:
    if req.strategy not in STRATEGIES:
        raise ValueError(f"unknown strategy {req.strategy!r}")
    ok, excluded = [], []
    for listing in registry.list(req.category):
        why = eligibility(listing, req)
        if why:
            excluded.append({"key": listing.key, "reason": why})
        else:
            ok.append(listing)
    keys = {
        "effective": lambda l: (effective_price(l, req.scenario), -l.card["quality"]["overall"]),
        "quality": lambda l: (-l.card["quality"]["overall"], l.price_usd),
        "price": lambda l: (l.price_usd, -l.card["quality"]["overall"]),
        "speed": lambda l: (l.card["performance"]["wall_p50_s"], -l.card["quality"]["overall"]),
    }
    ok.sort(key=keys[req.strategy])
    # cross-validation wants *different authors*, not three copies of one tool
    picked, authors = [], set()
    for listing in ok:
        if len(picked) >= req.k:
            break
        if req.k > 1 and listing.author in authors:
            continue
        picked.append(listing)
        authors.add(listing.author)
    ranked = [
        {
            "key": l.key,
            "overall": l.card["quality"]["overall"],
            "p_success": round(success_probability(l.card, req.scenario), 4),
            "price_usd": l.price_usd,
            "effective_price_usd": round(effective_price(l, req.scenario), 6),
            "tier": l.tier,
        }
        for l in ok
    ]
    return RouteDecision(picked, ranked, excluded)
