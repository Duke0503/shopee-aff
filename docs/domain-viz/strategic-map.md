# Strategic Domain Map

**Primary domain:** `orders`

The business is trustworthy attribution and exact payment: a link that belongs to one customer, an order traced to that customer, and a payout made once from the approved commission. Linking, Order Tracking and Cashback Payouts are core. Identity, Campaigns and Customer Conversation support them. Deals and Operations are generic.

```mermaid
flowchart TB
    subdomain_attribution["Attribution and cashback<br/>core"]
    subdomain_attribution --> linking
    subdomain_attribution --> orders
    subdomain_attribution --> payouts
    subdomain_engagement["Customer engagement<br/>supporting"]
    subdomain_engagement --> identity
    subdomain_engagement --> messaging
    subdomain_engagement --> campaigns
    subdomain_back_office["Back office<br/>generic"]
    subdomain_back_office --> catalog
    subdomain_back_office --> operations
    identity["Customer Identity<br/>supporting"]
    linking["Link Issuing<br/>core"]
    orders["Order Tracking<br/>core"]
    payouts["Cashback Payouts<br/>core"]
    campaigns["Campaigns<br/>supporting"]
    messaging["Customer Conversation<br/>supporting"]
    catalog["Deals<br/>generic"]
    operations["Operations<br/>generic"]
```

## Classification

| Subdomain | Type | Contexts | Description |
|---|---|---|---|
| `Attribution and cashback` | `core` | linking, orders, payouts | Issuing attributable links, tracking orders and paying cashback. |
| `Customer engagement` | `supporting` | identity, messaging, campaigns | Who the customer is, how we talk to them, and promotions. |
| `Back office` | `generic` | catalog, operations | Deals, audit, alerts and metrics. |
