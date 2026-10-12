import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useCampaigns } from "./features/campaigns/campaigns.queries";
import { shortDate } from "./shared/lib/dates";
import { label, useLabels } from "./shared/lib/labels";
import { vnd } from "./shared/lib/money";

const cell = { borderBottom: `1px solid ${colors.border}`, fontSize: 12, padding: "4px 8px" } as const;

/** Campaign list: "the first N orders get a bonus", one row per event. */
export function CampaignsPage(): ReactElement {
  const labels = useLabels();
  const { campaigns, error } = useCampaigns();

  if (error !== "") {
    return <p style={{ color: colors.brand }}>{label(labels, "load_failed", { reason: error })}</p>;
  }

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "admin_nav_campaigns")}</h1>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cell}>{label(labels, "admin_col_name")}</th>
            <th style={cell}>{label(labels, "admin_col_window")}</th>
            <th style={cell}>{label(labels, "admin_col_slots")}</th>
            <th style={cell}>{label(labels, "admin_col_bonus")}</th>
            <th style={cell}>{label(labels, "col_status")}</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.campaignId}>
              <td style={cell}>{campaign.name}</td>
              <td style={cell}>
                {shortDate(campaign.startsAt)} – {shortDate(campaign.endsAt)}
              </td>
              <td style={cell}>{campaign.slots}</td>
              <td style={cell}>{vnd(campaign.bonusVnd, labels)}</td>
              <td style={cell}>{campaign.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
