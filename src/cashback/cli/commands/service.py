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
    # quitting here kills the Zalo side too -- customers stop being answered
    # over something that fixes itself in thirty seconds. The link loop
    # re-checks the connection on every pass and picks it up on its own.
    if worker.wait_for_extension(bridge, args.connect_timeout):
        print("Extension connected.\n")
    else:
        print("\nExtension has not checked in yet. Carrying on without it:")
        print("  - Zalo replies work now")
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


def cmd_zalo_check(cfg: Config, args: argparse.Namespace) -> int:
    """Confirm the token works and reveal what updates actually look like.

    Three things are undocumented and matter: the value of chat.type for a
    group, whether a group message reaches the bot without an @mention, and
    how that mention appears inside the text. Rather than guessing, this
    prints raw updates so they can be read off.
    """
    import json as _json
    import time

    from ...messaging.zalo_client import ZaloBot, ZaloError

    if not cfg.zalo_bot_token:
        print("ZALO_BOT_TOKEN is empty in .env")
        print("\nTo get one: open Zalo, find the 'Zalo Bot Manager' official")
        print("account, choose 'Create bot'. The name must start with 'Bot'.")
        print("The token arrives as a Zalo message.")
        return 1

    try:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            me = bot.get_me()
            print("Token works. Bot identity:")
            print(_json.dumps(me, indent=2, ensure_ascii=False))

            forever = args.seconds <= 0
            window = "until Ctrl+C" if forever else f"for {args.seconds}s"
            print(f"\nListening {window}. Now, in Zalo:")
            print("  1. message the bot privately")
            print("  2. add it to a group and send a message WITHOUT tagging it")
            print("  3. send another message, this time tagging it\n")

            deadline = time.time() + (args.seconds if not forever else 0)
            seen = 0
            while forever or time.time() < deadline:
                remaining = 25 if forever else max(5, int(deadline - time.time()))
                try:
                    updates = bot.get_updates(timeout=min(25, remaining))
                except ZaloError as exc:
                    print(f"  getUpdates failed: {exc}")
                    time.sleep(2)
                    continue
                for update in updates:
                    seen += 1
                    msg = update.message
                    where = "?" 
                    if msg:
                        where = "GROUP" if msg.chat.is_group else "private"
                    print(f"--- update {seen}  ({where}) ---")
                    print(_json.dumps(update.raw, indent=2, ensure_ascii=False))
                    if msg:
                        print(f"  chat.id   = {msg.chat.id}")
                        print(f"  chat.type = {msg.chat.type!r}"
                              f"   <- is this the group marker?")
                        print(f"  text      = {msg.text!r}")
                        print(f"  sender    = {msg.sender_id} {msg.sender_name!r}")
                if not updates:
                    print(f"  ...{int(deadline - time.time())}s left, nothing yet")

            if not seen:
                print("No updates arrived. Either nothing was sent, or a webhook")
                print("is registered -- getUpdates and webhooks are mutually")
                print("exclusive. Check with getWebhookInfo.")
                return 1
            print(f"\n{seen} update(s) captured.")
    except ZaloError as exc:
        print(f"Failed: {exc}")
        return 1
    return 0


def cmd_serve(cfg: Config, args: argparse.Namespace) -> int:
    """Run everything: listen on Zalo, generate links, reply, and serve
    the payout page.

    Two loops share one ledger. The Zalo loop only touches the database;
    the link loop only touches the browser. Neither blocks the other, so a
    slow browser pass never stops the bot from answering.

    The payout page rides along on a third thread. It used to be a
    separate command, which meant the operator opened the URL at the end
    of a day and got a connection refused, because nobody remembers to
    start two things.
    """
    import threading
    import time

    from ...worker import runner as worker
    from ...messaging import conversation as zalo_handler
    from ...shopee.browser_bridge import serve_in_background
    from ...worker.batch_queue import BatchSettings
    from ...messaging.zalo_client import ZaloBot, ZaloError

    if not cfg.zalo_bot_token:
        print("ZALO_BOT_TOKEN is empty. Run: cashback zalo-check")
        return 1
    if not cfg.bridge_token:
        print("BRIDGE_TOKEN is empty. Run: cashback setup-token")
        return 1

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
            cfg, port=args.dashboard_port)
        print(f"Payout page on http://127.0.0.1:{args.dashboard_port}")
    print(f"Bridge up on 127.0.0.1:{args.port or cfg.bridge_port}.")

    if not args.no_browser:
        print("Waiting for the extension...")
        if worker.wait_for_extension(bridge, 5):
            print("Extension connected.")
        else:
            print("\nExtension has not checked in yet. Carrying on without it:")
            print("  - Web & dashboard active on port 8899 and port 80")
            print("  - Zalo replies active")
            print("  - Links will generate as soon as browser opens")

    settings = BatchSettings(
        window_seconds=args.window or cfg.batch_window_seconds,
        max_size=args.max_size or cfg.batch_max_size,
        min_gap_seconds=cfg.batch_min_gap_seconds,
    )

    def zalo_loop() -> None:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            me = bot.get_me()
            print(f"Zalo bot: {me.get('display_name')} "
                  f"(groups: {me.get('can_join_groups')})")
            while not stop.is_set():
                try:
                    updates = bot.get_updates(timeout=20)
                except ZaloError as exc:
                    print(f"[zalo] {exc}")
                    time.sleep(5)
                    continue

                for update in updates:
                    msg = update.message
                    if not msg:
                        continue
                    where = "group" if msg.chat.is_group else "private"
                    print(f"[zalo] {where} from {msg.sender_name or msg.sender_id}: "
                          f"{(msg.text or '')[:60]!r}")
                    try:
                        replies = zalo_handler.handle(
                            cfg.db_path, msg, cfg.advertised_cashback_rate,
                            PAYOUT_WINDOW_TEXT, update.event_name,
                            attribution_days=cfg.link_attribution_days,
                            reduced_rate=cfg.reduced_cashback_rate,
                        )
                        zalo_handler.send_replies(bot, replies)
                    except Exception as exc:
                        print(f"[zalo] handler error: {exc}")

                try:
                    sent = zalo_handler.deliver_ready_links(
                        cfg.db_path, bot, cfg.advertised_cashback_rate,
                        PAYOUT_WINDOW_TEXT, bridge=bridge,
                        third_party=cfg.third_party_fallback,
                        reduced_rate=cfg.reduced_cashback_rate,
                    )
                    if sent:
                        print(f"[zalo] delivered {sent} link(s) to customers")
                    zalo_handler.notify_order_changes(
                        cfg.db_path, bot, cfg.advertised_cashback_rate,
                        PAYOUT_WINDOW_TEXT,
                    )
                    zalo_handler.notify_failed_links(cfg.db_path, bot)
                except Exception as exc:
                    print(f"[zalo] delivery error: {exc}")

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

    threads = [threading.Thread(target=guarded("zalo", zalo_loop), daemon=True)]
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
