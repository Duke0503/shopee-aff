import { describe, expect, it } from "vitest";

import { createLogger, REDACTED, SENSITIVE_KEYS } from "../src/platform/log/logger";

function capture(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger({ destination: { write: (line: string) => void lines.push(line) } });
  return { lines, logger };
}

const SECRET = "4111222233334444";

describe("redacted logs (Story 1.5 AC4, AD-27)", () => {
  const cases: [label: string, field: string][] = [
    ["bank number", "bankNumber"],
    ["bank account number", "bank_account_number"],
    ["bank account number", "bankAccountNumber"],
    ["phone number", "phone"],
    ["phone number", "phoneNumber"],
    ["token", "token"],
    ["internal token", "internalToken"],
    ["bridge token", "x-bridge-token"],
    ["session id", "sessionId"],
    ["session id", "session_id"],
    ["password", "password"],
    ["password", "Password"],
    ["secret", "fingerprintSecret"],
    ["Zalo id", "zaloId"],
    ["authorization header", "authorization"],
    ["cookie header", "cookie"],
    ["set-cookie header", "set-cookie"],
    ["internal token header", "x-internal-token"],
  ];

  for (const [label, field] of cases) {
    it(`redacts a ${label} field (${field}) at any depth`, () => {
      const { lines, logger } = capture();
      logger.info({ [field]: SECRET }, "test.field.top");
      logger.info({ customer: { [field]: SECRET } }, "test.field.nested");
      logger.info({ a: { b: { c: { d: { [field]: SECRET } } } } }, "test.field.deep");
      logger.info({ rows: [{ [field]: SECRET }, { items: [{ [field]: SECRET }] }] }, "test.field.array");
      expect(lines).toHaveLength(4);
      for (const line of lines) {
        expect(line).not.toContain(SECRET);
        expect(line).toContain(REDACTED);
      }
    });
  }

  it("covers every listed key", () => {
    const { lines, logger } = capture();
    logger.info(Object.fromEntries(SENSITIVE_KEYS.map((f) => [f, SECRET])), "test.field.all");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it("redacts a top-level headers object", () => {
    const { lines, logger } = capture();
    logger.info(
      { headers: { authorization: `Bearer ${SECRET}`, cookie: `sid=${SECRET}`, "set-cookie": [`sid=${SECRET}`], "x-internal-token": SECRET, "x-bridge-token": SECRET, accept: "text/html" } },
      "http.request.received",
    );
    const line = JSON.parse(lines[0] ?? "{}") as { headers: Record<string, unknown> };
    expect(lines.join("")).not.toContain(SECRET);
    expect(line.headers.accept).toBe("text/html");
  });

  it("redacts fields bound on a child logger", () => {
    const { lines, logger } = capture();
    logger.child({ session: { sessionToken: SECRET } }).info("identity.session.started");
    logger.child({ reqId: "r1" }).child({ headers: { cookie: SECRET } }).info("http.request.received");
    expect(lines.join("")).not.toContain(SECRET);
  });

  it("keeps ids and the event name, and survives a cycle", () => {
    const { lines, logger } = capture();
    const looped: Record<string, unknown> = { customerId: "C123" };
    looped["self"] = looped;
    logger.info({ customerId: "C123", looped }, "identity.customer.registered");
    const line = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(line).toMatchObject({ customerId: "C123", msg: "identity.customer.registered" });
  });
});
