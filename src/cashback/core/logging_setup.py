"""Application logging: where it goes, how long it is kept.

Two streams, deliberately separate:

    logs/app.log      what the program did, for reading when something
                      broke. Rotated by size and gzipped, so a long-running
                      bot cannot fill the disk.

    logs/audit.jsonl  what CUSTOMERS did, one JSON object per line, kept
                      for tracing and disputes -- see `audit`.

They are split because they are read by different people at different
times. A crash is read once, today, by whoever is fixing it. An audit line
is read weeks later, by someone asking "did this person really send that
link before the order", and it has to survive log rotation noise and stay
machine-readable.

Console output is kept as-is: the operator watches it live.
"""

from __future__ import annotations

import gzip
import logging
import logging.handlers
import shutil
import sys
from pathlib import Path

from .config import PROJECT_ROOT

LOG_DIR = PROJECT_ROOT / "logs"

APP_LOG = "app.log"
MAX_BYTES = 10 * 1024 * 1024      # 10 MB per file
BACKUP_COUNT = 10                  # ~100 MB raw, far less once gzipped

FORMAT = "%(asctime)s %(levelname)-7s %(name)-24s %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class GzipRotatingFileHandler(logging.handlers.RotatingFileHandler):
    """Rotate as usual, then compress the file that was just closed.

    Plain rotation keeps ten full-size files. Bot logs are repetitive text
    and compress to roughly a twentieth, which is the difference between
    ~100 MB and ~5 MB sitting on the disk forever.
    """

    def doRollover(self) -> None:
        super().doRollover()
        rotated = Path(f"{self.baseFilename}.1")
        if not rotated.exists():
            return
        try:
            with rotated.open("rb") as raw, gzip.open(f"{rotated}.gz", "wb") as packed:
                shutil.copyfileobj(raw, packed)
            rotated.unlink()
        except OSError:
            # A failed compression must never take the process down; the
            # uncompressed file is still there and still readable.
            pass


class TelegramLoggingHandler(logging.Handler):
    """Automatically forwards WARNING, ERROR, and CRITICAL logs to Telegram Dev group."""

    def emit(self, record: logging.LogRecord) -> None:
        # Avoid recursion loops from telegram / urllib / http requests
        name = (record.name or "").lower()
        if any(ign in name for ign in ("urllib", "httpcore", "httpx", "telegram")):
            return

        try:
            from . import telegram_alerts

            if record.levelno >= logging.CRITICAL:
                sev = "CRITICAL"
            elif record.levelno >= logging.ERROR:
                sev = "HIGH"
            elif record.levelno >= logging.WARNING:
                # Filter noise: only alert on warnings from cashback application modules
                if not (record.name or "").startswith("cashback"):
                    return
                sev = "WARNING"
            else:
                return

            msg = record.getMessage()
            trace = ""
            if record.exc_info:
                trace = self.formatException(record.exc_info)
                if len(trace) > 1200:
                    trace = trace[:1200] + "\n... [đã cắt bớt]"

            fp = f"{sev}:{record.name}:{record.filename}:{record.lineno}:{msg[:40]}"
            source = f"{record.name} ({record.filename}:{record.lineno})"

            telegram_alerts.report_bug(
                title=f"{sev}: {msg[:70]}",
                details=msg,
                severity=sev,
                source=source,
                error_trace=trace,
                fingerprint=fp,
            )
        except Exception:
            self.handleError(record)


def configure(level: int = logging.INFO, console: bool = True) -> None:
    """Set up logging once, at startup. Safe to call twice."""
    root = logging.getLogger()
    if any(getattr(h, "_cashback", False) for h in root.handlers):
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    root.setLevel(level)
    formatter = logging.Formatter(FORMAT, DATE_FORMAT)

    file_handler = GzipRotatingFileHandler(
        LOG_DIR / APP_LOG,
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler._cashback = True
    root.addHandler(file_handler)

    if console:
        stream = logging.StreamHandler(sys.stdout)
        stream.setFormatter(formatter)
        stream._cashback = True
        root.addHandler(stream)

    # Attach Telegram alerting handler for WARNING, ERROR and CRITICAL
    tele_handler = TelegramLoggingHandler(level=logging.WARNING)
    tele_handler._cashback = True
    root.addHandler(tele_handler)

    # httpx narrates every request at INFO, which buries everything else.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Logger for one module. Use __name__ at the call site."""
    return logging.getLogger(name)
