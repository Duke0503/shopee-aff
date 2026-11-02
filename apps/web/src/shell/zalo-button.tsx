/**
 * The Zalo button (DESIGN.md): the main action whenever the customer must go to the assistant.
 * While the assistant is down it points to the fallback contact path instead and drops the word
 * Zalo from its label; with no fallback set it is not shown, and the banner explains (Story 7.1 AC1).
 */
import { buttonVariants, cn, MessageCircleIcon, PhoneIcon } from "@cashback/ui";

import { webText, type WebKey } from "../labels";
import { useZaloTarget } from "../site/site-status.queries";

export function ZaloButton({ labelKey, className }: { readonly labelKey: WebKey; readonly className?: string }) {
  const { href, down } = useZaloTarget();
  if (href === null) return null;
  const Icon = href.startsWith("tel:") ? PhoneIcon : MessageCircleIcon;
  return (
    <a href={href} rel="noopener" data-zalo-button={down ? "fallback" : "zalo"} className={cn(buttonVariants(), "h-11 px-4 text-[15px]", className)}>
      <Icon aria-hidden className="size-5" />
      {webText(down ? "zalo_down_button" : labelKey)}
    </a>
  );
}
