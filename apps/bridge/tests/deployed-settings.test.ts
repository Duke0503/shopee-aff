import { describe, expect, it } from "vitest";

import { bridgeService } from "../src/bridge-service";
import { fakeChrome } from "./fakes";

describe("deployed settings", () => {
  it("a profile with no settings takes the deployment's bridge-config.json once, so nobody types the token", async () => {
    const chrome = fakeChrome();
    const token = "t".repeat(40);
    const logs: string[] = [];
    let polled = "";
    const stop = { stopped: false };
    const service = bridgeService(
      {
        chrome,
        fetch: async (url: string) => {
          polled = url;
          stop.stopped = true;
          throw new Error("stop");
        },
        follow: async () => ({ finalUrl: "" }),
        wait: async () => undefined,
        randomBytes: (n) => new Uint8Array(n),
        log: (event) => logs.push(event),
        deployedSettings: async () => ({ serverUrl: "http://127.0.0.1:8081", token }),
      },
      stop,
    );
    await service.start().catch(() => undefined);
    const stored = await chrome.storage.local.get(["serverUrl", "token"]);
    expect(stored).toMatchObject({ serverUrl: "http://127.0.0.1:8081", token });
    expect(logs).toContain("bridge.settings.from_deployment");
    expect(polled.startsWith("http://127.0.0.1:8081/")).toBe(true);
  });
});
