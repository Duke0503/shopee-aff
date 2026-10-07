# @mmo/money

The **only** home of the money rules (ADR-13). Pure TypeScript: no NestJS, no
Fastify, no Drizzle, no HTTP. Every module and the golden tests import these
functions; nothing else re-implements them.

Ported line-for-line from Python `src/cashback/core/policy.py` and
`src/cashback/shopee/commission.py`, so the new code pays the **same money, to
the dong**.

## Exports

| File | What it holds |
|---|---|
| `rounding.ts` | `roundDong` (half up), `legacyRoundHalfEven` (half to even) |
| `tax.ts` | `WITHHOLDING_TAX_RATE`, `WITHHOLDING_THRESHOLD_VND`, `TaxPolicy`, `shouldWithhold`, `policyWarnings` |
| `split.ts` | `SERVICE_FEE_RATE`, `splitCommission`, `Split` |
| `shopee-cap.ts` | `SHOPEE_COMMISSION_CAP_VND`, `capShopeePart`, `buildEstimate`, `estimateCashback` |

## The formulas

```
total commission = min(price x shopee_rate, 40,000d) + price x seller_rate

fee      = round(C x 0.98%)          (legacy: half to EVEN)
tax      = round(C x 10%)            only in a withheld period
net      = C - fee - tax
cashback = roundDong(net x CASHBACK_RATE)   (half UP)
operator = net - cashback
estimate = roundDong(roundDong(C x 0.8902) x CASHBACK_RATE)
```

`CASHBACK_RATE` is production config (`0.80`); pass it in as `cashbackRate`.

## The one deliberate inconsistency

`roundDong` rounds a half **up** (9,262.5 → 9,263). The service fee and the
withheld tax use `legacyRoundHalfEven`, which rounds a half to the nearest
**even** number, because that is what Python's `round()` does in today's code
(e.g. 12,345d withheld → tax 1,234, not 1,235). `legacyRoundHalfEven` is used
**nowhere else**. Whether to unify the rule is an owner decision (Ledger open
question 3).

## Test

```bash
pnpm --filter @mmo/money test
```

Unit tests cover the edge cases; `packages/golden` re-checks the same values
as saved Python fixtures for both runtimes.
