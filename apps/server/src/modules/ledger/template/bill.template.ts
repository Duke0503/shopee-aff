import { formatVnd, render, type Messages } from "../../../notifications/messages";
import { escapeHtml } from "../../../shared/html";
import type { BillOrderLine, BillView } from "../application/bill.use-case";

/**
 * The bill page itself. Layout only: every word comes from
 * `resources/messages.vi.json` through `render`, and every value that came
 * from the database is escaped on the way in.
 */

const STYLE = [
  "*{box-sizing:border-box}",
  "body{margin:0;padding:16px;background:#090d16;color:#f1f5f9;",
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
  ".card{max-width:560px;margin:0 auto;background:#131b2e;border:1px solid #1e293b;",
  "border-radius:18px;padding:26px 20px;box-shadow:0 10px 25px rgba(0,0,0,.5)}",
  ".ok{color:#34d399;font-weight:800;font-size:16px;text-align:center;margin:0 0 4px}",
  ".brand{color:#64748b;font-size:12px;text-align:center;margin:0 0 18px}",
  ".row{padding:9px 0;border-top:1px solid #1e293b;font-size:14px;color:#e2e8f0}",
  ".orders-title{margin:20px 0 8px;font-size:14px;font-weight:800;color:#e2e8f0}",
  ".badge{background:#3b2f0b;border:1px solid #a16207;color:#fbbf24;border-radius:10px;",
  "padding:9px 12px;font-size:13px;font-weight:700;margin-bottom:10px}",
  ".order{display:flex;justify-content:space-between;gap:12px;padding:11px 0;",
  "border-top:1px solid #1e293b}",
  ".order-name{font-size:14px;font-weight:700}",
  ".order-meta{font-size:12px;color:#64748b;margin-top:3px}",
  ".order-bonus{font-size:12px;color:#fbbf24;margin-top:3px}",
  ".amount{font-size:14px;font-weight:800;color:#34d399;text-align:right}",
  ".base{font-size:12px;color:#64748b;text-align:right;margin-top:3px}",
  ".proof{margin-top:20px;padding-top:14px;border-top:1px solid #1e293b;font-size:13px;color:#94a3b8}",
  ".proof a{color:#38bdf8;font-weight:700;text-decoration:none}",
  ".note{margin-top:18px;text-align:center;font-size:12px;color:#475569}",
];
const STYLE_TAG = `<style>${STYLE.join("")}</style>`;

function page(title: string, body: string): string {
  return [
    "<!doctype html>",
    '<html lang="vi"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    STYLE_TAG,
    "</head><body>",
    body,
    "</body></html>",
  ].join("");
}

function orderRow(messages: Messages, line: BillOrderLine): string {
  const name = line.productName || render(messages, "bill_unknown_product", { order_id: line.orderId });
  const bonus =
    line.bonusVnd > 0
      ? `<div class="order-bonus">${render(messages, "bill_order_bonus", {
          bonus: formatVnd(messages, line.bonusVnd),
          campaign: line.bonusCampaign,
        })}</div>`
      : "";
  return [
    '<div class="order"><div>',
    `<div class="order-name">${escapeHtml(name)}</div>`,
    `<div class="order-meta">${render(messages, "bill_order_code", { order_id: line.orderId })}</div>`,
    bonus,
    "</div><div>",
    `<div class="amount">${formatVnd(messages, line.cashbackVnd + line.bonusVnd)}</div>`,
    `<div class="base">${render(messages, "bill_order_base", {
      cashback: formatVnd(messages, line.cashbackVnd),
    })}</div>`,
    "</div></div>",
  ].join("");
}

function proofBlock(messages: Messages, bill: BillView): string {
  if (!bill.hasProof) {
    return `<div class="proof">${render(messages, "bill_proof_none")}</div>`;
  }
  const href = `/api/proofs/${encodeURIComponent(bill.billToken)}`;
  return [
    '<div class="proof">',
    `<div>${render(messages, "bill_proof_title")}</div>`,
    `<div>${render(messages, "bill_proof_locked")}</div>`,
    `<a href="${escapeHtml(href)}">${render(messages, "bill_proof_link")}</a>`,
    "</div>",
  ].join("");
}

export function renderBill(messages: Messages, bill: BillView): string {
  const rows = [
    render(messages, "bill_customer_line", {
      name: escapeHtml(bill.customerName),
      code: escapeHtml(bill.customerCode),
    }),
    render(messages, "bill_received_line", { total: formatVnd(messages, bill.receivedVnd) }),
    render(messages, "bill_amount_line", { amount: formatVnd(messages, bill.amountVnd) }),
    render(messages, "bill_date_line", { date: escapeHtml(bill.paidAt) }),
    render(messages, "bill_reference_line", { reference: escapeHtml(bill.reference) }),
  ];
  if (bill.bankLabel !== "") {
    rows.push(render(messages, "bill_bank_line", { bank: escapeHtml(bill.bankLabel) }));
  }

  const badge =
    bill.bonusVnd > 0
      ? `<div class="badge">${render(messages, "bill_bonus_badge", {
          bonus: formatVnd(messages, bill.bonusVnd),
          campaigns: bill.bonusCampaigns.join(", "),
        })}</div>`
      : "";

  return page(
    render(messages, "bill_title", { reference: bill.reference }),
    [
      '<main class="card">',
      `<p class="ok">${render(messages, "bill_status")}</p>`,
      `<p class="brand">${render(messages, "bill_brand")}</p>`,
      rows.map((row) => `<div class="row">${row}</div>`).join(""),
      `<div class="orders-title">${render(messages, "bill_orders_title", {
        count: bill.orderLines.length,
      })}</div>`,
      badge,
      bill.orderLines.map((line) => orderRow(messages, line)).join(""),
      proofBlock(messages, bill),
      `<div class="note">${render(messages, "bill_verified")}</div>`,
      "</main>",
    ].join(""),
  );
}

function notice(messages: Messages, tone: string, titleKey: string, bodyKey: string, linkKey: string) {
  const title = render(messages, titleKey);
  return page(
    title,
    [
      '<main class="card">',
      `<p class="ok" style="color:${tone}">${title}</p>`,
      `<p class="brand" style="font-size:14px">${render(messages, bodyKey)}</p>`,
      `<p class="note"><a href="/" style="color:#34d399;font-weight:700;text-decoration:none">${render(
        messages,
        linkKey,
      )}</a></p>`,
      "</main>",
    ].join(""),
  );
}

/** An unknown token, or a bill that is not there: nothing to show. */
export function renderBillNotFound(messages: Messages): string {
  return notice(
    messages,
    "#f87171",
    "bill_not_found_title",
    "bill_not_found_body",
    "bill_not_found_link",
  );
}

/** An old numbered link: the bill is not gone, it just needs a signed-in owner. */
export function renderBillSignIn(messages: Messages): string {
  return notice(messages, "#38bdf8", "bill_sign_in_title", "bill_sign_in_body", "bill_sign_in_link");
}
