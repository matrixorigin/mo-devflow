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

Database connection failures should fail fast enough for dashboards and health
checks to stay actionable. `MO_DEVFLOW_DB_CONNECT_TIMEOUT_MS` defaults to
`3000`; increase it only for known slow MatrixOne networks. The database pool
size defaults to `MO_DEVFLOW_DB_CONNECTION_LIMIT=10`.

## All-In-One Docker Deployment

For a single-host deployment that connects to an existing MatrixOne instance:

```bash
cd deployment/all-in-one
cp .env.example .env
docker compose up --build -d
```

The compose stack runs API, worker, and static web services. MatrixOne is
external and configured through `deployment/all-in-one/.env`.

The API only emits credentialed CORS headers for explicit browser origins.
Local development defaults to `http://localhost:${MO_DEVFLOW_WEB_PORT}` and
`http://127.0.0.1:${MO_DEVFLOW_WEB_PORT}`. Set
`MO_DEVFLOW_ALLOWED_ORIGINS` to a comma-separated allowlist for deployed
frontends; each value must be an origin only, with no path, query, or fragment.
Logged-in browser write requests also require the API-issued
`mo_devflow_csrf` cookie value in the `x-mo-devflow-csrf` header. This protects
manual refresh, notification acknowledgement, workflow-fix preview/confirm, and
logout endpoints while keeping the session cookie HttpOnly.

Enterprise WeChat notifications link back to the mo-devflow dashboard. Set
`MO_DEVFLOW_DASHBOARD_URL` to the public web URL in deployed environments; local
development uses `http://localhost:${MO_DEVFLOW_WEB_PORT}`.
Notification candidates include immediate attention alerts, escalation alerts,
and daily, weekly, and monthly maintainer digests derived from cached repository
metrics.
Delivery failures are recorded as transient or permanent so the dashboard can
show retrying provider failures separately from configuration problems.
Authenticated users can request an immediate retry for the latest failed
delivery; the worker still performs the actual send.
The notification panel also reports readiness, including webhook configuration
and employee mapping coverage, before maintainers rely on owner-routed alerts.

`make setup` generates a local-only `MO_DEVFLOW_TOKEN_ENCRYPTION_KEY` in the
ignored `.env` file so personal GitHub token binding can work in development.
For deployed environments, set `MO_DEVFLOW_TOKEN_ENCRYPTION_KEY` yourself to a
32-byte base64 key, for example `openssl rand -base64 32`, and keep it in secret
management rather than source control.
Token binding attempts are guarded per client IP by
`MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_MAX` attempts per
`MO_DEVFLOW_TOKEN_BIND_RATE_LIMIT_WINDOW_SECONDS`; the default is 5 attempts per
300 seconds. Exceeded requests return `429` with `Retry-After`.

Logged-in users can preview selected workflow fixes from cached violations,
then confirm execution through their own GitHub token. Previews and execution
results are audited, and the dashboard exposes recent write executions in the
Audit view for logged-in users. Current fixes can add `needs-triage` or move
stale or premature active issues to `deferred` with an explanatory comment.
The committed MatrixOne profile keeps `access.write_back_enabled: false` as a
safe default. For local development, put `access.write_back_enabled: true` in
the ignored `config/repos/matrixone.local.yaml` after you are ready for
confirmed GitHub writes through your own token.
Issue workflow fixes require a validated token with classic `repo` or
`public_repo` scope and `triage`, `write`, `maintain`, or `admin` permission on
the configured repository before the UI and API will offer the action. The
session view exposes the current repository permission so users can distinguish
scope problems from repo permission problems. Before a preview is recorded, the
API also performs a fresh GitHub read with the user's token; rejected tokens are
revoked locally so the UI moves back to the reconnect flow.

The worker is driven by the MatrixOne-backed `jobs` table. Recurring GitHub
sync, rule, metric, AI drift, and notification jobs use leases, retry backoff,
and queue health surfaced on the dashboard and `/health`. Worker processes also
write heartbeats so the dashboard and `/health` can distinguish an empty queue
from a stopped or stale background process. Queue health is degraded when jobs
are failed, blocked, have stale leases, or the oldest due job exceeds
`MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS`.
The `/health` response also includes an operational summary for sync layers,
stale or partial cache counts, active notification delivery failures, and
webhook ingestion failures so external monitors can detect degraded cached-data
quality without scraping the dashboard. If that summary query fails, `/health`
keeps returning database, worker, and job queue status with `status: degraded`
and an `operationalError` field instead of hiding the remaining health signals.
The dashboard API uses a short read-model cache keyed by repo profile, viewer,
and an incremental database version across issues, PRs, sync runs, webhook
deliveries, notifications, metrics, and write audit state. Set
`MO_DEVFLOW_DASHBOARD_CACHE_SECONDS=0` to disable it during debugging.
When the version probe or summary rebuild fails after a successful dashboard
build, the API can return the previous in-memory snapshot with
`X-MO-Devflow-Dashboard-Cache: stale-if-error` instead of dropping the
dashboard during a transient MatrixOne outage.
Logged-in users can queue layer-scoped refresh jobs from the dashboard instead
of spending GitHub rate limit on every sync layer.
GitHub rate-limit failures are retried after the advertised reset window, while
non-retriable permission failures are marked as blocked until credentials or a
manual refresh changes the job state.
Visible cached GitHub objects are counted as stale after
`MO_DEVFLOW_CACHE_STALE_HOURS` so dashboards can keep serving cache while still
showing freshness risk.

GitHub webhooks can be posted to `/api/webhooks/github`. `make setup` generates
a local-only `MO_DEVFLOW_GITHUB_WEBHOOK_SECRET` in `.env`; deployed environments
should provide it through secret management. Configure the same value as the
GitHub webhook secret. The API verifies `X-Hub-Signature-256` against that
secret; deliveries are rejected until it is configured. Payloads must include
`repository.full_name`, and deliveries for other repositories are ignored.
Only implemented cache-ingestion events are accepted: `issues`,
`issue_comment`, `pull_request`, `pull_request_review`, `workflow_run`, and
`check_run`. GitHub's `ping` delivery is recorded separately as a connectivity
probe: it proves the payload URL and secret are wired correctly, but it does not
enter the worker queue or count as issue/PR freshness. Comment, review, and CI
webhooks trigger a focused fresh read before updating handoff, request-change,
CI, and testing attention, instead of trusting a single webhook payload as the
final workflow state. Other signed events are acknowledged as ignored before
they enter the queue, and ignored deliveries are still counted for operational
visibility. Accepted deliveries store the delivery ID and raw payload before
acknowledgement.
Duplicate deliveries are ignored and counted for operational visibility. The
worker processes stored issue and pull request deliveries asynchronously into
the MatrixOne cache.
Malformed payloads for supported webhook events are marked as
`failed_normalization`; the raw payload stays stored on the delivery row for
inspection, and the dashboard counts them with webhook failures. Logged-in
operators can retry failed webhook deliveries from the dashboard; retrying moves
failed deliveries back to the received queue and immediately schedules webhook,
rules, metrics, AI drift, and notification worker jobs.

The current implementation covers read-only cached observability for repo-wide
critical issues, watched-user summaries, pending PRs, workflow violations, AI
drift signals, testing queue state, cached analytics, owner attribution, and
data freshness indicators.

Committed repository profiles are safe templates. Put real watched users,
tester identities, workflow skip users, employee mappings, and local checkout
paths in an untracked sibling profile such as
`config/repos/matrixone.local.yaml`; it is merged automatically over
`config/repos/matrixone.yaml` at startup. Start from
`config/repos/matrixone.local.example.yaml` and keep `MO_DEVFLOW_PROFILE`
pointing at the committed base profile unless you intentionally want a
different repo.

When watched users, testing handoff, or notification employee mappings are not
configured, the dashboard surfaces profile setup actions plus one merged YAML
setup patch. The patch is derived from cached owners, requested reviewers, and
active notification candidates so maintainers can review a single profile
change instead of piecing together separate snippets.

Issue comment backfill is available for workflow rules that need comment
evidence. Deferred issues only raise a missing-explanation violation after the
comment sync for that issue is complete; partial comment evidence suppresses the
rule instead of producing a misleading alert. Anonymous GitHub sync does not
fetch comments by default; configure a service read token or set bounded
backfill limits before relying on comment-backed workflow checks.

Production readiness shows the current PR/issue evidence path without exposing
token values. `MO_DEVFLOW_GITHUB_TOKEN`, `GITHUB_TOKEN`, or `GH_TOKEN` enables a
service read token; only its presence is returned to the UI. PR detail, issue
comment, and issue timeline backfill default to `25/25/25` with a service token
and `0/0/0` anonymously. Override them with
`MO_DEVFLOW_PR_BACKFILL_MAX_ITEMS`, `MO_DEVFLOW_COMMENT_BACKFILL_MAX_ITEMS`, and
`MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS`.

Testing handoff is issue-scoped. Configure tester identities under
`people.testers`, and optionally configure issue labels under
`testing.handoff_signals.labels`. PR reviewer, PR assignee, PR label, and PR
comment evidence can refresh PR activity context, but it does not move work into
the testing queue.

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
