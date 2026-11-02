/**
 * Home (Story 7.1 shell; the link converter comes with Story 7.6). One task: get a cashback link,
 * which today means the Zalo assistant, so the one primary action is the Zalo button (pointing to
 * the fallback contact while chat is down). Signed out, a quiet line offers sign-in. Phone: the
 * mascot above the headline; desktop: text left, mascot right.
 */
import { CUSTOMER_PATHS } from "@cashback/contracts";
import { cn } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { webText } from "../labels";
import { useCustomerSession } from "../session/session.queries";
import { FOCUS_RING } from "../shell/nav-items";
import { useDocumentTitle } from "../shell/use-document-title";
import { ZaloButton } from "../shell/zalo-button";

export function HomePage() {
  useDocumentTitle(null);
  const session = useCustomerSession();
  return (
    <div className="mx-auto grid max-w-[640px] gap-6 px-4 pt-8 md:px-6 md:pt-14 xl:max-w-5xl xl:grid-cols-[1fr_320px] xl:items-center xl:gap-16 xl:pt-24">
      <div className="flex flex-col gap-4">
        {/* Two lines on purpose: the headline breaks after the comma at every width. */}
        <h1 className="text-[30px] leading-[1.15] font-bold tracking-[-0.02em] md:text-[38px] xl:text-[44px] xl:leading-[1.12]">
          <span className="block">{webText("home_title")}</span> <span className="block">{webText("home_title_rest")}</span>
        </h1>
        <p className="max-w-[52ch] text-[15px] text-muted-foreground md:text-[17px]">{webText("home_lead")}</p>
        <ZaloButton labelKey="zalo_button" className="mt-2 w-full md:w-fit" />
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
        sizes="(min-width: 1280px) 234px, 96px"
        alt=""
        width={263}
        height={360}
        decoding="async"
        fetchPriority="low"
        className="order-first h-28 w-auto object-contain md:h-36 xl:order-none xl:h-80 xl:justify-self-center"
      />
    </div>
  );
}
