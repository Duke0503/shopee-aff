---
name: cashback-security-model
description: >-
  The cashback platform's threat model and security policy skill. Use when writing, reviewing or
  updating a SECURITY_MODEL.md for the platform or one of its apps (server, assistant, web, admin,
  browser bridge), running a STRIDE pass over the architecture diagrams, deciding what counts as a
  security finding, or checking where tokens, sessions, bank accounts and the affiliate and Zalo
  sessions live. Not for the SECURITY.md disclosure policy and not a code security review by itself.
---

# Cashback security model

This skill adapts Sentry's `security-model` skill to the cashback platform and adds a STRIDE step
written for it. Read the project rules below first; they win over the upstream reference where
they differ.

- [references/security-model.md](references/security-model.md): the upstream procedure (find
  policies, establish the boundary, draft, preview and approve), the `SECURITY_MODEL.md` template
  and its drafting rules.
- [references/consuming-policy.md](references/consuming-policy.md): the block to add to review
  skills so they read the policy.
- [references/security-model-sources.md](references/security-model-sources.md): upstream's own
  source and attribution notes.
- [scripts/resolve_security_model.py](scripts/resolve_security_model.py): lists, resolves and
  checks policies (stdlib Python, read-only `git` calls). Run it with
  `uv run .claude/skills/cashback-security-model/scripts/resolve_security_model.py <list|resolve|check> --repo .`
  (add `--scope <path>` for `resolve`).

Product sources: `CLAUDE.md`, `docs/domain-model.json`, the decisions in `.context/decisions/`,
the PRD and the architecture spine listed in `docs/index.md`, and the current system notes in
`docs/reference/`.

## Project rules

1. Policy files are `SECURITY_MODEL.md`: one at the repository root and one per app when its
   boundary differs. Never create or overwrite `SECURITY.md` with this skill.
2. The project owner accepts risks, exclusions and severity downgrades. A suggestion is not a
   decision until the owner accepts it; until then mark it `Unresolved`. Accepted security
   decisions that change the product are also recorded in `.context/decisions/`.
3. Ignore the Sentry-specific parts of the upstream text: the getsentry severity defaults, Warden,
   `warden.toml`, `@getsentry/<team>` CODEOWNERS and "report to security@sentry.io". Use critical,
   high, medium, low unless the owner names another scale. The repository's visibility decides the
   public-repository rules; assume public if unsure.
4. Everything is written in English. Do not run, stage, commit or push without the person's
   request (`docs/rules/git.md`).
5. While the platform is being re-planned, an invariant's enforcement point may be a planned
   component. Write it "Enforced by: planned (<component>)", never as if the code exists.

### Invariants to seed

Start every root policy from these, as `INV-n` entries, and confirm each with the owner:

- **Money goes only to the link's owner.** An order's cashback goes to the customer in sub_id1 of
  the link it came from. A link is reused only for the same customer. No request can move an order,
  a balance or a payout to another customer, except an owner-run customer merge.
- **Never pay twice.** An order with `paid_at` set is never changed or paid again, whatever the
  reconciliation reports later.
- **Pay from approved commission only.** No code path pays cashback from an estimated commission.
- **Bank accounts and balances need a signed-in customer.** Creating a link under any customer code
  is allowed, because the money still goes to that code's owner. Reading or changing a bank
  account, a balance or order details requires that customer's session.
- **Only the assistant creates customers.** The public web never creates a customer. An unknown
  code returns not found; it never falls back to a guest.
- **Internal routes need a token, not an address.** Internal routes require `X-Assistant-Token`;
  the browser bridge requires `X-Bridge-Token`. The caller's source address is never trusted, and
  proxy headers are not trusted by default.
- **Sessions stay on the operator's machine.** The affiliate browser profile, the Zalo credentials
  and the database never leave the host, never enter the repository, logs or error responses.
- **No forged platform signatures.** No code rebuilds Shopee's anti-bot signature headers or calls
  its internal APIs directly. Every network call to Shopee goes through the operator's real
  browser session.

## Procedure

Follow the upstream procedure (sections 1 to 4 of `references/security-model.md`) with one added
step between "Establish the Security Boundary" and "Draft the Policy":

### STRIDE pass (project step)

Work from the C4 Container diagram and the Dynamic diagrams (link request to delivered link,
reconciliation to approved order, payout, sign-in). If they do not exist yet, ask for them or
sketch the flow first.

1. List every element (person, app, data store, external system) and every arrow that crosses a
   trust boundary: internet to the public web, the tunnel or proxy to the server, server to
   assistant, server to browser bridge, bridge to the affiliate site, assistant to Zalo, server to
   the database and its backups.
2. For each element and boundary-crossing arrow, ask the six STRIDE questions in project terms:
   - **Spoofing**: can someone act as a customer, the assistant, the bridge or the admin without
     the right session or token?
   - **Tampering**: can an order, a commission, a balance, a bank account or a payout be changed by
     anyone other than its one writer?
   - **Repudiation**: can a payout, an adjustment or a customer merge happen without a recorded
     actor and time?
   - **Information disclosure**: can bank accounts, phone numbers, Zalo ids, tokens or the
     affiliate session reach the browser, logs or an unauthenticated route?
   - **Denial of service**: can link creation be flooded past the web quota, the Zalo account be
     pushed into a lock by message bursts, or the affiliate session be pushed into captcha?
   - **Elevation of privilege**: can a customer session reach admin actions, or the public web
     reach internal routes?
3. For each credible threat write one line: element or arrow, STRIDE letter, threat, planned
   control, and whether the control enforces (blocks) or only monitors.
4. Turn the results into the policy: a threat with an enforcing control becomes or strengthens an
   `INV-n` with its enforcement point; a threat without one is raised to the owner as an open
   question (in conversation, not in the committed file); an owner-accepted threat becomes a dated
   accepted risk.

Keep the threat list itself in the architecture workspace, not in `SECURITY_MODEL.md`, which
records only invariants, finding classes, exclusions and accepted risks.

## License

Sentry's `security-model` skill is Apache-2.0, Copyright 2025 Functional Software, Inc. dba Sentry,
itself adapted from openai/codex-security (Apache-2.0). See [LICENSE](LICENSE) and
[UPSTREAM.md](UPSTREAM.md). The STRIDE step is the project's own text, following the general
STRIDE method.
