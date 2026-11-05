# D64 (Telegram notice to the DP Business group when a member joins the Zalo group)

- Status: accepted
- Date: 2026-11-05
- Approved by: the project owner asked for the live notice back and accepted that a rejoin is told
  again, as live (2026-11-05).

## Context

The live bot told the DP Business group about each join (`notify_new_member_joined`). The new platform
only welcomed the member.

## Decision

- On a join in a welcome group, the assistant reads the group's member count and posts the members to
  `POST /internal/assistant/group-joins`. The server sends one message per member to
  `TELEGRAM_BUSINESS_CHAT_ID`, in the live wording, outside any transaction.
- Only the configured welcome groups are told: production's, never the Dev group. A dev assistant has
  the Dev group alone, and a dev server refuses a production chat.
- Nothing is stored and joining registers no one (D25). The notice runs apart from the welcome, so a
  failure of one never touches the other.

## Consequences

- A failed send, or a join while the server or Telegram is down, is logged by name and not retried:
  the notice is lost. This matches the live bot, and it keeps no name or Zalo id at rest.
- The member's name and Zalo id reach the business chat only, never a log line.
