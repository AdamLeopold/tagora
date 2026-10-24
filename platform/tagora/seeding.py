"""Derived listings: the same verified code offered on a trusted (TEE) hardware class.

In this MVP the TEE is simulated: the card's quality numbers come from the
same measured runs, and only the hardware class, tier and price change. A real
deployment re-runs L5 on the confidential-computing host before listing.
"""

from __future__ import annotations

import copy

from .registry import Listing, Registry
from .verify.engine import HARDWARE

TEE_PREMIUM = 1.25  # list-price uplift authors charge for trusted placement


def add_tee_variant(registry: Registry, base: Listing, hardware: str = "cpu-arm64-tee") -> Listing:
    hw = HARDWARE[hardware]
    card = copy.deepcopy(base.card)
    ratio = hw["usd_per_cpu_hour"] / HARDWARE[base.hardware]["usd_per_cpu_hour"]
    card["hardware"], card["tier"], card["simulated_tee"] = hardware, "trusted", True
    cost = card["cost"]
    cost["hardware_label"], cost["usd_per_cpu_hour"], cost["price_source"] = hw["label"], hw["usd_per_cpu_hour"], hw["source"]
    for k in ("compute_usd_per_case", "compute_usd_per_verified_result"):
        if cost.get(k) is not None:
            cost[k] *= ratio
    price = round(base.price_usd * TEE_PREMIUM, 6)
    cost["list_price_usd"] = price
    sr = card["quality"]["success_rate"]
    cost["effective_price_usd"] = price / sr if sr else None
    listing = Listing(**{**base.__dict__, "hardware": hardware, "tier": "trusted", "price_usd": price, "card": card, "listed_at": ""})
    return registry.put(listing)


def rekey(registry: Registry) -> int:
    """Re-store listings under the current key format (one-off migration)."""
    rows = registry._db.execute("SELECT key, data FROM listings").fetchall()
    n = 0
    for old_key, _ in rows:
        listing = registry._db.execute("SELECT data FROM listings WHERE key = ?", (old_key,)).fetchone()
        import json

        l = Listing(**json.loads(listing[0]))
        if l.key != old_key:
            registry._db.execute("DELETE FROM listings WHERE key = ?", (old_key,))
            registry.put(l)
            n += 1
    registry._db.commit()
    return n
