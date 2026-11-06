/**
 * Telling the server who joined (D64): welcome groups only, the count best effort, and a failure
 * here never touches the welcome. Fake session and fake API: nothing reaches Zalo.
 */
import type { AssistantGroupJoin } from "@cashback/contracts";
import { describe, expect, it, vi } from "vitest";

import { groupJoinNotice } from "../src/group-join-notice";
import { messageText } from "../src/messages";
import { sessionEventHandler } from "../src/session-events";

const MAIN = "2813090100064697955";
const DEV = "8786316503449470342";

function notice(count: () => Promise<number | null>) {
  const posted: AssistantGroupJoin[] = [];
  const errors: string[] = [];
  const run = groupJoinNotice({ welcomeGroupIds: [MAIN], zalo: { groupMemberCount: count }, api: { groupJoined: async (join) => (posted.push(join), { sent: join.members.length }) }, onError: (event) => void errors.push(event) });
  return { run, posted, errors };
}

describe("group join notice (D64)", () => {
  it("posts the members of a welcome group with its count", async () => {
    const { run, posted } = notice(async () => 42);
    await run(MAIN, [{ userId: "70001", name: " Lan " }]);
    expect(posted).toEqual([{ groupName: messageText("group_default_name"), memberCount: 42, members: [{ userId: "70001", name: "Lan" }] }]);
  });

  it("posts nothing for another group, such as the Dev group", async () => {
    const count = vi.fn(async () => 42);
    const { run, posted } = notice(count);
    await run(DEV, [{ userId: "70001", name: "Lan" }]);
    expect(posted).toEqual([]);
    expect(count).not.toHaveBeenCalled();
  });

  it("a failed count still posts, without the rank", async () => {
    const { run, posted, errors } = notice(async () => Promise.reject(new Error("zalo")));
    await run(MAIN, [{ userId: "70001", name: "Lan" }]);
    expect(posted[0]?.memberCount).toBeNull();
    expect(errors).toEqual(["assistant.group.member_count_failed"]);
  });

  it("a member repeated in one event is told once", async () => {
    const { run, posted } = notice(async () => 42);
    await run(MAIN, [{ userId: "70001", name: "Lan" }, { userId: "70001", name: "Lan" }]);
    expect(posted[0]?.members).toHaveLength(1);
  });

  it("a member with no name gets the fallback name", async () => {
    const { run, posted } = notice(async () => 42);
    await run(MAIN, [{ userId: "700019999", name: null }]);
    expect(posted[0]?.members[0]?.name).toBe(messageText("member_fallback_name", { suffix: "9999" }));
  });
});

describe("session events keep the welcome and the notice apart (D64)", () => {
  const handlerWith = (welcome: () => Promise<"welcomed">, joinNotice: () => Promise<void>, onError: (event: string, error: unknown) => void) =>
    sessionEventHandler({ friends: { accept: async () => undefined } as never, welcome, joinNotice, api: { heartbeat: async () => ({ receivedAt: "" }) }, beat: () => ({}) as never, onError });
  const JOIN = { kind: "group_join", groupId: MAIN, members: [{ userId: "70001", name: "Lan" }] } as const;

  it("a failed notice leaves the welcome untouched and logs its own event", async () => {
    const welcome = vi.fn(async () => "welcomed" as const);
    const onError = vi.fn();
    handlerWith(welcome, async () => Promise.reject(new Error("server down")), onError)(JOIN);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(welcome).toHaveBeenCalledOnce();
    expect(onError.mock.calls.map((c) => c[0])).toEqual(["assistant.group.join_notice_failed"]);
  });

  it("a notice that never answers does not hold the welcome back", () => {
    const welcome = vi.fn(async () => "welcomed" as const);
    handlerWith(welcome, () => new Promise(() => undefined), vi.fn())(JOIN);
    expect(welcome).toHaveBeenCalledOnce();
  });
});
