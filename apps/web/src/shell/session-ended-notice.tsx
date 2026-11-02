/**
 * The sentence of `error.session_ended_new_password` (Story 7.2 AC5) under the top bar on every
 * page, kept by the website once the server has said it, until the customer signs in again or
 * dismisses it. Calm blue: it is information, not an error.
 */
import { Button } from "@cashback/ui";

import { errorText, webText } from "../labels";
import { useSessionEnded } from "../session/session.queries";

export function SessionEndedNotice() {
  const { ended, dismiss } = useSessionEnded();
  if (!ended) return null;
  return (
    <div role="status" data-session-ended className="border-b border-status-approved/20 bg-status-approved-soft text-status-approved">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 px-4 py-1.5 md:px-6">
        <p className="min-w-0 flex-1 py-2 text-[15px] font-medium">{errorText("error.session_ended_new_password", "unauthorized")}</p>
        <Button type="button" variant="ghost" className="h-11 px-3 text-[15px] text-status-approved hover:bg-card/60 hover:text-status-approved" onClick={dismiss}>
          {webText("notice_dismiss")}
        </Button>
      </div>
    </div>
  );
}
