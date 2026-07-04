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

The API only emits credentialed CORS headers for explicit browser origins.
Local development defaults to `http://localhost:${MO_DEVFLOW_WEB_PORT}` and
`http://127.0.0.1:${MO_DEVFLOW_WEB_PORT}`. Set
`MO_DEVFLOW_ALLOWED_ORIGINS` to a comma-separated allowlist for deployed
frontends; each value must be an origin only, with no path, query, or fragment.
Logged-in browser write requests also require the API-issued
`mo_devflow_csrf` cookie value in the `x-mo-devflow-csrf` header. This protects
manual refresh, notification acknowledgement, workflow-fix preview/confirm, and
logout endpoints while keeping the session cookie HttpOnly.

To enable personal GitHub token binding, set `MO_DEVFLOW_TOKEN_ENCRYPTION_KEY`
to a 32-byte base64 key, for example `openssl rand -base64 32`.
Token binding attempts are guarded per client IP by
`MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX` attempts per
`MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS`; the default is 5 attempts per
300 seconds. Exceeded requests return `429` with `Retry-After`.

Logged-in users can preview selected workflow fixes from cached violations,
then confirm execution through their own GitHub token. Previews and execution
results are audited, and the dashboard exposes recent write executions in the
Audit view for logged-in users. Current fixes can add `needs-triage` or move
stale or premature active issues to `deferred` with an explanatory comment.
Issue workflow fixes require a validated token with classic `repo` or
`public_repo` scope before the UI and API will offer the action. Before a
preview is recorded, the API also performs a fresh GitHub read with the user's
token; rejected tokens are revoked locally so the UI moves back to the reconnect
flow.

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

When watched users, testing handoff, or notification employee mappings are not
configured, the dashboard surfaces profile setup actions plus one merged YAML
setup patch. The patch is derived from cached owners, requested reviewers, and
active notification candidates so maintainers can review a single profile
change instead of piecing together separate snippets.

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

PR attention includes stale review requests. If a pending PR still has requested
reviewers, has no cached review response, and has been stale longer than the
configured threshold, it is marked `review_requested_no_response`; until request
timeline events are backfilled this remains partial-cache evidence.

AI drift also includes PR-level evidence. An open `ai-easy` PR with requested
changes, failed CI, or merge conflict attention is flagged as
`ai_easy_pr_has_blockers` so the effort label can be corrected before close.

Repository behavior is driven by `config/repos/matrixone.yaml`. The MatrixOne
profile includes `workflow.skip_users` from the local `mo-bug-triage` skill; a
skipped user can still appear in cached dashboards, but the rule engine will not
create workflow violations, AI drift signals, attention notifications, or
configuration suggestions for that user's issues.
