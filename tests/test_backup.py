import sqlite3
import time

import pytest

from cashback.ledger import backup


def _make_db(path):
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE t (v INTEGER)")
    conn.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(100)])
    conn.commit()
    conn.close()


def test_snapshot_is_a_complete_copy(tmp_path):
    db = tmp_path / "live.db"
    _make_db(db)
    snap = backup.create(db, tmp_path / "backups", keep=5)
    rows = sqlite3.connect(snap).execute("SELECT COUNT(*) FROM t").fetchone()
    assert rows == (100,)
    assert not list((tmp_path / "backups").glob("*.partial"))


def test_snapshot_while_another_connection_holds_a_write(tmp_path):
    db = tmp_path / "live.db"
    _make_db(db)
    writer = sqlite3.connect(db)
    writer.execute("INSERT INTO t VALUES (999)")  # uncommitted
    snap = backup.create(db, tmp_path / "backups", keep=5)
    writer.rollback()
    writer.close()
    rows = sqlite3.connect(snap).execute("SELECT COUNT(*) FROM t").fetchone()
    assert rows == (100,)


def test_rotation_keeps_only_the_newest(tmp_path):
    dest = tmp_path / "backups"
    dest.mkdir()
    for stamp in ("20260101-000000", "20260102-000000", "20260103-000000"):
        (dest / f"cashback-{stamp}.db").write_bytes(b"x")
    removed = backup.prune(dest, keep=2)
    assert [p.name for p in removed] == ["cashback-20260101-000000.db"]
    assert backup.latest(dest).name == "cashback-20260103-000000.db"


def test_missing_database_is_an_error_not_an_empty_backup(tmp_path):
    with pytest.raises(FileNotFoundError):
        backup.create(tmp_path / "nope.db", tmp_path / "backups", keep=5)
    assert not (tmp_path / "backups").exists()
