/**
 * Picks the one Zalo session by `ZALO_MODE` (AD-25, D37): the fake in dev unless the dev env file
 * asks for the dev account, the real account in production. The config has already refused
 * production credentials in dev and the fake in production (assistant.config.ts); the real
 * adapter is opened only here and only for `account`.
 */
import type { Clock } from "@cashback/core";

import type { AssistantConfig } from "./assistant.config";
import { fakeZaloSession } from "./fake-zalo.adapter";
import { openZcaSession } from "./zca-zalo.adapter";
import type { ZaloSession } from "./zalo.port";

export interface SessionOpeners {
  readonly fake: (clock: Clock) => ZaloSession;
  readonly account: (credentialsPath: string, allowedGroupIds: readonly string[], onError: (error: unknown) => void) => Promise<ZaloSession>;
}

const OPENERS: SessionOpeners = { fake: fakeZaloSession, account: openZcaSession };

export async function openZaloSession(config: AssistantConfig, clock: Clock, onError: (error: unknown) => void, openers: SessionOpeners = OPENERS): Promise<ZaloSession> {
  if (config.zaloMode === "fake") return openers.fake(clock);
  if (config.zaloCredentialsPath === null) throw new Error("ZALO_MODE=account needs ZALO_CREDENTIALS_PATH");
  return openers.account(config.zaloCredentialsPath, config.zaloGroupIds, onError);
}
