import { label, type LabelKey, type Labels } from "./labels";

/** Order states, as the label file names them. */
const STATUS: Record<string, LabelKey> = {
  awaiting_approval: "status_awaiting_approval",
  approved: "status_approved",
  rejected: "status_rejected",
  paid: "status_paid",
};

/** Who a row is: the owner, staff, or a customer. */
const ROLE: Record<string, LabelKey> = {
  admin: "admin_role_admin",
  employee: "admin_role_employee",
  user: "admin_role_user",
};

/** The marketplace an order came from. */
const PLATFORM: Record<string, LabelKey> = {
  shopee: "admin_platform_shopee",
  tiktok: "admin_platform_tiktok",
};

/** Whether the marketplace has already paid us for the order. */
const SETTLEMENT: Record<string, LabelKey> = {
  unsettled: "admin_settlement_unsettled",
  settled: "admin_settlement_settled",
  processing: "admin_settlement_processing",
};

/** Why a payout is on hold. Unknown reasons are shown as the server sent them. */
const BLOCKED: Record<string, LabelKey> = {
  "no bank account on file": "profile_bank_not_set",
};

/** The state in the owner's words; an unknown one is shown as the server sent it. */
export function statusText(labels: Labels, status: string): string {
  const key = STATUS[status];
  return key === undefined ? status : label(labels, key);
}

export function roleText(labels: Labels, role: string): string {
  const key = ROLE[role];
  return key === undefined ? role : label(labels, key);
}

export function platformText(labels: Labels, platform: string): string {
  const key = PLATFORM[platform];
  return key === undefined ? platform : label(labels, key);
}

export function settlementText(labels: Labels, settlement: string): string {
  const key = SETTLEMENT[settlement];
  return key === undefined ? settlement : label(labels, key);
}

/** Why a customer cannot be paid yet, in the owner's words. */
export function blockedText(labels: Labels, reason: string | null): string {
  if (reason === null) return "";
  const key = BLOCKED[reason];
  return key === undefined ? reason : label(labels, key);
}


