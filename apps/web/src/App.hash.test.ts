import { describe, expect, it } from "vitest";
import {
  aiDriftSignalMatchesSignalFilter,
  analyticsPeriodScopeText,
  criticalIssueAiFilterFromHash,
  criticalIssueOwnerFilterFromHash,
  criticalIssueScopeFilterFromHash,
  criticalIssueSortFromHash,
  criticalIssueTableSummary,
  analyticsPeriodFromHash,
  currentMetricPeriodLabel,
  currentMetricPeriodScopeText,
  dashboardHashForView,
  dashboardRefreshModeText,
  dashboardVisibilityChipLabel,
  dashboardVisibilityClassLabel,
  dashboardVisibilityPathDetail,
  dashboardVisibilityTitle,
  dashboardViewLimitTargetForKey,
  driftSignalFilterFromHash,
  filterManualRefreshLayersForQuota,
  manualRefreshLayerBlockedByQuota,
  manualRefreshPresetLayers,
  manualRefreshPresetLayersForQuota,
  manualRefreshQueuedJobLabel,
  notificationDeliveryScopeFilterFromHash,
  peoplePrFlowMatrixRows,
  peopleRiskSummary,
  peopleScopeForPersonalMetric,
  peopleScopeFilterFromHash,
  peopleSortLabel,
  peopleSortFromHash,
  pagedRangeLabel,
  personalActionQueueDisclosureSummary,
  personalCurrentBlockerDetail,
  personalCriticalFlowDefaultTarget,
  personalCriticalFlowEfficiency,
  personalCriticalFlowEfficiencyCompactSummary,
  personalCriticalFlowGapSummary,
  personalCriticalFlowHealthText,
  personalCriticalFlowManagementDetail,
  personalCriticalFlowEfficiencySummary,
  personalFlowThreadsSummary,
  personalPrPeriodAverageDurationText,
  personalPrPeriodRiskDetail,
  personalPrPeriodThroughputDetail,
  personalPrListForScope,
  personalPrListTotalForScope,
  personalPrPeriodActivitySummary,
  personalPrPeriodCapDetail,
  personalPrSortLabel,
  personalPrThroughputPair,
  personalPrThroughputSummary,
  personalPrThroughputSelectionForPeriod,
  personalPrThroughputRows,
  personalPrVisibleUniqueTotalForPeriod,
  personalDrilldownFilterFromHash,
  prLifecycleDurationText,
  prBoardTabFromHash,
  prRotationTableSummary,
  prScopeHelp,
  prScopeFilterFromHash,
  prScopeLabel,
  prSortFromHash,
  retryLaterErrorMessage,
  serviceReadTokenStatusText,
  sortPersonalPrList,
  syncRateLimitSummary,
  syncHealthCursorText,
  testingIssueQueueFilterFromHash,
  testingIssueTesterFilterFromHash,
  violationSignalFilterFromHash,
  webhookScopeFilterFromHash,
  writeAuditScopeFilterFromHash,
  writeAuditHealthSummary,
  writeAuditOperationSummary,
  workflowExecutionNeedsTokenReconnect,
  workflowFixActionForViolation,
  workflowPostWriteRefreshSummary,
  workflowViolationMatchesSignalFilter
} from "./App";

describe("dashboard hash filters", () => {
  it("summarizes dashboard visibility scope for the persistent status chip", () => {
    const anonymousVisibility = {
      scope: "anonymous",
      visibleClasses: ["anonymous_readable"],
      hiddenIssues: 0,
      hiddenPullRequests: 0,
      hiddenObjects: 0,
      note: null
    } as any;
    const loggedInVisibility = {
      scope: "logged_in",
      visibleClasses: ["anonymous_readable", "logged_in_readable", "token_owner_only"],
      hiddenIssues: 2,
      hiddenPullRequests: 1,
      hiddenObjects: 3,
      note: "3 cached GitHub objects are hidden from this view."
    } as any;

    expect(dashboardVisibilityChipLabel(anonymousVisibility)).toBe("scope: anonymous cache");
    expect(dashboardVisibilityTitle(anonymousVisibility)).toContain("anonymous-readable");
    expect(dashboardVisibilityTitle(anonymousVisibility)).toContain("No cached issue or PR objects are hidden");
    expect(dashboardVisibilityChipLabel(loggedInVisibility)).toBe("scope: logged-in cache · 3 hidden");
    expect(dashboardVisibilityPathDetail(loggedInVisibility)).toBe(
      "2 issues / 1 PR hidden; visible: anonymous-readable, logged-in-readable, current user's token-only"
    );
    expect(dashboardVisibilityClassLabel("admin_only")).toBe("admin-only");
  });

  it("formats retry-after feedback for rate-limited actions", () => {
    expect(retryLaterErrorMessage("Too many manual refresh requests.", 65)).toBe(
      "Too many manual refresh requests. Try again in 1m 5s."
    );
    expect(retryLaterErrorMessage("Retry failed webhooks later.", 6.2)).toBe(
      "Retry failed webhooks later. Try again in 7s."
    );
  });

  it("summarizes post-write refresh queueing outcomes", () => {
    expect(
      workflowPostWriteRefreshSummary({
        queued: true,
        layers: ["github_sync", "rules"],
        queuedJobs: [
          { jobKey: "github-sync:test", jobType: "github_sync", status: "queued", nextRunAt: null },
          { jobKey: "rules:test", jobType: "rules", status: "pending", nextRunAt: "2026-07-05T10:00:00.000Z" }
        ],
        errorMessage: null
      })
    ).toBe("2 worker jobs queued for github sync, rules.");
    expect(
      workflowPostWriteRefreshSummary({
        queued: true,
        layers: ["metrics"],
        queuedJobs: [],
        errorMessage: null
      })
    ).toBe("metrics requested, but no worker job was returned by the queue.");
    expect(
      workflowPostWriteRefreshSummary({
        queued: false,
        layers: ["github_sync"],
        queuedJobs: [],
        errorMessage: "queue unavailable"
      })
    ).toBe("queue unavailable");
  });

  it("round-trips issue board filters for shareable drilldown links", () => {
    const hash = dashboardHashForView("Issues", {
      criticalIssueAiFilter: "ai-manual",
      criticalIssueScopeFilter: "s0",
      criticalIssueOwnerFilter: "owner:alice",
      criticalIssueSort: "active_age"
    });

    expect(hash).toBe("issues?ai=ai-manual&scope=s0&owner=owner%3Aalice&sort=active_age");
    expect(criticalIssueAiFilterFromHash(`#${hash}`)).toBe("ai-manual");
    expect(criticalIssueScopeFilterFromHash(`#${hash}`)).toBe("s0");
    expect(criticalIssueOwnerFilterFromHash(`#${hash}`)).toBe("owner:alice");
    expect(criticalIssueSortFromHash(`#${hash}`)).toBe("active_age");
  });

  it("round-trips PR, people, and personal board filters", () => {
    const prHash = dashboardHashForView("PRs", {
      prScopeFilter: "testing_evidence_gap",
      prSort: "testing_wait",
      prBoardTab: "testing"
    });
    expect(prScopeFilterFromHash(`#${prHash}`)).toBe("testing_evidence_gap");
    expect(prSortFromHash(`#${prHash}`)).toBe("testing_wait");
    expect(prBoardTabFromHash(`#${prHash}`)).toBe("testing");

    const peopleHash = dashboardHashForView("People", {
      peopleScopeFilter: "triage",
      peopleSort: "testing_wait"
    });
    expect(peopleScopeFilterFromHash(`#${peopleHash}`)).toBe("triage");
    expect(peopleSortFromHash(`#${peopleHash}`)).toBe("testing_wait");
    expect(peopleSortFromHash("#people?sort=flow_gap")).toBe("flow_gap");

    const personalHash = dashboardHashForView("Personal", {
      personLogin: "alice",
      personalDrilldownFilter: "pr_attention"
    });
    expect(personalHash).toBe("personal?person=alice&drilldown=pr_attention");
    expect(personalDrilldownFilterFromHash(`#${personalHash}`)).toBe("pr_attention");
    expect(
      dashboardHashForView("Personal", {
        personLogin: "alice",
        personalDrilldownFilter: "testing"
      })
    ).toBe("personal?person=alice&drilldown=testing");
    expect(
      dashboardHashForView("Personal", {
        personLogin: "alice",
        personalDrilldownFilter: "active_no_pr"
      })
    ).toBe("personal?person=alice&drilldown=active_no_pr");
    expect(personalDrilldownFilterFromHash("#personal?person=alice&drilldown=active_no_pr")).toBe("active_no_pr");
    expect(
      dashboardHashForView("Personal", {
        personLogin: "alice",
        personalDrilldownFilter: "active_not_testing"
      })
    ).toBe("personal?person=alice&drilldown=active_not_testing");
    expect(personalDrilldownFilterFromHash("#personal?person=alice&drilldown=active_not_testing")).toBe(
      "active_not_testing"
    );
    expect(
      dashboardHashForView("Personal", {
        personLogin: "alice",
        personalDrilldownFilter: "active_issues"
      })
    ).toBe("personal?person=alice");
  });

  it("round-trips day, week, and month analytics periods for trend views", () => {
    expect(dashboardHashForView("Overview", { analyticsPeriod: "month" })).toBe("overview?period=month");
    expect(dashboardHashForView("Analytics", { analyticsPeriod: "week" })).toBe("analytics?period=week");
    expect(
      dashboardHashForView("Personal", {
        personLogin: "alice",
        personalDrilldownFilter: "testing",
        analyticsPeriod: "week"
      })
    ).toBe("personal?person=alice&drilldown=testing&period=week");
    expect(dashboardHashForView("Analytics", { analyticsPeriod: "day" })).toBe("analytics");
    expect(analyticsPeriodFromHash("#overview?period=month")).toBe("month");
    expect(analyticsPeriodFromHash("#analytics?period=week")).toBe("week");
    expect(analyticsPeriodScopeText("week", 30)).toBe("Rolling 30-day trend, grouped by weekly periods");
    expect(currentMetricPeriodLabel("month")).toBe("This Month");
    expect(currentMetricPeriodScopeText("Asia/Shanghai")).toBe("Current calendar periods in Asia/Shanghai.");
  });

  it("round-trips workflow signal filters without hiding source deep links", () => {
    const violationHash = dashboardHashForView("Violations", {
      violationSignalFilter: "fixable"
    });
    const driftHash = dashboardHashForView("Drift", {
      driftSignalFilter: "defaulted_ai_easy"
    });

    expect(violationHash).toBe("violations?signal=fixable");
    expect(driftHash).toBe("drift?signal=defaulted_ai_easy");
    expect(violationSignalFilterFromHash(`#${violationHash}`)).toBe("fixable");
    expect(driftSignalFilterFromHash(`#${driftHash}`)).toBe("defaulted_ai_easy");
    expect(driftSignalFilterFromHash("#drift?signal=pr_blockers")).toBe("pr_blockers");
    expect(violationSignalFilterFromHash("#violations?source_id=42&signal=critical")).toBe("all");
    expect(driftSignalFilterFromHash("#drift?source_id=42&signal=notification_failed")).toBe("all");
  });

  it("round-trips operational board filters for notifications, webhooks, and audit", () => {
    const notificationHash = dashboardHashForView("Notifications", {
      notificationDeliveryScopeFilter: "failed"
    });
    const webhookHash = dashboardHashForView("Webhooks", {
      webhookScopeFilter: "duplicates"
    });
    const auditHash = dashboardHashForView("Audit", {
      writeAuditScopeFilter: "token_unavailable"
    });

    expect(notificationHash).toBe("notifications?scope=failed");
    expect(webhookHash).toBe("webhooks?scope=duplicates");
    expect(auditHash).toBe("audit?scope=token_unavailable");
    expect(notificationDeliveryScopeFilterFromHash(`#${notificationHash}`)).toBe("failed");
    expect(webhookScopeFilterFromHash(`#${webhookHash}`)).toBe("duplicates");
    expect(webhookScopeFilterFromHash("#webhooks?scope=stale_processing")).toBe("stale_processing");
    expect(writeAuditScopeFilterFromHash(`#${auditHash}`)).toBe("token_unavailable");
    expect(
      dashboardHashForView("Notifications", {
        notificationDeliveryScopeFilter: "attention"
      })
    ).toBe("notifications");
    expect(dashboardHashForView("Webhooks", { webhookScopeFilter: "pending" })).toBe("webhooks");
    expect(dashboardHashForView("Audit", { writeAuditScopeFilter: "attention" })).toBe("audit");
  });

  it("summarizes write audit health without exposing comment bodies", () => {
    const actions = [
      writeAction({
        id: 1,
        status: "success",
        actionKey: "move_to_deferred",
        finishedAt: "2026-07-04T09:00:00.000Z",
        executedOperations: [
          { type: "remove_label", label: "needs-triage" },
          { type: "add_label", label: "deferred" },
          { type: "add_comment", body: "[comment body hidden from dashboard audit]" }
        ]
      }),
      writeAction({
        id: 2,
        status: "failed",
        actionKey: "add_deferred_explanation_comment",
        finishedAt: "2026-07-04T10:00:00.000Z",
        executedOperations: []
      }),
      writeAction({
        id: 3,
        status: "token_unavailable",
        actionKey: "add_needs_triage",
        finishedAt: "2026-07-04T11:00:00.000Z",
        executedOperations: []
      })
    ] as any;

    expect(writeAuditOperationSummary(actions)).toBe(
      "1 label add | 1 label removal | 1 hidden comment | 2 no-op audit rows"
    );
    expect(writeAuditHealthSummary(actions)).toMatchObject({
      total: 3,
      attention: 2,
      tone: "critical",
      operationSummary: "1 label add | 1 label removal | 1 hidden comment | 2 no-op audit rows"
    });
    expect(writeAuditHealthSummary(actions).latestAttention).toContain("add needs triage");
    expect(writeAuditHealthSummary(actions).latestSuccess).toContain("move to deferred");
    expect(writeAuditHealthSummary([])).toMatchObject({
      total: 0,
      attention: 0,
      latestAttention: "No write action needs attention",
      latestSuccess: "No successful write action visible",
      operationSummary: "No operation details visible",
      tone: "muted"
    });
  });

  it("opens reconnect only for unavailable write tokens", () => {
    expect(workflowExecutionNeedsTokenReconnect("token_unavailable")).toBe(true);
    expect(workflowExecutionNeedsTokenReconnect("failed")).toBe(false);
    expect(workflowExecutionNeedsTokenReconnect("stale_preview")).toBe(false);
    expect(workflowExecutionNeedsTokenReconnect(null)).toBe(false);
  });

  it("round-trips issue testing queue filters through PR board links", () => {
    const hash = dashboardHashForView("PRs", {
      prScopeFilter: "testing",
      prBoardTab: "testing",
      testingIssueQueueFilter: "stale",
      testingIssueTesterFilter: "qa user"
    });

    expect(hash).toBe("prs?scope=testing&tab=testing&test=stale&tester=qa+user");
    expect(prScopeFilterFromHash(`#${hash}`)).toBe("testing");
    expect(prBoardTabFromHash(`#${hash}`)).toBe("testing");
    expect(testingIssueQueueFilterFromHash(`#${hash}`)).toBe("stale");
    expect(testingIssueTesterFilterFromHash(`#${hash}`)).toBe("qa user");
    expect(prBoardTabFromHash("#prs?test=data_gap")).toBe("testing");
    expect(prBoardTabFromHash("#prs?tester=qa-user")).toBe("testing");
    expect(testingIssueQueueFilterFromHash("#prs?scope=stale_testing")).toBe("stale");
    expect(testingIssueQueueFilterFromHash("#prs?scope=testing_evidence_gap")).toBe("data_gap");
    expect(
      dashboardHashForView("PRs", {
        prBoardTab: "rotation",
        testingIssueQueueFilter: "stale",
        testingIssueTesterFilter: "qa user"
      })
    ).toBe("prs");
  });

  it("falls back from invalid filter params instead of preserving broken links", () => {
    const hash = "#prs?scope=triage&sort=unknown&tab=unknown&test=unknown";

    expect(prScopeFilterFromHash(hash)).toBe("all");
    expect(prSortFromHash(hash)).toBe("risk");
    expect(prBoardTabFromHash(hash)).toBe("rotation");
    expect(testingIssueQueueFilterFromHash(hash)).toBe("all");
    expect(criticalIssueOwnerFilterFromHash("#issues?owner=owner%3A")).toBe("all");
    expect(notificationDeliveryScopeFilterFromHash("#notifications?scope=bad")).toBe("attention");
    expect(webhookScopeFilterFromHash("#webhooks?scope=bad")).toBe("pending");
    expect(writeAuditScopeFilterFromHash("#audit?scope=bad")).toBe("attention");
    expect(analyticsPeriodFromHash("#analytics?period=bad")).toBe("day");
  });

  it("selects stable manual refresh layer presets for common repair paths", () => {
    expect(manualRefreshPresetLayers("workflow")).toEqual(["webhooks", "rules", "notifications"]);
    expect(manualRefreshPresetLayers("evidence")).toEqual([
      "pr_backfill",
      "issue_timeline_backfill",
      "comment_backfill",
      "rules",
      "metrics",
      "ai_drift"
    ]);
    expect(manualRefreshPresetLayers("metrics")).toEqual(["metrics"]);
    expect(manualRefreshPresetLayers("all")).toEqual([
      "github_sync",
      "pr_backfill",
      "issue_timeline_backfill",
      "comment_backfill",
      "webhooks",
      "rules",
      "metrics",
      "ai_drift",
      "notifications"
    ]);
  });

  it("removes GitHub-backed manual refresh layers while quota is exhausted", () => {
    const exhausted = { exhaustedLayers: ["pr_backfill"] };
    expect(manualRefreshLayerBlockedByQuota("github_sync", exhausted)).toBe(true);
    expect(manualRefreshLayerBlockedByQuota("rules", exhausted)).toBe(false);
    expect(filterManualRefreshLayersForQuota(["github_sync", "rules", "metrics"], exhausted)).toEqual([
      "rules",
      "metrics"
    ]);
    expect(manualRefreshPresetLayersForQuota("workflow", exhausted)).toEqual(["rules", "notifications"]);
    expect(manualRefreshPresetLayersForQuota("evidence", exhausted)).toEqual(["rules", "metrics", "ai_drift"]);
    expect(manualRefreshPresetLayersForQuota("all", exhausted)).toEqual([
      "rules",
      "metrics",
      "ai_drift",
      "notifications"
    ]);
    expect(manualRefreshPresetLayersForQuota("metrics", exhausted)).toEqual(["metrics"]);
  });

  it("summarizes queued manual refresh jobs with status and readiness", () => {
    expect(
      manualRefreshQueuedJobLabel({
        jobKey: "rules:repo",
        jobType: "rules",
        status: "pending",
        nextRunAt: null
      })
    ).toBe("rules pending · ready now");
  });

  it("routes capped read models to the most relevant board drilldown", () => {
    expect(dashboardViewLimitTargetForKey("critical_issues")).toEqual({
      view: "Issues",
      label: "Open active issues",
      options: {
        criticalIssueAiFilter: "all",
        criticalIssueScopeFilter: "all",
        criticalIssueOwnerFilter: "all",
        criticalIssueSort: "active_age"
      }
    });
    expect(dashboardViewLimitTargetForKey("pending_prs")).toEqual({
      view: "PRs",
      label: "Open PR board",
      options: { prScopeFilter: "all", prSort: "risk", prBoardTab: "rotation" }
    });
    expect(dashboardViewLimitTargetForKey("linked_pr_candidates")).toEqual({
      view: "PRs",
      label: "Open link gaps",
      options: { prScopeFilter: "issue_link_pending", prSort: "risk", prBoardTab: "rotation" }
    });
    expect(dashboardViewLimitTargetForKey("attention_summary")).toEqual({
      view: "People",
      label: "Open attention owners",
      options: { peopleScopeFilter: "attention", peopleSort: "pr_attention" }
    });
    expect(dashboardViewLimitTargetForKey("personal_issues")).toEqual({
      view: "People",
      label: "Open all people",
      options: { peopleScopeFilter: "all", peopleSort: "workload" }
    });
    expect(dashboardViewLimitTargetForKey("personal_prs")).toEqual({
      view: "People",
      label: "Open PR owners",
      options: { peopleScopeFilter: "pending_pr", peopleSort: "pr_age" }
    });
    expect(dashboardViewLimitTargetForKey("personal_pr_period_rows")).toEqual({
      view: "Personal",
      label: "Open personal PR periods",
      options: { personalDrilldownFilter: "pending_pr", analyticsPeriod: "week" }
    });
    expect(dashboardViewLimitTargetForKey("workflow_violations")).toEqual({
      view: "Violations",
      label: "Open violations"
    });
    expect(dashboardViewLimitTargetForKey("ai_drift")).toEqual({
      view: "Drift",
      label: "Open AI drift"
    });
    expect(dashboardViewLimitTargetForKey("analytics_rows")).toEqual({
      view: "Analytics",
      label: "Open analytics"
    });
    expect(dashboardViewLimitTargetForKey("unknown")).toEqual({
      view: "Health",
      label: "Open health"
    });
  });

  it("formats github sync cursor windows for health tooltips", () => {
    const text = syncHealthCursorText(
      JSON.stringify({
        mode: "updated_desc_window",
        maxPages: 2,
        previousHighWatermarkAt: "2026-07-03T00:00:00Z",
        nextHighWatermarkAt: "2026-07-04T10:00:00Z",
        issuesOldestUpdatedAt: "2026-07-04T09:00:00Z",
        openPrsOldestUpdatedAt: "2026-07-04T08:00:00Z",
        closedPrsOldestUpdatedAt: null,
        issuesComplete: false,
        openPullRequestsComplete: true,
        issuesWatermarkReached: true,
        openPullRequestsWatermarkReached: false,
        closedPullRequestsWatermarkReached: false
      })
    );

    expect(text).toContain("Updated-at polling window (bounded window)");
    expect(text).toContain("max 2 pages");
    expect(text).toContain("previous watermark");
    expect(text).toContain("next watermark");
    expect(text).toContain("issues oldest");
    expect(text).toContain("open PRs oldest");
    expect(text).toContain("closed PRs oldest -");
    expect(text).toContain("issues reached previous watermark");
  });

  it("preserves unknown sync cursor formats", () => {
    expect(syncHealthCursorText("opaque-cursor")).toBe("opaque-cursor");
    expect(syncHealthCursorText(null)).toBeNull();
  });

  it("labels fast refresh watch mode separately from normal auto refresh", () => {
    expect(dashboardRefreshModeText(false, false)).toBe("auto 30s");
    expect(dashboardRefreshModeText(false, true)).toBe("watch 3s");
    expect(dashboardRefreshModeText(true, true)).toBe("refreshing");
  });

  it("labels the deployment service read token separately from personal sign-in", () => {
    expect(serviceReadTokenStatusText(true)).toBe("service ready");
    expect(serviceReadTokenStatusText(false)).toBe("service missing");
  });

  it("summarizes GitHub rate limits for operational health", () => {
    expect(syncRateLimitSummary([])).toMatchObject({
      value: "unknown",
      detail: "No GitHub rate limit headers recorded yet.",
      tone: "normal",
      reportedLayers: 0
    });

    expect(
      syncRateLimitSummary([
        { layer: "rules", rateLimitRemaining: 42, rateLimitResetAt: "2026-07-05T10:00:00.000Z" },
        { layer: "github_sync", rateLimitRemaining: 8, rateLimitResetAt: "2026-07-05T09:30:00.000Z" }
      ])
    ).toMatchObject({
      value: "8 left",
      detail: "1 layer low; lowest 8 on github sync",
      tone: "attention",
      lowestLayer: "github_sync",
      lowestRemaining: 8,
      lowLayers: ["github_sync"],
      exhaustedLayers: []
    });

    expect(
      syncRateLimitSummary([
        { layer: "rules", rateLimitRemaining: 0, rateLimitResetAt: "2026-07-05T10:00:00.000Z" },
        { layer: "metrics", rateLimitRemaining: 3, rateLimitResetAt: "2026-07-05T10:30:00.000Z" }
      ])
    ).toMatchObject({
      value: "0 left",
      detail: "1 layer exhausted; lowest 0 on rules",
      tone: "critical",
      exhaustedLayers: ["rules"]
    });
  });

  it("describes PR issue-link scopes without implying incomplete evidence is a confirmed missing issue", () => {
    expect(prScopeLabel("no_issue")).toBe("no linked issue in cache");
    expect(prScopeHelp("no_issue")).toContain("relationship sync completed");
    expect(prScopeLabel("issue_link_pending")).toBe("issue link sync pending");
    expect(prScopeHelp("issue_link_pending")).toContain("Do not treat them as unlinked yet");
  });

  it("summarizes the collapsed PR table with count, scope, and sort", () => {
    expect(prRotationTableSummary(1, "ci_failed", "age")).toBe("1 PR | CI failed | sort PR age");
    expect(prRotationTableSummary(12, "attention", "last_action")).toBe("12 PRs | PR attention | sort last action");
  });

  it("summarizes the collapsed issue table with scope, owner, AI, and sort", () => {
    expect(criticalIssueTableSummary(1, "s-1", "ai-easy", "owner:alice", "active_age")).toBe(
      "1 issue | s-1 | alice | ai-easy | sort active age"
    );
    expect(criticalIssueTableSummary(8, "no_action_24h", "all", "all", "risk")).toBe(
      "8 issues | no action 24h | all owners | all AI | sort risk"
    );
  });

  it("clamps paged range labels when filters shrink the table", () => {
    expect(pagedRangeLabel(12, 1, 8)).toBe("1-8");
    expect(pagedRangeLabel(12, 9, 8)).toBe("9-12");
    expect(pagedRangeLabel(8, 1, 8)).toBeNull();
    expect(pagedRangeLabel(0, 3, 8)).toBeNull();
  });

  it("uses neutral people sort labels for observed and watched boards", () => {
    expect(peopleSortLabel("workload")).toBe("workload");
    expect(peopleSortLabel("active")).toBe("active issues");
    expect(peopleSortLabel("pr_age")).toBe("PR age");
    expect(peopleSortLabel("pr_throughput")).toBe("PR volume");
    expect(peopleSortLabel("flow_gap")).toBe("flow gap");
    expect(peopleSortLabel("testing_wait")).toBe("testing wait");
    expect(peopleScopeForPersonalMetric("active_no_pr")).toBe("critical");
    expect(peopleScopeForPersonalMetric("pr_attention")).toBe("attention");
    expect(peopleScopeForPersonalMetric("testing")).toBe("testing");
  });

  it("summarizes people risks for management shortcuts", () => {
    const people = [
      {
        login: "alice",
        activeCriticalIssues: 1,
        attentionPrs: 1,
        needsTriageIssues: 2,
        deferredIssues: 0,
        pendingPrs: 2,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0
      },
      {
        login: "bob",
        activeCriticalIssues: 1,
        attentionPrs: 0,
        needsTriageIssues: 0,
        deferredIssues: 0,
        pendingPrs: 1,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0
      }
    ] as any;
    const personalViews = [
      {
        login: "alice",
        activeCriticalIssues: [
          {
            linkedPullRequests: [],
            criticalAgeHours: 48,
            aiEffortLabel: null
          }
        ],
        attentionPrs: [personalPr({ number: 10, ageHours: 24, createdAt: "2026-07-01T00:00:00Z", mergedAt: null })],
        testingIssues: [{ queueAgeHours: 36 }],
        needsTriageIssues: [{ number: 1 }]
      },
      {
        login: "bob",
        activeCriticalIssues: [
          {
            linkedPullRequests: [
              {
                ageHours: 12,
                testingQueueAgeHours: 2,
                testingState: "testing"
              }
            ],
            criticalAgeHours: 24,
            aiEffortLabel: "ai-medium"
          }
        ],
        attentionPrs: [],
        testingIssues: [{ queueAgeHours: 8 }],
        needsTriageIssues: []
      }
    ] as any;

    expect(peopleRiskSummary(people, personalViews)).toEqual({
      activeWithoutPrPeople: 1,
      prBlockerPeople: 1,
      staleTestingPeople: 1,
      triageBacklogPeople: 1,
      criticalFlowGapPeople: 1
    });
  });

  it("summarizes personal flow thread evidence compactly", () => {
    expect(
      personalFlowThreadsSummary({
        rows: [{ id: "thread-1" }],
        maxAgeHours: 49,
        sharedPrCount: 1,
        unlinkedPrCount: 2
      })
    ).toBe("1 thread | 1 shared PR | 2 link gaps | oldest 2.0d");
  });

  it("summarizes the collapsed personal action queue with user-facing queue names", () => {
    expect(
      personalActionQueueDisclosureSummary({
        all: 8,
        critical: 2,
        pr_blockers: 1,
        testing: 1,
        needs_link: 3
      })
    ).toBe("8 objects | 2 s-1/s0 | 1 PR blocker | 1 testing issue | 3 link gaps");
  });

  it("summarizes personal PR throughput for day, week, and month", () => {
    const rows = personalPrThroughputRows({
      analytics: [
        metricPoint({ date: "2026-07-03", prsCreated: 1, prsMerged: 0 }),
        metricPoint({ date: "2026-07-04", prsCreated: 3, prsMerged: 2, averagePendingPrAgeHours: 18 })
      ],
      analyticsWeekly: [
        {
          ...metricPoint({ date: "2026-07-05", prsCreated: 9, prsMerged: 7 }),
          period: "week",
          periodStart: "2026-06-29",
          periodEnd: "2026-07-05",
          label: "Jun 29-Jul 5"
        }
      ],
      analyticsMonthly: [
        {
          ...metricPoint({ date: "2026-07-31", prsCreated: 24, prsMerged: 20 }),
          period: "month",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          label: "Jul 2026"
        }
      ]
    });

    expect(rows.map((row) => `${row.period}:${row.prsCreated}/${row.prsMerged}`)).toEqual([
      "day:3/2",
      "week:9/7",
      "month:24/20"
    ]);
    expect(rows[0]?.averagePendingPrAgeHours).toBe(18);
    expect(personalPrThroughputSummary(rows)).toBe("D 3/2 | W 9/7 | M 24/20");
  });

  it("uses visible period list totals for personal PR throughput cards", () => {
    const rows = personalPrThroughputRows({
      analytics: [metricPoint({ date: "2026-07-04", prsCreated: 1, prsMerged: 1, averagePendingPrAgeHours: 18 })],
      analyticsWeekly: [
        {
          ...metricPoint({ date: "2026-07-05", prsCreated: 2, prsMerged: 2 }),
          period: "week",
          periodStart: "2026-06-29",
          periodEnd: "2026-07-05",
          label: "Jun 29-Jul 5"
        }
      ],
      analyticsMonthly: [],
      prPeriodLists: [
        {
          period: "day",
          label: "07-04",
          periodStart: "2026-07-04",
          periodEnd: "2026-07-05",
          totalCreatedPrs: 4,
          totalMergedPrs: 3,
          createdPrs: [],
          mergedPrs: [],
          truncated: false
        },
        {
          period: "week",
          label: "Jun 29-Jul 5",
          periodStart: "2026-06-29",
          periodEnd: "2026-07-06",
          totalCreatedPrs: 8,
          totalMergedPrs: 6,
          createdPrs: [],
          mergedPrs: [],
          truncated: false
        }
      ]
    });

    expect(personalPrThroughputPair(rows[0])).toBe("4/3");
    expect(personalPrThroughputPair(rows[1])).toBe("8/6");
    expect(rows[0]?.averagePendingPrAgeHours).toBe(18);
  });

  it("maps personal day/week/month PR totals to period, created, and merged lists", () => {
    const person = {
      attentionPrs: [{ number: 99 }],
      pendingPrs: [{ number: 98 }],
      analytics: [],
      analyticsWeekly: [],
      analyticsMonthly: [],
      prPeriodLists: [
        {
          period: "week",
          label: "06-29-07-05",
          periodStart: "2026-06-29",
          periodEnd: "2026-07-06",
          totalCreatedPrs: 3,
          totalMergedPrs: 2,
          createdPrs: [
            { number: 10, createdAt: "2026-06-30T09:00:00.000Z", mergedAt: "2026-07-03T10:00:00.000Z" },
            { number: 11, ageHours: 48, createdAt: "2026-07-01T09:00:00.000Z", mergedAt: null, state: "open" }
          ],
          mergedPrs: [
            { number: 12, createdAt: "2026-06-20T09:00:00.000Z", mergedAt: "2026-07-05T10:00:00.000Z" },
            { number: 10, createdAt: "2026-06-30T09:00:00.000Z", mergedAt: "2026-07-03T10:00:00.000Z" }
          ],
          truncated: true
        }
      ]
    } as any;

    expect(personalPrListForScope(person, "period_all", "week").map((pr) => pr.number)).toEqual([12, 10, 11]);
    expect(personalPrListForScope(person, "created_period", "week").map((pr) => pr.number)).toEqual([10, 11]);
    expect(personalPrListForScope(person, "merged_period", "week").map((pr) => pr.number)).toEqual([12, 10]);
    expect(personalPrListTotalForScope(person, "period_all", "week")).toBe(3);
    expect(personalPrListTotalForScope(person, "created_period", "week")).toBe(3);
    expect(personalPrListTotalForScope(person, "attention", "day")).toBe(1);
    expect(personalPrVisibleUniqueTotalForPeriod(person, "week")).toBe(3);
    expect(personalPrPeriodAverageDurationText(person.prPeriodLists[0])).toBe("6.7d");
    expect(personalPrPeriodThroughputDetail(person, "week")).toBe("3 PRs in list | avg 6.7d");
    expect(personalPrPeriodRiskDetail(person, "week")).toBe("pending - | attention - | open age - | test wait -");
    expect(prLifecycleDurationText(person.prPeriodLists[0].createdPrs[0])).toBe("merged in 3.0d");
    expect(prLifecycleDurationText(person.prPeriodLists[0].createdPrs[1])).toBe("open 2.0d");
    expect(personalPrPeriodActivitySummary(person.prPeriodLists[0])).toBe(
      "3 unique PRs | 3 created | 2 merged | 5 activity events | avg PR time 6.7d"
    );
    expect(personalPrPeriodCapDetail(person.prPeriodLists[0], { returned: 200, limit: 200 })).toBe(
      "This current-period PR list is capped by 200/200 dashboard rows. Created and merged counts still use aggregate counts, but the visible PR cards can be incomplete."
    );
    expect(
      personalPrPeriodCapDetail({ ...person.prPeriodLists[0], truncated: false }, { returned: 200, limit: 200 })
    ).toBeNull();
  });

  it("filters workflow violations by management severity and notification state", () => {
    const violation = {
      severity: "critical",
      relatedLogin: null,
      fixable: true,
      notification: {
        status: "sent",
        recipientScope: "mapped_employee",
        attemptedAt: "2026-07-05T09:00:00.000Z",
        acknowledgedAt: null,
        acknowledgedBy: null
      }
    } as any;
    const failedViolation = {
      ...violation,
      severity: "warning",
      relatedLogin: "alice",
      fixable: false,
      notification: {
        ...violation.notification,
        status: "failed_transient"
      }
    } as any;

    expect(workflowViolationMatchesSignalFilter(violation, "critical")).toBe(true);
    expect(workflowViolationMatchesSignalFilter(violation, "unowned")).toBe(true);
    expect(workflowViolationMatchesSignalFilter(violation, "fixable")).toBe(true);
    expect(workflowViolationMatchesSignalFilter(violation, "ack_pending")).toBe(true);
    expect(workflowViolationMatchesSignalFilter(failedViolation, "notification_failed")).toBe(true);
    expect(workflowViolationMatchesSignalFilter(failedViolation, "critical")).toBe(false);
  });

  it("maps fixable workflow violations to safe preview actions", () => {
    const violation = {
      objectType: "issue",
      ruleKey: "deferred_missing_explanation_comment",
      fixable: true
    } as any;

    expect(workflowFixActionForViolation(violation)).toBe("add_deferred_explanation_comment");
    expect(workflowFixActionForViolation({ ...violation, fixable: false })).toBeNull();
    expect(workflowFixActionForViolation({ ...violation, objectType: "pull_request" })).toBeNull();
  });

  it("filters AI drift by ai-easy default, partial evidence, and notification state", () => {
    const signal = {
      ruleKey: "ai_easy_critical_too_old",
      severity: "warning",
      ownerLogin: null,
      aiEffortLabel: null,
      sourceCompleteness: "partial_cache",
      notification: {
        status: "sent",
        recipientScope: "fallback",
        attemptedAt: "2026-07-05T09:00:00.000Z",
        acknowledgedAt: "2026-07-05T10:00:00.000Z",
        acknowledgedBy: "lead"
      }
    } as any;
    const blockerSignal = { ...signal, ruleKey: "ai_easy_pr_has_blockers" } as any;
    const failedSignal = {
      ...signal,
      notification: {
        ...signal.notification,
        status: "skipped_no_webhook",
        acknowledgedAt: null,
        acknowledgedBy: null
      }
    } as any;

    expect(aiDriftSignalMatchesSignalFilter(signal, "ai_easy")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "defaulted_ai_easy")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter({ ...signal, aiEffortLabel: "ai-easy" } as any, "defaulted_ai_easy")).toBe(
      false
    );
    expect(aiDriftSignalMatchesSignalFilter(signal, "slow_to_test")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "pr_blockers")).toBe(false);
    expect(aiDriftSignalMatchesSignalFilter(blockerSignal, "pr_blockers")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "partial_evidence")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "unowned")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "notified")).toBe(true);
    expect(aiDriftSignalMatchesSignalFilter(signal, "ack_pending")).toBe(false);
    expect(aiDriftSignalMatchesSignalFilter(failedSignal, "notification_failed")).toBe(true);
  });

  it("opens period PR activity when a day, week, or month throughput count is selected", () => {
    const person = {
      attentionPrs: [],
      pendingPrs: [],
      prPeriodLists: [
        {
          period: "day",
          label: "07-05",
          periodStart: "2026-07-05",
          periodEnd: "2026-07-06",
          totalCreatedPrs: 2,
          totalMergedPrs: 1,
          createdPrs: [],
          mergedPrs: [],
          truncated: false
        },
        {
          period: "month",
          label: "Jul 2026",
          periodStart: "2026-07-01",
          periodEnd: "2026-08-01",
          totalCreatedPrs: 3,
          totalMergedPrs: 8,
          createdPrs: [],
          mergedPrs: [],
          truncated: false
        }
      ]
    } as any;

    expect(personalPrThroughputSelectionForPeriod(person, "day")).toEqual({
      period: "day",
      scope: "period_all"
    });
    expect(personalPrThroughputSelectionForPeriod(person, "month")).toEqual({
      period: "month",
      scope: "period_all"
    });
  });

  it("sorts personal PR lists by activity, age, and risk", () => {
    const periodList = {
      period: "week",
      label: "06-29-07-05",
      periodStart: "2026-06-29",
      periodEnd: "2026-07-06",
      totalCreatedPrs: 3,
      totalMergedPrs: 1,
      createdPrs: [],
      mergedPrs: [],
      truncated: false
    } as any;
    const prs = [
      personalPr({
        number: 10,
        ageHours: 8,
        createdAt: "2026-07-01T09:00:00.000Z",
        mergedAt: null
      }),
      personalPr({
        number: 11,
        ageHours: 72,
        createdAt: "2026-06-20T09:00:00.000Z",
        mergedAt: "2026-07-05T09:00:00.000Z"
      }),
      personalPr({
        number: 12,
        ageHours: 24,
        createdAt: "2026-07-04T09:00:00.000Z",
        mergedAt: null,
        ciState: "failure"
      })
    ];

    expect(sortPersonalPrList(prs, "activity", periodList).map((pr) => pr.number)).toEqual([11, 12, 10]);
    expect(sortPersonalPrList(prs, "age", periodList).map((pr) => pr.number)).toEqual([11, 12, 10]);
    expect(sortPersonalPrList(prs, "risk", periodList).map((pr) => pr.number)).toEqual([12, 11, 10]);
    expect(personalPrSortLabel("activity")).toBe("recent activity");
    expect(personalPrSortLabel("last_action")).toBe("last action");
  });

  it("derives active severity to PR and issue testing efficiency from cache timestamps", () => {
    const flow = personalCriticalFlowEfficiency({
      activeCriticalIssues: [
        {
          number: 10,
          severity: "severity/s0",
          aiEffortLabel: null,
          criticalAgeHours: 48,
          linkedPullRequests: [
            {
              ageHours: 30,
              testingQueueAgeHours: 6,
              testingState: "testing"
            }
          ]
        },
        {
          number: 11,
          severity: "severity/s-1",
          aiEffortLabel: "ai-heavy",
          criticalAgeHours: 12,
          linkedPullRequests: []
        }
      ]
    } as any);

    expect(flow).toMatchObject({
      activeIssues: 2,
      issuesWithPr: 1,
      issuesWithoutPr: 1,
      issuesInTesting: 1,
      issuesNotInTesting: 1,
      linkedIssueRatePercent: 50,
      testingIssueRatePercent: 50,
      averageActiveIssueAgeHours: 30,
      averageActiveToFirstPrHours: 18,
      averageActiveToTestingHours: 42,
      slowEasyIssues: 0
    });
    expect(personalCriticalFlowEfficiencySummary(flow)).toBe("1/2 linked (50%) | 1/2 in testing (50%)");
    expect(personalCriticalFlowEfficiencyCompactSummary(flow)).toBe("PR 1/2 (50%) | test 1/2 (50%)");
    expect(personalCriticalFlowGapSummary(flow)).toBe("1 no PR | 1 not in issue testing");
    expect(personalCriticalFlowDefaultTarget(flow)).toBe("active_no_pr");
    expect(personalCriticalFlowDefaultTarget({ ...flow, issuesWithoutPr: 0, issuesNotInTesting: 1 })).toBe(
      "active_not_testing"
    );
    expect(personalCriticalFlowManagementDetail(flow)).toBe(
      "from active to PR 18h | to issue testing 1.8d | 1 no PR | 1 not in issue testing"
    );
    expect(personalCriticalFlowHealthText(flow)).toBe("Needs attention: 1 no linked PR | 1 not in issue testing");
    expect(
      personalCriticalFlowHealthText({
        ...flow,
        activeIssues: 1,
        issuesWithPr: 1,
        issuesWithoutPr: 0,
        issuesInTesting: 1,
        issuesNotInTesting: 0,
        slowEasyIssues: 0,
        cachePendingIssues: 0
      })
    ).toBe("Clear: 1 active issue linked and in issue testing");
    expect(flow.rows[0]).toMatchObject({ aiEffortLabel: "ai-easy", firstPrAfterActiveHours: 18 });
    expect(
      personalCurrentBlockerDetail({
        attentionPrs: [
          personalPr({
            number: 20,
            ageHours: 30,
            createdAt: "2026-07-03T09:00:00.000Z",
            mergedAt: null,
            ciState: "failure"
          })
        ],
        pendingPrs: [personalPr({ number: 21, ageHours: 12, createdAt: "2026-07-04T09:00:00.000Z", mergedAt: null })],
        testingIssues: [{ queueAgeHours: 26 }]
      } as any)
    ).toBe("1 CI | 1 issue testing >24h");
  });

  it("builds the people PR and flow matrix from watched personal period lists", () => {
    const people = [
      {
        login: "alice",
        activeCriticalIssues: 1,
        attentionPrs: 1,
        needsTriageIssues: 0,
        deferredIssues: 0,
        pendingPrs: 2,
        prsCreatedYesterday: 3,
        prsMergedYesterday: 2
      },
      {
        login: "bob",
        activeCriticalIssues: 0,
        attentionPrs: 0,
        needsTriageIssues: 0,
        deferredIssues: 0,
        pendingPrs: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0
      }
    ] as any;
    const personalViews = [
      {
        login: "alice",
        pendingPrs: [personalPr({ number: 20, ageHours: 12, createdAt: "2026-07-04T09:00:00.000Z", mergedAt: null })],
        attentionPrs: [
          personalPr({
            number: 21,
            ageHours: 36,
            createdAt: "2026-07-03T09:00:00.000Z",
            mergedAt: null,
            ciState: "failure"
          })
        ],
        activeCriticalIssues: [
          {
            number: 10,
            severity: "severity/s0",
            aiEffortLabel: null,
            criticalAgeHours: 48,
            linkedPullRequests: [{ ageHours: 24, testingQueueAgeHours: 6, testingState: "testing" }]
          }
        ],
        analytics: [metricPoint({ date: "2026-07-04", prsCreated: 3, prsMerged: 2 })],
        analyticsWeekly: [
          {
            ...metricPoint({
              date: "2026-07-05",
              prsCreated: 8,
              prsMerged: 6,
              pendingPrs: 2,
              attentionPrs: 1,
              averagePendingPrAgeHours: 32,
              averageTestingQueueAgeHours: 10
            }),
            period: "week",
            periodStart: "2026-06-29",
            periodEnd: "2026-07-06",
            label: "Jun 29-Jul 5"
          }
        ],
        analyticsMonthly: [
          {
            ...metricPoint({ date: "2026-07-31", prsCreated: 18, prsMerged: 14 }),
            period: "month",
            periodStart: "2026-07-01",
            periodEnd: "2026-08-01",
            label: "Jul 2026"
          }
        ],
        prPeriodLists: [
          {
            period: "week",
            label: "Jun 29-Jul 5",
            periodStart: "2026-06-29",
            periodEnd: "2026-07-06",
            totalCreatedPrs: 1,
            totalMergedPrs: 1,
            createdPrs: [
              personalPr({
                number: 22,
                ageHours: 12,
                createdAt: "2026-07-02T09:00:00.000Z",
                mergedAt: "2026-07-03T09:00:00.000Z"
              })
            ],
            mergedPrs: [],
            truncated: false
          }
        ]
      },
      {
        login: "bob",
        pendingPrs: [],
        attentionPrs: [],
        activeCriticalIssues: [],
        analytics: [],
        analyticsWeekly: [],
        analyticsMonthly: [],
        prPeriodLists: []
      }
    ] as any;

    const rows = peoplePrFlowMatrixRows(people, personalViews, "pr_throughput");

    expect(rows.map((row) => row.login)).toEqual(["alice", "bob"]);
    expect(personalPrThroughputPair(rows[0].periods.day)).toBe("3/2");
    expect(personalPrThroughputPair(rows[0].periods.week)).toBe("1/1");
    expect(personalPrPeriodThroughputDetail(rows[0].personal, "week")).toBe("1 PR in list | avg 1.0d");
    expect(personalPrPeriodRiskDetail(rows[0].personal, "week")).toBe(
      "pending 2 | attention 1 | open age 1.3d | test wait 10h"
    );
    expect(personalCriticalFlowEfficiencyCompactSummary(rows[0].flow)).toBe("PR 1/1 (100%) | test 1/1 (100%)");
  });
});

function personalPr(input: {
  number: number;
  ageHours: number;
  createdAt: string;
  mergedAt: string | null;
  ciState?: string | null;
}) {
  return {
    number: input.number,
    title: `PR ${input.number}`,
    htmlUrl: `https://github.com/matrixorigin/matrixone/pull/${input.number}`,
    ownerLogin: "alice",
    draft: false,
    ageHours: input.ageHours,
    lastHumanActionAt: "2026-06-01T00:00:00.000Z",
    reviewDecision: null,
    mergeStateStatus: null,
    ciState: input.ciState ?? null,
    latestReviewState: null,
    latestReviewSubmittedAt: null,
    latestCommitAt: null,
    detailSyncedAt: "2026-07-05T00:00:00.000Z",
    detailError: null,
    testingState: "not_ready",
    testingTesters: [],
    testingSignals: [],
    testingQueueAgeHours: null,
    workflowSkipped: false,
    attentionFlags: [],
    linkedIssueNumbers: [],
    isComplete: true,
    state: input.mergedAt ? "closed" : "open",
    createdAt: input.createdAt,
    mergedAt: input.mergedAt
  } as any;
}

function writeAction(input: {
  id: number;
  status: string;
  actionKey: string;
  finishedAt: string;
  executedOperations: Array<
    { type: "add_label" | "remove_label"; label: string } | { type: "add_comment"; body: string }
  >;
}) {
  return {
    id: input.id,
    previewId: `preview-${input.id}`,
    githubLogin: "alice",
    actionKey: input.actionKey,
    objectType: "issue",
    objectNumber: 42,
    title: "issue",
    htmlUrl: "https://github.com/example/repo/issues/42",
    status: input.status,
    executedOperations: input.executedOperations,
    errorMessage: input.status === "success" ? null : "failed",
    startedAt: "2026-07-04T08:00:00.000Z",
    finishedAt: input.finishedAt
  };
}

function metricPoint(input: {
  date?: string;
  prsCreated?: number;
  prsMerged?: number;
  pendingPrs?: number;
  attentionPrs?: number;
  averagePendingPrAgeHours?: number | null;
  averageTestingQueueAgeHours?: number | null;
}) {
  return {
    date: input.date ?? "2026-07-04",
    scopeType: "person",
    scopeKey: "alice",
    prsCreated: input.prsCreated ?? 0,
    prsMerged: input.prsMerged ?? 0,
    issuesOpened: 0,
    issuesClosed: 0,
    issuesDeferred: 0,
    workflowViolationsDetected: 0,
    activeCriticalIssues: 0,
    averageActiveCriticalIssueAgeHours: null,
    needsTriageIssues: 0,
    averageNeedsTriageIssueAgeHours: null,
    deferredIssues: 0,
    averageDeferredIssueAgeHours: null,
    pendingPrs: input.pendingPrs ?? 0,
    averagePendingPrAgeHours: input.averagePendingPrAgeHours ?? null,
    attentionPrs: input.attentionPrs ?? 0,
    ciFailedPrs: 0,
    requestedChangePrs: 0,
    reviewWaitingPrs: 0,
    mergeConflictPrs: 0,
    testingQueueIssues: 0,
    averageTestingQueueAgeHours: input.averageTestingQueueAgeHours ?? null,
    sourceCompleteness: "complete_cache",
    generatedAt: "2026-07-05T00:00:00Z"
  } as const;
}
