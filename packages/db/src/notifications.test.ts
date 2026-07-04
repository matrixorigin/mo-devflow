import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { notificationStatusRequiresAcknowledgement } from "@mo-devflow/shared";
import {
  activeNotificationDeliverySourceWhereSql,
  buildDailyDigestNotificationCandidate,
  dailyDigestMetricDate,
  notificationDeliveryVisibilityWhereSql,
  notificationSourceObjectVisibilityWhereSql,
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
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group" }
  },
  raw: {}
};

describe("daily digest notification candidates", () => {
  test("uses the previous repo-local calendar day as the digest metric date", () => {
    expect(dailyDigestMetricDate("Asia/Shanghai", new Date("2026-07-04T01:00:00.000Z"))).toBe("2026-07-03");
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
      recipient: "maintainer_group",
      dedupeKey: "notification:daily_digest:matrixorigin/matrixone:2026-07-03"
    });
    expect(candidate.evidenceSummary).toContain("Team: 5 PRs created, 3 merged, 2 issues opened, 1 closed, 1 deferred.");
    expect(candidate.evidenceSummary).toContain("Workflow violations detected: 4.");
    expect(candidate.evidenceSummary).toContain("alice: 2 created, 1 merged, 3 violations");
    expect(candidate.evidenceSummary).toContain("Cache completeness: partial_cache.");
  });
});

describe("notification acknowledgement health", () => {
  test("counts only actually sent deliveries as awaiting acknowledgement", () => {
    expect(notificationStatusRequiresAcknowledgement("sent")).toBe(true);
    expect(notificationStatusRequiresAcknowledgement("dry_run")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("failed")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_disabled")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_no_webhook")).toBe(false);
    expect(notificationStatusRequiresAcknowledgement("skipped_quiet_hours")).toBe(false);
  });

  test("builds strict active-source filter for notification health counters", () => {
    expect(activeNotificationDeliverySourceWhereSql("d")).toBe(
      [
        "(",
        "d.source_type = 'daily_digest'",
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
        "d.source_type = 'daily_digest'",
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
        "d.source_type = 'daily_digest'",
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
