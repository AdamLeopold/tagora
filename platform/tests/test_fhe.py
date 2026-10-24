import os

import numpy as np
import pytest

os.environ["TAGORA_NO_AUTOAPP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from tagora.api import create_app  # noqa: E402
from tagora.client import TagoraClient  # noqa: E402
from tagora.fhe import CkksParams, client_context, evaluate, load_data, public_bytes, train_logreg, train_square_mlp, worker_eval  # noqa: E402


@pytest.fixture(scope="module")
def data():
    return load_data()


def test_encrypted_logreg_matches_plaintext(data):
    Xtr, Xte, ytr, yte = data
    r = evaluate(train_logreg(Xtr, ytr), Xte, yte, CkksParams(8192, [60, 40, 60], 40), limit=15)
    assert r["label_agreement"] == 1.0 and r["max_abs_logit_error"] < 1e-3


def test_encrypted_square_mlp_matches_plaintext(data):
    Xtr, Xte, ytr, yte = data
    m = train_square_mlp(Xtr, ytr, hidden=8, scale=0.1, epochs=300)
    r = evaluate(m, Xte, yte, CkksParams(8192, [60, 30, 30, 30, 60], 30), limit=8)
    assert r["label_agreement"] == 1.0


def test_worker_refuses_secret_key(data):
    Xtr, Xte, ytr, _ = data
    ctx = client_context(CkksParams(8192, [60, 40, 60], 40))
    with pytest.raises(PermissionError):
        worker_eval(ctx.serialize(save_secret_key=True), b"", train_logreg(Xtr, ytr))


def test_fhe_api_end_to_end(tmp_path, data):
    _, Xte, _, yte = data
    app = create_app(tmp_path)
    c = TagoraClient(http=TestClient(app))
    c.faucet(1.0)
    models = {m["id"]: m for m in c.http.get("/v1/fhe/models").json()}
    assert models["risk-logreg"]["tier"] == "fhe"
    # the server rejects a context that carries the secret key
    ctx = client_context(CkksParams(8192, [60, 40, 60], 40))
    bad = c.http.post("/v1/fhe/contexts", content=ctx.serialize(save_secret_key=True), headers={"Content-Type": "application/octet-stream"})
    assert bad.status_code == 400
    out = c.fhe_predict(Xte[0], "risk-logreg")
    assert out["label"] in (0, 1) and out["block"] > 0
    assert app.state.ledger.tip().type == "fhe-call"
    assert "logit" not in str(app.state.ledger.tip().payload)
    assert c.balance() == pytest.approx(1.0 - models["risk-logreg"]["price_usd"])
