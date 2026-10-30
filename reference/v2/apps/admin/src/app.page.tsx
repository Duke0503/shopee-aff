import type { ReactElement } from "react";

import { colors, spacing } from "@mmo/ui";

import { ConsolePage } from "./console.page";
import { useSession } from "./features/auth/session.queries";
import { AdminLoginPage } from "./login.page";
import { label, useLabels } from "./shared/lib/labels";

/**
 * The console entry: check the session first, then either the sign-in form or
 * the screens. Nothing else reaches a data call, so the owner never sees a
 * screen full of "not signed in" errors.
 */
export function App(): ReactElement {
  const labels = useLabels();
  const { status, me, refresh } = useSession();

  if (status === "checking") {
    return (
      <main style={{ color: colors.muted, padding: spacing.lg }}>{label(labels, "loading")}</main>
    );
  }

  if (status === "out" || me === null) return <AdminLoginPage onSignedIn={refresh} />;

  return <ConsolePage me={me} onSignedOut={refresh} />;
}
