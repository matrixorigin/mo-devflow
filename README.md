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

Logged-in users can preview selected workflow fixes from cached violations,
then confirm execution through their own GitHub token. Previews and execution
results are audited. Issue-label workflow fixes require a validated token with
classic `repo` or `public_repo` scope before the UI and API will offer the
action.

The worker is driven by the MatrixOne-backed `jobs` table. Recurring GitHub
sync, rule, metric, AI drift, and notification jobs use leases, retry backoff,
and queue health surfaced on the dashboard. Worker processes also write
heartbeats so the dashboard and `/health` can distinguish an empty queue from a
stopped or stale background process.
GitHub rate-limit failures are retried after the advertised reset window, while
non-retriable permission failures are marked as blocked until credentials or a
manual refresh changes the job state.
Visible cached GitHub objects are counted as stale after
`MO_DEVFLOW_CACHE_STALE_HOURS` so dashboards can keep serving cache while still
showing freshness risk.

GitHub webhooks can be posted to `/api/webhooks/github`. The API verifies
`X-Hub-Signature-256` when `MO_DEVFLOW_GITHUB_WEBHOOK_SECRET` is configured,
then stores each delivery ID and raw payload before acknowledging it. Duplicate
deliveries are ignored and counted for operational visibility. The worker
processes stored issue and pull request deliveries asynchronously into the
MatrixOne cache.

The current implementation covers read-only cached observability for repo-wide
critical issues, watched-user summaries, pending PRs, workflow violations, AI
drift signals, testing queue state, cached analytics, owner attribution, and
data freshness indicators.
