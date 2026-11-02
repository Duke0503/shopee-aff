/** W7 not found (pen.dev m6jBIQ): the smiling mascot, one plain sentence and one way back to Home, centred. The server answers such a path with 404. */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { buttonVariants, cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { PageTitle } from "../shell/page-title";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-center gap-5 px-4 pt-12 text-center md:pt-20">
      <img src="/mascot-waiting-360.webp" alt="" width={265} height={360} className="h-[150px] w-auto object-contain" />
      <PageTitle lead={webText("not_found_body")} className="items-center [&_h1]:text-2xl [&_p]:text-[15px]">
        {webText("not_found_title")}
      </PageTitle>
      <Link to={CUSTOMER_PATHS.home} className={cn(buttonVariants({ variant: "outline" }), "h-11 rounded-lg bg-card px-5 text-[15px] font-semibold")}>
        {webText("not_found_action")}
      </Link>
    </div>
  );
}
