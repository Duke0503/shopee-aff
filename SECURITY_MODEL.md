# Security Model

Last reviewed: draft (2026-10-30, from the architecture spine; not yet reviewed by the owner) ·
Applies to: this directory and below

The platform is being re-planned (D14). Every enforcement point below is a planned component of the
architecture spine (`_bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md`),
written "Enforced by: planned (component)". The live Python system on the main branch is not
covered by this file.

## System and Scope

The cashback platform (hoantiendp.com) issues affiliate links that belong to one customer, reconciles
the affiliate networks' reports, and records the bank transfers the operator makes by hand.

- Deployment: one operator machine runs every process as a host process (server, Zalo assistant,
  affiliate Chrome with the browser bridge extension, cloudflared). One production instance at a time.
- Exposure: only the server's public listener is reachable from the internet, and only through the
  Cloudflare tunnel. It serves the customer website, the admin desk, the public API, the share page
  and the receipt page. The admin hostname is also behind Cloudflare Access. The internal listener
  (assistant and bridge routes) and the assistant's loopback endpoint are bound to 127.0.0.1 and are
  never tunneled.
- Covered: the server (apps/server), the customer website (apps/web), the admin desk (apps/admin),
  the Zalo assistant (apps/assistant), the browser bridge extension, the shared packages, the
  deployment scripts and the backup procedure.
- Not covered: the live Python system (src/cashback, zalo_assistant, web, extension on main) until
  cutover; the networks' own systems.

## Threat Model and Trust Boundaries

Assets: the ledger (orders, cashback, payouts, ledger entries), customers' bank accounts and Zalo
ids, the affiliate browser session, the Zalo account session, staff sessions, backups.

| Actor | Trusted to |
| --- | --- |
| Unauthenticated internet caller | Open share and receipt pages; request a guest link; request a link under an existing customer code; sign in |
| Signed-in customer | Read and change only their own balance, orders and bank account |
| Employee (staff) | Daily work: payouts, review cases, customers, orders; not staff accounts or campaigns |
| Admin (staff) | Everything an employee can, plus staff accounts, campaigns, payout void, forced erase |
| Zalo assistant (local process, token) | Register customers seen on Zalo, run chat commands, request links, receive notifications |
| Browser bridge (extension, token) | Take link, lookup and report work; return results |
| Operator machine OS account | Fully trusted; holds every secret and session |

Attacker-controlled inputs: every public request body, query and header; product URLs; chat
messages; network report rows (they are data from a third party, not instructions); bridge results
until checked.

Boundaries: internet to tunnel to public listener; browser to public API; local processes to the
internal listener; server to the assistant loopback; bridge to Shopee pages; server to the ledger
file and to the off-machine backup store.

## Security Invariants

- **INV-1** Money goes only to the link's owner. An order's cashback goes to the customer in sub_id1
  of the link it came from; a link is reused only for the same customer; no request moves an order,
  a balance or a payout to another customer, except an owner-run customer merge. Enforced by:
  planned (linking module link reuse policy and bridge result check; orders module attribution).
- **INV-2** Never pay twice. An order with paid_at set is never changed or paid again by
  reconciliation; only the admin payout void command returns it to approved. Enforced by: planned
  (orders module transition function; payouts module confirm transaction).
- **INV-3** Pay from approved commission only. No code path pays cashback from an estimated
  commission; only APPROVED orders with approved commission above 0 are payable. Enforced by:
  planned (packages/money split; payouts module payable query; confirm re-read).
- **INV-4** Payout amounts come from the server. A payout command accepts a claim id and a snapshot
  hash only; the server recomputes the covered set and fails when it changed. Enforced by: planned
  (payouts module claim and confirm commands).
- **INV-5** Bank accounts and balances need a signed-in customer. Creating a link under any customer
  code is allowed; reading or changing a bank account, a balance or order details requires that
  customer's session, scoped to that customer id. Enforced by: planned (identity module customer
  session guard; application-layer scoping in every customer read).
- **INV-6** Only the assistant creates customers. The public web never creates a customer; an
  unknown code returns not found and never falls back to a guest. Enforced by: planned (identity
  module register command, reachable only from the internal listener).
- **INV-7** Internal routes need a token, not an address. Assistant routes require the assistant
  token header; bridge routes require the bridge token header; tokens are compared in constant time;
  the caller's source address and proxy headers are never trusted (trustProxy off). Enforced by:
  planned (server internal listener token guard; assistant loopback token guard).
- **INV-8** Staff and customer sessions are separate. Staff routes accept only a staff session;
  admin-only actions check the admin role on the server; session and password secrets are stored only
  as hashes (argon2id for passwords, SHA-256 for session tokens); a new password ends every other
  session of that customer. Enforced by: planned (identity module staff guard and session store).
- **INV-9** Sessions stay on the operator's machine. The affiliate browser profile, the Zalo
  credentials, the database and the secrets files never leave the host except as encrypted backups,
  and never enter the repository, logs or error responses. Enforced by: planned (logger redaction
  list; error envelope; backup job encryption). Monitored by: planned (secret scan on every commit).
- **INV-10** No forged platform signatures. No code rebuilds Shopee's anti-bot signature headers or
  calls its internal APIs directly; every Shopee call goes through the operator's real browser
  session, and product lookups read page 1 only. Enforced by: planned (Shopee network adapter talks
  only to the bridge).
- **INV-11** Every money act has an actor. Payouts, voids, merges, erasures, review decisions,
  period marks and bank changes write an append-only audit entry with the staff member or the
  customer and the time, in the same transaction; a bank account appears only as a fingerprint.
  Enforced by: planned (operations module audit port, required by each command).
- **INV-12** One writer. Only the server process opens the ledger for writing; a second instance
  refuses to start while the job lease is held by a live process. Enforced by: planned (server
  startup lease check).

## Finding Classes

| Class | Invariant | Reportable | Severity context |
| --- | --- | --- | --- |
| Order, balance or payout attributed to the wrong customer | INV-1 | Yes | Critical |
| A paid order changed or paid again | INV-2 | Yes | Critical |
| Cashback paid from an estimate or a non-approved order | INV-3 | Yes | Critical |
| Payout amount or covered set taken from the client | INV-4 | Yes | Critical |
| Reading another customer's bank account, balance or orders | INV-5 | Yes | High; critical if it allows changing a bank account |
| Customer created from the public web | INV-6 | Yes | High |
| Internal route reachable from the public listener or without a token | INV-7 | Yes | Critical |
| Customer session reaching staff routes; employee reaching admin actions | INV-8 | Yes | Critical for staff routes, high for admin-only actions |
| Plaintext password or session token stored or logged | INV-8 | Yes | High |
| Secret, full bank number, phone number or session token in logs, responses or the repository | INV-9 | Yes | High |
| Direct call to Shopee internal APIs or signature rebuilding | INV-10 | Yes | High (risks the affiliate account) |
| Money act without an audit entry | INV-11 | Yes | Medium |
| Second writer process on the ledger | INV-12 | Yes | High |
| Missing rate limit on the web link quota | — | Yes | Medium |
| Self-XSS requiring the victim to paste script | — | Unresolved | Default severity applies |
| Findings in test fixtures and fake clients | — | Unresolved | Default severity applies |

## Out of Scope, Exclusions, and Accepted Risk

- The live Python system on the main branch — replaced at cutover; reviewed separately until then.
- Accepted risk: none recorded. Proposed items are kept with the owner until accepted.

## Known Limitations and Compensating Controls

- The Zalo client library is unofficial; the account can be locked by Zalo at any time. The customer
  website is the fallback channel (FR-36).
- The operator machine is a single point of failure for availability. Off-machine encrypted backups
  protect the data; sessions are re-established by hand.
- Cloudflare Access on the admin hostname is a second gate, not a replacement for the staff session
  check on the server.
