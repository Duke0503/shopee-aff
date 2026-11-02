/**
 * The backup manifest (AD-26, Story 8.6): `manifest.json` inside each daily archive records what
 * the ledger held when the copy was taken (its SHA-256, the row count of every table and the
 * balance totals the composition root reads with `balanceTotals`), so a restore on another
 * machine proves it brought back the same money, not only a file that opens. Platform code never
 * imports a module, so the totals arrive as plain named integers.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { z } from "zod";

export const MANIFEST_ENTRY = "manifest.json";
export const MANIFEST_FORMAT = 1;

const counts = z.record(z.string(), z.number().int().min(0));

const manifestSchema = z.object({
  format: z.literal(MANIFEST_FORMAT),
  createdAt: z.string(),
  ledgerSha256: z.string().regex(/^[0-9a-f]{64}$/),
  rowCounts: counts,
  totals: counts,
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

export async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export const manifestText = (manifest: BackupManifest): string => `${JSON.stringify(manifest, null, 2)}\n`;

export function parseManifest(text: string): BackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ManifestError("manifest is not JSON");
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new ManifestError(`manifest invalid: ${[...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ")}`);
  return parsed.data;
}

/** Each name whose value differs between what the manifest recorded and what was read back; empty when they agree. */
export function figureMismatches(recorded: Readonly<Record<string, number>>, actual: Readonly<Record<string, number>>, what: string): string[] {
  const names = [...new Set([...Object.keys(recorded), ...Object.keys(actual)])].sort();
  return names.filter((name) => recorded[name] !== actual[name]).map((name) => `${what} ${name}: ${actual[name] ?? "missing"} restored, ${recorded[name] ?? "missing"} at backup`);
}
