"""The L1–L6 verification engine. Its output, the capability card, is the only
thing the router, the price and the caller's twin are allowed to trust."""

from __future__ import annotations

import statistics
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from ..manifest import Manifest, code_hash, load_manifest
from ..sandbox import RunResult, run_tool
from .static import analyse

CARD_SCHEMA = "tagora.card/v1"

# Public on-demand reference prices used to turn measured resource use into money.
HARDWARE = {
    "cpu-arm64": {
        "label": "通用 ARM CPU（每 vCPU）",
        "usd_per_cpu_hour": 0.0725 / 2,
        "source": "AWS c7g.large on-demand us-east-1, $0.0725/h for 2 vCPU (DoiT, 2026)",
        "tier": "open",
    },
    "cpu-arm64-tee": {
        "label": "机密计算 CPU（每 vCPU，估计溢价 20%）",
        "usd_per_cpu_hour": 0.0725 / 2 * 1.2,
        "source": "c7g reference price × 1.2 assumed confidential-computing premium",
        "tier": "trusted",
    },
}


@dataclass
class Case:
    id: str
    scenario: str
    payload: dict
    files: dict[str, Path]
    truth: object
    units: float = 1.0  # e.g. pages, for cost per unit


@dataclass
class EdgeCase:
    case: Case
    name: str
    check: Callable[[RunResult], bool]


@dataclass
class Suite:
    category: str = ""
    version: str = ""
    scenarios: dict = field(default_factory=dict)
    pass_threshold: float = 0.9

    def cases(self, split: str = "hidden") -> list[Case]:  # pragma: no cover - interface
        raise NotImplementedError

    def score(self, case: Case, output) -> float:  # pragma: no cover
        raise NotImplementedError

    def edges(self) -> list[EdgeCase]:
        return []

    def adversarial(self) -> list[Case]:
        return []

    def large(self) -> Case | None:
        return None


@dataclass
class CaseResult:
    case: Case
    run: RunResult
    score: float

    def to_dict(self) -> dict:
        r = self.run
        return {
            "id": self.case.id,
            "scenario": self.case.scenario,
            "score": round(self.score, 4),
            "ok": r.ok,
            "error": r.error,
            "wall_s": round(r.wall_s, 4),
            "cpu_s": round(r.cpu_s, 4),
            "rss_mb": r.max_rss_mb,
            "events": r.events,
            "timed_out": r.timed_out,
        }


def _pct(xs: list[float], p: float) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    return s[min(len(s) - 1, int(p * len(s)))]


def verify_tool(
    tool_dir: str | Path,
    suite: Suite,
    *,
    hardware: str = "cpu-arm64",
    split: str = "hidden",
    workers: int = 6,
    timeout_s: float = 120.0,
    progress: Callable[[str, dict], None] | None = None,
) -> tuple[dict, list[CaseResult]]:
    m: Manifest = load_manifest(tool_dir)
    if m.category != suite.category:
        raise ValueError(f"tool category {m.category!r} does not match suite {suite.category!r}")
    hw = HARDWARE[hardware]
    say = progress or (lambda stage, info: None)

    # L1
    findings = analyse(m)
    chash = code_hash(m)
    say("L1", {"findings": len(findings)})

    def run(case: Case, timeout: float = timeout_s) -> RunResult:
        return run_tool(m.root, m.entrypoint, case.payload, files=case.files, timeout_s=timeout)

    # L2 — hidden cases, run in parallel (each in its own sandbox)
    cases = suite.cases(split)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        runs = list(pool.map(run, cases))
    results = []
    for case, r in zip(cases, runs):
        try:
            s = suite.score(case, r.output) if r.ok else 0.0
        except Exception:  # noqa: BLE001 - a malformed output scores zero
            s = 0.0
        results.append(CaseResult(case, r, s))
    by_scn: dict[str, list[float]] = {}
    for cr in results:
        by_scn.setdefault(cr.case.scenario, []).append(cr.score)
    by_scenario = {k: round(statistics.fmean(by_scn.get(k, [0.0])), 4) for k in suite.scenarios}
    quality = statistics.fmean(by_scenario.values())
    success_rate = sum(1 for cr in results if cr.score >= suite.pass_threshold) / max(1, len(results))
    success_by_scenario = {
        k: round(sum(1 for cr in results if cr.case.scenario == k and cr.score >= suite.pass_threshold) / max(1, len(by_scn.get(k, []))), 4)
        for k in suite.scenarios
    }
    say("L2", {"quality": quality, "success_rate": success_rate})

    # L3
    edge_runs = [run(e.case, 60) for e in suite.edges()]
    edges = []
    for e, r in zip(suite.edges(), edge_runs):
        try:
            ok = bool(e.check(r))
        except Exception:  # noqa: BLE001
            ok = False
        edges.append({"name": e.name, "pass": ok, "note": (r.error or "")[:160] if not ok else ""})
    robustness = sum(e["pass"] for e in edges) / max(1, len(edges))
    say("L3", {"robustness": robustness})

    # L4
    adv = []
    adv_runs = [run(c, 90) for c in suite.adversarial()]
    for c, r in zip(suite.adversarial(), adv_runs):
        adv.append({"name": c.id, "ok": r.ok, "timed_out": r.timed_out, "wall_s": round(r.wall_s, 3), "error": (r.error or "")[:160]})
    all_runs = runs + edge_runs + adv_runs

    # L5
    large = suite.large()
    large_info = None
    if large:
        lr = run(large, 180)
        all_runs.append(lr)
        large_info = {
            "units": large.units,
            "ok": lr.ok,
            "timed_out": lr.timed_out,
            "wall_s": round(lr.wall_s, 3),
            "cpu_s": round(lr.cpu_s, 3),
            "rss_mb": round(lr.max_rss_mb, 1) if lr.max_rss_mb else None,
            "cpu_s_per_unit": round(lr.cpu_s / large.units, 5) if lr.ok else None,
        }
    events: dict[tuple[str, str], int] = {}
    for r in all_runs:
        for ev in r.events:
            events[(ev["kind"], ev["detail"])] = events.get((ev["kind"], ev["detail"]), 0) + 1
    runtime_events = [{"kind": k, "detail": d, "count": n} for (k, d), n in sorted(events.items())]
    egress = any(k == "egress" for (k, _d) in events)
    ok_runs = [r for r in runs if r.ok]
    walls = [r.wall_s for r in ok_runs]
    cpus = [r.cpu_s for r in ok_runs]
    rss = [r.max_rss_mb for r in all_runs if r.max_rss_mb]
    cpu_per_case = statistics.fmean(cpus) if cpus else 0.0
    usd_per_cpu_s = hw["usd_per_cpu_hour"] / 3600
    compute_per_case = cpu_per_case * usd_per_cpu_s
    say("L4-5", {"egress": egress})

    overall = round(0.8 * quality + 0.2 * robustness, 4)
    known_failures = [suite.scenarios[k] for k, v in by_scenario.items() if v < 0.6]
    known_failures += [e["name"] for e in edges if not e["pass"]]
    known_failures += [f"{a['name']} 超时" for a in adv if a["timed_out"]]
    if egress:
        known_failures.append("存在出网行为")

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    card = {
        "schema": CARD_SCHEMA,
        "tool": m.id,
        "name": m.name,
        "version": m.version,
        "author": m.author,
        "license": m.license,
        "upstream": m.upstream,
        "code_hash": chash,
        "hardware": hardware,
        "tier": hw["tier"],
        "suite": {"category": suite.category, "version": suite.version, "split": split, "cases": len(cases), "pass_threshold": suite.pass_threshold},
        "verified_at": now,
        "claim": {"text": m.claim_text, "accuracy": m.claim_accuracy},
        "quality": {"overall": overall, "mean_case_score": round(quality, 4), "by_scenario": by_scenario, "success_rate": round(success_rate, 4), "success_by_scenario": success_by_scenario},
        "robustness": {"score": round(robustness, 4), "edges": edges},
        "security": {
            "static": [f.to_dict() for f in findings],
            "runtime_events": runtime_events,
            "egress": egress,
            "adversarial": adv,
            "hosting_blocked": any(f.severity == "block" for f in findings),
        },
        "performance": {
            "wall_p50_s": round(_pct(walls, 0.5), 4),
            "wall_p95_s": round(_pct(walls, 0.95), 4),
            "cpu_mean_s": round(cpu_per_case, 4),
            "rss_peak_mb": round(max(rss), 1) if rss else None,
            "large": large_info,
            "errors": sum(1 for r in runs if not r.ok),
        },
        "cost": {
            "hardware_label": hw["label"],
            "usd_per_cpu_hour": round(hw["usd_per_cpu_hour"], 6),
            "price_source": hw["source"],
            "compute_usd_per_case": compute_per_case,
            "compute_usd_per_verified_result": (compute_per_case / success_rate) if success_rate else None,
            "list_price_usd": m.price_usd,
            "effective_price_usd": (m.price_usd / success_rate) if success_rate else None,
        },
        "known_failures": known_failures,
        "recheck": {"count": 0, "trend": [overall], "last": now},
    }
    return card, results
