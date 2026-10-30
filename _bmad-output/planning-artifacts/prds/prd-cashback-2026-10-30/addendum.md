# Addendum: Cashback Platform PRD

Depth that belongs to downstream documents (UX, architecture), kept here so it is not lost.

## A. Audit of the current customer website (input for UX)

- Pages: home with link converter (`web/src/features/Home.tsx`, 968 lines), my orders
  (`CustomerView.tsx` and children), login, guide, profile menu with password and bank modals.
  The share page `/s/<code>` and the receipt page `/b/<token>` are server-rendered HTML inside
  Python (`share_page.py`, `dashboard.py`).
- Problems to design away:
  - The home page promises "automatic transfer to your account 24/7", which contradicts D11 and the
    manual payout.
  - Two Zalo calls to action plus a floating button; many footer links are placeholders pointing at
    `/guide`.
  - Converter logic duplicated in Home and LinkGenerator with raw `fetch` calls.
  - Hard-coded Vietnamese in components despite 447 keys in `resources/dashboard.vi.json`; the
    bundled copy `defaultLabels.json` has drifted.
  - Dead components: DealsSection (fake deals), PayoutCard, ChangePassword, ZaloCommunityBanner.
  - Fallback figures ("50%", "30 days") disagree with the docs.

## B. Audit of the current admin desk (input for UX)

- Tabs: Dashboard (KPIs), Payments and VietQR (2,489 lines), Campaigns, Orders, Customers, Product
  cache, Staff and roles, Activity logs.
- Problems: the payments screen has a "show awaiting orders (test)" toggle that lets staff pay
  orders that are not approved; a Google Apps Script is embedded as a string; the dashboard is a
  wall of KPIs with no "what needs me today" view.

## C. Earlier v2 attempt (reference)

- `apps/admin` already had a payables table, payout dialog with VietQR, record-transfer, customer
  detail and orders table, each under 300 lines. `planPayout` already enforced D19.
- `packages/money` already held one money implementation with golden tests.
- `packages/ui` had only a Shopee-orange token set and one button.

## D. Business facts (input for metrics)

- Customer share: 80% of net commission (D12, D20). Older docs say 70% or 72%; those are superseded.
- Shopee fee 0.98% from the 2025-07-16 period; 10% personal income tax withheld on payouts of
  2,000,000 dong or more; the rate is locked when the buyer places the order.
- Returning buyers earn about 1 to 3% commission, new buyers 5 to 13% (reference only).
- Real usage figure: 57 customers in the last real-data copy. Plans assume about 30 orders a day.
- Growth: Zalo group (100 members, then a Community of 1,000), campaigns, group announcements.

## E. Candidate mechanisms (for architecture)

- AccessTrade link creation through the API, sub1 = customer id, sub2 = request id, under 500 ms.
- AccessTrade postback webhook as a faster alternative to hourly polling (not built).
- Owner alerts through Telegram with cooldowns (critical 5 min, high 15, warning 30).
