"""Shared fixtures.

Tests must never touch the operator's real ledger, so every database here
is a fresh temporary file that disappears with the test.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from cashback.core import audit  # noqa: E402
from cashback.ledger import repository as ledger  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_audit_trail(tmp_path):
    """Never write into the operator real trail while testing.

    A trail whose integrity depends on nobody running pytest is not a
    trail. This ran once without the guard and put 42 fake events into
    the live audit log.
    """
    original = audit.directory()
    audit.set_directory(tmp_path / "audit")
    yield
    audit.set_directory(original)


@pytest.fixture
def db(tmp_path: Path) -> Path:
    """An initialised, empty ledger."""
    path = tmp_path / "test.db"
    ledger.initialise(path)
    return path


@pytest.fixture
def conn(db: Path):
    with ledger.connect(db) as connection:
        yield connection


@pytest.fixture
def customer(conn: sqlite3.Connection) -> str:
    ledger.add_customer(conn, "C0001", display_name="Test Person",
                        zalo_user_id="u1", private_chat_id="u1")
    return "C0001"
