import { createApiClient } from "@mmo/contracts";

/** The admin sign-in action. Networking lives outside components. */
const api = createApiClient();

export async function signIn(name: string, password: string): Promise<{ customerId: string }> {
  return api.login(name, password);
}
