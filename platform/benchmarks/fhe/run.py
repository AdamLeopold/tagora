"""Ciphertext-tier experiment: train, then grid-search CKKS parameters.

    python benchmarks/fhe/run.py
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

import numpy as np  # noqa: E402

from tagora.fhe import CkksParams, accuracy, evaluate, load_data, train_logreg, train_square_mlp  # noqa: E402


def main():
    Xtr, Xte, ytr, yte = load_data()
    out = {"dataset": "sklearn breast_cancer (569 samples, 30 features), 70/30 stratified split", "training": [], "ckks": []}

    # --- training sweep (plaintext): pick the model before paying for encryption
    best_lr = max(([C, train_logreg(Xtr, ytr, C)] for C in (0.01, 0.1, 1.0, 10.0)), key=lambda p: accuracy(p[1].logits(Xte), yte))
    out["training"].append({"model": "logreg", "C": best_lr[0], "acc_test": accuracy(best_lr[1].logits(Xte), yte)})
    mlps = []
    for hidden in (4, 8, 16):
        for scale in (0.1, 0.3):
            m = train_square_mlp(Xtr, ytr, hidden=hidden, scale=scale)
            acc = accuracy(m.logits(Xte), yte)
            mlps.append((acc, hidden, scale, m))
            out["training"].append({"model": "mlp-square", "hidden": hidden, "scale": scale, "acc_test": acc,
                                    "max_abs_logit": float(np.abs(m.logits(Xte)).max())})
    mlps.sort(key=lambda t: (-t[0], t[1]))
    best_mlp = mlps[0][3]
    print("training:", json.dumps(out["training"], indent=0))

    # --- CKKS grid: smallest parameters that keep encrypted labels identical
    grid = {
        "logreg": [
            CkksParams(4096, [40, 20, 40], 20),
            CkksParams(8192, [60, 40, 60], 40),
        ],
        "mlp-square": [
            CkksParams(8192, [40, 21, 21, 21, 40], 21),
            CkksParams(8192, [60, 30, 30, 30, 60], 30),
            CkksParams(16384, [60, 40, 40, 40, 60], 40),
        ],
    }
    for model in (best_lr[1], best_mlp):
        for p in grid[model.kind]:
            try:
                r = evaluate(model, Xte, yte, p)
            except Exception as e:  # noqa: BLE001 - e.g. scale out of bounds for too-short chains
                r = {"params": p.label(), "model": model.kind, "error": str(e)[:160]}
            out["ckks"].append(r)
            print(json.dumps(r, ensure_ascii=False))
    (HERE / "results.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
