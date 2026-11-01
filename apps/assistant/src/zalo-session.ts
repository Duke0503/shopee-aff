/**
 * Picks the one Zalo session by `ZALO_MODE` (AD-25, D37): the fake in dev unless the dev env file
 * asks for the dev account or the send-only relay to the Dev group, the real account in production. The config has already refused
 * production credentials in dev and the fake in production (assistant.config.ts); the real
 * adapter is opened only here and only for `account`.
 */
import type { Clock } from "@cashback/core";

import type { AssistantConfig } from "./assistant.config";
import { fakeZaloSession } from "./fake-zalo.adapter";
import type { FetchLike } from "./internal-api.adapter";
import { relayZaloSession } from "./relay-zalo.adapter";
import { guardTargets } from "./zalo-target.guard";
import { openZcaSession } from "./zca-zalo.adapter";
import type { ZaloSession } from "./zalo.port";

export interface SessionOpeners {
  readonly fake: (clock: Clock) => ZaloSession;
  readonly account: (credentialsPath: string, allowedGroupIds: readonly string[], onError: (error: unknown) => void) => Promise<ZaloSession>;
  readonly relay: (token: string, devGroupId: string) => ZaloSession;
}

const OPENERS: SessionOpeners = { fake: fakeZaloSession, account: openZcaSession, relay: (token, devGroupId) => relayZaloSession({ token, devGroupId, fetch: fetch as unknown as FetchLike }) };

/** The session `ZALO_MODE` names, always behind `guardTargets`, whichever adapter it is. */
export async function openZaloSession(config: AssistantConfig, clock: Clock, onError: (error: unknown) => void, openers: SessionOpeners = OPENERS): Promise<ZaloSession> {
  return guardTargets(await openAdapter(config, clock, onError, openers), config.zaloGroupIds);
}

async function openAdapter(config: AssistantConfig, clock: Clock, onError: (error: unknown) => void, openers: SessionOpeners): Promise<ZaloSession> {
  if (config.zaloMode === "fake") return openers.fake(clock);
  if (config.zaloMode === "relay") {
    const group = config.zaloGroupIds[0];
    if (config.env !== "dev" || config.liveBotToken === null || group === undefined || config.zaloGroupIds.length !== 1) throw new Error("ZALO_MODE=relay needs dev, LIVE_BOT_TOKEN and the one Dev group");
    return openers.relay(config.liveBotToken, group);
  }
  if (config.zaloCredentialsPath === null) throw new Error("ZALO_MODE=account needs ZALO_CREDENTIALS_PATH");
  return openers.account(config.zaloCredentialsPath, config.zaloGroupIds, onError);
}
