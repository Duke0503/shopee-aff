/**
 * W7 Zalo-down banner (FR-36, UX-DR13): a full-width amber strip under the top bar on every page
 * while the server reports the assistant down. It cannot be closed; it goes on the first page
 * load after the server says the assistant is back. It names the fallback contact path, when the
 * owner has set one, as a link inside the strip (not a second big button beside the page's own
 * action), and says the website keeps working either way.
 */
import { ChevronRightIcon, cn, TriangleAlertIcon } from "@cashback/ui";

import { webText } from "../labels";
import { useSiteStatus } from "../site/site-status.queries";
import { FOCUS_RING } from "./nav-items";

export function ZaloDownBanner() {
  const status = useSiteStatus().data;
  if (status?.assistant !== "down") return null;
  const contact = status.fallbackContactUrl;
  return (
    <section aria-labelledby="zalo-down-title" data-zalo-down className="border-b border-warning/25 bg-warning-soft text-warning">
      <div className="mx-auto flex max-w-5xl gap-2.5 px-4 pt-3 pb-1.5 md:items-center md:px-6 md:py-1.5">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 md:mt-0" />
        <div className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-x-3">
          <div className="min-w-0 md:flex-1">
            <h2 id="zalo-down-title" className="text-[15px] leading-snug font-semibold">
              {webText("zalo_down_title")}
            </h2>
            <p className="text-meta">{webText("zalo_down_body")}</p>
          </div>
          {contact !== null ? (
            <a href={contact} rel="noopener" className={cn("inline-flex min-h-11 w-fit shrink-0 items-center gap-0.5 rounded-md text-[15px] font-semibold underline underline-offset-4", FOCUS_RING)}>
              {webText("zalo_down_contact")}
              <ChevronRightIcon aria-hidden className="size-4" />
            </a>
          ) : (
            <span className="h-1.5 md:hidden" aria-hidden />
          )}
        </div>
      </div>
    </section>
  );
}
