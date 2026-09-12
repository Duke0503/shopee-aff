"""How numbers are printed for the operator, in one place."""

from __future__ import annotations


def _vnd(amount: int | None) -> str:
    return "-" if amount is None else f"{amount:,} VND"


def _pct(value: float | None) -> str:
    return "-" if value is None else f"{value:.2%}"
