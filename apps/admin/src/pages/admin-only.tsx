/**
 * Admin-only pages (FR-24, Story 4.4 AC4): an employee who opens one by its URL sees the
 * permission line from the label file instead of the page. The server refuses the page's data
 * with 403 as well; this is the screen, not the guard.
 */
import type { ReactNode } from "react";

import { adminText } from "../labels";
import { useStaff } from "../session/staff-context";

export function AdminOnly({ children }: { readonly children: ReactNode }) {
  const staff = useStaff();
  if (staff.role === "ADMIN") return <>{children}</>;
  return (
    <p role="alert" className="rounded-xl border border-border bg-card px-4 py-6 text-[15px] font-medium text-attention">
      {adminText("admin_only")}
    </p>
  );
}
