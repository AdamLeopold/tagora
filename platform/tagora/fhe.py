"""Ciphertext tier prototype: train in plaintext, infer on CKKS ciphertexts.

The caller keeps the secret key. The Worker receives a *public* CKKS context
(no secret key) and an encrypted feature vector, evaluates its own plaintext
weights on it, and returns an encrypted logit. Neither the input nor the
output is ever visible to the Worker; the weights never leave the Worker.

Models are limited to what CKKS evaluates natively: additions and
multiplications, so the hidden layer uses x² instead of ReLU.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field

import numpy as np
import tenseal as ts


# ---------------------------------------------------------------- training


def load_data(seed: int = 0):
    from sklearn.datasets import load_breast_cancer
    from sklearn.model_selection import train_test_split
    from sklearn.preprocessing import StandardScaler

    X, y = load_breast_cancer(return_X_y=True)
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.3, random_state=seed, stratify=y)
    sc = StandardScaler().fit(Xtr)
    return sc.transform(Xtr), sc.transform(Xte), ytr.astype(float), yte.astype(float)


@dataclass
class LinearModel:
    w: np.ndarray
    b: float
    kind: str = "logreg"
    depth: int = 1

    def logits(self, X: np.ndarray) -> np.ndarray:
        return X @ self.w + self.b


@dataclass
class SquareMLP:
    W1: np.ndarray
    b1: np.ndarray
    w2: np.ndarray
    b2: float
    kind: str = "mlp-square"
    depth: int = 3
    scale: float = 1.0  # pre-activation scaling keeps x² in a small range

    def logits(self, X: np.ndarray) -> np.ndarray:
        h = ((X @ self.W1 + self.b1) * self.scale) ** 2
        return h @ self.w2 + self.b2


def train_logreg(Xtr, ytr, C: float = 1.0) -> LinearModel:
    from sklearn.linear_model import LogisticRegression

    m = LogisticRegression(C=C, max_iter=5000).fit(Xtr, ytr)
    return LinearModel(m.coef_[0].astype(float), float(m.intercept_[0]))


def train_square_mlp(Xtr, ytr, hidden: int = 8, epochs: int = 600, lr: float = 0.01, l2: float = 1e-3, scale: float = 0.3, seed: int = 0) -> SquareMLP:
    rng = np.random.default_rng(seed)
    d = Xtr.shape[1]
    W1 = rng.normal(0, 1 / np.sqrt(d), (d, hidden))
    b1 = np.zeros(hidden)
    w2 = rng.normal(0, 1 / np.sqrt(hidden), hidden)
    b2 = 0.0
    params = [W1, b1, w2, np.array([b2])]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    for t in range(1, epochs + 1):
        z = (Xtr @ W1 + b1) * scale
        h = z**2
        logit = h @ w2 + params[3][0]
        p = 1 / (1 + np.exp(-np.clip(logit, -30, 30)))
        g = (p - ytr) / len(ytr)
        gw2 = h.T @ g + l2 * w2
        gb2 = np.array([g.sum()])
        gh = np.outer(g, w2) * 2 * z * scale
        gW1 = Xtr.T @ gh + l2 * W1
        gb1 = gh.sum(0)
        for i, gr in enumerate([gW1, gb1, gw2, gb2]):
            m[i] = 0.9 * m[i] + 0.1 * gr
            v[i] = 0.999 * v[i] + 0.001 * gr**2
            params[i] -= lr * (m[i] / (1 - 0.9**t)) / (np.sqrt(v[i] / (1 - 0.999**t)) + 1e-8)
        W1, b1, w2 = params[0], params[1], params[2]
    return SquareMLP(W1, b1, w2, float(params[3][0]), scale=scale)


def accuracy(logits: np.ndarray, y: np.ndarray) -> float:
    return float(((logits > 0).astype(float) == y).mean())


# ---------------------------------------------------------------- CKKS


@dataclass
class CkksParams:
    poly_modulus_degree: int = 8192
    coeff_mod_bit_sizes: list[int] = field(default_factory=lambda: [60, 40, 40, 60])
    scale_bits: int = 40

    def label(self) -> str:
        return f"N={self.poly_modulus_degree} q={'-'.join(map(str, self.coeff_mod_bit_sizes))} Δ=2^{self.scale_bits}"


def client_context(p: CkksParams) -> ts.Context:
    ctx = ts.context(ts.SCHEME_TYPE.CKKS, poly_modulus_degree=p.poly_modulus_degree, coeff_mod_bit_sizes=p.coeff_mod_bit_sizes)
    ctx.global_scale = 2**p.scale_bits
    ctx.generate_galois_keys()
    return ctx


def public_bytes(ctx: ts.Context) -> bytes:
    """What the Worker gets: evaluation keys, never the secret key."""
    return ctx.serialize(save_public_key=True, save_secret_key=False, save_galois_keys=True, save_relin_keys=True)


def encrypt(ctx: ts.Context, x: np.ndarray) -> bytes:
    return ts.ckks_vector(ctx, x.tolist()).serialize()


def worker_eval(public_ctx: bytes, enc_x: bytes, model) -> bytes:
    """Runs on the Worker: plaintext weights × ciphertext input → ciphertext logit."""
    ctx = ts.context_from(public_ctx)
    if ctx.has_secret_key():
        raise PermissionError("worker must not receive the secret key")
    x = ts.ckks_vector_from(ctx, enc_x)
    if isinstance(model, LinearModel):
        out = x.dot(model.w.tolist()) + model.b
    else:
        # fold the pre-activation scale into layer 1: a separate multiply would burn a level
        z = x.mm((model.W1 * model.scale).tolist()) + (model.b1 * model.scale).tolist()
        out = z.square().dot(model.w2.tolist()) + model.b2
    return out.serialize()


def decrypt(ctx: ts.Context, enc_out: bytes) -> float:
    return float(ts.ckks_vector_from(ctx, enc_out).decrypt()[0])


def evaluate(model, X: np.ndarray, y: np.ndarray, p: CkksParams, limit: int | None = None) -> dict:
    ctx = client_context(p)
    pub = public_bytes(ctx)
    plain = model.logits(X)
    enc_logits, t_enc, t_eval, t_dec, in_size, out_size = [], [], [], [], [], []
    n = len(X) if limit is None else min(limit, len(X))
    for i in range(n):
        t0 = time.perf_counter()
        ex = encrypt(ctx, X[i])
        t1 = time.perf_counter()
        eo = worker_eval(pub, ex, model)
        t2 = time.perf_counter()
        enc_logits.append(decrypt(ctx, eo))
        t3 = time.perf_counter()
        t_enc.append(t1 - t0)
        t_eval.append(t2 - t1)
        t_dec.append(t3 - t2)
        in_size.append(len(ex))
        out_size.append(len(eo))
    enc_logits = np.array(enc_logits)
    t_plain = time.perf_counter()
    for _ in range(200):
        model.logits(X[:n])
    plain_us = (time.perf_counter() - t_plain) / 200 / n * 1e6
    return {
        "params": p.label(),
        "model": model.kind,
        "depth": model.depth,
        "n": n,
        "acc_plain": accuracy(plain[:n], y[:n]),
        "acc_encrypted": accuracy(enc_logits, y[:n]),
        "label_agreement": float(((enc_logits > 0) == (plain[:n] > 0)).mean()),
        "max_abs_logit_error": float(np.max(np.abs(enc_logits - plain[:n]))),
        "ms_encrypt": 1e3 * float(np.median(t_enc)),
        "ms_worker_eval": 1e3 * float(np.median(t_eval)),
        "ms_decrypt": 1e3 * float(np.median(t_dec)),
        "us_plaintext": plain_us,
        "slowdown": float(np.median(t_eval)) * 1e6 / max(plain_us, 1e-9),
        "kb_query": float(np.median(in_size)) / 1024,
        "kb_result": float(np.median(out_size)) / 1024,
        "kb_public_context": len(pub) / 1024,
    }


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()
