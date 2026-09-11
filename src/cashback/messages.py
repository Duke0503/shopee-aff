"""Customer-facing text.

The wording lives in messages.vi.json at the project root, not here. That
file is the one that gets edited when a customer misunderstands something,
and it should be editable without touching code or knowing Python.

Placeholders are named and substituted leniently: an unknown one is left
alone rather than raising, because a formatting error must never stop a
payout notice from going out.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .config import PROJECT_ROOT

MESSAGE_FILE = "messages.vi.json"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")

_cache: dict[str, str] | None = None


def load(path: Path | None = None) -> dict[str, str]:
    global _cache
    if _cache is not None and path is None:
        return _cache
    target = path or (PROJECT_ROOT / MESSAGE_FILE)
    if not target.exists():
        raise FileNotFoundError(
            f"{target} is missing; customer messages cannot be sent without it"
        )
    data = json.loads(target.read_text(encoding="utf-8"))
    text = {k: v for k, v in data.items() if not k.startswith("_")}
    if path is None:
        _cache = text
    return text


def render(key: str, **values) -> str:
    text = load().get(key)
    if text is None:
        raise KeyError(f"no message named {key!r} in {MESSAGE_FILE}")

    def swap(match: re.Match) -> str:
        name = match.group(1)
        if name in values and values[name] is not None:
            return str(values[name])
        return match.group(0)

    return _PLACEHOLDER.sub(swap, text)


def keys() -> list[str]:
    return sorted(load())


def missing_placeholders(key: str, **values) -> list[str]:
    """Which placeholders in a message were not supplied. For tests."""
    text = load().get(key, "")
    return sorted(
        {
            name
            for name in _PLACEHOLDER.findall(text)
            if name not in values or values[name] is None
        }
    )
