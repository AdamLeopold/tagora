"""Tagora MCP gateway: any agent (Claude Code, Codex, a Tagora twin) can search
verified tools, read capability cards, get outcome quotes and make sealed,
paid calls.

    TAGORA_API=http://127.0.0.1:8787 python -m tagora.mcp_server

Register with Claude Code:

    claude mcp add tagora -- /path/to/platform/.venv/bin/python -m tagora.mcp_server
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from mcp.server import MCPServer

from .client import TagoraClient
from .settlement import Wallet

WALLET_FILE = Path(os.environ.get("TAGORA_WALLET", Path.home() / ".tagora" / "wallet.json"))

server = MCPServer(
    name="tagora",
    title="Tagora",
    instructions=(
        "Tagora routes tasks to open-source tools by their *measured* capability cards, not their READMEs. "
        "Use search_tools to compare Workers, get_capability_card for detail, quote for a price per verified result, "
        "and parse_pdf to run a sealed, paid call. Set sensitive=true for private documents: only trusted-tier "
        "Workers with no recorded network egress are eligible."
    ),
)

_client: TagoraClient | None = None


def client() -> TagoraClient:
    global _client
    if _client is None:
        if WALLET_FILE.exists():
            w = Wallet(**json.loads(WALLET_FILE.read_text()))
            _client = TagoraClient(wallet=w)
        else:
            _client = TagoraClient()
            WALLET_FILE.parent.mkdir(parents=True, exist_ok=True)
            WALLET_FILE.write_text(json.dumps(_client.wallet.__dict__))
            WALLET_FILE.chmod(0o600)
            _client.faucet()
    return _client


def set_client(c: TagoraClient) -> None:
    global _client
    _client = c


@server.tool(description="List verified Workers for a category, cheapest effective price (price ÷ measured success) first.")
def search_tools(category: str = "pdf", sensitive: bool = False) -> list[dict]:
    keep = ("key", "author", "tier", "overall", "success_rate", "by_scenario", "price_usd", "effective_price_usd", "egress", "known_failures")
    return [{k: t[k] for k in keep} for t in client().tools(category, sensitive)]


@server.tool(description="Full capability card for one Worker key (from search_tools).")
def get_capability_card(key: str) -> dict:
    card = client().card(key)
    card["security"]["runtime_events"] = card["security"]["runtime_events"][:20]
    return card


@server.tool(description="Price per *verified* result: Tagora retries across Workers and charges only on success.")
def quote(category: str = "pdf", scenario: str = "", sensitive: bool = False) -> dict:
    return client().quote(category=category, scenario=scenario or None, sensitive=sensitive)


@server.tool(
    description=(
        "Parse a local PDF into Markdown through Tagora. The document is encrypted to an attested enclave whose "
        "code hash must match the Worker's capability card, paid per call (x402-style), and the session key is "
        "destroyed afterwards. Returns the Markdown plus ledger receipt hashes."
    )
)
def parse_pdf(path: str, sensitive: bool = False, strategy: str = "effective", tool_key: str = "") -> dict:
    p = Path(path).expanduser()
    if not p.is_file():
        return {"ok": False, "error": f"file not found: {p}"}
    c = client()
    if c.balance() < 0.05:
        c.faucet()
    return c.run_pdf(p, key=tool_key or None, sensitive=sensitive, strategy=strategy)


@server.tool(description="Wallet balance and ledger integrity.")
def status() -> dict:
    c = client()
    return {"wallet": c.wallet.account, "balance_usd": c.balance(), "ledger": c._get("/v1/ledger/verify")}


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
