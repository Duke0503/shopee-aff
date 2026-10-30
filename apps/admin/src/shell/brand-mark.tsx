/** The live brand's logo mark (cashback-design-craft brand assets), copied from web/public. */
import { cn } from "@cashback/ui";

export const LOGO_MARK_SRC = `${import.meta.env.BASE_URL}logo-mark.webp`;

export function BrandMark({ className }: { readonly className?: string }) {
  return <img src={LOGO_MARK_SRC} alt="" width={30} height={30} className={cn("shrink-0 rounded-[10px] object-cover", className)} />;
}
