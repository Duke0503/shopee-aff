---
name: cashback-ui-review
description: >-
  The cashback platform's UI and UX review skill. Use when reviewing a screen design (wireframe or
  mock-up) or a built screen of the customer website or the admin desk for usability,
  accessibility, interface quality, money clarity and the project's own rules, on phone, tablet and
  desktop. Reports findings with severity and fixes; does not change product code or DESIGN.md.
---

# Cashback UI review

One review that combines five sources with the project's own checks. Read-only: it reports
findings; another step applies them.

## Inputs

- What to review: a wireframe frame (read it through the design tool's MCP tools when one is
  connected, never by parsing the design file), a screenshot, or source files of a built screen.
- The design contract: `DESIGN.md` and `EXPERIENCE.md` from `bmad-ux`, and the PRD, in the
  workspaces listed in `docs/index.md`.

## Procedure

1. Name the screen, its surface (customer website or admin desk) and the user journey it serves
   (the PRD's journey ids).
2. Review it at all three widths: phone (360 to 767 px), tablet (768 to 1279 px), desktop (1280 px
   and up), and for touch as well as mouse and keyboard. A screen missing a width is a finding.
   Customer screens are also checked inside the Zalo in-app browser.
3. Run each lens and collect findings:
   - **Project checks** (below). Always first.
   - **Usability:** [references/ux-heuristics/ux-heuristics.md](references/ux-heuristics/ux-heuristics.md)
     with its references (Nielsen, Krug, dark patterns, cultural UX, audit template).
   - **Accessibility:** [references/accessibility/accessibility.md](references/accessibility/accessibility.md)
     (WCAG 2.2) with its references.
   - **Interface rules:** [references/web-interface-guidelines.md](references/web-interface-guidelines.md)
     (Vercel). For built screens only where the rule concerns code.
   - **Data-dense work screens** (admin desk): [references/app-screens.md](references/app-screens.md).
   - **Consistency with the design contract:** the method in
     [references/improve-ui.md](references/improve-ui.md): every finding cites the `DESIGN.md` or
     `EXPERIENCE.md` rule it breaks, or is marked as a gap in those documents. Ignore its
     instruction to write into `design-plans/`; reviews report in the conversation or in the file
     the caller names.
4. Rate each finding: critical (blocks a journey, or misleads about money), high, medium, low.
5. Report: one-line verdict, then findings grouped by severity, each with the width it affects,
   where it is, the rule it breaks, and the fix.

## Project checks

1. **Money truth.** Estimated and approved commission are never confused. An estimate is labelled
   as an estimate. Paid, approved, waiting and cancelled amounts are visibly different states.
2. **Example amount.** Every percentage shown to a customer has a worked amount in dong beside it.
3. **No promised date.** Messages and screens never promise when a payout arrives; the operator
   decides when to pay.
4. **Guest warning.** A guest link says plainly that it earns no cashback, and offers the Zalo path
   to a customer code as the main action.
5. **Blocked payout.** A missing bank account is shown as the one thing the customer must fix, with
   a direct action to add it.
6. **Numbers.** Whole dong with thousands separators, tabular figures, right aligned in tables. A
   missing value is a grey dash.
7. **Admin accountability.** A payout, a manual adjustment or a customer merge shows the server's
   own figures before confirmation, and asks for confirmation once.
8. **Every device.** All features reachable at every width; no sideways page scroll; touch targets
   at least 44 by 44 px; dialogs usable on phone.
9. **Language.** All UI text is Vietnamese, comes from the label file, and is plain and short. No
   hard-coded string, no emoji in code.

## Licenses

All sources are MIT. See [LICENSES/](LICENSES/) and [UPSTREAM.md](UPSTREAM.md).
