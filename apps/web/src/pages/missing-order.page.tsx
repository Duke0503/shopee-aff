/**
 * The missing-order page (W2, Story 7.4, pen.dev Gc1Zb): signed in only, opened from the line
 * under My money's orders. The way back on top, the question as the title, the sentence on how
 * long the network takes, then the self-checks and the report form; under it how the answer comes
 * (in Zalo). One 640 px column at every width.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { MissingOrderForm } from "../money/missing-order-form";
import { FOCUS_RING } from "../shell/nav-items";
import { ArrowLeftIcon } from "../shell/page-icons";
import { PageTitle } from "../shell/page-title";
import { SignedIn } from "./signed-in";

const BACK = cn("-ml-1 inline-flex h-11 items-center gap-2 self-start rounded-md px-1 text-[15px] font-medium hover:bg-muted", FOCUS_RING);

export function MissingOrderPage() {
  return (
    <SignedIn>
      {() => (
        <div className="mx-auto flex max-w-[640px] flex-col gap-4 px-4 pt-4 md:px-6 md:pt-8">
          <Link to={CUSTOMER_PATHS.myMoney} className={BACK}>
            <ArrowLeftIcon aria-hidden className="size-5" />
            {webText("missing_back")}
          </Link>
          <PageTitle lead={webText("missing_lead")}>{webText("missing_title")}</PageTitle>
          <MissingOrderForm />
          <p className="text-meta text-muted-foreground md:text-sm">{webText("missing_footer")}</p>
        </div>
      )}
    </SignedIn>
  );
}
