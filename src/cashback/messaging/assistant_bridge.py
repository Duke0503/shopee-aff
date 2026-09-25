"""Sending messages through the Zalo assistant (zalo_assistant/).

The assistant runs the personal Zalo account the business now talks through;
the official Bot API is gone. Everything the backend says on its own
initiative -- a link ready, an order approved, money sent -- goes out here.

send() raises on anything short of a confirmed delivery. The notification
functions only mark a message as sent after send() returns, so an assistant
that is down or restarting leaves the message queued in the ledger instead
of lost.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request


class AssistantError(RuntimeError):
    pass


class AssistantSender:
    def __init__(self, base_url: str, token: str = "", timeout: float = 15.0):
        self._base = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout

    def send(self, user_id: str, text: str) -> None:
        """Private message to one person, by their Zalo UID."""
        if not user_id or not text:
            raise AssistantError("empty recipient or message")
        self._post("/api/notify", {"targetId": str(user_id), "type": "user",
                                   "message": text})

    def broadcast(self, text: str, group: str = "test", image_path: str | None = None,
                  mention_all: bool = False) -> dict:
        """One announcement to a group: "test" rehearses it in the test
        group, "main" is the real one. The picture goes first, as a message
        of its own, because Zalo cuts a caption under an image short."""
        payload = {"message": text, "group": group, "mentionAll": mention_all}
        if image_path:
            payload |= {"imagePath": image_path, "imageFirst": True}
        return self._post("/api/broadcast", payload)

    def _post(self, path: str, payload: dict) -> dict:
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["X-Assistant-Token"] = self._token
        request = urllib.request.Request(
            f"{self._base}{path}", data=json.dumps(payload).encode("utf-8"),
            headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            raise AssistantError(f"{path}: HTTP {exc.code}") from None
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise AssistantError(f"{path}: {exc}") from None
        if not body.get("ok"):
            raise AssistantError(f"{path}: {body.get('error') or 'not sent'}")
        return body
