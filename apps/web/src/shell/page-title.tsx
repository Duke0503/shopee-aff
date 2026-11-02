/** The one page title of a customer screen (DESIGN.md type scale: 26 / 30 / 32 px, bold). */
import { cn } from "@cashback/ui";

import { useDocumentTitle } from "./use-document-title";

export function PageTitle({ children, lead, className }: { readonly children: string; readonly lead?: string; readonly className?: string }) {
  useDocumentTitle(children);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <h1 className="text-[26px] leading-tight font-bold text-balance tracking-[-0.015em] md:text-[30px] xl:text-[32px]">{children}</h1>
      {lead !== undefined && <p className="text-muted-foreground">{lead}</p>}
    </div>
  );
}
