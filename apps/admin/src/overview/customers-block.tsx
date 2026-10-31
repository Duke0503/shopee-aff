/**
 * Block 7, customers and risk (dashboard-spec Block 7), and Block 8, the quiet health line from the
 * one health model (AD-27, Story 4.17 AC6): each component is a dot plus a word, never colour
 * alone; a component that is down links to its runbook step, which opens right below the line. A
 * component that does not report yet reads "not known yet", never "up".
 */
import type { Overview, OverviewHealth } from "@cashback/contracts";
import { formatVnDateTime, parseInstant, systemClock } from "@cashback/core";
import { cn, formatBps, formatCount } from "@cashback/ui";
import { Link } from "@tanstack/react-router";

import { adminText, type AdminKey } from "../labels";
import { Block, Card, CountChange, RatioValue } from "./overview-parts";

function CountCard({ label, figure, definition }: { readonly label: string; readonly figure: Overview["customers"]["withOrder"]; readonly definition: string }) {
  return (
    <Card>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <span className="text-lg font-semibold">{figure.value === null ? "\u2013" : adminText("ov_count_customers", { count: formatCount(figure.value) })}</span>
      <p className="text-meta text-muted-foreground">{definition}</p>
      <div className="mt-auto pt-1">
        <CountChange figure={figure} />
      </div>
    </Card>
  );
}

export function CustomersBlock({ customers }: { readonly customers: Overview["customers"] }) {
  return (
    <Block title={adminText("ov_customers_title")} basis={adminText("ov_orders_basis")}>
      {customers.concentration !== null && (
        <p role="alert" className="rounded-md bg-status-attention-soft p-3 text-sm break-words text-status-attention">
          {adminText("ov_concentration", { code: customers.concentration.customerCode ?? "", share: formatBps(customers.concentration.shareBps) ?? "" })}
        </p>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        <CountCard label={adminText("ov_with_order")} figure={customers.withOrder} definition={adminText("ov_with_order_def")} />
        <CountCard label={adminText("ov_new_customers")} figure={customers.newCustomers} definition={adminText("ov_new_customers_def")} />
        <Card>
          <p className="text-sm font-medium text-muted-foreground">{adminText("ov_repeat")}</p>
          <span className="text-lg">
            <RatioValue ratio={customers.repeatShare} />
          </span>
          <p className="text-meta text-muted-foreground">{adminText("ov_repeat_def")}</p>
          <Link to="/customers" className="mt-auto pt-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
            {adminText("ov_customers_link")}
          </Link>
        </Card>
      </div>
    </Block>
  );
}

const COMPONENT: Record<OverviewHealth["component"], AdminKey> = { bridge: "ov_health_bridge", assistant: "ov_health_assistant", reconciliation: "ov_health_reconciliation", backup: "ov_health_backup" };
const RUNBOOK: Record<OverviewHealth["component"], AdminKey> = { bridge: "ov_runbook_bridge", assistant: "ov_runbook_assistant", reconciliation: "ov_runbook_reconciliation", backup: "ov_runbook_backup" };
const STATE: Record<OverviewHealth["state"], { readonly word: AdminKey; readonly dot: string }> = {
  up: { word: "ov_state_up", dot: "bg-primary" },
  down: { word: "ov_state_down", dot: "bg-status-rejected" },
  unknown: { word: "ov_state_unknown", dot: "bg-status-neutral" },
};

export function HealthLine({ health }: { readonly health: readonly OverviewHealth[] }) {
  const down = health.filter((h) => h.state === "down");
  return (
    <Block title={adminText("ov_health_title")}>
      <ul data-health className="flex min-w-0 flex-wrap gap-x-5 gap-y-2 text-sm">
        {health.map((h) => (
          <li key={h.component} data-component={h.component} data-state={h.state} className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STATE[h.state].dot)} />
            <span>{adminText(COMPONENT[h.component])}</span>
            <span className={cn("font-medium", h.state === "down" ? "text-status-rejected" : "text-muted-foreground")}>{adminText(STATE[h.state].word)}</span>
            {h.at !== null && <span className="text-meta text-muted-foreground">{adminText("ov_health_at", { time: formatVnDateTime(parseInstant(h.at), systemClock) })}</span>}
            {h.state === "down" && (
              <a href={`#runbook-${h.component}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {adminText("ov_runbook")}
              </a>
            )}
          </li>
        ))}
      </ul>
      {down.map((h) => (
        <p key={h.component} id={`runbook-${h.component}`} className="rounded-md border border-border bg-card p-3 text-sm break-words">
          <span className="font-medium">{adminText(COMPONENT[h.component])}: </span>
          {adminText(RUNBOOK[h.component])}
        </p>
      ))}
    </Block>
  );
}
