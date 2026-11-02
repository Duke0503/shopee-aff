/**
 * What the converter shows once a link is sent (pen.dev KF7d9, R0mtJ, OXofj, xoMhh, x5bRPY,
 * E99T1N; EXPERIENCE.md link result card, guest warning, Zalo hand-off;
 * Story 7.6): the creating state (the button turned into a spinner, a skeleton card and how long
 * it takes, then a sentence when it takes long), the result card (product and price, the soft
 * green "you get back about <amount>" box with the estimate tag, "open" and "copy" and the share
 * link), the guest warning with the mascot and the Zalo button above a guest link, and the
 * hand-off card (website busy, link failed) with the mascot and no retry. Every link is the share
 * page `/s/<code>` opened in the same window, so the in-app browser hand-off runs there and
 * nothing needs a pop-up (AC6).
 */
import type { WebLinkResult } from "@cashback/contracts";
import { buttonVariants, CheckIcon, cn, ExternalLinkIcon, formatMoney, LinkIcon, ProductThumb, Skeleton, uiText } from "@cashback/ui";

import { webText, type WebKey } from "../labels";
import { LoaderIcon } from "../shell/page-icons";
import { ZaloButton } from "../shell/zalo-button";
import { CopyLink } from "./copy-link";

const CARD = "flex flex-col gap-4 rounded-xl border border-border bg-card p-4 md:p-5";
const BIG_BUTTON = "h-12 w-full rounded-xl px-4 text-base font-semibold";
const MASCOT_WAITING = "/mascot-waiting-360.webp";

export function HandOff({ titleKey, textKey }: { readonly titleKey: WebKey; readonly textKey: WebKey }) {
  return (
    <section data-link-handoff={textKey} role="status" className={cn(CARD, "flex-row items-start gap-4")}>
      <img src={MASCOT_WAITING} alt="" width={265} height={360} className="h-20 w-auto shrink-0 object-contain" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="text-[17px] leading-snug font-semibold">{webText(titleKey)}</h2>
        <p className="text-[15px] text-muted-foreground">{webText(textKey)}</p>
        <ZaloButton labelKey="link_handoff_zalo" className="mt-1 h-11 rounded-lg px-4 font-semibold" />
      </div>
    </section>
  );
}

export function Creating({ slow, guest }: { readonly slow: boolean; readonly guest: boolean }) {
  return (
    <div data-link-creating aria-busy="true" className="flex flex-col gap-5">
      <p role="status" className={cn(buttonVariants(), BIG_BUTTON, "pointer-events-none opacity-75")}>
        <LoaderIcon aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        {webText("link_creating")}
      </p>
      <div className={CARD}>
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
      </div>
      <p className="text-[15px] text-muted-foreground">{webText(guest ? "link_creating_note_guest" : "link_creating_note")}</p>
      {slow && <p className="text-[15px]">{webText(guest ? "link_slow_guest" : "link_slow_customer")}</p>}
    </div>
  );
}

const NETWORK: Readonly<Record<WebLinkResult["network"], WebKey>> = { shopee: "platform_shopee", accesstrade: "platform_tiktok" };

function Product({ result }: { readonly result: WebLinkResult }) {
  const price = result.product.price === null ? null : formatMoney(result.product.price);
  const meta = [webText(NETWORK[result.network]), price].filter((part) => part !== null).join(" · ");
  return (
    <div className="flex min-w-0 items-start gap-4">
      <ProductThumb src={result.product.imageUrl} size={40} className="size-16 rounded-lg" />
      <div className="flex min-w-0 flex-col gap-1 pt-0.5">
        <p className="line-clamp-2 text-base leading-snug font-semibold break-words md:text-[17px]">{result.product.name ?? webText("link_product_missing")}</p>
        <p data-product-meta className="text-meta text-muted-foreground tabular-nums md:text-sm">
          {meta}
        </p>
      </div>
    </div>
  );
}

function Cashback({ result }: { readonly result: WebLinkResult }) {
  if (result.perShop) return <p className="rounded-xl bg-money-soft p-4 text-[15px] text-secondary-foreground">{webText("link_per_shop")}</p>;
  if (result.estimate === null) return <p data-no-estimate className="rounded-xl bg-muted p-4 text-[15px] text-muted-foreground">{webText("link_no_estimate")}</p>;
  return (
    <div data-estimate className="flex flex-col gap-1 rounded-xl bg-money-soft p-4 text-secondary-foreground">
      <p className="flex items-center gap-2 text-[15px]">
        {webText("link_cashback_label")}
        <span className="rounded-md bg-card px-1.5 text-caption">{uiText("money_estimate_tag")}</span>
      </p>
      <p className="flex items-baseline gap-2 text-money tabular-nums">
        <span className="text-[15px] text-secondary-foreground">{uiText("money_about")}</span>
        <span className="text-[26px] leading-tight font-bold tracking-tight">{formatMoney(result.estimate.cashback)}</span>
      </p>
    </div>
  );
}

const shareUrlOf = (path: string): string => `${window.location.origin}${path}`;

function ShareUrl({ url }: { readonly url: string }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground md:text-sm">
      <LinkIcon aria-hidden className="size-3.5 shrink-0" />
      <span data-share-url className="min-w-0 truncate">
        {url.replace(/^https?:\/\//, "")}
      </span>
    </p>
  );
}

function GuestWarning() {
  return (
    <section data-guest-warning className="flex items-start gap-3 rounded-xl bg-warning-soft p-4 text-warning md:gap-4">
      <img src={MASCOT_WAITING} alt="" width={265} height={360} className="h-20 w-auto shrink-0 object-contain" />
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 className="text-[17px] leading-snug font-bold">{webText("link_guest_title")}</h2>
        <p className="text-[15px]">{webText("link_guest_body")}</p>
        <ZaloButton labelKey="link_guest_zalo" className="mt-1 h-11 rounded-lg px-4 font-semibold" />
      </div>
    </section>
  );
}

function GuestResult({ result, url }: { readonly result: WebLinkResult; readonly url: string }) {
  return (
    <div data-link-result="guest" aria-label={webText("link_result_label")} role="group" className="flex flex-col gap-5">
      <GuestWarning />
      <section className={CARD}>
        <Product result={result} />
        <div className="flex flex-col gap-0.5 rounded-xl bg-muted p-4 text-muted-foreground">
          <span className="text-[15px]">{webText("link_guest_cashback")}</span>
          <span className="text-base font-semibold">{webText("link_guest_cashback_none")}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <a href={result.sharePath ?? url} data-share-link className={cn(buttonVariants({ variant: "outline" }), BIG_BUTTON)}>
            <ExternalLinkIcon aria-hidden />
            {webText("link_guest_open")}
          </a>
          <CopyLink url={url} className={BIG_BUTTON} />
        </div>
        <ShareUrl url={url} />
      </section>
    </div>
  );
}

const CHECKS: readonly WebKey[] = ["link_check_browser", "link_check_soon", "link_check_cancel"];

function Checklist() {
  return (
    <section aria-labelledby="link-checklist-title" className="flex flex-col gap-2 px-1">
      <h2 id="link-checklist-title" className="text-[15px] font-semibold">
        {webText("link_checklist_title")}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {CHECKS.map((key) => (
          <li key={key} className="flex items-start gap-2.5 text-meta text-muted-foreground md:text-sm">
            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {webText(key)}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LinkResult({ result }: { readonly result: WebLinkResult }) {
  if (result.sharePath === null) return null;
  const url = shareUrlOf(result.sharePath);
  if (result.guest) return <GuestResult result={result} url={url} />;
  return (
    <div className="flex flex-col gap-6">
      <section data-link-result="customer" aria-label={webText("link_result_label")} className={CARD}>
        <Product result={result} />
        <Cashback result={result} />
        <div className="grid gap-2 md:grid-cols-2">
          <a href={result.sharePath} data-share-link className={cn(buttonVariants(), BIG_BUTTON)}>
            <ExternalLinkIcon aria-hidden />
            {webText("link_open")}
          </a>
          <CopyLink url={url} className={BIG_BUTTON} />
        </div>
        <ShareUrl url={url} />
      </section>
      <Checklist />
    </div>
  );
}
