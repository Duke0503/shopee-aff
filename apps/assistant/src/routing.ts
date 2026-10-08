/**
 * Where an outgoing message is allowed to go. Ports the assistant's
 * dev-vs-prod safety: a development copy NEVER posts to the main customer
 * group, and nothing is sent to a group we do not listen to.
 */
export type Env = "dev" | "production";

export interface RoutingConfig {
  env: Env;
  mainGroupId: string;
  listenGroupIds: string[];
}

export type SendTarget =
  | { kind: "send"; groupId: string }
  | { kind: "suppressed"; reason: string };

export function routeOutgoing(config: RoutingConfig, groupId: string): SendTarget {
  if (config.env === "dev" && groupId === config.mainGroupId) {
    return { kind: "suppressed", reason: "dev never posts to the main group" };
  }
  if (groupId === config.mainGroupId || config.listenGroupIds.includes(groupId)) {
    return { kind: "send", groupId };
  }
  return { kind: "suppressed", reason: "group is not one we listen to" };
}
