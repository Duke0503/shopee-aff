/** W7 not found: the waiting mascot, one plain sentence and the way back to Home. The server answers such a path with 404. */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { buttonVariants, cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { PageTitle } from "../shell/page-title";

export function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-[440px] flex-col items-start gap-4 px-4 pt-10 md:pt-16">
      <img src="/mascot-waiting-360.webp" alt="" width={265} height={360} className="h-24 w-auto object-contain" />
      <PageTitle lead={webText("not_found_body")}>{webText("not_found_title")}</PageTitle>
      <Link to={CUSTOMER_PATHS.home} className={cn(buttonVariants(), "h-11 px-5 text-[15px]")}>
        {webText("not_found_action")}
      </Link>
    </div>
  );
}
