"""Read Shopee's downloadable conversion report.

Path B of the reconciliation design: no Open API access required. Download
the report from affiliate.shopee.vn/report/conversion_report and feed the
CSV in here.

Shopee's exact column headers vary by locale and change over time, so nothing
is hard-coded. Run `cashback inspect-report <file>` to print the headers found,
then record the mapping in report_mapping.json.
"""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

MAPPING_FILE = "report_mapping.json"

# Candidate header names tried when auto-detecting, lowercase and
# punctuation-stripped. Vietnamese and English variants both listed because
# the dashboard language setting changes the export.
AUTO_DETECT = {
    "order_id": ["orderid", "madonhang", "orderno", "manddonhang", "purchaseorderid"],
    "order_value": [
        "ordervalue", "giatridonhang", "totalamount", "amount", "doanhthu",
    ],
    "commission": [
        "commission", "hoahong", "totalcommission", "tonghoahong",
        "estimatedcommission", "hoahonguoctinh",
    ],
    "status": ["status", "trangthai", "orderstatus", "trangthaidonhang"],
    "order_time": ["ordertime", "thoigiandathang", "clicktime", "purchasetime"],
    "sub_id1": ["subid1", "subid", "sub1"],
    "sub_id2": ["subid2", "sub2"],
    "sub_id3": ["subid3", "sub3"],
    "sub_id4": ["subid4", "sub4"],
    "sub_id5": ["subid5", "sub5"],
}

# Status values, lowercased. Anything not listed goes to manual review rather
# than being guessed at.
APPROVED_VALUES = {
    "completed", "approved", "valid", "settled",
    "da duyet", "hoan thanh", "da thanh toan", "hop le",
}
REJECTED_VALUES = {
    "cancelled", "canceled", "rejected", "invalid", "returned", "refunded",
    "da huy", "khong hop le", "tra hang", "hoan tien", "bi tu choi",
}
AWAITING_VALUES = {
    "pending", "processing", "awaiting",
    "cho duyet", "dang xu ly", "chua doi soat",
}


@dataclass
class ColumnMapping:
    """Which CSV header holds which field. Empty string means absent."""

    order_id: str = ""
    order_value: str = ""
    commission: str = ""
    status: str = ""
    order_time: str = ""
    sub_id1: str = ""
    sub_id2: str = ""
    sub_id3: str = ""
    sub_id4: str = ""
    sub_id5: str = ""

    def missing_required(self) -> list[str]:
        required = ("order_id", "commission", "status", "sub_id1")
        return [name for name in required if not getattr(self, name)]

    @classmethod
    def load(cls, path: Path) -> "ColumnMapping":
        if not path.exists():
            return cls()
        return cls(**json.loads(path.read_text(encoding="utf-8")))

    def save(self, path: Path) -> None:
        path.write_text(
            json.dumps(self.__dict__, indent=2, ensure_ascii=False), encoding="utf-8"
        )


@dataclass
class ReportRow:
    """One line of the report, normalised."""

    order_id: str
    order_value: int | None
    commission: int | None
    status: str            # "approved" | "rejected" | "awaiting" | "unknown"
    sub_ids: list[str] = field(default_factory=list)
    order_time: str = ""
    raw: dict = field(default_factory=dict)

    @property
    def customer_code(self) -> str:
        """sub_id1 carries the customer code by convention."""
        return self.sub_ids[0] if self.sub_ids else ""

    @property
    def request_code(self) -> str:
        """sub_id2 carries the link-request code by convention."""
        return self.sub_ids[1] if len(self.sub_ids) > 1 else ""


def _normalise_header(header: str) -> str:
    """Lowercase, strip accents, drop everything but a-z0-9.

    Vietnamese headers are decomposed so their combining marks can be
    discarded. The stroked D (U+0111 / U+0110) carries no combining mark of
    its own, so it is mapped explicitly.
    """
    text = header.strip().lower()
    text = text.replace(chr(0x0111), "d").replace(chr(0x0110), "d")
    decomposed = unicodedata.normalize("NFD", text)
    stripped = "".join(
        ch for ch in decomposed if not unicodedata.combining(ch)
    )
    return re.sub(r"[^a-z0-9]", "", stripped)


def detect_mapping(headers: list[str]) -> ColumnMapping:
    """Best-effort guess. Always review the result before trusting it."""
    lookup = {_normalise_header(h): h for h in headers}
    guessed: dict[str, str] = {}
    for field_name, candidates in AUTO_DETECT.items():
        for candidate in candidates:
            if candidate in lookup:
                guessed[field_name] = lookup[candidate]
                break
    return ColumnMapping(**guessed)


def parse_money(text: str | None) -> int | None:
    """Parse a VND amount. Handles '27.000', '27,000', '27000.00', ' 27 000 d '."""
    if text is None:
        return None
    cleaned = re.sub(r"[^\d.,-]", "", str(text).strip())
    if not cleaned:
        return None

    # A trailing group of exactly two digits after the final separator is a
    # decimal fraction; anything else is a thousands separator.
    match = re.search(r"[.,](\d{1,2})$", cleaned)
    if match and len(re.sub(r"[^\d]", "", cleaned)) > len(match.group(1)):
        whole = re.sub(r"[^\d]", "", cleaned[: match.start()])
        return int(whole) if whole else None

    digits = re.sub(r"[^\d]", "", cleaned)
    return int(digits) if digits else None


def classify_status(text: str | None) -> str:
    if not text:
        return "unknown"
    key = _normalise_header(text)
    for values, label in (
        (APPROVED_VALUES, "approved"),
        (REJECTED_VALUES, "rejected"),
        (AWAITING_VALUES, "awaiting"),
    ):
        if any(_normalise_header(v) == key for v in values):
            return label
    return "unknown"


def read_headers(path: Path) -> list[str]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        for row in reader:
            if row and any(cell.strip() for cell in row):
                return [cell.strip() for cell in row]
    return []


def read_rows(path: Path, mapping: ColumnMapping) -> Iterator[ReportRow]:
    missing = mapping.missing_required()
    if missing:
        raise ValueError(
            f"Column mapping incomplete, missing: {', '.join(missing)}. "
            f"Run 'cashback inspect-report' and fill in {MAPPING_FILE}."
        )

    with path.open(newline="", encoding="utf-8-sig") as handle:
        for raw in csv.DictReader(handle):
            order_id = (raw.get(mapping.order_id) or "").strip()
            if not order_id:
                continue

            sub_ids = []
            for name in ("sub_id1", "sub_id2", "sub_id3", "sub_id4", "sub_id5"):
                column = getattr(mapping, name)
                sub_ids.append((raw.get(column) or "").strip() if column else "")
            while sub_ids and not sub_ids[-1]:
                sub_ids.pop()

            yield ReportRow(
                order_id=order_id,
                order_value=parse_money(raw.get(mapping.order_value))
                if mapping.order_value
                else None,
                commission=parse_money(raw.get(mapping.commission)),
                status=classify_status(raw.get(mapping.status)),
                sub_ids=sub_ids,
                order_time=(raw.get(mapping.order_time) or "").strip()
                if mapping.order_time
                else "",
                raw=dict(raw),
            )
