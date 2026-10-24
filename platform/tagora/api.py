"""Tagora HTTP API (phase 1 MVP).

    uvicorn tagora.api:app --port 8787

Every paid call follows the same path the whitepaper describes:
capability-card routing → attestation → sealed input → payment (402 → X-PAYMENT)
→ sandboxed execution → sealed output → session key destroyed → hashes on the ledger.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import __version__
from .enclave import EnclaveSession, VendorRoot, dumps, enclave_key, open_session, seal, unseal
from .ledger import Ledger, canonical
from .pricing import outcome_quote
from .registry import Registry
from .router import RouteRequest, effective_price, route, success_probability
from .sandbox import run_tool
from .settlement import Bank, PaymentError

SPLIT = {"author": 0.35, "compute": 0.55, "platform": 0.10}
FAUCET_USD = 5.0


class RouteBody(BaseModel):
    category: str = "pdf"
    sensitive: bool = False
    strategy: str = "effective"
    k: int = 1
    scenario: str | None = None
    min_overall: float = 0.0
    max_price_usd: float | None = None


class QuoteBody(RouteBody):
    max_attempts: int = 3
    margin: float = 0.15


class AttestBody(BaseModel):
    key: str


class RunBody(BaseModel):
    key: str
    session_id: str
    client_pubkey: str
    sealed: dict
    filename: str = "input.pdf"


class FhePredict(BaseModel):
    model_id: str
    context_id: str
    ciphertext: str


class FaucetBody(BaseModel):
    account: str
    usd: float = FAUCET_USD


def summary(listing) -> dict:
    c = listing.card
    return {
        "key": listing.key,
        "name": listing.name,
        "version": listing.version,
        "author": listing.author,
        "category": listing.category,
        "tier": listing.tier,
        "hardware": listing.hardware,
        "license": listing.license,
        "price_usd": listing.price_usd,
        "overall": c["quality"]["overall"],
        "success_rate": c["quality"]["success_rate"],
        "by_scenario": c["quality"]["by_scenario"],
        "egress": c["security"]["egress"],
        "p50_s": c["performance"]["wall_p50_s"],
        "effective_price_usd": round(effective_price(listing), 6),
        "code_hash": listing.code_hash,
        "claim": listing.claim_text,
        "known_failures": c.get("known_failures", []),
    }


def create_app(var_dir: str | Path | None = None) -> FastAPI:
    var = Path(var_dir or os.environ.get("TAGORA_VAR", Path(__file__).resolve().parents[1] / "var"))
    var.mkdir(parents=True, exist_ok=True)
    registry = Registry(var / "registry.db")
    ledger = Ledger(var / "ledger.db")
    bank = Bank(str(var / "bank.db"))
    root = VendorRoot(var / "vendor_root.key")
    sessions: dict[str, tuple[EnclaveSession, str]] = {}
    lock = threading.Lock()

    app = FastAPI(title="Tagora API", version=__version__, description="可验证的 AI 执行市场 · Phase 1 MVP")
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["X-PAYMENT-RESPONSE"])
    app.state.registry, app.state.ledger, app.state.bank, app.state.root = registry, ledger, bank, root

    @app.get("/v1/health")
    def health():
        ok, bad, why = ledger.verify()
        return {"ok": True, "version": __version__, "tools": len(registry.list()), "ledger_height": ledger.height(), "ledger_valid": ok}

    @app.get("/v1/tools")
    def tools(category: str | None = None, sensitive: bool = False):
        items = [summary(l) for l in registry.list(category)]
        if sensitive:
            items = [i for i in items if i["tier"] == "trusted" and not i["egress"]]
        return sorted(items, key=lambda i: i["effective_price_usd"])

    @app.get("/v1/tools/{key:path}/card")
    def card(key: str):
        l = registry.get(key)
        if not l:
            raise HTTPException(404, f"no listing {key}")
        return l.card

    @app.post("/v1/route")
    def do_route(body: RouteBody):
        try:
            return route(registry, RouteRequest(**body.model_dump())).to_dict()
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.post("/v1/quote")
    def quote(body: QuoteBody):
        req = RouteRequest(**body.model_dump(exclude={"max_attempts", "margin"}))
        decision = route(registry, req)
        ranked = [registry.get(r["key"]) for r in decision.ranked]
        return outcome_quote(ranked, body.scenario, max_attempts=body.max_attempts, margin=body.margin)

    @app.get("/v1/attest/root")
    def attest_root():
        return {"root_pubkey": root.public_hex, "algorithm": "ed25519", "simulated": True}

    @app.post("/v1/attest")
    def attest(body: AttestBody):
        l = registry.get(body.key)
        if not l:
            raise HTTPException(404, f"no listing {body.key}")
        # measure what will actually run, not what the registry says
        from .manifest import code_hash, load_manifest

        measured = code_hash(load_manifest(l.tool_dir))
        s = open_session(root, measured, l.hardware, l.tier)
        with lock:
            now = time.time()
            for sid in [k for k, (v, _) in sessions.items() if v.expires_at < now]:
                sessions.pop(sid, None)
            sessions[s.session_id] = (s, body.key)
        return {"session_id": s.session_id, "report": s.report, "signature": s.signature, "root_pubkey": root.public_hex}

    @app.post("/v1/run")
    def run(body: RunBody, request: Request, x_payment: str | None = Header(default=None)):
        with lock:
            entry = sessions.get(body.session_id)
        if not entry or entry[1] != body.key:
            raise HTTPException(404, "attestation session not found or expired")
        session, _ = entry
        listing = registry.get(body.key)
        resource = f"/v1/run/{body.session_id}"
        try:
            key = enclave_key(session, body.client_pubkey)
            plaintext = unseal(key, body.sealed)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"sealed payload rejected: {e}") from e

        if not x_payment:
            req = bank.requirements(listing.price_usd, resource, description=f"{listing.key} × 1 call")
            return JSONResponse({"x402Version": 1, "error": "X-PAYMENT header is required", "accepts": [req]}, status_code=402)
        splits = {
            f"author:{listing.author}": SPLIT["author"],
            f"compute:{listing.hardware}": SPLIT["compute"],
            "platform:tagora": SPLIT["platform"],
        }
        try:
            receipt = bank.settle(x_payment, resource, splits)
        except PaymentError as e:
            req = bank.requirements(listing.price_usd, resource, description=f"{listing.key} × 1 call")
            return JSONResponse({"x402Version": 1, "error": str(e), "accepts": [req]}, status_code=402)

        with tempfile.TemporaryDirectory(prefix="tagora-enclave-") as tmp:
            path = Path(tmp) / Path(body.filename).name
            path.write_bytes(plaintext)
            r = run_tool(listing.tool_dir, listing.entrypoint, {}, files={"pdf": path}, timeout_s=180)
        result = {"ok": r.ok, "output": r.output, "error": r.error, "wall_s": r.wall_s, "events": r.events}
        sealed_out = seal(key, dumps(result))
        with lock:
            sessions.pop(body.session_id, None)  # the enclave and its key are gone
        del key

        result_hash = hashlib.sha256(base64.b64decode(sealed_out["ciphertext"])).hexdigest()
        report_hash = hashlib.sha256(canonical(session.report).encode()).hexdigest()
        receipt_hash = hashlib.sha256(
            canonical({"tool": listing.key, "code_hash": session.report["measurement"], "report": report_hash, "result": result_hash}).encode()
        ).hexdigest()
        block = ledger.append(
            "call",
            {
                "tool": listing.key,
                "code_hash": session.report["measurement"],
                "receipt_hash": receipt_hash,
                "result_hash": result_hash,
                "price_micros": receipt["amount_micros"],
                "split_micros": receipt["splits_micros"],
                "egress_events": sum(1 for e in r.events if e["kind"] == "egress"),
            },
        )
        receipt |= {"block": block.index}
        headers = {"X-PAYMENT-RESPONSE": base64.b64encode(json.dumps(receipt).encode()).decode()}
        return JSONResponse(
            {"sealed_result": sealed_out, "receipt_hash": receipt_hash, "result_hash": result_hash, "block": block.index, "tool": listing.key},
            headers=headers,
        )

    # ---------------------------------------------------------------- ciphertext tier (CKKS)
    fhe_models: dict = {}
    fhe_contexts: dict[str, bytes] = {}

    def _fhe_models():
        if not fhe_models:
            from .fhe import CkksParams, accuracy, load_data, train_logreg, train_square_mlp

            Xtr, Xte, ytr, yte = load_data()
            lr = train_logreg(Xtr, ytr, C=1.0)
            mlp = train_square_mlp(Xtr, ytr, hidden=8, scale=0.1)
            fhe_models["risk-logreg"] = {
                "model": lr,
                "params": CkksParams(8192, [60, 40, 60], 40),
                "price_usd": 0.002,
                "acc_plain": accuracy(lr.logits(Xte), yte),
            }
            fhe_models["risk-mlp-square"] = {
                "model": mlp,
                "params": CkksParams(8192, [60, 30, 30, 30, 60], 30),
                "price_usd": 0.006,
                "acc_plain": accuracy(mlp.logits(Xte), yte),
            }
        return fhe_models

    @app.get("/v1/fhe/models")
    def fhe_list():
        return [
            {
                "id": k,
                "kind": v["model"].kind,
                "depth": v["model"].depth,
                "ckks": {"poly_modulus_degree": v["params"].poly_modulus_degree, "coeff_mod_bit_sizes": v["params"].coeff_mod_bit_sizes, "scale_bits": v["params"].scale_bits},
                "features": 30,
                "task": "breast-cancer malignancy logit (sklearn dataset, standardised features)",
                "acc_plain": round(v["acc_plain"], 4),
                "price_usd": v["price_usd"],
                "tier": "fhe",
            }
            for k, v in _fhe_models().items()
        ]

    @app.post("/v1/fhe/contexts")
    async def fhe_context(request: Request):
        import tenseal as ts

        body = await request.body()
        try:
            ctx = ts.context_from(body)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"not a TenSEAL context: {e}") from e
        if ctx.has_secret_key():
            raise HTTPException(400, "context contains the secret key; send the public context only")
        cid = hashlib.sha256(body).hexdigest()
        fhe_contexts[cid] = body
        return {"context_id": cid, "bytes": len(body)}

    @app.post("/v1/fhe/predict")
    def fhe_predict(body: FhePredict, x_payment: str | None = Header(default=None)):
        from .fhe import worker_eval

        models = _fhe_models()
        if body.model_id not in models:
            raise HTTPException(404, "unknown model")
        if body.context_id not in fhe_contexts:
            raise HTTPException(404, "unknown context; POST /v1/fhe/contexts first")
        spec = models[body.model_id]
        resource = f"/v1/fhe/predict/{body.model_id}/{hashlib.sha256(body.ciphertext.encode()).hexdigest()[:16]}"
        if not x_payment:
            req = bank.requirements(spec["price_usd"], resource, description=f"{body.model_id} × 1 encrypted inference")
            return JSONResponse({"x402Version": 1, "error": "X-PAYMENT header is required", "accepts": [req]}, status_code=402)
        try:
            receipt = bank.settle(x_payment, resource, {"author:tagora-fhe": SPLIT["author"], "compute:fhe-cpu": SPLIT["compute"], "platform:tagora": SPLIT["platform"]})
        except PaymentError as e:
            req = bank.requirements(spec["price_usd"], resource, description=f"{body.model_id} × 1 encrypted inference")
            return JSONResponse({"x402Version": 1, "error": str(e), "accepts": [req]}, status_code=402)
        t0 = time.perf_counter()
        try:
            out = worker_eval(fhe_contexts[body.context_id], base64.b64decode(body.ciphertext), spec["model"])
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"evaluation failed (parameters must match the model's CKKS settings): {e}") from e
        ms = (time.perf_counter() - t0) * 1e3
        in_hash = hashlib.sha256(base64.b64decode(body.ciphertext)).hexdigest()
        out_hash = hashlib.sha256(out).hexdigest()
        block = ledger.append("fhe-call", {"model": body.model_id, "input_ct_hash": in_hash, "result_ct_hash": out_hash, "price_micros": receipt["amount_micros"]})
        receipt |= {"block": block.index}
        return JSONResponse(
            {"ciphertext": base64.b64encode(out).decode(), "worker_ms": round(ms, 2), "block": block.index, "result_ct_hash": out_hash},
            headers={"X-PAYMENT-RESPONSE": base64.b64encode(json.dumps(receipt).encode()).decode()},
        )

    @app.post("/v1/faucet")
    def faucet(body: FaucetBody):
        if os.environ.get("TAGORA_FAUCET", "1") != "1":
            raise HTTPException(403, "faucet disabled")
        bank.mint(body.account, min(body.usd, 20.0), "faucet")
        return {"account": body.account, "balance_usd": bank.balance(body.account)}

    @app.get("/v1/wallets/{account}")
    def wallet(account: str):
        return {"account": account, "balance_usd": bank.balance(account)}

    @app.get("/v1/accounts")
    def accounts():
        return bank.accounts()

    @app.get("/v1/ledger")
    def ledger_blocks(since: int = 0, limit: int = 200):
        return [b.to_dict() for b in ledger.blocks(since, limit)]

    @app.get("/v1/ledger/verify")
    def ledger_verify():
        ok, bad, why = ledger.verify()
        return {"ok": ok, "bad_index": bad, "reason": why, "height": ledger.height()}

    @app.get("/v1/scenarios/{category}")
    def scenario_probs(category: str):
        return {
            l.key: {s: round(success_probability(l.card, s), 4) for s in l.card["quality"]["by_scenario"]} for l in registry.list(category)
        }

    return app


app = create_app() if os.environ.get("TAGORA_NO_AUTOAPP") != "1" else None
