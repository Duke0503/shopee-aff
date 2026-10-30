# Cashback / Rebate UX Patterns: Competitive Research

Date: 2026-10-30. Scope: link-based affiliate cashback for hoantiendp.com (Shopee + TikTok Shop, Zalo-first, mobile, 80% of approved commission paid by bank transfer). Deals/coupons pages are out of scope.

Method: web search (standard; extended for the Vietnam sweep), plus fetches of primary help-centre pages where reachable. Figures marked "reported" come from third-party reviews or company PR and were not verified independently. Two TopCashback help URLs returned 404 on fetch, so their status wording comes from search snippets.

## Status of the candidates (verified Oct 2026)

| Product | Status |
|---|---|
| Rakuten (US) | Active |
| TopCashback (UK/US/AU) | Active |
| Quidco (UK) | Active |
| ShopBack (APAC, US since May 2025) | Active; ~50-60M users across 13 markets (company PR) |
| ShopBack Vietnam | Launched 2019/2020. Last data found ~2023. **No source confirms a closure**; current status unverified |
| Cashrewards (AU) | **Closed Sept 2025** (~2M members); withdrawal window ended Oct 2025 |
| Dosh (US, card-linked) | **Closed 28 Feb 2025** (Cardlytics decommissioned it) |
| Honey / PayPal Honey | Active but damaged: 2025 affiliate-hijack scandal, ~8M Chrome users lost (reported) |
| Capital One Shopping | Active; gift-card-only redemption |
| Swagbucks, Fetch, Ibotta | Active; points- or receipt-based |
| VN local sites (hoanngay.vn, hoantiensp.com, ShopTik, MD Back, GoAffiliate, ACCESSTRADE "Mua sắm hoàn tiền") | Active as of search |

The closures matter for us. In Vietnam, "hoàn tiền" messages on Zalo are a common phishing vector (press and anti-scam sites warn about fake Shopee refund links that ask for bank details or OTP). Trust is the main design problem, not an extra.

---

## 1. Rakuten (ex-Ebates), US/CA

- **Who / scale:** Mainstream US shoppers, the largest US portal. Tracking: click-through link, browser extension, app in-app browser, card-linked in-store offers.
- **(a) Before purchase:** The app opens an interstitial window, "Cash Back activated", before redirecting to the store. If the store gives no cashback in the app, that window says so. Every activation page has a "See all Terms & Exclusions" link.
- **(b) States:** Pending, then Confirmed. Each category has a published range instead of a date: online 3-14 weeks, dining 3-5 days, travel 45-120 days. The wording is "confirmed by the store", and the reason for the wait is given as returns and exchanges.
- **(c/d) Wallet & payout:** The balance shows pending + confirmed. Payouts run quarterly on fixed dates (Feb/May/Aug/Nov 15) by PayPal or check (the "Big Fat Check"). The minimum is $5.01 confirmed and lower balances carry over. A "Track My Payment" tool exists.
- **(e) Trust:** Help centre with the troubleshooting checklist, exclusions per store, and a "Checking the status of your Cash Back" article.
- **(g) Didn't track:** A checklist comes before the claim form: activate before adding to cart, finish checkout in the same tab, use only Rakuten-listed coupons, accept cookies, turn off ad blockers and VPN, avoid excluded items, keep the order. Problems are split into "missing shopping trip" (no click recorded) and "missing cash back" (click recorded, $0). It warns that some mobile browsers block tracking and tells users to use the app.
- Sources: https://www.rakuten.com/help/article/when-will-i-get-paid-360002117667 · https://rakuten.com/help/did-not-earn-cashback · https://www.rakuten.com/help/article/browsers-preventing-cash-back-360002117007 · https://rakuten.com/help/article/software-or-settings-preventing-cash-back-360002100568

## 2. TopCashback (UK/US/AU)

- **Who:** Deal-savvy users. Pays 100% of commission (its main selling point). Tracking: link plus extension.
- **(b) States:** Pending ("merchant has tracked it and indicated the cashback, but has not yet confirmed criteria or committed to paying"), then Confirmed ("retailer approved, money not yet received by us"), then Payable ("network has billed the merchant; you can withdraw"), or Declined. The help pages say some merchants skip straight from pending to payable, so a stuck status isn't treated as a fault. There is also a "Pending Uplift" sub-state for bonus top-ups.
- **(d) Payout:** Withdraw any time once Payable.
- **(e/g) Claims:** Missing Cashback Claim form that requires the order number and email. Claims resolve in 2-3 months, and the help page explains why ("network and merchant must process it"). Some retailers are labelled "does not accept claims", and slow claims have an "on ice" state. Users complain about long claims (forums, BBB).
- Sources: https://www.topcashback.co.uk/help/what-do-the-statuses-on-my-earnings-page-mean/ · https://www.topcashback.com.au/help/i-have-lodged-a-missing-cashback-claim-why-is-it-taking-so-long-for-you-to-process · https://www.topcashback.co.uk/Help/missing-cashback-claims/

## 3. Quidco (UK)

- **Who:** UK mainstream users. Tracking: link plus app.
- **(b) States:** Tracked ("we've recorded your purchase; the retailer is verifying it"), then Pending, then Confirmed (with an **estimated payment date shown on the activity page**), then Payable, or Declined. Each transaction has a **"more" link that opens a timeline** of its tracking steps. Claims follow the same timeline.
- **(g) Didn't track:** You can raise a claim if the purchase hasn't tracked **after 72 hours** and was made less than 45 days ago. The "Raise a claim" button sits on the Activity row. **Fin, the AI assistant, checks eligibility before submitting.** A purchase that tracked at £0 can also be claimed. A declined claim can't be re-raised without new evidence.
- Sources: https://support.quidco.com/en/articles/4127119-cashback-statuses-explained · https://support.quidco.com/en/articles/8991392-how-to-check-if-your-cashback-has-tracked · https://support.quidco.com/en/articles/4127495-what-is-a-claim-and-when-are-they-needed · https://support.quidco.com/en/articles/8895049-why-has-my-purchase-tracked-with-amount-0

## 4. ShopBack (SG/MY/PH/AU/US; VN history)

- **Who / scale:** Largest in APAC. 50M+ users in 13 markets (May 2025 PR), 60M+ (2026). VN: 2.5M active buyers and about 90B VND returned by July 2022, then 125B VND and 30k users withdrawing per month (~2023). Tracking: app/web link plus in-app browser.
- **(a) Before purchase:** The store page lists the cashback rate and the store's **"claim time"**.
- **(b) States:** Pending (appears within ~48h, "not yet withdrawable"), then Confirmed (moves to Available Balance). The wait is explained as "the store's return/cancellation window; set by the store, can't be sped up". The **activity feed shows the expected confirmation timing on each entry**, based on the store's claim time. Returns reduce the pending amount, a cancellation removes the entry, and the confirmed amount can be lower than tracked.
- **(c/d) Wallet & payout:** Available Balance is shown apart from Pending. Minimums: S$10 in SG, ~RM10 in MY, $5-10 in US (sources conflict). Bank or PayPal, processed within ~10 days, no fee.
- **(g) Didn't track:** "Always start at ShopBack." If no Pending entry appears, or it stays past the claim time, contact the help centre. Orders placed directly with the store never track.
- Sources: https://www.shopback.sg/guide/basics/what-is-pending-cashback · https://www.shopback.sg/guide/how-to/withdraw-shopback-cashback · https://support.shopback.com.au/hc/en-gb/articles/360039122194 · https://www.sggp.org.vn/shopback-mong-muon-mang-den-nhung-gia-tri-thiet-thuc-cho-nguoi-dung-va-doi-tac-post645669.html · https://vnreview.vn/threads/app-mua-sam-hoan-tien-shopback-da-hoan-toi-125-ty-dong-cho-nguoi-dung-viet-cong-bo-7-thuong-hieu-duoc-yeu-thich-nhat-tren-nen-tang.17170/latest

## 5. Cashrewards (AU), closed Sept 2025

- **Who / scale:** ~2M AU members, ANZ-owned. Tracking: link, plus card-linked offers via the ANZ Plus app.
- **(c) Wallet:** Two clearly labelled balances, "Available to withdraw" (approved) and "Pending" (awaiting approve/decline). Minimum withdrawal $10.01.
- **Lesson:** The service closed with immediate effect and gave members a short withdrawal window, which caused a scramble. Customer money held in a wallet is a liability, and payouts should be low-friction.
- Sources: https://help.cashrewards.com.au/support/solutions/articles/1000324629 · https://insideretail.com.au/digital/cashrewards-closes-urges-customers-to-make-claims-quickly-202509 · https://dynamicbusiness.com/topics/news/cashrewards-pulls-the-plug-what-two-million-members-need-to-know-now.html

## 6. PayPal Honey

- **Who:** Browser-extension users. It auto-applies coupons and pays "PayPal Rewards" points (100 pts = $1).
- **Pattern:** Points instead of money. In 2025 it was exposed for swapping in its own affiliate cookie even when it saved the user nothing. Chrome changed its policy in March 2025 to require a real user benefit and disclosure. Honey lost ~8M users (reported), and creator lawsuits are ongoing.
- **Lesson:** Hidden affiliate behaviour destroys trust. Be explicit about how we earn money ("Shopee pays us a commission; you get 80%").
- Sources: https://en.wikipedia.org/wiki/PayPal_Honey · https://techcrunch.com/2025/01/05/youtuber-legaleagle-sues-paypal-over-sleeping-leech-honey-extension · https://thinkinsights.net/strategy/honey-affiliate-backlash

## 7. Capital One Shopping

- **Who:** US extension/app users. Tracking: extension plus link.
- **(b/c) States:** Pending appears within days in "My Rewards & Savings". Travel takes 60-90 days.
- **(d) Payout:** **Gift cards only**, no cash. The catalogue changes often, and options have been removed (Walmart, Safeway) while users waited.
- **Lesson:** An anti-pattern for us. The payout form should stay stable and be cash.
- Sources: https://frequentmiler.com/capital-one-shopping-complete-guide/ · https://frequentmiler.com/bummer-capital-one-shopping-quietly-removes-walmart-safeway-and-more-gift-card-redemptions/

## 8. Swagbucks

- **Who:** Survey/rewards crowd. "Shop" cashback is paid in SB points (100 SB = $1).
- **(b) States:** Pending ~30-32 days, up to 75 days.
- **(d) Payout:** PayPal ~2,500 SB ($25). Gift cards from ~$1-5 (sources conflict).
- **Lesson:** A points currency plus a high cash threshold, with cash locked behind the larger minimum.
- Sources: https://discover.shopback.com/compare/shopback-vs-swagbucks · https://thekrazycouponlady.com/tips/couponing/swagbucks-rebate-app-guide

## 9. Fetch

- **Who:** US receipt-scanning app. Users scan any receipt (receipts within ~14 days) and earn points.
- **(d) Payout:** 1,000 pts = $1. Gift cards from 3,000 pts, but **a first redemption must be $10+** and some retailers start at 10,000 pts.
- **Useful pattern:** Using the receipt as proof. The anti-pattern is points plus tiered first-redemption rules.
- Sources: https://fetch.com/blog/fetch-tips-tricks/cash-options-for-rewards-points · https://thecollegeinvestor.com/33560/fetch-rewards-review/

## 10. Ibotta (and Dosh, closed)

- **Who:** US grocery and online. Offers are activated in the app; tracking by receipt, linked loyalty card, or link.
- **(b) States:** Pending periods vary by offer and are explained per offer. Pending counts in "total earnings" but **not** in the cash-out balance, which confuses users.
- **(d) Payout:** $20 minimum plus at least one redeemed offer.
- **Dosh** (card-linked, automatic) shut down in Feb 2025, and users had about a week's notice to cash out via Venmo.
- Sources: https://help.ibotta.com/hc/en-us/articles/360000428307 · https://financebuzz.com/rakuten-vs-ibotta · https://www.doctorofcredit.com/dosh-app-shutting-down/

## 11. Vietnam local "hoàn tiền Shopee/TikTok" sites (our direct competitors)

**Hoàn Ngay (hoanngay.vn)**
- Covers Shopee, ShopeeFood, TikTok Shop, Lazada and Tiki. The user pastes a link into a box and taps "Tính", and the page shows **"Tiền hoàn dự kiến bạn sẽ nhận được"** (estimated cashback) within seconds. Two CTAs follow: **"Mua ngay"** and **"Sao chép link"**.
- Balance is in **xu** and credited **7 days after the platform confirms the order**. Cancellations and returns deduct xu, and only officially confirmed xu can be withdrawn.
- Withdraw from 10,000 xu to MoMo, ZaloPay or bank, no fee, **within 24h**.
- Entry points: Zalo (zalo.me) and Messenger, OTP/Google login, 20,000 xu sign-up bonus. Referral: the referrer earns while the friend keeps 100%.
- No FAQ on untracked orders.

**HOANTIENSP.COM**
- Up to 85% of commission. Paste a Shopee/TikTok link to get a short link. **No estimate before purchase.**
- States: **"Ngày mua" → "Ghi nhận" (~1 day) → "Có thể rút"** (~7 days after delivery). The page says both 3-7 and ~7 days and doesn't reconcile them.
- Withdraw from 50,000đ by VietQR/MoMo. Has a "Hướng dẫn Bot hoàn tiền" page and Zalo support.
- **Explicit pre-purchase rules:** empty cart first, don't click other affiliate links, check out within 20-30 min, turn off ad blockers, get a fresh link after a cancellation, avoid Shopee Video before paying.
- Disclaimer: "Shopee decides whether orders and commissions are recorded".
- Two-tier referral (5%/2%).

**Others**
- ShopTik (Shopee/TikTok/Lazada, wallet).
- MD Back (Tinhte pick for high rates).
- GoAffiliate (link converter; notes that several items from the same shop can go in one payment).
- ACCESSTRADE "Mua sắm hoàn tiền", embedded in Galaxy Play since Dec 2023, 1-42% cashback. ACCESSTRADE is also a TikTok Shop TAP partner.
- Telegram converter bots (Botize: send `/shopee <url>`, get back an affiliate link).

**Platform rules that shape our UX**
- Shopee VN affiliate uses last-click attribution with a ~7-day window on app clicks (sources vary between 7 and 30 days). Commission counts only for delivered orders with no return or refund. Reconciliation runs monthly (around the 20th-22nd).

**Trust context**
- Fake "Shopee refund" links sent over Zalo/SMS are widespread scams that harvest bank details and OTPs. Users have been told to distrust "hoàn tiền" links.

Sources: https://hoanngay.vn/ · https://hoantiensp.com/ · https://shoptikvn.com/app · https://tinhte.vn/thread/top-3-web-hoan-tien-mua-sam-tot-nhat-hien-nay.4178499/ · https://www.goaffiliate.online/chuyen-doi · https://www.brandsvietnam.com/congdong/topic/338205-Galaxy-Play-ra-mat-tien-ich-Mua-sam-hoan-tien-ngay-tren-ung-dung · https://botize.com/en/formula/777/telegram-bot-converts-the-shopee-product-links-you-send-into-affiliate-links · https://ghn.vn/blogs/tip-ban-hang/muc-hoa-hong-tiep-thi-lien-ket-shopee · https://lsvn.vn/canh-bao-gia-mao-san-thuong-mai-dien-tu-lua-dao-nguoi-mua-hang-a179481.html · https://chongluadao.vn/blog/en/2023/06/canh-bao-lua-dao-gia-danh-san-thuong-mai-dien-tu-shopee-va-cach-nhan-biet/

---

## Synthesis

### Ranked patterns to adopt

1. **A 4-step status timeline with one plain-language line per state** (e.g. Đã ghi nhận → Chờ sàn duyệt → Đã duyệt → Đã chuyển khoản, plus Bị huỷ). *Quidco timeline, TopCashback status definitions, HOANTIENSP.* **Why:** it maps directly onto Shopee/TikTok order states, and each line says *who* is acting ("Shopee is checking for returns"). **Lands in:** order detail, my money.
2. **Waiting periods as a range tied to an event, not a date** ("usually ~7-14 days after delivery; set by Shopee, we can't speed it up"). *ShopBack claim time, Rakuten category ranges.* **Why:** it avoids promising dates we don't control. **Lands in:** order detail, link result, FAQ.
3. **An estimated amount before purchase, labelled as an estimate** ("Dự kiến hoàn ~12.000đ = 80% hoa hồng"). *Hoàn Ngay "Tiền hoàn dự kiến", ShopBack store rates.* **Why:** it is the reason to use the link, and showing the 80% split is honest. **Lands in:** link result, Zalo reply.
4. **A pre-purchase tracking checklist next to the buy button** (open in a real browser or the Shopee app, never buy inside Zalo; don't click other links; buy soon; get a fresh link after a cancellation). *HOANTIENSP, Rakuten checklist and "use the app, mobile browsers block tracking".* **Why:** purchases made in Zalo's in-app browser are not attributed, which is why the share page `/s/<code>` exists. Prevention is cheaper than claims. **Lands in:** link result, share page.
5. **Separate "Có thể rút" from "Đang chờ" in the wallet; never add them into one headline.** *Cashrewards, ShopBack, TopCashback; Ibotta shows the confusion it avoids.* **Lands in:** my money.
6. **No minimum, prompt bank transfers, payout method shown on the balance screen** (no threshold-progress bar, because D11 forbids thresholds; no payout date promised). *Hoàn Ngay 24h payouts, HOANTIENSP VietQR; Rakuten/Cashrewards minimums are the counter-example.* **Lands in:** my money, admin payouts.
7. **Self-service "why didn't my cashback track?" with a time gate** (no record after 24-72h → run the checklist → submit the order ID). Split "no click recorded" from "recorded but 0đ/declined". *Quidco 72h, Rakuten trip vs cashback, TopCashback form.* **Lands in:** order detail, help, admin review queue.
8. **A reason code on every decline** (cancelled, returned, excluded category, a different link clicked last, outside the 7-day window). *TopCashback Declined, ShopBack reduction reasons.* **Lands in:** order detail, admin (required field).
9. **A payout receipt for each transfer** (amount, bank last 4 digits, transfer reference, orders included), shareable as an image in Zalo. *Rakuten Track My Payment.* **Lands in:** receipt, my money.
10. **A chat-native entry point: paste a link in Zalo, get the link plus estimate plus checklist back.** *Hoàn Ngay Zalo/Messenger, Telegram /shopee bots.* **Lands in:** Zalo bot reply, share page.
11. **An activation interstitial** ("Hoàn tiền đã kích hoạt, đang mở Shopee…") that also warns when the link won't earn anything. *Rakuten app.* **Lands in:** share page redirect.
12. **Plain disclosure of the business model and the platform's authority** ("Shopee pays us; we pay you 80%; Shopee decides approval"). *HOANTIENSP disclaimer; Honey shows the cost of not disclosing.* **Lands in:** home, FAQ.
13. **Anti-scam trust block:** "We never ask for OTP or passwords; we only send to an account in your name." **Why:** VN Zalo refund-scam context. **Lands in:** home, my money, bank setup.
14. **Partial amounts stay visible** (show original vs adjusted amounts on partial returns). *ShopBack, TopCashback "Pending Uplift".* **Lands in:** order detail.
15. **An admin review queue sorted by age against the expected window**, flagging orders past their expected approval range. *ShopBack "past claim time → contact us".* **Lands in:** admin.

### Anti-patterns to avoid

1. **Points/xu instead of đồng** (Honey, Swagbucks, Fetch, Hoàn Ngay "xu"). Always show VND.
2. **Any minimum, especially hidden or tiered ones** (Fetch $10 first redemption, Swagbucks $25 for cash vs $1-5 for gift cards, Ibotta "one offer" rule, Rakuten carry-over). Our D11 already says no threshold.
3. **Payout in non-cash or changing forms** (Capital One gift-card catalogue churn).
4. **Mixing pending into the headline balance or promising fixed dates** (Ibotta total earnings; HOANTIENSP's inconsistent 3-7 vs 7 days).
5. **Undisclosed affiliate behaviour and slow, opaque claims** (Honey cookie swapping; TopCashback 2-3 month claims "on ice"). A related risk: holding balances long-term (Cashrewards/Dosh closures left users scrambling), so pay out promptly.
