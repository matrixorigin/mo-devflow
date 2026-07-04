import { describe, expect, it } from "vitest";
import type { CriticalIssueView, PersonalPullRequestView } from "@mo-devflow/shared";
import {
  criticalIssueReasons,
  personPrimaryReasons,
  personWorkloadStatus,
  prAttentionReasons,
  sortPeopleByWorkload
} from "./workbench";

describe("person workload summaries", () => {
  it("prioritizes active s-1/s0 work over lower-level queues", () => {
    expect(
      personWorkloadStatus({
        login: "alice",
        activeCriticalIssues: 1,
        needsTriageIssues: 10,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 0,
        attentionPrs: 0
      })
    ).toBe("critical");
  });

  it("sorts people by actionable workload weight", () => {
    const sorted = sortPeopleByWorkload([
      {
        login: "triage-owner",
        activeCriticalIssues: 0,
        needsTriageIssues: 20,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 0,
        attentionPrs: 0
      },
      {
        login: "critical-owner",
        activeCriticalIssues: 2,
        needsTriageIssues: 0,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 0,
        attentionPrs: 0
      }
    ]);

    expect(sorted.map((person) => person.login)).toEqual(["critical-owner", "triage-owner"]);
  });

  it("summarizes the first reasons a manager should inspect a person", () => {
    expect(
      personPrimaryReasons(
        {
          login: "bob",
          activeCriticalIssues: 0,
          needsTriageIssues: 3,
          deferredIssues: 1,
          prsCreatedYesterday: 0,
          prsMergedYesterday: 0,
          pendingPrs: 2,
          attentionPrs: 4
        },
        2
      )
    ).toEqual(["4 PR attention", "2 in testing", "3 needs triage", "2 pending PRs", "1 deferred"]);
  });
});

describe("work item attention reasons", () => {
  it("deduplicates PR attention reasons from flags and current state", () => {
    const pr = {
      attentionFlags: ["requested_changes", "ci_failed"],
      reviewDecision: "changes_requested",
      ciState: "failure",
      mergeStateStatus: "dirty",
      testingState: "test_changes_requested"
    } as PersonalPullRequestView;

    expect(prAttentionReasons(pr)).toEqual([
      "Changes requested",
      "CI failed",
      "Merge conflict",
      "Testing changes requested"
    ]);
  });

  it("includes active s-1/s0 issue blockers before generic evidence", () => {
    const issue: CriticalIssueView = {
      number: 42,
      title: "slow s0 bug",
      htmlUrl: "https://github.com/example/repo/issues/42",
      severity: "severity/s0",
      ownerLogin: "alice",
      ownerScope: "watched",
      ownerReason: "assignee",
      lifecycleState: "active",
      aiEffortLabel: "ai-easy",
      ageHours: 48,
      sourceUpdatedAt: "2026-07-04T00:00:00Z",
      lastSyncedAt: "2026-07-04T01:00:00Z",
      syncError: null,
      blockers: [
        { key: "issue:partial_cache", severity: "info", message: "Partial cache", relatedPrNumber: null },
        {
          key: "issue:slow_ai_easy",
          severity: "critical",
          message: "ai-easy has exceeded target",
          relatedPrNumber: null
        }
      ],
      isComplete: false,
      labels: ["kind/bug", "severity/s0", "ai-easy"],
      linkedPullRequests: []
    };

    expect(criticalIssueReasons(issue)).toEqual([
      "ai-easy has exceeded target",
      "No linked PR visible",
      "Partial cache evidence",
      "ai-easy"
    ]);
  });
});
