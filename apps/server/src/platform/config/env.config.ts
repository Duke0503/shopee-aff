/**
 * The only place that reads `process.env` (code.md §9). Story 1.5 replaces this
 * with the full validated config, the single-instance lock and redacted logs.
 */
export interface ServerConfig {
  publicPort: number;
  internalPort: number;
  internalToken: string;
}

function port(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} must be a port number`);
  return value;
}

export function loadConfig(): ServerConfig {
  const internalToken = process.env["INTERNAL_TOKEN"] ?? "";
  if (internalToken.length < 32) throw new Error("INTERNAL_TOKEN must be set to at least 32 characters");
  return {
    publicPort: port("PUBLIC_PORT", 9080),
    internalPort: port("INTERNAL_PORT", 9081),
    internalToken,
  };
}
