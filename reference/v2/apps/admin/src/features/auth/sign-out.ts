import { createApiClient } from "@mmo/contracts";

/** The admin sign-out action. Networking lives outside components. */
const api = createApiClient();

export async function signOut(): Promise<void> {
  await api.logout();
}
