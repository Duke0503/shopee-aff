import { BadRequestException, Body, Controller, Inject, Post, UseGuards } from "@nestjs/common";

import { MESSAGES, render, type Messages } from "../../../notifications";
import type { Db } from "../../../shared/database/connection";
import { DB } from "../../../shared/database/database.module";
import { AssistantTokenGuard } from "../../../shared/guards/assistant-token.guard";
import {
  nowLocalIso,
  recordActivityLog,
  recordGroupInfo,
  syncGroupMembers,
} from "../../identity";

/** The group the assistant's own group sync falls back to. */
const DEFAULT_GROUP_ID = "2813090100064697955";

interface LogBody {
  action?: unknown;
  customer_id?: unknown;
  display_name?: unknown;
  path?: unknown;
  detail?: unknown;
}

interface GroupInfoBody {
  group_id?: unknown;
  group_name?: unknown;
  total_members?: unknown;
}

interface SyncBody {
  group_id?: unknown;
  group_name?: unknown;
  members?: Array<{ uid?: unknown; name?: unknown }>;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function asDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  return typeof detail === "string" ? detail : JSON.stringify(detail);
}

/** Empty or zero falls back, matching the Python's `int(x or default)`. */
function memberTotal(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? Math.trunc(parsed) : 33;
}

/**
 * What the assistant reports back from the Zalo group: one activity row, the
 * group's size, and its member list. Internal listener only, token required
 * (ADR-16). The writes are Identity's, because these are customer-shaped rows.
 */
@Controller("internal/activity")
@UseGuards(AssistantTokenGuard)
export class AssistantActivityController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MESSAGES) private readonly messages: Messages,
  ) {}

  @Post("log")
  log(@Body() body: LogBody) {
    const result = recordActivityLog(
      this.db,
      {
        action: text(body?.action),
        customerId: text(body?.customer_id) || null,
        displayName: text(body?.display_name) || null,
        path: text(body?.path) || null,
        detail: asDetail(body?.detail),
      },
      nowLocalIso(),
    );
    if (!result.ok) throw new BadRequestException("missing_action");
    return { ok: true, action: result.action };
  }

  @Post("group-info")
  groupInfo(@Body() body: GroupInfoBody) {
    const groupId = text(body?.group_id);
    if (groupId === "") throw new BadRequestException("missing_group_id");

    const groupName = text(body?.group_name) || render(this.messages, "group_default_name");
    const totalMembers = memberTotal(body?.total_members);
    recordGroupInfo(this.db, { groupId, groupName, totalMembers }, nowLocalIso());
    return { ok: true, groupId, groupName, totalMembers };
  }

  @Post("sync-group-members")
  sync(@Body() body: SyncBody) {
    const groupId = text(body?.group_id) || DEFAULT_GROUP_ID;
    const groupName = text(body?.group_name) || render(this.messages, "group_default_name");
    const raw = Array.isArray(body?.members) ? body.members : [];
    if (groupId === "" || raw.length === 0) throw new BadRequestException("missing_data");

    const members = raw.map((member) => {
      const uid = text(member?.uid);
      const name = text(member?.name);
      return {
        uid,
        name: name || render(this.messages, "group_member_default_name", { suffix: uid.slice(-4) }),
      };
    });

    const result = syncGroupMembers(this.db, { groupId, groupName, members }, nowLocalIso());
    return { ok: true, syncedCount: result.synced, total: result.total };
  }
}
