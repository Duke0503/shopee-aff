/**
 * Apply and dismiss in the review case panel (EXPERIENCE.md review case panel, M-3, Story 4.15).
 * Each needs a typed reason. Apply first asks the server what would happen and shows its answer
 * (`review_preview_owner`: the code and the state); only then can staff confirm, once. Changing the reason,
 * the candidate or the outcome drops the preview, so what is confirmed is what was shown. The only
 * choices are the rule's own candidates (when there are several) and, for a FROZEN order, restore
 * or reject; there is no amount field and no way to name another customer. A refusal shows the
 * label file's sentence and the case stays open. A network payout case offers dismiss only.
 */
import type { ReviewCaseDetail } from "@cashback/contracts";
import { Button, Label, Textarea } from "@cashback/ui";
import { useId, useState, type ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { adminText, errorText } from "../labels";
import { ApplyChoices, ApplySteps, PreviewNote } from "./review-apply-parts";
import { useApplyReview, useDismissReview, usePreviewReview } from "./review.queries";

type Mode = "idle" | "apply" | "dismiss";

function failureText(error: unknown): string {
  return error instanceof ApiError
    ? errorText(error.messageKey, error.code)
    : errorText("error.internal", "internal");
}

function Alert({ children }: { readonly children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-md bg-status-rejected-soft p-3 text-sm break-words text-status-rejected"
    >
      {children}
    </p>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{adminText("review_reason_label")}</Label>
      <Textarea
        id={id}
        value={value}
        maxLength={500}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className="text-base md:text-sm"
      />
      <p className="text-caption text-muted-foreground">{adminText("review_reason_hint")}</p>
    </div>
  );
}

function ApplyForm({
  detail,
  onCancel,
}: {
  readonly detail: ReviewCaseDetail;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [customerId, setCustomerId] = useState(detail.candidates[0]?.customerId ?? "");
  const [outcome, setOutcome] = useState<"restore" | "reject">("restore");
  const preview = usePreviewReview();
  const apply = useApplyReview();
  const several = detail.candidates.length > 1;
  const input = {
    caseId: detail.caseId,
    reason: reason.trim(),
    ...(several ? { customerId } : {}),
    ...(detail.frozen ? { outcome } : {}),
  };
  const edit = (fn: () => void): void => {
    fn();
    preview.reset();
    apply.reset();
  };
  const shown = preview.data;
  return (
    <div data-review-form="apply" className="flex min-w-0 flex-col gap-3">
      <ApplyChoices
        detail={detail}
        customerId={customerId}
        outcome={outcome}
        onCustomer={(v) => edit(() => setCustomerId(v))}
        onOutcome={(v) => edit(() => setOutcome(v))}
      />
      <ReasonField value={reason} onChange={(v) => edit(() => setReason(v))} />
      {shown !== undefined && <PreviewNote preview={shown} />}
      {preview.isError && <Alert>{failureText(preview.error)}</Alert>}
      {apply.isError && <Alert>{failureText(apply.error)}</Alert>}
      <ApplySteps
        previewed={shown !== undefined}
        reasonMissing={reason.trim() === ""}
        previewing={preview.isPending}
        saving={apply.isPending}
        onPreview={() => preview.mutate(input)}
        onApply={() => apply.mutate(input)}
        onCancel={onCancel}
      />
      {apply.isSuccess && <p className="sr-only">{adminText("review_done_applied")}</p>}
    </div>
  );
}

function DismissForm({
  detail,
  onCancel,
}: {
  readonly detail: ReviewCaseDetail;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const dismiss = useDismissReview();
  return (
    <div data-review-form="dismiss" className="flex min-w-0 flex-col gap-3">
      <ReasonField
        value={reason}
        onChange={(v) => {
          setReason(v);
          dismiss.reset();
        }}
      />
      {dismiss.isError && <Alert>{failureText(dismiss.error)}</Alert>}
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="coarse:h-11" onClick={onCancel}>
          {adminText("review_cancel")}
        </Button>
        <Button
          type="button"
          className="coarse:h-11"
          disabled={reason.trim() === "" || dismiss.isPending}
          onClick={() => dismiss.mutate({ caseId: detail.caseId, reason: reason.trim() })}
        >
          {adminText(dismiss.isPending ? "review_saving" : "review_dismiss_confirm")}
        </Button>
      </div>
    </div>
  );
}

export function ReviewActions({ detail }: { readonly detail: ReviewCaseDetail }) {
  const [mode, setMode] = useState<Mode>("idle");
  if (detail.status !== "OPEN") return null;
  if (mode === "apply") return <ApplyForm detail={detail} onCancel={() => setMode("idle")} />;
  if (mode === "dismiss") return <DismissForm detail={detail} onCancel={() => setMode("idle")} />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {!detail.applicable && (
        <p className="text-sm break-words text-muted-foreground">
          {adminText("review_dismiss_only")}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="coarse:h-11"
          onClick={() => setMode("dismiss")}
        >
          {adminText("review_dismiss")}
        </Button>
        {detail.applicable && (
          <Button type="button" className="coarse:h-11" onClick={() => setMode("apply")}>
            {adminText("review_apply")}
          </Button>
        )}
      </div>
    </div>
  );
}
