/**
 * The parts of the review apply form (Story 4.15): the choice of one of the rule's own candidates
 * and, for a FROZEN order, restore or reject; the server's resulting state; and the two steps, first
 * "see the result", then the one confirm. No part takes an amount or names another customer.
 */
import type { ReviewCaseDetail, ReviewPreviewResponse } from "@cashback/contracts";
import { statusDefinition, type OrderStatus } from "@cashback/core";
import { Button, formatMoney, statusLabel } from "@cashback/ui";

import { adminText } from "../labels";

function Choice({
  name,
  options,
  value,
  onChange,
  legend,
}: {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly { value: string; label: string }[];
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 text-sm hover:bg-muted"
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="size-4 accent-primary"
          />
          <span className="min-w-0 break-words">{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

const stateName = (status: string): string => {
  try {
    return statusLabel(statusDefinition("order", status as OrderStatus).labelKey);
  } catch {
    return status;
  }
};

export function PreviewNote({ preview }: { readonly preview: ReviewPreviewResponse }) {
  return (
    <div
      data-review-preview
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-primary/30 bg-secondary p-3"
    >
      <p className="text-caption text-muted-foreground">{adminText("review_preview_title")}</p>
      <p className="text-[15px] font-semibold break-words">
        {preview.customerCode === null
          ? adminText("review_preview_state", { status: stateName(preview.to) })
          : adminText("review_preview_owner", {
              code: preview.customerCode,
              status: stateName(preview.to),
            })}
      </p>
      {preview.cashback !== null && (
        <p className="text-sm tabular-nums">
          {adminText("review_preview_cashback", { amount: formatMoney(preview.cashback) ?? "" })}
        </p>
      )}
    </div>
  );
}

interface ChoicesProps {
  readonly detail: ReviewCaseDetail;
  readonly customerId: string;
  readonly outcome: "restore" | "reject";
  readonly onCustomer: (customerId: string) => void;
  readonly onOutcome: (outcome: "restore" | "reject") => void;
}

/** Only the rule's own candidates (when there are several) and, for a FROZEN order, restore or reject. */
export function ApplyChoices({ detail, customerId, outcome, onCustomer, onOutcome }: ChoicesProps) {
  const several = detail.candidates.length > 1;
  return (
    <>
      {several && (
        <Choice
          name={`candidate-${detail.caseId}`}
          legend={adminText("review_choose_candidate")}
          value={customerId}
          onChange={onCustomer}
          options={detail.candidates.map((c) => ({
            value: c.customerId,
            label: [c.customerCode, c.customerName].filter(Boolean).join(" · ") || c.customerId,
          }))}
        />
      )}
      {detail.frozen && (
        <Choice
          name={`outcome-${detail.caseId}`}
          legend={adminText("review_outcome_label")}
          value={outcome}
          onChange={(v) => onOutcome(v === "reject" ? "reject" : "restore")}
          options={[
            { value: "restore", label: adminText("review_outcome_restore") },
            { value: "reject", label: adminText("review_outcome_reject") },
          ]}
        />
      )}
    </>
  );
}

interface StepsProps {
  readonly previewed: boolean;
  readonly reasonMissing: boolean;
  readonly previewing: boolean;
  readonly saving: boolean;
  readonly onPreview: () => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

/** First "see the result", then, once the server's answer is shown, the one confirm. */
export function ApplySteps({
  previewed,
  reasonMissing,
  previewing,
  saving,
  onPreview,
  onApply,
  onCancel,
}: StepsProps) {
  return (
    <>
      <div className="flex min-w-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" className="coarse:h-11" onClick={onCancel}>
          {adminText("review_cancel")}
        </Button>
        {previewed ? (
          <Button type="button" className="coarse:h-11" disabled={saving} onClick={onApply}>
            {adminText(saving ? "review_saving" : "review_apply_confirm")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="coarse:h-11"
            disabled={reasonMissing || previewing}
            onClick={onPreview}
          >
            {adminText(previewing ? "review_previewing" : "review_preview_button")}
          </Button>
        )}
      </div>
      {reasonMissing && (
        <p className="text-right text-caption text-muted-foreground">
          {adminText("review_reason_required")}
        </p>
      )}
    </>
  );
}
