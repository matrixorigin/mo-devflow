import { describe, expect, it } from "vitest";
import type {
  CriticalIssueView,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView
} from "@mo-devflow/shared";
import {
  criticalIssueReasons,
  personalActivityItems,
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

describe("personal activity feed", () => {
  it("prioritizes current issue and PR work with linked issue context", () => {
    const activeIssue = criticalIssue({
      number: 10,
      severity: "severity/s-1",
      linkedPullRequests: [
        {
          ...linkedPullRequest(),
          number: 100
        }
      ]
    });
    const attentionPr = pullRequest({
      number: 20,
      attentionFlags: ["requested_changes", "ci_failed"],
      reviewDecision: "changes_requested",
      ciState: "failure",
      linkedIssueNumbers: [10]
    });
    const triageIssue = personalIssue({ number: 30, lifecycleState: "needs-triage" });
    const person = personalView({
      activeCriticalIssues: [activeIssue],
      attentionPrs: [attentionPr],
      pendingPrs: [attentionPr],
      needsTriageIssues: [triageIssue]
    });

    const items = personalActivityItems(person);

    expect(items.map((item) => `${item.objectType}:${item.number}:${item.phase}`)).toEqual([
      "issue:10:Active s-1/s0",
      "pull_request:20:PR attention",
      "issue:30:Needs triage"
    ]);
    expect(items[0]?.linkedPullRequestNumbers).toEqual([100]);
    expect(items[1]?.linkedIssueNumbers).toEqual([10]);
    expect(items[1]?.reasons).toContain("Changes requested");
    expect(items[1]?.reasons).toContain("CI failed");
  });
});

function personalView(input: Partial<PersonalActionView>): PersonalActionView {
  return {
    login: "alice",
    summary: {
      login: "alice",
      activeCriticalIssues: input.activeCriticalIssues?.length ?? 0,
      needsTriageIssues: input.needsTriageIssues?.length ?? 0,
      deferredIssues: input.deferredIssues?.length ?? 0,
      prsCreatedYesterday: input.prsCreatedYesterday?.length ?? 0,
      prsMergedYesterday: input.prsMergedYesterday?.length ?? 0,
      pendingPrs: input.pendingPrs?.length ?? 0,
      attentionPrs: input.attentionPrs?.length ?? 0
    },
    activeCriticalIssues: input.activeCriticalIssues ?? [],
    needsTriageIssues: input.needsTriageIssues ?? [],
    deferredIssues: input.deferredIssues ?? [],
    pendingPrs: input.pendingPrs ?? [],
    attentionPrs: input.attentionPrs ?? [],
    testingPrs: input.testingPrs ?? [],
    prsCreatedYesterday: input.prsCreatedYesterday ?? [],
    prsMergedYesterday: input.prsMergedYesterday ?? [],
    analytics: [],
    analyticsWeekly: [],
    analyticsMonthly: []
  };
}

function personalIssue(input: Partial<PersonalIssueView>): PersonalIssueView {
  return {
    number: input.number ?? 1,
    title: input.title ?? "issue",
    htmlUrl: input.htmlUrl ?? "https://github.com/example/repo/issues/1",
    severity: input.severity ?? null,
    lifecycleState: input.lifecycleState ?? "needs-triage",
    ageHours: input.ageHours ?? 12,
    lastSyncedAt: input.lastSyncedAt ?? "2026-07-04T01:00:00Z",
    isComplete: input.isComplete ?? true,
    labels: input.labels ?? []
  };
}

function criticalIssue(input: Partial<CriticalIssueView>): CriticalIssueView {
  return {
    ...personalIssue(input),
    severity: input.severity ?? "severity/s0",
    ownerLogin: input.ownerLogin ?? "alice",
    ownerScope: input.ownerScope ?? "watched",
    ownerReason: input.ownerReason ?? "assignee",
    lifecycleState: input.lifecycleState ?? "active",
    aiEffortLabel: input.aiEffortLabel ?? "ai-easy",
    sourceUpdatedAt: input.sourceUpdatedAt ?? "2026-07-04T00:00:00Z",
    syncError: input.syncError ?? null,
    linkedPullRequests: input.linkedPullRequests ?? [],
    blockers: input.blockers ?? []
  };
}

function linkedPullRequest(): CriticalIssueView["linkedPullRequests"][number] {
  return {
    number: 100,
    title: "fix issue",
    htmlUrl: "https://github.com/example/repo/pull/100",
    state: "open",
    ownerLogin: "alice",
    ageHours: 24,
    lastHumanActionAt: "2026-07-03T00:00:00Z",
    reviewDecision: null,
    mergeStateStatus: null,
    ciState: null,
    testingState: "not_ready",
    testingTesters: [],
    testingQueueAgeHours: null,
    attentionFlags: [],
    linkedIssueNumbers: [10],
    isComplete: true
  };
}

function pullRequest(input: Partial<PersonalPullRequestView>): PersonalPullRequestView {
  return {
    number: input.number ?? 20,
    title: input.title ?? "fix bug",
    htmlUrl: input.htmlUrl ?? "https://github.com/example/repo/pull/20",
    ownerLogin: input.ownerLogin ?? "alice",
    draft: input.draft ?? false,
    ageHours: input.ageHours ?? 18,
    lastHumanActionAt: input.lastHumanActionAt ?? "2026-07-03T00:00:00Z",
    reviewDecision: input.reviewDecision ?? null,
    mergeStateStatus: input.mergeStateStatus ?? null,
    ciState: input.ciState ?? null,
    latestReviewState: input.latestReviewState ?? null,
    latestReviewSubmittedAt: input.latestReviewSubmittedAt ?? null,
    latestCommitAt: input.latestCommitAt ?? null,
    detailSyncedAt: input.detailSyncedAt ?? null,
    detailError: input.detailError ?? null,
    testingState: input.testingState ?? "not_ready",
    testingTesters: input.testingTesters ?? [],
    testingSignals: input.testingSignals ?? [],
    testingQueueAgeHours: input.testingQueueAgeHours ?? null,
    attentionFlags: input.attentionFlags ?? [],
    linkedIssueNumbers: input.linkedIssueNumbers ?? [],
    isComplete: input.isComplete ?? true,
    state: input.state ?? "open",
    createdAt: input.createdAt ?? "2026-07-03T00:00:00Z",
    mergedAt: input.mergedAt ?? null
  };
}
