/**
 * The list response in its two Zod forms (Story 7.4 review): `listResponseSchema` (classic, the
 * desk) and `listResponseMiniSchema` (mini, the website) are built from the same bounds, infer the
 * same type and accept and refuse the same bodies, so the website can never read a list the desk
 * would refuse or the other way round.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { z as mini } from "zod/mini";

import { LIST_RESPONSE_BOUNDS, listResponseMiniSchema, listResponseSchema } from "../src/index";

const classic = listResponseSchema(z.object({ id: z.string(), amount: z.number().int().nullable() }));
const small = listResponseMiniSchema(mini.object({ id: mini.string(), amount: mini.nullable(mini.int()) }));

const good = { rows: [{ id: "a", amount: 1 }], total: 1, page: 1, pageSize: 20, facets: { status: [{ value: null, count: 0 }] }, summary: { amount: 1 }, asOf: "2026-11-02T12:42:00.000Z", overall: 3 };

const bodies: readonly unknown[] = [
  good,
  { ...good, overall: undefined },
  { ...good, page: 0 },
  { ...good, pageSize: LIST_RESPONSE_BOUNDS.maxPageSize + 1 },
  { ...good, pageSize: LIST_RESPONSE_BOUNDS.maxPageSize },
  { ...good, total: -1 },
  { ...good, total: 1.5 },
  { ...good, asOf: "2026-11-02 12:42" },
  { ...good, facets: { status: [{ value: "PAID", count: -1 }] } },
  { ...good, summary: { amount: 0.5 } },
  { ...good, overall: -1 },
  { ...good, rows: [{ id: 1, amount: null }] },
];

describe("the list response's classic and mini forms are one definition", () => {
  it("infer the same type", () => {
    expectTypeOf<z.infer<typeof classic>>().toEqualTypeOf<mini.infer<typeof small>>();
  });

  it("accept and refuse the same bodies", () => {
    for (const body of bodies) expect([body, small.safeParse(body).success]).toEqual([body, classic.safeParse(body).success]);
    expect(classic.safeParse(good).success).toBe(true);
    expect(bodies.filter((b) => classic.safeParse(b).success)).toHaveLength(3);
  });
});
