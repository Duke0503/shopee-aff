import { fileURLToPath } from "node:url";

/**
 * Where the bank screenshots an owner uploaded live. The same folder the
 * Python server writes (`uploads/proofs` at the repository root), so a proof
 * recorded by one server is served by the other during the migration.
 * Override with `PROOFS_DIR` when the deployment keeps uploads elsewhere.
 */
export function proofsDir(): string {
  return (
    process.env.PROOFS_DIR ??
    fileURLToPath(new URL("../../../../../uploads/proofs", import.meta.url))
  );
}
