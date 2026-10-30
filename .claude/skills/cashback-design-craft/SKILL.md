---
name: cashback-design-craft
description: >-
  Visual craft for the cashback platform: makes screens look designed by a professional, not
  generated. Use when designing or reviewing any screen of the customer website, the admin desk,
  the share page or the receipt page, in pen.dev or in code: brand use, layout, typography, colour,
  responsive behaviour on every device, and the anti-"AI look" checks. Works together with
  cashback-shadcn (build rules), cashback-ui-review (review) and ui-ux-pro-max (style data).
---

# Cashback design craft

Combines Anthropic's `frontend-design` skill and selected `impeccable` playbooks with the project's
own rules. The project rules below win wherever they differ. The impeccable command-line engine is
**not** installed (it downloads a binary); use its playbooks as reading only and ignore every
`impeccable <verb>` command in them.

- [references/frontend-design.md](references/frontend-design.md): commit to one clear direction
  before drawing; avoid default fonts, purple gradients and predictable layouts.
- [references/impeccable/](references/impeccable/): `craft.md`, `craft-floor.md` (minimum quality
  bar), `layout.md`, `typeset.md`, `colorize.md`, `adapt.md` (responsive), `polish.md`, `quieter.md`,
  `clarify.md`, `harden.md` (edge cases), `distill.md`, `critique.md`, `audit.md`, and the three
  surface modes: `mode-persuade.md` (home page), `mode-operate.md` (admin desk, My money),
  `mode-read.md` (guide, receipt).
- `ui-ux-pro-max` skill: search its style, colour, font and UX data, e.g.
  `python .claude/skills/ui-ux-pro-max/scripts/search.py "fintech cashback" --design-system`.
  Treat its output as suggestions; `DESIGN.md` decides.

Product sources: `DESIGN.md` and `EXPERIENCE.md` in the UX workspace listed in `docs/index.md`,
and the brand assets listed below.

## Project rules

### Brand

1. Reuse the existing brand: the logo, mascot and brand name from the live site (see "Brand
   assets"). Never redraw the logo or the mascot out of shapes. Never invent a new logo.
2. The mascot appears only where it already has a job: sign in, empty states, the guest warning,
   the receipt page. Never as decoration on a working screen of the admin desk.
3. Colour has meaning. Money green is only for cashback amounts. Status tones come from the status
   registry in `EXPERIENCE.md`. The brand colour is for primary actions and the brand mark.

### Not looking generated

4. One dominant region per screen. The customer's money, or the one task, is the largest thing.
   No grid of equal cards.
5. Do not wrap every element in a card. Use rules, spacing and alignment to group; a container must
   have a job (a form, a selectable row, a panel).
6. Real content only: real product names, real amounts that follow the money formula, real
   Vietnamese copy from the label file style. No lorem ipsum, no "John Doe", no round fake numbers.
7. Type does the hierarchy: few sizes, strong weight contrast, tabular figures for money. No more
   than one display size per screen.
8. No gradients, glows, glassmorphism, emoji or decorative blobs. One shadow level for floating
   layers only (sheet, popover, toast).
9. Icons are Lucide, at one stroke width, always with a text label on primary actions.

### Copy that means something

10a. Every line says something the reader can check or act on: an amount in dong, what happened,
     or the next step. "Bạn nhận lại khoảng 9.263đ", "Đơn được duyệt, chờ mình chuyển tiền".
10b. No filler or marketing vapour: no "trải nghiệm tuyệt vời", "giải pháp toàn diện", "nhanh chóng,
     tiện lợi, an toàn", "nâng tầm", "tối ưu hoá", "hành trình", "khám phá ngay", stacked adjectives
     or slogans that could sit on any website.
10c. Keep the live brand voice from `resources/dashboard.vi.json`: the assistant speaks as "mình",
     the customer is "bạn"; short, frank sentences ("Nói trước là điều kiện. Nói sau là bào chữa.").
10d. Headings name the thing ("Tiền của tôi", "Cần chuyển hôm nay"), not a feeling. Buttons are a
     verb plus the object ("Lấy link hoàn tiền", "Xác nhận đã chuyển 79.216đ"), never "Tiếp tục" alone.
10e. No exclamation marks, no emoji, no capitals for emphasis, no promise of a payout date or speed.

### Every device

10. Design each screen at phone 360 to 430 px (draw at 390), tablet 768 to 1024 px (draw at 820),
    desktop 1280 px and up (draw at 1440). A screen missing a width is not finished.
11. Responsive means re-composed, not shrunk: the phone gets a single column, bottom navigation,
    sticky primary action and stacked cards; the tablet gets an icon rail or two columns; the
    desktop gets a sidebar and tables. The same figures appear at every width (EXPERIENCE.md M-8).
12. Touch targets are at least 44 by 44 px on phone and tablet. Text never below 13 px on phone.
13. Customer pages also work inside the Zalo in-app browser (no hover-only actions, safe areas).

### Built with the project's libraries

14. Every element maps to a shadcn/ui component (Button, Input, Card, Badge, Tabs, Sheet, Drawer,
    Dialog, AlertDialog, Select, Command, Table, Sonner) or to a project component named in
    `EXPERIENCE.md` (DataList, Balance card, Payout panel...). A design element with no component
    behind it is a new component and must be named in `DESIGN.md`.
15. Tokens come from `DESIGN.md` as Tailwind and shadcn CSS variables. In pen.dev the same tokens
    are document variables with the same names.

## Brand assets

Filled in from the repository inventory (`web/public`, `src/cashback/web/static`). Paths and usage
are listed in `references/brand-assets.md`.

## Licenses

Anthropic `frontend-design` and `impeccable` are Apache-2.0; `ui-ux-pro-max` is MIT. See
[LICENSES/](LICENSES/) and [UPSTREAM.md](UPSTREAM.md).
