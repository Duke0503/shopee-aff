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


# Words every Vietnamese bank's registered name carries, which therefore
# distinguish none of them. Matched against the accent-stripped form, so
# these stay plain ASCII -- no Vietnamese belongs in this file.
_BOILERPLATE = re.compile(
    r"nganhang|thuongmai|cophan|tmcp|vietnam|tnhh|mtv"
)

# Popular banking aliases commonly typed by Vietnamese users
COMMON_ALIASES: dict[str, list[str]] = {
    "970415": ["vietin", "vietinbank", "icb", "ctg"],  # VietinBank
    "970436": ["vcb", "vietcom", "vietcombank", "ngoaithuong"],  # Vietcombank
    "970418": ["bidv", "dautu"],  # BIDV
    "970405": ["agri", "agribank", "vba", "nongnghiep"],  # Agribank
    "970422": ["mb", "mbbank", "quandoi"],  # MBBank
    "970407": ["tcb", "tech", "techcom", "techcombank"],  # Techcombank
    "970416": ["acb", "achau"],  # ACB
    "970432": ["vpb", "vpbank", "thinhvuong"],  # VPBank
    "970423": ["tpb", "tpbank", "tienphong"],  # TPBank
    "970403": ["stb", "sacom", "sacombank", "saigonthuongtin"],  # Sacombank
    "970437": ["hdb", "hdbank"],  # HDBank
    "970441": ["vib", "quocte"],  # VIB
    "970443": ["shb"],  # SHB
    "970426": ["msb", "hanghai"],  # MSB
    "970448": ["ocb", "phuongdong"],  # OCB
    "970449": ["lpb", "lpbank", "lienviet", "lienvietpostbank", "locphat"],  # LPBank
    "970440": ["seabank", "sea"],  # SeABank
    "546034": ["cake"],  # CAKE
    "963388": ["timo"],  # Timo
    "971005": ["viettelmoney", "viettelpay", "vtlmoney"],  # ViettelMoney
    "971025": ["momo"],  # MoMo
}


def _aliases(bank: dict) -> set[str]:
    """Every spelling of one bank that can be matched without ambiguity."""
    names = {bank.get("code"), bank.get("shortName"), bank.get("bin")}
    aliases = {_plain(n) for n in names if n and _plain(n)}

    # "Ngan hang TMCP Ngoai Thuong Viet Nam" -> "ngoaithuong", so someone
    # writing the distinctive part of the name still lands on it.
    distinctive = _BOILERPLATE.sub("", _plain(bank.get("name") or ""))
    if len(distinctive) >= 4:
        aliases.add(distinctive)

    bin_code = str(bank.get("bin") or "")
    if bin_code in COMMON_ALIASES:
        aliases.update(COMMON_ALIASES[bin_code])
    return aliases


def find(written: str, banks: list[dict] | None = None) -> dict | None:
    """The bank a customer meant, or None when it is not certain.

    Matching is exact on any known spelling, then a token / containment check
    that must land on exactly ONE bank. Two candidates means ambiguous, and
    ambiguous means None.
    """
    catalogue = banks if banks is not None else load()
    if not catalogue:
        return None

    needle = _plain(written)
    if not needle:
        return None

    # 1. Exact match on alias
    for bank in catalogue:
        if needle in _aliases(bank):
            return bank

    # 2. Token match (e.g. "ngân hàng MB bank" has token "mb")
    tokens = [t for t in re.split(r"[^a-z0-9]+", needle) if t]
    candidates: list[dict] = []
    seen_bins: set[str] = set()

    for bank in catalogue:
        al = _aliases(bank)
        b_bin = str(bank.get("bin") or "")
        if any(t in al for t in tokens if len(t) >= 2):
            if b_bin not in seen_bins:
                candidates.append(bank)
                seen_bins.add(b_bin)
        elif any(len(a) >= 4 and a in needle for a in al):
            if b_bin not in seen_bins:
                candidates.append(bank)
                seen_bins.add(b_bin)

    return candidates[0] if len(candidates) == 1 else None


def parse_bank_message(text: str, default_name: str = "") -> dict | None:
    """Extract bank account, bank name, and account holder from customer text.

    Supports:
    - Slash command: /stk 0123456789 MB NGUYEN VAN A
    - Structured text: STK: 123456789 \n Ngân hàng: VCB \n Chủ tài khoản: NGUYEN VAN A
    - Free text: 0123456789 MB NGUYEN VAN A
    """
    raw = (text or "").strip()
    if not raw:
        return None

    is_explicit_cmd = False
    if re.match(r"^[\/!](stk|bank|tk)\b", raw, re.IGNORECASE):
        is_explicit_cmd = True
        raw = re.sub(r"^[\/!](stk|bank|tk)\s*", "", raw, flags=re.IGNORECASE).strip()

    if is_explicit_cmd and not raw:
        return {"action": "help"}

    lines = [l.strip() for l in raw.splitlines() if l.strip()]

    account = ""
    bank_raw = ""
    holder = ""

    label_patterns = {
        "account": r"(?:stk|s[oố]\s*t[aà]i\s*kho[aả]n|s[oố]\s*tk|t[aà]i\s*kho[aả]n|acc(?:ount)?)\s*[:=\-]?\s*([0-9A-Za-z]{6,25})",
        "bank": r"(?:ng[aâ]n\s*h[aà]ng|nh|bank)\s*[:=\-]?\s*([^\n\r,;\-]+)",
        "holder": r"(?:ch[uủ]\s*t[aà]i\s*kho[aả]n|ch[uủ]\s*tk|ch[uủ]\s*th[eẻ]|ch[uủ]\s*h[oộ]|t[eê]n\s*ch[uủ]\s*tk|t[eê]n)\s*[:=\-]?\s*([^\n\r,;]+)",
    }

    acc_m = re.search(label_patterns["account"], raw, re.IGNORECASE)
    bank_m = re.search(label_patterns["bank"], raw, re.IGNORECASE)
    holder_m = re.search(label_patterns["holder"], raw, re.IGNORECASE)

    if acc_m:
        account = acc_m.group(1).strip()
    if bank_m:
        bank_raw = bank_m.group(1).strip()
    if holder_m:
        holder = holder_m.group(1).strip()

    catalogue = load()

    # Second pass: line by line if not labelled
    if not (account and bank_raw):
        for line in lines:
            if not account:
                am = re.search(r"\b(\d{6,22})\b", line)
                if am and any(k in _plain(line) for k in ("stk", "tk", "so", "acc")):
                    account = am.group(1)
            if not bank_raw:
                for b in catalogue:
                    sname = b.get("shortName", "")
                    code = b.get("code", "")
                    if re.search(rf"\b({re.escape(sname)}|{re.escape(code)})\b", line, re.IGNORECASE):
                        bank_raw = sname
                        break

    found_bank = None
    found_bank_word = ""

    if not account or not bank_raw:
        digit_m = re.search(r"\b(\d{6,22})\b", raw)
        if digit_m:
            account = digit_m.group(1)
            remaining = (raw[:digit_m.start()] + " " + raw[digit_m.end():]).strip()
            words = remaining.split()
            for i in range(len(words)):
                for j in range(i + 1, min(i + 5, len(words) + 1)):
                    sub = " ".join(words[i:j])
                    fb = find(sub, catalogue)
                    if fb:
                        found_bank = fb
                        found_bank_word = sub
                        break
                if found_bank:
                    break

            if found_bank:
                bank_raw = found_bank["shortName"]
                rem_holder = remaining.replace(found_bank_word, "").strip()
                rem_holder = re.sub(
                    r"^(stk|tk|bank|nh|ng[aâ]n\s*h[aà]ng|ch[uủ]\s*tk|ch[uủ]\s*t[aà]i\s*kho[aả]n|ctk|t[eê]n|s[oố]|[:=\-,\s])+",
                    "", rem_holder, flags=re.IGNORECASE
                ).strip()
                rem_holder = re.sub(r"[:=\-,\s]+$", "", rem_holder).strip()
                if not holder and len(rem_holder) >= 2:
                    holder = rem_holder

    matched_bank = found_bank or (find(bank_raw, catalogue) if bank_raw else None)
    if not matched_bank:
        matched_bank = find(raw, catalogue)

    clean_account = re.sub(r"\D", "", account) if account else ""

    # If holder was not matched by label or remaining words, try extracting remainder from raw
    if clean_account and matched_bank and not holder:
        rem_raw = raw.replace(account, "").replace(matched_bank["shortName"], "")
        if matched_bank.get("code"):
            rem_raw = rem_raw.replace(matched_bank["code"], "")
        rem_raw = re.sub(
            r"^(stk|tk|bank|nh|ng[aâ]n\s*h[aà]ng|ch[uủ]\s*tk|ch[uủ]\s*t[aà]i\s*kho[aả]n|ctk|t[eê]n|s[oố]|[:=\-,\s])+",
            "", rem_raw, flags=re.IGNORECASE
        ).strip()
        rem_raw = re.sub(r"[:=\-,\s]+$", "", rem_raw).strip()
        if len(rem_raw) >= 2:
            holder = rem_raw

    if not clean_account or not (6 <= len(clean_account) <= 22) or not matched_bank:
        if is_explicit_cmd:
            return {"action": "invalid_cmd", "has_acc": bool(clean_account), "has_bank": bool(matched_bank)}
        if clean_account and not matched_bank:
            return {"action": "partial", "account": clean_account, "holder": holder}
        return None

    clean_holder = re.sub(r"[\t\r\n]", " ", holder).strip()
    clean_holder = re.sub(
        r"^(ch[uủ]\s*tk|ch[uủ]\s*t[aà]i\s*kho[aả]n|t[eê]n|ctk)\s*[:=\-]?\s*",
        "", clean_holder, flags=re.IGNORECASE
    ).strip()
    clean_holder = re.sub(r"\s+", " ", clean_holder)
    if not clean_holder or len(clean_holder) < 2:
        clean_holder = default_name or ""

    return {
        "action": "valid",
        "bank_name": matched_bank["shortName"],
        "bank_bin": matched_bank.get("bin", ""),
        "bank_account": clean_account,
        "bank_account_tail": clean_account[-4:],
        "account_holder": clean_holder.upper(),
    }


def transfer_supported(bank: dict) -> bool:
    return bool(bank.get("transferSupported"))
