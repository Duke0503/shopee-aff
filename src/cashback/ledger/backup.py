"""Point-in-time copies of the ledger.

The database is the only record of who is owed what. Copying the file
while the bot is writing can capture a half-written page, so this goes
through SQLite's online backup API, which yields a consistent snapshot
even under concurrent writes.

A copy on the same disk survives a bad migration or a mistaken script,
not a dead disk. Keeping one somewhere else is still on the operator.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

PREFIX = "cashback-"
SUFFIX = ".db"


def create(db_path: Path, dest_dir: Path, keep: int) -> Path:
    """Write a snapshot into dest_dir and prune all but the newest `keep`."""
    if not Path(db_path).exists():
        raise FileNotFoundError(f"no database at {db_path}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = dest_dir / f"{PREFIX}{stamp}{SUFFIX}"
    partial = target.with_suffix(".partial")

    source = sqlite3.connect(f"file:{Path(db_path).resolve()}?mode=ro", uri=True)
    try:
        copy = sqlite3.connect(partial)
        try:
            source.backup(copy)
        finally:
            copy.close()
    finally:
        source.close()

    # Only a finished copy gets a name prune() will count, so a crash
    # mid-backup can never push a good snapshot out of the rotation.
    partial.replace(target)
    prune(dest_dir, keep)
    return target


def prune(dest_dir: Path, keep: int) -> list[Path]:
    snapshots = sorted(dest_dir.glob(f"{PREFIX}*{SUFFIX}"))
    doomed = snapshots[:-keep] if keep > 0 else []
    for path in doomed:
        path.unlink()
    return doomed


def latest(dest_dir: Path) -> Path | None:
    snapshots = sorted(dest_dir.glob(f"{PREFIX}*{SUFFIX}"))
    return snapshots[-1] if snapshots else None
