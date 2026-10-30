/**
 * The signed-in desk: checks the staff session, sends a visitor without one to sign-in with the
 * page they were on, and gives every page the shell and the staff member's role. A failed
 * background re-check (network, 5xx) keeps the desk on screen with the session it has; only a
 * 401 ends it. Sign-out leaves the desk first and drops the cached data after, so nothing flashes
 * a redirect; a sign-out the server did not confirm says so and keeps the desk.
 */
import { Button } from "@cashback/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";

import { isUnauthorized } from "../api/api.queries";
import { adminText } from "../labels";
import { useSignOut, useStaffSession } from "../session/session.queries";
import { StaffContext } from "../session/staff-context";
import { AppShell } from "../shell/app-shell";

function Centered({ children }: { readonly children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center text-[15px] text-muted-foreground">{children}</main>;
}

const isSignInPath = (href: string): boolean => href === "/sign-in" || href.startsWith("/sign-in?") || href.startsWith("/sign-in/");

/**
 * The desk page the staff member is on now. While the router moves to sign-in this layout can
 * render once more with the sign-in address; that address never becomes its own redirect.
 */
function useCurrentDeskHref(): string {
  const href = useRouterState({ select: (s) => s.location.href });
  const last = useRef(href);
  if (!isSignInPath(href)) last.current = href;
  return last.current;
}

export function DeskLayout() {
  const session = useStaffSession();
  const signOut = useSignOut();
  const client = useQueryClient();
  const navigate = useNavigate();
  const here = useCurrentDeskHref();

  if (session.isError && isUnauthorized(session.error)) return <Navigate to="/sign-in" search={{ redirect: here }} replace />;
  if (session.data === undefined) {
    if (!session.isError) {
      return (
        <Centered>
          <p role="status">{adminText("session_checking")}</p>
        </Centered>
      );
    }
    return (
      <Centered>
        <p role="alert">{adminText("session_error")}</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => void session.refetch()}>
          {adminText("session_retry")}
        </Button>
      </Centered>
    );
  }
  const onSignOut = (): void =>
    signOut.mutate(undefined, {
      onSuccess: async () => {
        await navigate({ to: "/sign-in", search: { redirect: undefined }, replace: true });
        client.clear();
      },
    });
  return (
    <StaffContext.Provider value={session.data}>
      <AppShell staff={session.data} onSignOut={onSignOut} notice={signOut.isError ? adminText("sign_out_failed") : null}>
        <Outlet />
      </AppShell>
    </StaffContext.Provider>
  );
}
