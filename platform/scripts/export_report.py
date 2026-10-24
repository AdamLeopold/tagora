"""Export benchmark + simulation results for the public report page (web/report.html)."""

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "benchmarks" / "pdf" / "results"
OUTS = [ROOT.parent / "web" / "src" / "data" / "pdf-benchmark.json", ROOT.parent / "app" / "src" / "data" / "pdf-benchmark.json"]
SCENARIOS = {"plain": "单栏正文", "multicol": "双栏", "table": "表格", "chinese": "中文", "scanned": "扫描件"}


def card(split, name):
    return json.loads((RES / split / f"{name}.json").read_text())["card"]


def main():
    tools = []
    for f in sorted((RES / "hidden").glob("*.json")):
        if f.name == "summary.json":
            continue
        c = json.loads(f.read_text())["card"]
        tools.append(
            {
                "name": c["name"],
                "version": c["version"],
                "author": c["author"],
                "license": c["license"],
                "upstream": c["upstream"],
                "claim": c["claim"]["text"],
                "overall": c["quality"]["overall"],
                "success_rate": c["quality"]["success_rate"],
                "by_scenario": c["quality"]["by_scenario"],
                "robustness": c["robustness"]["score"],
                "edges": c["robustness"]["edges"],
                "egress": c["security"]["egress"],
                "license_warnings": [s["detail"] for s in c["security"]["static"] if s["rule"] == "license"],
                "adversarial": c["security"]["adversarial"],
                "p50_s": c["performance"]["wall_p50_s"],
                "cpu_mean_s": c["performance"]["cpu_mean_s"],
                "large": c["performance"]["large"],
                "price_usd": c["cost"]["list_price_usd"],
                "compute_usd_per_case": c["cost"]["compute_usd_per_case"],
                "compute_usd_per_verified": c["cost"]["compute_usd_per_verified_result"],
                "known_failures": c["known_failures"],
                "code_hash": c["code_hash"],
                "cases": c["suite"]["cases"],
            }
        )
    tools.sort(key=lambda t: -t["overall"])
    sim = json.loads((RES / "sim.json").read_text())
    v01, v02 = card("public", "tagora-hybrid@0.1"), card("public", "tagora-hybrid")
    hidden_hybrid = card("hidden", "tagora-hybrid")
    data = {
        "generated": date.today().isoformat(),
        "suite": hidden_hybrid["suite"],
        "scenarios": SCENARIOS,
        "hardware": {k: hidden_hybrid["cost"][k] for k in ("hardware_label", "usd_per_cpu_hour", "price_source")},
        "tools": tools,
        "tuning": {
            "v01_public": v01["quality"]["by_scenario"],
            "v02_public": v02["quality"]["by_scenario"],
            "v02_hidden": hidden_hybrid["quality"]["by_scenario"],
            "v01_overall": v01["quality"]["overall"],
            "v02_public_overall": v02["quality"]["overall"],
            "v02_hidden_overall": hidden_hybrid["quality"]["overall"],
        },
        "sim": {
            "calibration": sim["calibration"],
            "routing": sim["routing"]["results"],
            "underwriting": sim["underwriting"],
        },
    }
    fhe = json.loads((ROOT / "benchmarks" / "fhe" / "results.json").read_text())
    data["fhe"] = {"dataset": fhe["dataset"], "runs": [r for r in fhe["ckks"] if "error" not in r]}
    for out in OUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(data, ensure_ascii=False, indent=1))
        print(f"wrote {out} ({len(tools)} tools)")


if __name__ == "__main__":
    main()
