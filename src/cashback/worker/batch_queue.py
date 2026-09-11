"""Micro-batching for link generation.

Requests are held until either the oldest has waited out the window or the
queue fills. A burst therefore collapses into one browser pass, and a lone
request still goes out within the window.

Kept separate from bridge.py so the batching rule can be tested without
standing up an HTTP server.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ..ledger import repository as ledger

DEFAULT_LEASE_SECONDS = 120

# Requests handed out but not yet answered. Cleared on result or when the
# lease expires, so a crashed extension does not strand the queue.
_in_flight: dict[str, datetime] = {}
_lock = threading.Lock()


@dataclass(frozen=True)
class BatchSettings:
    window_seconds: int = 150      # about two and a half minutes
    max_size: int = 20
    lease_seconds: int = DEFAULT_LEASE_SECONDS


def _age_seconds(iso_timestamp: str) -> float:
    try:
        created = datetime.fromisoformat(iso_timestamp)
    except ValueError:
        return 0.0
    now = datetime.now(created.tzinfo) if created.tzinfo else datetime.now()
    return (now - created).total_seconds()


def _reap_expired_leases(settings: BatchSettings) -> None:
    now = datetime.now()
    with _lock:
        stale = [
            key
            for key, leased_at in _in_flight.items()
            if (now - leased_at).total_seconds() > settings.lease_seconds
        ]
        for key in stale:
            del _in_flight[key]


def release(request_id: str) -> None:
    with _lock:
        _in_flight.pop(request_id, None)


def collect(db_path: Path, settings: BatchSettings) -> list[dict]:
    """Return work only once the window has elapsed or the queue is full.

    An empty list means "not yet", not "nothing to do".
    """
    _reap_expired_leases(settings)

    with ledger.connect(db_path) as conn:
        rows = ledger.pending_link_jobs(conn, limit=settings.max_size * 2)

    with _lock:
        waiting = [row for row in rows if row["request_id"] not in _in_flight]

    if not waiting:
        return []

    oldest_age = max(_age_seconds(row["created_at"]) for row in waiting)
    if not (len(waiting) >= settings.max_size or oldest_age >= settings.window_seconds):
        return []

    selected = waiting[: settings.max_size]
    leased_at = datetime.now()
    with _lock:
        for row in selected:
            _in_flight[row["request_id"]] = leased_at

    return [
        {
            "request_id": row["request_id"],
            "source_url": row["source_url"],
            # sub_id1 identifies the customer, sub_id2 the request. Without
            # sub_id1 an order can never be attributed to anyone, and that
            # is unrecoverable once the link is out.
            "sub_ids": [row["customer_id"], row["request_id"]],
        }
        for row in selected
    ]


def apply_results(db_path: Path, results: list[dict]) -> dict:
    stored, skipped, failed = 0, 0, 0

    with ledger.connect(db_path) as conn:
        for item in results:
            request_id = (item.get("request_id") or "").strip()
            if not request_id:
                failed += 1
                continue

            release(request_id)

            affiliate_url = (item.get("affiliate_url") or "").strip()
            if item.get("error") or not affiliate_url:
                failed += 1
                _count_failure(conn, request_id)
                continue

            commission = item.get("estimated_commission")
            if ledger.attach_affiliate_url(
                conn,
                request_id,
                affiliate_url,
                int(commission) if commission is not None else None,
            ):
                stored += 1
            else:
                skipped += 1

    return {"stored": stored, "skipped": skipped, "failed": failed}


def _count_failure(conn, request_id: str) -> None:
    """Record one failed attempt, and stop retrying past the limit.

    Releasing the lease alone sends the request round again on the next
    pass, forever: a product the dashboard will never convert was retried
    every few minutes and the customer heard nothing at all. Past the limit
    the request is marked failed, which is what makes the apology sendable.
    """
    row = conn.execute(
        "SELECT attempts FROM link_requests WHERE request_id=?", (request_id,)
    ).fetchone()
    if row is None:
        return
    attempts = (row["attempts"] or 0) + 1
    if attempts >= ledger.MAX_LINK_ATTEMPTS:
        conn.execute(
            "UPDATE link_requests SET attempts=?, status='failed'"
            " WHERE request_id=?",
            (attempts, request_id),
        )
    else:
        conn.execute(
            "UPDATE link_requests SET attempts=? WHERE request_id=?",
            (attempts, request_id),
        )
