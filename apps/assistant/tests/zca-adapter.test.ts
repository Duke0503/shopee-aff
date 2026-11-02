/**
 * The real-account adapter (zca-zalo.adapter.ts) against a fake zca-js module: no test loads the
 * real library, opens a socket or reads a real session file. The session file here is a fake one
 * written to a temporary folder.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nonBlank, RECONNECT_DELAYS_MS } from "../src/zca-connection";
import { incomingOf, openZcaSession, textOf, ZaloLoginError } from "../src/zca-zalo.adapter";
import { ZaloTargetRefused } from "../src/zalo-target.guard";
import type { IncomingMessage, SessionEvent } from "../src/zalo.port";

const zca = vi.hoisted(() => ({
  constructed: [] as unknown[],
  loginWith: [] as unknown[],
  refuseLogin: false,
  api: null as unknown,
}));

vi.mock("zca-js", () => ({
  Zalo: class {
    constructor(options: unknown) {
      zca.constructed.push(options);
    }
    async login(credentials: unknown) {
      zca.loginWith.push(credentials);
      if (zca.refuseLogin) throw new Error(`refused ${JSON.stringify(credentials)}`);
      return zca.api;
    }
  },
}));

const MAIN_GROUP = "2813090100064697955";
const DEV_GROUP = "8786316503449470342";
const OWN_ID = "1234567890123456789";
const SECRET_COOKIE = "zpw_sek-SECRET-COOKIE-VALUE";
const SECRET_IMEI = "imei-SECRET-0000";
const CREDENTIALS = {
  imei: SECRET_IMEI,
  userAgent: "Mozilla/5.0 SECRET-UA",
  cookie: [{ name: "zpw_sek", value: SECRET_COOKIE, domain: ".zalo.me" }],
};

function fakeApi() {
  const listener = Object.assign(new EventEmitter(), { start: vi.fn(), stop: vi.fn() });
  return {
    listener,
    sendMessage: vi.fn(async () => ({ message: { msgId: 1 }, attachment: [] })),
    sendFriendRequest: vi.fn(async () => ""),
    acceptFriendRequest: vi.fn(async () => ""),
    getFriendRequestStatus: vi.fn(async () => ({
      is_friend: 0,
      is_requested: 0,
      is_requesting: 0,
      addFriendPrivacy: 0,
      isSeenFriendReq: false,
    })),
    getOwnId: vi.fn(() => OWN_ID),
    getFriendRecommendations: vi.fn(async (): Promise<{ recommItems: { dataInfo: { userId: string; recommType: number } }[] }> => ({ recommItems: [] })),
    context: { settings: { features: { socket: { close_and_retry_codes: [1000, 1006, 3000, 3003] } } } },
    getContext() {
      return this.context;
    },
  };
}

let dir: string;
let api: ReturnType<typeof fakeApi>;
const timers: { run: () => void; ms: number }[] = [];
const options = {
  setTimer: (run: () => void, ms: number) => timers.push({ run, ms }),
  clearTimer: () => undefined,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zca-adapter-"));
  api = fakeApi();
  zca.api = api;
  zca.constructed.length = 0;
  zca.loginWith.length = 0;
  zca.refuseLogin = false;
  timers.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function credentialsFile(content: string = JSON.stringify(CREDENTIALS)): string {
  const path = join(dir, "credentials.json");
  writeFileSync(path, content, "utf8");
  return path;
}

const open = (
  groups: readonly string[] = [MAIN_GROUP],
  onError: (error: unknown) => void = () => undefined,
) => openZcaSession(credentialsFile(), groups, onError, options);

describe("zca adapter: login as the live assistant does", () => {
  it("logs in with the session file as written by login.js, with zca-js logging off, and starts the listener with retryOnClose", async () => {
    await open();
    expect(zca.constructed).toEqual([{ logging: false, selfListen: false, checkUpdate: false }]);
    expect(zca.loginWith).toEqual([CREDENTIALS]);
    expect(api.listener.start).toHaveBeenCalledWith({ retryOnClose: true });
  });

  it("reports its own account id from getOwnId", async () => {
    expect((await open()).accountId()).toBe(OWN_ID);
  });

  it("never puts the session file's content in an error or on the console", async () => {
    const out: string[] = [];
    const capture = (...args: unknown[]) => void out.push(args.map(String).join(" "));
    for (const method of ["log", "info", "warn", "error", "debug"] as const)
      vi.spyOn(console, method).mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation(
      (chunk) => (out.push(String(chunk)), true),
    );
    vi.spyOn(process.stderr, "write").mockImplementation(
      (chunk) => (out.push(String(chunk)), true),
    );
    const failures: unknown[] = [];
    const attempt = (path: string) =>
      openZcaSession(path, [MAIN_GROUP], () => undefined, options).catch(
        (error: unknown) => void failures.push(error),
      );
    await attempt(credentialsFile(`{"imei":"${SECRET_IMEI}","cookie":"${SECRET_COOKIE}`));
    await attempt(credentialsFile(JSON.stringify({ imei: SECRET_IMEI, cookie: SECRET_COOKIE })));
    zca.refuseLogin = true;
    await attempt(credentialsFile());
    await attempt(join(dir, "missing.json"));
    vi.restoreAllMocks();
    expect(failures).toHaveLength(4);
    expect(failures.every((f) => f instanceof ZaloLoginError)).toBe(true);
    const seen = [
      ...out,
      ...failures.map((f) => `${(f as Error).message} ${(f as Error).stack ?? ""}`),
    ].join("\n");
    for (const secret of [SECRET_COOKIE, SECRET_IMEI, "SECRET-UA"])
      expect(seen).not.toContain(secret);
    expect((failures[1] as Error).message).toContain("cookie");
    expect((failures[1] as Error).message).toContain("userAgent");
  });
});

describe("zca adapter: incoming messages", () => {
  const handled = async (raw: unknown, groups: readonly string[] = [MAIN_GROUP]) => {
    const session = await open(groups);
    const got: IncomingMessage[] = [];
    session.onMessage(async (m) => void got.push(m));
    api.listener.emit("message", raw);
    await Promise.resolve();
    return got;
  };

  it("maps a private message: the sender's chat, id, display name and text", async () => {
    expect(
      await handled({
        type: 0,
        threadId: "70001",
        isSelf: false,
        data: { uidFrom: "70001", dName: "Lan", msgType: "webchat", content: "/sodu" },
      }),
    ).toEqual([
      {
        chat: { kind: "private", userId: "70001" },
        senderId: "70001",
        senderName: "Lan",
        text: "/sodu",
      },
    ]);
  });

  it("maps a group message, its mentions aside, to the group chat with the sender", async () => {
    const raw = {
      type: 1,
      threadId: MAIN_GROUP,
      isSelf: false,
      data: {
        uidFrom: "70002",
        dName: "Minh",
        content: "@Bot https://s.shopee.vn/abc",
        mentions: [{ uid: OWN_ID, pos: 0, len: 4, type: 0 }],
      },
    };
    expect(await handled(raw)).toEqual([
      {
        chat: { kind: "group", groupId: MAIN_GROUP },
        senderId: "70002",
        senderName: "Minh",
        text: "@Bot https://s.shopee.vn/abc",
      },
    ]);
  });

  it("marks a quoted reply", async () => {
    const [message] = await handled({
      type: 0,
      threadId: "70001",
      data: {
        uidFrom: "70001",
        content: "VCB 0123456789 NGUYEN",
        quote: { ownerId: OWN_ID, msg: "..." },
      },
    });
    expect(message?.quoted).toBe(true);
  });

  it("reads a shared link card as its link first, and drops stickers, photos and its own messages", () => {
    const card = {
      uidFrom: "70001",
      msgType: "chat.recommended",
      content: { title: "Ao thun", description: "", href: "https://s.shopee.vn/xyz", params: "{}" },
    };
    expect(textOf(card)).toBe("https://s.shopee.vn/xyz\nAo thun");
    expect(
      textOf({
        msgType: "chat.link",
        content: { title: "x", params: JSON.stringify({ href: "https://vt.tiktok.com/abc" }) },
      }),
    ).toBe("https://vt.tiktok.com/abc\nx");
    expect(
      incomingOf({
        type: 0,
        threadId: "70001",
        data: { uidFrom: "70001", msgType: "chat.sticker", content: { id: 1, catId: 2 } },
      }),
    ).toBeNull();
    expect(
      incomingOf({
        type: 0,
        threadId: "70001",
        data: {
          uidFrom: "70001",
          msgType: "chat.photo",
          content: { href: "https://photo.zdn.vn/x.jpg", title: "" },
        },
      }),
    ).toBeNull();
    expect(
      incomingOf({
        type: 0,
        threadId: "70001",
        isSelf: true,
        data: { uidFrom: OWN_ID, content: "hello" },
      }),
    ).toBeNull();
  });

  it("drops a message from a group outside ZALO_GROUP_IDS (dev hears only the Dev group)", async () => {
    expect(
      await handled(
        {
          type: 1,
          threadId: MAIN_GROUP,
          data: { uidFrom: "70002", content: "https://s.shopee.vn/abc" },
        },
        [DEV_GROUP],
      ),
    ).toEqual([]);
  });
});

describe("zca adapter: sends", () => {
  it("sends a private message to the user thread and a group message with its mentions to the group thread", async () => {
    const session = await open();
    await session.sendText({ kind: "private", userId: "70001" }, "xin chao");
    await session.sendText({ kind: "group", groupId: MAIN_GROUP }, "@Lan link", [
      { userId: "70001", pos: 0, len: 4 },
    ]);
    await session.sendText({ kind: "group", groupId: MAIN_GROUP }, "plain");
    expect(api.sendMessage.mock.calls).toEqual([
      [{ msg: "xin chao" }, "70001", 0],
      [{ msg: "@Lan link", mentions: [{ uid: "70001", pos: 0, len: 4 }] }, MAIN_GROUP, 1],
      [{ msg: "plain" }, MAIN_GROUP, 1],
    ]);
  });

  it("refuses a group outside ZALO_GROUP_IDS before zca-js: dev may only write to the Dev group", async () => {
    const session = await open([DEV_GROUP]);
    await expect(
      session.sendText({ kind: "group", groupId: MAIN_GROUP }, "x"),
    ).rejects.toBeInstanceOf(ZaloTargetRefused);
    await session.sendText({ kind: "group", groupId: DEV_GROUP }, "y");
    expect(api.sendMessage.mock.calls).toEqual([[{ msg: "y" }, DEV_GROUP, 1]]);
  });

  it("review 4: asks for a friend as friends.js does, and hands someone who asked us to the checked acceptance path instead of accepting", async () => {
    const session = await open();
    const got: SessionEvent[] = [];
    session.onEvent((event) => void got.push(event));
    await session.addFriend("70001", "greeting");
    api.getFriendRequestStatus.mockResolvedValueOnce({
      is_friend: 0,
      is_requested: 1,
      is_requesting: 0,
      addFriendPrivacy: 0,
      isSeenFriendReq: false,
    });
    await session.addFriend("70002", "greeting");
    api.getFriendRequestStatus.mockResolvedValueOnce({
      is_friend: 1,
      is_requested: 0,
      is_requesting: 0,
      addFriendPrivacy: 0,
      isSeenFriendReq: false,
    });
    await session.addFriend("70003", "greeting");
    expect(api.sendFriendRequest.mock.calls).toEqual([["greeting", "70001"]]);
    expect(api.acceptFriendRequest).not.toHaveBeenCalled();
    expect(got).toEqual([{ kind: "friend_request", userId: "70002" }]);
  });

  it("review 5: lists the friend requests still waiting in Zalo, received ones only", async () => {
    const session = await open();
    api.getFriendRecommendations.mockResolvedValueOnce({ recommItems: [{ dataInfo: { userId: "70001", recommType: 2 } }, { dataInfo: { userId: "70002", recommType: 1 } }, { dataInfo: { userId: " ", recommType: 2 } }] });
    expect(await session.pendingFriendRequests()).toEqual(["70001"]);
  });
});

describe("zca adapter: connection state for the heartbeat", () => {
  it("is connected only between connected and a drop, so a lost session shows in the heartbeat", async () => {
    const session = await open();
    expect(session.connected()).toBe(false);
    api.listener.emit("connected");
    expect(session.connected()).toBe(true);
    api.listener.emit("disconnected", 1006, "abnormal");
    expect(session.connected()).toBe(false);
    api.listener.emit("connected");
    api.listener.emit("error", new Error("socket"));
    expect(session.connected()).toBe(true);
  });

  it("starts the listener again after zca-js gives up, with the live assistant's backoff, and not after stop", async () => {
    const session = await open();
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      api.listener.emit("closed", 1006, "abnormal");
      api.listener.emit("closed", 1006, "abnormal");
      const timer = timers.shift();
      delays.push(timer?.ms ?? -1);
      timer?.run();
    }
    expect(timers).toEqual([]);
    expect(delays).toEqual([3_000, 6_000, 12_000, 24_000, 30_000, 30_000]);
    expect(api.listener.start).toHaveBeenCalledTimes(7);
    api.listener.emit("connected");
    api.listener.emit("closed", 1006, "abnormal");
    expect(timers.map((t) => t.ms)).toEqual([RECONNECT_DELAYS_MS[0]]);
    await session.stop();
    timers[0]?.run();
    expect(api.listener.start).toHaveBeenCalledTimes(7);
    expect(session.connected()).toBe(false);
    timers.length = 0;
    api.listener.emit("closed", 1000, "manual");
    expect(timers).toEqual([]);
    expect(api.listener.stop).toHaveBeenCalled();
  });
});

describe("zca adapter: friend requests and group joins", () => {
  const events = async () => {
    const session = await open([MAIN_GROUP]);
    const got: SessionEvent[] = [];
    session.onEvent((event) => void got.push(event));
    return got;
  };

  it("passes on a friend request someone sent, never one of its own, and accepts only when asked to", async () => {
    const got = await events();
    api.listener.emit("friend_event", { type: 2, isSelf: false, threadId: "70001", data: { fromUid: "70001", toUid: OWN_ID, message: "hi" } });
    api.listener.emit("friend_event", { type: 2, isSelf: true, threadId: "70002", data: { fromUid: OWN_ID, toUid: "70002" } });
    api.listener.emit("friend_event", { type: 0, isSelf: false, threadId: "70003", data: "70003" });
    expect(got).toEqual([{ kind: "friend_request", userId: "70001" }]);
    expect(api.acceptFriendRequest).not.toHaveBeenCalled();
    const session = await open();
    await session.acceptFriend("70001");
    expect(api.acceptFriendRequest.mock.calls).toEqual([["70001"]]);
  });

  it("passes on the members who joined an allowed group, without this account, and drops joins elsewhere", async () => {
    const got = await events();
    const join = (groupId: string) => ({ type: "join", act: "join", isSelf: false, threadId: groupId, data: { groupId, updateMembers: [{ id: "70001", dName: "Lan" }, { id: OWN_ID, dName: "Bot" }, { id: "70002", dName: "" }] } });
    api.listener.emit("group_event", join(MAIN_GROUP));
    api.listener.emit("group_event", join("999"));
    api.listener.emit("group_event", { type: "leave", act: "leave", isSelf: false, threadId: MAIN_GROUP, data: { updateMembers: [{ id: "70001" }] } });
    expect(got).toEqual([{ kind: "group_join", groupId: MAIN_GROUP, members: [{ userId: "70001", name: "Lan" }, { userId: "70002", name: null }] }]);
  });
});

describe("zca adapter: another login takes the account", () => {
  it("takes the conflict codes out of zca-js's own retries at start", async () => {
    await open();
    expect(api.context.settings.features.socket.close_and_retry_codes).toEqual([1000, 1006]);
  });

  it("a close with code 3000 is a conflict: reported once, listener stopped, no reconnect, and a later socket is closed at once", async () => {
    const session = await open();
    const got: SessionEvent[] = [];
    session.onEvent((event) => void got.push(event));
    api.listener.emit("connected");
    api.listener.emit("disconnected", 3000, "duplicate connection");
    api.listener.emit("closed", 3000, "duplicate connection");
    expect(got).toEqual([{ kind: "session_conflict" }]);
    expect([session.connected(), session.conflicted()]).toEqual([false, true]);
    expect(timers).toEqual([]);
    expect(api.listener.stop).toHaveBeenCalledTimes(1);
    api.listener.emit("connected");
    expect(session.connected()).toBe(false);
    expect(api.listener.stop).toHaveBeenCalledTimes(2);
    expect(api.listener.start).toHaveBeenCalledTimes(1);
  });

  it("frequent drops with other codes are a flaky network, not a conflict: it keeps reconnecting with the backoff", async () => {
    const session = await open();
    for (const code of [1006, 1006, 1006, 1000]) {
      api.listener.emit("disconnected", code, "abnormal");
      api.listener.emit("closed", code, "abnormal");
      timers.shift()?.run();
    }
    expect(session.conflicted()).toBe(false);
    expect(api.listener.start).toHaveBeenCalledTimes(5);
    expect(api.listener.stop).not.toHaveBeenCalled();
  });
});

describe("code review fixes", () => {
  it("review 2: a join this account caused (it added or approved the member) still welcomes, without the account itself", async () => {
    const session = await open([MAIN_GROUP]);
    const got: SessionEvent[] = [];
    session.onEvent((event) => void got.push(event));
    api.listener.emit("group_event", { type: "join", act: "join", isSelf: true, threadId: MAIN_GROUP, data: { updateMembers: [{ id: "70001", dName: "Lan" }, { id: OWN_ID, dName: "Bot" }] } });
    api.listener.emit("friend_event", { type: 2, isSelf: true, threadId: "70002", data: { fromUid: "70002" } });
    expect(got).toEqual([{ kind: "group_join", groupId: MAIN_GROUP, members: [{ userId: "70001", name: "Lan" }] }]);
  });

  it("review 6: a listener start that throws is tried again with the backoff, but never after stop or a conflict", async () => {
    api.listener.start.mockImplementation(() => {
      throw new Error("no socket");
    });
    const errors: unknown[] = [];
    const session = await open([MAIN_GROUP], (e) => void errors.push(e));
    expect(timers.map((t) => t.ms)).toEqual([RECONNECT_DELAYS_MS[0]]);
    timers.shift()?.run();
    expect(timers.map((t) => t.ms)).toEqual([RECONNECT_DELAYS_MS[1]]);
    api.listener.start.mockImplementation(() => undefined);
    timers.shift()?.run();
    expect(timers).toEqual([]);
    expect(api.listener.start).toHaveBeenCalledTimes(3);
    expect(errors).toHaveLength(2);
    api.listener.emit("disconnected", 3000, "duplicate connection");
    api.listener.start.mockImplementation(() => {
      throw new Error("no socket");
    });
    api.listener.emit("closed", 3000, "duplicate connection");
    expect(timers).toEqual([]);
    await session.stop();
  });

  it("review 9: one reader of zca-js text trims every value and treats blanks as absent", () => {
    expect(nonBlank("  Lan ")).toBe("Lan");
    expect([nonBlank("   "), nonBlank(7), nonBlank(null)]).toEqual([null, null, null]);
    expect(incomingOf({ type: 0, threadId: "70001", data: { uidFrom: "70001", dName: "  ", content: " /id " } })).toEqual({ chat: { kind: "private", userId: "70001" }, senderId: "70001", senderName: null, text: "/id" });
  });
});
