import { useState, type ReactElement } from "react";

import { ApiError } from "@mmo/contracts";
import { Button, colors, spacing } from "@mmo/ui";

import { signIn } from "./features/auth/sign-in";
import { label, useLabels, type Labels } from "./shared/lib/labels";

/** The server's refusal in the owner's words. */
function reasonOf(labels: Labels, cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.message === "bad_credentials") return label(labels, "login_bad_credentials");
    if (cause.message === "locked") return label(labels, "login_locked");
  }
  return label(labels, "login_error", {
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}

/** The staff sign-in: an admin or employee account. */
export function AdminLoginPage({ onSignedIn }: { onSignedIn: () => void }): ReactElement {
  const labels = useLabels();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    setBusy(true);
    setError("");
    void signIn(name, password)
      .then(onSignedIn)
      .catch((cause: unknown) => setError(reasonOf(labels, cause)))
      .finally(() => setBusy(false));
  };

  return (
    <main style={{ color: colors.text, padding: spacing.lg }}>
      <h1>{label(labels, "login_title")}</h1>
      <p style={{ color: colors.muted }}>{label(labels, "admin_login_lead")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label style={{ display: "block" }}>
          {label(labels, "login_name")}
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label style={{ display: "block" }}>
          {label(labels, "login_password")}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error !== "" ? <p style={{ color: colors.brand }}>{error}</p> : null}
        <Button onClick={submit} disabled={busy}>
          {label(labels, busy ? "login_working" : "login_submit")}
        </Button>
      </form>
    </main>
  );
}
