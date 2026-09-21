"""Bridge between the main Python cashback backend and the Zalo Assistant worker.

Enables the Python backend to notify the Zalo Assistant bot (running on local port 8891)
to send messages or alerts to the internal dev group or individual users.
All calls are non-blocking, fail-safe, and timed out at 2.5s to ensure the main
cashback system never degrades if the assistant worker is offline.
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from ..core.logging_setup import get_logger

log = get_logger(__name__)

ASSISTANT_API_BASE = "http://127.0.0.1:8891"


def notify_assistant(message: str, target_id: str | None = None, is_user: bool = False) -> bool:
    """Send a notification through the Zalo Assistant bot."""
    if not message:
        return False

    payload = {
        "message": message,
        "type": "user" if is_user else "group",
    }
    if target_id:
        payload["targetId"] = str(target_id)

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{ASSISTANT_API_BASE}/api/notify",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=2.5) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return bool(res_data.get("ok"))
    except Exception as exc:
        log.debug("Assistant notification omitted (worker might be offline): %s", exc)
        return False


def broadcast_to_group(message: str) -> bool:
    """Broadcast a message directly to the active group configured in the assistant."""
    if not message:
        return False

    data = json.dumps({"message": message}).encode("utf-8")
    req = urllib.request.Request(
        f"{ASSISTANT_API_BASE}/api/broadcast",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=2.5) as response:
            res_data = json.loads(response.read().decode("utf-8"))
            return bool(res_data.get("ok"))
    except Exception as exc:
        log.debug("Assistant broadcast omitted: %s", exc)
        return False
