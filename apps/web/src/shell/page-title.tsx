/** The one page title of a customer screen (pen.dev: 28 px on phone, 32 px wider, bold; the lead in muted 16 / 17 px). */
import { cn } from "@cashback/ui";

import { useDocumentTitle } from "./use-document-title";

export function PageTitle({ children, lead, className }: { readonly children: string; readonly lead?: string; readonly className?: string }) {
  useDocumentTitle(children);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <h1 className="text-[28px] leading-tight font-bold text-balance tracking-[-0.015em] md:text-[32px]">{children}</h1>
      {lead !== undefined && <p className="text-base text-muted-foreground md:text-[17px]">{lead}</p>}
    </div>
  );
}
