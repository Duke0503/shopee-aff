"""Reading Shopee's exported conversion report and reconciling it."""

from __future__ import annotations

import argparse

from ...core.config import Config
from ...ledger import repository as ledger
from ..formatting import _pct, _vnd


def cmd_inspect_report(cfg: Config, args: argparse.Namespace) -> int:
    """Print the headers found in a downloaded report, plus a guessed mapping."""
    from pathlib import Path

    from ...shopee.report_importer import MAPPING_FILE, ColumnMapping, detect_mapping, read_headers

    path = Path(args.file)
    headers = read_headers(path)
    if not headers:
        print(f"No header row found in {path}")
        return 1

    print(f"{len(headers)} column(s) in {path.name}:\n")
    for i, header in enumerate(headers, 1):
        print(f"  {i:>2}. {header}")

    guess = detect_mapping(headers)
    print("\nGuessed mapping:")
    for name, value in guess.__dict__.items():
        print(f"  {name:<12} -> {value or '(not found)'}")

    missing = guess.missing_required()
    target = Path(MAPPING_FILE)
    guess.save(target)
    print(f"\nWritten to {target}. Edit it by hand where the guess is wrong.")
    if missing:
        print(f"STILL MISSING (required): {', '.join(missing)}")
        return 1
    return 0


def cmd_reconcile(cfg: Config, args: argparse.Namespace) -> int:
    from pathlib import Path

    from ...shopee import reconciliation as reconcile
    from ...shopee.report_importer import MAPPING_FILE, ColumnMapping, read_rows

    mapping = ColumnMapping.load(Path(MAPPING_FILE))
    missing = mapping.missing_required()
    if missing:
        print(f"Column mapping incomplete, missing: {', '.join(missing)}")
        print(f"Run: cashback inspect-report <file>   then edit {MAPPING_FILE}")
        return 1

    path = Path(args.file)
    with ledger.connect(cfg.db_path) as conn:
        rows = list(read_rows(path, mapping))
        if args.dry_run:
            print(f"Dry run: {len(rows)} row(s) parsed from {path.name}")
            for row in rows[:10]:
                print(f"  {row.order_id:<18} {row.status:<10}"
                      f" commission={row.commission} sub_id1={row.customer_code!r}")
            if len(rows) > 10:
                print(f"  ... and {len(rows) - 10} more")
            return 0

        outcome = reconcile.run(
            conn,
            rows,
            cashback_rate=cfg.cashback_rate,
            tax_policy=cfg.tax_policy,
            period_is_withheld=args.withheld,
            source=f"csv:{path.name}",
        )

    print(outcome.summary())
    if outcome.notify_approved:
        print(f"\nTo notify (approved): {len(outcome.notify_approved)}")
    if outcome.notify_rejected:
        print(f"To notify (rejected): {len(outcome.notify_rejected)}")
    if outcome.needs_review:
        print(f"\n{outcome.needs_review} row(s) need a human. "
              f"See the manual_review table.")
    return 0
