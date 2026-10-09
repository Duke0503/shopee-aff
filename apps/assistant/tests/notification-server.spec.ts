import { afterEach, describe, expect, it } from "vitest";

import { FakeZaloClient } from "../src/fake-zalo-client";
import {
  createNotificationServer,
  startNotificationServer,
  type NotificationServer,
} from "../src/notification-server";

const TOKEN = "test-token";
const CONFIG = { port: 0, host: "127.0.0.1", token: TOKEN, mainGroupId: "G-MAIN" };

let server: NotificationServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function start(): Promise<{ client: FakeZaloClient; base: string }> {
  const client = new FakeZaloClient();
  server = await startNotificationServer(client, CONFIG);
  return { client, base: `http://127.0.0.1:${server.port}` };
}

function post(base: string, path: string, body: unknown, token = TOKEN): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-assistant-token": token },
    body: JSON.stringify(body),
  });
}

describe("notification server", () => {
  it("refuses to start without a token", () => {
    expect(() => createNotificationServer(new FakeZaloClient(), { ...CONFIG, token: "" })).toThrow();
  });

  it("rejects a call with the wrong token", async () => {
    const { base } = await start();
    const res = await post(base, "/api/notify", { targetId: "U1", message: "hi" }, "wrong");
    expect(res.status).toBe(401);
  });

  it("sends a private message the backend asked for", async () => {
    const { client, base } = await start();
    const res = await post(base, "/api/notify", {
      targetId: "U1",
      type: "user",
      message: "hello",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.sent).toEqual([{ chatId: "U1", text: "hello" }]);
  });

  it("sends a broadcast to the main group when asked for the test group", async () => {
    const { client, base } = await start();
    const res = await post(base, "/api/broadcast", { group: "test", message: "news" });

    expect(res.status).toBe(200);
    expect(client.sent).toEqual([{ chatId: "G-MAIN", text: "news" }]);
  });

  it("sends a broadcast to an explicit group id", async () => {
    const { client, base } = await start();
    await post(base, "/api/broadcast", { group: "G-OTHER", message: "news" });

    expect(client.sent).toEqual([{ chatId: "G-OTHER", text: "news" }]);
  });

  it("rejects a notify without a message", async () => {
    const { base } = await start();
    const res = await post(base, "/api/notify", { targetId: "U1" });
    expect(res.status).toBe(400);
  });

  it("answers group-info", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/group-info`, {
      headers: { "x-assistant-token": TOKEN },
    });
    expect(await res.json()).toEqual({ ok: true, groupId: "G-MAIN" });
  });
});
