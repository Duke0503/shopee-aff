/**
 * Two blocks the pen.dev customer pages repeat: the anti-scam note (Home, Account: research
 * "anti-scam block") on a muted fill with the shield icon, and the dark Zalo panel with the
 * group's picture and one white button (Home). The panel's button follows every Zalo button: the
 * assistant's private chat, the fallback contact while the assistant is down, or nothing when no
 * fallback is set.
 */
import { buttonVariants, cn, MessageCircleIcon, PhoneIcon } from "@cashback/ui";

import { webText } from "../labels";
import { useZaloTarget } from "../site/site-status.queries";
import { ShieldAlertIcon } from "./page-icons";

export function ScamNote({ className }: { readonly className?: string }) {
  return (
    <aside data-scam-note className={cn("flex gap-3 rounded-xl bg-muted p-4", className)}>
      <ShieldAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-[15px] leading-snug font-semibold">{webText("scam_title")}</p>
        <p className="text-meta text-muted-foreground md:text-sm">{webText("scam_body")}</p>
      </div>
    </aside>
  );
}

export function ZaloPanel() {
  const { href, down } = useZaloTarget();
  if (href === null) return null;
  const Icon = href.startsWith("tel:") ? PhoneIcon : MessageCircleIcon;
  return (
    <section aria-labelledby="zalo-panel-title" data-zalo-panel className="flex flex-wrap items-center gap-3 rounded-xl bg-ink p-4 text-white md:gap-4 md:px-5">
      <img src="/zalo-group-96.webp" alt="" width={48} height={48} loading="lazy" className="size-12 shrink-0 rounded-full object-cover" />
      <div className="flex min-w-0 flex-1 basis-[150px] flex-col gap-0.5">
        <h2 id="zalo-panel-title" className="text-base leading-snug font-semibold">
          {webText("zalo_panel_title")}
        </h2>
        <p className="text-meta text-white/75 md:text-sm">{webText("zalo_panel_body")}</p>
      </div>
      <a href={href} rel="noopener" data-zalo-button={down ? "fallback" : "zalo"} className={cn(buttonVariants({ variant: "outline" }), "ml-auto h-11 max-w-full shrink-0 rounded-lg border-white bg-white px-4 text-[15px] font-semibold text-foreground hover:bg-white/90")}>
        <Icon aria-hidden className="size-5" />
        {webText(down ? "zalo_down_button" : "zalo_panel_button")}
      </a>
    </section>
  );
}
