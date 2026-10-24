import asyncio
import os
import shutil
from pathlib import Path

import pytest

os.environ["TAGORA_NO_AUTOAPP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from tagora import mcp_server  # noqa: E402
from tagora.api import create_app  # noqa: E402
from tagora.client import TagoraClient, TagoraError  # noqa: E402
from tagora.manifest import load_manifest  # noqa: E402
from tagora.pricing import Attempt, chain_economics  # noqa: E402
from tagora.registry import Listing  # noqa: E402
from tagora.router import RouteRequest, route, success_probability  # noqa: E402
from tagora.seeding import add_tee_variant  # noqa: E402
from tagora.verify.engine import verify_tool  # noqa: E402
from tagora.verify.suites.pdf import PdfSuite  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "benchmarks" / "pdf" / "tools"
PUBLIC = ROOT / "benchmarks" / "pdf" / "corpus" / "public"


def _list(registry, tool_dir: Path) -> Listing:
    card, _ = verify_tool(tool_dir, PdfSuite(), split="public", workers=4)
    m = load_manifest(tool_dir)
    return registry.put(
        Listing(card["tool"], m.name, m.version, "pdf", m.author, m.license, m.upstream, str(tool_dir), m.entrypoint,
                card["code_hash"], "cpu-arm64", "open", m.price_usd, m.claim_text, card)
    )


@pytest.fixture(scope="module")
def env(tmp_path_factory):
    var = tmp_path_factory.mktemp("var")
    tool_copy = tmp_path_factory.mktemp("tools") / "pypdf"
    shutil.copytree(TOOLS / "pypdf", tool_copy)
    app = create_app(var)
    base = _list(app.state.registry, tool_copy)
    tee = add_tee_variant(app.state.registry, base)
    http = TestClient(app)
    c = TagoraClient(http=http)
    c.faucet(1.0)
    return {"app": app, "client": c, "base": base, "tee": tee, "tool_copy": tool_copy}


def test_routing_respects_sensitivity(env):
    reg = env["app"].state.registry
    open_route = route(reg, RouteRequest("pdf", sensitive=False))
    assert open_route.picked
    sens = route(reg, RouteRequest("pdf", sensitive=True))
    assert [p.key for p in sens.picked] == [env["tee"].key]
    assert any(e["reason"] == "普通档不接敏感数据" for e in sens.excluded)


def test_success_probability_is_smoothed(env):
    card = env["base"].card
    p_scan = success_probability(card, "scanned")
    assert 0 < p_scan < 0.3  # 0/2 observed, never exactly zero
    assert success_probability(card, "plain") > 0.6


def test_chain_economics():
    e = chain_economics([Attempt("a", 1.0, 0.5), Attempt("b", 2.0, 0.5)])
    assert e["expected_cost_usd"] == pytest.approx(1.0 + 0.5 * 2.0)
    assert e["p_success"] == pytest.approx(0.75)


def test_sealed_paid_call_end_to_end(env):
    c, app = env["client"], env["app"]
    before = c.balance()
    pdf = next(PUBLIC.glob("plain-*.pdf"))
    out = c.run_pdf(pdf, sensitive=True)
    assert out["ok"] and len(out["markdown"]) > 500
    assert out["tool"] == env["tee"].key
    assert out["paid_usd"] == pytest.approx(env["tee"].price_usd)
    assert c.balance() == pytest.approx(before - env["tee"].price_usd)
    ok, bad, _ = app.state.ledger.verify()
    assert ok
    last = app.state.ledger.tip()
    assert last.type == "call" and last.payload["result_hash"] == out["result_hash"]
    assert "markdown" not in str(last.payload)  # nothing but hashes and money on the chain
    accounts = {a["id"]: a["usd"] for a in app.state.bank.accounts()}
    assert accounts["platform:tagora"] > 0 and accounts[f"author:{env['tee'].author}"] > 0


def test_payment_replay_and_missing_funds_are_rejected(env):
    c = env["client"]
    http = c.http
    key = env["base"].key
    from tagora.enclave import SealedClient, seal

    att = http.post("/v1/attest", json={"key": key}).json()
    sc = SealedClient(c.root_pubkey())
    k = sc.shared_key(att["report"])
    body = {"key": key, "session_id": att["session_id"], "client_pubkey": sc.public_hex, "sealed": seal(k, b"%PDF-1.4 tiny")}
    r = http.post("/v1/run", json=body)
    assert r.status_code == 402 and r.json()["accepts"][0]["network"] == "tagora-sim"
    header = c.wallet.pay(r.json()["accepts"][0])
    assert http.post("/v1/run", json=body, headers={"X-PAYMENT": header}).status_code == 200
    # the session is destroyed after one use
    assert http.post("/v1/run", json=body, headers={"X-PAYMENT": header}).status_code == 404

    from tagora.settlement import Wallet

    broke = TagoraClient(http=http, wallet=Wallet.create())
    with pytest.raises(TagoraError, match="余额不足"):
        broke.run_pdf(next(PUBLIC.glob("plain-*.pdf")), key=key)


def test_swapped_code_is_caught_before_data_leaves(env):
    c = env["client"]
    tool_py = env["tool_copy"] / "tool.py"
    original = tool_py.read_text()
    tool_py.write_text(original + "\n# node operator quietly changed the code\n")
    try:
        with pytest.raises(PermissionError, match="不一致"):
            c.run_pdf(next(PUBLIC.glob("plain-*.pdf")), key=env["base"].key)
    finally:
        tool_py.write_text(original)


def test_mcp_tools_are_registered_and_callable(env):
    mcp_server.set_client(env["client"])
    names = {t.name for t in asyncio.run(mcp_server.server.list_tools())}
    assert {"search_tools", "get_capability_card", "quote", "parse_pdf", "status"} <= names
    found = mcp_server.search_tools("pdf", sensitive=True)
    assert found and found[0]["tier"] == "trusted"
    res = mcp_server.parse_pdf(str(next(PUBLIC.glob("chinese-*.pdf"))), sensitive=True)
    assert res["ok"] and res["block"] > 0


def test_scenario_routing_on_real_cards(tmp_path):
    """With the published hidden-split cards, a scanned PDF must go to an OCR-capable Worker."""
    from tagora.bootstrap import bootstrap

    app = create_app(tmp_path)
    bootstrap(app.state.registry, app.state.ledger, "hidden")
    c = TagoraClient(http=TestClient(app))
    c.faucet(1.0)
    scanned = next(PUBLIC.glob("scanned-*.pdf"))
    out = c.run_pdf(scanned, sensitive=True)
    assert out["scenario"] == "scanned"
    assert out["tool"].startswith("tagora-hybrid") and out["tool"].endswith("-tee")
    assert len(out["markdown"]) > 500
    plain = c.run_pdf(next(PUBLIC.glob("plain-*.pdf")), sensitive=True)
    assert plain["scenario"] == "plain" and plain["attempts"][0]["tool"].startswith("pypdf")  # cheapest that works
