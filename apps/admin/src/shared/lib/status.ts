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

/** The state in the owner's words; an unknown one is shown as the server sent it. */
export function statusText(labels: Labels, status: string): string {
  const key = STATUS[status];
  return key === undefined ? status : label(labels, key);
}

export function roleText(labels: Labels, role: string): string {
  const key = ROLE[role];
  return key === undefined ? role : label(labels, key);
}


