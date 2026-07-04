# mo-devflow Technical Design

## 1. Stack Decision

Use TypeScript across the product.

- Frontend: React, TypeScript, Vite.
- API server: Node.js, TypeScript, Fastify.
- Worker: Node.js, TypeScript.
- Database access: `mysql2` plus Kysely.
- GitHub integration: Octokit.
- Validation: Zod.
- Charts: ECharts.
- UI components: Ant Design.
- Repository configuration: YAML or JSON profile files.

This keeps frontend, backend, worker jobs, GitHub data models, and workflow rules in one language while still separating runtime responsibilities.

## 2. Runtime Components

### 2.1 Web App

The web app renders:

- Overall dashboard.
- Critical issues view.
- Personal views.
- PR flow view.
- Testing flow view.
- Workflow violations.
- AI estimate drift.
- Login and GitHub token binding.

The web app reads from the API. It should not call GitHub directly.

### 2.2 API Server

The API server owns:

- User sessions.
- GitHub token binding.
- Read APIs for cached data.
- Write previews.
- Confirmed GitHub write operations using the logged-in user's token.
- Webhook endpoint.
- Manual refresh requests.

### 2.3 Worker

The worker owns:

- Initial repository sync.
- Periodic polling.
- Webhook event processing.
- GitHub timeline backfill.
- Metric aggregation.
- Workflow violation calculation.
- AI estimate drift calculation.
- Attention item generation.
- Notification scheduling and delivery.

The worker should be horizontally replaceable later, but the MVP can run one worker process.

## 3. Database

Use the existing MatrixOne deployment through the MySQL protocol.

Observed local deployment:

- Host: `127.0.0.1`
- Port: `6001`
- Version checked locally: `8.0.30-MatrixOne-v4.0.0-rc4`

Use a dedicated database for this product:

```sql
CREATE DATABASE IF NOT EXISTS mo_devflow;
```

Development may connect with an existing local admin user, but application configuration must use environment variables and must not commit real credentials.

Recommended env names:

```text
MO_DEVFLOW_DB_HOST=127.0.0.1
MO_DEVFLOW_DB_PORT=6001
MO_DEVFLOW_DB_USER=mo_devflow
MO_DEVFLOW_DB_PASSWORD=
MO_DEVFLOW_DB_NAME=mo_devflow
```

For local development, create a dedicated MatrixOne user once the schema is ready. The user should only have permissions on `mo_devflow`.

## 4. Database Approach

Use explicit SQL migrations and a typed query builder instead of a heavyweight ORM in the first version.

Reasons:

- MatrixOne is MySQL-compatible, but the MVP should avoid depending on advanced ORM migration behavior.
- GitHub data changes shape over time, so raw payload retention is useful.
- Metrics queries need to be explicit and tuned.
- Workflow checks benefit from predictable relational tables.

Guidelines:

- Store normalized columns for frequently queried fields.
- Store raw GitHub payloads for audit and repair.
- Avoid relying on database-enforced foreign keys in the MVP.
- Use application-level integrity checks where needed.
- Index fields used by dashboards and sync cursors.
- Record source authentication scope and visibility class on cached GitHub objects.
- Record whether a cached object is complete or partial.

## 4.1 Cache Visibility

Cache visibility must be enforced at API query time.

Recommended visibility classes:

- `anonymous_readable`: visible to anonymous and logged-in users.
- `logged_in_readable`: visible to logged-in users.
- `token_owner_only`: visible only to the user whose token fetched the data.
- `admin_only`: visible only to configured maintainers or operators.

Every cached GitHub object should carry:

- `source_auth_type`: anonymous, service_read_token, or user_token.
- `source_user_id`, when fetched with a user token.
- `visibility_class`.
- `last_synced_at`.
- `source_updated_at`.
- `is_complete`.
- `sync_error`.

Data fetched with a user's token should default to `token_owner_only` unless the repo profile explicitly allows it to be promoted to a broader visibility class.

## 5. Proposed Monorepo Layout

```text
apps/
  web/        React + Vite dashboard
  api/        Fastify API server
  worker/     GitHub sync, webhook processing, metrics aggregation

packages/
  db/         MatrixOne schema, migrations, queries
  github/     Octokit clients, polling, webhook normalization
  rules/      Repo profiles and workflow violation checks
  metrics/    Aggregation logic
  notifications/ Enterprise WeChat and future notification channels
  shared/     Shared TypeScript types and Zod schemas
```

## 6. MatrixOne Repository Context

The local MatrixOne source tree is available at:

```text
/Users/xupeng/github/matrixone
```

This should be treated as optional enrichment context, not as a runtime dependency.

Possible uses:

- Read repo-specific workflow rules.
- Inspect CODEOWNERS or source ownership hints.
- Map PR touched files to subsystems.
- Associate changed SQL behavior with BVT case areas.
- Improve issue and PR domain classification.
- Provide better evidence for AI estimate drift.

Known local workflow-rule source:

```text
/Users/xupeng/github/matrixone/.claude/skills/mo-bug-triage/SKILL.md
```

Known BVT-related local files:

```text
/Users/xupeng/github/matrixone/optools/run_bvt.sh
/Users/xupeng/github/matrixone/optools/bvt_ut
/Users/xupeng/github/matrixone/optools/compose_bvt
/Users/xupeng/github/matrixone/test/distributed/cases
```

The product should allow a repo profile to point at a local source checkout, but dashboards must still work when that path is absent.

## 7. Data Ingestion

The MVP should start with active polling and keep the webhook path ready.

Polling covers:

- Initial sync.
- Periodic refresh.
- Manual refresh.
- Missed webhook repair.

Webhook covers:

- Issue changes.
- PR changes.
- Review changes.
- Comment changes.
- Label changes.
- Workflow run status changes.

All GitHub data should be normalized into internal tables before dashboards consume it.

## 8. Sync Model

Use these sync layers:

- Repository sync: repo metadata and labels.
- Issue sync: issue state, labels, assignees, comments metadata, timeline events.
- PR sync: PR state, reviewers, reviews, commits summary, mergeability, linked issues.
- CI sync: workflow runs and check conclusions.
- Metrics sync: daily, weekly, monthly aggregates.
- Rules sync: workflow violations and AI estimate drift.

Each sync should record:

- Last successful run.
- Last attempted run.
- Cursor or updated-at watermark.
- Error message, if failed.
- Source token type: anonymous, service read token, or user token.

Sync must be idempotent.

Webhook handling:

- Require `MO_DEVFLOW_GITHUB_WEBHOOK_SECRET` before accepting GitHub webhook deliveries.
- Verify `X-Hub-Signature-256` against the exact raw request body.
- Require `repository.full_name` in the webhook payload and ignore deliveries for any repo other than the active profile.
- Accept only events with implemented cache ingestion at the API boundary; MVP ingestion supports `issues`, `pull_request`, and `pull_request_review`.
- Process `pull_request_review` by refreshing current PR insight from GitHub before updating review/testing attention state.
- Record signed ignored deliveries with `status = ignored` for dashboard health, but do not put them in the worker processing queue.
- Persist each GitHub delivery ID before processing.
- Ignore duplicate delivery IDs.
- Store raw webhook payloads for replay.
- Acknowledge only after the event is durably recorded.
- Process webhook payloads through the same normalization path as polling.

Polling:

- Use updated-at watermarks for incremental sync where possible.
- Use periodic full or wide-window repair syncs to catch missed events.
- Track seen issue and PR numbers during paginated reads to avoid duplicate processing.
- Treat GitHub pagination races as expected; repair with later incremental sync.
- Enrich open PRs with review decision, latest review, latest commit, CI state, and mergeability.
- Keep PR enrichment bounded by `MO_DEVFLOW_PR_DETAIL_MAX_ITEMS`; default anonymous enrichment is off because GitHub anonymous REST quota is only 60 requests/hour.
- For production-quality request-change, CI-failure, and merge-conflict attention rules, configure a service read token or authenticated sync path.

Rate limiting:

- Record GitHub rate limit headers for every request.
- Back off when remaining requests are low.
- Prefer conditional requests and targeted refreshes where possible.
- Separate high-priority critical issue refresh from lower-priority historical backfill.

Worker reliability:

- Use a database-backed job table for MVP scheduling.
- Each job should have status, attempts, next run time, lease owner, lease expiry, and last error.
- A worker must only execute a job after acquiring a lease.
- Expired leases should be recoverable by another worker.
- Job handlers should be safe to retry.

Backfill:

- Timeline and review backfill should be resumable by object.
- Backfill jobs should mark partial objects until all required pages are fetched.
- Dashboards should avoid treating partial objects as complete evidence.
- Rule evaluation should be runnable from cached normalized data without hitting GitHub. This supports rule tuning, notification replay, and degraded operation during GitHub rate limits.
- Metrics evaluation should also be runnable from cached normalized data. Until full historical backfill exists, generated trend points must carry partial-cache completeness metadata and the UI must explain the limitation.
- AI drift evaluation should start from conservative cache-derived signals, such as missing AI effort labels on critical issues and `ai-easy` critical issues exceeding configured age thresholds. Until severity-promotion timestamps, linked PRs, and testing handoff events are backfilled, these signals must be marked as partial evidence.

## 9. Authentication and Token Handling

Anonymous users can only read cached data.

Logged-in users bind their own GitHub token. The token is used for:

- Private or higher-rate reads allowed by that token.
- Confirmed writes to GitHub.

Token requirements:

- Store encrypted at rest.
- Never expose to frontend after submission.
- Never log raw token values.
- Track which user initiated every write.
- Show write previews before execution.
- Validate token scopes or capabilities before enabling write actions.
- Detect revoked or expired tokens and show a reconnect flow.
- Store only the minimum metadata needed for UX: GitHub login, token last validated time, and visible scopes or capability checks.
- Keep encryption keys in environment or secret management, not in the database.
- Support encryption key rotation later by storing key version metadata with encrypted tokens.

## 10. Write Operations

The MVP can support write operations only after the read-only dashboards are stable.

Write flow:

1. User selects a suggested action.
2. API builds a preview from cached current state plus a fresh GitHub check when appropriate.
3. UI shows labels, comments, assignees, and state changes.
4. User confirms.
5. API executes through the user's GitHub token.
6. Worker resyncs the affected issue or PR.
7. Audit log records the operation and result.

The API should reject or re-preview a write when the fresh GitHub state no longer matches the preview assumptions. This prevents applying stale label or comment changes after another maintainer has already updated the issue or PR.

Potential actions:

- Add `needs-triage`.
- Move issue to `deferred`.
- Add deferred explanation comment.
- Update severity labels.
- Update AI effort labels.
- Assign or unassign users.
- Comment on issue or PR.

## 11. Configuration Model

A repository profile should define behavior without code changes.

Example shape:

```yaml
repo:
  owner: matrixorigin
  name: matrixone
  local_path: /Users/xupeng/github/matrixone

reporting:
  timezone: Asia/Shanghai
  week_start: Monday

access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide

people:
  watched_users: []
  testers: []

ownership:
  issue_owner_priority:
    - assignee
    - linked_pr_author
    - author
  pr_owner: author
  unowned_bucket: true

notifications:
  wecom:
    enabled: false
    webhook_url_env: MO_DEVFLOW_WECOM_WEBHOOK_URL
    quiet_hours:
      start: "22:00"
      end: "09:00"
  employees:
    github-login:
      wecom_user_id: employee-id
  routing:
    critical_issue_stalled:
      channel: wecom
      recipient: owner
      cooldown_hours: 12
      fallback_recipient: maintainer_group
      escalate_after_hours: 24
    daily_digest:
      channel: wecom
      recipient: maintainer_group
      schedule: "0 9 * * 1-5"

labels:
  bug: kind/bug
  needs_triage: needs-triage
  deferred: deferred
  critical:
    - severity/s-1
    - severity/s0
  active:
    - severity/s-1
    - severity/s0
    - severity/s1
  ai_effort:
    - ai-easy
    - ai-light
    - ai-medium
    - ai-heavy
    - ai-manual

thresholds:
  pr_no_action_attention_hours: 24
  critical_no_action_attention_hours: 24
  ai_easy_s0_to_test_attention_days: 7

testing:
  handoff_signals:
    labels: []
    reviewer_users: []
    assignee_users: []
    comments: []
  states:
    not_ready: {}
    dev_done: {}
    test_requested: {}
    testing: {}
    test_changes_requested: {}
    test_passed: {}
    closed_or_merged: {}
```

## 12. Derived State and Metrics

Dashboards should read derived state from the database instead of recalculating everything in the browser.

Derived state should include:

- Issue lifecycle state.
- Issue owner attribution.
- Critical issue age and last human action.
- PR owner.
- PR age.
- PR `last_human_action_at`.
- PR `last_system_action_at`.
- PR attention flags.
- Testing flow state.
- AI estimate drift status.
- Workflow violations.
- Attention items.

Owner derivation should follow the repo profile and write the reason for attribution, for example `assignee`, `linked_pr_author`, or `author`.

Action derivation should classify events as:

- Human owner action.
- Human reviewer action.
- Human maintainer action.
- System action.
- Bot action.

PR stale detection should use `last_human_action_at` by default. System-only events should not clear human stale alerts.

Testing state derivation should be event-sourced from normalized PR timeline facts. State transitions should be persisted with the trigger event so ambiguous or incorrect handoff rules can be debugged.

## 13. Development Environment

Use `/Users/xupeng/github/astra` as a reference for local development ergonomics, especially:

- Root `Makefile` as the main developer entry point.
- `.env.example` copied to `.env` by `make setup` or `make dev-init`.
- Separate `dev-start`, `dev-stop`, `dev-status`, and `dev-clean` commands.
- Separate API, web, and worker start/stop/log/status commands.
- `dev-db-connect` command for MatrixOne CLI access.
- Health checks before reporting a service as started.
- PID files and log files for local long-running services.
- Docker compose deployment structure under `deployment/all-in-one`.
- Explicit `check`, `test`, `format`, `format-check`, and `ci` targets.

Recommended MVP Make targets:

```text
make help
make setup
make dev-init
make dev-start
make dev-stop
make dev-status
make dev-api-start
make dev-api-stop
make dev-api-logs
make dev-web-start
make dev-web-stop
make dev-web-logs
make dev-worker-start
make dev-worker-stop
make dev-worker-logs
make dev-db-connect
make db-create
make db-migrate
make sync-once
make check
make test
make ci
```

The MVP can use the already-running local MatrixOne instead of starting a MatrixOne container. Compose support can be added later for a fully isolated stack.

## 14. Notification System

Notifications should be driven by normalized events, scheduled jobs, and rule outputs.

Do not send notifications directly from raw GitHub webhook handlers. Webhooks and polling should first update cached state, then rule evaluation should produce stable attention items. The notification worker then decides whether to send, suppress, or aggregate them.

Notification pipeline:

1. GitHub webhook or polling updates cached issue, PR, CI, review, and timeline data.
2. Rule engine evaluates workflow violations, PR attention flags, testing stalls, and AI estimate drift.
3. Rule engine writes attention items with stable deduplication keys.
4. Notification scheduler selects eligible attention items or digest windows.
5. Notification channel adapter sends enterprise WeChat messages.
6. Delivery result is written to notification logs.
7. Dashboard shows notification and acknowledgement state.

Suggested tables:

- `attention_items`: stable rule output requiring user or team attention.
- `notification_rules`: channel, routing, quiet hours, cooldown, and severity policy.
- `notification_deliveries`: send attempts, delivery status, provider response, and retry data.
- `employee_mappings`: GitHub login to enterprise WeChat user ID.
- `notification_acknowledgements`: acknowledgement source and time.

Attention item fields:

- Repo ID.
- Object type: issue, PR, CI run, testing handoff, or aggregate digest.
- Object number or external ID.
- Rule key.
- Severity.
- Related GitHub login.
- Target recipient.
- Deduplication key.
- First detected time.
- Last detected time.
- Resolved time.
- Evidence summary.
- Dashboard URL.

Enterprise WeChat channel:

- Keep provider credentials in environment variables.
- Support per-user notifications through configured employee mappings.
- Support maintainer group or bot webhook routing for summaries.
- Apply cooldown per deduplication key to avoid repeated alerts.
- Respect quiet hours unless the notification is explicitly critical.
- Store provider responses for debugging, with sensitive data redacted.
- Route to the configured fallback recipient when employee mapping is missing.
- Retry transient delivery failures with backoff.
- Mark permanent delivery failures and expose them in the dashboard.
- Escalate unacknowledged critical attention items after the configured threshold.
- Stop sending reminders once the underlying attention item is resolved.

Initial notification rules:

- Active `s0` or `s-1` issue has no recent action.
- Pending PR has no meaningful action for more than one day.
- PR has unresolved requested changes.
- PR has failed CI.
- PR has merge conflict.
- Testing handoff is stale.
- `ai-easy` critical issue exceeds expected `s0` to testing duration.
- Daily watched-user digest.
- Daily maintainer digest.

## 15. Operational Health and Error Handling

The product should expose its own operational health.

Required health surfaces:

- API health endpoint.
- Worker heartbeat.
- Last successful sync per repo and sync layer.
- Last failed sync per repo and sync layer.
- Current GitHub rate limit status.
- Number of stale cached objects.
- Number of partial cached objects.
- Notification delivery failures.
- Job queue depth and oldest pending job age.

Dashboard behavior:

- Show stale banners when key sync layers are behind.
- Show partial-data warnings when timeline or review backfill is incomplete.
- Keep serving cached data when GitHub is temporarily unavailable.
- Avoid presenting stale or partial data as confirmed evidence in workflow violations.

Error handling rules:

- Retriable GitHub errors should use exponential backoff.
- Non-retriable permission errors should mark the affected sync as blocked until credentials change.
- Rate-limit errors should pause lower-priority backfill before critical issue refresh.
- Parsing errors should store the raw payload and mark the object as failed-normalization for inspection.
- Notification errors should not block GitHub sync or dashboard reads.

## 16. First Implementation Slice

The first implementation should map to Product MVP0: read-only critical flow.

1. Monorepo setup.
2. MatrixOne connection config.
3. Migration runner.
4. Dedicated `mo_devflow` schema.
5. Repo profile loader.
6. Makefile and local scripts following the Astra-style developer workflow.
7. GitHub polling for issues and PRs.
8. Cached issue and PR tables with visibility metadata.
9. Job table with leases for polling and derived-state work.
10. Owner attribution and action derivation.
11. Critical issues API.
12. Personal summary API.
13. Basic PR attention rules using `last_human_action_at`.
14. Basic React dashboard.
15. Data freshness and partial-data indicators.

After that, add:

- Advanced PR attention rules.
- Testing flow metrics.
- Workflow violations.
- AI estimate drift.
- Enterprise WeChat notification channel.
- Login and token binding.
- Confirmed write actions.
