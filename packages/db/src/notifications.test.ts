import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { notificationStatusRequiresAcknowledgement } from "@mo-devflow/shared";
import {
  activeNotificationDeliverySourceWhereSql,
  buildCriticalNotificationEscalationCandidate,
  buildDailyDigestNotificationCandidate,
  buildMonthlyDigestNotificationCandidate,
  buildWeeklyDigestNotificationCandidate,
  dailyDigestMetricDate,
  excludedAttentionSourceWhereSql,
  monthlyDigestPeriod,
  notificationImmediateLimit,
  weeklyDigestPeriod,
  notificationDeliveryVisibilityWhereSql,
  notificationDashboardBaseUrlFromEnv,
  notificationDashboardUrl,
  notificationDeliveryCooldownHours,
  notificationReadiness,
  notificationSourceObjectVisibilityWhereSql,
  PERMANENT_NOTIFICATION_FAILURE_COOLDOWN_HOURS,
  notificationRecipient,
  notificationRecipientScope
} from "./notifications";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: true
  },
  people: { watchedUsers: ["alice", "bob"], testers: [] },
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
    wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group", escalateAfterHours: 24 }
  },
  raw: {}
};

describe("daily digest notification candidates", () => {
  test("derives dashboard base URLs from deployment environment", () => {
    expect(notificationDashboardBaseUrlFromEnv({ MO_DEVFLOW_DASHBOARD_URL: "https://devflow.example.com/app/" })).toBe(
      "https://devflow.example.com/app"
    );
    expect(notificationDashboardBaseUrlFromEnv({ MO_DEVFLOW_WEB_PORT: "5179" })).toBe("http://localhost:5179");
  });

  test("builds dashboard deep links for notification candidates", () => {
    expect(notificationDashboardUrl("https://devflow.example.com", "workflow_violation", "issue")).toBe(
      "https://devflow.example.com/#violations"
    );
    expect(notificationDashboardUrl("https://devflow.example.com", "ai_drift_signal", "pull_request")).toBe(
      "https://devflow.example.com/#drift"
    );
    expect(notificationDashboardUrl("https://devflow.example.com", "attention_item", "pull_request")).toBe(
      "https://devflow.example.com/#prs"
    );
    expect(notificationDashboardUrl("https://devflow.example.com", "daily_digest", "digest")).toBe(
      "https://devflow.example.com/#analytics"
    );
    expect(notificationDashboardUrl("https://devflow.example.com", "weekly_digest", "digest")).toBe(
      "https://devflow.example.com/#analytics"
    );
    expect(notificationDashboardUrl("https://devflow.example.com", "monthly_digest", "digest")).toBe(
      "https://devflow.example.com/#analytics"
    );
  });

  test("reserves digest slots when listing notification candidates", () => {
    expect(notificationImmediateLimit(1)).toBe(1);
    expect(notificationImmediateLimit(2)).toBe(1);
    expect(notificationImmediateLimit(4)).toBe(1);
    expect(notificationImmediateLimit(20)).toBe(17);
  });

  test("uses the previous repo-local calendar day as the digest metric date", () => {
    expect(dailyDigestMetricDate("Asia/Shanghai", new Date("2026-07-04T01:00:00.000Z"))).toBe("2026-07-03");
  });

  test("uses the previous completed repo-local week for weekly digests", () => {
    expect(weeklyDigestPeriod("Asia/Shanghai", "Monday", new Date("2026-07-04T01:00:00.000Z"))).toEqual({
      start: "2026-06-22",
      end: "2026-06-29",
      label: "2026-06-22 to 2026-06-28"
    });
  });

  test("uses the previous completed repo-local month for monthly digests", () => {
    expect(monthlyDigestPeriod("Asia/Shanghai", new Date("2026-07-04T01:00:00.000Z"))).toEqual({
      start: "2026-06-01",
      end: "2026-07-01",
      label: "2026-06"
    });
  });

  test("builds a maintainer digest from cached daily metrics", () => {
    const candidate = buildDailyDigestNotificationCandidate({
      profile,
      metricDate: "2026-07-03",
      team: {
        prsCreated: 5,
        prsMerged: 3,
        issuesOpened: 2,
        issuesClosed: 1,
        issuesDeferred: 1,
        workflowViolationsDetected: 4,
        sourceCompleteness: "partial_cache"
      },
      people: [
        { login: "alice", prsCreated: 2, prsMerged: 1, workflowViolationsDetected: 3 },
        { login: "bob", prsCreated: 0, prsMerged: 2, workflowViolationsDetected: 0 }
      ],
      generatedAt: "2026-07-04T01:00:00.000Z"
    });

    expect(candidate).toMatchObject({
      sourceType: "daily_digest",
      sourceId: 0,
      ruleKey: "daily_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Daily digest for matrixorigin/matrixone on 2026-07-03",
      dashboardUrl: "http://localhost:5173/#analytics",
      recipient: "maintainer_group",
      dedupeKey: "notification:daily_digest:matrixorigin/matrixone:2026-07-03"
    });
    expect(candidate.evidenceSummary).toContain("Team: 5 PRs created, 3 merged, 2 issues opened, 1 closed, 1 deferred.");
    expect(candidate.evidenceSummary).toContain("Workflow violations detected: 4.");
    expect(candidate.evidenceSummary).toContain("alice: 2 created, 1 merged, 3 violations");
    expect(candidate.evidenceSummary).toContain("Cache completeness: partial_cache.");
  });

  test("builds a weekly maintainer digest from cached weekly metrics", () => {
    const candidate = buildWeeklyDigestNotificationCandidate({
      profile,
      period: { start: "2026-06-22", end: "2026-06-29", label: "2026-06-22 to 2026-06-28" },
      team: {
        prsCreated: 25,
        prsMerged: 18,
        issuesOpened: 12,
        issuesClosed: 8,
        issuesDeferred: 3,
        workflowViolationsDetected: 9,
        sourceCompleteness: "partial_cache"
      },
      people: [
        { login: "alice", prsCreated: 8, prsMerged: 5, workflowViolationsDetected: 4 },
        { login: "bob", prsCreated: 2, prsMerged: 7, workflowViolationsDetected: 1 }
      ],
      generatedAt: "2026-07-04T01:00:00.000Z"
    });

    expect(candidate).toMatchObject({
      sourceType: "weekly_digest",
      sourceId: 0,
      ruleKey: "weekly_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Weekly digest for matrixorigin/matrixone on 2026-06-22 to 2026-06-28",
      dashboardUrl: "http://localhost:5173/#analytics",
      recipient: "maintainer_group",
      dedupeKey: "notification:weekly_digest:matrixorigin/matrixone:2026-06-22"
    });
    expect(candidate.evidenceSummary).toContain("Team: 25 PRs created, 18 merged, 12 issues opened, 8 closed, 3 deferred.");
    expect(candidate.evidenceSummary).toContain("Workflow violations detected: 9.");
    expect(candidate.evidenceSummary).toContain("alice: 8 created, 5 merged, 4 violations");
    expect(candidate.evidenceSummary).toContain("Cache completeness: partial_cache.");
  });

  test("builds a monthly maintainer digest from cached monthly metrics", () => {
    const candidate = buildMonthlyDigestNotificationCandidate({
      profile,
      period: { start: "2026-06-01", end: "2026-07-01", label: "2026-06" },
      team: {
        prsCreated: 100,
        prsMerged: 82,
        issuesOpened: 44,
        issuesClosed: 39,
        issuesDeferred: 12,
        workflowViolationsDetected: 21,
        sourceCompleteness: "partial_cache"
      },
      people: [
        { login: "alice", prsCreated: 22, prsMerged: 18, workflowViolationsDetected: 10 },
        { login: "bob", prsCreated: 17, prsMerged: 20, workflowViolationsDetected: 3 }
      ],
      generatedAt: "2026-07-04T01:00:00.000Z"
    });

    expect(candidate).toMatchObject({
      sourceType: "monthly_digest",
      sourceId: 0,
      ruleKey: "monthly_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Monthly digest for matrixorigin/matrixone on 2026-06",
      dashboardUrl: "http://localhost:5173/#analytics",
      recipient: "maintainer_group",
      dedupeKey: "notification:monthly_digest:matrixorigin/matrixone:2026-06-01"
    });
    expect(candidate.evidenceSummary).toContain(
      "Team: 100 PRs created, 82 merged, 44 issues opened, 39 closed, 12 deferred."
    );
    expect(candidate.evidenceSummary).toContain("Workflow violations detected: 21.");
    expect(candidate.evidenceSummary).toContain("alice: 22 created, 18 merged, 10 violations");
    expect(candidate.evidenceSummary).toContain("Cache completeness: partial_cache.");
  });
});

describe("notification acknowledgement health", () => {
  test("builds critical escalation candidates for unacknowledged attention items", () => {
    const candidate = buildCriticalNotificationEscalationCandidate({
      profile,
      sourceId: 42,
      ruleKey: "critical_no_human_action",
      objectType: "issue",
      objectNumber: 24413,
      dashboardUrl: "https://devflow.example.com/#overview",
      htmlUrl: "https://github.com/matrixorigin/matrixone/issues/24413",
      relatedLogin: "alice",
      evidenceSummary: "Critical issue #24413 has no recent human action.",
      firstDetectedAt: "2026-07-01T00:00:00.000Z",
      lastDetectedAt: "2026-07-03T00:00:00.000Z",
      lastSentAt: "2026-07-02T00:00:00.000Z",
      escalationHours: 24
    });

    expect(candidate).toMatchObject({
      sourceType: "attention_item",
      sourceId: 42,
      ruleKey: "critical_no_human_action:escalation",
      severity: "critical",
      objectType: "issue",
      objectNumber: 24413,
      title: "Escalation: issue #24413",
      dashboardUrl: "https://devflow.example.com/#overview",
      relatedLogin: "alice",
      recipient: "maintainer_group",
      dedupeKey: "notification:attention_item_escalation:42:critical_no_human_action"
    });
    expect(candidate.evidenceSummary).toContain("unacknowledged for at least 24h");
    expect(candidate.evidenceSummary).toContain("Critical issue #24413 has no recent human action.");
  });

  test("builds attention source exclusion filters for already escalated candidates", () => {
    expect(excludedAttentionSourceWhereSql("a", [])).toEqual({ sql: "1 = 1", params: [] });
    expect(excludedAttentionSourceWhereSql("a", [42, 51])).toEqual({
      sql: "a.id NOT IN (?, ?)",
      params: [42, 51]
    });
  });

  test("counts only actually sent deliveries as awaiting acknowledgement", () => {
    expect(notificationStatusRequiresAcknowledgement("sent")).toBe(true);
    expect(notificationStatusRequiresAcknowledgement("dry_run")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed_transient")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed_permanent")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("retry_requested")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_disabled")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_no_webhook")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_quiet_hours")).toBe(false);
  });

  test("derives delivery cooldown from latest delivery status", () => {
    expect(notificationDeliveryCooldownHours([], 12)).toBeNull();
    expect(notificationDeliveryCooldownHours([{ status: "sent" }], 12)).toBe(12);
    expect(notificationDeliveryCooldownHours([{ status: "dry_run" }], 12)).toBe(12);
    expect(notificationDeliveryCooldownHours([{ status: "failed_transient" }], 12)).toBe(0.25);
    expect(
      notificationDeliveryCooldownHours(
        [{ status: "failed_transient" }, { status: "failed_transient" }, { status: "sent" }],
        12
      )
    ).toBe(0.5);
    expect(
      notificationDeliveryCooldownHours(
        [
          { status: "failed_transient" },
          { status: "failed_transient" },
          { status: "failed_transient" },
          { status: "failed_transient" }
        ],
        1
      )
    ).toBe(1);
    expect(notificationDeliveryCooldownHours([{ status: "failed_permanent" }], 12)).toBe(
      PERMANENT_NOTIFICATION_FAILURE_COOLDOWN_HOURS
    );
    expect(notificationDeliveryCooldownHours([{ status: "retry_requested" }], 12)).toBeNull();
    expect(notificationDeliveryCooldownHours([{ status: "skipped_quiet_hours" }], 12)).toBeNull();
  });

  test("summarizes notification readiness for disabled WeCom delivery", () => {
    expect(
      notificationReadiness({
        profile: {
          ...profile,
          notifications: {
            ...profile.notifications,
            wecom: { enabled: false, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
          }
        },
        env: {},
        missingEmployeeMappings: 0
      })
    ).toMatchObject({
      status: "disabled",
      webhookEnvVar: "MO_DEVFLOW_WECOM_WEBHOOK_URL",
      mappedEmployees: 0,
      missingEmployeeMappings: 0,
      fallbackRecipient: "maintainer_group",
      blockers: ["WeCom delivery is disabled in the repository profile."],
      warnings: []
    });
  });

  test("requires configured webhook environment when WeCom delivery is enabled", () => {
    expect(
      notificationReadiness({
        profile: {
          ...profile,
          notifications: {
            ...profile.notifications,
            wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" }
          }
        },
        env: {},
        missingEmployeeMappings: 0
      })
    ).toMatchObject({
      status: "action_required",
      blockers: ["MO_DEVFLOW_WECOM_WEBHOOK_URL is not set in the API or worker environment."],
      warnings: []
    });
  });

  test("marks notifications degraded when owner mappings fall back to maintainer routing", () => {
    expect(
      notificationReadiness({
        profile: {
          ...profile,
          notifications: {
            ...profile.notifications,
            wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" },
            employees: { alice: { wecomUserId: "alice-wecom" } }
          }
        },
        env: { MO_DEVFLOW_WECOM_WEBHOOK_URL: "https://wecom.example.test/webhook" },
        missingEmployeeMappings: 2
      })
    ).toMatchObject({
      status: "degraded",
      mappedEmployees: 1,
      missingEmployeeMappings: 2,
      blockers: [],
      warnings: [
        "2 owner-routed notification recipients are missing employee mappings and will use fallback routing."
      ]
    });
  });

  test("marks notifications ready when channel and routing mappings are complete", () => {
    expect(
      notificationReadiness({
        profile: {
          ...profile,
          notifications: {
            ...profile.notifications,
            wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" },
            employees: { alice: { wecomUserId: "alice-wecom" } }
          }
        },
        env: { MO_DEVFLOW_WECOM_WEBHOOK_URL: "https://wecom.example.test/webhook" },
        missingEmployeeMappings: 0
      })
    ).toMatchObject({
      status: "ready",
      blockers: [],
      warnings: []
    });
  });

  test("builds strict active-source filter for notification health counters", () => {
    expect(activeNotificationDeliverySourceWhereSql("d")).toBe(
      [
        "(",
        "d.source_type IN ('daily_digest', 'weekly_digest', 'monthly_digest')",
        "OR (d.source_type = 'attention_item' AND EXISTS (SELECT 1 FROM attention_items ai WHERE ai.repo_id = d.repo_id AND ai.id = d.source_id AND ai.resolved_at IS NULL))",
        "OR (d.source_type = 'workflow_violation' AND EXISTS (SELECT 1 FROM workflow_violations wv WHERE wv.repo_id = d.repo_id AND wv.id = d.source_id AND wv.resolved_at IS NULL))",
        "OR (d.source_type = 'ai_drift_signal' AND EXISTS (SELECT 1 FROM ai_drift_signals ad WHERE ad.repo_id = d.repo_id AND ad.id = d.source_id AND ad.resolved_at IS NULL))",
        ")"
      ].join(" ")
    );
  });

  test("builds notification delivery visibility filter from the underlying cached object", () => {
    expect(notificationDeliveryVisibilityWhereSql("d", profile, { authenticated: false, userId: null })).toEqual({
      sql: [
        "(",
        "d.source_type IN ('daily_digest', 'weekly_digest', 'monthly_digest')",
        "OR d.object_number IS NULL",
        "OR (d.object_type = 'issue' AND EXISTS (SELECT 1 FROM issues i WHERE i.repo_id = d.repo_id AND i.number = d.object_number AND i.visibility_class IN ('anonymous_readable')))",
        "OR (d.object_type = 'pull_request' AND EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = d.repo_id AND p.number = d.object_number AND p.visibility_class IN ('anonymous_readable')))",
        ")"
      ].join(" "),
      params: []
    });

    expect(notificationDeliveryVisibilityWhereSql("d", profile, { authenticated: true, userId: 42 })).toEqual({
      sql: [
        "(",
        "d.source_type IN ('daily_digest', 'weekly_digest', 'monthly_digest')",
        "OR d.object_number IS NULL",
        "OR (d.object_type = 'issue' AND EXISTS (SELECT 1 FROM issues i WHERE i.repo_id = d.repo_id AND i.number = d.object_number AND (i.visibility_class IN ('anonymous_readable', 'logged_in_readable') OR (i.visibility_class = 'token_owner_only' AND i.source_user_id = ?))))",
        "OR (d.object_type = 'pull_request' AND EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = d.repo_id AND p.number = d.object_number AND (p.visibility_class IN ('anonymous_readable', 'logged_in_readable') OR (p.visibility_class = 'token_owner_only' AND p.source_user_id = ?))))",
        ")"
      ].join(" "),
      params: [42, 42]
    });
  });

  test("builds external notification source filter without token-owner-only cache", () => {
    expect(notificationSourceObjectVisibilityWhereSql("a", profile)).toEqual({
      sql: [
        "(",
        "a.object_number IS NULL",
        "OR (a.object_type = 'issue' AND EXISTS (SELECT 1 FROM issues i WHERE i.repo_id = a.repo_id AND i.number = a.object_number AND i.visibility_class IN ('anonymous_readable', 'logged_in_readable')))",
        "OR (a.object_type = 'pull_request' AND EXISTS (SELECT 1 FROM pull_requests p WHERE p.repo_id = a.repo_id AND p.number = a.object_number AND p.visibility_class IN ('anonymous_readable', 'logged_in_readable')))",
        ")"
      ].join(" "),
      params: []
    });
  });
});

describe("notification recipient routing", () => {
  test("maps GitHub logins to employee recipients case-insensitively", () => {
    expect(
      notificationRecipient(
        {
          ...profile,
          notifications: {
            ...profile.notifications,
            employees: {
              alice: { wecomUserId: "alice-wecom" }
            }
          }
        },
        "Alice"
      )
    ).toBe("alice-wecom");
  });

  test("uses the configured fallback recipient when mapping is missing", () => {
    expect(notificationRecipient(profile, "missing-user")).toBe("maintainer_group");
    expect(notificationRecipient(profile, null)).toBe("maintainer_group");
  });

  test("classifies delivery recipient scope for dashboard display", () => {
    expect(notificationRecipientScope(profile, "maintainer_group")).toBe("fallback");
    expect(notificationRecipientScope(profile, "alice-wecom")).toBe("mapped_employee");
  });
});
