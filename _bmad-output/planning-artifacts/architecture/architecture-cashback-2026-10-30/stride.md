# STRIDE pass — Container and Dynamic diagrams (2026-10-30)

Working notes for `SECURITY_MODEL.md` (cashback-security-model, project step). Kept in the
architecture workspace, not in the policy. Every control is planned; nothing is built yet.
"Enforce" blocks the threat; "Monitor" only detects it.

## Elements and boundary-crossing arrows

| # | Arrow / element | Boundary |
| --- | --- | --- |
| B1 | Internet to Cloudflare edge to cloudflared to public listener 127.0.0.1:8080 | internet / host |
| B2 | Customer website and admin desk calling the public API | browser / server |
| B3 | Assistant to internal listener 127.0.0.1:8081 | process / process on host |
| B4 | Notify job to assistant loopback 127.0.0.1:8082 | process / process on host |
| B5 | Bridge extension to internal listener | browser extension / server |
| B6 | Bridge to Shopee Affiliate pages | host / Shopee |
| B7 | Assistant to Zalo | host / Zalo |
| B8 | Server to AccessTrade, Telegram | host / internet |
| B9 | Server to ledger file; backup job to off-machine store | process / disk / remote |
| E1 | Share page `/s/<code>` and receipt page `/b/<token>` (public, no session) | internet |

## Threats

| Element / arrow | S/T/R/I/D/E | Threat | Planned control | Enforce / Monitor |
| --- | --- | --- | --- | --- |
| B2 | S | Guessing or replaying a customer session to read a balance or bank account | Random 32-byte session token, only SHA-256 hash stored, HttpOnly Secure SameSite=Lax cookie, sessions end on new password (D21) | Enforce |
| B2 | S | Password guessing on sign-in | Lock 15 min after 5 failures (FR-9), rate limit keyed by customer code (never by source address), argon2id | Enforce |
| B2 | E | Customer session reaching staff routes | Separate staff cookie and guard on `/api/admin/*`; customer cookie never accepted there; Cloudflare Access on the admin host | Enforce |
| B2 | T | Browser-supplied amount or order list in a payout | Payout command takes only claim id and snapshot hash; server recomputes (D19, D32) | Enforce |
| B2 | T | Cross-site request forging a bank change or payout | SameSite=Lax cookies plus Origin check on every mutating request; JSON-only bodies | Enforce |
| B2 | I | Bank account, Zalo id or phone in API responses to another customer | Every customer read is scoped to the session's customer id in the application layer; last four digits only | Enforce |
| B2 | T | Creating a customer from the web | No public route creates a customer; unknown code returns not found (D10) | Enforce |
| B2 | D | Flooding link creation from the web to push the affiliate session into captcha | Web quota 60/hour overall, 20/day per code (FR-2); queue serves Zalo first | Enforce |
| B1 | S | Trusting X-Forwarded-For or a loopback source address as authentication | `trustProxy` off; no route authorizes by address; internal routes are not on the public listener | Enforce |
| B1 | E | Public internet reaching internal routes | Internal routes bound only on 127.0.0.1:8081, never in the tunnel config; token required as well | Enforce |
| B3 | S | A local process posing as the assistant | `X-Assistant-Token` compared in constant time; token from the secrets file | Enforce |
| B4 | S | A local process posing as the server to make the assistant send messages | Assistant loopback requires the same token; accepts only notification ids it has not sent | Enforce |
| B5 | S | A web page or other extension posing as the bridge to inject affiliate links | `X-Bridge-Token` held in extension storage, set by the operator; listener on loopback | Enforce |
| B5 | T | A tampered bridge result attaching another customer's link | Server checks that the returned link carries the batch's sub_id1 before attaching (D6) | Enforce |
| B6 | D | Paging the commission lookup or rebuilding signatures, pushing the session into captcha | Page 1 only; no signature code; captcha detection pauses the queue and alerts (FR-7, FR-30) | Enforce + Monitor |
| B7 | D | Message bursts locking the Zalo account | Pacer in the assistant: human delays, no bulk sends, 30 friend requests/day max (D9, FR-22) | Enforce |
| B7 | S | A second process signing in to the production Zalo account | Dev uses another account; start scripts act on own PIDs only | Enforce (procedure) |
| B9 | T | A second writer corrupting the ledger or breaking idempotency | One writer process; job lease row; startup refuses if the lease is held by a live PID (AD-2, AD-13) | Enforce |
| B9 | I | Backups readable off the machine | age encryption before copy; key held by the owner | Enforce |
| B9 | R | A payout, void, merge, erase, review decision or period mark with no actor | Append-only audit entries written in the same transaction; command fails without an actor | Enforce |
| E1 | I | Enumerating share codes or receipt tokens | Random codes (share: 10 chars base62; receipt: 22 chars base62); receipt shows only code, last four digits, amount, date, proof | Enforce |
| E1 | S | Preview bots inflating clicks | Bots and HEAD requests not recorded (FR-6) | Enforce |
| Logs | I | Tokens, full bank numbers or phone numbers in logs or error responses | pino redaction list; error envelope carries code and message key only | Enforce + Monitor |
| Repo | I | Committed secrets (OQ8) | Rotate and scrub before cutover; secret scan on every commit | Enforce (release blocker) |
| Reconcile | T | A report row moving money to another customer | Attribution only by sub_id1, alias, sub_id2 owner; otherwise review case; paid orders never change (D4, D6) | Enforce |
| Review | T | Staff setting an amount by hand | No free-form adjustment exists; review apply runs the reconciliation rules (FR-14) | Enforce |

## Threats without an enforcing control (raised to the owner in conversation)

- Loss of the operator machine or its disk: covered for data by off-machine backups; the affiliate
  and Zalo sessions must be re-established by hand. No enforcing control; owner to accept.
- A compromised operator machine exposes the Zalo credentials, the Chrome profile and the ledger at
  once. Compensating control: full-disk encryption and an OS account used only for production.
  Owner to confirm.
