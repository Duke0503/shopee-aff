"""The end-of-day page: who to pay, scan, done.

Answers one question -- "what do I owe tonight?" -- without the operator
opening a database, a terminal, and a banking app in three windows and
copying an account number between them.

For each customer who has cleared the threshold it shows the amount, a
VietQR carrying bank, account, amount and reference already filled in,
and the orders behind the figure with their affiliate links, so the
figure can be checked against Shopee before any money moves.

For a customer with no bank details on file there is a button: the bot
messages them privately and asks. That is the only way to ask without it
reading as a scam, because by then there is real money waiting.

LOOPBACK ONLY
-------------
This page prints bank account numbers and what each person is owed. It
binds to 127.0.0.1 and nothing else. Do not make it reachable; there is
no authentication here because there is no network here.
"""

from __future__ import annotations

import html
import json
import re
import threading
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ..core.config import PROJECT_ROOT, Config
from ..ledger import payouts
from ..ledger import repository as ledger

LABELS_FILE = Path("resources") / "dashboard.vi.json"
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


def vnd(amount: int | None) -> str:
    return "-" if amount is None else f"{round(amount):,}".replace(",", ".") + "d"


def esc(text) -> str:
    return html.escape(str(text or ""))


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
        "       r.source_url, r.affiliate_url"
        "  FROM orders o"
        "  LEFT JOIN link_requests r ON r.request_id = o.request_id"
        " WHERE o.customer_id = ? AND o.status = 'approved' AND o.paid_at IS NULL"
        " ORDER BY o.approved_at",
        (customer_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def _pipeline(conn) -> list[dict]:
    """Orders Shopee has recorded but not yet settled.

    Nothing here is payable, and the page must say so. But a page that
    shows only what is payable is blank on most days, which reads as
    "nothing is happening" when in fact several orders are in flight.
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
        item["product"] = _product_name(row["estimate_detail"])
        out.append(item)
    return out


def _product_name(detail: str | None) -> str:
    if not detail:
        return ""
    from ..shopee.commission import Estimate

    estimate = Estimate.from_json(detail)
    return estimate.name if estimate else ""


def snapshot(db_path: Path) -> dict:
    """Everything the page needs, in one read."""
    with ledger.connect(db_path) as conn:
        owed = payouts.collect(conn)
        detail = {p.customer_id: _orders_of(conn, p.customer_id) for p in owed}
        pipeline = _pipeline(conn)
    ready, waiting = payouts.split_by_threshold(owed)
    no_bank = [p for p in waiting if not p.has_bank_details]
    short = [p for p in waiting if p.has_bank_details]
    return {
        "ready": ready,
        "short": short,
        "no_bank": no_bank,
        "orders": detail,
        "pipeline": pipeline,
        "pipeline_total": sum(r["estimated_commission"] or 0 for r in pipeline),
        "total": sum(p.amount for p in owed),
    }


# ----------------------------------------------------------------------
# Rendering
# ----------------------------------------------------------------------

STYLE = """
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;margin:0;
     padding:24px;background:#f5f6f8;color:#16181d}
h1{font-size:21px;margin:0 0 2px}
.sub{color:#6b7280;margin:0 0 22px;font-size:13px}
.tiles{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
       margin-bottom:28px}
.tile{background:#fff;border:1px solid #e4e6ea;border-radius:10px;padding:14px}
.tile b{display:block;font-size:22px;line-height:1.2}
.tile span{color:#6b7280;font-size:12px}
h2{font-size:14px;letter-spacing:.04em;margin:28px 0 2px}
.hint{color:#6b7280;font-size:12px;margin:0 0 12px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}
.card{background:#fff;border:1px solid #e4e6ea;border-radius:12px;padding:16px}
.who{font-weight:600}
.amt{font-size:26px;font-weight:700;margin:6px 0 10px}
.qr{width:100%;max-width:210px;display:block;margin:0 auto 10px;border-radius:8px}
.bank{font-size:13px;color:#4b5563}
code{background:#f1f2f4;padding:1px 6px;border-radius:4px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
td{padding:4px 0;border-top:1px solid #eef0f2;vertical-align:top}
td:last-child{text-align:right;white-space:nowrap}
a{color:#0b63d6}
button{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;
       border:1px solid #0b63d6;background:#0b63d6;color:#fff;cursor:pointer}
button.ghost{background:#fff;color:#0b63d6}
button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:8px;margin-top:12px}
.warn{background:#fff7e6;border:1px solid #f0d8a8;color:#6b4e00;
      border-radius:8px;padding:10px;font-size:12px;margin:8px 0}
.empty{color:#6b7280;font-size:13px}
.flash{position:fixed;left:50%;transform:translateX(-50%);bottom:24px;
       background:#16181d;color:#fff;padding:10px 18px;border-radius:999px;
       font-size:13px;display:none}
"""

SCRIPT = """
async function post(url, button, doneLabel) {
  button.disabled = true;
  try {
    const r = await fetch(url, {method: 'POST'});
    const b = await r.json();
    flash(b.message || '');
    if (b.ok) { button.textContent = doneLabel; setTimeout(() => location.reload(), 900); }
    else { button.disabled = false; }
  } catch (e) { flash(String(e)); button.disabled = false; }
}
function flash(text) {
  const el = document.getElementById('flash');
  el.textContent = text; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}
"""


def _orders_table(orders: list[dict]) -> str:
    rows = []
    for order in orders:
        link = order.get("affiliate_url") or order.get("source_url") or ""
        anchor = (f'<a href="{esc(link)}" target="_blank" rel="noreferrer">'
                  f'{esc(t("btn_open_order"))}</a>') if link else ""
        rows.append(
            "<tr>"
            f"<td><code>{esc(order['order_id'])}</code><br>{anchor}</td>"
            f"<td>{esc(t('order_commission'))} {vnd(order['approved_commission'])}"
            f"<br><b>{esc(t('order_cashback'))} {vnd(order['cashback_amount'])}</b></td>"
            "</tr>"
        )
    return f"<table>{''.join(rows)}</table>" if rows else ""


def _ready_card(entry, orders: list[dict]) -> str:
    qr = entry.qr_url()
    if qr:
        visual = f'<img class=qr src="{esc(qr)}" alt="QR">'
    else:
        visual = f'<div class=warn>{esc(t("no_qr_warning", bank=entry.bank_name))}</div>'
    ids = ",".join(entry.order_ids)
    return (
        "<div class=card>"
        f"<div class=who>{esc(entry.display_name or entry.customer_id)}</div>"
        f"<div class=amt>{vnd(entry.amount)}</div>"
        f"{visual}"
        f"<div class=bank>{esc(entry.bank_name)} &middot; {esc(entry.bank_account)}"
        f"<br>{esc(entry.account_holder)}"
        f"<br><code>{esc(entry.reference)}</code></div>"
        f"{_orders_table(orders)}"
        "<div class=row>"
        f"<button onclick=\"post('/paid/{esc(entry.customer_id)}?orders={esc(ids)}',"
        f"this,'{esc(t('btn_paid'))}')\">{esc(t('btn_paid'))}</button>"
        "</div>"
        "</div>"
    )


def _short_card(entry, orders: list[dict]) -> str:
    missing = payouts.MIN_PAYOUT_VND - entry.amount
    return (
        "<div class=card>"
        f"<div class=who>{esc(entry.display_name or entry.customer_id)}</div>"
        f"<div class=amt>{vnd(entry.amount)}</div>"
        f"<div class=bank>{esc(t('col_short', amount=vnd(missing)))}"
        f"<br>{esc(entry.bank_name)} &middot; {esc(entry.bank_account)}</div>"
        f"{_orders_table(orders)}"
        "</div>"
    )


def _no_bank_card(entry, orders: list[dict]) -> str:
    return (
        "<div class=card>"
        f"<div class=who>{esc(entry.display_name or entry.customer_id)}</div>"
        f"<div class=amt>{vnd(entry.amount)}</div>"
        f"{_orders_table(orders)}"
        "<div class=row>"
        f"<button onclick=\"post('/ask-bank/{esc(entry.customer_id)}',this,"
        f"'{esc(t('btn_asked'))}')\">{esc(t('btn_ask_bank'))}</button>"
        "</div>"
        "</div>"
    )


def _pipeline_card(row: dict, rate: float) -> str:
    estimate = row.get("estimated_commission") or 0
    link = row.get("affiliate_url") or row.get("source_url") or ""
    anchor = (f'<a href="{esc(link)}" target="_blank" rel="noreferrer">'
              f'{esc(t("btn_open_order"))}</a>') if link else ""
    return (
        "<div class=card>"
        f"<div class=who>{esc(row.get('display_name') or row.get('customer_id'))}</div>"
        f"<div class=amt>{vnd(round(estimate * rate))}</div>"
        f"<div class=bank>{esc(row.get('product') or '')}"
        f"<br>{esc(t('order_value'))} {vnd(row.get('order_value'))}"
        f" &middot; {esc(t('order_commission'))} {vnd(estimate)}</div>"
        f"<table><tr><td><code>{esc(row['order_id'])}</code><br>{anchor}</td>"
        f"<td>{esc(row.get('recorded_at') or '')[:10]}</td></tr></table>"
        "</div>"
    )


def render(data: dict, rate: float = 0.70) -> str:
    ready, short, no_bank = data["ready"], data["short"], data["no_bank"]
    orders = data["orders"]

    def section(title, hint, entries, card) -> str:
        if not entries:
            return ""
        cards = "".join(card(e, orders.get(e.customer_id, [])) for e in entries)
        return (f"<h2>{esc(title)}</h2><p class=hint>{esc(hint)}</p>"
                f"<div class=grid>{cards}</div>")

    pipeline = data.get("pipeline") or []
    pipeline_html = ""
    if pipeline:
        cards = "".join(_pipeline_card(r, rate) for r in pipeline)
        pipeline_html = (
            f"<h2>{esc(t('section_pipeline'))}</h2>"
            f"<p class=hint>{esc(t('section_pipeline_hint'))}</p>"
            f"<div class=grid>{cards}</div>")

    body = (
        section(t("section_ready"), t("section_ready_hint"), ready, _ready_card)
        + section(t("section_no_bank"), t("section_no_bank_hint"),
                  no_bank, _no_bank_card)
        + section(t("section_waiting", threshold=vnd(payouts.MIN_PAYOUT_VND)),
                  t("section_waiting_hint"), short, _short_card)
        + pipeline_html
    )
    if not body:
        body = f"<p class=empty>{esc(t('nothing_at_all'))}</p>"

    return (
        "<!doctype html><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        f"<title>{esc(t('title'))}</title><style>{STYLE}</style>"
        f"<h1>{esc(t('title'))}</h1>"
        f"<p class=sub>{esc(t('subtitle', time=datetime.now().strftime('%H:%M %d/%m/%Y')))}</p>"
        "<div class=tiles>"
        f"<div class=tile><b>{len(ready)}</b><span>{esc(t('summary_ready'))}</span></div>"
        f"<div class=tile><b>{len(short)}</b><span>{esc(t('summary_waiting'))}</span></div>"
        f"<div class=tile><b>{len(no_bank)}</b><span>{esc(t('summary_no_bank'))}</span></div>"
        f"<div class=tile><b>{len(data.get('pipeline') or [])}</b>"
        f"<span>{esc(t('summary_pipeline'))}</span></div>"
        f"<div class=tile><b>{vnd(data['total'])}</b>"
        f"<span>{esc(t('summary_total'))}</span></div>"
        "</div>"
        f"{body}"
        "<div id=flash class=flash></div>"
        f"<script>{SCRIPT}</script>"
    )


# ----------------------------------------------------------------------
# Actions
# ----------------------------------------------------------------------

SAFE_ID = re.compile(r"^[A-Za-z0-9]+$")


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

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path != "/":
            return self._send(404, b"not found", "text/plain")
        page = render(snapshot(self.cfg.db_path),
                      rate=self.cfg.advertised_cashback_rate)
        self._send(200, page.encode("utf-8"), "text/html; charset=utf-8")

    def do_POST(self):
        raw, _, query = self.path.partition("?")
        parts = raw.strip("/").split("/")
        params = urllib.parse.parse_qs(query)

        if len(parts) == 2 and parts[0] == "ask-bank":
            result = ask_for_bank(self.cfg, parts[1])
        elif len(parts) == 2 and parts[0] == "paid":
            ids = (params.get("orders", [""])[0] or "").split(",")
            result = mark_paid(self.cfg, parts[1], [i for i in ids if i])
        else:
            result = {"ok": False, "message": "unknown action"}

        self._send(200, json.dumps(result, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")


def serve(cfg: Config, port: int = 8899) -> None:
    handler = type("DashboardHandler", (_Handler,), {"cfg": cfg})
    # Loopback only. This page shows bank account numbers.
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
