"""L1 static analysis: what the tool's own source and licence say it might do.

Only the tool's files are scanned. Behaviour hidden inside dependencies is
caught at run time by the sandbox's audit hook (L2–L5), which is why the card
reports both.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

from ..manifest import Manifest

NETWORK_MODULES = {"socket", "requests", "urllib", "urllib3", "http", "httpx", "aiohttp", "websocket", "websockets", "ftplib", "smtplib"}
PROCESS_MODULES = {"subprocess", "pty", "multiprocessing"}
NATIVE_MODULES = {"ctypes", "cffi"}
DESERIALISE = {("pickle", "loads"), ("pickle", "load"), ("marshal", "loads"), ("dill", "loads")}
DYNAMIC_BUILTINS = {"eval", "exec", "compile", "__import__"}
OS_PROCESS_CALLS = {"system", "popen", "execv", "execve", "execvp", "spawnv", "fork"}

# Licences that forbid offering the software as a hosted service.
NO_HOSTING = {"SSPL-1.0", "BUSL-1.1", "Elastic-2.0", "Commons-Clause"}
# Network copyleft: hosting is fine, but users of the service must be offered the source.
NETWORK_COPYLEFT = {"AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later"}


@dataclass
class Finding:
    severity: str  # "block" | "warn" | "info"
    rule: str
    detail: str
    where: str = ""

    def to_dict(self) -> dict:
        return {"severity": self.severity, "rule": self.rule, "detail": self.detail, "where": self.where}


def _scan_file(path: Path, rel: str) -> list[Finding]:
    out: list[Finding] = []
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
    except SyntaxError as e:
        return [Finding("block", "syntax", f"无法解析：{e.msg}", f"{rel}:{e.lineno}")]
    for node in ast.walk(tree):
        where = f"{rel}:{getattr(node, 'lineno', '?')}"
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for name in names:
                top = name.split(".")[0]
                if top in NETWORK_MODULES:
                    out.append(Finding("warn", "network-import", f"导入具备联网能力的模块 {name}", where))
                elif top in PROCESS_MODULES:
                    out.append(Finding("warn", "process-import", f"导入可创建进程的模块 {name}", where))
                elif top in NATIVE_MODULES:
                    out.append(Finding("warn", "native-import", f"导入原生代码加载模块 {name}", where))
        elif isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Name) and f.id in DYNAMIC_BUILTINS:
                out.append(Finding("warn", "dynamic-exec", f"调用 {f.id}() 动态执行代码", where))
            elif isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name):
                pair = (f.value.id, f.attr)
                if pair in DESERIALISE:
                    out.append(Finding("warn", "unsafe-deserialise", f"{f.value.id}.{f.attr} 反序列化不可信数据", where))
                if f.value.id == "os" and f.attr in OS_PROCESS_CALLS:
                    out.append(Finding("warn", "process-call", f"os.{f.attr} 创建进程", where))
        elif isinstance(node, ast.While) and isinstance(node.test, ast.Constant) and node.test.value is True:
            has_exit = any(isinstance(n, (ast.Break, ast.Return, ast.Raise)) for n in ast.walk(node))
            if not has_exit:
                out.append(Finding("warn", "infinite-loop", "存在没有退出路径的 while True", where))
    return out


def analyse(m: Manifest) -> list[Finding]:
    findings: list[Finding] = []
    if m.license in NO_HOSTING:
        findings.append(Finding("block", "license", f"许可证 {m.license} 禁止作为托管服务提供"))
    elif m.license in NETWORK_COPYLEFT:
        findings.append(Finding("warn", "license", f"许可证 {m.license}：托管时须向调用方提供源码（Tagora 工具默认开源，满足要求）"))
    for path in sorted(m.root.rglob("*.py")):
        rel = str(path.relative_to(m.root))
        if "__pycache__" in rel:
            continue
        findings.extend(_scan_file(path, rel))
    return findings
