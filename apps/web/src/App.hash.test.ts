import { describe, expect, it } from "vitest";
import {
  criticalIssueAiFilterFromHash,
  criticalIssueOwnerFilterFromHash,
  criticalIssueScopeFilterFromHash,
  criticalIssueSortFromHash,
  criticalIssueTableSummary,
  dashboardHashForView,
  dashboardRefreshModeText,
  dashboardViewLimitTargetForKey,
  peopleScopeFilterFromHash,
  peopleSortLabel,
  peopleSortFromHash,
  pagedRangeLabel,
  personalDrilldownFilterFromHash,
  prBoardTabFromHash,
  prRotationTableSummary,
  prScopeHelp,
  prScopeFilterFromHash,
  prScopeLabel,
  prSortFromHash,
  serviceReadTokenStatusText,
  syncHealthCursorText
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

    const personalHash = dashboardHashForView("Personal", {
      personLogin: "alice",
      personalDrilldownFilter: "pr_attention"
    });
    expect(personalHash).toBe("personal?person=alice&drilldown=pr_attention");
    expect(personalDrilldownFilterFromHash(`#${personalHash}`)).toBe("pr_attention");
  });

  it("falls back from invalid filter params instead of preserving broken links", () => {
    const hash = "#prs?scope=triage&sort=unknown&tab=unknown";

    expect(prScopeFilterFromHash(hash)).toBe("all");
    expect(prSortFromHash(hash)).toBe("risk");
    expect(prBoardTabFromHash(hash)).toBe("rotation");
    expect(criticalIssueOwnerFilterFromHash("#issues?owner=owner%3A")).toBe("all");
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
    expect(dashboardViewLimitTargetForKey("workflow_violations")).toEqual({
      view: "Violations",
      label: "Open violations"
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
    expect(prScopeLabel("no_issue")).toBe("no visible issue after sync");
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
    expect(peopleSortLabel("testing_wait")).toBe("issue test wait");
  });
});
