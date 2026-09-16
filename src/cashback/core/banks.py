"""Turning what a customer typed into a bank the QR standard recognises.

Customers write their bank however they like -- "VCB", "vietcombank",
"NH TMCP Ngoai Thuong", "Techcom", "tcb". A transfer QR needs the exact
six-digit BIN that NAPAS assigns, and getting it wrong is not a cosmetic
error: the same account number can exist at another bank, so a wrong BIN
sends the money to a stranger who has no idea it arrived.

So nothing here guesses. The list comes from NAPAS by way of

    https://api.vietqr.io/v2/banks

cached to disk, and a name that does not match confidently returns None.
The caller then shows the operator the raw text and lets them transfer by
hand, which is slower and correct, rather than fast and wrong.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import httpx

from .config import PROJECT_ROOT

BANKS_URL = "https://api.vietqr.io/v2/banks"
CACHE = PROJECT_ROOT / "resources" / "banks.json"
TIMEOUT = 20.0


def _plain(text: str) -> str:
    """Lowercase, strip diacritics, keep only letters and digits."""
    stripped = unicodedata.normalize("NFD", (text or "").lower())
    letters = "".join(c for c in stripped if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", letters)


def refresh(path: Path | None = None) -> int:
    """Fetch the official list and cache it. Returns how many banks."""
    target = path or CACHE
    response = httpx.get(BANKS_URL, timeout=TIMEOUT)
    response.raise_for_status()
    banks = (response.json() or {}).get("data") or []
    if not banks:
        raise RuntimeError("the bank list came back empty; refusing to cache it")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(banks, ensure_ascii=False, indent=2),
                      encoding="utf-8")
    return len(banks)


def load(path: Path | None = None) -> list[dict]:
    target = path or CACHE
    if not target.exists():
        return []
    try:
        return json.loads(target.read_text(encoding="utf-8"))
    except ValueError:
        return []


def _aliases(bank: dict) -> set[str]:
    """Every spelling of one bank that can be matched without ambiguity."""
    names = {bank.get("code"), bank.get("shortName"), bank.get("bin")}
    full = bank.get("name") or ""
    # "Ngan hang TMCP Ngoai Thuong Viet Nam" -> also match the distinctive
    # part, without the boilerplate every Vietnamese bank name carries.
    trimmed = re.sub(
        r"ng[aâ]n h[aà]ng|thương m[aạ]i|c[oổ] ph[aầ]n|tmcp|vi[eệ]t nam|tnhh|mtv",
        " ", full, flags=re.IGNORECASE)
    names.add(trimmed)
    return {_plain(n) for n in names if n and _plain(n)}


def find(written: str, banks: list[dict] | None = None) -> dict | None:
    """The bank a customer meant, or None when it is not certain.

    Matching is exact on any known spelling, then a containment check that
    must land on exactly ONE bank. Two candidates means ambiguous, and
    ambiguous means None -- an operator reading "which bank?" is a much
    better outcome than money leaving for the wrong one.
    """
    catalogue = banks if banks is not None else load()
    if not catalogue:
        return None

    needle = _plain(written)
    if not needle:
        return None

    for bank in catalogue:
        if needle in _aliases(bank):
            return bank

    # Someone typed "vietcom" or "ngan hang vietcombank".
    hits = [
        bank for bank in catalogue
        if any(len(a) >= 3 and (a in needle or needle in a) for a in _aliases(bank))
    ]
    return hits[0] if len(hits) == 1 else None


def transfer_supported(bank: dict) -> bool:
    return bool(bank.get("transferSupported"))
