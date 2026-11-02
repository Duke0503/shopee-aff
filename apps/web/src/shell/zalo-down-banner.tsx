/**
 * W7 Zalo-down banner (FR-36, UX-DR13, pen.dev vkDpy): one quiet amber line with the
 * no-signal icon under the top bar on every page
 * while the server reports the assistant down. It cannot be closed; it goes on the first page
 * load after the server says the assistant is back. It names the fallback contact path, when the
 * owner has set one, as a link inside the strip (not a second big button beside the page's own
 * action), and says the website keeps working either way.
 */
import { cn, WifiOffIcon } from "@cashback/ui";

import { webText } from "../labels";
import { useSiteStatus } from "../site/site-status.queries";
import { FOCUS_RING } from "./nav-items";

export function ZaloDownBanner() {
  const status = useSiteStatus().data;
  if (status?.assistant !== "down") return null;
  const contact = status.fallbackContactUrl;
  return (
    <section aria-labelledby="zalo-down-title" data-zalo-down className="bg-warning-soft text-warning">
      <div className="mx-auto flex max-w-5xl items-start gap-2.5 px-4 py-2.5 md:items-center md:px-8">
        <WifiOffIcon aria-hidden className="mt-0.5 size-[18px] shrink-0 md:mt-0" />
        <p className="min-w-0 flex-1 text-[14px] leading-normal md:text-[15px]">
          <span id="zalo-down-title">{webText("zalo_down_title")}</span> {webText("zalo_down_body")}
          {contact !== null && (
            <>
              {" "}
              <a href={contact} rel="noopener" className={cn("font-semibold underline underline-offset-4 coarse:inline-block coarse:py-3 coarse:-my-3", FOCUS_RING)}>
                {webText("zalo_down_contact")}
              </a>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
