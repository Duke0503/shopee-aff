/**
 * The staff screen's dialogs (FR-24, D21, Story 4.20): add a member, confirm a role or status
 * change or a new password, and show a password the server issued, once, with its copy button.
 * Every refusal is the server's message from the label file.
 */
import type { StaffIssuedPassword } from "@cashback/contracts";
import type { StaffRole } from "@cashback/core";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  CodeChip,
  Input,
  Label,
} from "@cashback/ui";
import { useId, useState, type FormEvent } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { useAddStaff } from "./staff.queries";

export const failureText = (error: unknown): string => (error instanceof ApiError ? errorText(error.messageKey, error.code, error.fields) : errorText("error.internal", "internal"));

function Failure({ error }: { readonly error: unknown }) {
  return (
    <p role="alert" className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected">
      {failureText(error)}
    </p>
  );
}

export interface ConfirmProps {
  readonly open: boolean;
  readonly title: string;
  readonly body: string;
  readonly confirm: string;
  readonly pending: boolean;
  readonly error: unknown;
  readonly onConfirm: () => void;
  readonly onClose: () => void;
}

export function ConfirmDialog({ open, title, body, confirm, pending, error, onConfirm, onClose }: ConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
      <AlertDialogContent data-staff-confirm="">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error !== null && <Failure error={error} />}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" className="h-11 md:h-9" disabled={pending}>
              {adminText("staff_cancel")}
            </Button>
          </AlertDialogCancel>
          <Button type="button" className="h-11 md:h-9" disabled={pending} aria-busy={pending} onClick={onConfirm}>
            {pending ? adminText("staff_saving") : confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The issued password, shown once; closing it forgets it. */
export function PasswordDialog({ issued, onClose }: { readonly issued: StaffIssuedPassword | null; readonly onClose: () => void }) {
  return (
    <AlertDialog open={issued !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <AlertDialogContent data-staff-password="">
        <AlertDialogHeader>
          <AlertDialogTitle>{adminText("staff_password_title", { name: issued?.username ?? "" })}</AlertDialogTitle>
          <AlertDialogDescription>{adminText("staff_password_body", { name: issued?.username ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        {issued !== null && (
          <div className="flex min-w-0 flex-col gap-2">
            <CodeChip code={issued.password} className="max-w-full self-start text-base" />
            {issued.sessionsEnded > 0 && <p className="text-meta text-muted-foreground">{adminText("staff_password_ended", { count: issued.sessionsEnded })}</p>}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" className="h-11 md:h-9">
              {adminText("staff_password_done")}
            </Button>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const ROLES: readonly StaffRole[] = ["EMPLOYEE", "ADMIN"];
const USERNAME = /^[a-z0-9._-]{3,64}$/;

export function AddStaffDialog({ open, onClose, onIssued }: { readonly open: boolean; readonly onClose: () => void; readonly onIssued: (issued: StaffIssuedPassword) => void }) {
  const id = useId();
  const add = useAddStaff();
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<StaffRole>("EMPLOYEE");
  const name = username.trim();
  const close = (): void => {
    if (add.isPending) return;
    setUsername("");
    setRole("EMPLOYEE");
    add.reset();
    onClose();
  };
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!USERNAME.test(name)) return;
    add.mutate({ username: name, role }, { onSuccess: (issued) => { setUsername(""); onIssued(issued); } });
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <AlertDialogContent data-staff-add="">
        <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>{adminText("staff_add_title")}</AlertDialogTitle>
            <AlertDialogDescription>{adminText("staff_add_body")}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{adminText("staff_add_username")}</Label>
            <Input id={`${id}-name`} value={username} autoComplete="off" spellCheck={false} autoCapitalize="none" aria-describedby={`${id}-hint`} className="h-11 md:h-9" onChange={(event) => setUsername(event.target.value.toLowerCase())} />
            <p id={`${id}-hint`} className="text-meta text-muted-foreground">{adminText("staff_add_username_hint")}</p>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{adminText("staff_add_role")}</legend>
            <div className="flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <label key={r} className={cn("inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm md:h-9", role === r ? "border-primary bg-secondary" : "border-border")}>
                  <input type="radio" name={`${id}-role`} className="size-4 accent-primary" checked={role === r} onChange={() => setRole(r)} />
                  {adminText(r === "ADMIN" ? "staff_role_ADMIN" : "staff_role_EMPLOYEE")}
                </label>
              ))}
            </div>
          </fieldset>
          {add.isError && <Failure error={add.error} />}
          <AlertDialogFooter>
            <Button type="button" variant="outline" className="h-11 md:h-9" disabled={add.isPending} onClick={close}>
              {adminText("staff_cancel")}
            </Button>
            <Button type="submit" className="h-11 md:h-9" disabled={!USERNAME.test(name) || add.isPending} aria-busy={add.isPending}>
              {add.isPending ? adminText("staff_adding") : adminText("staff_add_confirm")}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
