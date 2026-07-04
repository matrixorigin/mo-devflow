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
results are audited. Current fixes can add `needs-triage` or move stale or
premature active issues to `deferred` with an explanatory comment. Issue
workflow fixes require a validated token with classic `repo` or `public_repo`
scope before the UI and API will offer the action. Before a preview is
recorded, the API also performs a fresh GitHub read with the user's token;
rejected tokens are revoked locally so the UI moves back to the reconnect flow.

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
`X-Hub-Signature-256` against `MO_DEVFLOW_GITHUB_WEBHOOK_SECRET`; deliveries
are rejected until that secret is configured. Payloads must include
`repository.full_name`, and deliveries for other repositories are ignored.
Only implemented cache-ingestion events are accepted: `issues`, `pull_request`,
`pull_request_review`, `workflow_run`, and `check_run`. Review and CI webhooks
trigger a fresh PR insight read before updating request-change, CI, and testing
attention, instead of trusting a single webhook payload as the final PR state.
Other signed events are acknowledged as ignored before they enter the queue, and
ignored deliveries are still counted for operational visibility. Accepted
deliveries store the delivery ID and raw payload before acknowledgement.
Duplicate deliveries are ignored and counted for operational visibility. The
worker processes stored issue and pull request deliveries asynchronously into
the MatrixOne cache.

The current implementation covers read-only cached observability for repo-wide
critical issues, watched-user summaries, pending PRs, workflow violations, AI
drift signals, testing queue state, cached analytics, owner attribution, and
data freshness indicators.

Issue comment backfill is available for workflow rules that need comment
evidence. Deferred issues only raise a missing-explanation violation after the
comment sync for that issue is complete; partial comment evidence suppresses the
rule instead of producing a misleading alert. Anonymous GitHub sync does not
fetch comments by default; set `MO_DEVFLOW_ISSUE_COMMENT_MAX_ITEMS` or configure
a service read token before relying on comment-backed workflow checks.

The same GitHub issue-comment cache supports configured PR testing handoff
comments. When `testing.handoff_signals.comments` is configured, matching
complete PR comment evidence can move a PR into the testing queue and refresh
its human-action timestamp.

Repository behavior is driven by `config/repos/matrixone.yaml`. The MatrixOne
profile includes `workflow.skip_users` from the local `mo-bug-triage` skill; a
skipped user can still appear in cached dashboards, but the rule engine will not
create workflow violations, AI drift signals, attention notifications, or
configuration suggestions for that user's issues.
