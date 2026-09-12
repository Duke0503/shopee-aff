"""Commands that answer a question rather than change anything.

Money policy, the three measured metrics, and the audit trail.
"""

from __future__ import annotations

import argparse

from ...core.config import Config
from ...ledger import repository as ledger
from ...ledger import metrics
from ...core.policy import (
    WITHHOLDING_THRESHOLD_VND,
    TaxPolicy,
    policy_warnings,
    split_commission,
)
from ..formatting import _pct, _vnd


def cmd_check_policy(cfg: Config, args: argparse.Namespace) -> int:
    """Show what each tax policy means in money, before going live."""
    monthly = args.monthly_commission
    sample = args.sample_commission

    print(f"Sample order, approved commission {_vnd(sample)}\n")
    header = f"{'policy':<16}{'customer gets':>18}{'share':>9}{'you keep':>14}{'share':>9}"
    print(header)
    print("-" * len(header))
    for policy in TaxPolicy:
        split = split_commission(
            sample, cfg.cashback_rate, policy, period_is_withheld=True
        )
        print(
            f"{policy.value:<16}{split.customer_receives:>14,} VND"
            f"{split.customer_share:>9.1%}"
            f"{split.operator_keeps:>10,} VND{split.operator_share:>9.2%}"
        )

    print(f"\nAssuming {_vnd(monthly)} of commission per month")
    print(f"(withholding threshold is {_vnd(WITHHOLDING_THRESHOLD_VND)} per payout)\n")

    warnings = policy_warnings(cfg.tax_policy, cfg.cashback_rate, monthly)
    if not warnings:
        print(f"Policy '{cfg.tax_policy.value}': nothing to flag.")
        print(f"Advertise {cfg.cashback_rate:.0%} -- customers receive exactly that.")
        return 0

    print(f"WARNINGS for policy '{cfg.tax_policy.value}':")
    for line in warnings:
        print(f"  ! {line}")
    return 0


def cmd_metrics(cfg: Config, args: argparse.Namespace) -> int:
    with ledger.connect(cfg.db_path) as conn:
        m = metrics.compute(conn)

    print(f"Confidence: {m.confidence}\n")
    print("The three that matter")
    print(f"  effective commission rate : {_pct(m.effective_commission_rate)}")
    print(f"  valid rate                : {_pct(m.valid_rate)}")
    print(f"  approved AOV              : {_vnd(m.approved_aov)}")
    print("\nCounts")
    print(f"  orders total / approved / rejected / awaiting : "
          f"{m.total_orders} / {m.approved_orders} / {m.rejected_orders} / "
          f"{m.awaiting_orders}")
    print(f"  link requests             : {m.total_link_requests}"
          f"  (converted {_pct(m.link_conversion_rate)})")
    print(f"  pending manual review     : {m.pending_manual_review}")
    print("\nMoney")
    print(f"  approved GMV              : {_vnd(m.approved_gmv)}")
    print(f"  approved commission       : {_vnd(m.approved_commission)}")
    print(f"  paid to customers         : {_vnd(m.paid_to_customers)}")
    print(f"  owed to customers         : {_vnd(m.owed_to_customers)}")

    earnings = metrics.estimate_earnings(
        m, cfg.cashback_rate, cfg.tax_policy, period_is_withheld=args.withheld
    )
    if not earnings.get("no_data"):
        print("\nOperator take (before operating costs)")
        print(f"  service fee               : {_vnd(earnings['service_fee'])}")
        print(f"  withheld tax              : {_vnd(earnings['withheld_tax'])}")
        print(f"  customer receives         : {_vnd(earnings['customer_receives'])}")
        print(f"  you keep                  : "
              f"{_vnd(earnings['operator_keeps_before_costs'])}"
              f"  ({earnings['operator_share']:.2%})")
        print(f"  NOTE: {earnings['caveat']}")

    if not m.has_enough_data:
        print(
            f"\nFewer than {metrics.MIN_ORDERS_TO_TRUST} approved orders. "
            "These rates are not yet meaningful -- do not plan around them."
        )
    return 0


def cmd_audit(cfg: Config, args: argparse.Namespace) -> int:
    """Read the trail: one customer's history, or the whole-list scan."""
    from ...core import audit
    from ...ledger import suspicion

    if args.archive:
        done = audit.archive_closed_months()
        if not done:
            print("Nothing to archive: only the current month is open.")
            return 0
        for path in done:
            print(f"  archived {path.name}  ({path.stat().st_size:,} bytes)")
        return 0

    if args.customer:
        events = suspicion.history(args.customer, months=args.months)
        if not events:
            print(f"No recorded activity for {args.customer}.")
            return 0
        print(f"{len(events)} event(s) for {args.customer}")
        print()
        for event in events:
            extra = {k: v for k, v in event.items()
                     if k not in ("at", "event", "customer_id")}
            detail = "  ".join(f"{k}={v}" for k, v in extra.items())
            print(f"  {event['at']}  {event['event']:<18} {detail}")
        return 0

    if args.scan:
        with ledger.connect(cfg.db_path) as conn:
            findings = suspicion.scan(conn, months=args.months)
        if not findings:
            print("Nothing flagged.")
            return 0
        print(f"{len(findings)} finding(s), most serious first.")
        print("None of these prove anything -- they are shapes worth a look.")
        print()
        for f in findings:
            print(f"  [{f.severity.upper():<6}] {f.customer_id}  {f.pattern}")
            print(f"           {f.summary}")
            for line in f.evidence:
                print(f"           - {line}")
            print()
        return 0

    print("Pick one: --customer <id>, --scan, or --archive")
    return 1
