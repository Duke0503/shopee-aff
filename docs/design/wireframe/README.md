# Wireframes

UI designs for the re-planned cashback platform, made with pen.dev (Pencil) and saved as
`cashback.pen`. Claude Code reads and edits the file through the `pencil` MCP server while the
pen.dev desktop app has it open. Images used on the canvas (logo, mascot, sample product photos)
are copies in `images/`, taken from `web/public/`.

The UX spines win over the wireframes on any conflict:

- `_bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/DESIGN.md` (look)
- `_bmad-output/planning-artifacts/ux-designs/ux-cashback-2026-10-30/EXPERIENCE.md` (behaviour)
- `docs/operations/status-flows.md` (every status and its customer sentence)

## Sections on the canvas

| Section | Screens |
|---|---|
| 0 · Components | Customer top bars and bottom tabs, admin sidebar and phone tabs, the code chip `C · Mã` (copy on tap), buttons, money figures, status badges, filter chips |
| 1 · Web khách — trang chủ và lấy link | Home (phone, tablet, desktop), link result, guest link, creating link, web busy, unknown code |
| 2 · Web khách — tiền của tôi | Sign in (normal, error), My money (phone, tablet, desktop, missing bank), account and bank form (normal, waiting for Zalo confirmation), order detail, "Không thấy đơn?" self-check, guide |
| 3 · Trang chia sẻ và biên nhận | Share page: Android in Zalo, iPhone in Zalo, real browser, guest link; receipt (phone, desktop, voided) |
| 4 · Admin — hôm nay và chuyển tiền | Today (desktop, tablet, phone), payouts (desktop, tablet, phone), payout panel (desktop sheet, phone drawer), amount changed, void dialog |
| 5 · Admin — đơn, khách và review | Orders (desktop, filtered, tablet, phone), list states (loading, no matches, error), phone filter sheet, customers (desktop, phone), customer page (desktop, tablet), review with side panel, merge dialog |
| 6 · Admin — campaign, link, nhân viên, nhật ký, chỉ số, cài đặt | Campaign, link requests, settings (withheld periods), Overview dashboard (desktop, phone), staff and audit trail |
| 7 · Trạng thái hệ thống | Zalo down banner, browser bridge on captcha, first-load skeleton, not found |

## Rules the screens follow

- The live brand: emerald `#047857` (mark `#059669`), `logo-mark.webp`, the mascot set
  (`cashback-design-craft` skill, `references/brand-assets.md`).
- Every screen is drawn at phone 390, and where it matters tablet 820 and desktop 1440; layouts are
  re-composed per width, never shrunk.
- One value per table column: customer code and customer name are separate columns; every code is a
  `C · Mã` chip with a copy icon.
- Money figures come from the server and follow the FR-13 formula; estimates say "khoảng" and carry
  the "ước tính" tag.
- No deals (D29).
