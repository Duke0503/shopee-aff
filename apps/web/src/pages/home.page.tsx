/**
 * Home (W1, pen.dev DPZAp phone 390, B2nRu tablet 820, BEOJK desktop 1440; Stories 7.1 and 7.6, UJ-4):
 * one task, get a cashback link. Phone and tablet: one 640 px column, the headline, the lead and
 * the converter right under it, then the real example with the mascot, the steps on hairlines,
 * the facts the customer can check, the anti-scam note and the Zalo panel. Desktop: the promise
 * and the converter on the left, the mascot and the example on the right; below, the steps on the
 * left and the facts with the Zalo panel on the right. Once a link is sent the page keeps only the
 * converter's answer in the 640 px column (pen.dev KF7d9, R0mtJ).
 */
import { lazy, Suspense, useState } from "react";

import { webText } from "../labels";
import { LinkConverter } from "../link/link-converter";
import { useCustomerSession } from "../session/session.queries";
import { useDocumentTitle } from "../shell/use-document-title";

// The parts under the converter load right after it, outside Home's first-load budget (Story 7.1 AC3).
const ExampleCard = lazy(() => import("../home/home-sections").then((m) => ({ default: m.ExampleCard })));
const HowItWorks = lazy(() => import("../home/home-sections").then((m) => ({ default: m.HowItWorks })));
const TrustBlock = lazy(() => import("../home/home-sections").then((m) => ({ default: m.TrustBlock })));

const FOCUSED = "mx-auto max-w-[640px] px-4 pt-6 md:px-6 md:pt-14";
const GRID = "mx-auto grid max-w-[640px] gap-8 px-4 pt-7 md:gap-12 md:px-0 md:pt-12 xl:max-w-[1264px] xl:grid-cols-[640px_minmax(0,1fr)] xl:gap-x-[72px] xl:gap-y-16 xl:px-8 xl:pt-[72px]";

export function HomePage() {
  useDocumentTitle(null);
  const session = useCustomerSession();
  const [focused, setFocused] = useState(false);
  // While the session is checked the converter waits, so a signed-in customer never sees the code field flash.
  const converter = session.isPending ? null : <LinkConverter customerCode={session.data?.customerCode ?? null} onFocusChange={setFocused} />;
  // The converter keeps its place in the tree in both forms, so sending a link never resets it.
  return (
    <div className={focused ? FOCUSED : GRID}>
      <div className="flex min-w-0 flex-col gap-5 md:gap-6 xl:max-w-[600px]">
        <h1 className={focused ? "sr-only" : "text-[30px] leading-[1.15] font-bold tracking-[-0.02em] md:text-[40px] xl:text-[48px] xl:leading-[1.1]"}>{webText("home_title")}</h1>
        {!focused && <p className="text-[17px] leading-relaxed text-muted-foreground md:text-lg">{webText("home_lead")}</p>}
        <div className={focused ? undefined : "pt-1"}>{converter}</div>
      </div>
      {!focused && (
        <div className="min-w-0 xl:ml-auto xl:w-[420px]">
          <Suspense fallback={<div className="h-[260px]" />}>
            <ExampleCard />
          </Suspense>
        </div>
      )}
      {!focused && (
        <div className="min-w-0 xl:pt-2">
          <Suspense fallback={null}>
            <HowItWorks />
          </Suspense>
        </div>
      )}
      {!focused && (
        <Suspense fallback={null}>
          <TrustBlock />
        </Suspense>
      )}
    </div>
  );
}
