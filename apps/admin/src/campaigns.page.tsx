import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { useCampaigns } from "./features/campaigns/campaigns.queries";

/** Campaign list: "the first N orders get a bonus", one row per event. */
export function CampaignsPage(): ReactElement {
  const { campaigns, error } = useCampaigns();

  if (error !== "") return <p style={{ color: colors.brand }}>{error}</p>;

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Campaigns</h1>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Window</th>
            <th>Slots</th>
            <th>Bonus</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => (
            <tr key={campaign.campaignId}>
              <td>{campaign.name}</td>
              <td>
                {campaign.startsAt} to {campaign.endsAt}
              </td>
              <td>{campaign.slots}</td>
              <td>{campaign.bonusVnd}</td>
              <td>{campaign.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
