---
name: cashback-shadcn
description: >-
  The cashback platform's UI build skill. Use when building or styling the customer website or the
  admin desk with React, TypeScript, Tailwind and shadcn/ui: turning DESIGN.md into a themed shadcn
  setup and design-system page, adding or composing components, forms, navigation, tables
  (TanStack Table) and data fetching (TanStack Query), and making every screen work on phone,
  tablet and desktop.
---

# Cashback UI with shadcn/ui

This skill adapts the official shadcn skill to the cashback platform. Read the project rules below
first; they win over the upstream references where they differ.

- [references/shadcn.md](references/shadcn.md): the official skill (project context, composition,
  critical rules).
- [references/design-system.md](references/design-system.md) and
  [references/design-system-page.md](references/design-system-page.md): turn a `DESIGN.md` into
  tokens, a theme and a design-system page. The helpers it mentions are in
  [references/assets/showcase/](references/assets/showcase/) and
  [references/scripts/showcase-coverage.mjs](references/scripts/showcase-coverage.mjs).
- [references/rules/](references/rules/): styling, composition, forms, icons, Base UI versus Radix.
- [references/cli.md](references/cli.md), [references/customization.md](references/customization.md),
  [references/registry.md](references/registry.md), [references/mcp.md](references/mcp.md).
  The upstream chat rules are left out; customer chat happens in Zalo, not on the website.

Product sources: the PRD and the UX documents `DESIGN.md` and `EXPERIENCE.md` written by
`bmad-ux`, in the workspaces listed in `docs/index.md`. This skill reads them and never writes them.

## Project rules

1. `DESIGN.md` is the source of tokens, type, color and spacing. Do not invent a value the design
   system does not define; propose an addition to `DESIGN.md` instead.
2. Two surfaces, one design system. The **customer website** is phone-first and calm: most
   customers arrive from a Zalo chat on a phone. The **admin desk** is a dense work tool: compact
   controls on desktop, tables first.
3. **The frontend never calculates money.** Every amount comes from the server, already rounded.
   The UI formats it only: whole dong, thousands separators, the currency sign from the label file.
4. **A percentage always comes with an example amount in dong**, supplied by the server. A
   percentage alone is misread as a share of the price.
5. Numbers in tables use tabular figures and are right aligned. A missing value is a grey dash,
   never a blank or a zero.
6. A guest link (`house: true`) shows a clear warning that it earns no cashback, and the main
   action is to get a customer code through Zalo. A `web_busy` (429) answer sends the customer to
   Zalo, which has no web quota.
7. Tables use TanStack Table with shadcn table components. Server state comes through TanStack
   Query in `*.queries.ts` files; components never call `fetch()`.
8. **No customer-facing text in code.** Vietnamese labels live in `resources/dashboard.vi.json`,
   customer messages in `resources/messages.vi.json`. Code, identifiers and comments are English.
   No emoji in `.ts`/`.tsx`.
9. Icons come from one icon module. Request bodies are validated with Zod.

### Every device

10. Design and build each screen for three widths: phone (360 to 767 px), tablet (768 to 1279 px),
    desktop (1280 px and up). A feature may be simplified on a small screen, never missing.
11. Mobile-first Tailwind classes, with breakpoints matching the three widths above.
12. Navigation: a bottom bar or sheet on phone, a sidebar or top bar on tablet and desktop, as
    `EXPERIENCE.md` defines.
13. Tables become stacked cards or a scrollable table with a pinned first column on phone; never
    a page that scrolls sideways.
14. Touch targets are at least 44 by 44 px on touch devices, even where desktop controls are compact.
15. Dialogs become sheets or drawers on phone.
16. The website works inside the Zalo in-app browser. Anything that needs a real browser (opening
    an affiliate link) follows the share-link rules in `EXPERIENCE.md`.

## License

shadcn/ui is MIT. See [LICENSE.md](LICENSE.md) and [UPSTREAM.md](UPSTREAM.md).
