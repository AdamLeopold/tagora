"""x402-style pay-per-call settlement in simulated USDC.

Flow (same shape as the x402 protocol): a paid endpoint answers 402 with
payment requirements; the client signs a payment authorisation with its wallet
key and retries with an ``X-PAYMENT`` header; the server verifies, settles,
and returns an ``X-PAYMENT-RESPONSE`` receipt. The network is ``tagora-sim``:
balances live in SQLite, nothing touches a real chain.
"""

from __future__ import annotations

import base64
import json
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .enclave import NOENC, RAW, RAW_PRIV, pub_hex
from .ledger import canonical

MICRO = 1_000_000
NETWORK = "tagora-sim"
ASSET = "USDC-sim"


class PaymentError(Exception):
    pass


def to_micros(usd: float) -> int:
    return max(1, round(usd * MICRO))


@dataclass
class Wallet:
    account: str  # ed25519 public key hex
    private_hex: str

    @classmethod
    def create(cls) -> "Wallet":
        k = Ed25519PrivateKey.generate()
        return cls(pub_hex(k), k.private_bytes(RAW, RAW_PRIV, NOENC).hex())

    def pay(self, requirements: dict) -> str:
        """Sign an authorisation for exactly what the 402 asked for."""
        auth = {
            "from": self.account,
            "to": requirements["payTo"],
            "amount": requirements["maxAmountRequired"],
            "asset": requirements["asset"],
            "network": requirements["network"],
            "resource": requirements["resource"],
            "nonce": requirements["nonce"],
            "validBefore": requirements["validBefore"],
        }
        sig = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(self.private_hex)).sign(canonical(auth).encode()).hex()
        return base64.b64encode(json.dumps({"x402Version": 1, "scheme": "exact", "payload": {"authorization": auth, "signature": sig}}).encode()).decode()


class Bank:
    def __init__(self, path: str = ":memory:"):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, label TEXT, micros INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS pending (nonce TEXT PRIMARY KEY, requirements TEXT, created REAL);
            CREATE TABLE IF NOT EXISTS used_nonces (nonce TEXT PRIMARY KEY);
            """
        )
        self._db.commit()

    # -- accounts
    def ensure(self, account: str, label: str = "") -> None:
        self._db.execute("INSERT OR IGNORE INTO accounts (id, label, micros) VALUES (?, ?, 0)", (account, label))
        self._db.commit()

    def mint(self, account: str, usd: float, label: str = "faucet") -> None:
        with self._lock:
            self.ensure(account, label)
            self._db.execute("UPDATE accounts SET micros = micros + ? WHERE id = ?", (to_micros(usd), account))
            self._db.commit()

    def balance(self, account: str) -> float:
        row = self._db.execute("SELECT micros FROM accounts WHERE id = ?", (account,)).fetchone()
        return (row[0] if row else 0) / MICRO

    def accounts(self) -> list[dict]:
        return [{"id": r[0], "label": r[1], "usd": r[2] / MICRO} for r in self._db.execute("SELECT id, label, micros FROM accounts ORDER BY micros DESC")]

    # -- x402 flow
    def requirements(self, amount_usd: float, resource: str, pay_to: str = "platform:escrow", description: str = "", ttl_s: int = 300) -> dict:
        req = {
            "scheme": "exact",
            "network": NETWORK,
            "asset": ASSET,
            "maxAmountRequired": str(to_micros(amount_usd)),
            "resource": resource,
            "description": description,
            "payTo": pay_to,
            "nonce": secrets.token_hex(16),
            "validBefore": int(time.time()) + ttl_s,
        }
        self._db.execute("INSERT INTO pending VALUES (?, ?, ?)", (req["nonce"], json.dumps(req), time.time()))
        self._db.commit()
        return req

    def settle(self, header: str, resource: str, splits: dict[str, float]) -> dict:
        """Verify an X-PAYMENT header and move the money. ``splits`` maps payee account -> share (sums to 1)."""
        try:
            body = json.loads(base64.b64decode(header))
            auth, sig = body["payload"]["authorization"], body["payload"]["signature"]
        except Exception as e:  # noqa: BLE001
            raise PaymentError(f"无法解析 X-PAYMENT：{e}") from e
        with self._lock:
            row = self._db.execute("SELECT requirements FROM pending WHERE nonce = ?", (auth.get("nonce"),)).fetchone()
            if not row:
                raise PaymentError("未知或已使用的 nonce")
            req = json.loads(row[0])
            for k in ("network", "asset", "resource"):
                if auth.get(k) != req[k]:
                    raise PaymentError(f"{k} 与支付要求不符")
            if req["resource"] != resource:
                raise PaymentError("支付针对的不是这个资源")
            if int(auth["amount"]) < int(req["maxAmountRequired"]):
                raise PaymentError("金额不足")
            if time.time() > req["validBefore"]:
                raise PaymentError("支付授权已过期")
            try:
                Ed25519PublicKey.from_public_bytes(bytes.fromhex(auth["from"])).verify(bytes.fromhex(sig), canonical(auth).encode())
            except Exception as e:  # noqa: BLE001
                raise PaymentError("签名无效") from e
            amount = int(auth["amount"])
            payer = auth["from"]
            row = self._db.execute("SELECT micros FROM accounts WHERE id = ?", (payer,)).fetchone()
            if not row or row[0] < amount:
                raise PaymentError("余额不足")
            self._db.execute("UPDATE accounts SET micros = micros - ? WHERE id = ?", (amount, payer))
            paid, items = 0, list(splits.items())
            parts = {}
            for i, (acct, share) in enumerate(items):
                part = amount - paid if i == len(items) - 1 else int(amount * share)
                paid += part
                parts[acct] = part
                self._db.execute("INSERT OR IGNORE INTO accounts (id, label, micros) VALUES (?, ?, 0)", (acct, acct))
                self._db.execute("UPDATE accounts SET micros = micros + ? WHERE id = ?", (part, acct))
            self._db.execute("DELETE FROM pending WHERE nonce = ?", (auth["nonce"],))
            self._db.execute("INSERT INTO used_nonces VALUES (?)", (auth["nonce"],))
            self._db.commit()
        return {
            "success": True,
            "network": NETWORK,
            "payer": payer,
            "amount_micros": amount,
            "splits_micros": parts,
            "transaction": secrets.token_hex(16),
        }
