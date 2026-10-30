# Aggregate Map

Cross-context overview of every aggregate and how they call each other. For one
aggregate's fields, invariants, identity, and lifecycle, open its context page in
`contexts/`.

```mermaid
flowchart TB
    subgraph context_identity["Customer Identity"]
        identity_customer["Customer"]
        identity_session["Session"]
    end
    subgraph context_linking["Link Issuing"]
        linking_link_request["LinkRequest"]
        linking_product_offer["ProductOffer"]
        linking_link_click["LinkClick"]
    end
    subgraph context_orders["Order Tracking"]
        orders_order["Order"]
        orders_review_case["ReviewCase"]
    end
    subgraph context_payouts["Cashback Payouts"]
        payouts_payout["Payout"]
        payouts_network_settlement["NetworkSettlement"]
    end
    subgraph context_campaigns["Campaigns"]
        campaigns_campaign["Campaign"]
        campaigns_award["CampaignAward"]
    end
    subgraph context_messaging["Customer Conversation"]
        messaging_notification["Notification"]
    end
    subgraph context_operations["Operations"]
        operations_audit_entry["AuditEntry"]
    end
    linking_link_request -->|CustomerDirectory| identity_customer
    orders_order -->|CustomerDirectory| identity_customer
    orders_order -->|RequestId in sub_id2| linking_link_request
    payouts_payout -->|orders.order.approved| orders_order
    payouts_payout -->|BankAccountReader| identity_customer
    campaigns_campaign -->|orders.order.*| orders_order
    payouts_payout -->|ConfirmedBonuses| campaigns_campaign
```
