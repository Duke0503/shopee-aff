"""Turn incoming Zalo messages into ledger actions, and replies.

The bot only hears everything in a private chat. In a group it is delivered
a message solely when tagged with @ or replied to, so the group is for
announcements and the private chat is where work actually happens.

Handlers must be safe to run twice: the platform offers no way to
acknowledge an update, so a redelivery cannot be ruled out.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from ..ledger import payouts, repository as ledger
from ..messaging import templates as messages
from ..core import audit
from ..core.identifiers import new_request_id, next_customer_id
from ..core.policy import SHOPEE_COMMISSION_CAP_VND as CAP, round_dong
from ..messaging.zalo_client import Message, ZaloBot

# Shopee product links, in the forms customers actually paste. The
# pattern lives in shopee_lookup so this list cannot drift out of step
# with the one the lookups use -- it already did once, and shp.ee links
# were silently treated as ordinary chat.
from ..shopee.dashboard_lookup import ANY_SHOPEE_URL as SHOPEE_URL

from ..core.logging_setup import get_logger

log = get_logger(__name__)

# "STK: VCB - 0123456789 - NGUYEN VAN A"
BANK_LINE = re.compile(
    r"stk\s*[:\-]?\s*(?P<bank>[^\-\n]{1,40}?)\s*-\s*(?P<account>[\d\s]{6,30}?)\s*-\s*"
    r"(?P<holder>[^\n]{2,60})",
    re.IGNORECASE,
)

COMMAND_RULES = ("/huongdan", "/help", "/batdau", "/start", "/cachdung")
COMMAND_POLICY = ("/coche", "/chinhsach")
# The refund conditions used to ride along on every link message. They
# are identical every time, so a regular customer re-read the same eight
# lines on every request. They live here now and the link message points
# at them.
COMMAND_TERMS = ("/dieukien", "/dieukhoan", "/khinao")
COMMAND_FORGET = ("/xoathongtin", "/xoadulieu")
COMMAND_BANK = ("/nganhang", "/taikhoan", "/stk")
# Without this the only way to answer "where is my money" is a human
# reading the ledger, which does not scale past one operator.
COMMAND_BALANCE = ("/sodu", "/tien", "/kiemtra")

# In a group the text arrives with the mention glued to the front, as in
# "@Bot DP Shopee Affiliate /huongdan". The bot's display name contains
# spaces, so there is no reliable way to strip the mention; instead the
# command is looked for anywhere in the message.
COMMAND_TOKEN = re.compile(r"(?:^|\s)(/[a-z0-9_]+)", re.IGNORECASE)


KNOWN_COMMANDS = (
    COMMAND_RULES + COMMAND_POLICY + COMMAND_FORGET
    + COMMAND_TERMS + COMMAND_BANK + COMMAND_BALANCE
)

# A worked example for the greeting: a mid-sized order at a commission
# rate typical of the categories these customers actually buy.
EXAMPLE_ORDER_VND = 200_000
EXAMPLE_RATE = 0.08


def _plain(text: str) -> str:
    """Lowercase, strip diacritics and spacing. 'Huong Dan' -> 'huongdan'."""
    stripped = unicodedata.normalize("NFD", (text or "").lower())
    letters = "".join(c for c in stripped if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", letters)


def find_command(text: str) -> str:
    """Return the command in the text, lowercased, or ''.

    A slash is preferred, but a bare word is accepted too. People type the
    command name on its own, with or without diacritics and in any case,
    and used to get an answer about something else entirely -- which reads
    as the bot being broken rather than as a typo.
    """
    match = COMMAND_TOKEN.search(text or "")
    if match:
        return match.group(1).lower()
    word = _plain(text)
    if word and len(word) <= 20:
        for known in KNOWN_COMMANDS:
            if word == known.lstrip("/"):
                return known
    return ""


# Zalo reports a message whose content it will not hand over under this name.
# In practice it means "the sender attached a link preview".
UNSUPPORTED_EVENT = "message.unsupported.received"


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


@dataclass
class Reply:
    chat_id: str
    text: str


def find_shopee_urls(text: str) -> list[str]:
    seen: list[str] = []
    for match in SHOPEE_URL.findall(text or ""):
        url = match.rstrip(".,;)]}")
        if url not in seen:
            seen.append(url)
    return seen


def parse_bank_details(text: str) -> dict | None:
    match = BANK_LINE.search(text or "")
    if not match:
        return None
    account = re.sub(r"\s+", "", match.group("account"))
    if not account.isdigit():
        return None
    return {
        "bank": match.group("bank").strip(),
        "account": account,
        "holder": match.group("holder").strip(),
    }


def _ensure_customer(conn: sqlite3.Connection, msg: Message) -> sqlite3.Row:
    """Find the customer behind a private chat, creating one if needed.

    The private chat id is what makes a payout notice deliverable two months
    from now, so it is recorded the moment it is first seen.
    """
    sender = msg.sender_id or msg.chat.id
    # A sender's own id doubles as a private chat id: the bot can message it
    # directly. In a group, chat.id is the group, so it must not be used.
    private = msg.sender_id or (msg.chat.id if not msg.chat.is_group else "")

    row = conn.execute(
        "SELECT * FROM customers WHERE zalo_user_id=? OR private_chat_id=?",
        (sender, private or sender),
    ).fetchone()

    if row is None:
        customer_id = next_customer_id(conn)
        ledger.add_customer(
            conn,
            customer_id,
            display_name=msg.sender_name,
            zalo_user_id=sender,
            private_chat_id=private,
        )
        audit.record(audit.CUSTOMER_SEEN, customer_id=customer_id,
                     zalo_user_id=sender, name=msg.sender_name or None,
                     channel="group" if msg.chat.is_group else "private")
        return ledger.get_customer(conn, customer_id)

    # Backfill anything learned since the customer was first seen.
    if not row["private_chat_id"] and private:
        conn.execute(
            "UPDATE customers SET private_chat_id=? WHERE customer_id=?",
            (private, row["customer_id"]),
        )
    if not row["display_name"] and msg.sender_name:
        conn.execute(
            "UPDATE customers SET display_name=? WHERE customer_id=?",
            (msg.sender_name, row["customer_id"]),
        )
    return ledger.get_customer(conn, row["customer_id"])


def handle(
    db_path: Path, msg: Message, cashback_rate: float, payout_window: str,
    event_name: str = "", attribution_days: int = 7,
    reduced_rate: float | None = None,
) -> list[Reply]:
    """Decide what a single incoming message means. Returns replies to send."""
    if not msg or not msg.chat.id:
        return []

    # Zalo strips the content of any message carrying a link preview card and
    # labels it unsupported, so the URL never reaches the bot. Nothing can be
    # done about that from here except tell the sender how to avoid it.
    if event_name == UNSUPPORTED_EVENT:
        return [Reply(msg.chat.id, messages.render("link_preview_blocked"))]

    text = (msg.text or "").strip()
    # The headline figure never appears without the condition attached.
    # Advertising the full rate is only honest while every message that
    # carries it also says when it drops.
    reduced = cashback_rate if reduced_rate is None else reduced_rate
    common = {
        "rate": f"{cashback_rate:.0%}",
        "reduced": f"{reduced:.0%}",
        "days": payout_window,
        # A percentage of a commission is not a number anyone can convert
        # into money in their head. One worked example at a typical rate
        # does what the percentage cannot.
        "example": _vnd(round_dong(
            EXAMPLE_ORDER_VND * EXAMPLE_RATE * cashback_rate)),
    }

    common["tax_clause"] = (
        "" if reduced >= cashback_rate
        else messages.render("tax_clause_short", **common)
    )
    common["tax_clause_full"] = messages.render("tax_clause_full", **common)

    in_group = msg.chat.is_group
    # Replies go back where the message came from, except anything involving
    # money: bank details and payout amounts are nobody else's business.
    public = msg.chat.id
    replies: list[Reply] = []

    with ledger.connect(db_path) as conn:
        existing = conn.execute(
            "SELECT 1 FROM customers WHERE zalo_user_id=?",
            (msg.sender_id or msg.chat.id,),
        ).fetchone()
        first_contact = existing is None

        customer = _ensure_customer(conn, msg)
        customer_id = customer["customer_id"]
        # A sender seen in a group can be messaged privately using their own
        # id, so a group mention is enough to make later payout notices
        # deliverable. The customer never has to open the chat themselves.
        private = customer["private_chat_id"] or msg.sender_id or msg.chat.id

        command = find_command(text)
        if command:
            audit.record(audit.COMMAND_USED, customer_id=customer_id,
                         command=command,
                         channel="group" if in_group else "private")

        if command in COMMAND_FORGET:
            ledger.erase_bank_details(conn, customer_id)
            audit.record(audit.BANK_ERASED, customer_id=customer_id)
            return [Reply(private, messages.render("bank_deleted"))]

        if command in COMMAND_RULES:
            return [Reply(public, messages.render("rules", **common))]

        if command in COMMAND_POLICY:
            return [Reply(public, messages.render("policy", **common))]

        if command in COMMAND_TERMS:
            return [Reply(public, messages.render("terms", **common))]

        if command in COMMAND_BALANCE:
            # Always private: this is the one command that names a sum.
            balance = payouts.balance_for(conn, customer_id, cashback_rate)
            if balance.is_empty:
                return [Reply(private, messages.render("balance_empty"))]
            if balance.is_payable and not customer["bank_account"]:
                status = messages.render("balance_need_bank")
            elif balance.is_payable:
                status = messages.render("balance_ready")
            elif balance.awaiting:
                # Nothing approved yet: there is no shortfall to report,
                # only a wait. Saying "short by 50,000 of 50,000" reads as
                # a bug and tells the customer nothing.
                status = messages.render("balance_waiting")
            else:
                # Everything owed has been sent. Saying "nothing has been
                # approved yet" to someone who was paid this morning reads
                # as the bot having lost their history.
                status = messages.render("balance_settled")
            return [Reply(private, messages.render(
                "balance",
                approved=_vnd(balance.approved),
                approved_orders=balance.approved_orders,
                awaiting=_vnd(balance.awaiting),
                awaiting_orders=balance.awaiting_orders,
                paid=_vnd(balance.paid),
                status_line=status,
            ))]

        if command in COMMAND_BANK:
            saved = customer["bank_account"]
            if saved:
                summary = (f'{customer["bank_name"]} - {saved} - '
                           f'{customer["account_holder"]}')
                return [Reply(private, messages.render(
                    "bank_current", name=summary))]
            return [Reply(private, messages.render("need_bank"))]

        # Bank details only ever go through the private channel, whatever
        # channel they arrived on.
        bank = parse_bank_details(text)
        if bank:
            ledger.set_bank_details(
                conn, customer_id, bank["bank"], bank["account"], bank["holder"]
            )
            audit.record(audit.BANK_CHANGED, customer_id=customer_id,
                         bank=bank["bank"],
                         account=audit.fingerprint(bank["account"]))
            summary = f"{bank['bank']} - {bank['account']} - {bank['holder']}"
            return [Reply(private, messages.render("bank_saved", name=summary))]

        urls = find_shopee_urls(text)
        if not urls:
            # Someone typed a slash command that does not exist. Saying so
            # beats the old behaviour, which was to treat it as chatter and
            # answer with something unrelated.
            if command and command not in KNOWN_COMMANDS:
                return [Reply(public, messages.render(
                    "unknown_command", command=command))]

            greeting = messages.render(
                "welcome",
                name=f" {msg.sender_name}" if msg.sender_name else "",
                **common,
            )
            if in_group:
                out = [Reply(public, greeting)]
                # Zalo on desktop offers no way to open a chat with a bot,
                # so someone on a PC could never reach it first. Messaging
                # them the moment they are seen creates the conversation on
                # their side, on every device they use.
                if first_contact and private != public:
                    out.append(Reply(private, messages.render("first_touch", **common)))
                return out
            if first_contact:
                return [Reply(private, messages.render("first_touch", **common))]
            # Anything else from someone already known: one short nudge.
            # Bank details are NOT asked for here. Asking a stranger for an
            # account number before a single dong exists reads exactly like
            # a scam, and asking again on every "ok" and "thanks" is how a
            # customer mutes the chat.
            return [Reply(private, messages.render("not_a_link"))]

        # Queue the links first. Making someone hand over bank details before
        # they have seen anything useful is how you lose them in the first
        # minute -- and the money is two months away regardless.
        resent = 0
        for url in urls:
            # Someone resending a product almost always means "I never got
            # it", not "make me a second one". Reusing the link they already
            # have answers that, saves a trip to Shopee, and spares them
            # three near-identical messages to choose between.
            existing = ledger.find_reusable_request(
                conn, customer_id, url, resend_within_days=attribution_days)
            if existing is not None:
                if existing["affiliate_url"]:
                    ledger.resend_request(conn, existing["request_id"])
                    resent += 1
                # Still being generated: it is already queued, leave it be.
                continue

            request_id = new_request_id()
            ledger.record_link_request(
                conn,
                request_id=request_id,
                customer_id=customer_id,
                source_url=url,
                affiliate_url=None,
                estimated_commission=None,
                channel="zalo_group" if in_group else "zalo",
            )
            audit.record(audit.LINK_REQUESTED, customer_id=customer_id,
                         request_id=request_id, url=url,
                         channel="group" if in_group else "private")

        # In a group several people may be asking at once, so name who this
        # acknowledgement belongs to. The platform has no mention support,
        # so the name goes in as plain text.
        # Name the sender when several people in a group are asking at once.
        # With no name available the plain wording reads better than one
        # with a gap in it.
        if in_group and msg.sender_name:
            replies.append(Reply(public, messages.render(
                "received_group", name=msg.sender_name)))
        else:
            replies.append(Reply(public, messages.render("received")))

    return replies


def send_replies(bot: ZaloBot, replies: list[Reply]) -> None:
    for reply in replies:
        bot.send(reply.chat_id, reply.text)


def deliver_ready_links(
    db_path: Path, bot: ZaloBot, cashback_rate: float, payout_window: str,
    bridge=None, third_party: bool = True, reduced_rate: float | None = None,
) -> int:
    """Send out links generated since the last pass. Idempotent via notified_at."""
    with ledger.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT r.request_id, r.affiliate_url, r.estimated_commission,"
            " r.source_url, r.estimate_detail, c.private_chat_id"
            " FROM link_requests r JOIN customers c"
            "   ON c.customer_id = r.customer_id"
            " WHERE r.affiliate_url IS NOT NULL AND r.affiliate_url != ''"
            # An empty string is not NULL, and Zalo answers an empty
            # chat_id with a 400 on every pass forever. The other two
            # queries in this module already guard it; this one did not.
            "   AND r.notified_at IS NULL"
            "   AND c.private_chat_id IS NOT NULL AND c.private_chat_id != ''"
            " ORDER BY r.created_at"
        ).fetchall()

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
            text = messages.render(
                "link_ready",
                link=row["affiliate_url"],
                product=_short(estimate.name),
                price=_vnd(estimate.price),
                commission=_vnd(estimate.commission),
                shopee_rate=_pct(estimate.shopee_rate),
                shopee_part=_vnd(estimate.shopee_part),
                seller_rate=_pct(estimate.seller_rate),
                seller_part=_vnd(estimate.seller_part),
                cap_tag=cap_tag,
                cap_line=cap_line,
                cashback=_vnd(estimate.cashback(cashback_rate)),
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
        try:
            bot.send(row["private_chat_id"], text)
        except Exception as exc:  # a bad chat id must not stall the queue
            log.info(f"could not deliver {row['request_id']}: {exc}")
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


def _announce_transfers(db_path: Path, bot: ZaloBot, rows: list) -> int:
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
        chat_id = paid[0]["private_chat_id"]
        total = sum(r["cashback_amount"] or 0 for r in paid)
        bank = ""
        if paid[0]["bank_account"]:
            bank = (f'{paid[0]["bank_name"]} - {paid[0]["bank_account"]} - '
                    f'{paid[0]["account_holder"]}')
        text = messages.render(
            "order_paid" if bank else "order_paid_no_bank",
            amount=_vnd(total), count=len(paid), bank=bank,
            reference=f"Hoan tien Shopee {customer_id}")
        try:
            bot.send(chat_id, text)
        except Exception as exc:
            log.info(f"could not tell {customer_id} about the transfer: {exc}")
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
    db_path: Path, bot: ZaloBot, cashback_rate: float, payout_window: str,
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
            " c.private_chat_id, c.bank_name, c.bank_account, c.account_holder,"
            # An order code means nothing to the person who sent a link.
            # The product name and the link they used are what let them
            # recognise their own order.
            " r.affiliate_url, r.source_url, r.estimate_detail"
            " FROM orders o JOIN customers c ON c.customer_id = o.customer_id"
            " LEFT JOIN link_requests r ON r.request_id = o.request_id"
            " WHERE c.private_chat_id IS NOT NULL AND c.private_chat_id != ''"
            "   AND (o.notified_status IS NULL OR o.notified_status != o.status)"
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
            text = messages.render(
                "order_recorded",
                order_id=row["order_id"],
                identity=identity,
                cashback=_vnd(round_dong((estimate or 0) * cashback_rate))
                if estimate else messages.render("cashback_unknown"),
                days=payout_window,
            )
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

        try:
            bot.send(row["private_chat_id"], text)
        except Exception as exc:  # one bad chat id must not stall the rest
            log.info(f"could not notify {row['order_id']}: {exc}")
            continue

        with ledger.connect(db_path) as conn:
            conn.execute(
                "UPDATE orders SET notified_status=? WHERE order_id=?",
                (status, row["order_id"]),
            )
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


def notify_failed_links(db_path: Path, bot: ZaloBot) -> int:
    """Apologise for links that could not be made. Returns messages sent.

    A request only reaches this state after MAX_LINK_ATTEMPTS, so this is
    not a hiccup: the browser genuinely cannot convert that product. Saying
    so beats a customer waiting all evening for a link that is never coming.
    """
    with ledger.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT r.request_id, c.private_chat_id"
            " FROM link_requests r JOIN customers c"
            "   ON c.customer_id = r.customer_id"
            " WHERE r.status='failed' AND r.notified_at IS NULL"
            "   AND c.private_chat_id IS NOT NULL AND c.private_chat_id != ''"
            " ORDER BY r.created_at"
        ).fetchall()

    sent = 0
    for row in rows:
        try:
            bot.send(row["private_chat_id"], messages.render("link_failed"))
        except Exception as exc:
            log.info(f"could not apologise for {row['request_id']}: {exc}")
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
