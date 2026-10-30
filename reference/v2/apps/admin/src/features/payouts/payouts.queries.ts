import { useCallback, useEffect, useState } from "react";

import {
  createApiClient,
  type ApiConfirmPayoutResult,
  type ApiPaymentPlan,
  type ApiPaymentsPage,
} from "@mmo/contracts";

/** Data loading lives here, never inside a component (the coding rules). */
const api = createApiClient();

export interface PayablesState {
  data: ApiPaymentsPage | null;
  error: string;
}

/** Who can be paid now, who is blocked, and what has already been sent. */
export function usePayables(reloadKey: number): PayablesState {
  const [state, setState] = useState<PayablesState>({ data: null, error: "" });

  useEffect(() => {
    let live = true;
    api
      .payouts()
      .then((data) => {
        if (live) setState({ data, error: "" });
      })
      .catch((cause: Error) => {
        if (live) setState({ data: null, error: cause.message });
      });
    return () => {
      live = false;
    };
  }, [reloadKey]);

  return state;
}

export interface PaymentPlanState {
  plan: ApiPaymentPlan | null;
  error: string;
}

/**
 * What paying this customer would cover, straight from the server. The dialog
 * shows these figures only; the amount is worked out again when it is recorded.
 */
export function usePaymentPlan(customerId: string | null): PaymentPlanState {
  const [state, setState] = useState<PaymentPlanState>({ plan: null, error: "" });

  useEffect(() => {
    if (customerId === null) {
      setState({ plan: null, error: "" });
      return;
    }
    let live = true;
    api
      .paymentPlan(customerId)
      .then((plan) => {
        if (live) setState({ plan, error: "" });
      })
      .catch((cause: Error) => {
        if (live) setState({ plan: null, error: cause.message });
      });
    return () => {
      live = false;
    };
  }, [customerId]);

  return state;
}

export interface ConfirmPayoutState {
  busy: boolean;
  error: string;
  /** Set once the server recorded it; the amount is ITS figure, not ours. */
  recorded: ApiConfirmPayoutResult | null;
  confirm: (customerId: string, orderIds: string[], note: string, transferCode: string) => Promise<boolean>;
}

export function useConfirmPayout(): ConfirmPayoutState {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recorded, setRecorded] = useState<ApiConfirmPayoutResult | null>(null);

  const confirm = useCallback(
    async (
      customerId: string,
      orderIds: string[],
      note: string,
      transferCode: string,
    ): Promise<boolean> => {
      setBusy(true);
      setError("");
      try {
        setRecorded(await api.confirmPayout({ customerId, orderIds, note, transferCode }));
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { busy, error, recorded, confirm };
}

export interface AskBankState {
  /** The customer the bot was asked about, once it was asked. */
  askedFor: string | null;
  error: string;
  ask: (customerId: string) => Promise<boolean>;
}

/** Ask the bot to request one customer's bank details, privately. */
export function useAskBank(): AskBankState {
  const [askedFor, setAskedFor] = useState<string | null>(null);
  const [error, setError] = useState("");

  const ask = useCallback(async (customerId: string): Promise<boolean> => {
    setError("");
    try {
      await api.askForBank(customerId);
      setAskedFor(customerId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }, []);

  return { askedFor, error, ask };
}
