---
name: Hoàn Tiền DP
status: final
updated: 2026-10-30
design: DESIGN.md
sources:
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/prd.md
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/addendum.md
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/list-defects.md
  - docs/domain-model.json
  - .claude/skills/bmad-domain-driven/references/glossary.md
  - docs/rules/writing.md
  - CLAUDE.md
  - .claude/skills/cashback-shadcn/SKILL.md
  - .claude/skills/cashback-ui-review/SKILL.md
---

# Hoàn Tiền DP — Experience Spine

How the customer website, the admin desk, the share page and the receipt page behave. `DESIGN.md` owns how they look; tokens are referenced by name in braces, for example `{colors.money}`. The PRD owns what the product does; this file cites FR and UJ ids instead of restating them. Terms follow the glossary exactly (payable balance, review case, guest account (HOUSE), share link, and so on). Decisions and their reasons are in `.memlog.md`. The project skills `cashback-shadcn` and `cashback-ui-review` win where they are stricter than this file.

## Foundation

- **Surfaces.** (1) Customer website at hoantiendp.com: phone-first, 360 px floor, opened mostly from a Zalo chat, often inside the Zalo in-app browser. (2) Admin desk: staff only, desktop-first, fully usable on a phone for the evening payout run (UJ-5). (3) Share page `/s/<code>` and receipt page `/b/<token>`: server-rendered HTML, public, same tokens through generated CSS, no client framework.
- **UI system.** React + TypeScript + Tailwind + shadcn/ui (Radix base, `nova` geometry). TanStack Table for every list, TanStack Query in `*.queries.ts` for every server read and write. Zod validates request bodies. This file specifies only the behaviour that differs from shadcn defaults.
- **Money.** The frontend never calculates money (FR-13, FR-38). Every amount, total, count and example amount arrives from the server already rounded. The UI only formats it. See [Money Display](#money-display).
- **Language.** All UI text is Vietnamese and comes from `resources/dashboard.vi.json`; chat text from `resources/messages.vi.json`. Copy examples below are Vietnamese with an English gloss; the label file is the source of truth for final wording.
- **Theme.** Light only in v1.

## Information Architecture

Every surface traces to a journey or an FR. "Phone" describes the phone form; tablet and desktop use the wider form of the same surface.

### Customer website

| Surface | Route | Reached from | Purpose | Traces to |
|---|---|---|---|---|
| Home with link converter | `/` | Zalo messages, group posts, search | Paste a product link, get the affiliate link; how it works in three steps; when you do not get cashback | UJ-4, FR-2, FR-3 |
| Sign in | `/dang-nhap` | Top bar, My money when signed out | Customer code + password from /matkhau | UJ-2, FR-9 |
| My money | `/tien-cua-toi` | Bottom tab, links in Zalo messages | Payable balance, waiting amount, paid amount, the customer's own orders list | UJ-2, FR-15, FR-37 |
| Account (bank account and password) | `/tai-khoan` | My money bank card, "order approved" message | Save, change or erase the one bank account; change password | UJ-3, FR-10 |
| Guide | `/huong-dan` | Bottom tab, Home | Steps, chat commands (/id, /matkhau, /sodu, /donhang, /stk, /help), how cashback is split with example amounts, when cashback is not paid | FR-20, FR-13 |
| Share page | `/s/<code>` | Every Zalo link reply | Product, price, estimated cashback with example amount; leaves the in-app browser and redirects | UJ-1, UJ-8, FR-6 |
| Receipt page | `/b/<token>` | "đã chuyển tiền" (money sent) message | One payout: customer code, last four digits, amount, date (no proof image, D49) | UJ-5, FR-18 |
| Zalo-down banner | global strip | Shown while the assistant is down | New contact path; signed-in features keep working | FR-36 |

Navigation: top bar (brand left; "Đăng nhập" (sign in) or the customer code avatar right). On phone a bottom tab bar with three items: "Trang chủ" (home), "Tiền của tôi" (my money), "Hướng dẫn" (guide). Account opens from the avatar menu and from My money. No floating Zalo button; Zalo actions live inside the content where they are needed.

### Admin desk

| Surface | Route | Purpose | Traces to |
|---|---|---|---|
| Overview (Tổng quan) | `/admin` (landing) | Defined block by block in `docs/operations/dashboard-spec.md` (Operations Lead): period picker; to do; business result by approval day (commission per network, fee, withheld tax, cashback, event bonus, clawback netted, profit and margin as the largest figure); money position now (networks owe us, we owe customers, customers owe us, waiting for approval, cash in the period); profit trend with commission and cashback tabs; orders per network; events with their own profit or loss; customers and concentration; health. | FR-25, FR-27, FR-30, FR-32 |
| Payouts | `/admin/payouts` | Tabs: "Chuyển được" (payable now), "Cần xử lý" (blocked: no bank, held, flagged), "Lịch sử" (payout history incl. voided), "Sàn thanh toán" (network settlement) | UJ-5, FR-16, FR-17, FR-19, FR-34 |
| Orders | `/admin/orders` | Search and filter every order by id, status, network, date kind | FR-26, FR-12, FR-37 |
| Customers | `/admin/customers` | Search by code, name, Zalo id; fraud flag filter | FR-26, FR-31 |
| Customer page | `/admin/customers/<code>` | One customer: balance, orders, link requests, payouts, bank account with 72-hour flag, flags, merge, erase | FR-26, FR-10, FR-11, FR-31, FR-34, FR-35 |
| Review cases | `/admin/review` | Open cases and merge proposals; apply or dismiss with a reason | UJ-6, FR-14, FR-11 |
| Campaigns | `/admin/campaigns` (admin only) | Create, run and watch a campaign; slots and awards | UJ-7, FR-23 |
| Link requests | `/admin/links` | Every link request with queue state, channel, delivery, failures | FR-1, FR-4, FR-7 |
| Staff | `/admin/staff` (admin only) | Create employees, change role or status, reset passwords | FR-24 |
| Audit trail and logs | `/admin/audit` | Append-only business acts; bank accounts as fingerprints | FR-29 |
| Settings | `/admin/settings` | Withheld settlement periods (mark a Shopee period withheld), Zalo assistant connection, alert contacts | FR-13, FR-36, FR-30 |

Navigation: desktop sidebar grouped "Hằng ngày" (daily: Overview, Payouts, Review cases, Orders), "Khách" (customers: Customers, Link requests, Campaigns), "Quản trị" (admin: Staff, Audit trail and logs, Settings). Admin-only items are hidden for employees, not disabled. Tablet: icon rail with tooltips. Phone: bottom tab bar "Tổng quan", "Chuyển tiền", "Đơn", "Khách" (today, payouts, orders, customers) plus "Thêm" (more) opening a sheet with the rest. Each sidebar item shows a count badge only when the count is exact and from the same definition as the target list (LC-6).

### Not a screen

FR-1, FR-4, FR-5, FR-8, FR-20, FR-21, FR-22 live in the Zalo chat and in the server; their UX is the message text in `messages.vi.json`. FR-33 (cutover import) has no surface; its row report is an architecture concern. FR-32 appears only as the "last backup" health line on Today.

→ Composition references: [mockups/key-my-money-phone.html](mockups/key-my-money-phone.html) (My money), [mockups/key-payouts-desktop.html](mockups/key-payouts-desktop.html) (Payouts), [mockups/key-orders-list-contract.html](mockups/key-orders-list-contract.html) (Orders and the List Contract). The spines win on any conflict with a mock. Every other surface is built from these tables alone.

## Voice and Tone

Microcopy. Brand posture lives in `DESIGN.md.Brand & Style`. The customer register keeps the current friendly "mình" (I, the assistant) and "bạn" (you), but plainer: the exact amount, what happened, what to do next. The admin register is short labels and counts.

| Do | Don't |
|---|---|
| "Bạn nhận lại khoảng 9.263đ" (you get back about 9,263 dong) | "Hoàn tiền đến 80%" (cashback up to 80%) with no amount |
| "80% phần hoa hồng sàn duyệt. Ví dụ hoa hồng 100.000đ thì bạn nhận 79.216đ" (80% of the approved commission; example: a 100,000 dong commission gives you 79,216 dong) | A percentage with no example amount |
| "Mình chuyển tiền đã duyệt theo đợt, không hẹn ngày cố định." (I send approved money in batches, with no fixed date.) | "Tự động chuyển khoản 24/7", "nhận sau 30-70 ngày" (automatic transfer 24/7, arrives in 30 to 70 days) |
| "Link này không được hoàn tiền. Lấy mã khách hàng trên Zalo trước." (This link earns no cashback. Get a customer code on Zalo first.) | Burying the guest warning below the link |
| "Web đang bận. Gửi link cho mình trên Zalo, bên đó không giới hạn." (The website is busy. Send the link to me on Zalo, there is no limit there.) | "Lỗi 429", "Something went wrong" |
| "Không đọc được danh sách. Thử lại." (Could not load the list. Try again.) | Showing "Chưa có đơn nào" (no orders yet) after an error |
| Admin: "12 khách · 1.234.567đ" (12 customers, 1,234,567 dong) | Admin: "Tổng" (total) over a filtered set without saying so |
| No emoji, no exclamation marks, no capitals for emphasis | "🥮 ĐÓN TẾT", "KHÔNG được hoàn" |

Every percentage, everywhere, carries a server-supplied example amount. "Ước tính" (estimate) is always written next to an estimated figure.

## Component Patterns

Behavioural rules. Visual specs are in `DESIGN.md.Components` or inherited from shadcn.

| Component | Use | Behavioural rules |
|---|---|---|
| Link converter | Home | One URL input, paste button, submit "Lấy link hoàn tiền" (get cashback link). Signed-in customers submit with their session; signed-out visitors may type a customer code in an optional field. Unknown code: inline error "Không tìm thấy mã khách hàng" (customer not found), never a guest fallback (FR-2). Supported networks named under the input; a Lazada link gets the polite refusal from the server. While waiting: the button shows progress and the result area shows a skeleton plus "Đang tạo link…" (creating the link); the request waits on the server, the page only polls. |
| Link result card | Home after convert | Product name, price, estimated cashback (`money-figure-estimate`), the share link with "Mở link mua hàng" (open purchase link) and "Chép link" (copy link). The share link, never the raw affiliate link, so the in-app browser rules apply. |
| Guest warning | Link result when `house: true`, share page of a guest link | Shown above the link. Main action is the Zalo button; the guest link is a secondary outline button. Never dismissible. |
| Zalo hand-off panel | `web_busy` answer, no-code state, forgot password | Replaces the result area. One sentence why, the Zalo button. No retry button that would spend quota again. |
| Zalo button | Everywhere the customer must go to the assistant | Opens the assistant chat URL. At most one Zalo button in a screen region; no floating button. |
| Balance card | My money | Three server figures: payable balance (hero), waiting for approval (estimate tag), already paid. Labels: "Chờ chuyển cho bạn" (waiting to be sent to you), "Đang chờ sàn duyệt" (waiting for the network's approval), "Đã chuyển cho bạn" (sent to you). When the server's `deductedNext` is above 0, a fourth line under the hero reads "Trừ vào lần chuyển sau −9.263đ" (deducted at the next payout) and taps through to the clawed-back orders, so the order rows add up to the card (review M17). A sentence under the card states there is no fixed payout date. Tapping a figure filters the order list to that state (URL state). |
| Bank account card | My money, Account | Bank name, masked account `•• 6789`, holder name. Missing bank and payable balance above 0: the card becomes the one thing to fix, "Thêm tài khoản để nhận 79.216đ" (add an account to receive 79,216 dong), with a direct button to Account. Website change pending Zalo confirmation: "Đang chờ bạn xác nhận trên Zalo" (waiting for your confirmation on Zalo) (FR-10). |
| Bank account form | Account | Bank picker (Command search over VietQR banks; free text that matches several banks shows the matches to pick from, UJ-3 edge case), account number (spaces and dashes removed as typed, 4 to 30 letters and digits), holder name upper-cased on blur. Consent checkbox with the purpose sentence, required. Save shows the server's confirmation with the last four digits. Erase is a destructive button with one AlertDialog. |
| Order card | My money order list | Product name, network, status badge, order progress, cashback amount (estimate or approved per status), one date with its kind ("Ghi nhận 12/10" (recorded 12 Oct)). Rejected: the reason in words. Tap expands the order's history (recorded, approved, paid times). |
| Order progress | Order card, admin order detail | Three steps: Ghi nhận (recorded), Đã duyệt (approved), Đã chuyển tiền (paid). Rejected replaces the bar with the rejected state. Purely a view of the server status, no animation on load. |
| Share page | `/s/<code>` | Server-rendered. Detects the in-app browser on the server. Android in-app: redirect to Chrome by intent; iOS in-app: a step guide "Bấm ••• rồi chọn Mở bằng Safari" (tap ••• then Open in Safari) with a copy-link fallback; real browser: shows product, price and estimated cashback for about one second with a "Đi tới Shopee" (go to Shopee) button, then redirects. Guest link: guest warning instead of the cashback line. No JavaScript is needed for the redirect itself. |
| Receipt page | `/b/<token>` | Server-rendered, read-only, `noindex`. Receipt card with facts only; the proof image is never on this public page (D49). The signed-in customer sees the proof on the payout row in My money; staff see it in the admin desk. A voided payout shows "Đã huỷ ghi nhận" (voided) across the card with the void date. Unknown token: a plain "Không tìm thấy biên nhận" (receipt not found) page, same status as any missing page. |
| Data list / data table | Every list | Governed entirely by the [List Contract](#list-contract). |
| Payout panel | Payouts | Opens from a payable row as a right Sheet on desktop and tablet, a full-height Drawer on phone. Loads a server payout preview: covered orders and bonuses, total, bank, holder, masked account, transfer reference (the customer code plus a short claim id, unique per claim, D39), VietQR for exactly the total. If the customer's last claim was abandoned after its QR was shown, the panel opens with a warning "Có thể đã chuyển 79.216đ lúc 19:42, kiểm tra ngân hàng trước khi chuyển" (may already have been transferred at 19:42: check the bank first). A customer whose clawbacks cover the whole payable opens a netting-only panel: no QR, confirm reads "Xác nhận trừ nợ" (confirm netting). Optional proof image (paste, drop or camera on phone). Confirm button "Xác nhận đã chuyển 79.216đ" is the single confirmation. The panel keeps the preview snapshot and does not refetch while open. |
| Payout claim | Payouts | Opening the panel claims the customer for this staff member; another staff member sees the row as "Minh đang chuyển" (Minh is paying) and cannot open it. Closing the panel or 10 minutes idle releases the claim. [ASSUMPTION: 10-minute claim timeout.] |
| Flag badge | Payouts, Customers, Customer page | "Chưa có STK" (no bank account), "Mới đổi STK" (bank changed within 72 hours, with the change time on hover or tap), "Chờ xác nhận STK" (website change not yet confirmed: row is held, confirm disabled), fraud flags from FR-31. A flagged row is never hidden; it is sorted into "Cần xử lý". |
| Void payout | Payout history, Customer page (admin only) | Destructive action with a required reason. Shows the server's list of orders and the state each returns to (approved, or reversed when a cancel was seen, D41). One AlertDialog. The payout stays in history as voided. |
| Review case panel | Review cases | Side sheet with the report row (network fields as read-only key/value list), the candidate customer with their code and recent orders, and the system's reason for not guessing. Actions "Áp dụng" (apply) and "Bỏ qua" (dismiss), each with a required reason. Apply shows the server's resulting order state before confirming. No field edits an amount. |
| Merge proposal | Review cases, Customer page | Two customer columns side by side; different bank accounts block the merge with the reason shown. Confirm once. |
| Erase customer | Customer page danger zone | Refused with the owed amount shown while the customer is owed money; an admin can force with a reason. One AlertDialog that names what is removed and what is kept (FR-35). |
| Campaign form | Campaigns | Window start and end typed as Vietnam time, labelled "(giờ Việt Nam)"; end is shown as "đến trước 00:00 ngày 15/11" (until before 00:00 on 15 Nov) because the end is exclusive. Slot count, bonus, minimum order value, networks, per-customer cap, exclusions. Preview line from the server: "20 suất · thưởng 20.000đ · đơn từ 150.000đ" (20 slots, 20,000 dong bonus, orders from 150,000 dong). |
| Campaign detail | Campaigns | Slot meter from server counts (held, confirmed, paid, free), the award list as a DataList. |
| Withheld period toggle | Settings | Per Shopee settlement period: a switch "Sàn đã khấu trừ thuế kỳ này" (the network withheld tax for this period). Changing it shows the server's count of orders it affects (approved after the mark only) and asks once. AccessTrade periods show "Luôn khấu trừ" (always withheld), not editable. |
| Today tile | Today | Count from the same definition as the target list, label, and a link to that list with its filter in the URL. A tile with 0 reads "Không có gì cần làm" (nothing to do) in muted text. |
| Health line | Today | Browser bridge, Zalo assistant, last reconciliation (time and result), last backup: health dot plus word plus the time of the last check. A down state links to the runbook step. |
| Metric card | Metrics | Server value; below 100 approved orders a "Chưa đủ dữ liệu" (not enough data yet) tag and muted value (FR-27). Never a fallback number. |
| Toast | Everywhere | Sonner. Success toasts are neutral, not green. Errors stay until dismissed. |
| Money figure | Every amount | Renders a server integer through the one formatter (M-1). Estimate variant whenever the server marks the amount as an estimate (M-2). Missing amount renders the dash (LC-15). Screen readers get the amount in words. |
| Status badge | Every status | Label and tone from the status registry (LC-13); never free text. Not interactive; filtering is done with filter chips. |
| Filter chip | List toolbars | Toggle button; several chips of one status group may be on together; "Tất cả" (all) clears the group. Count from `facets` of the same response (LC-6); a chip with 0 stays visible and selectable. Changing a chip resets to page 1 (LC-7). |
| Masked account | Customer and staff screens | Shows only the last four digits everywhere, including staff screens and the receipt page. Staff copy the full number only from the payout panel's copy button, which is logged in the audit trail. [ASSUMPTION: copying the full number is audit-logged.] |
| Zalo-down banner | Every customer page | Appears when the server reports the assistant down (FR-36); not dismissible while down; hides itself on the next page load once the server reports it back. Replaces Zalo buttons' target with the fallback contact path. |
| Bottom tab bar | Customer phone, admin phone | Fixed to the bottom with safe-area padding; hidden while the on-screen keyboard is open; the active tab is the current surface; tapping the active tab scrolls to top. |
| Empty state | Lists, Today tiles | Distinguishes "no records" from "no matches" (LC-9); one action at most. |
| Campaign slot meter | Campaign detail | Server counts only; refreshes with the award list (LC-10). |

The single definition of every state, its trigger and its customer sentence is `docs/operations/status-flows.md` (Operations Lead); this registry follows it.

## List Contract

One pattern, `DataList`, implements FR-37 and FR-38 for every list: orders, payouts, customers, link requests, products, review cases, campaigns, campaign awards, audit entries, staff, and a customer's own orders. No screen builds its own list behaviour. On desktop and tablet `DataList` renders a `data-table`; on phone it renders `data-list-card`s from the same column definitions.

→ Illustrated in [mockups/key-orders-list-contract.html](mockups/key-orders-list-contract.html).

### Anatomy

1. **Toolbar.** Search input (left), filter controls, sort control on phone, page size on desktop, refresh button with "Cập nhật lúc 19:42" (updated at 19:42).
2. **Filter chips.** One chip row per status filter, chips in lifecycle order, each with a count. Counts come in the same response as the rows.
3. **Summary line.** "1.284 đơn · Khách nhận 12.345.678đ" (1,284 orders; customers get 12,345,678 dong) for the filtered set, or a separately labelled overall total "Toàn bộ:" (all records:).
4. **Rows** (table or cards).
5. **Pagination.** "1–50 / 1.284" with previous, next and page numbers; phone shows previous, "Trang 2 / 26" (page 2 of 26) and next.

### Rules

| Id | Rule |
|---|---|
| LC-1 | **Server does the work.** Search, filter, sort and pagination are query parameters to one list endpoint per entity. The browser never filters or sorts rows it holds. The response carries `rows`, `total`, `facets` (chip counts) and `summary`. |
| LC-2 | **One field per column.** A column definition names one server field. The cell displays that field and the sort sends that same field key. A column with no sortable field shows no sort affordance. Money sorts as numbers, dates as instants, statuses in lifecycle order (LC-13), Vietnamese names with Vietnamese collation. |
| LC-3 | **One search.** One search box per list. The server ignores case, diacritics and spaces and escapes wildcards. Covered fields are fixed per entity and named in the placeholder, e.g. "Tìm mã đơn, mã khách, tên khách, Zalo id, sản phẩm" (search order id, customer code, customer name, Zalo id, product). Raw JSON is never searched. |
| LC-4 | **URL state.** Search, filters, sort, page and page size live in the URL query. Refresh, back, forward and a shared link restore the same view. Switching tabs inside a surface keeps each tab's own query. Defaults are omitted from the URL. |
| LC-5 | **Debounce and order.** Search fires 300 ms after the last keystroke; Enter fires at once. Every request carries the full query; a response for an older query is discarded (TanStack Query key per query). |
| LC-6 | **Same set.** Every count, chip, badge and summary next to a list comes from the same filtered set as the rows. An overall figure is labelled "Toàn bộ" (all records). No count is capped; a large count is shown in full ("1.284", not "99+"). |
| LC-7 | **Page reset and clamp.** Changing search, a filter or sort resets to page 1. When the total shrinks below the current page, the server returns the last valid page and the URL is corrected. The range text never reads past the total. |
| LC-8 | **Keep previous rows.** While a new query loads, the previous rows stay visible, dimmed (`list-loading-dim`), with the 2 px progress line. Skeletons appear only on the first load of a surface. |
| LC-9 | **Distinct states.** Loading, empty (no records at all), no matches (records exist, filters exclude them), error and stale are separate states with their own text (see [State Patterns](#state-patterns)). An error never renders as an empty list. No placeholder figure is shown as data. |
| LC-10 | **Refresh after actions.** Every mutation (payout, void, review apply or dismiss, merge, erase, bank change, campaign edit, period mark) invalidates every query that shows the changed records and their summaries: the list, its facets, Today tiles, sidebar badges, the customer page and Metrics. |
| LC-11 | **Background refresh.** Lists refetch on window focus and every 60 seconds while visible, except while a payout panel or review panel is open; panels work on their snapshot and the server checks it on confirm. |
| LC-12 | **Phone layout.** Rows become stacked cards: identity line and status badge first, amount right-aligned, one labelled date, at most three secondary facts. Sort is a Select "Sắp xếp" (sort by) listing the same sortable columns with direction. Filters open in a bottom sheet with the same chips and counts; the toolbar shows "Bộ lọc (2)" (filters, 2 active). The page never scrolls sideways. |
| LC-13 | **Status vocabulary.** Status labels, tones and sort order come from one registry (table below), shared with chat and exports. A screen never defines its own status text. |
| LC-14 | **Dates.** See the date rules below. |
| LC-15 | **Missing values.** A missing value is a grey dash. A zero is shown only when the server says the value is zero. |
| LC-16 | **Selection and bulk.** No list offers "select all" for a money action. Payouts are recorded one customer at a time (FR-17). |
| LC-17 | **Product cell.** Every list that shows a product (orders, payout preview, customer page, overview, review) shows a 32 px thumbnail from the product snapshot (D56) and the name on one line, truncated with an ellipsis; a missing image is a grey placeholder. The cell sorts by the name. |

### Date and time rules

- The server stores and sends instants in UTC. The UI formats every instant in Asia/Ho_Chi_Minh with one shared formatter; it never parses a date string by hand.
- Business days, weeks and months ("Hôm nay" (today), "Hôm qua" (yesterday), "7 ngày qua" (last 7 days), "Tháng này" (this month)) are computed by the server in Vietnam time. A date-range filter sends calendar dates, and the server includes the whole end day.
- Each date column shows one kind of date, named in its header: "Ngày ghi nhận" (recorded), "Ngày duyệt" (approved), "Ngày chuyển" (paid). The date filter names its kind too: "Ngày ghi nhận: 24/10 – 30/10". A row without that date shows a dash; it never falls back to another kind.
- Format: `30/10` in the current year, `30/10/2025` otherwise; with time `30/10 19:42`. Relative time ("5 phút trước", five minutes ago) only beside an absolute time, for health and refresh lines.
- Times typed by staff (campaign windows, date filters) are read as Vietnam time and labelled "(giờ Việt Nam)".

### Status vocabulary

One label and one tone per status. Lifecycle order is the sort order and the chip order. Labels in **bold** exist in `dashboard.vi.json`; the rest are proposed and added to the label file by the build story.

| Entity | Order | Status | Label (gloss) | Tone |
|---|---|---|---|---|
| Order | 1 | AWAITING_APPROVAL | **Chờ sàn duyệt** (waiting for the network's approval) | waiting |
| Order | 2 | APPROVED | **Đã duyệt** (approved) | approved |
| Order | 3 | PAID | **Đã chuyển tiền** (paid) | done |
| Order | 2 | FROZEN | Đang kiểm tra lại (being checked; excluded from every total) | attention |
| Order | 4 | REJECTED | **Không được duyệt** (not approved), with reason | rejected |
| Order | 5 | REVERSED | Huỷ sau khi duyệt (cancelled after approval) | rejected |
| Order | — | PAID + clawback | Đã chuyển tiền · bị sàn huỷ sau đó, trừ vào lần chuyển sau | attention |
| Link request | 1–5 | QUEUED, ISSUED, DELIVERED, CONVERTED, FAILED | Đang xếp hàng (queued), Đã tạo link (issued), Đã gửi (delivered), Có đơn (has an order), Lỗi tạo link (failed) | neutral, approved, approved, done, rejected |
| Review case | 1–2 | OPEN, RESOLVED | Chờ xử lý (open), Đã xử lý (resolved) + outcome Đã áp dụng (applied) / Đã bỏ qua (dismissed) | attention, done |
| Campaign | 1–3 | SCHEDULED, RUNNING, CLOSED | Sắp chạy (scheduled), Đang chạy (running), Đã kết thúc (closed) | neutral, approved, done |
| Campaign award | 1–4 | HELD, CONFIRMED, PAID, VOID | Đang giữ suất (slot held), Đã xác nhận (confirmed), Đã trả (paid), Mất suất (slot lost) | waiting, approved, done, rejected |
| Payout | 1–2 | RECORDED, VOIDED | Đã chuyển (sent), Đã huỷ ghi nhận (voided) | done, rejected |
| Customer | 1–5 | ACTIVE, LOCKED, DISABLED, MERGED, ERASED | Đang dùng (active), Tạm khoá (locked), Đã tắt (disabled), Đã gộp (merged), Đã xoá dữ liệu (data erased) | approved, waiting, neutral, neutral, neutral |

Shared definitions shown as facts, not statuses (FR-38, D27): "Chuyển được" (payable: approved and not paid), "Có STK" (has a bank account: a saved account that is not pending confirmation), "Sàn đã thanh toán" (settled by the network) with "một phần" (partly) when some covered orders are settled. Settlement is a separate column, never folded into a status.

### Root cause to rule map

Each root cause in `list-defects.md` and the rule that prevents it. Every listed defect gets a regression test (FR-37).

| Root cause (list-defects.md) | Example defects | Prevented by |
|---|---|---|
| 1. Timestamps in three formats, compared as text; no Vietnam business-day helper | "Today" returns nothing; end date excludes its day; campaigns open 7 hours late; log times 7 hours off | Date rules (UTC instants, server business days, whole end day, staff input read as Vietnam time); LC-2 dates sort as instants |
| 2. Money derived in about six places | List and customer dialog disagree; TikTok charged the Shopee fee; balance cards include bonuses rows never show | Money Display M-1, M-2; LC-1 summary from the server; LC-6 |
| 3. Sorting uses a different expression than the value displayed | Commission sorts by estimate while showing approved; code column sorts by Zalo id; "last requested" sorts by update time | LC-2 |
| 4. No shared status vocabulary | "ready", "has bank", "settled" with two or three meanings; status sorts alphabetically | LC-13 status registry and shared definitions; lifecycle order |
| 5. Payment actions trust the browser | Confirm pays awaiting or paid orders; typed amount unchecked; "refund" marks paid in one click; test toggle shows awaiting orders | Payout panel (server preview, one confirm, snapshot checked), LC-16, M-3; no "show awaiting" toggle exists; no typed amounts anywhere |
| 6. Summaries from a different set than the table | "total paid" over last 100; "All (N)" shows the filtered count; badges capped at 3; unfiltered cards | LC-6 |
| 7. Search not normalised | Vietnamese names not found; `%` and `_` unescaped; raw JSON searched; Zalo id missing on one screen | LC-3 |
| 8. List state local and copied per view | Filters lost on refresh; spinner flash on every key; "41 – 40 of 40"; swallowed errors shown as no rows; previous customer's amount carries over | LC-4, LC-5, LC-7, LC-8, LC-9, LC-10; panels keyed by customer and reset on open |
| 9. Placeholder numbers shown as real data | 37 members, 15.2%, "50%", "30 days", approval rate 100% by default | LC-9, LC-15, Metric card trust mark, M-4 |

## Money Display

| Id | Rule |
|---|---|
| M-1 | The UI never adds, subtracts, multiplies or rounds money. It formats server integers with one formatter: `79.216đ`. |
| M-2 | Estimated and approved amounts are visibly different: estimate is `money-figure-estimate` with "khoảng" and the "ước tính" tag; approved, payable and paid are `money-figure`. Estimated commission is never shown as the cashback base. |
| M-3 | Before any money act (payout, void, review apply, erase force, period mark) the UI shows the server's own figures and asks for confirmation once. If the server answers that the set changed, the panel shows "Số tiền đã thay đổi, xem lại" (the amount changed, review again) with the new preview and requires a fresh confirm. |
| M-4 | Every percentage shown to a customer has a server example amount beside it. Admin-only rates (effective commission rate) may stand alone. |
| M-5 | No surface promises a payout date or a payout speed. |
| M-6 | Guest orders show 0 cashback as "Không hoàn tiền (khách vãng lai)" (no cashback, guest) on the admin desk; they never appear on any customer surface or payout list. |
| M-7 | The QR amount equals the payout preview total. A bank name that matches no single VietQR bank shows no QR and the warning to transfer by hand. |
| M-8 | The same customer shows the same figures on phone, tablet and desktop; responsive layouts drop columns, never change which figure is shown. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| First load | Any list or dashboard | Skeleton rows or tiles matching the layout. |
| Reloading | Any list | Previous rows dimmed with progress line (LC-8). |
| Empty (no records) | My money orders | "Bạn chưa có đơn nào. Trước khi mua, gửi link cho mình trên Zalo hoặc dán vào ô ở trang chủ." (No orders yet. Before buying, send me the link on Zalo or paste it on the home page.) With a link to Home. |
| No matches | Any list | "Không có kết quả với bộ lọc này." (No results for these filters.) plus "Xoá bộ lọc" (clear filters). |
| Error | Any list | "Không đọc được danh sách: {reason}. Thử lại." (Could not load the list.) with retry. Rows from a previous success stay, marked stale. |
| Stale | Any list, Today | `stale-banner` "Dữ liệu lúc 19:42, chưa tải lại được" (data from 19:42, could not refresh) when a background refetch fails. |
| Nothing to pay | Payouts | "Không có ai cần chuyển tiền." (Nobody to pay.) |
| Amount changed | Payout panel | M-3 state; confirm disabled until the new preview is read. |
| Taken by another staff member | Payouts | Row shows "{name} đang chuyển" and no open action. |
| Held bank change | Payouts, My money | Row in "Cần xử lý" with "Chờ xác nhận STK"; customer sees "Đang chờ bạn xác nhận trên Zalo". |
| No bank account | My money, Payouts | Customer: bank card becomes the one thing to fix. Staff: row in "Cần xử lý" with "Chưa có STK". |
| Signed out | My money, Account | Redirect to Sign in with return path. |
| Session ended by new password | Any signed-in customer page | "Phiên đăng nhập đã kết thúc vì có mật khẩu mới." (Session ended because a new password was issued.) then Sign in. |
| Locked after 5 failures | Sign in | Label `login_locked` meaning: wait 15 minutes or ask /matkhau. |
| Guest link | Home result, share page | Guest warning (Component Patterns). |
| Website busy (`web_busy`) | Home | Zalo hand-off panel. |
| Link failed | Home | "Chưa tạo được link. Gửi link cho mình trên Zalo nhé." (Could not create the link. Send it to me on Zalo.) |
| Zalo assistant down | Every customer page | Zalo-down banner; Zalo buttons replaced by the fallback contact path from the server. |
| Not enough data | Metrics | "Chưa đủ dữ liệu" tag below 100 approved orders. |
| Permission | Admin-only surfaces | Hidden from employees' navigation; direct URL shows "Chỉ quản trị viên xem được trang này." (Only admins can view this page.) |
| Offline | Customer website | Browser offline: a top strip "Mất kết nối mạng" (no network connection); last loaded figures stay with their time. No offline writes. |
| Receipt voided | Receipt page | Voided treatment (Component Patterns). |
| Unknown share code | Share page | "Link này không còn dùng được. Gửi lại link sản phẩm cho mình trên Zalo." (This link no longer works. Send the product link to me on Zalo again.) with the Zalo button. |
| Review queue empty | Review cases | "Không có ca nào cần xem." (No cases to review.) |
| Erased customer | Customer page | Header reads "Đã xoá dữ liệu" (data erased) with the erase date; personal fields show the dash; orders and payouts stay listed under the customer id; every action is disabled. |
| Root admin | Staff | The root admin row has no demote or disable action, and says why in a tooltip. |
| Save failed | Account, Campaign form, Settings | Field-level errors from the server next to the field; a form-level error above the submit; the form keeps what was typed. |

## Interaction Primitives

- **Tap and click to act.** No gesture is the only way to do something. No drag and drop, no swipe actions, no long-press menus.
- **Dialog to sheet.** Dialogs become bottom sheets or drawers on phone (cashback-shadcn rule 15). One modal level only.
- **Keyboard on the admin desk.** `/` focuses the list search; `Esc` closes the top panel; `Enter` in search fires at once; arrow keys move through table rows and `Enter` opens the row. Shortcuts are listed in a "Phím tắt" (shortcuts) popover, never required.
- **Copy.** Copy buttons (share link, transfer reference, account number for staff) show "Đã chép" (copied) for 2 seconds.
- **Pull to refresh** is not built; the refresh button and focus refetch cover it.
- **Banned:** infinite scroll, auto-advancing carousels, hover-only controls, "select all" on money actions, typed money amounts, floating action buttons, auto-dismissing error toasts.

## Accessibility Floor

Behavioural. Visual contrast is in `DESIGN.md.Colors` (every text pair at least 4.5:1, control borders 3:1).

- WCAG 2.2 AA on every surface, including the server-rendered pages.
- Touch targets at least 44 by 44 px on touch devices (`{spacing.touch-target}`); target spacing per WCAG 2.5.8 on dense admin tables.
- Status is never conveyed by colour alone: badges carry text, health dots carry a word.
- Focus is always visible (`{colors.ring}`), never hidden by sticky headers or the bottom bar (WCAG 2.4.11). Opening a sheet moves focus into it; closing returns focus to the row that opened it.
- Lists announce result counts through a polite live region after each query: "1.284 đơn" (1,284 orders). Loading is announced once, not per keystroke.
- Sort headers are buttons with `aria-sort`. Filter chips are toggle buttons with `aria-pressed` and their count in the accessible name.
- Money is read as words by screen readers: the formatter emits an `aria-label` such as "79.216 đồng".
- Forms: labels always visible, errors tied to fields with `aria-describedby`, no placeholder as label. Paste is always allowed in password and account number fields (WCAG 3.3.8).
- `prefers-reduced-motion`: no transitions on sheets, progress lines become static.
- Text resizes to 200% without loss; layouts reflow at 320 px CSS width.
- The `lang="vi"` attribute is set on every page.

## Responsive & Platform

| Width | Customer website | Admin desk |
|---|---|---|
| Phone 360–767 px | One column, bottom tab bar, sheets for menus | Bottom tab bar + "Thêm" sheet; lists as cards (LC-12); payout panel as full-height drawer; QR shown full width so a second phone can scan it, or the account details copyable for a banking app on the same phone |
| Tablet 768–1279 px | Same column, centred at 640 px; top bar navigation | Icon rail; tables with secondary columns hidden behind a "Cột" (columns) menu; panels as right sheets |
| Desktop 1280 px+ | Same as tablet | Sidebar; full tables; payout panel as a 480 px right sheet beside the list |

- **Zalo in-app browser.** The customer website works fully inside it (sign in, My money, Account, link converter). Opening an affiliate link always goes through the share page (`/s/<code>`) so the browser hand-off runs. No feature depends on pop-ups, new windows or third-party cookies. Session cookies are first-party.
- **Server-rendered pages** use the generated token CSS, Be Vietnam Pro with fallback, and no client JavaScript beyond the copy button.
- **Phone payout run.** On a phone Minh copies the account number and the amount into his banking app on the same device; the QR is for scanning from a second device. Both paths show the same figures.

## Inspiration & Anti-patterns

- **Lifted from bank statements and Vietnamese banking apps:** amounts right-aligned, the last four digits of an account, a receipt with a reference.
- **Lifted from the earlier v2 attempt (addendum C):** the payables table, payout dialog with VietQR and record-transfer as a single server command.
- **Lifted from the current labels:** the friendly "mình–bạn" voice and the "Bạn kiểm tra được, không phải tin suông" (you can check, not just trust) promise of seeing every order.
- **Rejected — Shopee-orange styling (packages/ui):** the platform must not look like the network.
- **Rejected — "automatic transfer 24/7" and "30 to 70 days" promises (addendum A):** they contradict D11 (no promised payout date).
- **Rejected — two Zalo calls to action plus a floating button, placeholder footer links, fake deals (addendum A).**
- **Rejected — the KPI wall dashboard (addendum B):** replaced by Today; metrics live on their own surface.
- **Rejected — the "show awaiting orders (test)" toggle and typed payout amounts (addendum B, list-defects):** no path to pay unapproved money.
- **Rejected — emoji in headings and labels** (current home and guide labels).

## Key Flows

Flow names mirror the PRD journeys verbatim.

### UJ-1. Lan gets her first cashback link in Zalo.

Lan, 27, office worker in Hanoi, about to buy a 450,000 dong rice cooker.

1. Lan pastes the Shopee link in a private chat with the Zalo assistant. The assistant registers her (FR-8).
2. Within about 30 seconds the reply arrives: product name, price, "Bạn nhận lại khoảng 9.263đ" and the share link `hoantiendp.com/s/<code>`.
3. She taps the share link. It opens inside Zalo's in-app browser.
4. The share page detects the in-app browser. On Android it hands off to Chrome; on iPhone it shows the two-step "Mở bằng Safari" guide with a copy-link fallback.
5. **Climax:** in the real browser the share page shows the rice cooker, 450.000đ and "Bạn nhận lại khoảng 9.263đ" in cashback green with the estimate tag, then opens Shopee. She buys as she always does.
6. Later the assistant sends "Đơn đã được ghi nhận" (order recorded) with the estimate.

Failure: the browser bridge is busy; the assistant says the link is on its way and the link arrives in a later message (FR-4). Failure: the link cannot be made after three counted attempts; the assistant tells her and the website shows nothing new.

### UJ-2. Lan checks where her money is.

1. Lan opens hoantiendp.com on her phone and taps "Tiền của tôi" (my money).
2. Signed out, she lands on Sign in, types DP00012 and the password from /matkhau.
3. My money loads: the balance card shows "Chờ chuyển cho bạn 79.216đ", "Đang chờ sàn duyệt khoảng 18.500đ ước tính" and "Đã chuyển cho bạn 152.000đ".
4. Below, her orders as cards with status chips and counts: "Tất cả 6", "Chờ sàn duyệt 2", "Đã duyệt 1", "Đã chuyển tiền 3".
5. **Climax:** each order says its state in words, shows the progress bar and its amount in dong; the rice cooker reads "Đã duyệt" with 9.263đ and "Ghi nhận 12/10" (recorded 12 Oct).
6. Under the balance: "Mình chuyển tiền đã duyệt theo đợt, không hẹn ngày cố định." She knows what is coming and that no date is promised.

Failure: the order list fails to load; the balance stays and the list shows the error state with retry, never "no orders". Edge: the Zalo assistant is down; the banner shows the fallback contact and everything else works (FR-36).

### UJ-3. Lan adds her bank account when her first order is approved.

1. The "order approved" message names 9.263đ and asks for a bank account, with a link to Account.
2. Lan either replies in chat with bank, number and name, or opens Account on the website.
3. On the website she searches "vietcom" in the bank picker, picks Vietcombank, types the number (spaces removed as she types) and her name (upper-cased), ticks consent and saves.
4. **Climax:** the page confirms "Đã lưu tài khoản •• 6789" (saved account ending 6789), and My money's bank card shows Vietcombank •• 6789 with "Đang chờ bạn xác nhận trên Zalo" until she confirms in the private chat.
5. The assistant messages her the last four digits; she confirms there.

Failure: the bank name matches no bank or several banks; the picker shows the matches (or "Không thấy ngân hàng này", bank not found) and she picks one. Failure: an invalid number shows the field error with the allowed length.

### UJ-4. Tuan pastes a link on the website without a code.

1. Tuan opens Home from a friend's post and pastes a Shopee link without signing in or typing a code.
2. The converter returns a guest link.
3. **Climax:** the guest warning sits above the link: "Link này không được hoàn tiền. Lấy mã khách hàng trên Zalo trước." The main button is "Nhắn bot trên Zalo" (message the assistant on Zalo); "Vẫn mở link không hoàn tiền" (open the link anyway, no cashback) is secondary.
4. He taps the Zalo button and starts the UJ-1 path.

Failure: the website quota is used up (`web_busy`); the result area becomes the Zalo hand-off panel "Web đang bận. Gửi link cho mình trên Zalo, bên đó không giới hạn." Failure: he types an unknown code; "Không tìm thấy mã khách hàng", no guest fallback.

### UJ-5. Minh, the operator, pays everyone in the evening.

1. Minh opens the admin desk on his laptop; Today shows "8 khách chờ chuyển · 1.234.567đ" (8 customers to pay) and links to Payouts.
2. Payouts opens on "Chuyển được" with 8 rows: customer, orders, bonuses, payable amount, bank and masked account, settlement ("Sàn đã thanh toán 3/4 đơn"), flags. "Cần xử lý 2" holds the others.
3. He clicks Lan's row. The payout panel loads the server preview: 3 orders, 79.216đ, Vietcombank •• 6789, NGUYEN THI LAN, reference DP00012, VietQR for 79.216đ.
4. He scans the QR with his banking app, transfers, pastes the screenshot as proof.
5. **Climax:** he presses "Xác nhận đã chuyển 79.216đ". The row leaves the list, the summary drops by 79.216đ, Today and the customer page refresh (LC-10), and Lan gets one "đã chuyển tiền" message with the receipt link.
6. He repeats for each row; the evening run takes a few minutes.

Failure: a customer changed bank account in the last 72 hours; the row carries "Mới đổi STK" with the change time, and he checks before paying. A website change not yet confirmed holds the row in "Cần xử lý". Failure: reconciliation changed the set while the panel was open; confirm returns "Số tiền đã thay đổi, xem lại" with the new preview. Failure: another staff member opened the same customer; the row reads "Tú đang chuyển". Recovery: a mistaken payout is voided by an admin from history with a reason (FR-34).

### UJ-6. Minh clears the review queue.

1. Today shows "Ca cần xem 3" (3 review cases) after reconciliation.
2. Review cases lists them, chips "Chờ xử lý 3", sorted oldest first; each row names the reason ("Không tìm thấy khách", customer not found; "Trạng thái lạ", unknown status).
3. Minh opens one; the panel shows the report row and the candidate customer DP00031 with recent orders.
4. **Climax:** he picks "Áp dụng" (apply), types the reason, sees the server's resulting order state ("Đơn sẽ thuộc DP00031, Chờ sàn duyệt"), and confirms. The case moves to "Đã xử lý", the count drops, the order appears on DP00031's page.
5. A case he cannot place he dismisses with a reason.

Failure: applying would change a paid order or attribute a guest order; the server refuses and the panel shows why. A merge proposal in the same queue shows both customers side by side and refuses if their bank accounts differ.

### UJ-7. Minh runs a "first 20 orders get +20,000 dong" campaign.

1. Minh (admin) opens Campaigns and creates "20 đơn đầu +20.000đ".
2. He types start 01/11 08:00 and end 15/11 00:00 (giờ Việt Nam); the form reads back "đến trước 00:00 ngày 15/11".
3. He sets 20 slots, 20.000đ bonus, minimum order 150.000đ, networks Shopee and TikTok Shop, one slot per customer.
4. **Climax:** the server preview reads "20 suất · thưởng 20.000đ · đơn từ 150.000đ"; he saves; the campaign shows "Sắp chạy", then "Đang chạy" with a slot meter filling as orders take slots.
5. At the end of the window it reads "Đã kết thúc"; awards follow their order's approval and are paid with the cashback in UJ-5.

Failure: a cancelled order frees a slot; while running, the meter shows it passed on; after close it stays free. Staff, the guest account and excluded customers never appear in the award list.

### UJ-8. Lan buys on TikTok Shop.

1. Lan pastes a TikTok Shop link in Zalo.
2. The platform creates the link through AccessTrade and replies like UJ-1, with the estimated cashback and the share link.
3. **Climax:** the share page shows the TikTok Shop product and "Bạn nhận lại khoảng …đ"; the network is named on the page and later on her order card ("TikTok Shop").
4. On My money the order follows the same status vocabulary as Shopee orders.

Failure: same as UJ-1.

## Open Items

- [ASSUMPTION] Payout claim timeout of 10 minutes (Component Patterns, Payout claim). Confirm with the architecture step.
- [ASSUMPTION] Payout lifecycle RECORDED / VOIDED is not a named lifecycle in `docs/domain-model.json`; the labels here follow FR-34.
- [ASSUMPTION] Proposed status labels not yet in `dashboard.vi.json` (Status vocabulary) are added by the build story; the current label file also holds copy that contradicts D11 and must be rewritten, not reused.
- [ASSUMPTION] Customer route slugs are Vietnamese without diacritics; old routes redirect.
- [NOTE FOR UX] Dark theme and a design-system page are deferred; token names reserve `-dark` pairs.
