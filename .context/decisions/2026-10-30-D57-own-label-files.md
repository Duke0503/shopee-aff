# D57 (own label files for the new platform)

- Status: accepted
- Date: 2026-10-30
- Approved by: delegated to Claude by the project owner (recommended option).

## Decision

The new platform keeps its own label and message files in packages/labels and never edits resources/, which the live system reads at runtime. Live labels are copied into packages/labels at cutover.

## Rationale

`resources/dashboard.vi.json` is re-read on every live request, so any edit changes production instantly; the path guard blocks it on main-v2.

## Links

- docs/domain-model.json (decision `d57-own-label-files`)
