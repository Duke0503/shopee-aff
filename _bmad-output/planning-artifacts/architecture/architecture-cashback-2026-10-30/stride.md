# STRIDE pass — Container and Dynamic diagrams (2026-10-30)

Working notes for `SECURITY_MODEL.md` (cashback-security-model, project step). Kept in the
architecture workspace, not in the policy. Every control is planned; nothing is built yet.
Revised 2026-10-30 after the independent review (H8, H9, H11, M10, M11, M16, L1, L4, S2, S3).
"Enforce" blocks the threat; "Monitor" only detects it.

## Elements and boundary-crossing arrows

| # | Arrow / element | Boundary |
| --- | --- | --- |
| B1 | Internet to Cloudflare edge to cloudflared to public listener 127.0.0.1:8080 | internet / host |
| B2 | Customer website and admin desk calling the public API | browser / server |
| B3 | Assistant to internal listener 127.0.0.1:8081 | process / process on host |
| B4 | Assistant pulling notifications from the internal listener (no assistant listener, S3) | process / process on host |
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
| B2 | S | Password guessing and spraying on sign-in; locking every customer out by sequential codes | Doubling delay after 5 failures per code (1 to 15 min) instead of a hard lock; Cloudflare rate-limit and WAF rules on `/api/session`; `CF-Connecting-IP` as a rate-limit key only; global failed-sign-in alert; argon2id (AD-18) | Enforce + Monitor |
| B2 | E | Customer session reaching staff routes | Separate staff cookie and guard on `/api/admin/*`; customer cookie never accepted there | Enforce |
| B1 | E | Reaching `/api/admin/*` through the public host, around Cloudflare Access | Staff route group registered only for the admin `Host`; every staff route verifies the `Cf-Access-Jwt-Assertion` JWT as well as the staff session (AD-18, D48) | Enforce |
| B2 | T | Browser-supplied amount or order list in a payout | Payout command takes only claim id and snapshot hash; server recomputes (D19, D32) | Enforce |
| B2 | T | Cross-site request forging a bank change or payout | SameSite=Lax cookies plus Origin check on every mutating request; JSON-only bodies | Enforce |
| B2 | I | Bank account, Zalo id or phone in API responses to another customer | Every customer read is scoped to the session's customer id in the application layer; last four digits only | Enforce |
| B2 | T | Creating a customer from the web | No public route creates a customer; unknown code returns not found (D10) | Enforce |
| B2 | D | Flooding link creation from the web to push the affiliate session into captcha, or using up the global web quota | Web quota 60/hour overall, 20/day per code (FR-2); Cloudflare rate-limit rules keyed by client address at the edge; queue serves Zalo first | Enforce |
| B1 | S | Trusting X-Forwarded-For or a loopback source address as authentication | `trustProxy` off; no route authorizes by address; internal routes are not on the public listener | Enforce |
| B1 | E | Public internet reaching internal routes | Internal routes bound only on 127.0.0.1:8081, never in the tunnel config; token required as well | Enforce |
| B3 | S | A local process posing as the assistant | `X-Assistant-Token` compared in constant time; token from the secrets file | Enforce |
| B4 | S | A local process posing as the server to make the assistant send messages | The assistant has no listener; it only pulls from the internal listener with its token and skips ids in its local sent-ids file | Enforce |
| B5 | S | A web page or other extension posing as the bridge to inject affiliate links | `X-Bridge-Token` held in extension storage, set by the operator; listener on loopback | Enforce |
| B5 | T | A tampered bridge result attaching another customer's link, or a link to another site | One link per submission; host allow-list (Shopee, AccessTrade); the server resolves the short link's redirect outside any transaction and checks its sub_ids before attaching (AD-14, D6, D47) | Enforce |
| B6 | T | Dev links reaching production with real ids | Dev uses the fake bridge or a Chrome profile never signed in to the production Shopee account; dev sub_id1 carries a `DEV` prefix that production sends to review (AD-25) | Enforce |
| B6 | D | Paging the commission lookup or rebuilding signatures, pushing the session into captcha | Page 1 only; no signature code; captcha detection pauses the queue and alerts (FR-7, FR-30) | Enforce + Monitor |
| B7 | D | Message bursts locking the Zalo account | Pacer in the assistant: human delays, no bulk sends, 30 friend requests/day max (D9, FR-22) | Enforce |
| B7 | S | A second process signing in to the production Zalo account | Dev uses another account; start scripts act on own PIDs only | Enforce (procedure) |
| B9 | T | A second writer corrupting the ledger or breaking idempotency | One writer process; exclusive OS lock on `data/<env>/server.lock` taken at startup (AD-2, AD-13) | Enforce |
| B9 | I | Backups readable off the machine | age encryption before copy; key held by the owner | Enforce |
| B9 | R | A payout, void, merge, erase, review decision or period mark with no actor | Append-only audit entries written in the same transaction; command fails without an actor | Enforce |
| E1 | I | Enumerating share codes or receipt tokens | Random codes (new share codes: 10 chars base62, live 8-char codes still accepted; receipt: 22 chars base62) | Enforce |
| E1 | I | Bank screenshot (full account number, holder, operator balance) on the public receipt page | Receipt page shows facts only (code, last four digits, amount, date, voided state); the proof is served only to staff and the signed-in customer (AD-21, D49) | Enforce |
| B2 | T | Stored XSS from an uploaded proof image (SVG or HTML disguised as an image) next to the customer cookie | JPEG and PNG only, re-encoded on upload, EXIF stripped; fixed `Content-Type`, `nosniff`, strict CSP (AD-21) | Enforce |
| E1 | T | `/s/<code>` used as an open redirect | Only links whose host is on the allow-list are attached (AD-14) | Enforce |
| E1 | S | Preview bots inflating clicks | Bots and HEAD requests not recorded (FR-6) | Enforce |
| Logs | I | Tokens, full bank numbers or phone numbers in logs or error responses | pino redaction list; error envelope carries code and message key only | Enforce + Monitor |
| Repo | I | Committed secrets (OQ8) exposed now if the repository is public | Owner rotates both values now on the live system and in Cloudflare (no code change on main) and makes the repository private (D51); secret scan on every commit | Enforce (owner action now) |
| Reconcile | T | A report row moving money to another customer | Attribution only by sub_id1, alias, sub_id2 owner; otherwise review case; paid orders never change (D4, D6) | Enforce |
| Review | T | Staff setting an amount by hand | No free-form adjustment exists; review apply runs the reconciliation rules (FR-14) | Enforce |

## Threats without an enforcing control (accepted)

- Loss of the operator machine or its disk: covered for data by off-machine backups (D36); the
  affiliate and Zalo sessions are re-established by hand. Accepted by D37.
- A compromised operator machine exposes the Zalo credentials, the Chrome profile and the ledger at
  once. Compensating control: full-disk encryption and an OS account used only for production.
  Accepted by D37.
- A taken-over Zalo account can change the bank account from the private chat without further
  confirmation (FR-10), so it can redirect payouts. Accepted; bank changes are refused in groups
  (AD-15) and the 72-hour flag shows on the payout row.
- The machine going silent (power, sleep, internet, FileVault pre-boot): monitored from outside by
  the external heartbeat checker (AD-29, D50).
