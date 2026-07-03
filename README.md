# mo-devflow

Development workflow observability platform for configured GitHub repositories, with MatrixOne as the first workflow profile.

## Documents

- [Product Requirements](./PRODUCT_REQUIREMENTS.md)
- [Technical Design](./TECHNICAL_DESIGN.md)

## Quick Start

```bash
make setup
make dev-init
make sync-once
make rules-once
make metrics-once
make drift-once
make notify-once
make dev-start
```

Default local services:

- API: `http://localhost:18081`
- Web: `http://localhost:5173`
- MatrixOne database: `mo_devflow`

To enable personal GitHub token binding, set `MO_DEVFLOW_TOKEN_ENCRYPTION_KEY`
to a 32-byte base64 key, for example `openssl rand -base64 32`.

Logged-in users can preview selected workflow fixes from cached violations. The
preview is audited and expires before any future confirmed GitHub write.

The first implementation slice is MVP0: read-only cached observability for repo-wide critical issues, watched-user summaries, pending PRs, workflow violations, AI drift signals, cached analytics, owner attribution, and data freshness indicators.
