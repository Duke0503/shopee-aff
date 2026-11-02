/**
 * Status badge (LC-13, DESIGN.md): label and tone from the status registry only; text always
 * present, so colour is never the only signal; a pill with no icon, as the wireframe draws it (the
 * DESIGN.md icon is optional). An unknown stored value shows the value itself in the neutral tone
 * rather than nothing.
 */
import { statusesOf, type EntityName, type Tone } from "@cashback/core";

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
      className={cn("inline-flex min-h-6 max-w-full items-center rounded-xl px-2.5 py-0.5 text-meta leading-tight font-medium whitespace-normal", TONE_CLASSES[tone], className)}
    >
      {/* Never cut off: a label wider than its column wraps to a second line (owner request, Sprint 18). */}
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}
