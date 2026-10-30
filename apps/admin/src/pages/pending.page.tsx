/**
 * A desk page whose screen a later story builds (Overview 4.17, Payouts 4.6, Review 4.15,
 * Customers 4.14, Link requests 5.10, Campaigns 4.20, Staff 9.6, Audit 9.7, Settings 4.18). It
 * exists now so every navigation item opens a real route and the shell can be checked end to end.
 */
import { adminText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";

export function PendingPage({ titleKey }: { readonly titleKey: AdminKey }) {
  return (
    <>
      <PageHeader title={adminText(titleKey)} />
      <p className="rounded-xl border border-border bg-card px-4 py-6 text-[15px] text-muted-foreground">{adminText("page_pending")}</p>
    </>
  );
}
