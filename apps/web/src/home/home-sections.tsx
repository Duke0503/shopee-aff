/**
 * The parts of Home under the converter (pen.dev DPZAp, BEOJK): a real example with the mascot
 * sitting on it, the three steps on hairlines, the facts a customer can check, the anti-scam note
 * and the dark Zalo panel. Every amount is the server's guide example (GET /api/guide, the
 * figures packages/money gives): the page types no amount and computes none.
 */
import type { GuideFigures } from "@cashback/contracts";
import { formatBps, formatMoney, ReceiptIcon, Skeleton, uiText } from "@cashback/ui";
import type { ReactNode } from "react";

import { useGuideFigures } from "../guide/guide.queries";
import { webText, type WebKey } from "../labels";
import { ScaleIcon, ShieldCheckIcon } from "../shell/page-icons";
import { ScamNote, ZaloPanel } from "../shell/trust-notes";

const money = (amount: number): string => formatMoney(amount) ?? "";

export function ExampleCard() {
  const figures = useGuideFigures().data;
  return (
    <div className="relative pt-[100px] md:pt-[116px] xl:pt-[150px]" data-home-example>
      <img src="/mascot-happy-360.webp" alt="" width={263} height={360} decoding="async" fetchPriority="low" className="absolute top-0 right-4 z-10 h-28 w-auto object-contain md:right-6 md:h-32 xl:right-8 xl:h-[164px]" />
      <section aria-labelledby="home-example-title" className="relative overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center gap-4 p-4">
          <img src="/example-product-128.webp" alt="" width={64} height={64} loading="lazy" className="size-16 shrink-0 rounded-lg object-cover xl:size-[72px]" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-caption font-semibold tracking-wider text-muted-foreground uppercase">{webText("home_example_label")}</p>
            <h2 id="home-example-title" className="text-base leading-snug font-semibold">
              {webText("home_example_product")}
            </h2>
            <p className="text-meta text-muted-foreground tabular-nums">{figures === undefined ? " " : webText("home_example_meta", { price: money(figures.example.price) })}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 bg-money-soft px-4 py-4 text-secondary-foreground">
          <span className="text-[15px]">{webText("home_example_receive")}</span>
          {figures === undefined ? (
            <Skeleton className="h-7 w-28" />
          ) : (
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="text-[15px]">{uiText("money_about")}</span>
              <span className="text-[26px] leading-none font-bold text-money">{money(figures.example.notWithheld.cashback)}</span>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

const STEPS: readonly (readonly [WebKey, WebKey])[] = [
  ["home_step_1_title", "home_step_1_body"],
  ["home_step_2_title", "home_step_2_body"],
  ["home_step_3_title", "home_step_3_body"],
];

export function HowItWorks({ id = "home-steps", titleKey = "home_steps_title" }: { readonly id?: string; readonly titleKey?: WebKey }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="text-meta font-semibold tracking-wider text-muted-foreground uppercase md:normal-case">
        {webText(titleKey)}
      </h2>
      <ol className="flex flex-col md:grid md:grid-cols-3 md:gap-8">
        {STEPS.map(([title, body], i) => (
          <li key={title} className="flex gap-4 border-border py-4 not-last:border-b md:flex-col md:gap-3 md:border-t md:py-0 md:pt-5 md:not-last:border-b-0">
            <span aria-hidden className="w-9 shrink-0 text-xl leading-tight font-bold text-primary tabular-nums md:text-[28px]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-base font-semibold md:text-[17px]">{webText(title)}</h3>
              <p className="text-[15px] text-muted-foreground">{webText(body)}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Fact({ icon, title, children }: { readonly icon: ReactNode; readonly title: string; readonly children: ReactNode }) {
  return (
    <li className="flex gap-3 border-t border-border py-4">
      <span aria-hidden className="mt-0.5 shrink-0 text-primary">
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-[15px] text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}

function shareFacts(figures: GuideFigures | undefined) {
  const share = figures === undefined ? "" : (formatBps(figures.shareBps) ?? "");
  const body = figures === undefined ? " " : webText("home_trust_share_body", { commission: money(figures.example.commission), cashback: money(figures.example.notWithheld.cashback) });
  return { share, body };
}

export function TrustFacts() {
  const { share, body } = shareFacts(useGuideFigures().data);
  return (
    <section aria-labelledby="home-trust" className="flex flex-col gap-3">
      <h2 id="home-trust" className="text-[22px] leading-tight font-bold tracking-tight md:text-2xl">
        {webText("home_trust_title")}
      </h2>
      <ul className="flex flex-col">
        <Fact icon={<ScaleIcon className="size-5" />} title={webText("home_trust_share_title", { share })}>
          {body}
        </Fact>
        <Fact icon={<ReceiptIcon className="size-5" />} title={webText("home_trust_receipt_title")}>
          {webText("home_trust_receipt_body")}
        </Fact>
        <Fact icon={<ShieldCheckIcon className="size-5" />} title={webText("home_trust_model_title", { share })}>
          {webText("home_trust_model_body")}
        </Fact>
      </ul>
    </section>
  );
}

/** The right-hand column under the hero on desktop: the facts, the anti-scam note and the Zalo panel. */
export function TrustBlock() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TrustFacts />
      <ScamNote />
      <ZaloPanel />
    </div>
  );
}
