# Admin dashboard (Overview) specification

Owner: Operations Lead. Agreed in the party session of 2026-10-30
(`.context/discussions/design/2026-10-30-dashboard-party.md`). The Overview answers four questions,
in this order: how much did we make, where is the money, how are orders doing, was the event worth
it. Anything that answers none of them is not on this screen.

## Period and time bases

- One period picker at the top: Hôm nay, 7 ngày, Tháng này (default), Tháng trước, Tuỳ chọn. Every
  period figure compares with the previous period of the same length.
- Three time bases, named under every block, all in Vietnam days (D28):
  - **Business result:** by the day the network approved the order (`approved_at`).
  - **Cash:** by the day the network paid us (settlement) and the day we paid the customer (payout).
  - **Orders and funnel:** by the day the order was recorded (`recorded_at`).
- "Money position" figures are point-in-time (now), not period figures, and say so.

## Block 1 · To do (point-in-time)

| Tile | Definition | Opens |
|---|---|---|
| Cần chuyển tiền | Customers with a payable balance > 0, and the total | Payouts, tab "Chuyển được" |
| Review chờ xử lý | Open review cases | Review |
| Tạo link lỗi hôm nay | Link requests FAILED today | Link requests, filter FAILED, today |
| Thiếu STK mà còn tiền | Customers owed money without a usable bank account | Payouts, tab "Cần xử lý" |

## Block 2 · Business result (period, by approval day)

The largest figure on the screen is **Lợi nhuận của mình**.

| Line | Formula (all from stored amounts) |
|---|---|
| Hoa hồng sàn đã duyệt | Sum of `approved_commission` of orders approved in the period, with the order count; split per network |
| Phí sàn | Sum of stored `cashback_fee` |
| Thuế sàn khấu trừ | Sum of stored `cashback_tax`, with the note which periods were withheld |
| Hoàn cho khách | Sum of stored `cashback` (80% of net); note how much of it is already paid and how much is still owed |
| Thưởng event | Sum of bonuses of CONFIRMED and PAID awards on orders approved in the period, per campaign |
| Clawback thu về | Sum of clawback entries netted in the period (reduces cashback cost) |
| **Lợi nhuận của mình** | Commission − fee − tax − cashback − event bonus + clawback netted |
| Biên lợi nhuận | Profit ÷ commission (computed in `packages/money`) |

**Orders imported at cutover (owner decision, 2026-10-31).** The live system stored no approved
commission and no approval day, so imported orders cannot be placed by approval day. When the
period holds such orders, or money moved for them, their part is read on the cash basis: what the
networks paid in the period in batches imported at cutover, minus the imported payouts recorded in
the period (bonuses paid are inside those transfers). The profit card then shows the total on top
and both parts labelled: "Theo ngày duyệt (đơn mới)" and "Theo tiền thực (đơn từ hệ thống cũ)",
the cash part with what it is made of. Margin and the split bar stay on the approval basis.

Guest (HOUSE) orders count in commission and profit, never in cashback. REVERSED, REJECTED and FROZEN
orders are in no line. The operator's own income tax on the commission is outside this block and is
named as such in a footnote.

## Block 3 · Money position (now)

| Figure | Definition |
|---|---|
| Sàn còn nợ mình | Approved commission not yet settled by the network |
| Sàn đang xử lý | Network batches created and not paid yet (status PROCESSING): their gross and what the network will pay, as its own line under "Sàn còn nợ mình" (owner decision, 2026-10-31) |
| Mình còn nợ khách | Payable balance of all customers (D27) plus confirmed unpaid bonuses |
| Khách đang nợ mình | Open clawback amounts not yet netted |
| Đang chờ sàn duyệt | Estimated commission and estimated cashback of AWAITING_APPROVAL orders, labelled "ước tính" |
| Tiền thực trong kỳ | Network payments received in the period, payouts sent in the period, and the difference |

A warning appears when "Mình còn nợ khách" is larger than "money received minus money paid" over the
last 60 days, meaning payouts are being advanced before the networks pay.

## Block 4 · Trend (one chart)

Weekly bars for the last 12 weeks of **profit** by default, with tabs for commission and cashback on
the same chart (never two axes). Comparison with the previous period is in each tab's summary line.

## Block 5 · Orders (period, by recorded day)

Per network (Shopee, TikTok Shop) and in total:

| Figure | Definition |
|---|---|
| Link đã giao | Link requests delivered in the period |
| Đơn ghi nhận | Orders recorded, and orders ÷ links delivered |
| Đã duyệt / Bị huỷ / Chờ duyệt | Count of the period's recorded orders by current status |
| Tỉ lệ huỷ | Cancelled ÷ (approved + cancelled), with the previous period |
| Hoa hồng TB mỗi đơn | Approved commission ÷ approved orders |
| Tỉ lệ hoa hồng thực | Approved commission ÷ approved order value |
| Đơn chờ quá 60 ngày | Count, linking to the aged list |

Below 100 approved orders the ratios carry the "Chưa đủ dữ liệu" mark (FR-27).

## Block 6 · Events (period)

One row per campaign whose window overlaps the period:

| Column | Definition |
|---|---|
| Campaign | Name and window (Vietnam time, end exclusive) |
| Suất | Used / total (held, confirmed, paid) |
| Chi thưởng | Bonus of confirmed and paid awards |
| Hoa hồng từ đơn giành suất | Approved commission of the award orders |
| Mình giữ từ các đơn đó | Operator share of those orders |
| Lời/lỗ của event | Operator share − bonus |

No "extra revenue caused by the event" figure is shown: it cannot be measured without a control
group.

## Block 7 · Customers and risk (period)

Customers with an order, new customers, repeat share; a concentration warning when one customer
holds more than 30% of the period's commission. The ranked list lives on the Customers screen.

## Block 8 · System health

One quiet line: browser bridge, Zalo assistant, last reconciliation, last backup.

## Rules

- Every figure comes from the server; the frontend formats only (code.md §4, §6).
- Every figure has a one-line definition under it, in plain Vietnamese.
- A figure with no data shows a grey dash, never 0 or a placeholder (LC-9, LC-15).
- Each figure opens the list that explains it, with the filters in the URL (LC-4).
