/**
 * Link requests (W6, FR-7, FR-25, FR-37, Story 5.10): every link request through DataList with its
 * state in the URL, so the Overview's "failed links" tile opens it filtered to FAILED for today
 * with the same count. One value per column: the request id and the owner's customer code are code
 * chips, a guest request's owner is the guest account (never a customer); the product is the
 * request's snapshot; the network, the channel, the state, the attempts, when the link was
 * delivered and when it was requested. The "requested" column sorts by that request time. Phone
 * cards carry the state badge, the owner's code chip and the one labelled request time; tablet
 * drops the request id, network, attempts and delivery. Read only: nothing is changed here.
 */
import type { ListSearchState } from "@cashback/contracts";
import { CodeChip, DataList, DateFilter, formatCount, OptionFilter, type ListColumn } from "@cashback/ui";

import { adminText, type AdminKey } from "../labels";
import { PageHeader } from "../shell/page-header";
import { LINK_REQUESTS_SEARCH, useLinkRequestsList, type LinkRequestRow } from "./link-requests.queries";

const CHANNEL_LABEL: Record<string, AdminKey> = { zalo: "channel_zalo", web: "channel_web" };
const channelName = (channel: string | null): string => adminText(channel === null ? "channel_unknown" : (CHANNEL_LABEL[channel] ?? "channel_unknown"));
const networkName = (row: LinkRequestRow): string => {
  if (row.platform === "shopeefood") return adminText("network_shopeefood");
  if (row.network === "shopee") return adminText("network_shopee");
  return adminText(row.network === "accesstrade" ? "network_accesstrade" : "network_unknown");
};
const ownerText = (row: LinkRequestRow): string | null => (row.guest ? adminText("owner_guest") : null);

function Owner({ row }: { readonly row: LinkRequestRow }) {
  if (row.guest) return <span className="block truncate font-medium" data-owner="guest">{adminText("owner_guest")}</span>;
  return row.customerCode === null ? <span className="text-muted-foreground">–</span> : <CodeChip code={row.customerCode} />;
}

export const LINK_REQUEST_COLUMNS: readonly ListColumn<LinkRequestRow>[] = [
  { key: "requestId", header: adminText("col_request_id"), kind: "code", sortable: true, card: "none", width: 140, desktopOnly: true },
  { key: "customerCode", header: adminText("col_owner"), kind: "code", sortable: true, card: "who", width: 150, render: (row) => <Owner row={row} />, cardText: ownerText },
  { key: "productName", header: adminText("col_product"), kind: "product", imageKey: "productImageUrl", sortable: true, card: "title" },
  { key: "network", header: adminText("col_network"), kind: "text", sortable: true, card: "none", desktopOnly: true, width: 116, render: (row) => <span className="block truncate">{networkName(row)}</span> },
  { key: "channel", header: adminText("col_channel"), kind: "text", sortable: true, card: "meta", width: 96, render: (row) => <span className="block truncate">{channelName(row.channel)}</span>, cardText: (row) => channelName(row.channel) },
  { key: "status", header: adminText("col_status"), kind: "status", entity: "linkRequest", sortable: true, card: "status" },
  { key: "attempts", header: adminText("col_attempts"), kind: "integer", sortable: true, card: "none", desktopOnly: true, width: 84 },
  { key: "deliveredAt", header: adminText("col_delivered_at"), kind: "instant", sortable: true, card: "none", desktopOnly: true, width: 116 },
  { key: "createdAt", header: adminText("col_requested_at"), kind: "instant", sortable: true, card: "meta", cardLabel: adminText("col_requested_short"), width: 116 },
];

const CHANNELS = [
  { value: "zalo", label: adminText("channel_zalo") },
  { value: "web", label: adminText("channel_web") },
];
const NETWORKS = [
  { value: "shopee", label: adminText("network_shopee") },
  { value: "accesstrade", label: adminText("network_accesstrade") },
];
const DATE_FIELDS = [
  { value: "createdAt", label: adminText("col_requested_at") },
  { value: "deliveredAt", label: adminText("col_delivered_at") },
];

export interface LinkRequestsPageProps {
  readonly state: ListSearchState;
  readonly onStateChange: (next: ListSearchState, options?: { readonly replace?: boolean }) => void;
}

export function LinkRequestsPage({ state, onStateChange }: LinkRequestsPageProps) {
  const query = useLinkRequestsList(state);
  return (
    <>
      <PageHeader title={adminText("nav_links")} lead={adminText("links_lead")} />
      <DataList
        search={LINK_REQUESTS_SEARCH}
        state={state}
        onStateChange={onStateChange}
        query={query}
        columns={LINK_REQUEST_COLUMNS}
        rowKey={(row) => row.requestId}
        searchPlaceholder={adminText("links_search")}
        countLabel={(count) => adminText("links_count", { count: formatCount(count) })}
        emptyText={adminText("links_empty")}
        statusFilter={{ field: "status", entity: "linkRequest" }}
        filters={(api) => (
          <>
            <OptionFilter api={api} field="channel" label={adminText("links_channel")} allLabel={adminText("links_channel_all")} options={CHANNELS} />
            <OptionFilter api={api} field="network" label={adminText("orders_network")} allLabel={adminText("links_network_all")} options={NETWORKS} />
            <DateFilter api={api} fields={DATE_FIELDS} />
          </>
        )}
      />
    </>
  );
}
