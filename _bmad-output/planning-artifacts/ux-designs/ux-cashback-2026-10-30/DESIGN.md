---
name: Hoàn Tiền DP
description: One design system for the cashback platform (hoantiendp.com). Customer website, admin desk, share page and receipt page. shadcn/ui on React + Tailwind; this file specifies the brand delta over shadcn defaults.
status: final
updated: 2026-10-30
sources:
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/prd.md
  - _bmad-output/planning-artifacts/prds/prd-cashback-2026-10-30/addendum.md
  - .claude/skills/cashback-shadcn/SKILL.md
  - .claude/skills/cashback-ui-review/SKILL.md
experience: EXPERIENCE.md
colors:
  # shadcn role overrides. Light theme is the only theme in v1. Dark pairs
  # (`<token>-dark`) are reserved names, to be added when dark mode ships.
  background: '#F8FAFC'
  foreground: '#0F172A'
  card: '#FFFFFF'
  card-foreground: '#0F172A'
  popover: '#FFFFFF'
  popover-foreground: '#0F172A'
  primary: '#047857'
  primary-foreground: '#FFFFFF'
  primary-active: '#065F46'
  secondary: '#ECFDF5'
  secondary-foreground: '#065F46'
  muted: '#F1F5F9'
  muted-foreground: '#5A6475'
  accent: '#F1F5F9'
  accent-foreground: '#0F172A'
  border: '#E2E8F0'
  input: '#7B8798'
  ring: '#10B981'
  destructive: '#B91C1C'
  destructive-foreground: '#FFFFFF'
  brand-mark: '#059669'
  # Brand-specific tokens with no shadcn slot.
  money: '#047857'
  money-soft: '#ECFDF5'
  warning: '#92400E'
  warning-soft: '#FEF3C7'
  attention: '#7C2D12'
  attention-soft: '#FFF7ED'
  # Status tones. One pair per tone; EXPERIENCE.md maps every status to one tone.
  status-waiting: '#92400E'
  status-waiting-soft: '#FEF3C7'
  status-approved: '#1D4E89'
  status-approved-soft: '#E8EFF8'
  status-done: '#334155'
  status-done-soft: '#E2E8F0'
  status-rejected: '#9F1239'
  status-rejected-soft: '#FFE4E6'
  status-attention: '#7C2D12'
  status-attention-soft: '#FFF7ED'
  status-neutral: '#5A6475'
  status-neutral-soft: '#F1F5F9'
  # Sidebar (admin desk).
  sidebar: '#FFFFFF'
  sidebar-foreground: '#0F172A'
  sidebar-accent: '#ECFDF5'
  sidebar-accent-foreground: '#065F46'
  sidebar-border: '#E2E8F0'
  # Charts (the Overview). Fixed order: profit, cashback, event bonus, fee and tax;
  # validated with the dataviz validator (all pairs, light, on #FFFFFF), Sprint 19.
  chart-1: '#047857'
  chart-2: '#2F6CB3'
  chart-3: '#C2410C'
  chart-4: '#8B5CF6'
typography:
  # One family everywhere. Be Vietnam Pro (Google Fonts, latin + vietnamese
  # subsets, weights 400/500/600/700) with a system fallback that renders
  # Vietnamese diacritics correctly. Every money and count figure uses
  # tabular figures (font-variant-numeric: tabular-nums).
  display:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  title:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.3'
  heading:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 16px
    fontWeight: '600'
    lineHeight: '1.4'
  body:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.55'
  body-dense:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
  caption:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.4'
  money-lg:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.15'
    letterSpacing: -0.01em
  money-md:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.3'
  money-sm:
    fontFamily: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.4'
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  # Tailwind 4-based scale inherited (4, 8, 12, 16, 20, 24, 32, 40, 48, 64).
  # Named tokens below are the only additions.
  gutter-phone: 16px
  gutter-tablet: 24px
  gutter-desktop: 32px
  touch-target: 44px
  control-comfortable: 44px
  control-dense: 36px
  control-dense-sm: 32px
  row-dense: 44px
  row-comfortable: 56px
  content-customer: 640px
  content-admin: 1440px
  sidebar-width: 240px
  rail-width: 64px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    background-active: '{colors.primary-active}'
    radius: '{rounded.lg}'
    height-customer: '{spacing.control-comfortable}'
    height-admin: '{spacing.control-dense}'
  button-secondary:
    background: '{colors.secondary}'
    foreground: '{colors.secondary-foreground}'
    radius: '{rounded.lg}'
  button-zalo:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.lg}'
    height: '{spacing.control-comfortable}'
    icon: 'zalo glyph from the icon module, left of the label'
  money-figure:
    foreground: '{colors.money}'
    fontVariantNumeric: tabular-nums
    typography: '{typography.money-md}'
  money-figure-estimate:
    foreground: '{colors.money}'
    fontVariantNumeric: tabular-nums
    fontWeight: '400'
    tag: '{components.estimate-tag}'
  estimate-tag:
    background: '{colors.muted}'
    foreground: '{colors.muted-foreground}'
    typography: '{typography.caption}'
    radius: '{rounded.sm}'
  balance-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    hero-figure: '{typography.money-lg}'
  status-badge:
    radius: '{rounded.full}'
    typography: '{typography.caption}'
    fontWeight: '500'
    height: 22px
    tones: 'waiting | approved | done | rejected | attention | neutral; text colour status-<tone> on fill status-<tone>-soft'
  flag-badge:
    background: '{colors.attention-soft}'
    foreground: '{colors.attention}'
    radius: '{rounded.sm}'
    typography: '{typography.caption}'
  guest-warning:
    background: '{colors.warning-soft}'
    foreground: '{colors.warning}'
    border-left: '4px solid {colors.warning}'
    radius: '{rounded.lg}'
  zalo-down-banner:
    background: '{colors.warning-soft}'
    foreground: '{colors.warning}'
    radius: '0'
  data-table:
    header-background: '{colors.muted}'
    header-typography: '{typography.label}'
    row-height: '{spacing.row-dense}'
    cell-typography: '{typography.body-dense}'
    row-border: '1px solid {colors.border}'
    numeric-align: right
  data-list-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    padding: '{spacing.gutter-phone}'
  filter-chip:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    background-selected: '{colors.secondary}'
    foreground-selected: '{colors.secondary-foreground}'
    radius: '{rounded.full}'
    count-typography: '{typography.caption}'
  list-loading-dim:
    opacity: '0.55'
    progress-bar: '2px {colors.primary} at the top edge of the list'
  stale-banner:
    background: '{colors.attention-soft}'
    foreground: '{colors.attention}'
    radius: '{rounded.md}'
  qr-panel:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    qr-size: 220px
  payout-confirm:
    button: '{components.button-primary}'
    amount: '{typography.money-md}'
  order-progress:
    track: '{colors.muted}'
    step-done: '{colors.primary}'
    step-current: '{colors.primary}'
    step-rejected: '{colors.status-rejected}'
    height: 4px
  masked-account:
    typography: '{typography.code}'
    format: '•• 1234'
  receipt-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    amount: '{typography.money-lg}'
  today-tile:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.xl}'
    count-typography: '{typography.title}'
  health-dot:
    ok: '{colors.primary}'
    degraded: '{colors.status-waiting}'
    down: '{colors.destructive}'
    size: 10px
  empty-state:
    headline: '{typography.heading}'
    body: '{typography.body-dense}'
    foreground: '{colors.muted-foreground}'
  bottom-tab-bar:
    background: '{colors.card}'
    border-top: '1px solid {colors.border}'
    item-height: 56px
    active: '{colors.primary}'
---

## Brand & Style

Hoàn Tiền DP gives shoppers part of an affiliate commission back. People arrive from a Zalo chat, on a phone, often inside Zalo's own browser, and the first question in their head is "is this real?". The visual answer is calm and plain: the look of a careful bank statement, not a flash sale. Nothing shouts, nothing blinks, nothing is orange. Shopee and TikTok are the places people buy; this is the quiet place where they check their money.

The system has two moods on one set of tokens. The **customer website** breathes: one column, large type, one clear action per screen. The **admin desk** is a work tool for one operator and a few employees: dense tables, compact controls, everything one click away. The share page `/s/<code>` and the receipt page `/b/<token>` are server-rendered HTML and use the same tokens through a small generated CSS file, so a receipt looks like it came from the same place as the website.

This file is the brand delta over shadcn/ui (Radix base). Every token not listed inherits from shadcn. The shadcn style for geometry is `nova` (compact controls, 6 to 8 px radii, hairlines over shadows); the customer site raises control heights to `{spacing.control-comfortable}`.

## Colors

Three colours carry meaning; everything else is slate grey.

- **Hoàn Tiền Green (`#047857`, `{colors.primary}`, mark `#059669`)** is the existing brand of hoantiendp.com (`web/src/index.css`, `share_page.py`, `logo-mark.webp`), kept on purpose so returning customers recognise the site. Emerald-700 is used for primary buttons, the active navigation item, links and the order progress bar because it reaches 5.5:1 on white; the lighter `#059669` (3.8:1) appears only in the logo mark and large decorative brand areas, never behind small text.
- **Money is the brand.** Cashback amounts (`{colors.money}`, the same emerald-700) are the one place green is used for data: the payable balance, an order's cashback, a payout amount. A cashback product owns green; the status tones therefore never use green, so a green figure is always money and a green control is always the main action.
- **Caution Amber (`#92400E` on `#FEF3C7`, `{colors.warning}`)** marks the two warnings a customer must not miss: a guest link earns no cashback, and the Zalo assistant is down. It is also the "waiting" status tone.
- **Slate neutrals.** `{colors.background}` `#F8FAFC` is the page; `{colors.card}` white sits on it. `{colors.foreground}` `#0F172A` for text, `{colors.muted-foreground}` `#5A6475` for secondary text and the grey dash of a missing value (6.0:1 on white, 5.5:1 on muted). `{colors.border}` `#E2E8F0` for dividers; `{colors.input}` `#7B8798` for form control borders (3.6:1, meets the 3:1 non-text rule).
- **Status tones.** Six text-on-tint pairs (`status-waiting`, `status-approved`, `status-done`, `status-rejected`, `status-attention`, `status-neutral`). Every pair is at least 6.3:1. EXPERIENCE.md maps each status to exactly one tone. Paid uses the calm `status-done` slate, approved uses ledger blue (`#1D4E89`), never green, because green is reserved for the brand and amounts.
- **Destructive (`#B91C1C`)** for void, erase and error text. 6.5:1 on white.

Avoid: gradients, brand-coloured backgrounds behind long text, a second accent colour, green used for "success", red used for amounts.

## Typography

One family: **Be Vietnam Pro**, designed for Vietnamese, loaded from Google Fonts with the `vietnamese` subset and weights 400, 500, 600, 700, `font-display: swap`. The fallback stack (`-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial`) renders stacked diacritics (ặ, ổ, ữ) correctly, so a slow font load inside the Zalo browser never shows broken text.

- `display` (28 px) appears once per customer screen at most: the hero headline on Home.
- `money-lg` (32 px, bold) is the payable balance on My money and the amount on the receipt page.
- `money-md` and `money-sm` are amounts in cards and table cells.
- `body` (16 px) is the customer default and never goes smaller on phone, which also stops iOS zooming into inputs. `body-dense` (14 px) is the admin default.
- `code` (monospace) for customer codes, order ids, share codes and masked account numbers.

Every money and count figure sets `font-variant-numeric: tabular-nums`, so columns of amounts line up and a balance does not jitter when it updates. Amounts are formatted by one formatter: whole dong, dot as the thousands separator, the sign "đ" from the label file, no space: `79.216đ`.

### Responsive type scale

One scale, three steps. Sizes change at the breakpoints, never with viewport units. Line length
stays between 45 and 75 characters on the customer site.

| Role | Phone 360-767 | Tablet 768-1279 | Desktop 1280+ | Weight | Line height |
|---|---|---|---|---|---|
| Display (home headline) | 30 | 38 | 44 | 700, tracking -2% | 1.12-1.15 |
| Page title | 26 | 30 | 32 | 700, tracking -1.5% | 1.2 |
| Section heading | 18 | 20 | 20 | 700 | 1.3 |
| Item title (product, order) | 15 | 15 | 15 | 600 | 1.35 |
| Body | 15 | 16 | 16 | 400 | 1.5 |
| Secondary / meta | 13 | 14 | 14 | 400 | 1.45 |
| Caption, badge, tag | 12 | 12 | 12 | 500 | 1.35 |
| Money hero (payable balance) | 40 | 44 | 44 | 700, tracking -2.5%, tabular | 1.1 |
| Money in a line (estimate, row) | 15-24 | 15-24 | 15-24 | 600-700, tabular | 1.2 |
| Admin table cell | 14 | 13 | 13 | 400-600 | 1.4 |

Rules: nothing on phone below 12 px, body never below 15 px on phone; one display size per screen;
a label and its amount never share a line on phone when either can wrap (stack them); long URLs and
product names truncate with an ellipsis instead of wrapping into actions.

## Layout & Spacing

The Tailwind 4-based scale is inherited. Breakpoints follow cashback-shadcn: phone 360 to 767 px, tablet 768 to 1279 px, desktop 1280 px and up.

- **Customer website.** One column, max width `{spacing.content-customer}` (640 px), centred on tablet and desktop. Side gutter `{spacing.gutter-phone}` on phone, `{spacing.gutter-tablet}` above. Controls are `{spacing.control-comfortable}` (44 px) tall at every width.
- **Admin desk.** Sidebar `{spacing.sidebar-width}` on desktop, icon rail `{spacing.rail-width}` on tablet, bottom tab bar on phone. Content max width `{spacing.content-admin}`. Controls `{spacing.control-dense}` (36 px) with a mouse; on touch devices (`pointer: coarse`) every control and row rises to `{spacing.touch-target}`.
- **Tables.** Row height `{spacing.row-dense}`. On phone, tables become stacked `data-list-card`s; the page never scrolls sideways.

## Elevation & Depth

Hairlines, not shadows. Cards are white on the slate page with a `{colors.border}` line. shadcn's shadow remains only on floating layers (popover, dropdown, dialog, sheet) so they read as above the page. No hover lift on cards.

## Shapes

`{rounded.lg}` (8 px) for buttons and inputs, `{rounded.xl}` (12 px) for cards, sheets and dialogs, `{rounded.md}` (6 px) for menu items and banners, `{rounded.sm}` (4 px) for small tags. `{rounded.full}` only on status badges, filter chips and avatars. The QR code sits in a square white well with `{rounded.xl}` corners and a quiet zone of at least 16 px.

## Components

shadcn components used unchanged: Button (outline, ghost, destructive variants), Input, Textarea, Select, Checkbox, RadioGroup, Switch, Label, Form, Card, Dialog, AlertDialog, Sheet, Drawer, Popover, DropdownMenu, Tooltip, Tabs, Separator, Skeleton, Sonner toasts, Table, Pagination, Command, Calendar, Avatar, Badge (as the base of `status-badge`).

Brand-layer components:

- **Button (primary)** — `{colors.primary}` fill, white text, `{rounded.lg}`. 44 px on the customer site, 36 px on the admin desk with a mouse. One primary button per screen region.
- **Zalo button** — Primary styling plus the Zalo glyph. The main action whenever the customer must go to the assistant (guest link, `web_busy`, no code, forgot password). Opens `https://zalo.me/<assistant>`.
- **Money figure** — `{colors.money}`, tabular, `money-md` by default. The estimate variant keeps the green but drops to weight 400, is prefixed "khoảng" (about) and carries an `estimate-tag` "ước tính" (estimate). A missing amount is a `{colors.muted-foreground}` dash "–", never 0đ and never blank.
- **Balance card** — Customer My money. One `money-lg` hero figure (payable balance) and two `money-sm` secondary figures (waiting, paid), each with its label above. White card, `{rounded.xl}`.
- **Status badge** — Pill, caption size, medium weight, tone pair from `{colors.status-*}`. Always text; an optional 12 px icon on the left for paid (check) and rejected (cross). Colour is never the only signal.
- **Flag badge** — Square-cornered `{colors.attention}` tag for admin flags: "Chưa có STK", "Mới đổi STK", "Chờ xác nhận STK", fraud flags.
- **Guest warning** — Amber panel with a 4 px left rule, heading weight title, one sentence of body, the Zalo button inside it. Sits above the guest link, never below the fold.
- **Zalo-down banner** — Full-width amber strip under the top bar on every customer page while the assistant is down, with the fallback contact path.
- **Data table** — shadcn Table with TanStack Table. Muted header, `label` header text, `body-dense` cells, right-aligned numeric columns, sort arrow beside the active header, sticky header. Visual states in `list-loading-dim` and `stale-banner`.
- **Data list card** — The phone form of a table row: identity line (bold) and status badge on top, amount right-aligned, one labelled date, secondary facts in caption.
- **Filter chip** — Pill with a label and a tabular count, e.g. "Chờ sàn duyệt 312". Selected chip uses `{colors.secondary}` fill and `{colors.secondary-foreground}` text plus a check icon.
- **List loading dim** — Previous rows at 55% opacity under a 2 px `{colors.primary}` progress line at the top edge.
- **Stale banner** — Attention strip above a list: "Dữ liệu lúc 19:42, chưa tải lại được" with a retry button.
- **QR panel** — 220 px VietQR image in a white well, the amount in `money-md` under it, bank name, masked account, holder name and transfer reference in `code`.
- **Payout confirm** — A primary button that states the amount: "Xác nhận đã chuyển 79.216đ". Disabled until the server preview has loaded.
- **Order progress** — Three-step 4 px bar (recorded, approved, paid) in `{colors.primary}`; a rejected order shows a full `{colors.status-rejected}` bar with the reason text.
- **Masked account** — Only the last four digits, `•• 6789`, in `code`.
- **Receipt card** — Centred card on the receipt page: customer code, amount in `money-lg`, date, bank and masked account, proof image thumbnail.
- **Today tile** — Admin card with a count in `title` size, a one-line label and a link to the list it counts.
- **Health dot** — 10 px dot plus a word (never the dot alone): blue "Ổn" (fine), amber "Chậm" (slow), red "Mất kết nối" (disconnected). Green is not used, because green means money.
- **Empty state** — Heading-size line in muted text, one sentence, at most one action.
- **Link converter** — Customer card on Home: URL input at `{spacing.control-comfortable}` with a paste button inside its right edge, optional customer-code input below (code typography), primary submit full width on phone. Supported networks in caption under the input.
- **Link result card** — White card: product name in `heading`, price in `body` ink, the estimated cashback as `money-figure-estimate`, then two buttons (primary "open", outline "copy"). The guest variant puts `guest-warning` first and demotes "open" to outline.
- **Zalo hand-off panel** — Same box as `guest-warning` but in `{colors.secondary}` fill with `{colors.secondary-foreground}` text: it is guidance, not a warning. One sentence and the Zalo button.
- **Bank account card** — White card, label in `label` muted, bank name in `heading`, `masked-account`, holder name in caption. The "missing" variant uses `guest-warning` styling with a primary button; the "pending confirmation" line is `{colors.warning}` caption text.
- **Bank account form** — shadcn Form inside a card; the bank picker is a Command popover (Drawer on phone) listing bank short name and full name; account number input uses `code` typography.
- **Order card** — A `data-list-card` with the product name in `heading` (two lines max), network and price in caption, `status-badge` top right, `order-progress` with step labels in 11 px caption, a labelled date bottom left, the amount bottom right in `money-figure` or `money-figure-estimate`.
- **Share page** — Server-rendered single card centred at 480 px: product name, price, the cashback line in `money-figure-estimate` at `money-md`, primary button; the in-app guide as numbered steps with a screenshot-free text instruction and a copy-link outline button.
- **Payout panel** — shadcn Sheet 480 px (Drawer on phone) holding, top to bottom: title with customer code, `qr-panel`, the covered lines as a compact table with right-aligned `money-figure`, the proof drop zone (dashed `{colors.input}` border, `{rounded.xl}`), `payout-confirm`, and a caption hint.
- **Review case panel** — Sheet with a read-only key/value list (`body-dense`, keys muted), the candidate customer card, and a two-button footer (primary apply, outline dismiss); the reason Textarea sits above the footer.
- **Merge proposal** — Two equal columns of key/value lists; differing fields get an `{colors.attention-soft}` row fill; a blocking difference (bank account) shows a destructive-text line above the disabled confirm.
- **Campaign slot meter** — Segmented bar of N slots: paid `{colors.status-done}`, confirmed `{colors.status-approved}`, held `{colors.status-waiting}`, free `{colors.muted}`; counts in caption beneath with tabular figures.
- **Campaign form** — shadcn Form; date-time inputs carry a caption suffix "(giờ Việt Nam)"; the server preview line sits in a `{colors.muted}` box above the save button.
- **Withheld period toggle** — shadcn Switch in a settings row: period label left, switch right, the affected-order count in caption under the label.
- **Metric card** — `today-tile` geometry; the value in `title`, the "not enough data" state uses `estimate-tag` styling and `{colors.muted-foreground}` for the value.
- **Payout claim marker** — In place of the row action: italic caption in `{colors.muted-foreground}` naming the staff member, "Tú đang chuyển". The row keeps its normal fill.
- **Bottom tab bar** — Customer phone (3 items) and admin phone (4 items plus "Thêm" (more)); 56 px items, active item in `{colors.primary}` with a label, icon above label.

→ Visual references: [mockups/key-my-money-phone.html](mockups/key-my-money-phone.html), [mockups/key-payouts-desktop.html](mockups/key-payouts-desktop.html), [mockups/key-orders-list-contract.html](mockups/key-orders-list-contract.html). The spines win on any conflict with a mock.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use `{colors.money}` for cashback amounts only | Use green for buttons, success toasts or the paid badge |
| Format every amount with the one formatter: `79.216đ` | Show decimals, "VND", "79,216" or a space before "đ" |
| Put an example amount in dong beside every percentage | Show "80%" alone |
| Show a grey dash for a missing value | Show 0đ, a blank cell or a placeholder number |
| Use tabular figures for money and counts | Use proportional figures in tables or balance cards |
| Keep one primary button per region | Put two Zalo calls to action plus a floating Zalo button on one page |
| Inherit shadcn components unchanged where listed | Restyle Dialog, Sheet or Select per screen |
| Raise touch controls to 44 px on `pointer: coarse` | Ship 32 px admin controls to a phone |
| Use Be Vietnam Pro with the full fallback stack | Use a font without Vietnamese glyphs |
| Use emoji-free text and icons from one icon module | Put emoji in labels or headings |
