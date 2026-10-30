/**
 * The review case panel (EXPERIENCE.md review case panel, UJ-6, Story 4.15): a right sheet on
 * tablet and desktop, a full-height drawer on phone. It reads the case from the server and shows,
 * in order, why the system did not guess, the network's report row as a read-only list of facts,
 * the order as it stands, the candidates the rules produced with their recent orders (product
 * thumbnails, code chips), and the actions. No field edits an amount or picks another customer.
 * Each case is its own query, keyed by the case id, so another case never shows this one's data.
 */
import type { ReviewCaseDetail, ReviewCaseRow, ReviewFact } from "@cashback/contracts";
import { formatVnDateOf, formatVnDateTime, parseInstant, systemClock } from "@cashback/core";
import {
  CodeChip,
  MissingValue,
  MoneyFigure,
  ProductThumb,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  StatusBadge,
  useLayout,
} from "@cashback/ui";

import { adminText } from "../labels";
import { ReviewActions } from "./review-actions";
import {
  candidateHint,
  caseTitle,
  factLabel,
  networkName,
  reasonLabel,
  reasonWhy,
} from "./review-text";
import { useReviewCase } from "./review.queries";

function FactValue({ fact }: { readonly fact: ReviewFact }) {
  const v = fact.value;
  if (v === null || v === "") return <MissingValue />;
  if (fact.kind === "money" && typeof v === "number") return <MoneyFigure amount={v} />;
  if (fact.kind === "code") return <CodeChip code={String(v)} />;
  if (fact.kind === "instant" && typeof v === "string")
    return <span className="tabular-nums">{formatVnDateTime(parseInstant(v), systemClock)}</span>;
  if (fact.kind === "flag")
    return <span>{adminText(v === true ? "review_fact_yes" : "review_fact_no")}</span>;
  if (fact.kind === "reasons")
    return <span className="break-words">{String(v).split(",").map(reasonLabel).join(", ")}</span>;
  return <span className="break-words">{String(v)}</span>;
}

/** A network status in the order words staff know, the network's own word only as a small detail. */
function StatusValue({ fact }: { readonly fact: ReviewFact }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      {typeof fact.value === "string" ? (
        <StatusBadge entity="order" value={fact.value} />
      ) : (
        <span>{adminText("review_fact_status_unknown")}</span>
      )}
      {fact.detail !== null && (
        <span className="text-caption break-words text-muted-foreground">
          {adminText("review_fact_raw", { raw: fact.detail })}
        </span>
      )}
    </span>
  );
}

function Facts({ facts }: { readonly facts: readonly ReviewFact[] }) {
  if (facts.length === 0)
    return <p className="text-sm text-muted-foreground">{adminText("review_facts_none")}</p>;
  return (
    <dl
      data-review-facts
      className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-2 rounded-lg bg-muted/60 p-3 text-sm"
    >
      {facts.map((f) => (
        <div key={f.key} className="contents">
          <dt className="min-w-0 break-words text-muted-foreground">{factLabel(f)}</dt>
          <dd className="min-w-0">
            {f.kind === "orderStatus" ? <StatusValue fact={f} /> : <FactValue fact={f} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Candidates({ detail }: { readonly detail: ReviewCaseDetail }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-semibold">{adminText("review_candidates_title")}</h3>
      {detail.candidates.length === 0 && (
        <p className="text-sm text-muted-foreground">{adminText("review_candidates_none")}</p>
      )}
      {detail.candidates.map((c) => (
        <div
          key={c.customerId}
          data-candidate={c.customerId}
          className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {c.customerCode !== null && <CodeChip code={c.customerCode} />}
            <span className="min-w-0 font-medium break-words">
              {c.customerName ?? adminText("customer_unnamed")}
            </span>
          </div>
          <p className="text-caption text-muted-foreground">{adminText("review_recent_orders")}</p>
          {c.recentOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">{adminText("review_no_orders")}</p>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y divide-border">
              {c.recentOrders.map((o) => (
                <li key={o.orderId} className="flex min-w-0 items-start gap-2.5 py-2">
                  <ProductThumb src={o.productImageUrl} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="line-clamp-2 text-sm leading-snug break-words">
                      {o.productName ?? adminText("panel_product_missing", { order: o.orderId })}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <CodeChip code={o.orderId} />
                      <StatusBadge entity="order" value={o.status} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end text-right">
                    <MoneyFigure amount={o.cashback} />
                    <span className="text-caption text-muted-foreground tabular-nums">
                      {formatVnDateOf(o.recordedAt, systemClock)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function Resolved({ detail }: { readonly detail: ReviewCaseDetail }) {
  if (detail.status !== "RESOLVED" || detail.resolvedAt === null) return null;
  const resolution = adminText(
    detail.resolution === "APPLIED" ? "resolution_applied" : "resolution_dismissed",
  );
  return (
    <p
      data-review-resolved
      className="rounded-md bg-status-done-soft p-3 text-sm break-words text-status-done"
    >
      {adminText("review_resolved_note", {
        resolution,
        time: formatVnDateTime(parseInstant(detail.resolvedAt), systemClock),
        reason: detail.resolutionReason ?? "",
      })}
    </p>
  );
}

function Body({ detail }: { readonly detail: ReviewCaseDetail }) {
  const why = [reasonWhy(detail.reason), candidateHint(detail)].filter((t) => t !== null).join(" ");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusBadge entity="reviewCase" value={detail.status} />
        <span className="text-sm font-semibold break-words">{reasonLabel(detail.reason)}</span>
      </div>
      {why !== "" && <p className="text-sm break-words">{why}</p>}
      <Resolved detail={detail} />
      <section className="flex min-w-0 flex-col gap-2">
        <h3 className="text-sm font-semibold">{adminText("review_facts_title")}</h3>
        <Facts facts={detail.facts} />
      </section>
      {detail.order !== null && (
        <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{adminText("review_order_now")}</span>
          <StatusBadge entity="order" value={detail.order.status} />
          {detail.order.customerCode !== null && (
            <span>{adminText("review_order_owner", { code: detail.order.customerCode })}</span>
          )}
        </p>
      )}
      <Candidates detail={detail} />
    </div>
  );
}

/** The case once read, its failure, or the loading skeleton. */
function PanelContent({
  data,
  failed,
}: {
  readonly data: ReviewCaseDetail | undefined;
  readonly failed: boolean;
}) {
  if (data !== undefined) return <Body detail={data} />;
  if (failed) {
    return (
      <p role="alert" className="pb-4 text-sm text-status-rejected">
        {adminText("review_failed")}
      </p>
    );
  }
  return (
    <div
      role="status"
      aria-label={adminText("review_loading")}
      className="flex flex-col gap-2 pb-4"
    >
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function ReviewPanel({
  row,
  onClose,
}: {
  readonly row: ReviewCaseRow | null;
  readonly onClose: () => void;
}) {
  const phone = useLayout() === "phone";
  const detail = useReviewCase(row?.caseId ?? null);
  const title = row === null ? "" : caseTitle(row.subject);
  const lead =
    row === null
      ? ""
      : adminText("review_panel_lead", {
          network: networkName(row.network),
          date: formatVnDateOf(row.openedAt, systemClock) ?? "",
        });
  const data =
    detail.data !== undefined && detail.data.caseId === row?.caseId ? detail.data : undefined;
  return (
    <Sheet open={row !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side={phone ? "bottom" : "right"}
        className={
          phone
            ? "flex h-dvh max-h-dvh flex-col gap-0 overflow-hidden rounded-none data-[side=bottom]:h-dvh"
            : "flex flex-col gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:max-w-[520px] data-[side=right]:sm:max-w-[520px]"
        }
      >
        <SheetHeader className="border-b border-border pr-12">
          <SheetTitle className="text-lg font-semibold break-words">{title}</SheetTitle>
          <SheetDescription>{lead}</SheetDescription>
        </SheetHeader>
        {/* The body scrolls on its own above the actions, so the actions never cover a candidate. */}
        <div
          data-panel={phone ? "drawer" : "sheet"}
          data-review-body
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4"
        >
          <PanelContent data={data} failed={detail.isError} />
        </div>
        {data !== undefined && data.status === "OPEN" && (
          <div
            data-review-footer
            className="max-h-[60dvh] shrink-0 overflow-y-auto border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <ReviewActions key={data.caseId} detail={data} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
