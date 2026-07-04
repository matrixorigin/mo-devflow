import { describe, expect, it } from "vitest";
import type {
  CriticalIssueView,
  DailyMetricPoint,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  TestingIssueQueueView
} from "@mo-devflow/shared";
import {
  criticalIssueReasons,
  criticalIssueContextsByPullRequest,
  effectiveAiEffortLabel,
  flowEfficiencySummary,
  flowThreadDurationWarnings,
  flowThreadStatusCounts,
  observedPeopleFromDashboard,
  observedOwnerThreads,
  personalActionQueueCounts,
  personalActionQueueItemsForFilter,
  personalFlowThreadCounts,
  personalFlowThreadMatchesFilter,
  personalGanttChart,
  personalActivityItems,
  personalActivityNextAction,
  personalDurationText,
  personalIssueReasons,
  personPrimaryReasons,
  personWorkloadStatus,
  prAttentionReasons,
  sortTestingIssuesForAction,
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
    ).toEqual(["4 PR attention", "2 testing work", "3 needs triage", "2 pending PRs", "1 deferred"]);
  });

  it("derives observed owners from visible critical issues and pending PRs when watched users are absent", () => {
    const people = observedPeopleFromDashboard({
      criticalIssues: [
        criticalIssue({ number: 1, ownerLogin: "issue-owner" }),
        criticalIssue({ number: 2, ownerLogin: "shared-owner" }),
        criticalIssue({ number: 3, ownerLogin: null })
      ],
      pendingPrs: [
        pullRequest({ number: 10, ownerLogin: "shared-owner", attentionFlags: ["ci_failed"] }),
        pullRequest({ number: 11, ownerLogin: "pr-owner" }),
        pullRequest({ number: 12, ownerLogin: "pr-owner", attentionFlags: ["review_requested_no_response"] })
      ]
    });

    expect(people).toEqual([
      {
        login: "shared-owner",
        activeCriticalIssues: 1,
        needsTriageIssues: 0,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 1,
        attentionPrs: 1
      },
      {
        login: "issue-owner",
        activeCriticalIssues: 1,
        needsTriageIssues: 0,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 0,
        attentionPrs: 0
      },
      {
        login: "pr-owner",
        activeCriticalIssues: 0,
        needsTriageIssues: 0,
        deferredIssues: 0,
        prsCreatedYesterday: 0,
        prsMergedYesterday: 0,
        pendingPrs: 2,
        attentionPrs: 1
      }
    ]);
  });
});

describe("work item attention reasons", () => {
  it("treats missing AI effort labels as ai-easy", () => {
    expect(effectiveAiEffortLabel(null)).toBe("ai-easy");
    expect(effectiveAiEffortLabel("ai-manual")).toBe("ai-manual");
  });

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
      "Issue test changes requested"
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
      workflowSkipped: false,
      lifecycleState: "active",
      aiEffortLabel: "ai-easy",
      ageHours: 48,
      criticalStartedAt: "2026-07-02T00:00:00Z",
      criticalAgeHours: 48,
      criticalAgeEvidence: "issue_timeline_event",
      lastHumanActionAt: "2026-07-03T00:00:00Z",
      lastHumanActionEvidence: "complete_cache",
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
      "Incomplete cache evidence",
      "ai-easy"
    ]);
  });

  it("surfaces deferred comment evidence without exposing comment bodies", () => {
    expect(
      personalIssueReasons(
        personalIssue({
          lifecycleState: "deferred",
          commentEvidence: { state: "pending", lastSyncedAt: null, syncError: null }
        })
      )
    ).toEqual(["Deferred follow-up", "Defer comments pending"]);

    expect(
      personalIssueReasons(
        personalIssue({
          lifecycleState: "deferred",
          commentEvidence: {
            state: "complete",
            lastSyncedAt: "2026-07-04T02:00:00Z",
            syncError: null
          }
        })
      )
    ).toEqual(["Deferred follow-up", "Defer comments checked"]);
  });

  it("uses deferred comment evidence to pick the next action", () => {
    const [pendingDeferred] = personalActivityItems(
      personalView({
        deferredIssues: [
          personalIssue({
            lifecycleState: "deferred",
            commentEvidence: { state: "missing", lastSyncedAt: null, syncError: null }
          })
        ]
      })
    );
    const [checkedDeferred] = personalActivityItems(
      personalView({
        deferredIssues: [
          personalIssue({
            number: 2,
            lifecycleState: "deferred",
            commentEvidence: {
              state: "complete",
              lastSyncedAt: "2026-07-04T02:00:00Z",
              syncError: null
            }
          })
        ]
      })
    );

    expect(personalActivityNextAction(pendingDeferred)).toBe("Backfill issue comments");
    expect(personalActivityNextAction(checkedDeferred)).toBe("Review defer reason");
  });

  it("indexes many-to-many active issue context by linked PR", () => {
    const contexts = criticalIssueContextsByPullRequest([
      criticalIssue({
        number: 42,
        severity: "severity/s0",
        aiEffortLabel: "ai-heavy",
        criticalAgeHours: 72,
        linkedPullRequests: [
          {
            ...linkedPullRequest(),
            number: 100,
            linkedIssueNumbers: [42, 43]
          }
        ]
      }),
      criticalIssue({
        number: 43,
        severity: "severity/s-1",
        aiEffortLabel: null,
        ownerLogin: "bob",
        ownerScope: "non_watched",
        criticalAgeHours: 8,
        blockers: [{ key: "issue:blocked", severity: "critical", message: "blocked", relatedPrNumber: 100 }],
        linkedPullRequests: [
          {
            ...linkedPullRequest(),
            number: 100,
            linkedIssueNumbers: [42, 43]
          },
          {
            ...linkedPullRequest(),
            number: 101,
            linkedIssueNumbers: [43]
          }
        ]
      })
    ]);

    expect(contexts.get(100)?.map((issue) => `${issue.number}:${issue.severity}:${issue.aiEffortLabel}`)).toEqual([
      "43:severity/s-1:ai-easy",
      "42:severity/s0:ai-heavy"
    ]);
    expect(contexts.get(101)?.map((issue) => issue.number)).toEqual([43]);
  });
});

describe("flow efficiency summary", () => {
  it("summarizes PR and issue rotation efficiency from cached metrics and queues", () => {
    const summary = flowEfficiencySummary({
      points: [
        metricPoint({
          prsCreated: 4,
          prsMerged: 3,
          issuesOpened: 5,
          issuesClosed: 2,
          issuesDeferred: 1,
          workflowViolationsDetected: 2
        }),
        metricPoint({
          prsCreated: 2,
          prsMerged: 1,
          issuesOpened: 1,
          issuesClosed: 2,
          issuesDeferred: 0,
          workflowViolationsDetected: 1
        })
      ],
      pendingPrs: [
        pullRequest({
          ageHours: 24,
          attentionFlags: ["ci_failed"],
          testingState: "test_requested",
          testingQueueAgeHours: 30
        }),
        pullRequest({ ageHours: 12, attentionFlags: [], testingState: "not_ready", testingQueueAgeHours: null })
      ],
      activeIssues: [criticalIssue({ ageHours: 48 }), criticalIssue({ ageHours: 24 })]
    });

    expect(summary).toMatchObject({
      prsCreated: 6,
      prsMerged: 4,
      prOpenDelta: 2,
      prMergeRatePercent: 67,
      issuesOpened: 6,
      issuesResolved: 5,
      issueOpenDelta: 1,
      issueDrainRatePercent: 83,
      workflowViolations: 3,
      pendingPrs: 2,
      averagePendingPrAgeHours: 18,
      attentionPrs: 1,
      prAttentionRatePercent: 50,
      activeCriticalIssues: 2,
      averageActiveIssueAgeHours: 36,
      testingQueuePrs: 1,
      averageTestingQueueAgeHours: 30
    });
  });

  it("can summarize issue-level testing queues when the repo uses issue assignment handoff", () => {
    const summary = flowEfficiencySummary({
      points: [],
      pendingPrs: [],
      activeIssues: [],
      testingIssues: [testingIssue({ queueAgeHours: 30 }), testingIssue({ queueAgeHours: 6 })]
    });

    expect(summary.testingQueuePrs).toBe(2);
    expect(summary.averageTestingQueueAgeHours).toBe(18);
  });
});

describe("testing issue action order", () => {
  it("puts stale issues and linked PR blockers before routine test assignments", () => {
    const sorted = sortTestingIssuesForAction([
      testingIssue({ number: 30, queueAgeHours: 4, linkedPullRequests: [linkedPullRequest()] }),
      testingIssue({
        number: 20,
        queueAgeHours: 6,
        linkedPullRequests: [{ ...linkedPullRequest(), attentionFlags: ["ci_failed"], ciState: "failure" }]
      }),
      testingIssue({ number: 10, queueAgeHours: 30, linkedPullRequests: [] })
    ]);

    expect(sorted.map((issue) => issue.number)).toEqual([10, 20, 30]);
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

  it("uses s-1/s0 activation duration for active critical issues", () => {
    const person = personalView({
      activeCriticalIssues: [criticalIssue({ ageHours: 240, criticalAgeHours: 18 })]
    });

    const [item] = personalActivityItems(person);

    expect(item?.durationKind).toBe("critical_active");
    expect(item?.durationHours).toBe(18);
    expect(personalDurationText(item!)).toBe("s0/s-1 18h");
  });

  it("filters action queue metrics to the corresponding objects", () => {
    const activeIssue = criticalIssue({
      number: 10,
      linkedPullRequests: []
    });
    const blockedPr = pullRequest({
      number: 20,
      attentionFlags: ["ci_failed"],
      ciState: "failure",
      linkedIssueNumbers: [10]
    });
    const testingPr = pullRequest({
      number: 21,
      testingState: "testing",
      testingQueueAgeHours: 30,
      linkedIssueNumbers: [10]
    });
    const testingIssueItem = testingIssue({
      number: 40,
      queueAgeHours: null,
      linkedPullRequests: [linkedPullRequest()]
    });
    const unlinkedPr = pullRequest({
      number: 22,
      linkedIssueNumbers: []
    });
    const triageIssue = personalIssue({ number: 30, lifecycleState: "needs-triage" });
    const items = personalActivityItems(
      personalView({
        activeCriticalIssues: [activeIssue],
        attentionPrs: [blockedPr],
        testingIssues: [testingIssueItem],
        testingPrs: [testingPr],
        pendingPrs: [blockedPr, testingPr, unlinkedPr],
        needsTriageIssues: [triageIssue]
      })
    );

    expect(personalActionQueueCounts(items)).toMatchObject({
      all: 6,
      critical: 1,
      pr_blockers: 2,
      issues: 3,
      testing: 2,
      prs: 3,
      needs_link: 2
    });
    expect(personalActionQueueItemsForFilter(items, "critical").map((item) => item.id)).toEqual(["issue:10"]);
    expect(personalActionQueueItemsForFilter(items, "pr_blockers").map((item) => item.id)).toEqual([
      "pull_request:20",
      "pull_request:21"
    ]);
    expect(personalActionQueueItemsForFilter(items, "testing").map((item) => item.id)).toEqual([
      "pull_request:21",
      "testing_issue:40"
    ]);
    expect(personalActionQueueItemsForFilter(items, "needs_link").map((item) => item.id)).toEqual([
      "issue:10",
      "pull_request:22"
    ]);
    expect(items.find((item) => item.id === "pull_request:21")).toMatchObject({
      phase: "Linked issue test evidence",
      reasons: ["Linked issue test wait visible"]
    });
    expect(personalActivityNextAction(items.find((item) => item.id === "pull_request:21")!)).toBe(
      "Check linked issue test status"
    );
  });

  it("shows issue label timeline evidence for issue-level testing activity", () => {
    const items = personalActivityItems(
      personalView({
        testingIssues: [
          testingIssue({
            number: 77,
            testingSignals: ["issue_label:#77:testing"],
            testers: [],
            queueAgeEvidence: "issue_label_event"
          })
        ]
      })
    );

    expect(items[0]?.id).toBe("testing_issue:77");
    expect(items[0]?.durationEvidence).toBe("GitHub issue label event");
    expect(personalActivityNextAction(items[0]!)).toBe("Link the tested PR");
  });

  it("asks for issue test status after a linked testing issue waits too long", () => {
    const items = personalActivityItems(
      personalView({
        testingIssues: [
          testingIssue({
            number: 78,
            queueAgeHours: 30,
            linkedPullRequests: [linkedPullRequest()]
          })
        ]
      })
    );

    expect(personalActivityNextAction(items[0]!)).toBe("Check issue test status");
  });
});

describe("personal gantt chart", () => {
  it("keeps many-to-many issue and PR links visible", () => {
    const sharedPr = pullRequest({
      number: 20,
      ageHours: 48,
      createdAt: "2026-07-02T00:00:00.000Z",
      linkedIssueNumbers: [10, 11],
      attentionFlags: ["ci_failed"],
      ciState: "failure"
    });
    const unlinkedPr = pullRequest({
      number: 21,
      ageHours: 12,
      createdAt: "2026-07-03T12:00:00.000Z",
      linkedIssueNumbers: []
    });
    const outsideIssuePr = pullRequest({
      number: 22,
      ageHours: 10,
      createdAt: "2026-07-03T14:00:00.000Z",
      linkedIssueNumbers: [999]
    });
    const person = personalView({
      activeCriticalIssues: [
        criticalIssue({
          number: 10,
          linkedPullRequests: [
            {
              ...linkedPullRequest(),
              number: 20,
              linkedIssueNumbers: [10, 11]
            }
          ]
        }),
        criticalIssue({ number: 11, linkedPullRequests: [] })
      ],
      pendingPrs: [sharedPr, unlinkedPr, outsideIssuePr],
      attentionPrs: [sharedPr]
    });

    const chart = personalGanttChart(person, "2026-07-04T00:00:00.000Z");
    const issue10 = chart.rows.find((row) => row.id === "issue:10");
    const issue11 = chart.rows.find((row) => row.id === "issue:11");
    const otherPrs = chart.rows.find((row) => row.id === "other-prs");

    expect(issue10?.prs.map((pr) => pr.number)).toEqual([20]);
    expect(issue11?.prs.map((pr) => pr.number)).toEqual([20]);
    expect(issue10?.prs[0]?.isShared).toBe(true);
    expect(issue11?.prs[0]?.isShared).toBe(true);
    expect(otherPrs?.prs.map((pr) => pr.number)).toEqual([21, 22]);
    expect(chart.sharedPrCount).toBe(1);
    expect(chart.unlinkedPrCount).toBe(1);
    expect(chart.outsideIssuePrCount).toBe(1);
    expect(flowThreadStatusCounts(issue10!)).toMatchObject({
      prs: 1,
      blockedPrs: 1,
      testingPrs: 0,
      sharedPrs: 1,
      unlinkedPrs: 0
    });
    expect(flowThreadStatusCounts(otherPrs!)).toMatchObject({
      prs: 2,
      blockedPrs: 0,
      testingPrs: 0,
      sharedPrs: 0,
      unlinkedPrs: 1
    });
    expect(personalFlowThreadCounts(chart.rows)).toMatchObject({
      all: 3,
      critical: 2,
      blocked: 3,
      testing: 0,
      needs_link: 1,
      shared: 2
    });
    expect(personalFlowThreadMatchesFilter(issue10!, "shared")).toBe(true);
    expect(personalFlowThreadMatchesFilter(otherPrs!, "needs_link")).toBe(true);
  });

  it("does not use issue created age as active severity duration when timeline evidence is missing", () => {
    const person = personalView({
      activeCriticalIssues: [
        criticalIssue({
          number: 10,
          ageHours: 240,
          criticalStartedAt: null,
          criticalAgeHours: null,
          criticalAgeEvidence: "missing_timeline"
        })
      ]
    });

    const chart = personalGanttChart(person, "2026-07-04T00:00:00.000Z");
    const issue = chart.rows.find((row) => row.id === "issue:10")?.issue;

    expect(issue?.durationHours).toBeNull();
    expect(issue?.startAgeHours).toBe(0);
    expect(flowThreadDurationWarnings(chart.rows[0]!)).toContain("missing severity timeline");
    expect(personalFlowThreadMatchesFilter(chart.rows[0]!, "blocked")).toBe(true);
    expect(personalFlowThreadMatchesFilter(chart.rows[0]!, "needs_link")).toBe(true);
  });

  it("filters personal work threads by issue testing state", () => {
    const person = personalView({
      activeCriticalIssues: [
        criticalIssue({
          number: 10,
          linkedPullRequests: [
            {
              ...linkedPullRequest(),
              number: 20,
              testingState: "testing",
              testingQueueAgeHours: 30,
              attentionFlags: ["testing_stalled"]
            }
          ]
        })
      ],
      testingPrs: [
        pullRequest({
          number: 20,
          linkedIssueNumbers: [10],
          testingState: "testing",
          testingQueueAgeHours: 30,
          attentionFlags: ["testing_stalled"]
        })
      ]
    });

    const row = personalGanttChart(person, "2026-07-04T00:00:00.000Z").rows[0]!;

    expect(personalFlowThreadMatchesFilter(row, "testing")).toBe(true);
    expect(personalFlowThreadMatchesFilter(row, "blocked")).toBe(true);
    expect(personalFlowThreadCounts([row])).toMatchObject({
      all: 1,
      testing: 1,
      blocked: 1
    });
  });

  it("builds issue-level testing threads with linked PR evidence", () => {
    const person = personalView({
      testingIssues: [
        testingIssue({
          number: 77,
          queueAgeHours: 30,
          linkedPullRequests: [
            {
              ...linkedPullRequest(),
              number: 88,
              title: "tested fix"
            }
          ]
        })
      ]
    });

    const row = personalGanttChart(person, "2026-07-04T00:00:00.000Z").rows[0]!;

    expect(row.id).toBe("issue:77");
    expect(row.issue.durationKind).toBe("testing_queue");
    expect(row.issue.durationHours).toBe(30);
    expect(row.prs.map((pr) => pr.number)).toEqual([88]);
    expect(row.prs[0]?.linkedIssueNumbers).toEqual([77]);
    expect(flowThreadStatusCounts(row)).toMatchObject({
      prs: 1,
      testingIssues: 1,
      testingPrs: 1,
      unlinkedPrs: 0
    });
    expect(flowThreadDurationWarnings(row)).toContain("issue test wait over 24h");
    expect(personalFlowThreadMatchesFilter(row, "testing")).toBe(true);
  });

  it("keeps issue label timeline evidence visible in testing gantt rows", () => {
    const person = personalView({
      testingIssues: [
        testingIssue({
          number: 77,
          testingSignals: ["issue_label:#77:testing"],
          testers: [],
          queueAgeEvidence: "issue_label_event"
        })
      ]
    });

    const row = personalGanttChart(person, "2026-07-04T00:00:00.000Z").rows[0]!;

    expect(row.issue.durationEvidence).toBe("GitHub issue label event");
    expect(row.issue.reasons).toContain("Issue label handoff");
  });
});

describe("observed owner threads", () => {
  it("groups observed owner PRs under visible active issues before falling back to other PR work", () => {
    const linkedAttentionPr = pullRequest({
      number: 20,
      ageHours: 30,
      linkedIssueNumbers: [10],
      attentionFlags: ["no_human_action_24h"]
    });
    const unlinkedPr = pullRequest({
      number: 21,
      ageHours: 12,
      linkedIssueNumbers: []
    });
    const outsideIssuePr = pullRequest({
      number: 22,
      ageHours: 8,
      linkedIssueNumbers: [999]
    });

    const threads = observedOwnerThreads(
      [
        criticalIssue({
          number: 10,
          severity: "severity/s0",
          criticalAgeHours: 48,
          linkedPullRequests: [
            {
              ...linkedPullRequest(),
              number: 20
            }
          ]
        }),
        criticalIssue({
          number: 11,
          severity: "severity/s-1",
          criticalAgeHours: null,
          linkedPullRequests: []
        })
      ],
      [linkedAttentionPr, unlinkedPr, outsideIssuePr]
    );

    expect(threads.map((thread) => thread.id)).toEqual(["issue:11", "issue:10", "other-prs"]);
    expect(threads.find((thread) => thread.id === "issue:10")?.prs.map((pr) => pr.number)).toEqual([20]);
    expect(threads.find((thread) => thread.id === "issue:10")).toMatchObject({
      tone: "critical",
      durationHours: 48,
      needsLink: false
    });
    expect(threads.find((thread) => thread.id === "issue:11")).toMatchObject({
      tone: "critical",
      durationHours: null,
      needsLink: true
    });
    expect(threads.find((thread) => thread.id === "other-prs")).toMatchObject({
      tone: "normal",
      durationHours: 12,
      linkedIssueNumbers: [999],
      needsLink: true
    });
  });
});

function metricPoint(input: Partial<DailyMetricPoint>): DailyMetricPoint {
  return {
    date: input.date ?? "2026-07-04",
    scopeType: input.scopeType ?? "team",
    scopeKey: input.scopeKey ?? "team",
    prsCreated: input.prsCreated ?? 0,
    prsMerged: input.prsMerged ?? 0,
    issuesOpened: input.issuesOpened ?? 0,
    issuesClosed: input.issuesClosed ?? 0,
    issuesDeferred: input.issuesDeferred ?? 0,
    workflowViolationsDetected: input.workflowViolationsDetected ?? 0,
    activeCriticalIssues: input.activeCriticalIssues ?? 0,
    averageActiveCriticalIssueAgeHours: input.averageActiveCriticalIssueAgeHours ?? null,
    needsTriageIssues: input.needsTriageIssues ?? 0,
    averageNeedsTriageIssueAgeHours: input.averageNeedsTriageIssueAgeHours ?? null,
    deferredIssues: input.deferredIssues ?? 0,
    averageDeferredIssueAgeHours: input.averageDeferredIssueAgeHours ?? null,
    pendingPrs: input.pendingPrs ?? 0,
    averagePendingPrAgeHours: input.averagePendingPrAgeHours ?? null,
    attentionPrs: input.attentionPrs ?? 0,
    ciFailedPrs: input.ciFailedPrs ?? 0,
    requestedChangePrs: input.requestedChangePrs ?? 0,
    reviewWaitingPrs: input.reviewWaitingPrs ?? 0,
    mergeConflictPrs: input.mergeConflictPrs ?? 0,
    testingQueuePrs: input.testingQueuePrs ?? 0,
    averageTestingQueueAgeHours: input.averageTestingQueueAgeHours ?? null,
    sourceCompleteness: input.sourceCompleteness ?? "complete_cache",
    generatedAt: input.generatedAt ?? "2026-07-04T00:00:00Z"
  };
}

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
    testingIssues: input.testingIssues ?? [],
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
    commentEvidence: input.commentEvidence ?? {
      state: "complete",
      lastSyncedAt: "2026-07-04T01:00:00Z",
      syncError: null
    },
    labels: input.labels ?? []
  };
}

function criticalIssue(input: Partial<CriticalIssueView>): CriticalIssueView {
  return {
    ...personalIssue(input),
    severity: input.severity ?? "severity/s0",
    ownerLogin: input.ownerLogin === undefined ? "alice" : input.ownerLogin,
    ownerScope: input.ownerScope ?? "watched",
    ownerReason: input.ownerReason ?? "assignee",
    workflowSkipped: input.workflowSkipped ?? false,
    lifecycleState: input.lifecycleState ?? "active",
    aiEffortLabel: input.aiEffortLabel ?? "ai-easy",
    lastHumanActionAt: input.lastHumanActionAt ?? "2026-07-03T00:00:00Z",
    lastHumanActionEvidence: input.lastHumanActionEvidence ?? "complete_cache",
    criticalStartedAt: input.criticalStartedAt === undefined ? "2026-07-03T00:00:00Z" : input.criticalStartedAt,
    criticalAgeHours: input.criticalAgeHours === undefined ? 24 : input.criticalAgeHours,
    criticalAgeEvidence: input.criticalAgeEvidence ?? "issue_timeline_event",
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

function testingIssue(input: Partial<TestingIssueQueueView>): TestingIssueQueueView {
  return {
    number: input.number ?? 50,
    title: input.title ?? "issue in test",
    htmlUrl: input.htmlUrl ?? "https://github.com/example/repo/issues/50",
    testers: input.testers ?? ["tester-a"],
    testingSignals: input.testingSignals ?? ["issue_assignee:#50:tester-a"],
    queueAgeHours: input.queueAgeHours === undefined ? 12 : input.queueAgeHours,
    queueStartedAt: input.queueStartedAt ?? "2026-07-03T13:00:00Z",
    queueAgeEvidence: input.queueAgeEvidence ?? "issue_assignment_event",
    linkedPullRequests: input.linkedPullRequests ?? [],
    isComplete: input.isComplete ?? true,
    syncError: input.syncError ?? null,
    lastSyncedAt: input.lastSyncedAt ?? "2026-07-04T01:00:00Z"
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
