"""Tool registry: every (tool version × hardware class) and its capability card."""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Listing:
    tool_id: str  # name@version
    name: str
    version: str
    category: str
    author: str
    license: str
    upstream: str
    tool_dir: str
    entrypoint: str
    code_hash: str
    hardware: str
    tier: str  # "trusted" | "open"
    price_usd: float
    claim_text: str
    card: dict
    listed_at: str = ""

    @property
    def key(self) -> str:
        return f"{self.tool_id}:{self.hardware}"

    def to_dict(self) -> dict:
        d = asdict(self)
        d["key"] = self.key
        return d


class Registry:
    def __init__(self, path: str | Path = ":memory:"):
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        self._db.execute("CREATE TABLE IF NOT EXISTS listings (key TEXT PRIMARY KEY, category TEXT, data TEXT)")
        self._db.commit()

    def put(self, listing: Listing) -> Listing:
        if not listing.listed_at:
            listing.listed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO listings VALUES (?,?,?)",
                (listing.key, listing.category, json.dumps(asdict(listing), ensure_ascii=False)),
            )
            self._db.commit()
        return listing

    def get(self, key: str) -> Listing | None:
        row = self._db.execute("SELECT data FROM listings WHERE key = ?", (key,)).fetchone()
        return Listing(**json.loads(row[0])) if row else None

    def list(self, category: str | None = None) -> list[Listing]:
        if category:
            rows = self._db.execute("SELECT data FROM listings WHERE category = ? ORDER BY key", (category,)).fetchall()
        else:
            rows = self._db.execute("SELECT data FROM listings ORDER BY key").fetchall()
        return [Listing(**json.loads(r[0])) for r in rows]

    def update_card(self, key: str, card: dict) -> None:
        listing = self.get(key)
        if listing is None:
            raise KeyError(key)
        listing.card = card
        self.put(listing)
