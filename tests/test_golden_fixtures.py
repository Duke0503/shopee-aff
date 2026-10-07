"""Run the shared golden fixtures against the Python code.

The SAME JSON files are read by the TypeScript tests (packages/golden). If both
pass, the new code computes the same money, to the dong, as this code — which is
the whole promise of the migration.

A fixture's `expected` values were produced by this Python in the first place, so
these tests should always pass; they fail loudly if today's code is changed
without updating the fixtures (which must be a reviewed decision).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cashback.core.policy import (
    TaxPolicy,
    policy_warnings,
    round_dong,
    split_commission,
)
from cashback.shopee.commission import _build

FIXTURES = Path(__file__).resolve().parents[1] / "packages" / "golden" / "fixtures" / "money"


def _load_cases(rule: str) -> list[dict]:
    cases: list[dict] = []
    for path in sorted(FIXTURES.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("rule") == rule:
            cases.extend(data["cases"])
    return cases


def _run(rule: str, payload: dict):
    if rule == "round_dong":
        return round_dong(payload["value"])
    if rule == "legacy_round_half_even":
        return round(payload["value"])
    if rule == "split_commission":
        split = split_commission(
            payload["approved_commission"],
            payload["cashback_rate"],
            TaxPolicy(payload["tax_policy"]),
            payload["period_is_withheld"],
        )
        return {
            "service_fee": split.service_fee,
            "withheld_tax": split.withheld_tax,
            "customer_receives": split.customer_receives,
            "operator_keeps": split.operator_keeps,
        }
    if rule == "commission_estimate":
        estimate = _build(
            payload["price"], payload["shopee_rate"], payload["seller_rate"],
            name="x", source="shopee",
        )
        return {
            "commission": estimate.commission,
            "shopee_part": estimate.shopee_part,
            "seller_part": estimate.seller_part,
            "is_capped": estimate.is_capped,
        }
    if rule == "estimate_cashback":
        commission = payload["commission"]
        return round_dong(round_dong(commission * 0.8902) * payload["cashback_rate"])
    if rule == "policy_warnings":
        return {
            "count": len(policy_warnings(
                TaxPolicy(payload["tax_policy"]),
                payload["cashback_rate"],
                payload["expected_monthly_commission"],
            ))
        }
    raise AssertionError(f"no python handler for rule {rule}")


@pytest.mark.parametrize("case", _load_cases("round_dong"), ids=lambda c: c["name"])
def test_round_dong(case):
    assert _run("round_dong", case["input"]) == case["expected"]


@pytest.mark.parametrize("case", _load_cases("legacy_round_half_even"), ids=lambda c: c["name"])
def test_legacy_round_half_even(case):
    assert _run("legacy_round_half_even", case["input"]) == case["expected"]


@pytest.mark.parametrize("case", _load_cases("split_commission"), ids=lambda c: c["name"])
def test_split_commission(case):
    assert _run("split_commission", case["input"]) == case["expected"]


@pytest.mark.parametrize("case", _load_cases("commission_estimate"), ids=lambda c: c["name"])
def test_commission_estimate(case):
    assert _run("commission_estimate", case["input"]) == case["expected"]


@pytest.mark.parametrize("case", _load_cases("estimate_cashback"), ids=lambda c: c["name"])
def test_estimate_cashback(case):
    assert _run("estimate_cashback", case["input"]) == case["expected"]


@pytest.mark.parametrize("case", _load_cases("policy_warnings"), ids=lambda c: c["name"])
def test_policy_warnings(case):
    assert _run("policy_warnings", case["input"]) == case["expected"]
