"""Simulated TEE attestation and sealed payloads.

The protocol is the real one (signed measurement → caller checks it against
the capability card → X25519 key agreement → AES-256-GCM both ways → session
key destroyed). What is simulated is the root of trust: a real deployment's
report is signed by a key fused into the CPU (Intel TDX / AMD SEV-SNP); here
an Ed25519 "vendor root" generated on the verifier host stands in for it.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from .ledger import canonical

RAW = serialization.Encoding.Raw
RAW_PUB = serialization.PublicFormat.Raw
RAW_PRIV = serialization.PrivateFormat.Raw
NOENC = serialization.NoEncryption()


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def unb64(s: str) -> bytes:
    return base64.b64decode(s)


def pub_hex(k) -> str:
    return k.public_key().public_bytes(RAW, RAW_PUB).hex()


class VendorRoot:
    def __init__(self, path: Path | None = None):
        if path and path.exists():
            self.key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(path.read_text().strip()))
        else:
            self.key = Ed25519PrivateKey.generate()
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(self.key.private_bytes(RAW, RAW_PRIV, NOENC).hex())
                os.chmod(path, 0o600)
        self.public_hex = pub_hex(self.key)

    def sign(self, report: dict) -> str:
        return self.key.sign(canonical(report).encode()).hex()


def verify_report(root_public_hex: str, report: dict, signature_hex: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(root_public_hex)).verify(bytes.fromhex(signature_hex), canonical(report).encode())
        return True
    except Exception:  # noqa: BLE001
        return False


def _derive(shared: bytes, context: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=b"tagora-sealed-v1" + context).derive(shared)


@dataclass
class EnclaveSession:
    session_id: str
    key: X25519PrivateKey
    report: dict
    signature: str
    expires_at: float


def open_session(root: VendorRoot, measurement: str, hardware: str, tier: str, ttl_s: float = 300) -> EnclaveSession:
    key = X25519PrivateKey.generate()
    report = {
        "measurement": measurement,
        "hardware": hardware,
        "tier": tier,
        "enclave_pubkey": pub_hex(key),
        "nonce": secrets.token_hex(12),
        "issued_at": int(time.time()),
        "simulated": True,
    }
    return EnclaveSession(secrets.token_hex(16), key, report, root.sign(report), time.time() + ttl_s)


def seal(shared_key: bytes, plaintext: bytes, aad: bytes = b"") -> dict:
    iv = secrets.token_bytes(12)
    return {"iv": b64(iv), "ciphertext": b64(AESGCM(shared_key).encrypt(iv, plaintext, aad))}


def unseal(shared_key: bytes, box: dict, aad: bytes = b"") -> bytes:
    return AESGCM(shared_key).decrypt(unb64(box["iv"]), unb64(box["ciphertext"]), aad)


def enclave_key(session: EnclaveSession, client_pub_hex: str) -> bytes:
    shared = session.key.exchange(X25519PublicKey.from_public_bytes(bytes.fromhex(client_pub_hex)))
    return _derive(shared, bytes.fromhex(session.report["nonce"]))


class SealedClient:
    """Caller side: verify the report, then agree a key with that enclave only."""

    def __init__(self, root_public_hex: str):
        self.root_public_hex = root_public_hex
        self.key = X25519PrivateKey.generate()
        self.public_hex = pub_hex(self.key)

    def check(self, report: dict, signature: str, expected_measurement: str) -> None:
        if not verify_report(self.root_public_hex, report, signature):
            raise PermissionError("远程证明签名无效")
        if report["measurement"] != expected_measurement:
            raise PermissionError(
                f"隔离区度量 {report['measurement'][:12]}… 与能力卡 {expected_measurement[:12]}… 不一致，拒绝发送数据"
            )

    def shared_key(self, report: dict) -> bytes:
        shared = self.key.exchange(X25519PublicKey.from_public_bytes(bytes.fromhex(report["enclave_pubkey"])))
        return _derive(shared, bytes.fromhex(report["nonce"]))


def dumps(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False).encode()
