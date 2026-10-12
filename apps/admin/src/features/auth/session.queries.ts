import { useEffect, useState } from "react";

import { createApiClient, type ApiCustomer } from "@mmo/contracts";

/** Who is signed in. Networking lives outside components. */
const api = createApiClient();

export type SessionStatus = "checking" | "in" | "out";

export interface SessionState {
  status: SessionStatus;
  me: ApiCustomer | null;
  /** Call after signing in or out so the console checks the session again. */
  refresh: () => void;
}

export function useSession(): SessionState {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [me, setMe] = useState<ApiCustomer | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    api
      .me()
      .then((customer) => {
        if (!live) return;
        setMe(customer);
        setStatus("in");
      })
      .catch(() => {
        if (!live) return;
        setMe(null);
        setStatus("out");
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  return {
    status,
    me,
    refresh: () => {
      setStatus("checking");
      setNonce((value) => value + 1);
    },
  };
}
