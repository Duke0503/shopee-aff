import { useState, type ReactElement } from "react";

import { Button, colors, spacing } from "@mmo/ui";

import { signIn } from "./features/auth/sign-in";

/** The customer sign-in: a DP code (or any alias) and a password. */
export function LoginPage(): ReactElement {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = (): void => {
    signIn(name, password).catch((cause: Error) => setError(cause.message));
  };

  return (
    <main style={{ padding: spacing.lg, color: colors.text }}>
      <h1>Sign in</h1>
      <label>
        Code
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error !== "" ? <p style={{ color: colors.brand }}>{error}</p> : null}
      <Button onClick={submit}>Sign in</Button>
    </main>
  );
}
