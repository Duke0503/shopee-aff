import { createApiClient } from "@mmo/contracts";

/** The sign-in action. Networking lives outside components (the coding rules). */
const api = createApiClient();

export async function signIn(name: string, password: string): Promise<{ customerId: string }> {
  return api.login(name, password);
}
