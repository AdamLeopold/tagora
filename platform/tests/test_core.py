import textwrap

import pytest

from tagora.ledger import Ledger
from tagora.manifest import code_hash, load_manifest
from tagora.registry import Listing, Registry
from tagora.verify.static import analyse


def write_tool(d, body="def run(p):\n    return {}\n", license="MIT", extra=""):
    d.mkdir(parents=True, exist_ok=True)
    (d / "tool.py").write_text(body)
    (d / "tagora.toml").write_text(textwrap.dedent(f"""
        name = "t"
        version = "1.0.0"
        category = "pdf"
        entrypoint = "tool:run"
        license = "{license}"
        price_usd = 0.002
        {extra}
        [claim]
        text = "best ever"
        accuracy = 0.99
        [deps]
        packages = ["rapidfuzz>=3"]
    """))
    return d


def test_manifest_and_hash_change_with_code(tmp_path):
    d = write_tool(tmp_path / "a")
    m = load_manifest(d)
    assert m.id == "t@1.0.0" and m.claim_accuracy == 0.99
    h1 = code_hash(m)
    (d / "tool.py").write_text("def run(p):\n    return {'x': 1}\n")
    h2 = code_hash(m)
    assert h1 != h2 and len(h1) == 64


def test_manifest_requires_fields(tmp_path):
    d = tmp_path / "bad"
    d.mkdir()
    (d / "tagora.toml").write_text('name = "x"\n')
    with pytest.raises(ValueError):
        load_manifest(d)


def test_static_flags_risky_code_and_licences(tmp_path):
    body = "import socket, subprocess\nimport pickle\ndef run(p):\n    eval('1')\n    pickle.loads(b'')\n    while True:\n        pass\n"
    m = load_manifest(write_tool(tmp_path / "b", body=body, license="AGPL-3.0"))
    rules = {f.rule for f in analyse(m)}
    assert {"network-import", "process-import", "dynamic-exec", "unsafe-deserialise", "infinite-loop", "license"} <= rules
    m2 = load_manifest(write_tool(tmp_path / "c", license="SSPL-1.0"))
    assert any(f.severity == "block" for f in analyse(m2))
    m3 = load_manifest(write_tool(tmp_path / "d"))
    assert analyse(m3) == []


def test_ledger_chain_and_tamper_detection(tmp_path):
    led = Ledger(tmp_path / "l.db")
    led.append("call", {"tool": "x", "price": 0.01})
    led.append("call", {"tool": "y", "price": 0.02})
    assert led.verify() == (True, None, "ok")
    assert led.height() == 3
    led._db.execute("UPDATE blocks SET payload = ? WHERE idx = 1", ('{"tool":"x","price":99}',))
    ok, bad, _ = led.verify()
    assert not ok and bad == 1


def test_registry_roundtrip(tmp_path):
    reg = Registry(tmp_path / "r.db")
    L = Listing("t@1", "t", "1", "pdf", "me", "MIT", "", "/x", "tool:run", "abc", "cpu-m3max", "open", 0.001, "c", {"overall": 0.5})
    reg.put(L)
    assert reg.get(L.key).card["overall"] == 0.5
    reg.update_card(L.key, {"overall": 0.9})
    assert reg.list("pdf")[0].card["overall"] == 0.9
