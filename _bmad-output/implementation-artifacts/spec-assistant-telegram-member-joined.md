---
title: 'Telegram notice to the DP Business group when a member joins the Zalo group'
type: 'feature'
created: '2026-11-05'
status: 'done'
route: 'oneshot'
baseline_commit: '547677d'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The live system told the DP Business group when someone joined the Zalo group (`notify_new_member_joined`, `zalo_assistant/assistant_worker.js:1810-1850`). The new platform only welcomes them.

**Approach:** On a join in a welcome group, the assistant reads the group's member count and posts the joined members to a new internal server route, which sends one Telegram message per member to `TELEGRAM_BUSINESS_CHAT_ID` in the live format. The owner asked for this on 2026-11-05 and agreed that a rejoin is told again, as live.

</frozen-after-approval>

## Implementation Notes

- Rules: production welcome groups only (`welcomeGroupIds`), never the Dev group. The notice never delays or blocks the group welcome; a failure on either side is logged by event name only, and it is not retried. Joining registers no one (D25). Nothing is stored: no name or Zalo id at rest and none in a log line.
- Text in `packages/labels/vi/member-notices.json`, exact live wording of `notify_new_member_joined`: header, name, rank line with the group name (label `group_default_name` as the assistant uses), total customers, Zalo UID, time. Leave out the rank line when the count is unknown and the total line when zero. Escape names for HTML.
- Port: add a best-effort `groupMemberCount(groupId): Promise<number | null>` to `apps/assistant/src/zalo.port.ts`, the zca adapter (`getGroupInfo`, `totalMember`, as live), the fake and relay adapters (null) and `zalo-target.guard.ts` (passes through).
- Contract: `ASSISTANT_GROUP_JOIN_PATH` in `packages/contracts/src/assistant.schema.ts`, strict schema, with the existing assistant token guard as `operations/http/assistant-heartbeat.routes.ts` does. The route sends after any read, never inside a transaction, and answers 200 with how many were sent. Without the bot or the chat it sends nothing and answers 200 with 0.
- Wire: `apps/assistant/src/session-events.ts` and `internal-api.adapter.ts`; the route's sender comes from the composition root using `telegramSender` bound to the business chat.
- Tests: assistant (welcome group only; a failure leaves the welcome untouched; count failure still posts with null) and server (text matches a fixture rendered from the live function; escaping; no chat sends nothing; token required; no name in logs).
- Docs: `docs/operations/message-parity.md`, the business chat lines in `docs/operations/backup-and-alerts-runbook.md`, and `.context/decisions/2026-11-05-D64-member-joined-notice.md`.

## Review Triage Log

- medium, patched: a display name with line breaks could add lines that look like the notice's own; the name now stays on one line.
- medium, patched: new adapter and wiring code had no test; added the zca count, the end-to-end post and the Dev group case.
- medium, patched: failure logs lost the HTTP status, and a failed count was not logged.
- medium, patched: the required test that no name reaches a log line was missing.
- low, patched: repeated member in one event; "same wording" hid differences (now listed in message-parity.md); header and D64 wording about the Dev group; docs naming only D62 and D63.
- low, rejected: a slow multi-member send can outlast the assistant's 10 s timeout and log a false failure; joins are nearly always one member and only a log line is wrong.
- low, rejected: no pacing for a bulk add of many members; the live bot had none and D64 accepts a lost notice.
- low, rejected: `getGroupInfo` has no timeout of its own; a stalled read loses only this notice, and the welcome is untouched.
- low, rejected: a database error on the total loses the notice; the route answers 500 and it is logged.
- low, rejected: `customerTotal` loads rows to count them; the customer table is small and runs once per join. Duplicate text helpers are a separate refactor.
- false: inline fixture cannot be regenerated; it was rendered by running the live function, and the comment says how.
