"""Tool manifests (``tagora.toml``) and the code hash a capability card binds to."""

from __future__ import annotations

import hashlib
import re
import tomllib
from dataclasses import dataclass, field
from importlib import metadata
from pathlib import Path

SKIP_PARTS = {"__pycache__", ".git", ".venv", "node_modules"}


@dataclass
class Manifest:
    name: str
    version: str
    category: str
    entrypoint: str
    license: str
    upstream: str = ""
    price_usd: float = 0.001
    claim_text: str = ""
    claim_accuracy: float | None = None
    packages: list[str] = field(default_factory=list)
    author: str = ""
    root: Path = Path(".")

    @property
    def id(self) -> str:
        return f"{self.name}@{self.version}"


def load_manifest(tool_dir: str | Path) -> Manifest:
    root = Path(tool_dir).resolve()
    data = tomllib.loads((root / "tagora.toml").read_text(encoding="utf-8"))
    for key in ("name", "version", "category", "entrypoint", "license"):
        if not data.get(key):
            raise ValueError(f"{root}/tagora.toml: missing '{key}'")
    if ":" not in data["entrypoint"]:
        raise ValueError("entrypoint must look like 'module:function'")
    claim = data.get("claim", {})
    return Manifest(
        name=data["name"],
        version=str(data["version"]),
        category=data["category"],
        entrypoint=data["entrypoint"],
        license=data["license"],
        upstream=data.get("upstream", ""),
        price_usd=float(data.get("price_usd", 0.001)),
        claim_text=claim.get("text", ""),
        claim_accuracy=claim.get("accuracy"),
        packages=list(data.get("deps", {}).get("packages", [])),
        author=data.get("author", ""),
        root=root,
    )


def _dist_name(requirement: str) -> str:
    return re.split(r"[<>=!~\[; ]", requirement, maxsplit=1)[0]


def resolved_deps(m: Manifest) -> dict[str, str]:
    """Installed versions of the declared dependencies; part of the hash."""
    out = {}
    for req in m.packages:
        name = _dist_name(req)
        try:
            out[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            out[name] = "missing"
    return out


def code_hash(m: Manifest) -> str:
    """sha256 over every source file plus the resolved dependency versions.

    Change one byte of the tool or upgrade one dependency and the hash -- and
    therefore the validity of its capability card -- changes.
    """
    h = hashlib.sha256()
    for path in sorted(p for p in m.root.rglob("*") if p.is_file()):
        rel = path.relative_to(m.root)
        if SKIP_PARTS.intersection(rel.parts) or path.suffix == ".pyc":
            continue
        h.update(str(rel).encode())
        h.update(b"\0")
        h.update(hashlib.sha256(path.read_bytes()).digest())
    for name, ver in sorted(resolved_deps(m).items()):
        h.update(f"dep:{name}=={ver}".encode())
    return h.hexdigest()
