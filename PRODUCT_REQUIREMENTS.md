# mo-devflow Product Requirements

## 1. Product Positioning

mo-devflow is a GitHub development workflow observability and action-assist platform for a configured repository.

The first target profile is MatrixOne, but the product must not be hardcoded to MatrixOne. A repository profile should define watched users, workflow labels, lifecycle rules, tester roles, and repo-specific checks.

The product helps maintainers and developers answer:

- Which active `s-1/s0` issues exist right now?
- Who owns the active `s0` and `s-1` work?
- Which issues and PRs are stuck?
- Which workflow rules are being violated?
- How efficient is issue and PR turnover at team and individual level?
- Are AI effort labels aligned with actual delivery cost?

## 2. User Roles

### 2.1 Anonymous Viewer

Anonymous users can only observe cached data.

They can view:

- Repository health dashboards.
- Cached issue, PR, CI, and workflow statistics.
- Workflow violation lists.
- Team and watched-user summaries, based on available cached data.

They cannot:

- Modify GitHub issues or PRs.
- Add comments or labels.
- Assign, close, reopen, or merge items.
- Trigger privileged refreshes that require private access.
- View data that the platform has not cached or is not allowed to expose.

### 2.2 Logged-in User

Logged-in users connect their own GitHub token.

They can:

- Access GitHub data allowed by their token.
- Execute GitHub operations as their own GitHub identity.
- Update labels, comments, assignees, and issue or PR states when permitted.
- Apply workflow-fix actions after preview and confirmation.

Key rule: all writes must use the user's own GitHub token. The platform should not perform write operations through a shared service account unless explicitly introduced later.

A single deployment should support many team members connecting independently. Token binding is determined by the validated GitHub identity, not by a manually selected person. The current browser session decides which GitHub user is acting. Signing out clears only that browser session; removing a saved token revokes the stored token for that GitHub user and disables writes until they reconnect.

### 2.3 Maintainer / Team Lead

Maintainers need an overall view of workflow health:

- Active `severity/s0` and `severity/s-1` issues.
- Owner distribution.
- Pending PR risk.
- Workflow violations.
- Team trends by day, week, and month.
- Tester handoff efficiency.
- AI estimate drift.

### 2.4 Developer / Watched User

Developers need an action-oriented personal view:

- Their active `s-1/s0` issues.
- Their `needs-triage` and `deferred` issues.
- Their PRs created yesterday.
- Their PRs merged yesterday.
- Their pending PRs and PR age.
- PRs requiring attention due to no action, requested changes, CI failure, or conflict.
- Issues in testing, with linked PR evidence and blockers.

### 2.5 Tester

Testers are a special configured role.

The product should track issues assigned to configured testers and measure:

- Issue testing queue age.
- Issue testing handoff to issue close time.
- If the repo later defines an explicit test-pass signal, split the above into handoff-to-pass and pass-to-close time.
- Linked PR blockers while an issue is in testing.
- Pending testing workload per tester.
- Testing turnover efficiency.

### 2.6 Access and Data Visibility

The product must separate data visibility from data ingestion.

Anonymous users can only view cached data that the repository profile marks as anonymous-readable. Data fetched with a logged-in user's GitHub token must not automatically become visible to anonymous users.

The user experience should make data freshness and access scope clear:

- Every dashboard should show last synced time.
- Stale data should be visibly marked.
- If a view is partial because the current user lacks access, the UI should say so.
- Private or token-scoped data should only be visible to users whose token allows access.
- Write actions should be hidden or disabled when the user is not logged in or lacks the required GitHub permission.

## 3. Repository Profile

The product must support repository-specific configuration.

A repo profile should include:

- GitHub owner and repo, for example `matrixorigin/matrixone`.
- Timezone and reporting calendar.
- Data visibility policy.
- Watched users.
- Tester users.
- Owner attribution rules.
- Active `s-1/s0` issue scope.
- Notification recipients and GitHub-user to employee mappings.
- Lifecycle labels.
- Severity labels.
- AI effort labels.
- Workflow rules.
- Skip lists.
- Time thresholds.
- Handoff signals.
- Whether write-back is enabled.

Example concepts:

```yaml
repo: matrixorigin/matrixone
timezone: Asia/Shanghai
week_start: Monday
visibility:
  anonymous_read: true
  expose_user_token_synced_private_data: false
critical_scope: repo-wide
watched_users:
  - developer-a
  - developer-b
testers:
  - tester-a
  - tester-b
ownership:
  issue_owner_priority:
    - assignee
    - linked_pr_author
    - author
  pr_owner: author
  unowned_bucket: true
notifications:
  employees:
    developer-a:
      wecom_user_id: zhangsan
    tester-a:
      wecom_user_id: lisi
  channels:
    critical: wecom
    daily_digest: wecom
  fallback:
    missing_employee_mapping: maintainer_group
  escalation:
    unacknowledged_after: 1d
labels:
  needs_triage: needs-triage
  deferred: deferred
  critical:
    - severity/s-1
    - severity/s0
ai_effort:
  - ai-easy
  - ai-light
  - ai-medium
  - ai-heavy
  - ai-manual
thresholds:
  pr_no_action_attention: 1d
  critical_no_action_attention: 1d
  ai_easy_s0_to_test_attention: 7d
workflow:
  skip_users:
    - bot-or-maintenance-user
```

## 4. Data Sync and Cache

The product must cache GitHub data in a database.

GitHub should not be queried repeatedly for every page load. Pages should read from local cached data and show the last updated time.

Production deployments should configure a service read token during startup for repository-wide read-only polling and evidence backfill. This token is deployment configuration, not a leader's browser Connect session. It must be used only as a read source and recorded as `service_read_token` evidence. Personal Connect tokens remain per-user and are used for user-scoped reads and confirmed writes.

Supported data ingestion modes:

- Webhook ingestion for near-real-time updates, enabled only when the GitHub webhook secret is configured.
- Active polling for initial sync, periodic refresh, missed-event repair, and manual refresh.
- Manual refresh should allow logged-in users to queue only the sync layers they need, instead of forcing a full refresh every time.

Cached objects should cover at least:

- Issues.
- Pull requests.
- Labels.
- Assignees.
- Reviewers.
- Reviews.
- Comments or comment metadata needed for workflow checks.
- CI and workflow runs.
- Timeline events needed for age and turnover calculations.

Each cached object should record:

- Source repository.
- Source authentication scope: anonymous, service read token, or user token.
- Visibility class: anonymous-readable, logged-in-readable, or token-owner-only.
- Last synced time.
- Source updated time.
- Whether the cached data is complete or partial.

When a sync fails, the dashboard should continue showing the latest successful cache but mark the affected data as stale or partial.

## 5. Core Workflow Rules

### 5.1 Intake Standardization

New bug issues should enter `needs-triage` first.

`needs-triage` is a candidate pool. It does not mean the team has committed to priority or immediate execution.

The product should detect:

- New `kind/bug` issues missing `needs-triage`.
- New issues prematurely labeled as `severity/s0`, `severity/s1`, or `severity/s-1`.
- Old `needs-triage` issues that are not being drained.

### 5.2 Active s-1/s0 Execution

The product should prioritize visibility for active `severity/s0` and `severity/s-1` issues.

`severity/s-1` and `severity/s0` are active execution severities, not lifecycle states. `severity/s-1` is the highest and most severe priority, followed by `severity/s0`.

Active `s-1/s0` issues are repo-wide by default. They must not be limited to watched users. Issues owned by non-watched users and issues without owners should still appear in the active `s-1/s0` view.

The active `s-1/s0` issue view should show:

- Issue number and title.
- Severity.
- Owner.
- Current lifecycle state.
- Age since severity promotion.
- Linked PRs.
- PR and testing state.
- AI effort label.
- Current blockers.
- Last meaningful action time.

Owner grouping should include:

- Watched owner.
- Non-watched owner.
- Unowned.
- Multiple owners.

Only confirmed urgent or broad-impact issues should remain active as `s0` or `s-1`.

### 5.3 Downgrade to Deferred

If an analyzed issue should not continue as active `s0` or `s1` work, it should be moved to `deferred` immediately.

The deferred transition must have a clear comment explaining why.

Common reasons include:

- Reproduction is unstable.
- Required dependency or information is missing.
- The issue is not on a critical path.
- The issue should be consolidated into an existing issue.
- No current owner or near-term plan exists.

The product should detect:

- Deferred issues missing explanation comments.
- Active issues that appear to lack owner, evidence, or progress.
- Issues with conflicting lifecycle labels.

Deferred-comment checks must only be treated as confirmed when issue comments have been backfilled completely. If comments are partial or unavailable, the UI and rules should avoid presenting missing-comment conclusions as facts.

### 5.4 AI Effort Labels

AI effort labels estimate implementation cost and expected human involvement.

Supported labels:

- `ai-easy`
- `ai-light`
- `ai-medium`
- `ai-heavy`
- `ai-manual`

AI labels should be treated as dynamic estimates:

- Initial issue labeling can be a rough estimate.
- Before PR close or merge, the label should be reviewed against actual implementation, review, test, and debugging effort.

The product should identify drift between initial AI estimate and actual delivery cost.

Example anomaly:

- An `ai-easy` issue becomes `severity/s0`, then takes a week to reach testing. This is abnormal and should be highlighted.

### 5.5 Ownership Attribution

Personal statistics require deterministic ownership rules.

Issue owner attribution should follow the repository profile. The default priority is:

1. Current assignee.
2. Author of linked active PR.
3. Issue author.

If no owner can be derived, the issue must be counted in an `unowned` bucket.

PR owner attribution defaults to PR author.

If multiple owners exist, the UI should show all related users but avoid double-counting in aggregate totals. Personal views can show the same shared item for each related person, while team totals should count the item once.

Owner attribution should be visible in the UI so users understand why an item appears in their view.

### 5.6 Skip Lists

Repository profiles can define workflow skip users. Items authored by, owned by, or assigned to these users should remain visible in cached dashboards when otherwise allowed by access policy, but they should not produce automated workflow violations, AI drift signals, attention notifications, or configuration suggestions.

Repository-specific skip users must be provided through local repo profile configuration, not hard-coded in product documentation.

## 6. Overall View

The overall view should answer:

- How many active `s0` and `s-1` issues exist?
- Who owns them?
- How old are they?
- Which ones have no recent action?
- How many PRs were created yesterday?
- How many PRs were merged yesterday?
- How many PRs are pending?
- Which PRs need attention?
- Which workflow violations are most important?
- What changed compared to yesterday, last week, or last month?

Required sections:

- Active `s-1/s0` issues summary.
- Watched-user workload summary.
- PR flow summary.
- Testing flow summary.
- Workflow violations.
- AI estimate drift.
- Daily, weekly, and monthly trend charts.

## 7. Personal View

Each watched user should have a personal view.

The personal view should show:

- Current `severity/s0` and `severity/s-1` issues owned by the user.
- User's `needs-triage` issues, excluding issues already labeled `s0`, `s-1`, or `deferred`.
- User's `deferred` issues.
- PRs created yesterday.
- PRs merged yesterday.
- Pending PRs.
- PR age.
- PRs with no action for more than one day.
- PRs with requested changes.
- PRs with failed CI.
- PRs with merge conflict.
- Issues in testing and the user's linked PR evidence.
- Personal issue and PR turnover trends by day, week, and month.

The personal view should be an action list, not a performance ranking page.

## 8. PR Attention Rules

Pending PRs should be highlighted when they need attention.

Attention conditions:

- No meaningful action for more than one day.
- Review requested but no response.
- Requested changes are unresolved.
- CI failed.
- Merge conflict exists.
- PR is old relative to expected AI effort.
- PR is linked to active `s0` or `s-1` issue and has stalled.
- PR is linked to an issue in testing that has not progressed.

Meaningful action can include:

- Human action: new commit pushed, review submitted, meaningful comment added, assignee changed, reviewer changed, PR merged, or PR closed.
- Owner action: a human action performed by the PR author, assignee, or linked issue owner.
- Reviewer action: a review, requested-change resolution, or review comment from a reviewer.
- System action: CI status changed, automation label changed, bot comment added, or mergeability recalculated.

The default "no action for more than one day" attention rule should use `last_human_action_at`, not `last_system_action_at`. System actions may be displayed, but they should not hide a stale human workflow.

## 9. Testing Flow

The product must support a configured testing handoff workflow.

Testing handoff is issue-scoped. The repo profile must define how an issue enters the testing queue. Supported handoff signals are:

- The issue is assigned to a configured tester from `people.testers`.
- The issue has a configured testing label from `testing.handoff_signals.labels`.

PR reviewer requests, PR assignees, PR labels, PR comments, and PR project fields must not create testing handoff state. Human PR comments may still update PR activity context, but they do not move an issue into testing.

The testing flow should be modeled around the issue queue:

- `not_ready`: no configured issue testing handoff is visible.
- `testing`: an issue is assigned to a configured tester or has a configured issue testing label.
- `test_changes_requested`: testing found issues and returned the work to development.
- `test_passed`: tester confirmed the issue can close or linked PRs can merge.
- `closed_or_merged`: the issue is closed or linked PRs are merged after validation.

Linked PRs inherit testing context from their linked issues. They should display CI, review, merge, and age blockers as execution evidence, not as handoff authority.

The product should handle:

- Repeated issue test handoffs.
- Test failure and return to development.
- Issue reopen after close.
- Tester reassignment.
- Multiple testers.
- Missing or ambiguous handoff signal.

Testing flow metrics:

- Issue testing handoff to issue close time from cached issue timeline and close evidence.
- If an explicit test-pass signal is configured later, handoff-to-pass and pass-to-close should be measured separately.
- Current testing queue by tester.
- Testing queue age.
- Testing turnover trend by day, week, and month.

## 10. Team and Individual Analytics

The product should support day, week, and month analysis.

All date-based metrics should use the repository profile timezone. For MatrixOne, the default is `Asia/Shanghai`.

Definitions:

- "Yesterday" means the previous calendar day in the repo timezone.
- "Day" means a calendar day in the repo timezone.
- "Week" starts on the configured `week_start`.
- "Month" means a calendar month in the repo timezone.
- If workday or holiday logic is added later, it should be explicit in the repo profile.

Team metrics:

- PRs created.
- PRs merged.
- Issues opened.
- Issues closed.
- Issues deferred.
- Active `s0` and `s-1` count.
- `needs-triage` count and age.
- Pending PR count and age.
- Review latency.
- CI failure rate.
- Development to testing turnover.
- Testing to close turnover.
- AI estimate drift.

Individual metrics:

- Active `s-1/s0` issue count.
- `needs-triage` count.
- `deferred` count.
- PRs created.
- PRs merged.
- Pending PRs.
- Average pending PR age.
- Average issue turnover time.
- Development to testing handoff time.
- Attention PR count.

## 11. AI Estimate Drift

The product should compare AI effort labels with actual workflow duration and activity.

Track for each issue or PR:

- AI effort label.
- Severity.
- Owner.
- Time when issue became `s0` or `s-1`.
- PR opened time.
- Development complete time.
- Testing handoff time.
- Test pass time.
- Close or merge time.
- Number of commits.
- Number of review rounds.
- Number of requested-change events.
- CI failure count.
- Actual elapsed time.
- Drift status.

Expected duration thresholds should come from the repository profile. The first version can use simple thresholds by AI effort label and severity rather than a learned model.

Example drift checks:

- `ai-easy` with long `s0` to testing duration.
- `ai-easy` with repeated requested changes.
- `ai-easy` with repeated CI failures.
- `ai-manual` completed unusually fast.
- Any AI label that was not reviewed before PR close or merge.

## 12. Workflow Violations

The product should provide a dedicated workflow violations view.

Each violation should include:

- Object type: issue, PR, CI run, or workflow state.
- Object link.
- Violated rule.
- Related user.
- Severity of violation.
- Evidence.
- Suggested action.
- Whether it can be fixed by a logged-in user.
- Whether a notification has been sent and acknowledged.

MatrixOne profile examples:

- Bug issue missing `needs-triage`.
- New bug prematurely labeled as active severity.
- `s0` or `s-1` without clear owner.
- Active `s-1/s0` issue with no recent action.
- Deferred issue missing explanation comment.
- Issue with conflicting lifecycle labels.
- PR linked to active `s-1/s0` issue but stalled.
- PR has failed CI.
- PR has unresolved requested changes.
- PR has merge conflict.
- Issue in testing but not progressing.
- AI effort label appears stale or inaccurate.

## 13. Notifications

The product should support notifications driven by both events and scheduled jobs.

The first notification channel should be enterprise WeChat, configured per repository profile.

Notifications should be sent to corresponding employees when an event or rule result requires attention.

Notification examples:

- A user's active `s0` or `s-1` issue has no recent action.
- A user's PR has been pending for more than one day without meaningful action.
- A user's PR has unresolved requested changes.
- A user's PR has failed CI.
- A user's PR has merge conflict.
- A tester has an issue waiting in the testing queue beyond the configured threshold.
- An `ai-easy` active `s-1/s0` issue has taken abnormally long to reach testing.
- A daily or weekly summary should be delivered to a maintainer group.

Notifications must be controlled by policy:

- Do not notify for every raw GitHub event.
- Notify only after data is cached and a rule has produced a stable attention item.
- Deduplicate repeated alerts for the same issue or PR.
- Support quiet hours.
- Support per-rule severity.
- Support per-user routing.
- Support team or maintainer group routing for overall summaries.
- Use a maintainer fallback when the responsible user has no enterprise WeChat mapping.
- Show notification readiness, including channel enablement, webhook configuration, mapped employees, missing mappings, and fallback routing.
- Escalate unresolved or unacknowledged critical attention items after the configured threshold.
- Resolve or suppress notifications automatically when the underlying attention item is no longer true.
- Record repeated delivery failures and show them on the dashboard.
- Distinguish transient delivery failures that should retry with backoff from permanent delivery failures that need configuration or operator action.
- Let authenticated users request an immediate retry for the latest failed delivery without sending directly from the browser request.
- Record notification delivery state.
- Record acknowledgement state when supported by the channel or by the product UI.

Notification types:

- Immediate attention notification: for critical stuck work and urgent workflow violations.
- Daily digest: per watched user and maintainer summary.
- Weekly digest: trend and turnover analysis.
- Monthly digest: team and personal efficiency trends.

The product should always keep the dashboard as the source of truth. Notifications should link back to the corresponding dashboard item.

## 14. Write Operations

Write operations are available only to logged-in users with a connected GitHub token.

The product should validate token capability before offering a write action. If the token is missing, expired, lacks scope, or no longer has repository permission, the UI should explain the problem and keep the action disabled.

Logged-in browser write operations must also prove that the request originated from the active product session, not only from a browser that happens to carry the session cookie.

Token connection should resist repeated invalid submissions. When a user or script exceeds the configured token-binding attempt window, the UI should receive a clear retry-later response instead of repeatedly calling GitHub.

Users should be able to distinguish three account actions:

- Connect or reconnect the current GitHub user's token.
- Remove the current GitHub user's saved token while keeping the browser session signed in.
- Sign out of the current browser session without deleting the saved token.

Before a write, the product must show:

- Target issue or PR.
- Current state.
- Proposed state.
- Labels to add or remove.
- Comment body, if applicable.
- Reason for the action.

Potential write operations:

- Add `needs-triage`.
- Move issue to `deferred`.
- Add deferred explanation comment.
- Update severity labels.
- Update AI effort label.
- Assign or unassign users.
- Comment on issues or PRs.

All write operations should be auditable.

Audit records should include:

- User who initiated the action.
- GitHub identity used for the action.
- Target issue or PR.
- Before and after state.
- Provider response or error.
- Time of execution.

The UI should expose recent write executions to logged-in users without exposing raw GitHub tokens or full provider payloads.

## 15. MVP Scope

The first usable version should be delivered in phases.

### 15.1 MVP0: Read-only Critical Flow

MVP0 should include:

- One configured GitHub repo.
- MatrixOne as the first workflow profile.
- Configured watched users.
- GitHub data cache.
- Active polling for initial sync and refresh.
- Anonymous read-only dashboard with explicit visibility policy.
- Overall view.
- Personal view.
- Repo-wide active `s-1/s0` issues view.
- Owner attribution and `unowned` bucket.
- `needs-triage` and `deferred` counts per watched user.
- Yesterday PR created and merged counts per watched user.
- Pending PR list with age.
- PR attention flags using `last_human_action_at`.

### 15.2 MVP1: Workflow and Testing Intelligence

MVP1 should add:

- Configured testers.
- Testing flow view and state machine.
- Workflow violations view.
- AI estimate drift view.
- Basic webhook support or a clear extension point for webhook ingestion.
- Daily, weekly, and monthly trend charts.

### 15.3 MVP2: Notifications and Actions

MVP2 should add:

- Enterprise WeChat notification configuration.
- At least one digest notification and one attention notification path.
- Logged-in GitHub token connection.
- Write action previews.
- Confirmed GitHub write operations through the user's token.
- Write audit log.

The MVP may defer:

- Multi-tenant SaaS.
- Organization-wide user analytics.
- Complex permission administration.
- Automated bulk writes.
- Replacement of GitHub Projects.
- Full BI-style custom reporting.

## 16. Success Criteria

A maintainer should be able to open the product and quickly answer:

- Which `s0` and `s-1` issues are active right now?
- Who owns each active `s-1/s0` issue?
- Which active `s-1/s0` issues are unowned or owned by non-watched users?
- Which watched users have `needs-triage` or `deferred` backlog?
- Who created and merged PRs yesterday?
- Which PRs are pending and how old are they?
- Which PRs need attention because of no action, requested changes, failed CI, or conflict?
- Which issues are in testing, how long they have waited, and which PRs are linked?
- Which `ai-xxx` estimates look wrong based on actual workflow duration?
- Which workflow violations should be fixed first?
- Which attention items have already notified the responsible employee?
- Is the displayed data fresh, stale, complete, or partial?
