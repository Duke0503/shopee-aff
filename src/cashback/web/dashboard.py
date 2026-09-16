"""The payout console: JSON for the browser, and the two actions on it.

This module used to render HTML from Python. It now serves data, and
serves the built React app, and knows nothing about how either looks.
The split matters for a reason beyond tidiness: a customer-facing view
is coming, and it has to read the same ledger through the same code.
Two views over one set of dicts is fine; two views over two hand-written
HTML builders is how they start disagreeing about what someone is owed.

WHAT IS AND IS NOT PAYABLE
--------------------------
Everything approved and unpaid is payable, grouped by customer. There is
no minimum -- see ledger.payouts for why the old 50,000 VND one went.
Orders Shopee has not settled are listed separately and never counted as
owed; those figures are estimates twice over and every view says so.

The two actions are not conveniences. One sends a real message to a real
person, the other records that money left the account. Both refuse an id
that is not plainly alphanumeric, and mark_paid refuses an order that
already has a paid_at, so a double click cannot pay twice.

LOOPBACK ONLY
-------------
This serves bank account numbers and what each person is owed. It binds
to 127.0.0.1 and nothing else. There is no authentication here because
there is no network here -- exposing it needs auth written first.
"""

from __future__ import annotations

import json
import mimetypes
import re
import threading
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ..core.config import PROJECT_ROOT, Config
from ..core.policy import round_dong
from ..ledger import payouts
from ..ledger import repository as ledger

LABELS_FILE = Path("resources") / "dashboard.vi.json"
STATIC_DIR = Path(__file__).resolve().parent / "static"

# Ids this system issues are alphanumeric. Anything else arriving on an
# action route is not a typo, it is an attempt.
SAFE_ID = re.compile(r"^[A-Za-z0-9]+$")

_labels: dict[str, str] | None = None


def labels() -> dict[str, str]:
    global _labels
    if _labels is None:
        raw = json.loads((PROJECT_ROOT / LABELS_FILE).read_text(encoding="utf-8"))
        _labels = {k: v for k, v in raw.items() if not k.startswith("_")}
    return _labels


def t(key: str, **values) -> str:
    """One label, with {placeholders} filled in."""
    text = labels().get(key, key)
    for name, value in values.items():
        text = text.replace("{" + name + "}", str(value))
    return text


# ----------------------------------------------------------------------
# Reading
# ----------------------------------------------------------------------

def _orders_of(conn, customer_id: str) -> list[dict]:
    """The approved, unpaid orders behind one customer's balance.

    Each carries the link it came from, so the operator can open the
    affiliate URL and check the order against Shopee before paying.
    """
    rows = conn.execute(
        "SELECT o.order_id, o.order_value, o.approved_commission,"
        "       o.cashback_amount, o.approved_at,"
        "       r.source_url, r.affiliate_url, r.estimate_detail"
        "  FROM orders o"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.customer_id = ? AND o.status = 'approved' AND o.paid_at IS NULL"
        " ORDER BY o.approved_at",
        (customer_id,),
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["product"] = _product_name(item.pop("estimate_detail", None))
        out.append(item)
    return out


def _pipeline(conn, rate: float) -> list[dict]:
    """Orders Shopee has recorded but not yet settled.

    Nothing here is payable, and every view must say so. But a console
    showing only what is payable is blank on most days, which reads as
    "nothing is happening" when several orders are in flight.
    """
    rows = conn.execute(
        "SELECT o.order_id, o.customer_id, o.order_value,"
        "       o.estimated_commission, o.recorded_at,"
        "       c.display_name, r.affiliate_url, r.source_url, r.estimate_detail"
        "  FROM orders o"
        "  LEFT JOIN customers c ON c.customer_id = o.customer_id"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.status = 'awaiting_approval'"
        " ORDER BY o.recorded_at DESC"
    ).fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["product"] = _product_name(item.pop("estimate_detail", None))
        item["cashback"] = round_dong((item["estimated_commission"] or 0) * rate)
        out.append(item)
    return out


def _product_name(detail: str | None) -> str:
    if not detail:
        return ""
    from ..shopee.commission import Estimate

    estimate = Estimate.from_json(detail)
    return estimate.name if estimate else ""


def _payable_json(entry, orders: list[dict]) -> dict:
    return {
        "customer_id": entry.customer_id,
        "display_name": entry.display_name,
        "amount": entry.amount,
        "bank_name": entry.bank_name,
        "bank_account": entry.bank_account,
        "account_holder": entry.account_holder,
        "has_bank": entry.has_bank_details,
        "reference": entry.reference,
        # None when the written bank name matched no bank, or more than
        # one. The view then shows the raw details and says to transfer
        # by hand; a guess here sends money to a stranger.
        "qr_url": entry.qr_url(),
        "order_ids": list(entry.order_ids),
        "orders": orders,
    }


def snapshot(db_path: Path, rate: float = 0.80) -> dict:
    """Everything either view needs, in one read, as plain JSON."""
    with ledger.connect(db_path) as conn:
        owed = payouts.collect(conn)
        detail = {p.customer_id: _orders_of(conn, p.customer_id) for p in owed}
        pipeline = _pipeline(conn, rate)

    ready, blocked = payouts.split_by_bank_details(owed)
    pipeline_commission = sum(r["estimated_commission"] or 0 for r in pipeline)
    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "rate": rate,
        "ready": [_payable_json(p, detail[p.customer_id]) for p in ready],
        "no_bank": [_payable_json(p, detail[p.customer_id]) for p in blocked],
        "pipeline": pipeline,
        "totals": {
            "owed": sum(p.amount for p in owed),
            "owed_customers": len(owed),
            "ready": sum(p.amount for p in ready),
            "no_bank": sum(p.amount for p in blocked),
            "pipeline": round_dong(pipeline_commission * rate),
            "pipeline_orders": len(pipeline),
        },
    }


# ----------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------

def ask_for_bank(cfg: Config, customer_id: str) -> dict:
    """Have the bot ask this customer for their account, privately.

    Only reachable for someone who already has approved money waiting,
    which is the only moment the question is reasonable.
    """
    from ..messaging import templates as messages
    from ..messaging.zalo_client import ZaloBot, ZaloError

    if not SAFE_ID.match(customer_id or ""):
        return {"ok": False, "message": t("ask_failed", reason="bad id")}

    with ledger.connect(cfg.db_path) as conn:
        row = ledger.get_customer(conn, customer_id)
    if row is None or not row["private_chat_id"]:
        return {"ok": False, "message": t("ask_failed", reason="no private chat")}

    try:
        with ZaloBot(cfg.zalo_bot_token, cfg.zalo_api_url) as bot:
            bot.send(row["private_chat_id"], messages.render("need_bank"))
    except (ZaloError, Exception) as exc:
        return {"ok": False, "message": t("ask_failed", reason=str(exc)[:120])}

    return {"ok": True,
            "message": t("ask_sent", name=row["display_name"] or customer_id)}


def mark_paid(cfg: Config, customer_id: str, order_ids: list[str]) -> dict:
    """Record a transfer that already happened in the banking app.

    Every order in the balance is marked together, because the operator
    made one transfer for the lot. mark_paid refuses anything already
    paid, so a double click cannot pay twice.
    """
    if not SAFE_ID.match(customer_id or ""):
        return {"ok": False, "message": t("paid_failed", reason="bad id")}

    done = 0
    with ledger.connect(cfg.db_path) as conn:
        row = ledger.get_customer(conn, customer_id)
        for order_id in order_ids:
            if not SAFE_ID.match(order_id):
                continue
            if ledger.mark_paid(conn, order_id, note="dashboard"):
                done += 1
    if not done:
        return {"ok": False, "message": t("paid_failed", reason="nothing to mark")}
    name = (row["display_name"] if row else "") or customer_id
    return {"ok": True, "message": t("paid_done", name=name)}


# ----------------------------------------------------------------------
# Serving
# ----------------------------------------------------------------------

_MISSING_BUILD = (
    "<!doctype html><meta charset=utf-8><title>Giao dien chua build</title>"
    "<body style=\"font:15px/1.6 system-ui;padding:40px;max-width:640px\">"
    "<h1 style=\"font-size:19px\">Giao dien chua duoc build</h1>"
    "<p>Chay mot lan:</p>"
    "<pre style=\"background:#f1f2f4;padding:12px;border-radius:8px\">"
    "cd web\nnpm install\nnpm run build</pre>"
    "<p>API van chay: <a href=\"/api/payouts\">/api/payouts</a></p>"
)


class _Handler(BaseHTTPRequestHandler):
    cfg: Config

    def log_message(self, fmt, *args):
        return

    def _send(self, status: int, body: bytes, content_type: str):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass

    def _json(self, payload: dict, status: int = 200):
        self._send(status,
                   json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    # -- GET ------------------------------------------------------------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/payouts":
            return self._json(
                snapshot(self.cfg.db_path, self.cfg.advertised_cashback_rate))
        if path == "/api/labels":
            return self._json(labels())
        if path.startswith("/api/"):
            return self._json({"ok": False, "message": "unknown endpoint"}, 404)

        return self._serve_static(path)

    def _serve_static(self, path: str):
        """The built app, with unknown paths falling back to index.

        A single-page app owns its own routing, so a deep link has to
        return index.html rather than 404.
        """
        index = STATIC_DIR / "index.html"
        if not index.exists():
            return self._send(200, _MISSING_BUILD.encode("utf-8"),
                              "text/html; charset=utf-8")

        target = index
        if path not in ("/", "", "/index.html"):
            # Resolve inside STATIC_DIR or not at all. A path that climbs
            # out with .. is how a local server serves the rest of the disk.
            candidate = (STATIC_DIR / path.lstrip("/")).resolve()
            try:
                candidate.relative_to(STATIC_DIR.resolve())
            except ValueError:
                candidate = index
            if candidate.is_file():
                target = candidate

        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind == "application/javascript":
            kind += "; charset=utf-8"
        self._send(200, target.read_bytes(), kind)

    # -- POST -----------------------------------------------------------
    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        parts = path.strip("/").split("/")

        # /api/customers/<id>/paid  and  /api/customers/<id>/ask-bank
        if len(parts) == 4 and parts[:2] == ["api", "customers"]:
            customer_id, action = parts[2], parts[3]
            if action == "ask-bank":
                return self._json(ask_for_bank(self.cfg, customer_id))
            if action == "paid":
                ids = self._body().get("order_ids")
                if not isinstance(ids, list):
                    return self._json({"ok": False, "message": "bad body"}, 400)
                return self._json(
                    mark_paid(self.cfg, customer_id, [str(i) for i in ids]))
        return self._json({"ok": False, "message": "unknown action"}, 404)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if not length:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8")) or {}
        except (ValueError, TypeError, UnicodeDecodeError):
            return {}


def serve(cfg: Config, port: int = 8899) -> None:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    # Loopback only. This serves bank account numbers.
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print(f"Dashboard on http://127.0.0.1:{port}")
    print("Loopback only -- it shows bank details. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def serve_in_background(cfg: Config, port: int = 8899) -> ThreadingHTTPServer:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
