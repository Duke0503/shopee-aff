/**
 * The cloudflared tunnel check (AD-25, AD-18, Story 8.5): the tunnel must expose only the public
 * listener (127.0.0.1:<PUBLIC_PORT>, 8080 in production). Every `service:` and legacy `url:` value
 * in the config file is either that listener or a fixed `http_status:` answer, the last ingress
 * rule is the catch-all `http_status:404`, and nothing points at the internal listener, the live
 * system's ports or any other origin.
 *
 * The check reads the config as lines and fails closed: a value it cannot read (flow style
 * `{ ... }` or `[ ... ]`, an anchor, a multi-line value) is a problem, never a pass. The admin host
 * goes to the same public listener, where only its own Host header opens the staff routes and
 * Cloudflare Access stands in front of it.
 */
export interface TunnelRule {
  readonly hostname: string | null;
  readonly service: string;
}

export interface TunnelCheck {
  readonly ok: boolean;
  readonly rules: readonly TunnelRule[];
  readonly problems: readonly string[];
}

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/, "$2");

/** The value after `key:` on a line, comments removed, or null when the line is not that key. */
function valueOf(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*(?:-\\s+)?${key}\\s*:\\s*(.*)$`).exec(line);
  if (!match) return null;
  return unquote((match[1] ?? "").replace(/\s+#.*$/, ""));
}

const isPublicListener = (service: string, port: number): boolean => new RegExp(`^http://(127\\.0\\.0\\.1|localhost):${port}/?$`).test(service);
const isFixedAnswer = (service: string): boolean => /^http_status:[1-5]\d\d$/.test(service);

/** The ingress rules in order, each from its `- ` item: its hostname (if any) and service. */
function ingressRules(lines: readonly string[]): { rules: TunnelRule[]; problems: string[] } {
  const rules: { hostname: string | null; service: string | null }[] = [];
  const problems: string[] = [];
  let inIngress = false;
  for (const line of lines) {
    if (/^\S/.test(line)) inIngress = /^ingress\s*:\s*$/.test(line);
    if (!inIngress || /^ingress\s*:/.test(line)) continue;
    if (/^\s*-\s/.test(line)) rules.push({ hostname: null, service: null });
    const current = rules.at(-1);
    if (current === undefined) continue;
    const hostname = valueOf(line, "hostname");
    if (hostname !== null) current.hostname = hostname;
    const service = valueOf(line, "service");
    if (service !== null) current.service = service;
  }
  for (const [i, rule] of rules.entries()) if (rule.service === null) problems.push(`ingress rule ${i + 1} has no service`);
  return { rules: rules.filter((r): r is TunnelRule => r.service !== null), problems };
}

export function checkTunnelConfig(text: string, publicPort: number): TunnelCheck {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "" && !/^\s*#/.test(line));
  const problems: string[] = [];
  for (const line of lines) if (/[{}[\]&*|>]\s*$|:\s*[{[&*|>]/.test(line.replace(/\s+#.*$/, ""))) problems.push(`unsupported syntax: ${line.trim()}`);
  // Every service anywhere in the file, inside the ingress list or not.
  const services = lines.flatMap((line) => [valueOf(line, "service"), valueOf(line, "url")]).filter((v): v is string => v !== null);
  for (const service of services) if (!isPublicListener(service, publicPort) && !isFixedAnswer(service)) problems.push(`service ${service} is not the public listener 127.0.0.1:${publicPort}`);
  const ingress = ingressRules(lines);
  problems.push(...ingress.problems);
  const { rules } = ingress;
  if (rules.length === 0) problems.push("no ingress rules");
  const last = rules.at(-1);
  if (last !== undefined && (last.hostname !== null || !isFixedAnswer(last.service))) problems.push("the last ingress rule must be the catch-all http_status:404");
  if (!rules.some((r) => isPublicListener(r.service, publicPort))) problems.push(`no rule sends traffic to the public listener 127.0.0.1:${publicPort}`);
  return { ok: problems.length === 0, rules, problems };
}
