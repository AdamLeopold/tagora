"""Python SDK for callers (and the MCP gateway): route, attest, seal, pay, unseal."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

import httpx

from .enclave import SealedClient, seal, unseal
from .settlement import Wallet


class TagoraError(Exception):
    pass


class TagoraClient:
    def __init__(self, base_url: str | None = None, *, http: httpx.Client | None = None, wallet: Wallet | None = None, pinned_root: str | None = None):
        self.http = http or httpx.Client(base_url=base_url or os.environ.get("TAGORA_API", "http://127.0.0.1:8787"), timeout=300)
        self.wallet = wallet or Wallet.create()
        self._root = pinned_root  # pin out-of-band in production; TOFU otherwise

    # ---------------------------------------------------------------- reads
    def _get(self, path: str, **params):
        r = self.http.get(path, params=params)
        if r.status_code >= 400:
            raise TagoraError(f"{r.status_code} {r.text}")
        return r.json()

    def _post(self, path: str, body: dict):
        r = self.http.post(path, json=body)
        if r.status_code >= 400:
            raise TagoraError(f"{r.status_code} {r.text}")
        return r.json()

    def tools(self, category: str | None = None, sensitive: bool = False) -> list[dict]:
        params = {"sensitive": sensitive}
        if category:
            params["category"] = category
        return self._get("/v1/tools", **params)

    def card(self, key: str) -> dict:
        return self._get(f"/v1/tools/{key}/card")

    def route(self, **req) -> dict:
        return self._post("/v1/route", req)

    def quote(self, **req) -> dict:
        return self._post("/v1/quote", req)

    def faucet(self, usd: float = 5.0) -> dict:
        return self._post("/v1/faucet", {"account": self.wallet.account, "usd": usd})

    def balance(self) -> float:
        return self._get(f"/v1/wallets/{self.wallet.account}")["balance_usd"]

    def root_pubkey(self) -> str:
        if not self._root:
            self._root = self._get("/v1/attest/root")["root_pubkey"]
        return self._root

    # ---------------------------------------------------------------- ciphertext tier
    def fhe_predict(self, features, model_id: str = "risk-logreg") -> dict:
        """Encrypt locally, let the Worker score the ciphertext, decrypt locally."""
        from .fhe import CkksParams, client_context, decrypt, encrypt, public_bytes

        spec = next(m for m in self._get("/v1/fhe/models") if m["id"] == model_id)
        c = spec["ckks"]
        params = CkksParams(c["poly_modulus_degree"], c["coeff_mod_bit_sizes"], c["scale_bits"])
        cache = self.__dict__.setdefault("_fhe_ctx", {})
        if params.label() not in cache:
            ctx = client_context(params)
            r = self.http.post("/v1/fhe/contexts", content=public_bytes(ctx), headers={"Content-Type": "application/octet-stream"})
            if r.status_code >= 400:
                raise TagoraError(f"{r.status_code} {r.text}")
            cache[params.label()] = (ctx, r.json()["context_id"])
        ctx, cid = cache[params.label()]
        import numpy as np

        body = {"model_id": model_id, "context_id": cid, "ciphertext": base64.b64encode(encrypt(ctx, np.asarray(features, dtype=float))).decode()}
        r = self.http.post("/v1/fhe/predict", json=body)
        if r.status_code == 402:
            r = self.http.post("/v1/fhe/predict", json=body, headers={"X-PAYMENT": self.wallet.pay(r.json()["accepts"][0])})
        if r.status_code >= 400:
            raise TagoraError(f"{r.status_code} {r.text}")
        data = r.json()
        logit = decrypt(ctx, base64.b64decode(data["ciphertext"]))
        return {"model": model_id, "logit": logit, "label": int(logit > 0), "worker_ms": data["worker_ms"], "block": data["block"]}

    # ---------------------------------------------------------------- paid call
    def run_pdf(self, path: str | Path, *, key: str | None = None, sensitive: bool = False, strategy: str = "effective") -> dict:
        if key is None:
            decision = self.route(category="pdf", sensitive=sensitive, strategy=strategy, k=1)
            if not decision["picked"]:
                raise TagoraError(f"no eligible worker: {decision['excluded']}")
            key = decision["picked"][0]
        expected = self.card(key)["code_hash"]

        att = self._post("/v1/attest", {"key": key})
        sc = SealedClient(self.root_pubkey())
        sc.check(att["report"], att["signature"], expected)  # raises before any data leaves
        k = sc.shared_key(att["report"])
        body = {
            "key": key,
            "session_id": att["session_id"],
            "client_pubkey": sc.public_hex,
            "sealed": seal(k, Path(path).read_bytes()),
            "filename": Path(path).name,
        }
        r = self.http.post("/v1/run", json=body)
        if r.status_code == 402:
            requirements = r.json()["accepts"][0]
            r = self.http.post("/v1/run", json=body, headers={"X-PAYMENT": self.wallet.pay(requirements)})
        if r.status_code >= 400:
            raise TagoraError(f"{r.status_code} {r.text}")
        data = r.json()
        result = json.loads(unseal(k, data["sealed_result"]))
        payment = json.loads(base64.b64decode(r.headers["X-PAYMENT-RESPONSE"]))
        return {
            "tool": key,
            "ok": result["ok"],
            "markdown": (result.get("output") or {}).get("markdown", ""),
            "error": result.get("error"),
            "wall_s": result.get("wall_s"),
            "egress_events": [e for e in result.get("events", []) if e["kind"] == "egress"],
            "receipt_hash": data["receipt_hash"],
            "result_hash": data["result_hash"],
            "block": data["block"],
            "paid_usd": payment["amount_micros"] / 1e6,
            "attestation": {"measurement": att["report"]["measurement"], "simulated": att["report"].get("simulated", True)},
        }
