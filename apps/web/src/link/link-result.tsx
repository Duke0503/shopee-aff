/**
 * What the converter shows below the form (EXPERIENCE.md link result card, guest warning, Zalo
 * hand-off panel; Story 7.6): the creating state (a skeleton and link_creating, then a sentence
 * when it takes long), the result card (product, price, "about <amount>" with the estimate tag,
 * the share link with the open and copy buttons), the guest warning above a guest link
 * with the Zalo button first, and the hand-off panel (website busy, link failed) with no retry.
 * Every link is the share page `/s/<code>` opened in the same window, so the in-app browser
 * hand-off runs there and nothing needs a pop-up (AC6).
 */
import type { WebLinkResult } from "@cashback/contracts";
import { Button, buttonVariants, CheckIcon, cn, CopyIcon, ExternalLinkIcon, formatMoney, MoneyFigure, ProductThumb, Skeleton, TriangleAlertIcon } from "@cashback/ui";
import { useEffect, useRef, useState } from "react";

import { webText, type WebKey } from "../labels";
import { ZaloButton } from "../shell/zalo-button";

export function HandOff({ textKey }: { readonly textKey: WebKey }) {
  return (
    <section data-link-handoff={textKey} role="status" className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <p className="text-[15px] font-medium">{webText(textKey)}</p>
      <ZaloButton labelKey="zalo_button" className="w-full md:w-fit" />
    </section>
  );
}

export function Creating({ slow, guest }: { readonly slow: boolean; readonly guest: boolean }) {
  return (
    <section data-link-creating aria-busy="true" className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-md" />
        <Skeleton className="h-4 flex-1" />
      </div>
      <p role="status" className="text-[15px] text-muted-foreground">
        {webText("link_creating")}
      </p>
      {slow && <p className="text-[15px]">{webText(guest ? "link_slow_guest" : "link_slow_customer")}</p>}
    </section>
  );
}

function CopyLink({ url }: { readonly url: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="outline" className="h-11 flex-1 text-[15px] md:flex-none md:px-5" onClick={() => void copy()}>
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {webText(copied ? "link_copied" : "link_copy")}
    </Button>
  );
}

function Product({ result }: { readonly result: WebLinkResult }) {
  const price = result.product.price === null ? null : formatMoney(result.product.price);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <ProductThumb src={result.product.imageUrl} size={40} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="line-clamp-2 text-[15px] font-semibold break-words">{result.product.name ?? webText("link_product_missing")}</p>
        {price !== null && <p className="text-meta text-muted-foreground tabular-nums">{webText("link_price", { price })}</p>}
      </div>
    </div>
  );
}

function Cashback({ result }: { readonly result: WebLinkResult }) {
  if (result.perShop) return <p className="text-[15px]">{webText("link_per_shop")}</p>;
  if (result.estimate === null) return <p data-no-estimate className="text-[15px] text-muted-foreground">{webText("link_no_estimate")}</p>;
  return (
    <div data-estimate className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[15px] text-muted-foreground">{webText("link_cashback_label")}</span>
        <MoneyFigure amount={result.estimate.cashback} estimate size="md" />
      </p>
      <p className="text-meta text-muted-foreground">{webText("link_cashback_note")}</p>
    </div>
  );
}

const shareUrlOf = (path: string): string => `${window.location.origin}${path}`;

function GuestResult({ result, url }: { readonly result: WebLinkResult; readonly url: string }) {
  return (
    <section data-link-result="guest" aria-label={webText("link_result_label")} className="flex flex-col gap-4 rounded-xl border border-warning/40 bg-warning-soft p-4 md:p-5">
      <div data-guest-warning className="flex items-start gap-2.5">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <h2 className="text-[17px] leading-snug font-semibold">{webText("link_guest_title")}</h2>
          <p className="text-[15px]">{webText("link_guest_body")}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 md:flex-row">
        <ZaloButton labelKey="zalo_button" className="w-full md:w-fit" />
        <a href={result.sharePath ?? url} data-share-link className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full bg-card px-4 text-[15px] md:w-fit")}>
          {webText("link_guest_open")}
        </a>
      </div>
    </section>
  );
}

export function LinkResult({ result }: { readonly result: WebLinkResult }) {
  if (result.sharePath === null) return null;
  const url = shareUrlOf(result.sharePath);
  if (result.guest) return <GuestResult result={result} url={url} />;
  return (
    <section data-link-result="customer" aria-label={webText("link_result_label")} className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-5">
      <Product result={result} />
      <Cashback result={result} />
      <p className="rounded-md bg-muted px-3 py-2 font-mono text-meta break-all" data-share-url>
        {url}
      </p>
      <div className="flex gap-2">
        <a href={result.sharePath} data-share-link className={cn(buttonVariants(), "h-11 flex-1 px-4 text-[15px] md:flex-none")}>
          <ExternalLinkIcon aria-hidden />
          {webText("link_open")}
        </a>
        <CopyLink url={url} />
      </div>
      <p className="text-meta text-muted-foreground">{webText("link_open_hint")}</p>
    </section>
  );
}
