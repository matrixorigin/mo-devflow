import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { buildDailyDigestNotificationCandidate } from "./notifications";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide"
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
  notifications: {
    wecom: { enabled: true, webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL" },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group" }
  },
  raw: {}
};

describe("daily digest notification candidates", () => {
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
