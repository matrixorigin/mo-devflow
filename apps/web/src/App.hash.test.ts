import { describe, expect, it } from "vitest";
import {
  aiDriftSignalMatchesSignalFilter,
  criticalIssueAiFilterFromHash,
  criticalIssueOwnerFilterFromHash,
  criticalIssueScopeFilterFromHash,
  criticalIssueSortFromHash,
  criticalIssueTableSummary,
  analyticsPeriodFromHash,
  dashboardHashForView,
  dashboardRefreshModeText,
  dashboardViewLimitTargetForKey,
  driftSignalFilterFromHash,
  manualRefreshPresetLayers,
  notificationDeliveryScopeFilterFromHash,
  peopleScopeFilterFromHash,
  peopleSortLabel,
  peopleSortFromHash,
  pagedRangeLabel,
  personalActionQueueDisclosureSummary,
  personalCriticalFlowEfficiency,
  personalCriticalFlowEfficiencySummary,
  personalFlowThreadsSummary,
  personalPrListForScope,
  personalPrListTotalForScope,
  personalPrThroughputSummary,
  personalPrThroughputSelectionForPeriod,
  personalPrThroughputRows,
  personalDrilldownFilterFromHash,
  prBoardTabFromHash,
  prRotationTableSummary,
  prScopeHelp,
  prScopeFilterFromHash,
  prScopeLabel,
  prSortFromHash,
  serviceReadTokenStatusText,
  syncHealthCursorText,
  testingIssueQueueFilterFromHash,
  testingIssueTesterFilterFromHash,
  violationSignalFilterFromHash,
  webhookScopeFilterFromHash,
  writeAuditScopeFilterFromHash,
  workflowViolationMatchesSignalFilter
} from "./App";

describe("dashboard hash filters", () => {
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
  });

  it("round-trips workflow signal filters without hiding source deep links", () => {
    const violationHash = dashboardHashForView("Violations", {
      violationSignalFilter: "fixable"
    });
    const driftHash = dashboardHashForView("Drift", {
      driftSignalFilter: "slow_to_test"
    });

    expect(violationHash).toBe("violations?signal=fixable");
    expect(driftHash).toBe("drift?signal=slow_to_test");
    expect(violationSignalFilterFromHash(`#${violationHash}`)).toBe("fixable");
    expect(driftSignalFilterFromHash(`#${driftHash}`)).toBe("slow_to_test");
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
    expect(writeAuditScopeFilterFromHash(`#${auditHash}`)).toBe("token_unavailable");
    expect(
      dashboardHashForView("Notifications", {
        notificationDeliveryScopeFilter: "attention"
      })
    ).toBe("notifications");
    expect(dashboardHashForView("Webhooks", { webhookScopeFilter: "pending" })).toBe("webhooks");
    expect(dashboardHashForView("Audit", { writeAuditScopeFilter: "attention" })).toBe("audit");
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

  it("maps personal day/week/month PR totals to period, created, and merged lists", () => {
    const person = {
      attentionPrs: [{ number: 99 }],
      pendingPrs: [{ number: 98 }],
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
            { number: 11, createdAt: "2026-07-01T09:00:00.000Z", mergedAt: null }
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
    expect(personalPrListTotalForScope(person, "period_all", "week")).toBe(5);
    expect(personalPrListTotalForScope(person, "created_period", "week")).toBe(3);
    expect(personalPrListTotalForScope(person, "attention", "day")).toBe(1);
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
      issuesInTesting: 1,
      averageActiveToFirstPrHours: 18,
      averageActiveToTestingHours: 42
    });
    expect(personalCriticalFlowEfficiencySummary(flow)).toBe("1/2 with PR | 1 in test");
    expect(flow.rows[0]).toMatchObject({ aiEffortLabel: "ai-easy", firstPrAfterActiveHours: 18 });
  });
});

function metricPoint(input: {
  date?: string;
  prsCreated?: number;
  prsMerged?: number;
  averagePendingPrAgeHours?: number | null;
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
    pendingPrs: 0,
    averagePendingPrAgeHours: input.averagePendingPrAgeHours ?? null,
    attentionPrs: 0,
    ciFailedPrs: 0,
    requestedChangePrs: 0,
    reviewWaitingPrs: 0,
    mergeConflictPrs: 0,
    testingQueueIssues: 0,
    averageTestingQueueAgeHours: null,
    sourceCompleteness: "complete_cache",
    generatedAt: "2026-07-05T00:00:00Z"
  } as const;
}
