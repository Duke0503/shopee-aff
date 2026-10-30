# D36 (Encrypted backups go off the machine to Google Drive with rclone; the owner holds the age key)

- Status: accepted
- Date: 2026-10-30
- Approved by: Delegated to Claude by the project owner on 2026-10-30 (recommended option, from the architecture run).

## Decision

Encrypted backups go off the machine to Google Drive with rclone; the owner holds the age key. Cloudflare Access on the admin host allows only the owner's and staff accounts, listed outside the repository.

## Rationale

Google Drive is already used for payout proofs; the key stays with the owner.

## Links

- _bmad-output/planning-artifacts/architecture/architecture-cashback-2026-10-30/ARCHITECTURE-SPINE.md
- docs/domain-model.json (decision `d36-offsite-backup-drive`)
