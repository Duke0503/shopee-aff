"""Short links on our own domain that lead to an affiliate link.

WHY THIS EXISTS
---------------
An affiliate link tapped inside Zalo is opened by Zalo's in-app browser,
and from there the purchase is no longer credited to us: the click and the
Shopee app never meet. A link on our own domain is not recognised by Zalo
as a Shopee link, so the customer lands on our page first, and the page
gets them out of the in-app browser before sending them on (see
web/share_page.py). From a real browser it is a plain redirect.

WHAT A CODE POINTS AT
---------------------
One code per link request, so the one-link-one-customer rule holds: the
code leads to the affiliate link made for that customer and nobody else.
Codes are random rather than derived from the request id, which is a date
plus five digits and could be walked to list what other people asked for.
"""

from __future__ import annotations

import secrets
import sqlite3
import string

from . import repository as ledger

CODE_LENGTH = 8
_ALPHABET = string.ascii_letters + string.digits

AGENT_BROWSER, AGENT_IN_APP, AGENT_BOT = "browser", "in_app", "bot"
# Not an agent: the buy button was tapped (/s/<code>/go).
BUY = "buy"


def code_for(conn: sqlite3.Connection, request_id: str) -> str | None:
    """The request's code, made on first use. None for an unknown request."""
    row = conn.execute("SELECT share_code FROM link_requests WHERE request_id=?",
                       (request_id,)).fetchone()
    if row is None:
        return None
    if row["share_code"]:
        return row["share_code"]
    while True:
        code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
        try:
            conn.execute("UPDATE link_requests SET share_code=? WHERE request_id=?"
                         " AND share_code IS NULL", (code, request_id))
        except sqlite3.IntegrityError:
            continue  # taken by another request: draw again
        # Another writer may have set one first; theirs stands.
        return conn.execute("SELECT share_code FROM link_requests WHERE request_id=?",
                            (request_id,)).fetchone()["share_code"]


def url_for(conn: sqlite3.Connection, base_url: str, request_id: str) -> str | None:
    """The address to hand out, or None when sharing is off (no base URL)."""
    if not base_url:
        return None
    code = code_for(conn, request_id)
    return f"{base_url.rstrip('/')}/s/{code}" if code else None


def find(conn: sqlite3.Connection, code: str) -> sqlite3.Row | None:
    """The request behind a code, if it has a link to go to."""
    if not code or len(code) != CODE_LENGTH or not code.isalnum():
        return None
    return conn.execute(
        "SELECT r.request_id, r.customer_id, r.source_url, r.affiliate_url,"
        "       r.estimate_detail, r.platform"
        "  FROM link_requests r WHERE r.share_code=?"
        "   AND r.affiliate_url IS NOT NULL AND r.affiliate_url != ''",
        (code,)).fetchone()


def record_click(conn: sqlite3.Connection, request_id: str, agent: str) -> None:
    """A person opened the link. Previews fetched by bots are not clicks."""
    if agent == AGENT_BOT:
        return
    conn.execute("INSERT INTO link_clicks (request_id, clicked_at, agent)"
                 " VALUES (?, ?, ?)", (request_id, ledger.now(), agent))
