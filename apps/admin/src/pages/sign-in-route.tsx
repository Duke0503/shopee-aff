/**
 * The sign-in route. It goes on to the page asked for exactly once, and only on a session the
 * server confirmed on this visit: a successful sign-in, or a fresh check that finds one. A cached
 * session from before a sign-out never sends the visitor back into the desk.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useStaffSession } from "../session/session.queries";
import { SignInPage } from "./sign-in.page";

export function SignInRoute({ redirect }: { readonly redirect: string | undefined }) {
  const session = useStaffSession({ refetchOnMount: "always" });
  const navigate = useNavigate();
  const gone = useRef(false);
  const confirmed = session.isSuccess && !session.isFetching;
  useEffect(() => {
    if (!confirmed || gone.current) return;
    gone.current = true;
    void (redirect === undefined ? navigate({ to: "/", replace: true }) : navigate({ href: redirect, replace: true }));
  }, [confirmed, navigate, redirect]);
  if (confirmed) return null;
  return <SignInPage />;
}
