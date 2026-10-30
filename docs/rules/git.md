# Rules: Git

## One repository

The cashback platform is one repository on GitHub: `Duke0503/shopee-aff`. It must be private
before planning documents are pushed (D16).

| Branch | What it holds |
|---|---|
| `main` | The live Python system. Production runs from it until the new platform replaces it |
| `main-v2` | The re-plan: planning documents now, the new platform later |

Never commit re-plan work to `main`.

## Branches

Work happens on short branches cut from `main-v2` and merges back through a pull request.

| Kind | Format | Example |
|---|---|---|
| Feature | `feature/{area}-{description}` | `feature/ledger-payout-batch` |
| Bugfix | `fix/{area}-{description}` | `fix/web-guest-warning` |
| Docs | `docs/{description}` | `docs/oq1-storage-decision` |

`{area}` is the bounded context or app, for example `ledger`, `orders`, `affiliate`, `web`,
`admin`, `assistant`, `domain`.

## Commit messages

Commit messages are in English.

```
{type}({scope}): {short description}

{details if needed}
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`. `{scope}` is the area. Leave
it out when the change spans the whole repository.

```
feat(ledger): pay all approved orders of one customer in one transfer
docs(domain): accept D3 and close OQ6
```

## Pull requests

- The title says what changed, not the branch name.
- The description has three parts: Why, What changed, How to test.
- A change that touches money names the golden test that covers it.
- Use squash merge.

## Never

- Never force push to `main` or `main-v2`.
- Never commit `.env` files, tokens, `cashback.db`, backups, the browser profile or Zalo
  credentials.
- Never resolve a conflict by taking one side without reading the other.
