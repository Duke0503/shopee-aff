/**
 * The sign-in page as a route (Story 7.2): once the server confirms a session it goes on to the
 * page asked for, or to My money. A signed-in visitor who opens it goes on at once.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useCustomerSession } from "../session/session.queries";
import { SignInPage } from "./sign-in.page";

export function SignInRoute({ redirect }: { readonly redirect: string | undefined }) {
  const navigate = useNavigate();
  const session = useCustomerSession();
  const target = redirect ?? CUSTOMER_PATHS.myMoney;
  const signedIn = session.data !== undefined && !session.isFetching;
  useEffect(() => {
    if (signedIn) void navigate({ href: target, replace: true });
  }, [signedIn, navigate, target]);
  if (signedIn) return null;
  return <SignInPage />;
}
