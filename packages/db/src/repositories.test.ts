import { describe, expect, test } from "vitest";
import type {
  CriticalIssueLinkedPullRequestView,
  DailyMetricPoint,
  NormalizedPullRequest,
  RepoProfile,
  TestingTransitionView
} from "@mo-devflow/shared";
import { extractLinkedIssueNumbers } from "@mo-devflow/shared";
import {
  aggregateMetricPoints,
  attentionItemsToResolve,
  buildSyncHealthSummary,
  cacheStaleHoursFromEnv,
  calendarDayRangeInTimezone,
  criticalIssueBlockersFromCache,
  criticalIssueOwnerCoverage,
  criticalIssueOwnershipCounts,
  criticalIssueOwnerScope,
  dateKeyInTimezone,
  dashboardVisibilityFilter,
  isPersonalNeedsTriageIssue,
  notificationEmployeeMappingCandidates,
  previousCalendarDayRange,
  profileActionSuggestions,
  profileConfigurationWarnings,
  profileSetupPlan,
  pullRequestTestingTransitionForUpsert,
  testingTurnoverMetricsByTesterFromTransitions,
  testingTurnoverMetricsFromTransitions,
  testingTransitionViewFromRow,
  testingReviewerCoverage,
  visibleClassesForDashboard
} from "./repositories";
import { workflowFixOperationsFromJson, writeActionExecutionViewFromRow } from "./writeActions";

const baseProfile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: true
  },
  people: { watchedUsers: [], testers: [] },
  ownership: {
    issueOwnerPriority: ["assignee", "linked_pr_author", "author"],
    prOwner: "author",
    unownedBucket: true
  },
  labels: {
    bug: "kind/bug",
    needsTriage: "needs-triage",
    deferred: "deferred",
    critical: ["severity/s-1", "severity/s0"],
    active: ["severity/s-1", "severity/s0", "severity/s1"],
    aiEffort: ["ai-easy", "ai-light", "ai-medium", "ai-heavy", "ai-manual"]
  },
  thresholds: {
    prNoActionAttentionHours: 24,
    criticalNoActionAttentionHours: 24,
    aiEasyS0ToTestAttentionDays: 7,
    needsTriageStaleHours: 72,
    prematureSeverityWindowHours: 24,
    aiEasyCriticalCriticalDays: 14
  },
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] }
  },
  workflow: {
    skipUsers: []
  },
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group", escalateAfterHours: 24 }
  },
  raw: {}
};

describe("dashboard visibility", () => {
  test("anonymous viewers only see anonymous-readable cache objects", () => {
    expect(visibleClassesForDashboard(baseProfile, { authenticated: false, userId: null })).toEqual([
      "anonymous_readable"
    ]);
  });

  test("logged-in viewers can see anonymous and logged-in readable cache objects", () => {
    expect(visibleClassesForDashboard(baseProfile, { authenticated: true, userId: null })).toEqual([
      "anonymous_readable",
      "logged_in_readable"
    ]);
  });

  test("logged-in viewers with a user id can see their own token-owned cache objects", () => {
    expect(visibleClassesForDashboard(baseProfile, { authenticated: true, userId: 42 })).toEqual([
      "anonymous_readable",
      "logged_in_readable",
      "token_owner_only"
    ]);
  });

  test("anonymous viewers see no GitHub cache objects when anonymous read is disabled", () => {
    expect(
      visibleClassesForDashboard(
        {
          ...baseProfile,
          access: {
            ...baseProfile.access,
            anonymousRead: false
          }
        },
        { authenticated: false, userId: null }
      )
    ).toEqual([]);
  });

  test("enforces token-owner visibility with source user id", () => {
    expect(dashboardVisibilityFilter("i", baseProfile, { authenticated: false, userId: null })).toEqual({
      sql: "i.visibility_class IN ('anonymous_readable')",
      params: []
    });
    expect(dashboardVisibilityFilter("i", baseProfile, { authenticated: true, userId: null })).toEqual({
      sql: "i.visibility_class IN ('anonymous_readable', 'logged_in_readable')",
      params: []
    });
    expect(dashboardVisibilityFilter("i", baseProfile, { authenticated: true, userId: 42 })).toEqual({
      sql: "(i.visibility_class IN ('anonymous_readable', 'logged_in_readable') OR (i.visibility_class = 'token_owner_only' AND i.source_user_id = ?))",
      params: [42]
    });
  });
});

describe("write action audit view", () => {
  test("parses only supported workflow operations for dashboard audit output", () => {
    expect(
      workflowFixOperationsFromJson(
        JSON.stringify([
          { type: "add_label", label: "needs-triage" },
          { type: "remove_label", label: "severity/s0" },
          { type: "add_comment", body: "Deferred with reason." },
          { type: "add_label", label: "" },
          { type: "unknown", label: "ignored" },
          "not-an-operation"
        ])
      )
    ).toEqual([
      { type: "add_label", label: "needs-triage" },
      { type: "remove_label", label: "severity/s0" },
      { type: "add_comment", body: "Deferred with reason." }
    ]);
  });

  test("drops malformed workflow operation JSON instead of exposing raw payloads", () => {
    expect(workflowFixOperationsFromJson("{not-json")).toEqual([]);
    expect(workflowFixOperationsFromJson(JSON.stringify({ type: "add_label", label: "needs-triage" }))).toEqual([]);
  });

  test("maps write execution rows to frontend-safe audit summaries", () => {
    expect(
      writeActionExecutionViewFromRow({
        id: 12,
        preview_id: "preview-1",
        github_login: "alice",
        action_key: "move_to_deferred",
        object_type: "issue",
        object_number: 42,
        object_title: "panic on insert",
        object_html_url: "https://github.com/matrixorigin/matrixone/issues/42",
        status: "success",
        operations_json: JSON.stringify([
          { type: "remove_label", label: "severity/s0" },
          { type: "add_label", label: "deferred" }
        ]),
        github_response_json: JSON.stringify({ provider: "not returned by mapper" }),
        error_message: null,
        started_at: "2026-07-04 01:02:03",
        finished_at: "2026-07-04 01:02:04"
      })
    ).toEqual({
      id: 12,
      previewId: "preview-1",
      githubLogin: "alice",
      actionKey: "move_to_deferred",
      objectType: "issue",
      objectNumber: 42,
      title: "panic on insert",
      htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
      status: "success",
      executedOperations: [
        { type: "remove_label", label: "severity/s0" },
        { type: "add_label", label: "deferred" }
      ],
      errorMessage: null,
      startedAt: "2026-07-04T01:02:03Z",
      finishedAt: "2026-07-04T01:02:04Z"
    });
  });

  test("maps notification delivery write audit rows", () => {
    expect(
      writeActionExecutionViewFromRow({
        id: 13,
        preview_id: "audit:00000000-0000-4000-8000-000000000000",
        github_login: "alice",
        action_key: "acknowledge_notification",
        object_type: "notification_delivery",
        object_number: "900719",
        object_title: "notification_delivery #900719",
        object_html_url: null,
        status: "success",
        operations_json: JSON.stringify([]),
        error_message: null,
        started_at: "2026-07-04 02:03:04",
        finished_at: "2026-07-04 02:03:04"
      })
    ).toEqual({
      id: 13,
      previewId: "audit:00000000-0000-4000-8000-000000000000",
      githubLogin: "alice",
      actionKey: "acknowledge_notification",
      objectType: "notification_delivery",
      objectNumber: 900719,
      title: "notification_delivery #900719",
      htmlUrl: null,
      status: "success",
      executedOperations: [],
      errorMessage: null,
      startedAt: "2026-07-04T02:03:04Z",
      finishedAt: "2026-07-04T02:03:04Z"
    });
  });
});

describe("cache freshness", () => {
  test("uses a conservative default stale threshold", () => {
    expect(cacheStaleHoursFromEnv({})).toBe(6);
  });

  test("accepts configured positive stale threshold and ignores invalid values", () => {
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "0.5" })).toBe(0.5);
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "not-a-number" })).toBe(6);
    expect(cacheStaleHoursFromEnv({ MO_DEVFLOW_CACHE_STALE_HOURS: "-1" })).toBe(6);
  });
});

describe("sync health summary", () => {
  test("keeps one row per sync layer with latest attempt and latest success", () => {
    expect(
      buildSyncHealthSummary({
        expectedLayers: ["github_sync", "metrics"],
        rows: [
          {
            sync_layer: "github_sync",
            status: "failed",
            started_at: "2026-07-04 10:00:00",
            finished_at: "2026-07-04 10:01:00",
            error_message: "rate limited",
            rate_limit_remaining: 0,
            last_successful_at: "2026-07-04 08:01:00"
          },
          {
            sync_layer: "metrics",
            status: "success",
            started_at: "2026-07-04 09:00:00",
            finished_at: "2026-07-04 09:00:05",
            error_message: null,
            rate_limit_remaining: null,
            last_successful_at: "2026-07-04 09:00:05"
          }
        ]
      })
    ).toEqual([
      {
        layer: "github_sync",
        status: "failed",
        lastSuccessfulAt: "2026-07-04T08:01:00Z",
        lastAttemptedAt: "2026-07-04T10:00:00Z",
        errorMessage: "rate limited",
        rateLimitRemaining: 0
      },
      {
        layer: "metrics",
        status: "success",
        lastSuccessfulAt: "2026-07-04T09:00:05Z",
        lastAttemptedAt: "2026-07-04T09:00:00Z",
        errorMessage: null,
        rateLimitRemaining: null
      }
    ]);
  });

  test("marks expected sync layers that have never run", () => {
    expect(
      buildSyncHealthSummary({
        expectedLayers: ["github_sync", "rules", "metrics"],
        rows: [
          {
            sync_layer: "rules",
            status: "success",
            started_at: "2026-07-04 09:00:00",
            error_message: null,
            rate_limit_remaining: null,
            last_successful_at: "2026-07-04 09:00:05"
          }
        ]
      })
    ).toEqual([
      {
        layer: "github_sync",
        status: "not_started",
        lastSuccessfulAt: null,
        lastAttemptedAt: null,
        errorMessage: "Sync layer has not recorded a run yet.",
        rateLimitRemaining: null
      },
      {
        layer: "rules",
        status: "success",
        lastSuccessfulAt: "2026-07-04T09:00:05Z",
        lastAttemptedAt: "2026-07-04T09:00:00Z",
        errorMessage: null,
        rateLimitRemaining: null
      },
      {
        layer: "metrics",
        status: "not_started",
        lastSuccessfulAt: null,
        lastAttemptedAt: null,
        errorMessage: "Sync layer has not recorded a run yet.",
        rateLimitRemaining: null
      }
    ]);
  });
});

describe("personal issue buckets", () => {
  test("keeps critical issues out of the personal needs-triage action bucket", () => {
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "needs-triage", severity: "severity/s0" },
        baseProfile.labels.critical
      )
    ).toBe(false);
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "needs-triage", severity: null },
        baseProfile.labels.critical
      )
    ).toBe(true);
    expect(
      isPersonalNeedsTriageIssue(
        { lifecycleState: "deferred", severity: null },
        baseProfile.labels.critical
      )
    ).toBe(false);
  });
});

describe("critical issue ownership counts", () => {
  test("summarizes critical owner coverage for configuration follow-up", () => {
    expect(
      criticalIssueOwnerCoverage([
        { ownerLogin: "alice", ownerScope: "watched", ageHours: 2 },
        { ownerLogin: "Carol", ownerScope: "non_watched", ageHours: 4 },
        { ownerLogin: "carol", ownerScope: "non_watched", ageHours: 8 },
        { ownerLogin: null, ownerScope: "unowned", ageHours: 10 },
        { ownerLogin: null, ownerScope: "unowned", ageHours: 2 },
        { ownerLogin: "bob", ownerScope: "non_watched", ageHours: 20 }
      ])
    ).toEqual([
      { ownerLogin: null, ownerScope: "unowned", criticalIssues: 2, averageAgeHours: 6 },
      { ownerLogin: "Carol", ownerScope: "non_watched", criticalIssues: 2, averageAgeHours: 6 },
      { ownerLogin: "bob", ownerScope: "non_watched", criticalIssues: 1, averageAgeHours: 20 },
      { ownerLogin: "alice", ownerScope: "watched", criticalIssues: 1, averageAgeHours: 2 }
    ]);
  });

  test("classifies critical issue owners against the watched user set", () => {
    expect(criticalIssueOwnerScope(null, ["alice"])).toBe("unowned");
    expect(criticalIssueOwnerScope("  ", ["alice"])).toBe("unowned");
    expect(criticalIssueOwnerScope("alice", ["alice"])).toBe("watched");
    expect(criticalIssueOwnerScope("Alice", ["alice"])).toBe("watched");
    expect(criticalIssueOwnerScope("alice", [" alice "])).toBe("watched");
    expect(criticalIssueOwnerScope("carol", ["alice"])).toBe("non_watched");
  });

  test("separates unowned critical work from owners outside the watched set", () => {
    expect(
      criticalIssueOwnershipCounts(
        [
          { ownerLogin: null },
          { ownerLogin: "alice" },
          { ownerLogin: "bob" },
          { ownerLogin: "carol" }
        ],
        ["alice", "bob"]
      )
    ).toEqual({
      unownedCriticalIssues: 1,
      nonWatchedCriticalIssues: 1
    });
  });
});

describe("profile configuration guidance", () => {
  test("summarizes testing reviewer candidates from open pull requests", () => {
    expect(
      testingReviewerCoverage([
        { requestedReviewers: ["qa-a", "qa-b", "QA-A"] },
        { requestedReviewers: ["qa-b"] },
        { requestedReviewers: [""] }
      ])
    ).toEqual([
      { login: "qa-b", openPrs: 2 },
      { login: "qa-a", openPrs: 1 }
    ]);
  });

  test("suggests watched users from non-watched critical owners", () => {
    expect(
      profileActionSuggestions(
        baseProfile,
        [
          { ownerLogin: null, ownerScope: "unowned", criticalIssues: 3, averageAgeHours: 12 },
          { ownerLogin: "alice", ownerScope: "non_watched", criticalIssues: 5, averageAgeHours: 8 },
          { ownerLogin: "bob", ownerScope: "non_watched", criticalIssues: 2, averageAgeHours: 20 },
          { ownerLogin: "carol", ownerScope: "watched", criticalIssues: 4, averageAgeHours: 6 }
        ],
        [],
        []
      )
    ).toEqual([
      {
        key: "profile:watched_users_candidates",
        severity: "warning",
        title: "Watched user candidates found",
        description: "2 owners outside people.watched_users currently own active critical issues.",
        action: "Review and add confirmed GitHub logins under people.watched_users in the active repo profile.",
        relatedLogins: ["alice", "bob"],
        yamlSnippet: "people:\n  watched_users:\n    - alice\n    - bob"
      }
    ]);
  });

  test("builds a merged profile setup patch from action suggestions", () => {
    const actions = profileActionSuggestions(
      {
        ...baseProfile,
        notifications: {
          ...baseProfile.notifications,
          wecom: { enabled: false, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
        }
      },
      [
        { ownerLogin: "alice", ownerScope: "non_watched", criticalIssues: 5, averageAgeHours: 8 },
        { ownerLogin: "bob", ownerScope: "non_watched", criticalIssues: 2, averageAgeHours: 20 }
      ],
      [
        { login: "qa-a", openPrs: 8 },
        { login: "qa-b", openPrs: 4 }
      ],
      [
        { login: "alice", attentionItems: 3, highestSeverity: "critical" },
        { login: "qa-a", attentionItems: 1, highestSeverity: "warning" }
      ]
    );

    expect(profileSetupPlan(baseProfile, actions)).toEqual({
      status: "action_required",
      missingCapabilities: ["watched_users", "testing_handoff", "notification_employees"],
      candidateLogins: ["alice", "bob", "qa-a", "qa-b"],
      yamlPatch:
        "people:\n" +
        "  watched_users:\n" +
        "    - alice\n" +
        "    - bob\n" +
        "  testers:\n" +
        "    - qa-a\n" +
        "    - qa-b\n" +
        "testing:\n" +
        "  handoff_signals:\n" +
        "    reviewer_users:\n" +
        "      - qa-a\n" +
        "      - qa-b\n" +
        "notifications:\n" +
        "  employees:\n" +
        "    alice:\n" +
        "      wecom_user_id: TODO_ALICE\n" +
        "    qa-a:\n" +
        "      wecom_user_id: TODO_QA_A"
    });
  });

  test("marks profile setup complete when no action suggestions remain", () => {
    expect(
      profileSetupPlan(
        {
          ...baseProfile,
          people: { watchedUsers: ["alice"], testers: ["qa"] },
          testing: {
            handoffSignals: {
              labels: [],
              reviewerUsers: ["qa"],
              assigneeUsers: [],
              comments: []
            }
          }
        },
        []
      )
    ).toEqual({
      status: "complete",
      missingCapabilities: [],
      candidateLogins: [],
      yamlPatch: null
    });
  });

  test("excludes workflow skip users from configuration suggestions", () => {
    const profile = {
      ...baseProfile,
      workflow: { skipUsers: ["skip-me", "qa-skip"] },
      notifications: {
        ...baseProfile.notifications,
        wecom: { enabled: true }
      }
    };

    expect(
      profileActionSuggestions(
        profile,
        [
          { ownerLogin: "skip-me", ownerScope: "non_watched", criticalIssues: 5, averageAgeHours: 8 },
          { ownerLogin: "alice", ownerScope: "non_watched", criticalIssues: 2, averageAgeHours: 20 }
        ],
        [
          { login: "qa-skip", openPrs: 8 },
          { login: "qa-a", openPrs: 4 }
        ],
        [
          { login: "skip-me", attentionItems: 3, highestSeverity: "critical" },
          { login: "alice", attentionItems: 1, highestSeverity: "warning" }
        ]
      )
    ).toEqual([
      {
        key: "profile:watched_users_candidates",
        severity: "warning",
        title: "Watched user candidates found",
        description: "1 owners outside people.watched_users currently own active critical issues.",
        action: "Review and add confirmed GitHub logins under people.watched_users in the active repo profile.",
        relatedLogins: ["alice"],
        yamlSnippet: "people:\n  watched_users:\n    - alice"
      },
      {
        key: "profile:testing_reviewer_candidates",
        severity: "warning",
        title: "Testing reviewer candidates found",
        description: "1 requested reviewers appear on open PRs while testing handoff is not configured.",
        action: "Review and add confirmed testers under people.testers and testing.handoff_signals.reviewer_users.",
        relatedLogins: ["qa-a"],
        yamlSnippet:
          "people:\n  testers:\n    - qa-a\ntesting:\n  handoff_signals:\n    reviewer_users:\n      - qa-a"
      },
      {
        key: "profile:notification_employee_mapping_candidates",
        severity: "warning",
        title: "Notification employee mappings missing",
        description:
          "1 GitHub logins appear on active notification candidates without notifications.employees mappings; owner-routed alerts will use fallback recipient maintainer_group.",
        action: "Add confirmed enterprise WeChat user IDs under notifications.employees before relying on owner-routed alerts.",
        relatedLogins: ["alice"],
        yamlSnippet: "notifications:\n  employees:\n    alice:\n      wecom_user_id: TODO_ALICE"
      }
    ]);
  });

  test("does not suggest watched users when coverage has no non-watched owners", () => {
    expect(
      profileActionSuggestions(
        baseProfile,
        [
          { ownerLogin: null, ownerScope: "unowned", criticalIssues: 3, averageAgeHours: 12 },
          { ownerLogin: "alice", ownerScope: "watched", criticalIssues: 5, averageAgeHours: 8 }
        ],
        [],
        []
      )
    ).toEqual([]);
  });

  test("suggests testing reviewers when testing handoff is unconfigured", () => {
    expect(
      profileActionSuggestions(
        baseProfile,
        [],
        [
          { login: "qa-a", openPrs: 8 },
          { login: "qa-b", openPrs: 4 }
        ],
        []
      )
    ).toEqual([
      {
        key: "profile:testing_reviewer_candidates",
        severity: "warning",
        title: "Testing reviewer candidates found",
        description: "2 requested reviewers appear on open PRs while testing handoff is not configured.",
        action: "Review and add confirmed testers under people.testers and testing.handoff_signals.reviewer_users.",
        relatedLogins: ["qa-a", "qa-b"],
        yamlSnippet:
          "people:\n  testers:\n    - qa-a\n    - qa-b\ntesting:\n  handoff_signals:\n    reviewer_users:\n      - qa-a\n      - qa-b"
      }
    ]);
  });

  test("does not suggest already configured testing reviewers", () => {
    expect(
      profileActionSuggestions(
        {
          ...baseProfile,
          people: { watchedUsers: [], testers: ["qa-a"] },
          testing: {
            handoffSignals: {
              labels: [],
              reviewerUsers: ["qa-b"],
              assigneeUsers: [],
              comments: []
            }
          }
        },
        [],
        [
          { login: "qa-a", openPrs: 8 },
          { login: "qa-b", openPrs: 4 }
        ],
        []
      )
    ).toEqual([]);
  });

  test("summarizes notification employee mapping candidates", () => {
    expect(
      notificationEmployeeMappingCandidates(
        {
          ...baseProfile,
          notifications: {
            ...baseProfile.notifications,
            employees: {
              alice: { wecomUserId: "alice-wecom" }
            }
          }
        },
        [
          { relatedLogin: "Alice", severity: "critical" },
          { relatedLogin: "Bob", severity: "warning" },
          { relatedLogin: "bob", severity: "critical" },
          { relatedLogin: "carol", severity: "warning" },
          { relatedLogin: "carol", severity: "warning" },
          { relatedLogin: "  ", severity: "critical" },
          { relatedLogin: null, severity: "critical" }
        ]
      )
    ).toEqual([
      { login: "Bob", attentionItems: 2, highestSeverity: "critical" },
      { login: "carol", attentionItems: 2, highestSeverity: "warning" }
    ]);
  });

  test("suggests notification employee mappings for owner-routed attention", () => {
    expect(
      profileActionSuggestions(
        {
          ...baseProfile,
          notifications: {
            ...baseProfile.notifications,
            wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
          }
        },
        [],
        [],
        [
          { login: "Bob", attentionItems: 2, highestSeverity: "critical" },
          { login: "carol", attentionItems: 1, highestSeverity: "warning" }
        ]
      )
    ).toEqual([
      {
        key: "profile:notification_employee_mapping_candidates",
        severity: "warning",
        title: "Notification employee mappings missing",
        description:
          "2 GitHub logins appear on active notification candidates without notifications.employees mappings; owner-routed alerts will use fallback recipient maintainer_group.",
        action: "Add confirmed enterprise WeChat user IDs under notifications.employees before relying on owner-routed alerts.",
        relatedLogins: ["Bob", "carol"],
        yamlSnippet:
          "notifications:\n  employees:\n    Bob:\n      wecom_user_id: TODO_BOB\n    carol:\n      wecom_user_id: TODO_CAROL"
      }
    ]);
  });

  test("surfaces missing watched users and testing handoff configuration", () => {
    expect(profileConfigurationWarnings({ profile: baseProfile, env: {} }).map((warning) => warning.key)).toEqual([
      "profile:watched_users_empty",
      "profile:testing_handoff_unconfigured",
      "webhook:secret_unconfigured"
    ]);
  });

  test("does not warn about webhook security when the webhook secret is configured", () => {
    expect(
      profileConfigurationWarnings({
        profile: baseProfile,
        env: { MO_DEVFLOW_GITHUB_WEBHOOK_SECRET: "webhook-secret" }
      }).map((warning) => warning.key)
    ).toEqual(["profile:watched_users_empty", "profile:testing_handoff_unconfigured"]);
  });

  test("does not warn when personal and testing workflow inputs are configured", () => {
    expect(
      profileConfigurationWarnings({
        profile: {
          ...baseProfile,
          people: { watchedUsers: ["alice"], testers: ["qa"] },
          testing: {
            handoffSignals: {
              labels: ["testing"],
              reviewerUsers: [],
              assigneeUsers: [],
              comments: []
            }
          }
        },
        env: { MO_DEVFLOW_GITHUB_WEBHOOK_SECRET: "webhook-secret" }
      })
    ).toEqual([]);
  });
});

describe("linked PR issue references", () => {
  test("extracts strong GitHub issue links and closing keywords", () => {
    expect(
      extractLinkedIssueNumbers(
        "Fixes #123 and resolves https://github.com/matrixorigin/matrixone/issues/456\nSee also #789"
      )
    ).toEqual([123, 456]);
  });

  test("does not treat ordinary hash mentions as linked issues", () => {
    expect(extractLinkedIssueNumbers("Related discussion in #123 but not a closing reference")).toEqual([]);
  });

  test("deduplicates repeated issue references", () => {
    expect(extractLinkedIssueNumbers("Closes #42. Fixes #42")).toEqual([42]);
  });
});

describe("critical issue cache blockers", () => {
  const linkedPr: CriticalIssueLinkedPullRequestView = {
    number: 101,
    title: "fix critical issue",
    htmlUrl: "https://github.com/matrixorigin/matrixone/pull/101",
    state: "open",
    ownerLogin: "alice",
    ageHours: 30,
    lastHumanActionAt: "2026-07-03T00:00:00Z",
    reviewDecision: "changes_requested",
    mergeStateStatus: null,
    ciState: "failure",
    testingState: "not_ready",
    testingTesters: [],
    testingQueueAgeHours: null,
    attentionFlags: ["requested_changes", "ci_failed"],
    isComplete: true
  };

  test("surfaces cache-derived issue and linked PR blockers", () => {
    expect(
      criticalIssueBlockersFromCache({
        ownerLogin: null,
        aiEffortLabel: null,
        isComplete: false,
        syncError: null,
        linkedPullRequests: [linkedPr]
      }).map((blocker) => blocker.key)
    ).toEqual([
      "issue:unowned",
      "issue:missing_ai_effort",
      "issue:partial_cache",
      "pr:101:requested_changes",
      "pr:101:ci_failed"
    ]);
  });

  test("surfaces stalled testing handoff as a linked PR blocker", () => {
    const blockers = criticalIssueBlockersFromCache({
      ownerLogin: "alice",
      aiEffortLabel: "ai-easy",
      isComplete: true,
      syncError: null,
      linkedPullRequests: [
        {
          ...linkedPr,
          testingState: "test_requested",
          testingTesters: ["tester-a"],
          testingQueueAgeHours: 48,
          attentionFlags: ["testing_stalled"]
        }
      ]
    });

    expect(blockers).toContainEqual({
      key: "pr:101:testing_stalled",
      severity: "warning",
      message: "PR #101 is stalled in testing handoff.",
      relatedPrNumber: 101
    });
  });

  test("surfaces stale review requests as linked PR blockers", () => {
    const blockers = criticalIssueBlockersFromCache({
      ownerLogin: "alice",
      aiEffortLabel: "ai-easy",
      isComplete: true,
      syncError: null,
      linkedPullRequests: [
        {
          ...linkedPr,
          attentionFlags: ["review_requested_no_response"]
        }
      ]
    });

    expect(blockers).toContainEqual({
      key: "pr:101:review_requested_no_response",
      severity: "warning",
      message: "PR #101 has a stale review request without reviewer response.",
      relatedPrNumber: 101
    });
  });

  test("marks linked PR attention as partial when PR detail backfill is incomplete", () => {
    const blockers = criticalIssueBlockersFromCache({
      ownerLogin: "alice",
      aiEffortLabel: "ai-easy",
      isComplete: true,
      syncError: null,
      linkedPullRequests: [
        {
          ...linkedPr,
          isComplete: false,
          attentionFlags: ["no_human_action_24h"]
        }
      ]
    });

    expect(blockers[0]?.message).toContain("Partial PR evidence");
  });

  test("marks missing linked PR as informational cache evidence", () => {
    expect(
      criticalIssueBlockersFromCache({
        ownerLogin: "alice",
        aiEffortLabel: "ai-easy",
        isComplete: true,
        syncError: null,
        linkedPullRequests: []
      })
    ).toEqual([
      {
        key: "issue:no_linked_pr_in_cache",
        severity: "info",
        message: "No linked PR is visible in cache.",
        relatedPrNumber: null
      }
    ]);
  });
});

describe("pull request testing transition events", () => {
  const pullRequest: NormalizedPullRequest = {
    githubId: 101,
    number: 101,
    title: "testing handoff",
    state: "open",
    authorLogin: "alice",
    ownerLogin: "alice",
    htmlUrl: "https://github.com/matrixorigin/matrixone/pull/101",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    draft: false,
    headRef: "feature",
    baseRef: "main",
    labels: [],
    assignees: [],
    requestedReviewers: ["tester-a"],
    ageHours: 48,
    lastHumanActionAt: "2026-07-02T08:00:00.000Z",
    lastSystemActionAt: null,
    reviewDecision: null,
    mergeStateStatus: null,
    ciState: null,
    latestReviewState: null,
    latestReviewSubmittedAt: null,
    latestCommitAt: "2026-07-02T07:00:00.000Z",
    detailSyncedAt: "2026-07-03T00:00:00.000Z",
    detailError: null,
    testingState: "test_requested",
    testingTesters: ["tester-a"],
    testingSignals: ["reviewer:tester-a"],
    testingQueueAgeHours: 16,
    attentionFlags: [],
    sourceAuthType: "service_read_token",
    sourceUserId: null,
    visibilityClass: "anonymous_readable",
    isComplete: true,
    rawPayload: {}
  };

  test("records first observed testing handoff transitions", () => {
    expect(
      pullRequestTestingTransitionForUpsert({
        repoId: 7,
        previousTestingState: null,
        pr: pullRequest
      })
    ).toEqual({
      repoId: 7,
      prNumber: 101,
      fromState: "not_ready",
      toState: "test_requested",
      testingTesters: ["tester-a"],
      testingSignals: ["reviewer:tester-a"],
      occurredAt: "2026-07-02T08:00:00.000Z",
      sourceCompleteness: "complete_cache",
      sourceAuthType: "service_read_token",
      sourceUserId: null,
      visibilityClass: "anonymous_readable",
      dedupeKey: "7:pr:101:testing:not_ready:test_requested:2026-07-02T08:00:00.000Z"
    });
  });

  test("does not record repeated upserts with the same testing state", () => {
    expect(
      pullRequestTestingTransitionForUpsert({
        repoId: 7,
        previousTestingState: "test_requested",
        hasExistingTestingEvents: true,
        pr: pullRequest
      })
    ).toBeNull();
  });

  test("records first-observed testing states when existing cache predates event history", () => {
    expect(
      pullRequestTestingTransitionForUpsert({
        repoId: 7,
        previousTestingState: "test_requested",
        hasExistingTestingEvents: false,
        pr: pullRequest
      })
    ).toMatchObject({
      fromState: "not_ready",
      toState: "test_requested",
      dedupeKey: "7:pr:101:testing:not_ready:test_requested:2026-07-02T08:00:00.000Z"
    });
  });

  test("does not record initial not-ready state", () => {
    expect(
      pullRequestTestingTransitionForUpsert({
        repoId: 7,
        previousTestingState: null,
        pr: { ...pullRequest, testingState: "not_ready", testingTesters: [], testingSignals: [] }
      })
    ).toBeNull();
  });

  test("does not record first-observed ordinary closed PRs without testing evidence", () => {
    expect(
      pullRequestTestingTransitionForUpsert({
        repoId: 7,
        previousTestingState: null,
        pr: {
          ...pullRequest,
          state: "closed",
          testingState: "closed_or_merged",
          testingTesters: [],
          testingSignals: ["closed_or_merged"],
          closedAt: "2026-07-03T04:00:00.000Z",
          mergedAt: "2026-07-03T04:00:00.000Z",
          testingQueueAgeHours: null
        }
      })
    ).toBeNull();
  });

  test("uses review submission time for tester pass and change-request transitions", () => {
    const event = pullRequestTestingTransitionForUpsert({
      repoId: 7,
      previousTestingState: "test_requested",
      pr: {
        ...pullRequest,
        testingState: "test_passed",
        latestReviewState: "APPROVED",
        latestReviewSubmittedAt: "2026-07-03T02:00:00.000Z",
        testingQueueAgeHours: null
      }
    });

    expect(event).toMatchObject({
      fromState: "test_requested",
      toState: "test_passed",
      occurredAt: "2026-07-03T02:00:00.000Z"
    });
  });

  test("maps testing transition rows to dashboard-safe views", () => {
    expect(
      testingTransitionViewFromRow({
        id: 12,
        pr_number: 101,
        from_state: "test_requested",
        to_state: "test_passed",
        testing_testers_json: JSON.stringify(["tester-a"]),
        testing_signals_json: JSON.stringify(["review:APPROVED", "reviewer:tester-a"]),
        occurred_at: "2026-07-03 02:00:00",
        source_completeness: "complete_cache"
      })
    ).toEqual({
      id: 12,
      prNumber: 101,
      fromState: "test_requested",
      toState: "test_passed",
      testingTesters: ["tester-a"],
      testingSignals: ["review:APPROVED", "reviewer:tester-a"],
      occurredAt: "2026-07-03T02:00:00Z",
      sourceCompleteness: "complete_cache"
    });
  });

  test("summarizes testing turnover only from completed transition pairs", () => {
    const transitions: TestingTransitionView[] = [
        {
          id: 1,
          prNumber: 101,
          fromState: "not_ready",
          toState: "test_requested",
          testingTesters: ["tester-a"],
          testingSignals: ["reviewer:tester-a"],
          occurredAt: "2026-07-01T00:00:00.000Z",
          sourceCompleteness: "complete_cache"
        },
        {
          id: 2,
          prNumber: 101,
          fromState: "test_requested",
          toState: "test_passed",
          testingTesters: ["tester-a"],
          testingSignals: ["review:APPROVED"],
          occurredAt: "2026-07-02T12:00:00.000Z",
          sourceCompleteness: "complete_cache"
        },
        {
          id: 3,
          prNumber: 101,
          fromState: "test_passed",
          toState: "closed_or_merged",
          testingTesters: [],
          testingSignals: ["closed_or_merged"],
          occurredAt: "2026-07-03T00:00:00.000Z",
          sourceCompleteness: "complete_cache"
        },
        {
          id: 4,
          prNumber: 102,
          fromState: "not_ready",
          toState: "test_requested",
          testingTesters: ["tester-b"],
          testingSignals: ["reviewer:tester-b"],
          occurredAt: "2026-07-01T00:00:00.000Z",
          sourceCompleteness: "partial_cache"
        }
      ];

    expect(testingTurnoverMetricsFromTransitions(transitions)).toEqual({
      requestToPassSamples: 1,
      passToCloseSamples: 1,
      averageRequestToPassHours: 36,
      averagePassToCloseHours: 12
    });

    expect(Array.from(testingTurnoverMetricsByTesterFromTransitions(transitions).entries())).toEqual([
      [
        "tester-a",
        {
          requestToPassSamples: 1,
          passToCloseSamples: 1,
          averageRequestToPassHours: 36,
          averagePassToCloseHours: 12
        }
      ],
      [
        "tester-b",
        {
          requestToPassSamples: 0,
          passToCloseSamples: 0,
          averageRequestToPassHours: null,
          averagePassToCloseHours: null
        }
      ]
    ]);
  });
});

describe("metric aggregation", () => {
  const points: DailyMetricPoint[] = [
    {
      date: "2026-06-28",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 1,
      prsMerged: 0,
      issuesOpened: 1,
      issuesClosed: 0,
      issuesDeferred: 0,
      workflowViolationsDetected: 0,
      sourceCompleteness: "complete_cache",
      generatedAt: "2026-07-04T00:00:00Z"
    },
    {
      date: "2026-06-29",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 2,
      prsMerged: 1,
      issuesOpened: 0,
      issuesClosed: 0,
      issuesDeferred: 0,
      workflowViolationsDetected: 1,
      sourceCompleteness: "partial_cache",
      generatedAt: "2026-07-04T00:01:00Z"
    },
    {
      date: "2026-07-01",
      scopeType: "team",
      scopeKey: "all",
      prsCreated: 3,
      prsMerged: 1,
      issuesOpened: 2,
      issuesClosed: 1,
      issuesDeferred: 1,
      workflowViolationsDetected: 0,
      sourceCompleteness: "complete_cache",
      generatedAt: "2026-07-04T00:02:00Z"
    }
  ];

  test("aggregates weeks using the configured Monday start", () => {
    const weekly = aggregateMetricPoints(points, "week", "Monday");

    expect(weekly.map((point) => ({ start: point.periodStart, prsCreated: point.prsCreated }))).toEqual([
      { start: "2026-06-22", prsCreated: 1 },
      { start: "2026-06-29", prsCreated: 5 }
    ]);
    expect(weekly[1]).toMatchObject({
      periodEnd: "2026-07-06",
      label: "06-29-07-05",
      prsMerged: 2,
      issuesOpened: 2,
      issuesClosed: 1,
      issuesDeferred: 1,
      workflowViolationsDetected: 1,
      sourceCompleteness: "partial_cache",
      generatedAt: "2026-07-04T00:02:00Z"
    });
  });

  test("aggregates weeks using the configured Sunday start", () => {
    const weekly = aggregateMetricPoints(points, "week", "Sunday");

    expect(weekly.map((point) => ({ start: point.periodStart, prsCreated: point.prsCreated }))).toEqual([
      { start: "2026-06-28", prsCreated: 6 }
    ]);
  });

  test("aggregates months without mixing calendar boundaries", () => {
    const monthly = aggregateMetricPoints(points, "month", "Monday");

    expect(monthly.map((point) => ({ start: point.periodStart, end: point.periodEnd, created: point.prsCreated }))).toEqual([
      { start: "2026-06-01", end: "2026-07-01", created: 3 },
      { start: "2026-07-01", end: "2026-08-01", created: 3 }
    ]);
  });
});

describe("repo timezone calendar ranges", () => {
  test("builds Asia/Shanghai calendar-day UTC bounds", () => {
    const range = calendarDayRangeInTimezone("2026-07-03", "Asia/Shanghai");

    expect(range.start.toISOString()).toBe("2026-07-02T16:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  test("derives previous calendar day in the repository timezone", () => {
    const range = previousCalendarDayRange("Asia/Shanghai", new Date("2026-07-04T01:00:00.000Z"));

    expect(range.start.toISOString()).toBe("2026-07-02T16:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  test("maps UTC instants to repo-local date keys", () => {
    expect(dateKeyInTimezone("2026-07-02T15:59:59.000Z", "Asia/Shanghai")).toBe("2026-07-02");
    expect(dateKeyInTimezone("2026-07-02T16:00:00.000Z", "Asia/Shanghai")).toBe("2026-07-03");
  });
});

describe("attention item resolution planning", () => {
  const rows = [
    {
      objectType: "pull_request",
      objectNumber: 10,
      ruleKey: "ci_failed",
      dedupeKey: "repo:pr:10:ci_failed"
    },
    {
      objectType: "pull_request",
      objectNumber: 11,
      ruleKey: "ci_failed",
      dedupeKey: "repo:pr:11:ci_failed"
    },
    {
      objectType: "issue",
      objectNumber: 12,
      ruleKey: "critical_no_human_action",
      dedupeKey: "repo:issue:12:critical_no_human_action"
    },
    {
      objectType: "pull_request",
      objectNumber: 13,
      ruleKey: "manual_operator_note",
      dedupeKey: "repo:pr:13:manual_operator_note"
    }
  ];

  test("resolves only managed attention items missing from active snapshot keys", () => {
    expect(
      attentionItemsToResolve({
        rows,
        activeDedupeKeys: new Set(["repo:pr:11:ci_failed"]),
        managedRuleKeys: ["ci_failed", "critical_no_human_action"]
      })
    ).toEqual(["repo:pr:10:ci_failed", "repo:issue:12:critical_no_human_action"]);
  });

  test("webhook object scope does not resolve attention for other objects", () => {
    expect(
      attentionItemsToResolve({
        rows,
        activeDedupeKeys: new Set<string>(),
        managedRuleKeys: ["ci_failed"],
        objectType: "pull_request",
        objectNumber: 10
      })
    ).toEqual(["repo:pr:10:ci_failed"]);
  });
});
