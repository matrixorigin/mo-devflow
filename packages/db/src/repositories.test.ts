import { describe, expect, test } from "vitest";
import type {
  CriticalIssueLinkedPullRequestView,
  DailyMetricPoint,
  NormalizedPullRequest,
  RepoProfile,
  TestingIssueQueueView
} from "@mo-devflow/shared";
import { extractLinkedIssueNumbers } from "@mo-devflow/shared";
import {
  aggregateMetricPoints,
  attentionItemsToResolve,
  buildSyncHealthSummary,
  cacheStaleHoursFromEnv,
  calendarDayRangeInTimezone,
  criticalActiveMetricSnapshot,
  criticalIssueBlockersFromCache,
  criticalIssueOwnerCoverage,
  criticalIssueOwnershipCounts,
  criticalIssueOwnerScope,
  dateKeyInTimezone,
  deferredIssueTransitionMetricEventsFromRows,
  dashboardVisibilityFilter,
  isPersonalNeedsTriageIssue,
  issueTimelineBackfillCandidatesFromRows,
  metricSourceCompletenessForObject,
  notificationEmployeeMappingCandidates,
  previousCalendarDayRange,
  profileActionSuggestions,
  profileActionSuggestionsForViewer,
  profileConfigurationWarnings,
  profileSetupPlan,
  profileSetupPlanForViewer,
  pullRequestWithPreservedInsight,
  testingIssueHandoffToCloseSamplesFromRows,
  testingIssueTransitionsFromQueueIssues,
  testingIssuesForLogin,
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
  testing: {},
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
  test("keeps one row per sync layer with latest attempt, latest success, and latest failure", () => {
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
            raw_json: null,
            last_successful_at: "2026-07-04 08:01:00",
            last_failed_at: "2026-07-04 10:01:00",
            last_failure_message: "rate limited"
          },
          {
            sync_layer: "metrics",
            status: "success",
            started_at: "2026-07-04 09:00:00",
            finished_at: "2026-07-04 09:00:05",
            error_message: null,
            rate_limit_remaining: null,
            raw_json: JSON.stringify({ skipped: true, reason: "backfill disabled" }),
            last_successful_at: "2026-07-04 09:00:05",
            last_failed_at: "2026-07-03 11:10:00",
            last_failure_message: "network timeout"
          }
        ]
      })
    ).toEqual([
      {
        layer: "github_sync",
        status: "failed",
        lastSuccessfulAt: "2026-07-04T08:01:00Z",
        lastAttemptedAt: "2026-07-04T10:00:00Z",
        lastFailedAt: "2026-07-04T10:01:00Z",
        lastFailureMessage: "rate limited",
        errorMessage: "rate limited",
        rateLimitRemaining: 0,
        skipped: false,
        skipReason: null
      },
      {
        layer: "metrics",
        status: "success",
        lastSuccessfulAt: "2026-07-04T09:00:05Z",
        lastAttemptedAt: "2026-07-04T09:00:00Z",
        lastFailedAt: "2026-07-03T11:10:00Z",
        lastFailureMessage: "network timeout",
        errorMessage: null,
        rateLimitRemaining: null,
        skipped: true,
        skipReason: "backfill disabled"
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
            last_successful_at: "2026-07-04 09:00:05",
            last_failed_at: null,
            last_failure_message: null
          }
        ]
      })
    ).toEqual([
      {
        layer: "github_sync",
        status: "not_started",
        lastSuccessfulAt: null,
        lastAttemptedAt: null,
        lastFailedAt: null,
        lastFailureMessage: null,
        errorMessage: "Sync layer has not recorded a run yet.",
        rateLimitRemaining: null,
        skipped: false,
        skipReason: null
      },
      {
        layer: "rules",
        status: "success",
        lastSuccessfulAt: "2026-07-04T09:00:05Z",
        lastAttemptedAt: "2026-07-04T09:00:00Z",
        lastFailedAt: null,
        lastFailureMessage: null,
        errorMessage: null,
        rateLimitRemaining: null,
        skipped: false,
        skipReason: null
      },
      {
        layer: "metrics",
        status: "not_started",
        lastSuccessfulAt: null,
        lastAttemptedAt: null,
        lastFailedAt: null,
        lastFailureMessage: null,
        errorMessage: "Sync layer has not recorded a run yet.",
        rateLimitRemaining: null,
        skipped: false,
        skipReason: null
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
      isPersonalNeedsTriageIssue({ lifecycleState: "needs-triage", severity: null }, baseProfile.labels.critical)
    ).toBe(true);
    expect(
      isPersonalNeedsTriageIssue({ lifecycleState: "deferred", severity: null }, baseProfile.labels.critical)
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
        { ownerLogin: "bob", ownerScope: "non_watched", ageHours: 20, workflowSkipped: true }
      ])
    ).toEqual([
      { ownerLogin: null, ownerScope: "unowned", workflowSkipped: false, criticalIssues: 2, averageAgeHours: 6 },
      { ownerLogin: "Carol", ownerScope: "non_watched", workflowSkipped: false, criticalIssues: 2, averageAgeHours: 6 },
      { ownerLogin: "bob", ownerScope: "non_watched", workflowSkipped: true, criticalIssues: 1, averageAgeHours: 20 },
      { ownerLogin: "alice", ownerScope: "watched", workflowSkipped: false, criticalIssues: 1, averageAgeHours: 2 }
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
          { ownerLogin: "carol" },
          { ownerLogin: "skip-me", workflowSkipped: true }
        ],
        ["alice", "bob"]
      )
    ).toEqual({
      unownedCriticalIssues: 1,
      nonWatchedCriticalIssues: 2,
      skippedCriticalIssues: 1
    });
  });
});

describe("profile configuration guidance", () => {
  test("suggests watched users from non-watched critical owners", () => {
    expect(
      profileActionSuggestions(
        baseProfile,
        [
          { ownerLogin: null, ownerScope: "unowned", workflowSkipped: false, criticalIssues: 3, averageAgeHours: 12 },
          {
            ownerLogin: "alice",
            ownerScope: "non_watched",
            workflowSkipped: false,
            criticalIssues: 5,
            averageAgeHours: 8
          },
          {
            ownerLogin: "bob",
            ownerScope: "non_watched",
            workflowSkipped: false,
            criticalIssues: 2,
            averageAgeHours: 20
          },
          { ownerLogin: "carol", ownerScope: "watched", workflowSkipped: false, criticalIssues: 4, averageAgeHours: 6 }
        ],
        []
      )
    ).toEqual([
      {
        key: "profile:watched_users_candidates",
        severity: "warning",
        title: "Watched user candidates found",
        description: "2 owners outside people.watched_users currently own active s-1/s0 issues.",
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
        {
          ownerLogin: "alice",
          ownerScope: "non_watched",
          workflowSkipped: false,
          criticalIssues: 5,
          averageAgeHours: 8
        },
        {
          ownerLogin: "bob",
          ownerScope: "non_watched",
          workflowSkipped: false,
          criticalIssues: 2,
          averageAgeHours: 20
        }
      ],
      [
        { login: "alice", attentionItems: 3, highestSeverity: "critical" },
        { login: "qa-a", attentionItems: 1, highestSeverity: "warning" }
      ]
    );

    expect(profileSetupPlan(baseProfile, actions)).toEqual({
      status: "action_required",
      missingCapabilities: ["watched_users", "notification_employees"],
      candidateLogins: ["alice", "bob", "qa-a"],
      yamlPatch:
        "people:\n" +
        "  watched_users:\n" +
        "    - alice\n" +
        "    - bob\n" +
        "notifications:\n" +
        "  employees:\n" +
        "    alice:\n" +
        "      wecom_user_id: TODO_ALICE\n" +
        "    qa-a:\n" +
        "      wecom_user_id: TODO_QA_A"
    });
  });

  test("redacts profile setup account hints from anonymous dashboard viewers", () => {
    const actions = profileActionSuggestions(
      {
        ...baseProfile,
        notifications: {
          ...baseProfile.notifications,
          wecom: { enabled: false, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
        }
      },
      [
        {
          ownerLogin: "alice",
          ownerScope: "non_watched",
          workflowSkipped: false,
          criticalIssues: 5,
          averageAgeHours: 8
        }
      ],
      [{ login: "qa-a", attentionItems: 1, highestSeverity: "warning" }]
    );
    const setup = profileSetupPlan(baseProfile, actions);
    expect(actions).toHaveLength(2);
    const watchedAction = actions[0]!;
    const notificationAction = actions[1]!;

    expect(profileActionSuggestionsForViewer({ authenticated: false, userId: null }, actions)).toEqual([
      {
        ...watchedAction,
        relatedLogins: [],
        yamlSnippet: null
      },
      {
        ...notificationAction,
        relatedLogins: [],
        yamlSnippet: null
      }
    ]);
    expect(profileSetupPlanForViewer({ authenticated: false, userId: null }, setup)).toEqual({
      ...setup,
      candidateLogins: [],
      yamlPatch: null
    });
  });

  test("keeps profile setup account hints for authenticated dashboard viewers", () => {
    const actions = profileActionSuggestions(
      baseProfile,
      [
        {
          ownerLogin: "alice",
          ownerScope: "non_watched",
          workflowSkipped: false,
          criticalIssues: 5,
          averageAgeHours: 8
        }
      ],
      []
    );
    const setup = profileSetupPlan(baseProfile, actions);

    expect(profileActionSuggestionsForViewer({ authenticated: true, userId: 1 }, actions)).toBe(actions);
    expect(profileSetupPlanForViewer({ authenticated: true, userId: 1 }, setup)).toBe(setup);
  });

  test("marks profile setup complete when no action suggestions remain", () => {
    expect(
      profileSetupPlan(
        {
          ...baseProfile,
          people: { watchedUsers: ["alice"], testers: ["qa"] }
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
          {
            ownerLogin: "skip-me",
            ownerScope: "non_watched",
            workflowSkipped: true,
            criticalIssues: 5,
            averageAgeHours: 8
          },
          {
            ownerLogin: "alice",
            ownerScope: "non_watched",
            workflowSkipped: false,
            criticalIssues: 2,
            averageAgeHours: 20
          }
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
        description: "1 owners outside people.watched_users currently own active s-1/s0 issues.",
        action: "Review and add confirmed GitHub logins under people.watched_users in the active repo profile.",
        relatedLogins: ["alice"],
        yamlSnippet: "people:\n  watched_users:\n    - alice"
      },
      {
        key: "profile:notification_employee_mapping_candidates",
        severity: "warning",
        title: "Notification employee mappings missing",
        description:
          "1 GitHub logins appear on active notification candidates without notifications.employees mappings; owner-routed alerts will use fallback recipient maintainer_group.",
        action:
          "Add confirmed enterprise WeChat user IDs under notifications.employees before relying on owner-routed alerts.",
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
          { ownerLogin: null, ownerScope: "unowned", workflowSkipped: false, criticalIssues: 3, averageAgeHours: 12 },
          { ownerLogin: "alice", ownerScope: "watched", workflowSkipped: false, criticalIssues: 5, averageAgeHours: 8 }
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
        action:
          "Add confirmed enterprise WeChat user IDs under notifications.employees before relying on owner-routed alerts.",
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
          people: { watchedUsers: ["alice"], testers: ["qa"] }
        },
        env: { MO_DEVFLOW_GITHUB_WEBHOOK_SECRET: "webhook-secret" }
      })
    ).toEqual([]);
  });

  test("treats configured issue labels as testing workflow input", () => {
    expect(
      profileConfigurationWarnings({
        profile: {
          ...baseProfile,
          people: { watchedUsers: ["alice"], testers: [] },
          testing: { handoffSignals: { labels: ["testing"] } }
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
    ).toEqual([123, 456, 789]);
  });

  test("does not treat ordinary hash mentions as linked issues", () => {
    expect(extractLinkedIssueNumbers("Build output includes #123 but not an issue reference")).toEqual([]);
  });

  test("deduplicates repeated issue references", () => {
    expect(extractLinkedIssueNumbers("Closes #42. Fixes #42. Refs matrixorigin/matrixone#42")).toEqual([42]);
  });

  test("does not treat parenthesized PR title references as linked issues", () => {
    expect(extractLinkedIssueNumbers("fix: protocol panic on execute (#24975)")).toEqual([]);
  });

  test("keeps parenthesized issue references only when a strong keyword introduces them", () => {
    expect(extractLinkedIssueNumbers("Fixes (#25200). Cherry-pick #25262")).toEqual([25200]);
  });

  test("extracts colon-separated closing keyword references", () => {
    expect(
      extractLinkedIssueNumbers("Fix: #123\nResolve: https://github.com/matrixorigin/matrixone/issues/456")
    ).toEqual([123, 456]);
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
    workflowSkipped: false,
    attentionFlags: ["requested_changes", "ci_failed"],
    linkedIssueNumbers: [42],
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
    ).toEqual(["issue:unowned", "issue:partial_cache", "pr:101:requested_changes", "pr:101:ci_failed"]);
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
          testingState: "testing",
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
    requestedReviewers: [],
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
    testingState: "testing",
    testingTesters: ["tester-a"],
    testingSignals: ["issue_assignee:#42:tester-a"],
    testingQueueAgeHours: 16,
    workflowSkipped: false,
    attentionFlags: [],
    linkedIssueNumbers: [42],
    sourceAuthType: "service_read_token",
    sourceUserId: null,
    visibilityClass: "anonymous_readable",
    isComplete: true,
    rawPayload: {}
  };

  test("preserves complete PR detail evidence when a later list sync omits detail enrichment", () => {
    const next = pullRequestWithPreservedInsight({
      current: {
        ...pullRequest,
        detailSyncedAt: null,
        detailError: null,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        attentionFlags: [],
        isComplete: false
      },
      previous: {
        last_human_action_at: "2026-07-02 08:00:00",
        review_decision: "approved",
        merge_state_status: "clean",
        ci_state: "success",
        latest_review_state: "APPROVED",
        latest_review_submitted_at: "2026-07-02 09:00:00",
        latest_commit_at: "2026-07-02 07:00:00",
        detail_synced_at: "2026-07-03 00:00:00",
        detail_error: null,
        attention_flags_json: JSON.stringify(["no_human_action_24h"]),
        linked_issue_numbers_json: JSON.stringify([42, 101]),
        is_complete: 1
      }
    });

    expect(next.isComplete).toBe(true);
    expect(next.detailSyncedAt).toBe("2026-07-03T00:00:00Z");
    expect(next.reviewDecision).toBe("approved");
    expect(next.attentionFlags).toEqual(["no_human_action_24h"]);
    expect(next.linkedIssueNumbers).toEqual([42]);
  });

  test("does not preserve stale attention flags for workflow skipped PRs", () => {
    const next = pullRequestWithPreservedInsight({
      current: {
        ...pullRequest,
        workflowSkipped: true,
        detailSyncedAt: null,
        detailError: null,
        reviewDecision: null,
        mergeStateStatus: null,
        ciState: null,
        latestReviewState: null,
        latestReviewSubmittedAt: null,
        latestCommitAt: null,
        attentionFlags: [],
        isComplete: false
      },
      previous: {
        last_human_action_at: "2026-07-02 08:00:00",
        review_decision: "changes_requested",
        merge_state_status: "dirty",
        ci_state: "failure",
        latest_review_state: "CHANGES_REQUESTED",
        latest_review_submitted_at: "2026-07-02 09:00:00",
        latest_commit_at: "2026-07-02 07:00:00",
        detail_synced_at: "2026-07-03 00:00:00",
        detail_error: null,
        attention_flags_json: JSON.stringify(["requested_changes", "ci_failed", "merge_conflict"]),
        linked_issue_numbers_json: JSON.stringify([42]),
        is_complete: 1
      }
    });

    expect(next.isComplete).toBe(true);
    expect(next.reviewDecision).toBe("changes_requested");
    expect(next.attentionFlags).toEqual([]);
  });

  test("derives issue-level testing handoff transitions from the current issue queue", () => {
    const issues: TestingIssueQueueView[] = [
      {
        number: 42,
        title: "issue in test",
        htmlUrl: "https://github.com/example/repo/issues/42",
        testers: ["tester-a", "tester-a"],
        testingSignals: ["issue_assignee:#42:tester-a", "issue_assignee:#42:tester-a"],
        queueAgeHours: 8,
        queueStartedAt: "2026-07-03T08:00:00.000Z",
        queueAgeEvidence: "issue_assignment_event",
        linkedPullRequests: [],
        isComplete: true,
        syncError: null,
        lastSyncedAt: "2026-07-03T10:00:00.000Z"
      },
      {
        number: 43,
        title: "issue with partial cache",
        htmlUrl: "https://github.com/example/repo/issues/43",
        testers: ["tester-b"],
        testingSignals: ["issue_assignee:#43:tester-b"],
        queueAgeHours: 2,
        queueStartedAt: null,
        queueAgeEvidence: "issue_cache_timestamp",
        linkedPullRequests: [],
        isComplete: false,
        syncError: null,
        lastSyncedAt: "2026-07-03T11:00:00.000Z"
      }
    ];

    expect(testingIssueTransitionsFromQueueIssues(issues)).toEqual([
      {
        id: -43,
        issueNumber: 43,
        fromState: "not_ready",
        toState: "testing",
        testingTesters: ["tester-b"],
        testingSignals: ["issue_assignee:#43:tester-b"],
        occurredAt: "2026-07-03T11:00:00.000Z",
        sourceCompleteness: "partial_cache"
      },
      {
        id: -42,
        issueNumber: 42,
        fromState: "not_ready",
        toState: "testing",
        testingTesters: ["tester-a"],
        testingSignals: ["issue_assignee:#42:tester-a"],
        occurredAt: "2026-07-03T08:00:00.000Z",
        sourceCompleteness: "complete_cache"
      }
    ]);
  });

  test("keeps issue label testing handoff signals in issue-derived transitions", () => {
    const issues: TestingIssueQueueView[] = [
      {
        number: 44,
        title: "labeled issue in test",
        htmlUrl: "https://github.com/example/repo/issues/44",
        testers: [],
        testingSignals: ["issue_label:#44:testing"],
        queueAgeHours: 3,
        queueStartedAt: "2026-07-03T09:00:00.000Z",
        queueAgeEvidence: "issue_label_event",
        linkedPullRequests: [],
        isComplete: true,
        syncError: null,
        lastSyncedAt: "2026-07-03T12:00:00.000Z"
      }
    ];

    expect(testingIssueTransitionsFromQueueIssues(issues)).toEqual([
      {
        id: -44,
        issueNumber: 44,
        fromState: "not_ready",
        toState: "testing",
        testingTesters: [],
        testingSignals: ["issue_label:#44:testing"],
        occurredAt: "2026-07-03T09:00:00.000Z",
        sourceCompleteness: "complete_cache"
      }
    ]);
  });

  test("measures issue testing handoff to close from issue timeline evidence", () => {
    const profile: RepoProfile = {
      ...baseProfile,
      people: { ...baseProfile.people, testers: ["tester-a", "tester-b"] },
      testing: { handoffSignals: { labels: ["testing"] } }
    };
    const samples = testingIssueHandoffToCloseSamplesFromRows(
      profile,
      [
        {
          number: 50,
          is_pull_request: 0,
          closed_at: "2026-07-05 12:00:00"
        },
        {
          number: 51,
          is_pull_request: 0,
          closed_at: "2026-07-05 12:00:00"
        }
      ],
      [
        {
          issue_number: 50,
          event_type: "assigned",
          assignee_login: "tester-a",
          label_name: null,
          occurred_at: "2026-07-01 08:00:00"
        },
        {
          issue_number: 50,
          event_type: "unassigned",
          assignee_login: "tester-a",
          label_name: null,
          occurred_at: "2026-07-02 08:00:00"
        },
        {
          issue_number: 50,
          event_type: "assigned",
          assignee_login: "tester-b",
          label_name: null,
          occurred_at: "2026-07-04 12:00:00"
        },
        {
          issue_number: 51,
          event_type: "labeled",
          assignee_login: null,
          label_name: "testing",
          occurred_at: "2026-07-05 06:00:00"
        }
      ]
    );

    expect(samples).toEqual([
      {
        issueNumber: 50,
        testers: ["tester-b"],
        handoffStartedAt: "2026-07-04T12:00:00Z",
        closedAt: "2026-07-05T12:00:00Z",
        handoffToCloseHours: 24
      },
      {
        issueNumber: 51,
        testers: [],
        handoffStartedAt: "2026-07-05T06:00:00Z",
        closedAt: "2026-07-05T12:00:00Z",
        handoffToCloseHours: 6
      }
    ]);
  });

  test("maps issue-level testing queue to relevant personal views", () => {
    const assignedIssue: TestingIssueQueueView = {
      number: 44,
      title: "assigned issue in test",
      htmlUrl: "https://github.com/example/repo/issues/44",
      testers: ["tester-a"],
      testingSignals: ["issue_assignee:#44:tester-a"],
      queueAgeHours: 3,
      queueStartedAt: "2026-07-03T09:00:00.000Z",
      queueAgeEvidence: "issue_assignment_event",
      linkedPullRequests: [],
      isComplete: true,
      syncError: null,
      lastSyncedAt: "2026-07-03T12:00:00.000Z"
    };
    const labelIssue: TestingIssueQueueView = {
      number: 45,
      title: "label issue in test",
      htmlUrl: "https://github.com/example/repo/issues/45",
      testers: [],
      testingSignals: ["issue_label:#45:testing"],
      queueAgeHours: 5,
      queueStartedAt: "2026-07-03T07:00:00.000Z",
      queueAgeEvidence: "issue_cache_timestamp",
      linkedPullRequests: [
        {
          number: 201,
          title: "linked implementation",
          htmlUrl: "https://github.com/example/repo/pull/201",
          ownerLogin: "alice",
          ageHours: 12,
          reviewDecision: null,
          mergeStateStatus: null,
          ciState: null,
          attentionFlags: [],
          isComplete: true
        }
      ],
      isComplete: true,
      syncError: null,
      lastSyncedAt: "2026-07-03T12:00:00.000Z"
    };
    const ownerByIssueNumber = new Map<number, string | null>([
      [44, "dev-owner"],
      [45, "issue-owner"]
    ]);

    expect(
      testingIssuesForLogin("tester-a", [assignedIssue, labelIssue], ownerByIssueNumber).map((issue) => issue.number)
    ).toEqual([44]);
    expect(
      testingIssuesForLogin("issue-owner", [assignedIssue, labelIssue], ownerByIssueNumber).map((issue) => issue.number)
    ).toEqual([45]);
    expect(
      testingIssuesForLogin("alice", [assignedIssue, labelIssue], ownerByIssueNumber).map((issue) => issue.number)
    ).toEqual([45]);
    expect(testingIssuesForLogin("someone-else", [assignedIssue, labelIssue], ownerByIssueNumber)).toEqual([]);
  });
});

describe("issue timeline backfill candidate selection", () => {
  test("prioritizes tester-assigned issues and filters assignees exactly", () => {
    expect(
      issueTimelineBackfillCandidatesFromRows(
        [
          {
            issue_number: 10,
            visibility_class: "anonymous_readable",
            source_updated_at: "2026-07-01 10:00:00",
            timeline_synced_at: "2026-07-01 11:00:00",
            severity: "severity/s0",
            assignees_json: JSON.stringify([])
          },
          {
            issue_number: 11,
            visibility_class: "anonymous_readable",
            source_updated_at: "2026-07-01 09:00:00",
            timeline_synced_at: null,
            severity: null,
            assignees_json: JSON.stringify(["tester-a"])
          },
          {
            issue_number: 12,
            visibility_class: "anonymous_readable",
            source_updated_at: "2026-07-01 12:00:00",
            timeline_synced_at: null,
            severity: null,
            assignees_json: JSON.stringify(["tester-a-shadow"])
          },
          {
            issue_number: 13,
            visibility_class: "anonymous_readable",
            source_updated_at: "2026-07-01 08:00:00",
            timeline_synced_at: null,
            severity: "severity/s-1",
            assignees_json: JSON.stringify([])
          }
        ],
        {
          criticalLabels: ["severity/s-1", "severity/s0"],
          testerLogins: ["tester-a"],
          limit: 3
        }
      )
    ).toEqual([
      {
        issueNumber: 11,
        visibilityClass: "anonymous_readable",
        sourceUpdatedAt: "2026-07-01T09:00:00Z",
        lastTimelineSyncedAt: null
      },
      {
        issueNumber: 13,
        visibilityClass: "anonymous_readable",
        sourceUpdatedAt: "2026-07-01T08:00:00Z",
        lastTimelineSyncedAt: null
      },
      {
        issueNumber: 10,
        visibilityClass: "anonymous_readable",
        sourceUpdatedAt: "2026-07-01T10:00:00Z",
        lastTimelineSyncedAt: "2026-07-01T11:00:00Z"
      }
    ]);
  });
});

describe("metric aggregation", () => {
  test("uses severity timeline evidence for active critical issue age", () => {
    expect(
      criticalActiveMetricSnapshot({
        severity: "severity/s0",
        criticalLabels: ["severity/s-1", "severity/s0"],
        criticalStartedAt: "2026-07-03T00:00:00.000Z",
        asOf: new Date("2026-07-04T12:00:00.000Z")
      })
    ).toEqual({
      active: true,
      ageHours: 36,
      evidence: "issue_timeline_event"
    });
  });

  test("does not use issue created age when severity timeline evidence is missing", () => {
    expect(
      criticalActiveMetricSnapshot({
        severity: "severity/s-1",
        criticalLabels: ["severity/s-1", "severity/s0"],
        criticalStartedAt: null,
        asOf: new Date("2026-07-04T12:00:00.000Z")
      })
    ).toEqual({
      active: true,
      ageHours: null,
      evidence: "missing_timeline"
    });
  });

  test("does not count an issue as active before its severity label event", () => {
    expect(
      criticalActiveMetricSnapshot({
        severity: "severity/s0",
        criticalLabels: ["severity/s-1", "severity/s0"],
        criticalStartedAt: "2026-07-05T00:00:00.000Z",
        asOf: new Date("2026-07-04T12:00:00.000Z")
      })
    ).toEqual({
      active: false,
      ageHours: null,
      evidence: "not_active"
    });
  });

  test("marks metric source complete only when cached object evidence is complete", () => {
    expect(
      metricSourceCompletenessForObject({
        isComplete: true,
        syncError: null
      })
    ).toBe("complete_cache");
    expect(
      metricSourceCompletenessForObject({
        isComplete: false,
        syncError: null
      })
    ).toBe("partial_cache");
    expect(
      metricSourceCompletenessForObject({
        isComplete: true,
        syncError: "GitHub timeout"
      })
    ).toBe("partial_cache");
  });

  test("marks PR metric source partial until PR detail evidence is synced", () => {
    expect(
      metricSourceCompletenessForObject({
        isComplete: true,
        syncError: null,
        requireDetail: true,
        detailSyncedAt: "2026-07-04T00:00:00.000Z",
        detailError: null
      })
    ).toBe("complete_cache");
    expect(
      metricSourceCompletenessForObject({
        isComplete: true,
        syncError: null,
        requireDetail: true,
        detailSyncedAt: null,
        detailError: null
      })
    ).toBe("partial_cache");
    expect(
      metricSourceCompletenessForObject({
        isComplete: true,
        syncError: null,
        requireDetail: true,
        detailSyncedAt: "2026-07-04T00:00:00.000Z",
        detailError: "mergeability check failed"
      })
    ).toBe("partial_cache");
  });

  test("counts deferred issues from deferred label timeline events", () => {
    expect(
      deferredIssueTransitionMetricEventsFromRows(
        {
          ...baseProfile,
          reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" }
        },
        [
          { number: 42, owner_login: "alice" },
          { number: 43, owner_login: "bob" }
        ],
        [
          {
            issue_number: 42,
            event_type: "labeled",
            label_name: "deferred",
            occurred_at: "2026-07-04 15:00:00"
          },
          {
            issue_number: 42,
            event_type: "unlabeled",
            label_name: "deferred",
            occurred_at: "2026-07-05 15:00:00"
          },
          {
            issue_number: 43,
            event_type: "labeled",
            label_name: "needs-triage",
            occurred_at: "2026-07-04 16:00:00"
          }
        ]
      )
    ).toEqual([
      {
        issueNumber: 42,
        ownerLogin: "alice",
        occurredAt: "2026-07-04T15:00:00Z",
        date: "2026-07-04"
      }
    ]);
  });

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
      activeCriticalIssues: 1,
      averageActiveCriticalIssueAgeHours: 12,
      needsTriageIssues: 2,
      averageNeedsTriageIssueAgeHours: 6,
      deferredIssues: 0,
      averageDeferredIssueAgeHours: null,
      pendingPrs: 3,
      averagePendingPrAgeHours: 10,
      attentionPrs: 1,
      ciFailedPrs: 0,
      requestedChangePrs: 1,
      reviewWaitingPrs: 1,
      mergeConflictPrs: 0,
      testingQueuePrs: 0,
      averageTestingQueueAgeHours: null,
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
      activeCriticalIssues: 2,
      averageActiveCriticalIssueAgeHours: 24,
      needsTriageIssues: 1,
      averageNeedsTriageIssueAgeHours: 30,
      deferredIssues: 1,
      averageDeferredIssueAgeHours: 40,
      pendingPrs: 4,
      averagePendingPrAgeHours: 18,
      attentionPrs: 2,
      ciFailedPrs: 1,
      requestedChangePrs: 0,
      reviewWaitingPrs: 2,
      mergeConflictPrs: 0,
      testingQueuePrs: 1,
      averageTestingQueueAgeHours: 9,
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
      activeCriticalIssues: 3,
      averageActiveCriticalIssueAgeHours: 30,
      needsTriageIssues: 4,
      averageNeedsTriageIssueAgeHours: 12,
      deferredIssues: 2,
      averageDeferredIssueAgeHours: 60,
      pendingPrs: 6,
      averagePendingPrAgeHours: 26,
      attentionPrs: 3,
      ciFailedPrs: 2,
      requestedChangePrs: 1,
      reviewWaitingPrs: 3,
      mergeConflictPrs: 1,
      testingQueuePrs: 2,
      averageTestingQueueAgeHours: 11,
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
      activeCriticalIssues: 3,
      averageActiveCriticalIssueAgeHours: 30,
      needsTriageIssues: 4,
      averageNeedsTriageIssueAgeHours: 12,
      pendingPrs: 6,
      averagePendingPrAgeHours: 26,
      attentionPrs: 3,
      ciFailedPrs: 2,
      requestedChangePrs: 1,
      reviewWaitingPrs: 3,
      mergeConflictPrs: 1,
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

    expect(
      monthly.map((point) => ({ start: point.periodStart, end: point.periodEnd, created: point.prsCreated }))
    ).toEqual([
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
