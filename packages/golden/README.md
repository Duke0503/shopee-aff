# @mmo/golden

Saved examples ("for this input, the answer is exactly this") that **both** the
old Python code and the new TypeScript code must pass. This is how we prove the
new system pays the same money, to the dong, before anything switches over.
See `docs/architecture-v2/05-migration/02-golden-tests.md`.

## Layout

```
packages/golden/
├── fixtures/money/*.json      the money cases
└── src/runner.ts              reads a fixture and calls the matching @mmo/money function
```

## Fixture format

```json
{
  "rule": "split_commission",
  "source": "src/cashback/core/policy.py::split_commission",
  "cases": [
    {
      "name": "normal period, 12,000d approved, 80%",
      "input": { "approved_commission": 12000, "cashback_rate": 0.8,
                 "tax_policy": "user_absorbs", "period_is_withheld": false },
      "expected": { "service_fee": 118, "withheld_tax": 0,
                    "customer_receives": 9506, "operator_keeps": 2376 }
    }
  ]
}
```

`expected` values were produced by **running the current Python** (see the
`source` field), not written by hand, and were cross-checked against
`packages/money`'s unit tests.

## Rules for editing fixtures

- **Never edit an `expected` value to make new code pass.** Fix the code.
- A rule the owner changes gets a **new** case with a new name and date; the old
  case is removed in the same reviewed change, with the reason.
- Anything the owner has not yet decided (tax policy, fee/tax rounding) stays as
  today's behaviour and is marked as a known deviation in the case name.

## Run

```bash
pnpm --filter @mmo/golden test
```

## Not yet done (Phase 1 remainder)

The Python side of the harness (a pytest file that reads the same JSON and
calls `cashback.core.policy`) is added when the fixtures for `identity/`,
`affiliate/` and `orders/` are written. `money/` is complete.
