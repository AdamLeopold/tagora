"""Bootstrap that runs inside every sandbox child process.

It installs a CPython audit hook *before* any tool code is imported. The hook
blocks and records network access, process creation and writes outside the
run's scratch directory, and records reads of the real home directory.

Audit hooks are a detection and defence-in-depth layer, not a security
boundary (native code can bypass them). Production isolation comes from the
TEE / container the Worker runs in; the hook's job is to make a tool's
behaviour observable so the verifier can put it on the capability card.
"""

import importlib
import json
import os
import sys
import time
import traceback


def main() -> None:
    spec = json.loads(sys.argv[1])
    scratch = os.path.realpath(spec["scratch"])
    tool_dir = os.path.realpath(spec["tool_dir"])
    real_home = spec.get("real_home") or ""
    allowed_read_roots = [os.path.realpath(p) for p in spec.get("read_roots", [])] + [tool_dir, scratch]

    out = open(spec["output_path"], "w", encoding="utf-8")
    sys.stdout = sys.stderr  # tool prints must not corrupt the result channel
    sys.dont_write_bytecode = True
    sys.path.insert(0, tool_dir)

    events: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def record(kind: str, detail: str) -> None:
        key = (kind, detail)
        if key not in seen and len(events) < 200:
            seen.add(key)
            events.append({"kind": kind, "detail": detail[:200]})

    net_events = {
        "socket.connect",
        "socket.sendto",
        "socket.sendmsg",
        "socket.getaddrinfo",
        "socket.gethostbyname",
        "socket.gethostbyaddr",
        "urllib.Request",
        "http.client.connect",
    }
    proc_events = {"subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "os.fork", "os.forkpty"}
    write_flags = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC

    def is_write(mode, flags) -> bool:
        if isinstance(mode, str):
            return any(c in mode for c in "wax+")
        return isinstance(flags, int) and bool(flags & write_flags)

    def hook(event: str, args: tuple) -> None:
        if event in net_events:
            target = args[1] if event.startswith("socket.") and len(args) > 1 else (args[0] if args else "")
            record("egress", f"{event} {target!r}")
            raise PermissionError(f"tagora sandbox: network access blocked ({event})")
        if event in proc_events:
            record("process", f"{event} {args[0]!r}" if args else event)
            raise PermissionError(f"tagora sandbox: process creation blocked ({event})")
        if event == "ctypes.dlopen":
            record("native", f"ctypes.dlopen {args[0]!r}" if args else "ctypes.dlopen")
            return
        if event == "open" and args:
            path = args[0]
            if isinstance(path, int):
                return
            if isinstance(path, bytes):
                path = path.decode(errors="replace")
            mode = args[1] if len(args) > 1 else None
            flags = args[2] if len(args) > 2 else None
            try:
                full = os.path.realpath(path)
            except Exception:  # noqa: BLE001 - never let the hook itself crash
                return
            if is_write(mode, flags):
                if full == "/dev/null" or full.startswith(scratch + os.sep) or full == scratch:
                    return
                record("fs_write", full)
                raise PermissionError(f"tagora sandbox: write outside scratch blocked ({full})")
            if real_home and full.startswith(real_home + os.sep) and not any(
                full == r or full.startswith(r + os.sep) for r in allowed_read_roots
            ):
                record("fs_read_home", full)

    sys.addaudithook(hook)

    result: dict = {"ok": False}
    t0 = time.perf_counter()
    c0 = time.process_time()
    try:
        module_name, func_name = spec["entrypoint"].split(":")
        module = importlib.import_module(module_name)
        fn = getattr(module, func_name)
        output = fn(spec["payload"])
        json.dumps(output)  # must be serialisable
        result = {"ok": True, "output": output}
    except BaseException as e:  # noqa: BLE001 - report everything, including SystemExit
        result = {"ok": False, "error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc(limit=6)}
    result["wall_s"] = time.perf_counter() - t0
    result["cpu_s"] = time.process_time() - c0
    try:
        import resource

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        result["max_rss_mb"] = rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
    except Exception:  # noqa: BLE001
        result["max_rss_mb"] = None
    result["events"] = events
    out.write(json.dumps(result, ensure_ascii=False, default=str))
    out.close()


if __name__ == "__main__":
    main()
