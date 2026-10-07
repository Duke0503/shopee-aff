import type { ReactElement } from "react";

import { Button, colors, spacing } from "@mmo/ui";

/** The customer home. It reads amounts from the server and never computes money. */
export function App(): ReactElement {
  return (
    <main style={{ padding: spacing.lg, color: colors.text, background: colors.surface }}>
      <h1>Cashback</h1>
      <p style={{ color: colors.muted }}>Paste a product link to get your personal cashback link.</p>
      <Button>Get a link</Button>
    </main>
  );
}
