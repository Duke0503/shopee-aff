"""What the backend tells customers on its own initiative.

A link that finished after the assistant stopped waiting, an order Shopee
recorded, approved or rejected, money sent. Replies to what a customer
types are the assistant's job (zalo_assistant/); this module only speaks
first.

Every function marks a message sent only after the sender confirms it, so
running them again is always safe, and an assistant that was down simply
leaves the messages queued in the ledger until it is back.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from ..ledger import campaigns, payouts, repository as ledger
from ..messaging import templates as messages
from ..core import audit
from ..core.policy import SHOPEE_COMMISSION_CAP_VND as CAP, round_dong

from ..core.logging_setup import get_logger

log = get_logger(__name__)

# A worked example for the greeting: a mid-sized order at a commission
# rate typical of the categories these customers actually buy.
EXAMPLE_ORDER_VND = 200_000
EXAMPLE_RATE = 0.08

# Who a private message goes to: the customer's Zalo UID as the assistant's
# account sees it. private_chat_id belonged to the retired Bot API.
RECIPIENT = "COALESCE(NULLIF(c.zalo_user_id, ''), c.customer_id)"

# Guest links (the house account) have nobody behind them to tell.
NOT_HOUSE = "COALESCE(c.role, 'user') != 'house'"

# The assistant waits this long for a link itself and answers in the chat
# the customer used. A link collected in that time is marked delivered; one
# still unclaimed after it is the assistant having given up, and ours to send.
ASSISTANT_WAIT = timedelta(seconds=35)

# Past this, a link or an apology is news nobody is waiting for. Sending a
# pile of them after an outage reads as spam, so they are marked and dropped.
STALE_AFTER = timedelta(hours=2)


class Sender(Protocol):
    def send(self, user_id: str, text: str) -> None: ...


def _age(created_at: str | None) -> timedelta:
    return (datetime.now(timezone.utc)
            - ledger._created_sort_key(created_at))


# A message that failed waits before it is tried again: 1, 2, 4... minutes,
# at most an hour. Retrying every pass hammered Zalo with the same failing
# call every ten seconds for an hour -- a bot signal on the one account that
# reaches every customer. In memory: a restart simply tries once more.
_BACKOFF_FIRST = timedelta(minutes=1)
_BACKOFF_MAX = timedelta(hours=1)
_backoff: dict[str, tuple[datetime, timedelta]] = {}


def _due(key: str) -> bool:
    entry = _backoff.get(key)
    return entry is None or datetime.now(timezone.utc) >= entry[0]


def _failed(key: str) -> None:
    previous = _backoff.get(key)
    wait = _BACKOFF_FIRST if previous is None else min(previous[1] * 2, _BACKOFF_MAX)
    _backoff[key] = (datetime.now(timezone.utc) + wait, wait)


def _sent(key: str) -> None:
    _backoff.pop(key, None)


def _send(bot: "Sender", key: str, user_id: str, text: str) -> bool:
    """Send unless still waiting after a failure. True only when delivered."""
    if not _due(key):
        return False
    try:
        bot.send(user_id, text)
    except Exception as exc:
        _failed(key)
        log.info(f"could not send {key}: {exc}")
        return False
    _sent(key)
    return True


def _mark_notified(db_path: Path, request_ids: list[str]) -> None:
    if not request_ids:
        return
    with ledger.connect(db_path) as conn:
        conn.executemany(
            "UPDATE link_requests SET notified_at=? WHERE request_id=?",
            [(ledger.now(), rid) for rid in request_ids])


def _vnd(amount: int) -> str:
    """Money as a customer reads it: 1.234.567 followed by the dong sign.

    Both the separator and the currency mark come from the message file.
    The dong sign is a Vietnamese letter and customer-facing, so it has
    no business being a literal in here.
    """
    grouped = f"{round(amount):,}".replace(
        ",", messages.render("thousands_separator"))
    return grouped + messages.render("currency")


def _short(name: str, limit: int = 38) -> str:
    """Trim a product name to one line.

    Shopee names are keyword-stuffed and run past 70 characters, which
    wraps to three lines on a phone. The customer already knows what
    they sent; this only has to confirm it is the right item.
    """
    clean = " ".join((name or "").split())
    return clean if len(clean) <= limit else clean[:limit].rstrip() + "..."


def _pct(value: float) -> str:
    """Rates read as 9,5% rather than 9.5%."""
    text = f"{value:.1f}".rstrip("0").rstrip(".")
    return text.replace(".", ",") + "%"


def deliver_ready_links(
    db_path: Path, bot: Sender, cashback_rate: float, payout_window: str,
    bridge=None, third_party: bool = True, reduced_rate: float | None = None,
) -> int:
    """Send links nobody collected. Idempotent via notified_at.

    Whoever hands a link to the customer (the assistant in chat, the web
    page) marks it delivered. What is left unmarked after ASSISTANT_WAIT
    was finished too late for them, and goes out here as a private message.
    """
    with ledger.connect(db_path) as conn:
        candidates = conn.execute(
            "SELECT r.request_id, r.created_at, r.affiliate_url,"
            " r.estimated_commission, r.source_url, r.estimate_detail,"
            f" {RECIPIENT} AS chat_id"
            " FROM link_requests r JOIN customers c"
            "   ON c.customer_id = r.customer_id"
            " WHERE r.affiliate_url IS NOT NULL AND r.affiliate_url != ''"
            "   AND r.notified_at IS NULL"
            f"   AND {NOT_HOUSE}"
            " ORDER BY r.created_at"
        ).fetchall()
    _mark_notified(db_path, [r["request_id"] for r in candidates
                             if _age(r["created_at"]) > STALE_AFTER])
    rows = [r for r in candidates
            if ASSISTANT_WAIT < _age(r["created_at"]) <= STALE_AFTER]

    # The headline rate never goes out without the condition attached.
    # Advertising the full figure is only honest while every message that
    # carries it also says when it drops.
    reduced = cashback_rate if reduced_rate is None else reduced_rate
    tax_clause = (
        "" if reduced >= cashback_rate
        else messages.render(
            "tax_clause_short",
            rate=f"{cashback_rate:.0%}", reduced=f"{reduced:.0%}")
    )

    sent = 0
    for row in rows:
        from ..shopee import commission as commission_lookup

        # Reuse a breakdown worked out on an earlier pass; only ask a
        # source when there is nothing stored yet.
        estimate = (
            commission_lookup.Estimate.from_json(row["estimate_detail"])
            if row["estimate_detail"] else None
        )
        if estimate is None:
            estimate = commission_lookup.lookup(
                row["source_url"], bridge=bridge, third_party=third_party
            )
            if estimate:
                log.info(f"estimate for {row['request_id']}: "
                      f"{estimate.commission:,} VND via {estimate.source}"
                      + ("  (capped)" if estimate.is_capped else ""))
                with ledger.connect(db_path) as conn:
                    conn.execute(
                        "UPDATE link_requests SET estimated_commission=?,"
                        " estimate_source=?, estimate_detail=? WHERE request_id=?",
                        (estimate.commission, estimate.source,
                         estimate.to_json(), row["request_id"]),
                    )

        if estimate and estimate.earns_nothing:
            # Real product, real price, no commission. Saying "you get 70%
            # of the commission" here promises a share of nothing, and the
            # customer only finds out after they have bought.
            text = messages.render(
                "link_ready_no_commission",
                link=row["affiliate_url"],
                product=_short(estimate.name) or "San pham",
                price=_vnd(estimate.price),
            )
        elif estimate:
            # A capped order gets two marks: a tag on the Shopee line so the
            # figure is not read as arithmetic gone wrong, and one sentence
            # underneath. That sentence exists to say "we are not keeping
            # it", not to teach the rule -- an 84 million dong bike paying
            # 28,000 reads as theft unless someone says otherwise.
            cap_tag = messages.render("cap_tag") if estimate.is_capped else ""
            cap_line = messages.render(
                "cap_line", cap=_vnd(CAP)
            ) if estimate.is_capped else ""
            raw_comm = estimate.commission
            net_comm = round_dong(raw_comm * (1 - 0.10 - 0.0098))
            cb = round_dong(net_comm * cashback_rate)
            text = messages.render(
                "link_ready",
                link=row["affiliate_url"],
                product=_short(estimate.name),
                price=_vnd(estimate.price),
                commission=_vnd(raw_comm),
                shopee_rate=_pct(estimate.shopee_rate),
                shopee_part=_vnd(estimate.shopee_part),
                seller_rate=_pct(estimate.seller_rate),
                seller_part=_vnd(estimate.seller_part),
                cap_tag=cap_tag,
                cap_line=cap_line,
                cashback=_vnd(cb),
                rate=f"{cashback_rate:.0%}",
                tax_clause=tax_clause,
                days=payout_window,
            )
        else:
            # No source could pin this product down. Say nothing about the
            # amount rather than guess: a figure that disagrees with the
            # payout two months later is how a customer decides they were
            # cheated.
            text = messages.render(
                "link_ready_no_estimate",
                link=row["affiliate_url"],
                rate=f"{cashback_rate:.0%}",
                tax_clause=tax_clause,
                days=payout_window,
            )
        if not _send(bot, f"link:{row['request_id']}", row["chat_id"], text):
            continue

        with ledger.connect(db_path) as conn:
            conn.execute(
                "UPDATE link_requests SET notified_at=? WHERE request_id=?",
                (ledger.now(), row["request_id"]),
            )
        audit.record(audit.LINK_DELIVERED, request_id=row["request_id"],
                     affiliate_url=row["affiliate_url"],
                     commission=estimate.commission if estimate else None,
                     source=estimate.source if estimate else None)
        sent += 1
    return sent


def _order_identity(row) -> tuple[str, str]:
    """What the customer needs to recognise their own order.

    An order code is Shopee's, not theirs. The product name and the link
    they were given are the two things they will recognise, and the link
    is clickable -- they can open it and see the item.

    Returns the name, the link, and a ready-to-insert block of whichever
    of them exist. An order that reconciliation could not match back to a
    link request has neither, and the block is empty rather than two bare
    emoji on their own lines.
    """
    name = ""
    detail = row["estimate_detail"] if "estimate_detail" in row.keys() else None
    if detail:
        try:
            parsed = json.loads(detail)
            if isinstance(parsed, dict) and parsed.get("name"):
                name = _short(parsed["name"], 44)
        except (ValueError, TypeError):
            pass
        if not name:
            from ..shopee.commission import Estimate

            estimate = Estimate.from_json(detail)
            if estimate:
                name = _short(estimate.name, 44)
    link = ""
    for key in ("affiliate_url", "source_url"):
        if key in row.keys() and row[key]:
            link = row[key]
            break
    lines = []
    if name:
        lines.append(messages.render("order_identity_product", product=name))
    if link:
        lines.append(messages.render("order_identity_link", link=link))
    block = "\n".join(lines)
    return name, link, (block + "\n\n" if block else "")


def _announce_transfers(db_path: Path, bot: Sender, rows: list) -> int:
    """Tell each customer their money has actually been sent.

    This was the one thing the bot never said. The operator scanned the
    QR, the money landed, and the conversation stayed silent -- so the
    only proof the arrangement pays anything at all was a line in a bank
    app the customer had to think to check. In a cashback group that
    message is the whole product: it is what turns a first-time buyer
    into someone who sends the next link.

    One message per customer, not per order, because one transfer
    covered all of them.
    """
    by_customer: dict[str, list] = {}
    for row in rows:
        by_customer.setdefault(row["customer_id"], []).append(row)

    sent = 0
    for customer_id, paid in by_customer.items():
        chat_id = paid[0]["chat_id"]
        with ledger.connect(db_path) as bonus_conn:
            bonuses = _paid_bonus(bonus_conn, [r["order_id"] for r in paid])
        total = sum(r["cashback_amount"] or 0 for r in paid) + sum(a for _, a in bonuses)
        bank = ""
        if paid[0]["bank_account"]:
            bank = (f'{paid[0]["bank_name"]} - {paid[0]["bank_account"]} - '
                    f'{paid[0]["account_holder"]}')
        text = messages.render(
            "order_paid" if bank else "order_paid_no_bank",
            amount=_vnd(total), count=len(paid), bank=bank,
            reference=f"Hoan tien Shopee {paid[0]['customer_code'] or customer_id}")
        for name, amount in bonuses:
            text += "\n" + messages.render("campaign_bonus_line", name=name,
                                           bonus=_vnd(amount))
        paid_key = "paid:" + ",".join(sorted(r["order_id"] for r in paid))
        if not _send(bot, paid_key, chat_id, text):
            continue
        with ledger.connect(db_path) as conn:
            conn.executemany(
                "UPDATE orders SET notified_status=? WHERE order_id=?",
                [(ledger.PAID, r["order_id"]) for r in paid])
        for row in paid:
            audit.record(audit.ORDER_PAID,
                         order_id=row["order_id"], status=ledger.PAID,
                         cashback=row["cashback_amount"])
        log.info(f"told {customer_id} about a transfer of {total}")
        sent += 1
    return sent


def notify_order_changes(
    db_path: Path, bot: Sender, cashback_rate: float, payout_window: str,
) -> int:
    """Tell customers what happened to their orders. Returns messages sent.

    Without this the bot goes silent the moment it hands over a link, and
    stays silent for the two months an order takes to clear. A customer who
    hears nothing for seventy days concludes they were cheated, and says so
    in the group.

    Safe to run repeatedly: an order is only announced when its status has
    moved past what the customer was last told, and that mark is written
    only after the message actually goes out.
    """
    with ledger.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT o.order_id, o.customer_id, o.status, o.cashback_amount,"
            " o.estimated_commission, o.rejection_reason,"
            f" {RECIPIENT} AS chat_id, c.bank_name, c.bank_account, c.account_holder,"
            " c.customer_code,"
            # An order code means nothing to the person who sent a link.
            # The product name and the link they used are what let them
            # recognise their own order.
            " r.affiliate_url, r.source_url, r.estimate_detail"
            " FROM orders o JOIN customers c ON c.customer_id = o.customer_id"
            " LEFT JOIN link_requests r ON r.request_id = o.request_id"
            " WHERE (o.notified_status IS NULL OR o.notified_status != o.status)"
            f"   AND {NOT_HOUSE}"
            " ORDER BY o.updated_at"
        ).fetchall()

    sent = 0
    # A transfer covers a BALANCE, not an order: the operator scans one QR
    # for three orders at once. Announcing each of them separately would
    # tell the customer they had been paid three times. These are pulled
    # out of the per-order loop and sent as one message each.
    sent += _announce_transfers(
        db_path, bot, [r for r in rows if r["status"] == ledger.PAID])

    for row in rows:
        status = row["status"]
        if status == ledger.PAID:
            continue
        _, _, identity = _order_identity(row)
        if status == ledger.AWAITING_APPROVAL:
            estimate = row["estimated_commission"]
            net_est = round_dong((estimate or 0) * (1 - 0.10 - 0.0098))
            text = messages.render(
                "order_recorded",
                order_id=row["order_id"],
                identity=identity,
                cashback=_vnd(round_dong(net_est * cashback_rate))
                if estimate else messages.render("cashback_unknown"),
                days=payout_window,
            )
            with ledger.connect(db_path) as campaign_conn:
                standing = campaigns.standing_for_order(campaign_conn, row["order_id"])
            if standing is not None and standing.status == campaigns.HELD:
                text += "\n\n" + messages.render(
                    "campaign_slot_in_order", name=standing.name, rank=standing.rank,
                    slots=standing.slots, bonus=_vnd(standing.amount))
                won_slot_for = row["order_id"]
            else:
                won_slot_for = None
        elif status == ledger.APPROVED:
            # What follows the amount says the balance and either reads
            # the account back or asks for one. It must not name a date:
            # when a balance is transferred is the operator's call, and
            # the customer hears about it when it actually happens, from
            # order_paid. Promising a day that then slips is how a
            # cashback group earns a reputation for not paying.
            #
            # The account number is asked for HERE and nowhere earlier.
            # Before an approval there is no money, and asking a stranger
            # for bank details to pay a sum that does not exist yet is
            # indistinguishable from a scam.
            with ledger.connect(db_path) as balance_conn:
                balance = payouts.balance_for(
                    balance_conn, row["customer_id"], cashback_rate)
            note_args = {"total": _vnd(balance.approved)}
            if row["bank_account"]:
                note_args["bank"] = (
                    f'{row["bank_name"]} - {row["bank_account"]} - '
                    f'{row["account_holder"]}')
                note = messages.render("payout_note_ready", **note_args)
            else:
                note = messages.render(
                    "payout_note_ready_need_bank", **note_args)
            text = messages.render(
                "order_approved", order_id=row["order_id"], identity=identity,
                cashback=_vnd(row["cashback_amount"] or 0),
                payout_note=note)
            with ledger.connect(db_path) as campaign_conn:
                standing = campaigns.standing_for_order(campaign_conn, row["order_id"])
            if standing is not None:
                text += "\n\n" + messages.render(
                    "campaign_bonus_line", name=standing.name, bonus=_vnd(standing.amount))
        elif status == ledger.REJECTED:
            text = messages.render(
                "order_rejected", order_id=row["order_id"], identity=identity,
                reason=row["rejection_reason"] or "Shopee khong ghi nhan")
        else:
            # PAID and anything added later: the customer already heard the
            # amount when it was approved, so stay quiet rather than invent
            # a message for a state nobody has written wording for.
            with ledger.connect(db_path) as conn:
                conn.execute(
                    "UPDATE orders SET notified_status=? WHERE order_id=?",
                    (status, row["order_id"]),
                )
            continue

        if not _send(bot, f"order:{row['order_id']}:{status}", row["chat_id"], text):
            continue

        with ledger.connect(db_path) as conn:
            conn.execute(
                "UPDATE orders SET notified_status=? WHERE order_id=?",
                (status, row["order_id"]),
            )
            if status == ledger.AWAITING_APPROVAL and won_slot_for:
                conn.execute(
                    "UPDATE campaign_awards SET notified_status=? WHERE order_id=?"
                    " AND status=? AND notified_status IS NULL",
                    (campaigns.HELD, won_slot_for, campaigns.HELD))
        audit.record(
            {ledger.AWAITING_APPROVAL: audit.ORDER_RECORDED,
             ledger.APPROVED: audit.ORDER_APPROVED,
             ledger.REJECTED: audit.ORDER_REJECTED}.get(status, "order.other"),
            order_id=row["order_id"], status=status,
            cashback=row["cashback_amount"],
            reason=row["rejection_reason"])
        log.info(f"told {row['order_id']} owner: {status}")
        sent += 1
    return sent


def notify_failed_links(db_path: Path, bot: Sender) -> int:
    """Apologise for links that could not be made. Returns messages sent.

    A request only reaches this state after MAX_LINK_ATTEMPTS, so this is
    not a hiccup: the browser genuinely cannot convert that product. Saying
    so beats a customer waiting all evening for a link that is never coming.
    """
    with ledger.connect(db_path) as conn:
        rows = conn.execute(
            f"SELECT r.request_id, r.created_at, {RECIPIENT} AS chat_id"
            " FROM link_requests r JOIN customers c"
            "   ON c.customer_id = r.customer_id"
            " WHERE r.status='failed' AND r.notified_at IS NULL"
            f"   AND {NOT_HOUSE}"
            " ORDER BY r.created_at"
        ).fetchall()
    _mark_notified(db_path, [r["request_id"] for r in rows
                             if _age(r["created_at"]) > STALE_AFTER])
    rows = [r for r in rows if _age(r["created_at"]) <= STALE_AFTER]

    sent = 0
    for row in rows:
        if not _send(bot, f"failed:{row['request_id']}", row["chat_id"],
                     messages.render("link_failed")):
            continue
        with ledger.connect(db_path) as conn:
            conn.execute(
                "UPDATE link_requests SET notified_at=? WHERE request_id=?",
                (ledger.now(), row["request_id"]),
            )
        audit.record(audit.LINK_FAILED, request_id=row["request_id"])
        log.info(f"told owner of {row['request_id']}: link failed")
        sent += 1
    return sent


# One Zalo message carries a few thousand characters at most; a customer
# with a long history gets several messages rather than a truncated one.
MESSAGE_LIMIT = 1800


def order_history(conn, customer_id: str, cashback_rate: float) -> list[str]:
    """Every order this customer has ever had, as messages ready to send.

    Newest first. A figure not yet approved is marked as an estimate: it is
    what the order would pay, not what it will pay, and only an approved
    commission is ever paid from.
    """
    rows = conn.execute(
        "SELECT o.order_id, o.status, o.platform, o.estimated_commission,"
        "       o.cashback_amount, o.rejection_reason,"
        "       r.affiliate_url, r.source_url, r.estimate_detail"
        "  FROM orders o"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.customer_id = ?"
        " ORDER BY COALESCE(o.recorded_at, o.approved_at, o.updated_at) DESC",
        (customer_id,),
    ).fetchall()
    if not rows:
        return [messages.render("orders_empty")]

    blocks = [_with_campaign(conn, row["order_id"], _order_block(row, cashback_rate))
              for row in rows]
    code = ledger.customer_code_of(conn, customer_id)
    frame = messages.render("orders_summary", orders="\x00",
                           customer_id=code, count=len(rows))
    head, tail = frame.split("\x00", 1)

    parts: list[str] = []
    current = head
    for block in blocks:
        joined = block if current in ("", head) else "\n\n" + block
        if current not in ("", head) and len(current) + len(joined) > MESSAGE_LIMIT:
            parts.append(current)
            current, joined = "", block
        current += joined
    if len(current) + len(tail) > MESSAGE_LIMIT:
        parts.extend([current, tail.lstrip("\n")])
    else:
        parts.append(current + tail)
    return parts


def _with_campaign(conn, order_id: str, block: str) -> str:
    """Append where this order stands in a campaign, if anywhere."""
    standing = campaigns.standing_for_order(conn, order_id)
    if standing is not None:
        key = {campaigns.HELD: "campaign_line_held",
               campaigns.CONFIRMED: "campaign_line_confirmed",
               campaigns.PAID: "campaign_line_paid"}[standing.status]
        return block + "\n" + messages.render(
            key, name=standing.name, rank=standing.rank, slots=standing.slots,
            bonus=_vnd(standing.amount))
    missed = campaigns.missed_for_order(conn, order_id)
    if missed is not None:
        return block + "\n" + messages.render(
            "campaign_line_missed", name=missed["name"], slots=missed["slots"])
    return block


def _paid_bonus(conn, order_ids: list[str]) -> list[tuple[str, int]]:
    """(campaign name, amount) paid with these orders."""
    if not order_ids:
        return []
    marks = ",".join("?" * len(order_ids))
    return [(r[0], r[1]) for r in conn.execute(
        f"SELECT k.name, SUM(a.amount) FROM campaign_awards a"
        f"  JOIN campaigns k ON k.campaign_id = a.campaign_id"
        f" WHERE a.status=? AND a.order_id IN ({marks}) GROUP BY k.name",
        (campaigns.PAID, *order_ids)).fetchall()]


def notify_campaign_changes(db_path: Path, bot: Sender) -> int:
    """Tell a customer the moment they win a slot, and if they lose it.

    Winning is news worth a message of its own: it is what makes the
    customer come back for the next event. Confirmation and payment ride
    on the order's own approval and transfer messages.
    """
    with ledger.connect(db_path) as conn:
        campaigns.evaluate(conn)
        rows = conn.execute(
            "SELECT a.id, a.status, a.notified_status, a.order_id, a.amount,"
            "       k.name, k.slots, k.starts_at, k.ends_at,"
            "       r.affiliate_url, r.source_url, r.estimate_detail,"
            f"      {RECIPIENT} AS chat_id"
            "  FROM campaign_awards a"
            "  JOIN campaigns k ON k.campaign_id = a.campaign_id"
            "  JOIN customers c ON c.customer_id = a.customer_id"
            "  JOIN orders o ON o.order_id = a.order_id"
            "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
            # A slot won by an order not yet announced rides on that order's
            # "recorded" message instead; only a slot handed to an order the
            # customer already heard about gets a message of its own.
            " WHERE (a.notified_status IS NULL AND a.status != ?"
            "        AND o.notified_status IS NOT NULL)"
            "    OR (a.status = ? AND a.notified_status IS NOT NULL AND a.notified_status != ?)",
            (campaigns.VOID, campaigns.VOID, campaigns.VOID)).fetchall()

    sent = 0
    for row in rows:
        _, _, identity = _order_identity(row)
        if row["status"] == campaigns.VOID:
            # After the end a freed slot goes to nobody, so do not say it does.
            running = campaigns._in_window(row, campaigns._now())
            text = messages.render(
                "campaign_slot_lost" if running else "campaign_slot_lost_ended",
                name=row["name"], identity=identity)
        else:
            with ledger.connect(db_path) as conn:
                standing = campaigns.standing_for_order(conn, row["order_id"])
            if standing is None:
                continue
            text = messages.render(
                "campaign_slot_held", name=row["name"], rank=standing.rank,
                slots=row["slots"], bonus=_vnd(row["amount"]), identity=identity)
        if not _send(bot, f"award:{row['id']}:{row['status']}", row["chat_id"], text):
            continue
        with ledger.connect(db_path) as conn:
            conn.execute("UPDATE campaign_awards SET notified_status=? WHERE id=?",
                         (row["status"], row["id"]))
        sent += 1
    return sent


def _order_block(row, cashback_rate: float) -> str:
    name, _, _ = _order_identity(row)
    product = name or messages.render("order_fallback_name", order_id=row["order_id"])
    status = row["status"]
    if status == ledger.AWAITING_APPROVAL:
        estimate = row["estimated_commission"]
        fees = (1 - 0.10 - 0.0098) if (row["platform"] or "shopee") == "shopee" else (1 - 0.10)
        cashback = (_vnd(round_dong(round_dong(estimate * fees) * cashback_rate))
                    if estimate else messages.render("cashback_unknown"))
        key = "order_item_awaiting"
    elif status in (ledger.APPROVED, ledger.PAID):
        amount = row["cashback_amount"]
        cashback = _vnd(amount) if amount else messages.render("cashback_unknown")
        key = "order_item_approved" if status == ledger.APPROVED else "order_item_paid"
    elif status == ledger.REJECTED:
        reason = f" ({row['rejection_reason']})" if row["rejection_reason"] else ""
        return messages.render("order_item_rejected", product=product,
                               reason=reason, order_id=row["order_id"])
    else:
        return f"- {product}: {row['order_id']} ({status})"
    return messages.render(key, product=product, cashback=cashback,
                           order_id=row["order_id"])
