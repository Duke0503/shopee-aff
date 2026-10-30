/**
 * Status badge (LC-13, DESIGN.md): label and tone from the status registry only; text always
 * present, so colour is never the only signal. Paid-like done states carry a check, rejected a
 * cross. An unknown stored value shows the value itself in the neutral tone rather than nothing.
 */
import { statusesOf, type EntityName, type Tone } from "@cashback/core";

import { CheckIcon, XIcon } from "../icons";
import { statusLabel } from "../labels";
import { cn } from "../lib/utils";

const TONE_CLASSES: Readonly<Record<Tone, string>> = {
  waiting: "bg-status-waiting-soft text-status-waiting",
  approved: "bg-status-approved-soft text-status-approved",
  done: "bg-status-done-soft text-status-done",
  attention: "bg-status-attention-soft text-status-attention",
  rejected: "bg-status-rejected-soft text-status-rejected",
  neutral: "bg-status-neutral-soft text-status-neutral",
};

export interface StatusBadgeProps {
  readonly entity: EntityName;
  readonly value: string;
  readonly className?: string;
}

export function StatusBadge({ entity, value, className }: StatusBadgeProps) {
  const definition = statusesOf(entity).find((s) => s.value === value);
  const tone: Tone = definition?.tone ?? "neutral";
  const label = definition === undefined ? value : statusLabel(definition.labelKey);
  return (
    <span
      data-tone={tone}
      className={cn("inline-flex min-h-[22px] max-w-full items-center gap-1 rounded-[11px] px-2 py-0.5 text-caption leading-tight font-medium whitespace-normal", TONE_CLASSES[tone], className)}
    >
      {tone === "done" && <CheckIcon aria-hidden className="size-3 shrink-0" />}
      {tone === "rejected" && <XIcon aria-hidden className="size-3 shrink-0" />}
      {/* Never cut off: a label wider than its column wraps to a second line (owner request, Sprint 18). */}
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}
