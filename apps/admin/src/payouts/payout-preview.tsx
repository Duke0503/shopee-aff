/**
 * The payout preview inside the panel (W4 payout panel, DESIGN.md qr-panel, EXPERIENCE.md payout
 * panel, M-7, UX-DR6): the abandoned-claim warning first, then the flags to check, the VietQR for
 * exactly the server's amount (or why there is none), the transfer facts with copy buttons, and
 * every covered order, bonus and netted clawback, then the confirm step (payout-confirm.tsx). A
 * netting-only payout (Story 4.11) has no QR and no bank facts: it shows the approved gross, what
 * this payout nets, what is still owed after it and the transfer of 0. Every figure is the
 * server's; nothing is added up here. On a phone the QR takes the full width so a second phone
 * can scan it.
 */
import type { PayoutPreview as Preview } from "@cashback/contracts";
import { formatVnDateTime, formatVnTime, parseInstant, systemClock } from "@cashback/core";
import { formatMoney, MoneyFigure, ProductThumb, TriangleAlertIcon, useLayout } from "@cashback/ui";

import type { ReactNode } from "react";

import { ApiError } from "../api/api.queries";
import { adminText } from "../labels";
import { CopyButton } from "./copy-button";
import { FlagBadge, MaskedAccount } from "./payout-badges";
import { revealAccountNumber } from "./payouts.queries";
import { VietQrCode } from "./vietqr-code";

const CHECK_FLAGS = new Set(["BANK_CHANGED", "SHARED_BANK"]);

/** The server refused the copy because the saved account is no longer the claim's. */
const isAccountChanged = (error: unknown): boolean => error instanceof ApiError && error.messageKey === "error.payout.account_changed";

function Warning({ warning }: { readonly warning: NonNullable<Preview["warning"]> }) {
  const text = adminText("panel_warning", { amount: formatMoney(warning.amount) ?? "", time: formatVnDateTime(parseInstant(warning.at), systemClock) });
  return (
    <p role="alert" className="flex min-w-0 items-start gap-2 rounded-md bg-status-attention-soft p-3 text-sm font-medium text-status-attention">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{text}</span>
    </p>
  );
}

function QrBlock({ preview, phone }: { readonly preview: Preview; readonly phone: boolean }) {
  if (preview.qrPayload === null) {
    return <p className="rounded-md bg-muted p-3 text-sm break-words text-muted-foreground">{adminText(preview.qrMissing === "netting_only" ? "panel_netting_only" : preview.qrMissing === "qr_failed" ? "panel_qr_failed" : "panel_no_qr_bank")}</p>;
  }
  const label = adminText("panel_qr_label", { amount: formatMoney(preview.amount) ?? "", bank: preview.bankName ?? "", account: adminText("payout_masked_account", { lastFour: preview.accountLastFour }) });
  return (
    <div data-qr-well="" className="mx-auto w-full rounded-xl border border-border bg-white p-4" style={phone ? undefined : { maxWidth: 220 + 34 }}>
      <VietQrCode payload={preview.qrPayload} label={label} className="block aspect-square w-full" />
    </div>
  );
}

function Fact({ label, children, copy }: { readonly label: string; readonly children: ReactNode; readonly copy?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-right">
        <span className="min-w-0 break-words">{children}</span>
        {copy}
      </dd>
    </div>
  );
}

function NettingFacts({ preview }: { readonly preview: Preview }) {
  return (
    <dl className="divide-y divide-border" data-facts="netting">
      <Fact label={adminText("panel_gross")}>
        <MoneyFigure amount={preview.gross} />
      </Fact>
      <Fact label={adminText("panel_netted")}>
        <span className="text-sm font-semibold text-status-rejected tabular-nums">{formatMoney(preview.netted)}</span>
      </Fact>
      <Fact label={adminText("panel_carried")}>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(preview.carriedForward)}</span>
      </Fact>
      <Fact label={adminText("panel_transfer")}>
        <MoneyFigure amount={preview.amount} size="md" />
      </Fact>
    </dl>
  );
}

function TransferFacts({ preview, onStale }: { readonly preview: Preview; readonly onStale: () => void }) {
  if (preview.amount === 0) return <NettingFacts preview={preview} />;
  return (
    <dl className="divide-y divide-border">
      <Fact label={adminText("panel_amount")} copy={<CopyButton label={adminText("panel_copy_amount")} value={() => String(preview.amount)} />}>
        <MoneyFigure amount={preview.amount} size="md" />
      </Fact>
      <Fact label={adminText("panel_bank")}>{preview.bankName ?? "–"}</Fact>
      <Fact label={adminText("panel_holder")}>{preview.holderName ?? "–"}</Fact>
      <Fact label={adminText("panel_account")} copy={<CopyButton label={adminText("panel_copy_account")} value={() => revealAccountNumber(preview.claimId)} onError={(error) => isAccountChanged(error) && onStale()} />}>
        <MaskedAccount lastFour={preview.accountLastFour} />
      </Fact>
      <Fact label={adminText("panel_reference")} copy={<CopyButton label={adminText("panel_copy_reference")} value={() => preview.transferReference} />}>
        <span className="font-mono text-sm font-medium">{preview.transferReference}</span>
      </Fact>
    </dl>
  );
}

function Line({ title, amount, image, note }: { readonly title: string; readonly amount: ReactNode; readonly image?: string | null; readonly note?: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 py-2">
      {image !== undefined && <ProductThumb src={image} />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-2 text-sm leading-snug break-words">{title}</span>
        {note !== undefined && <span className="text-caption text-muted-foreground">{note}</span>}
      </span>
      <span className="shrink-0 text-right">{amount}</span>
    </li>
  );
}

function CoveredLines({ preview }: { readonly preview: Preview }) {
  const count = preview.orders.length + preview.bonuses.length;
  return (
    <section className="min-w-0">
      <h3 className="text-sm font-semibold">{adminText("panel_covered", { count })}</h3>
      <ul className="divide-y divide-border">
        {preview.orders.map((o) => (
          <Line key={o.orderId} title={o.productName ?? adminText("panel_product_missing", { order: o.orderId })} image={o.productImageUrl} note={o.settled ? adminText("panel_settled") : undefined} amount={<MoneyFigure amount={o.cashback} />} />
        ))}
        {preview.bonuses.map((b) => (
          <Line key={`award-${b.awardId}`} title={adminText("panel_bonus", { campaign: b.campaignName })} amount={<MoneyFigure amount={b.amount} />} />
        ))}
        {preview.clawbacks.map((c) => (
          <Line key={`claw-${c.clawbackId}`} title={adminText("panel_deducted", { order: c.orderId ?? c.clawbackId })} amount={<span className="text-sm font-semibold text-status-rejected tabular-nums">{formatMoney(c.open)}</span>} />
        ))}
      </ul>
    </section>
  );
}

export interface PayoutPreviewProps {
  readonly preview: Preview;
  readonly onStale: () => void;
  /** Shown first: the "amount changed" notice after a refused confirm. */
  readonly notice?: ReactNode;
  /** Shown last: the confirm step. */
  readonly footer?: ReactNode;
}

export function PayoutPreview({ preview, onStale, notice, footer }: PayoutPreviewProps) {
  const phone = useLayout() === "phone";
  const checks = preview.flags.filter((flag) => CHECK_FLAGS.has(flag));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {notice}
      {preview.warning !== null && <Warning warning={preview.warning} />}
      {checks.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-meta text-muted-foreground">{adminText("panel_flags")}</span>
          {checks.map((flag) => (
            <FlagBadge key={flag} flag={flag} />
          ))}
        </div>
      )}
      <QrBlock preview={preview} phone={phone} />
      <TransferFacts preview={preview} onStale={onStale} />
      <CoveredLines preview={preview} />
      <p className="text-caption text-muted-foreground">{adminText("panel_snapshot", { time: formatVnTime(parseInstant(preview.openedAt)) })}</p>
      {footer}
    </div>
  );
}
