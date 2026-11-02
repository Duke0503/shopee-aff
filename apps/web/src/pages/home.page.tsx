/**
 * Home (W1, Stories 7.1 and 7.6, UJ-4): one task, get a cashback link. The converter is the main
 * action; the Zalo button stays as the quiet second way (it points to the fallback contact while
 * chat is down). Signed out, a quiet line offers sign-in. Phone: a small mascot above the
 * headline; desktop: the converter left, the mascot right.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { LinkConverter } from "../link/link-converter";
import { useCustomerSession } from "../session/session.queries";
import { FOCUS_RING } from "../shell/nav-items";
import { useDocumentTitle } from "../shell/use-document-title";
import { ZaloButton } from "../shell/zalo-button";

export function HomePage() {
  useDocumentTitle(null);
  const session = useCustomerSession();
  return (
    <div className="mx-auto grid max-w-[640px] gap-6 px-4 pt-6 md:px-6 md:pt-12 xl:max-w-5xl xl:grid-cols-[1fr_300px] xl:items-start xl:gap-16 xl:pt-20">
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-end gap-3">
          {/* Two lines on purpose: the headline breaks after the comma at every width. */}
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-[-0.02em] md:text-[38px] xl:text-[44px] xl:leading-[1.12]">
            <span className="block">{webText("home_title")}</span> <span className="block">{webText("home_title_rest")}</span>
          </h1>
          <img src="/mascot-happy-360.webp" alt="" width={263} height={360} decoding="async" fetchPriority="low" className="ml-auto h-20 w-auto shrink-0 object-contain md:h-28 xl:hidden" />
        </div>
        <p className="max-w-[52ch] text-[15px] text-muted-foreground md:text-[17px]">{webText("home_lead")}</p>
        {/* While the session is checked the converter waits, so a signed-in customer never sees the code field flash. */}
        {session.isPending ? null : <LinkConverter customerCode={session.data?.customerCode ?? null} />}
        <div className="flex flex-col gap-3 border-t border-border pt-5 md:flex-row md:items-center md:justify-between">
          <p className="text-[15px] text-muted-foreground">{webText("home_or_zalo")}</p>
          <ZaloButton labelKey="zalo_button" variant="outline" className="w-full md:w-fit" />
        </div>
        {session.isError && (
          <p className="text-[15px] text-muted-foreground">
            {webText("home_sign_in_hint")}{" "}
            <Link to={CUSTOMER_PATHS.signIn} className={cn("inline-flex min-h-11 items-center font-semibold text-primary underline-offset-4 hover:underline", FOCUS_RING)}>
              {webText("home_sign_in")}
            </Link>
          </p>
        )}
      </div>
      <img
        src="/mascot-happy-360.webp"
        srcSet="/mascot-happy-360.webp 263w, /mascot-happy.webp 610w"
        sizes="234px"
        alt=""
        loading="lazy"
        width={263}
        height={360}
        decoding="async"
        fetchPriority="low"
        className="hidden h-80 w-auto object-contain xl:block xl:justify-self-center"
      />
    </div>
  );
}
