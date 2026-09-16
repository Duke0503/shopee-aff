"""An append-only record of what customers did.

Every line is one JSON object, one event, written the moment it happens:

    {"at": "2026-09-11T14:02:11+07:00", "event": "link.requested",
     "customer_id": "C0007", "zalo_user_id": "84...", "request_id": "R2609...",
     "url": "https://s.shopee.vn/..."}

WHY THIS IS NOT THE APPLICATION LOG
-----------------------------------
The application log answers "why did it break". This answers "what did
this person actually do, and when" -- a question asked weeks later, by
someone settling a dispute or looking at an account that behaves oddly.
That needs a fixed shape, stable field names, and no interleaved stack
traces, so it lives in its own file and is never rotated by size alone.

WHY APPEND-ONLY, WHY BY MONTH
-----------------------------
A trail that can be rewritten proves nothing. Lines are only ever added.
Files are cut by calendar month (audit-2026-09.jsonl) rather than by size,
so "what happened in September" is one file, and closed months compress
untouched -- see `archive_closed_months`.

WHAT IS DELIBERATELY NOT RECORDED
---------------------------------
Bank account numbers and account holder names. That a customer changed
their bank details is recorded, and matters; the digits themselves belong
only in the ledger, behind the same door as the payout. A log file gets
copied, pasted into chat, and attached to emails -- account numbers must
not travel with it. `bank.changed` therefore carries a short fingerprint,
enough to tell two accounts apart and to spot the same account appearing
under several customers, and not enough to pay anyone.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import PROJECT_ROOT

# Overridable so a test suite never writes into the operator's real
# trail. An audit trail whose integrity depends on nobody running pytest
# is not an audit trail.
_DIRECTORY = PROJECT_ROOT / "logs" / "audit"


def directory() -> Path:
    return _DIRECTORY


def set_directory(path: Path) -> None:
    """Point the trail somewhere else. For tests only."""
    global _DIRECTORY
    _DIRECTORY = Path(path)


TIMEZONE = timezone(timedelta(hours=7))

# Events. Adding one is fine; renaming one breaks every past query, so
# treat these as permanent once written.
CUSTOMER_SEEN = "customer.seen"
COMMAND_USED = "command.used"
LINK_REQUESTED = "link.requested"
LINK_DELIVERED = "link.delivered"
LINK_FAILED = "link.failed"
BANK_CHANGED = "bank.changed"
BANK_ERASED = "bank.erased"
ORDER_RECORDED = "order.recorded"
ORDER_APPROVED = "order.approved"
ORDER_REJECTED = "order.rejected"
ORDER_PAID = "order.paid"
# Issuing a password ends every session the customer had open,
# so it belongs in the trail even though no money moves.
PASSWORD_ISSUED = "account.password_issued"
LOGIN_OK = "account.login"
LOGIN_REFUSED = "account.login_refused"
CUSTOMER_ERASED = "customer.erased"


def _now() -> datetime:
    return datetime.now(TIMEZONE)


def current_file(when: datetime | None = None) -> Path:
    moment = when or _now()
    return directory() / f"audit-{moment:%Y-%m}.jsonl"


def fingerprint(value: str) -> str:
    """Short, stable, one-way. Enough to compare, useless for paying."""
    if not value:
        return ""
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:12]


def record(event: str, **fields: Any) -> None:
    """Append one event. Never raises.

    Auditing is a side effect of doing business, not a precondition for
    it: a full disk must not stop a customer being paid.
    """
    try:
        directory().mkdir(parents=True, exist_ok=True)
        line = {"at": _now().isoformat(timespec="seconds"), "event": event}
        line.update({k: v for k, v in fields.items() if v is not None})
        with current_file().open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")
    except OSError:
        pass


def read(months: int = 3) -> Iterator[dict]:
    """Yield events from the most recent months, oldest first.

    Reads the gzipped archives too, so a query does not silently skip
    whatever was compressed last week.
    """
    root = directory()
    if not root.exists():
        return
    files = sorted(root.glob("audit-*.jsonl")) + \
        sorted(root.glob("audit-*.jsonl.gz"))
    for path in sorted(files, key=lambda p: p.name)[-months * 2:]:
        opener = gzip.open if path.suffix == ".gz" else open
        try:
            with opener(path, "rt", encoding="utf-8") as handle:
                for raw in handle:
                    raw = raw.strip()
                    if not raw:
                        continue
                    try:
                        yield json.loads(raw)
                    except ValueError:
                        continue  # a torn line at the end of a crash
        except OSError:
            continue


def archive_closed_months(keep_plain: int = 1) -> list[Path]:
    """Compress finished months. Returns what was compressed.

    The current month stays plain because it is still being appended to.
    Everything older is gzipped in place; JSONL is highly repetitive and
    shrinks by roughly nine tenths.
    """
    root = directory()
    if not root.exists():
        return []
    plain = sorted(root.glob("audit-*.jsonl"))
    done: list[Path] = []
    for path in plain[:-keep_plain] if keep_plain else plain:
        target = path.with_suffix(".jsonl.gz")
        try:
            with path.open("rb") as raw, gzip.open(target, "wb") as packed:
                shutil.copyfileobj(raw, packed)
            path.unlink()
            done.append(target)
        except OSError:
            continue
    return done
