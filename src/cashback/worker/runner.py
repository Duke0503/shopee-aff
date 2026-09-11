"""The loop that turns queued link requests into affiliate links.

Holds the bridge open, waits for the batch window, drives the browser, and
writes results back to the ledger. Everything it does is idempotent: a crash
mid-pass leaves the affected requests un-answered, and the next pass picks
them up once their lease expires.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ..ledger import repository as ledger
from ..worker import batch_queue as queue_batch
from ..shopee import link_generator as shopee_script
from ..shopee.browser_bridge import Bridge
from ..worker.batch_queue import BatchSettings

from ..core.logging_setup import get_logger

log = get_logger(__name__)


@dataclass
class Totals:
    passes: int = 0
    generated: int = 0
    failed: int = 0

    def line(self) -> str:
        return (
            f"{self.passes} pass(es), {self.generated} link(s) generated, "
            f"{self.failed} failed"
        )


def _stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def wait_for_extension(bridge: Bridge, seconds: int) -> bool:
    for _ in range(seconds):
        if bridge.connected():
            return True
        time.sleep(1)
    return False


def run_one_pass(
    db_path: Path, bridge: Bridge, settings: BatchSettings, totals: Totals
) -> int:
    """Process one batch if the window says it is time. Returns jobs handled."""
    jobs = queue_batch.collect(db_path, settings)
    if not jobs:
        return 0

    totals.passes += 1
    customers = len({job["sub_ids"][0] for job in jobs})
    log.info(f"pass {totals.passes}: {len(jobs)} request(s) "
        f"from {customers} customer(s)"
    )

    try:
        results = shopee_script.generate(bridge, jobs)
    except RuntimeError as exc:
        # Release the leases so the next pass retries rather than stranding
        # the batch until the lease times out.
        for job in jobs:
            queue_batch.release(job["request_id"])
        log.info(f"pass failed, will retry: {exc}")
        return len(jobs)

    outcome = queue_batch.apply_results(db_path, results)
    totals.generated += outcome["stored"]
    totals.failed += outcome["failed"]

    log.info(f"stored {outcome['stored']}, "
        f"skipped {outcome['skipped']}, failed {outcome['failed']}"
    )
    for item in results:
        if item.get("error"):
            log.info(f"{item['request_id']}: {item['error']}")
    return len(jobs)


def loop(
    db_path: Path,
    bridge: Bridge,
    settings: BatchSettings,
    attribution_days: int,
    poll_seconds: int = 5,
    expire_every_seconds: int = 3600,
) -> Totals:
    totals = Totals()
    last_expiry = 0.0

    print(
        f"Worker running. Batch window {settings.window_seconds}s, "
        f"max {settings.max_size} per pass. Ctrl+C to stop."
    )

    try:
        while True:
            if not bridge.connected():
                log.info(f"extension not responding, waiting...")
                if not wait_for_extension(bridge, 30):
                    continue

            run_one_pass(db_path, bridge, settings, totals)

            now = time.monotonic()
            if now - last_expiry > expire_every_seconds:
                last_expiry = now
                with ledger.connect(db_path) as conn:
                    expired = ledger.expire_stale_requests(conn, attribution_days)
                if expired:
                    log.info(f"expired {expired} request(s) past "
                        f"{attribution_days} days"
                    )

            time.sleep(poll_seconds)
    except KeyboardInterrupt:
        print(f"\nStopped. {totals.line()}")
    return totals
