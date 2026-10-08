import { describe, expect, it } from "vitest";
import { routeOutgoing, type RoutingConfig } from "../src/routing";

const config = (env: RoutingConfig["env"]): RoutingConfig => ({
  env,
  mainGroupId: "MAIN",
  listenGroupIds: ["TEST", "OTHER"],
});

describe("routeOutgoing", () => {
  it("sends to the main group in production", () => {
    expect(routeOutgoing(config("production"), "MAIN")).toEqual({ kind: "send", groupId: "MAIN" });
  });

  it("NEVER sends to the main group in dev", () => {
    expect(routeOutgoing(config("dev"), "MAIN")).toEqual({
      kind: "suppressed",
      reason: "dev never posts to the main group",
    });
  });

  it("sends to a listened group in either environment", () => {
    expect(routeOutgoing(config("dev"), "TEST").kind).toBe("send");
    expect(routeOutgoing(config("production"), "OTHER").kind).toBe("send");
  });

  it("suppresses a group we do not listen to", () => {
    expect(routeOutgoing(config("production"), "RANDOM")).toEqual({
      kind: "suppressed",
      reason: "group is not one we listen to",
    });
  });
});
