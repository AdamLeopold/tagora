"""Append-only, hash-chained ledger stored in SQLite.

Only payments and hashes go in. Inputs, outputs and keys never do.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

GENESIS_PREV = "0" * 64


def canonical(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def block_hash(index: int, ts: str, type_: str, payload: dict, prev: str) -> str:
    return hashlib.sha256(canonical([index, ts, type_, payload, prev]).encode()).hexdigest()


@dataclass
class Block:
    index: int
    ts: str
    type: str
    payload: dict
    prev_hash: str
    hash: str

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class Ledger:
    def __init__(self, path: str | Path = ":memory:"):
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS blocks (idx INTEGER PRIMARY KEY, ts TEXT, type TEXT, payload TEXT, prev_hash TEXT, hash TEXT UNIQUE)"
        )
        self._db.commit()
        if self.height() == 0:
            self.append("genesis", {"note": "Tagora ledger"})

    def height(self) -> int:
        return self._db.execute("SELECT COUNT(*) FROM blocks").fetchone()[0]

    def tip(self) -> Block | None:
        row = self._db.execute("SELECT idx, ts, type, payload, prev_hash, hash FROM blocks ORDER BY idx DESC LIMIT 1").fetchone()
        return self._row(row) if row else None

    def append(self, type_: str, payload: dict) -> Block:
        with self._lock:
            tip = self.tip()
            index = tip.index + 1 if tip else 0
            prev = tip.hash if tip else GENESIS_PREV
            ts = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
            h = block_hash(index, ts, type_, payload, prev)
            self._db.execute("INSERT INTO blocks VALUES (?,?,?,?,?,?)", (index, ts, type_, canonical(payload), prev, h))
            self._db.commit()
            return Block(index, ts, type_, payload, prev, h)

    def blocks(self, since: int = 0, limit: int = 1000) -> list[Block]:
        rows = self._db.execute(
            "SELECT idx, ts, type, payload, prev_hash, hash FROM blocks WHERE idx >= ? ORDER BY idx LIMIT ?", (since, limit)
        ).fetchall()
        return [self._row(r) for r in rows]

    def verify(self) -> tuple[bool, int | None, str]:
        prev = GENESIS_PREV
        for b in self.blocks(limit=10**9):
            if b.prev_hash != prev:
                return False, b.index, "与上一个区块的链接断开"
            if block_hash(b.index, b.ts, b.type, b.payload, b.prev_hash) != b.hash:
                return False, b.index, "区块内容与其哈希不符"
            prev = b.hash
        return True, None, "ok"

    @staticmethod
    def _row(r) -> Block:
        return Block(r[0], r[1], r[2], json.loads(r[3]), r[4], r[5])
