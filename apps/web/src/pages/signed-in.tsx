/**
 * The gate of every signed-in page (INV-5): while the session is checked a skeleton holds the
 * place. Only the server's 401 means signed out: then the sign-in form shows in place and the
 * page opens as soon as the server accepts. Any other failure (no network, a server error) is
 * said as such with a retry, never as "sign in again"; a session already known stays shown while
 * a later check fails (the offline strip says why).
 */
import { Button, RefreshCwIcon, Skeleton } from "@cashback/ui";
import type { ReactNode } from "react";

import { isUnauthorized } from "../api/api.queries";
import { webText } from "../labels";
import { useCustomerSession } from "../session/session.queries";
import { SignInPage } from "./sign-in.page";

export function SignedIn({ children }: { readonly children: (customerCode: string) => ReactNode }) {
  const session = useCustomerSession();
  if (session.data !== undefined) return children(session.data.customerCode);
  if (session.isPending) {
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 pt-6 md:px-6" aria-busy="true" aria-label={webText("loading")}>
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  if (isUnauthorized(session.error)) return <SignInPage />;
  return (
    <div className="mx-auto flex max-w-[640px] flex-col items-start gap-4 px-4 pt-10 md:px-6" data-session-error>
      <p role="alert" className="text-[15px]">
        {webText("session_check_failed")}
      </p>
      <Button type="button" variant="outline" className="h-11 px-4 text-[15px]" disabled={session.isFetching} onClick={() => void session.refetch()}>
        <RefreshCwIcon aria-hidden />
        {webText("retry")}
      </Button>
    </div>
  );
}
