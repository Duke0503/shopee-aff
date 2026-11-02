/**
 * Staff (wireframe Nhan vien desktop, FR-24, D21, Story 4.20; admin only): every account with its
 * sign-in name, role, status and last sign-in, and the actions an admin has: a new password
 * (shown once), the role, disable and enable. The root admin stays an active admin, so its row
 * has no action. Every action asks once and is audited on the server; no hash ever reaches the
 * desk. A table from the tablet up, one card per member on a phone.
 */
import type { StaffIssuedPassword, StaffMember } from "@cashback/contracts";
import { formatVnDateTimeOf, systemClock } from "@cashback/core";
import { Button, cn, Skeleton, useLayout, UserPlusIcon } from "@cashback/ui";
import { useState } from "react";

import { adminText } from "../labels";
import { PageHeader } from "../shell/page-header";
import { AddStaffDialog, ConfirmDialog, PasswordDialog } from "./staff-dialogs";
import { useChangeAccess, useResetPassword, useStaffList } from "./staff.queries";

type Action = { readonly kind: "password" | "disable" | "enable" | "role"; readonly member: StaffMember };

function StatusPill({ m }: { readonly m: StaffMember }) {
  const active = m.status === "ACTIVE";
  return <span data-staff-status={m.status} className={cn("inline-flex min-h-6 items-center rounded-xl px-2.5 py-0.5 text-meta font-medium", active ? "bg-status-approved-soft text-status-approved" : "bg-status-neutral-soft text-status-neutral")}>{adminText(active ? "staff_status_ACTIVE" : "staff_status_DISABLED")}</span>;
}

const roleText = (m: StaffMember): string => adminText(m.role === "ADMIN" ? "staff_role_ADMIN" : "staff_role_EMPLOYEE");
const lastSignIn = (m: StaffMember): string => formatVnDateTimeOf(m.lastSignInAt, systemClock) ?? adminText("staff_never");
const LINK = "h-11 rounded-md px-2 text-sm font-medium text-foreground underline-offset-4 hover:bg-muted hover:underline md:h-8";

function Actions({ m, onAction }: { readonly m: StaffMember; readonly onAction: (a: Action) => void }) {
  if (m.root) return <span aria-label={adminText("staff_root")} className="text-muted-foreground">{"\u2013"}</span>;
  if (m.status === "DISABLED") {
    return (
      <div className="-mx-2 flex">
        <button type="button" className={LINK} onClick={() => onAction({ kind: "enable", member: m })}>
          {adminText("staff_enable")}
        </button>
      </div>
    );
  }
  return (
    <div role="group" aria-label={adminText("staff_actions_aria", { name: m.username })} className="-mx-2 flex min-w-0 flex-wrap gap-x-1">
      <button type="button" className={LINK} onClick={() => onAction({ kind: "password", member: m })}>{adminText("staff_reset")}</button>
      <button type="button" className={LINK} onClick={() => onAction({ kind: "role", member: m })}>{adminText(m.role === "ADMIN" ? "staff_make_employee" : "staff_make_admin")}</button>
      <button type="button" className={cn(LINK, "text-destructive")} onClick={() => onAction({ kind: "disable", member: m })}>{adminText("staff_disable")}</button>
    </div>
  );
}

const TH = "h-10 px-4 text-left text-meta font-semibold text-muted-foreground";

function StaffTable({ staff, onAction }: { readonly staff: readonly StaffMember[]; readonly onAction: (a: Action) => void }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full table-fixed text-sm">
        <thead className="bg-muted/60">
          <tr>
            <th scope="col" className={`${TH} w-[24%]`}>{adminText("col_staff_username")}</th>
            <th scope="col" className={`${TH} w-[13%]`}>{adminText("col_staff_role")}</th>
            <th scope="col" className={`${TH} w-[13%]`}>{adminText("col_staff_status")}</th>
            <th scope="col" className={`${TH} w-[17%]`}>{adminText("col_staff_last_sign_in")}</th>
            <th scope="col" className={TH}>{adminText("col_staff_actions")}</th>
          </tr>
        </thead>
        <tbody>
          {staff.map((m) => (
            <tr key={m.staffId} data-staff={m.staffId} className="h-[52px] border-t border-border">
              <td className="truncate px-4 py-2 text-[15px]">{m.username}</td>
              <td className="px-4 py-2">{roleText(m)}</td>
              <td className="px-4 py-2"><StatusPill m={m} /></td>
              <td className="px-4 py-2 whitespace-nowrap tabular-nums">{lastSignIn(m)}</td>
              <td className="px-4 py-2"><Actions m={m} onAction={onAction} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffCards({ staff, onAction }: { readonly staff: readonly StaffMember[]; readonly onAction: (a: Action) => void }) {
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {staff.map((m) => (
        <li key={m.staffId} data-staff={m.staffId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 text-[15px] font-semibold break-words">{m.username}</span>
            <StatusPill m={m} />
          </div>
          <p className="text-meta text-muted-foreground">{`${roleText(m)} \u00b7 ${adminText("col_staff_last_sign_in")} ${lastSignIn(m)}`}</p>
          <Actions m={m} onAction={onAction} />
        </li>
      ))}
    </ul>
  );
}

function confirmText(a: Action): { title: string; body: string; confirm: string } {
  const name = a.member.username;
  if (a.kind === "password") return { title: adminText("staff_reset_title", { name }), body: adminText("staff_reset_body", { name }), confirm: adminText("staff_reset_confirm") };
  const action = adminText(a.kind === "disable" ? "staff_disable" : a.kind === "enable" ? "staff_enable" : a.member.role === "ADMIN" ? "staff_make_employee" : "staff_make_admin");
  const body = adminText(a.kind === "disable" ? "staff_access_disable_body" : a.kind === "enable" ? "staff_access_enable_body" : "staff_access_role_body", { name });
  return { title: adminText("staff_access_title", { action, name }), body, confirm: adminText("staff_access_confirm") };
}

export function StaffPage() {
  const query = useStaffList();
  const phone = useLayout() === "phone";
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [issued, setIssued] = useState<StaffIssuedPassword | null>(null);
  const access = useChangeAccess();
  const reset = useResetPassword();
  const pending = access.isPending || reset.isPending;
  const choose = (a: Action | null): void => {
    access.reset();
    reset.reset();
    setAction(a);
  };
  const run = (): void => {
    if (action === null) return;
    const { kind, member } = action;
    if (kind === "password") {
      reset.mutate(member.staffId, { onSuccess: (done) => { setAction(null); setIssued(done); } });
      return;
    }
    const change = kind === "role" ? { role: member.role === "ADMIN" ? ("EMPLOYEE" as const) : ("ADMIN" as const) } : { status: kind === "disable" ? ("DISABLED" as const) : ("ACTIVE" as const) };
    access.mutate({ staffId: member.staffId, ...change }, { onSuccess: () => setAction(null) });
  };
  const text = action === null ? null : confirmText(action);
  return (
    <>
      <PageHeader
        title={adminText("nav_staff")}
        lead={adminText("staff_lead")}
        action={
          <Button type="button" size="lg" className="h-11 rounded-lg px-4 text-[15px] font-semibold md:h-10" onClick={() => setAdding(true)}>
            <UserPlusIcon aria-hidden />
            {adminText("staff_add")}
          </Button>
        }
      />
      {query.data === undefined ? (
        query.isError ? (
          <p role="alert" className="rounded-xl border border-border bg-card p-5 text-sm text-status-rejected">{adminText("staff_failed")}</p>
        ) : (
          <div role="status" aria-label={adminText("staff_loading")} className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )
      ) : phone ? (
        <StaffCards staff={query.data.staff} onAction={choose} />
      ) : (
        <StaffTable staff={query.data.staff} onAction={choose} />
      )}
      <ConfirmDialog open={text !== null} title={text?.title ?? ""} body={text?.body ?? ""} confirm={text?.confirm ?? ""} pending={pending} error={access.error ?? reset.error ?? null} onConfirm={run} onClose={() => choose(null)} />
      <AddStaffDialog open={adding} onClose={() => setAdding(false)} onIssued={(done) => { setAdding(false); setIssued(done); }} />
      <PasswordDialog issued={issued} onClose={() => setIssued(null)} />
    </>
  );
}
