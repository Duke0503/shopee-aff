# C4 Context — Cashback Platform

Legend: blue boxes are people, the grey boxes are external systems, the dark box is the platform.
Lazada is drawn for completeness and is not connected in the first release (D17).

```mermaid
C4Context
  title System Context - Cashback Platform (hoantiendp.com)

  Person(customer, "Customer", "Shopper in Vietnam; uses a Zalo chat and the customer website")
  Person(operator, "Operator / staff", "Runs the business from the admin desk; makes bank transfers by hand")

  System(platform, "Cashback Platform", "Issues affiliate links per customer, reconciles orders, records payouts, talks to customers")

  System_Ext(zalo, "Zalo", "Personal Zalo account used as the customer chat (unofficial client)")
  System_Ext(shopee, "Shopee Affiliate", "Custom link page, product commission lookup, conversion report; reached only through the real browser")
  System_Ext(accesstrade, "AccessTrade", "Affiliate network for TikTok Shop; link creation and transactions API")
  System_Ext(lazada, "Lazada Affiliate", "Not in the first release (D17)")
  System_Ext(bank, "Operator's bank", "Manual transfers to customers via VietQR")
  System_Ext(telegram, "Telegram", "Owner alerts only")

  Rel(customer, zalo, "Pastes product links, sends commands", "Zalo app")
  Rel(customer, platform, "Signs in, sees balance and orders, requests links, opens share and receipt links", "HTTPS")
  Rel(operator, platform, "Pays customers, clears review cases, runs campaigns", "HTTPS")
  Rel(platform, zalo, "Replies and notifications at a human pace", "zca-js")
  Rel(platform, shopee, "Creates links, looks up rates, reads the report", "operator's Chrome session")
  Rel(platform, accesstrade, "Creates links, reads transactions", "HTTPS API")
  Rel(platform, telegram, "Sends owner alerts", "Bot API")
  Rel(operator, bank, "Transfers the payable balance", "banking app")
  Rel(bank, customer, "Credits the transfer", "bank transfer")
```
