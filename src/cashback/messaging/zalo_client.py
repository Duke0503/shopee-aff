"""Zalo Bot API client.

Official, free, works in group chats. Shaped like the Telegram Bot API:

    POST https://bot-api.zaloplatforms.com/bot<TOKEN>/<method>
    -> {"ok": true, "result": {...}}

Get a token by opening Zalo, finding the "Zalo Bot Manager" official
account, and choosing "Create bot". The name must start with "Bot".

Two behaviours of the platform shape everything downstream:

  - There is no API listing who can be messaged. The bot may only send to a
    chat it has already heard from. A customer must therefore message the
    bot once before any payout notice can reach them, two months later.

  - Text is capped at 2000 characters, so long templates must be split.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterator

import httpx

TEXT_LIMIT = 2000
DEFAULT_TIMEOUT = 30.0

# getUpdates holds the connection open for this many seconds waiting for a
# message. The HTTP read timeout must be longer, or the client aborts a
# perfectly healthy poll.
LONG_POLL_SECONDS = 25

# A long poll that sees no messages returns ok:false with this code and the
# description "Request timeout". It means "nothing arrived", not "failed".
EMPTY_POLL_CODE = 408


class ZaloError(RuntimeError):
    pass


@dataclass
class Chat:
    id: str
    type: str = ""
    raw: dict = field(default_factory=dict)

    @property
    def is_group(self) -> bool:
        """Group detection is by substring because the platform's exact
        wording is not documented. Run `cashback zalo-check` against a real
        group to see what it actually sends."""
        return "group" in (self.type or "").lower()


@dataclass
class Message:
    message_id: str
    chat: Chat
    text: str = ""
    from_user: dict = field(default_factory=dict)
    date: Any = None
    raw: dict = field(default_factory=dict)

    @property
    def sender_id(self) -> str:
        user = self.from_user or {}
        for key in ("id", "userId", "user_id"):
            if user.get(key):
                return str(user[key])
        return ""

    @property
    def sender_name(self) -> str:
        user = self.from_user or {}
        for key in ("displayName", "display_name", "name", "username"):
            if user.get(key):
                return str(user[key])
        return ""


@dataclass
class Update:
    update_id: str
    message: Message | None
    event_name: str = ""
    raw: dict = field(default_factory=dict)


def _first(source: dict, *keys: str, default: Any = None) -> Any:
    """Field names vary between the docs and the SDKs, so accept either."""
    for key in keys:
        if key in source and source[key] not in (None, ""):
            return source[key]
    return default


def parse_message(payload: dict) -> Message | None:
    if not payload:
        return None
    chat_raw = payload.get("chat") or {}
    return Message(
        message_id=str(_first(payload, "messageId", "message_id", default="")),
        chat=Chat(
            id=str(_first(chat_raw, "id", "chatId", "chat_id", default="")),
            type=str(_first(chat_raw, "chat_type", "type", "chatType", default="")),
            raw=chat_raw,
        ),
        text=str(_first(payload, "text", "caption", default="") or ""),
        from_user=_first(payload, "fromUser", "from_user", "from", default={}) or {},
        date=payload.get("date"),
        raw=payload,
    )


def parse_update(payload: dict) -> Update:
    """Wrap one delivery.

    Observed shape, 2026-09-10:
        {"message": {...}, "event_name": "message.text.received"}

    There is no update id, so the message id doubles as the de-duplication
    key.
    """
    message = parse_message(_first(payload, "message", default={}) or {})
    return Update(
        update_id=str(
            _first(payload, "updateId", "update_id", default="")
            or (message.message_id if message else "")
        ),
        message=message,
        event_name=str(_first(payload, "event_name", "eventName", default="")),
        raw=payload,
    )


def split_text(text: str, limit: int = TEXT_LIMIT) -> list[str]:
    """Split on blank lines first, then lines, so a message never breaks
    mid-sentence in front of a customer."""
    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current = ""
    for block in text.split("\n\n"):
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        while len(block) > limit:
            cut = block.rfind("\n", 0, limit)
            if cut <= 0:
                cut = limit
            chunks.append(block[:cut])
            block = block[cut:].lstrip("\n")
        current = block
    if current:
        chunks.append(current)
    return chunks


class ZaloBot:
    def __init__(
        self,
        token: str,
        api_url: str = "https://bot-api.zaloplatforms.com",
        timeout: float = DEFAULT_TIMEOUT,
    ):
        if not token:
            raise ZaloError("no bot token; set ZALO_BOT_TOKEN in .env")
        self._base = f"{api_url.rstrip('/')}/bot{token}"
        self._client = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "ZaloBot":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def call(
        self, method: str, payload: dict | None = None,
        read_timeout: float | None = None,
        tolerate_codes: set[int] | None = None,
    ) -> Any:
        """POST a method and return its result.

        `tolerate_codes` lists error codes that are not really errors for
        this call. The platform uses 408 on getUpdates to mean "the window
        elapsed with nothing to report", which is the normal outcome of a
        quiet minute and must not be raised.
        """
        try:
            response = self._client.post(
                f"{self._base}/{method}",
                json=payload or {},
                timeout=read_timeout if read_timeout is not None else None,
            )
        except httpx.HTTPError as exc:
            raise ZaloError(f"{method}: {exc}") from exc

        try:
            body = response.json()
        except json.JSONDecodeError:
            raise ZaloError(
                f"{method}: HTTP {response.status_code}, "
                f"non-JSON reply: {response.text[:200]}"
            ) from None

        if not body.get("ok"):
            code = body.get("error_code")
            if tolerate_codes and code in tolerate_codes:
                return None
            detail = body.get("description") or body.get("error") or body
            raise ZaloError(f"{method}: {detail} (code {code})")
        return body.get("result")

    # -- identity ------------------------------------------------------

    def get_me(self) -> dict:
        return self.call("getMe") or {}

    # -- receiving -----------------------------------------------------

    def get_updates(self, timeout: int = LONG_POLL_SECONDS) -> list[Update]:
        """Long-poll for new messages.

        The endpoint takes only `timeout`, as a string of seconds. There is
        no offset or limit, so the caller must not rely on acknowledging an
        update by id -- see `poll`, which de-duplicates locally instead.

        The HTTP read timeout has to outlast the long poll, otherwise the
        client hangs up on a healthy request and it looks like a failure.
        """
        result = self.call(
            "getUpdates",
            {"timeout": str(timeout)},
            read_timeout=timeout + 15,
            # A quiet window comes back as ok:false with 408. That is the
            # normal outcome of nobody having written, not a failure.
            tolerate_codes={EMPTY_POLL_CODE},
        )
        if result is None:
            return []
        # One delivery arrives as a single object carrying "message", not as
        # a list. Older shapes wrapped a list; both are accepted.
        if isinstance(result, dict):
            if "message" in result or "event_name" in result:
                result = [result]
            else:
                result = _first(result, "updates", "messages", default=[]) or []
        return [parse_update(item) for item in (result or [])]

    def poll(
        self, timeout: int = LONG_POLL_SECONDS, seen_limit: int = 2000
    ) -> Iterator[Update]:
        """Yield updates forever, skipping any already delivered.

        The API offers no way to acknowledge an update, so a redelivery
        cannot be ruled out. Replying twice to the same customer message
        looks broken, so ids are remembered here. The set is bounded: on a
        restart the memory is gone, which is why handlers must stay safe to
        run twice.
        """
        import time

        seen: dict[str, None] = {}
        while True:
            try:
                updates = self.get_updates(timeout=timeout)
            except ZaloError as exc:
                backoff = 30 if "429" in str(exc) else 5
                print(f"[zalo] poll failed, retrying in {backoff}s: {exc}")
                time.sleep(backoff)
                continue

            if not updates:
                time.sleep(3)

            for update in updates:
                key = update.update_id or (
                    update.message.message_id if update.message else ""
                )
                if key:
                    if key in seen:
                        continue
                    seen[key] = None
                    if len(seen) > seen_limit:
                        for old in list(seen)[: seen_limit // 2]:
                            del seen[old]
                yield update

    # -- sending -------------------------------------------------------

    def send(self, chat_id: str, text: str) -> list[dict]:
        """Send text, splitting it if it exceeds the platform limit."""
        sent = []
        for chunk in split_text(text):
            sent.append(
                self.call("sendMessage", {"chat_id": chat_id, "text": chunk}) or {}
            )
        return sent

    def typing(self, chat_id: str) -> None:
        try:
            self.call("sendChatAction", {"chat_id": chat_id, "action": "typing"})
        except ZaloError:
            pass  # cosmetic only, never worth failing a reply over
