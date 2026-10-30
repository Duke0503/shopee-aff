/** A page's title and one-line purpose, the same on every width; the title wraps, never overflows. */
import type { ReactNode } from "react";

export function PageHeader({ title, lead }: { readonly title: string; readonly lead?: ReactNode }) {
  return (
    <header className="mb-4 min-w-0">
      <h1 className="text-[22px] leading-tight font-bold tracking-tight break-words md:text-2xl">{title}</h1>
      {lead !== undefined && <p className="mt-1 text-meta text-muted-foreground">{lead}</p>}
    </header>
  );
}
