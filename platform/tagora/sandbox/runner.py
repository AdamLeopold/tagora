"""Host side of the sandbox: one fresh child process and scratch directory per call."""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

CHILD = Path(__file__).with_name("child.py")


@dataclass
class RunResult:
    ok: bool
    output: object = None
    error: str | None = None
    wall_s: float = 0.0
    cpu_s: float = 0.0
    max_rss_mb: float | None = None
    events: list[dict] = field(default_factory=list)
    timed_out: bool = False
    exit_code: int | None = None
    stderr_tail: str = ""

    @property
    def egress(self) -> list[str]:
        return [e["detail"] for e in self.events if e["kind"] == "egress"]

    def to_dict(self) -> dict:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


def _limits(cpu_seconds: int | None):
    def apply() -> None:
        import resource

        if cpu_seconds:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 1))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    return apply


def run_tool(
    tool_dir: str | Path,
    entrypoint: str,
    payload: dict,
    *,
    files: dict[str, str | Path] | None = None,
    timeout_s: float = 60.0,
    cpu_seconds: int | None = None,
    python: str | None = None,
) -> RunResult:
    """Run ``entrypoint(payload)`` from ``tool_dir`` in an isolated child process.

    ``files`` maps names to host paths; each file is copied into the run's
    scratch directory and the payload key of the same name is rewritten to the
    copy, so the tool can only see the inputs it was given.
    """
    scratch = Path(tempfile.mkdtemp(prefix="tagora-run-"))
    try:
        payload = dict(payload)
        for key, src in (files or {}).items():
            dst = scratch / f"in-{key}{Path(src).suffix}"
            shutil.copyfile(src, dst)
            payload[key] = str(dst)
        output_path = scratch / ".result.json"
        exe = python or sys.executable
        venv_root = Path(exe).absolute().parent.parent  # the venv itself, not the interpreter it links to
        spec = {
            "scratch": str(scratch),
            "tool_dir": str(Path(tool_dir).resolve()),
            "entrypoint": entrypoint,
            "payload": payload,
            "output_path": str(output_path),
            "real_home": str(Path.home()),
            "read_roots": [str(venv_root), str(Path(exe).parent), sys.prefix, sys.base_prefix, str(CHILD.parent)],
        }
        env = {
            "PATH": "/usr/bin:/bin",
            "HOME": str(scratch),
            "TMPDIR": str(scratch),
            "XDG_CACHE_HOME": str(scratch / ".cache"),
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONHASHSEED": "0",
            "OMP_NUM_THREADS": "1",
            "LANG": "C.UTF-8",
        }
        t0 = time.perf_counter()
        proc = subprocess.Popen(
            [exe, "-I", str(CHILD), json.dumps(spec)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            cwd=scratch,
            env=env,
            start_new_session=True,
            preexec_fn=_limits(cpu_seconds),
        )
        timed_out = False
        try:
            _, err = proc.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(proc.pid, signal.SIGKILL)
            _, err = proc.communicate()
        wall = time.perf_counter() - t0
        stderr_tail = (err or b"").decode(errors="replace")[-2000:]
        if timed_out:
            return RunResult(False, error=f"timeout after {timeout_s:.0f}s", wall_s=wall, timed_out=True, stderr_tail=stderr_tail)
        if not output_path.exists():
            reason = "killed by CPU limit" if proc.returncode in (-signal.SIGXCPU, -signal.SIGKILL) else "no result written"
            return RunResult(False, error=f"child exited {proc.returncode}: {reason}", wall_s=wall, exit_code=proc.returncode, stderr_tail=stderr_tail)
        data = json.loads(output_path.read_text(encoding="utf-8"))
        return RunResult(
            ok=bool(data.get("ok")),
            output=data.get("output"),
            error=data.get("error"),
            wall_s=float(data.get("wall_s", wall)),
            cpu_s=float(data.get("cpu_s", 0.0)),
            max_rss_mb=data.get("max_rss_mb"),
            events=data.get("events", []),
            exit_code=proc.returncode,
            stderr_tail=stderr_tail,
        )
    finally:
        # destroying the scratch dir is the "enclave is gone" step
        shutil.rmtree(scratch, ignore_errors=True)
