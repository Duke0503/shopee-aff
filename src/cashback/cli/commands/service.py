"""Long-running commands: the worker loop and the bot itself."""

from __future__ import annotations

import argparse

from ...core.config import Config
from ...core.logging_setup import get_logger
from ...ledger import repository as ledger
from ...messaging import templates as messages
from .browser import _bridge_for
from ..formatting import _pct, _vnd

log = get_logger(__name__)

# Customer-facing wording lives in the message file, never in code:
# written here it had to go without diacritics and reached customers
# as "30-70 ngay".
PAYOUT_WINDOW_TEXT = messages.render("payout_window")

# How often the backend looks for something to tell customers. Short enough
# that a late link arrives soon after the assistant stopped waiting for it.
NOTIFY_INTERVAL_SECONDS = 10


def cmd_run(cfg: Config, args: argparse.Namespace) -> int:
    from ...worker import runner as worker
    from ...shopee.browser_bridge import serve_in_background
    from ...worker.batch_queue import BatchSettings

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    bridge = _bridge_for(cfg)
    server = serve_in_background(bridge, args.port or cfg.bridge_port)
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}. "
          "Waiting for the extension...")

    # A late extension is not a reason to take the whole bot down. After a
    # restart it can take a poll cycle to notice the bridge is back, and
    # quitting here takes the web and notifications down too, over
    # something that fixes itself in thirty seconds. The link loop
    # re-checks the connection on every pass and picks it up on its own.
    if worker.wait_for_extension(bridge, args.connect_timeout):
        print("Extension connected.\n")
    else:
        print("\nExtension has not checked in yet. Carrying on without it:")
        print("  - links start generating as soon as it appears")
        print("If it stays away: load it at chrome://extensions, open")
        print("affiliate.shopee.vn, or re-sync with: cashback setup-token\n")
    settings = BatchSettings(
        window_seconds=args.window or cfg.batch_window_seconds,
        max_size=args.max_size or cfg.batch_max_size,
        min_gap_seconds=cfg.batch_min_gap_seconds,
    )
    try:
        worker.loop(cfg.db_path, bridge, settings, cfg.link_attribution_days)
    finally:
        server.shutdown()
    return 0


def cmd_serve(cfg: Config, args: argparse.Namespace) -> int:
    """Run everything: generate links, send notifications through the
    Zalo assistant, reconcile, and serve the site.

    The loops share one ledger. The notify loop only touches the database
    and the assistant; the link loop only touches the browser. Neither
    blocks the other, so a slow browser pass never delays a notification.

    The payout page rides along on a third thread. It used to be a
    separate command, which meant the operator opened the URL at the end
    of a day and got a connection refused, because nobody remembers to
    start two things.
    """
    import threading
    import time

    from ...worker import runner as worker
    from ...messaging import notifications
    from ...messaging.assistant_bridge import AssistantSender
    from ...shopee.browser_bridge import serve_in_background
    from ...worker.batch_queue import BatchSettings

    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

    # Snapshot BEFORE migrating: a restart usually follows a code change,
    # and a migration is the change most able to damage the data.
    if cfg.db_path.exists():
        from ...ledger import backup
        print(f"Backup: {backup.create(cfg.db_path, cfg.backup_dir, keep=cfg.backup_keep)}")

    # Apply any schema added since this database was created. Cheap and
    # idempotent -- and skipping it once already had the bot querying a
    # column that did not exist yet, which killed every delivery.
    ledger.initialise(cfg.db_path)

    stop = threading.Event()
    bridge = _bridge_for(cfg)
    server = serve_in_background(bridge, args.port or cfg.bridge_port)

    dashboard_server = None
    if not args.no_dashboard:
        from ...web import dashboard
        dashboard_server = dashboard.serve_in_background(
            cfg, port=args.dashboard_port or cfg.dashboard_port)
        print("Payout page on http://127.0.0.1:"
              f"{args.dashboard_port or cfg.dashboard_port}")
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}.")

    if not args.no_browser:
        print("Waiting for the extension...")
        if worker.wait_for_extension(bridge, 5):
            print("Extension connected.")
        else:
            print("\nExtension has not checked in yet. Carrying on without it:")
            print(f"  - Web active on port {cfg.dashboard_port}"
                  + (f" and {cfg.public_port}" if cfg.public_port else ""))
            print("  - Notifications go out through the assistant")
            print("  - Links will generate as soon as browser opens")

    settings = BatchSettings(
        window_seconds=args.window or cfg.batch_window_seconds,
        max_size=args.max_size or cfg.batch_max_size,
        min_gap_seconds=cfg.batch_min_gap_seconds,
    )

    sender = AssistantSender(cfg.assistant_url, cfg.assistant_token)

    def notify_loop() -> None:
        """Say what the backend has to say on its own: late links, order
        news, money sent. Customers' own messages are the assistant's.

        Nothing is marked sent until the assistant confirms it, so while
        the assistant is down or restarting everything simply waits here.
        """
        # Cheap steps first, and each on its own: link delivery may look a
        # price up over the network, and a slow or failing lookup must not
        # hold back news of an approved order.
        steps = (
            # First: settles campaign slots, so an approval message sent
            # in this same pass already knows about its bonus.
            ("campaigns", lambda: notifications.notify_campaign_changes(
                cfg.db_path, sender)),
            ("orders", lambda: notifications.notify_order_changes(
                cfg.db_path, sender, cfg.advertised_cashback_rate,
                PAYOUT_WINDOW_TEXT)),
            ("failed links", lambda: notifications.notify_failed_links(
                cfg.db_path, sender)),
            ("late links", lambda: notifications.deliver_ready_links(
                cfg.db_path, sender, cfg.advertised_cashback_rate,
                PAYOUT_WINDOW_TEXT, bridge=bridge,
                third_party=cfg.third_party_fallback,
                reduced_rate=cfg.reduced_cashback_rate)),
        )
        while not stop.wait(NOTIFY_INTERVAL_SECONDS):
            for name, step in steps:
                try:
                    sent = step()
                    if sent:
                        log.info(f"[notify] {name}: {sent} sent")
                except Exception as exc:
                    log.info(f"[notify] {name} failed: {exc}")

    def link_loop() -> None:
        totals = worker.Totals()
        while not stop.is_set():
            if bridge.connected():
                try:
                    worker.run_one_pass(cfg.db_path, bridge, settings, totals)
                except Exception as exc:
                    print(f"[links] pass error: {exc}")
            time.sleep(5)

    def reconcile_loop() -> None:
        """Pull the conversion report in, on a timer.

        This was the last thing left running by hand, and leaving it there
        meant an order could sit unrecorded for days: the customer heard
        nothing after buying, and the payout page stayed empty while money
        was in fact owed.

        The interval is deliberately unhurried. Commissions validate
        monthly and a payout is thirty to seventy days out, so nothing
        here is urgent; what matters is that the customer gets told their
        order landed within an hour or so rather than whenever someone
        remembers to run a command. One pass is a page load and a couple
        of reads, which is nothing next to link generation.
        """
        from ...shopee import reconciliation as reconcile, report_reader

        # Wait before the first pass: the extension has just connected and
        # the browser is more useful to a waiting customer than to a report.
        first = True
        while not stop.is_set():
            wait = 60 if first else cfg.reconcile_interval_minutes * 60
            first = False
            if stop.wait(wait):
                return
            if not bridge.connected():
                continue
            try:
                rows = report_reader.read(bridge, days=cfg.reconcile_days)
            except Exception as exc:
                log.info(f"[reconcile] could not read the report: {exc}")
                continue
            if not rows:
                continue
            try:
                with ledger.connect(cfg.db_path) as conn:
                    outcome = reconcile.run(
                        conn, rows,
                        cashback_rate=cfg.cashback_rate,
                        tax_policy=cfg.tax_policy,
                        period_is_withheld=cfg.period_is_withheld,
                        source="dashboard:auto",
                    )
            except Exception as exc:
                log.info(f"[reconcile] could not apply the report: {exc}")
                continue
            if outcome.orders_new or outcome.approved or outcome.rejected:
                log.info(
                    f"[reconcile] {len(rows)} row(s): "
                    f"{outcome.orders_new} new, {outcome.approved} approved, "
                    f"{outcome.rejected} rejected"
                )
            if outcome.needs_review:
                log.info(f"[reconcile] {outcome.needs_review} row(s) need a human")

    def accesstrade_loop() -> None:
        """Pull TikTok orders in from AccessTrade, on the same timer as the
        Shopee report. Nothing ran this before: TikTok orders reached neither
        the ledger nor the customer."""
        from ...providers.accesstrade_reconciler import sync_accesstrade_orders

        if stop.wait(90):
            return
        while True:
            summary = sync_accesstrade_orders(cfg)
            if summary.error:
                log.info(f"[accesstrade] {summary.error}")
            elif summary.orders_new or summary.approved or summary.rejected or summary.needs_review:
                log.info(
                    f"[accesstrade] {summary.rows_read} order(s): {summary.orders_new} new, "
                    f"{summary.approved} approved, {summary.rejected} rejected, "
                    f"{summary.needs_review} need a human")
            if stop.wait(cfg.reconcile_interval_minutes * 60):
                return

    def backup_loop() -> None:
        """Snapshot on a timer. The startup one is taken before migrating."""
        from ...ledger import backup

        while not stop.wait(cfg.backup_interval_hours * 3600):
            try:
                dest = backup.create(
                    cfg.db_path, cfg.backup_dir, keep=cfg.backup_keep)
                log.info(f"[backup] wrote {dest}")
            except Exception as exc:
                log.exception(f"[backup] failed: {exc}")

    def guarded(name: str, loop):
        """Run a loop so that one bad pass cannot end it for good.

        A thread that raises is gone until the next restart, and nothing
        says so: the process stays up, the other loops keep working, and
        the dead one is only noticed days later by its absence. That is
        exactly how reconciliation stopped after its first successful
        pass -- a NameError on the line that logged the result, after the
        orders had already been written, so the ledger looked healthy.
        """
        def run():
            while not stop.is_set():
                try:
                    loop()
                    return                      # asked to stop; done
                except Exception as exc:
                    log.exception(f"[{name}] crashed, restarting: {exc}")
                    if stop.wait(30):
                        return
        return run

    threads = [
        threading.Thread(target=guarded("notify", notify_loop), daemon=True),
        threading.Thread(target=guarded("backup", backup_loop), daemon=True),
    ]
    if cfg.accesstrade_api_key:
        threads.append(threading.Thread(
            target=guarded("accesstrade", accesstrade_loop), daemon=True))
    if not args.no_browser:
        threads.append(threading.Thread(
            target=guarded("links", link_loop), daemon=True))
        if not args.no_reconcile:
            threads.append(threading.Thread(
                target=guarded("reconcile", reconcile_loop), daemon=True))
    for t in threads:
        t.start()

    print("\nRunning. Ctrl+C to stop.\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        stop.set()
        server.shutdown()
    return 0
