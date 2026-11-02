/** The live brand's logo mark (cashback-design-craft brand assets), copied from the admin desk's copy of web/public. */
import { cn } from "@cashback/ui";

export const LOGO_MARK_SRC = "/logo-mark-64.webp";

export function BrandMark({ className }: { readonly className?: string }) {
  return <img src={LOGO_MARK_SRC} alt="" width={32} height={32} className={cn("size-8 shrink-0 rounded-[10px] object-cover", className)} />;
}
