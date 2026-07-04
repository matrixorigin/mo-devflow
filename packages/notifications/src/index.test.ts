import { describe, expect, test } from "vitest";
import type { NotificationCandidate, RepoProfile } from "@mo-devflow/shared";
import {
  WeComSendError,
  buildWeComMarkdown,
  classifyWeComFailure,
  isInQuietHours,
  sendWeComMarkdown,
  weComFailureKindFromHttpStatus,
  weComFailureKindFromProviderCode
} from "./index";

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
  people: { watchedUsers: ["alice"], testers: [] },
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

const candidate: NotificationCandidate = {
  sourceType: "workflow_violation",
  sourceId: 7,
  ruleKey: "stale_needs_triage",
  severity: "warning",
  objectType: "issue",
  objectNumber: 42,
  title: "needs triage issue that has waited too long",
  htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
  dashboardUrl: "https://devflow.example.com/#violations",
  relatedLogin: "alice",
  recipient: "alice-wecom",
  dedupeKey: "notification:workflow_violation:7:stale_needs_triage",
  evidenceSummary: "Issue #42 has remained needs-triage beyond the configured threshold.",
  firstDetectedAt: "2026-07-03T00:00:00.000Z",
  lastDetectedAt: "2026-07-03T08:00:00.000Z"
};

describe("notifications", () => {
  test("builds WeCom markdown without exposing webhook configuration", () => {
    const markdown = buildWeComMarkdown(profile, candidate);

    expect(markdown).toContain("mo-devflow WARNING alert");
    expect(markdown).toContain("Repo: matrixorigin/matrixone");
    expect(markdown).toContain("[Open in mo-devflow](https://devflow.example.com/#violations)");
    expect(markdown).toContain("[issue #42](https://github.com/matrixorigin/matrixone/issues/42)");
    expect(markdown).toContain("Owner: alice");
    expect(markdown).not.toContain("webhook");
  });

  test("builds daily digest markdown as a summary instead of an alert", () => {
    const markdown = buildWeComMarkdown(profile, {
      ...candidate,
      sourceType: "daily_digest",
      ruleKey: "daily_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Daily digest for matrixorigin/matrixone on 2026-07-03",
      htmlUrl: "https://github.com/matrixorigin/matrixone",
      dashboardUrl: "https://devflow.example.com/#analytics",
      relatedLogin: null,
      evidenceSummary: "Team: 5 PRs created, 3 merged."
    });

    expect(markdown).toContain("mo-devflow daily digest");
    expect(markdown).toContain("[Open in mo-devflow](https://devflow.example.com/#analytics)");
    expect(markdown).toContain("Daily digest for matrixorigin/matrixone on 2026-07-03");
    expect(markdown).not.toContain("INFO alert");
  });

  test("builds weekly digest markdown as a summary instead of an alert", () => {
    const markdown = buildWeComMarkdown(profile, {
      ...candidate,
      sourceType: "weekly_digest",
      ruleKey: "weekly_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Weekly digest for matrixorigin/matrixone on 2026-06-22 to 2026-06-28",
      htmlUrl: "https://github.com/matrixorigin/matrixone",
      dashboardUrl: "https://devflow.example.com/#analytics",
      relatedLogin: null,
      evidenceSummary: "Team: 25 PRs created, 18 merged."
    });

    expect(markdown).toContain("mo-devflow weekly digest");
    expect(markdown).toContain("[Open in mo-devflow](https://devflow.example.com/#analytics)");
    expect(markdown).toContain("Weekly digest for matrixorigin/matrixone on 2026-06-22 to 2026-06-28");
    expect(markdown).not.toContain("INFO alert");
  });

  test("builds monthly digest markdown as a summary instead of an alert", () => {
    const markdown = buildWeComMarkdown(profile, {
      ...candidate,
      sourceType: "monthly_digest",
      ruleKey: "monthly_maintainer_digest",
      severity: "info",
      objectType: "digest",
      objectNumber: null,
      title: "Monthly digest for matrixorigin/matrixone on 2026-06",
      htmlUrl: "https://github.com/matrixorigin/matrixone",
      dashboardUrl: "https://devflow.example.com/#analytics",
      relatedLogin: null,
      evidenceSummary: "Team: 100 PRs created, 82 merged."
    });

    expect(markdown).toContain("mo-devflow monthly digest");
    expect(markdown).toContain("[Open in mo-devflow](https://devflow.example.com/#analytics)");
    expect(markdown).toContain("Monthly digest for matrixorigin/matrixone on 2026-06");
    expect(markdown).not.toContain("INFO alert");
  });

  test("truncates long titles and evidence to keep notifications readable", () => {
    const markdown = buildWeComMarkdown(profile, {
      ...candidate,
      title: "a".repeat(160),
      evidenceSummary: "b".repeat(360)
    });

    expect(markdown).toContain(`${"a".repeat(117)}...`);
    expect(markdown).toContain(`${"b".repeat(277)}...`);
    expect(markdown).not.toContain("a".repeat(121));
    expect(markdown).not.toContain("b".repeat(281));
  });

  test("handles quiet hours that cross midnight in the configured timezone", () => {
    const quietHours = { start: "22:00", end: "09:00" };

    expect(isInQuietHours(quietHours, "Asia/Shanghai", new Date("2026-07-03T15:30:00.000Z"))).toBe(true);
    expect(isInQuietHours(quietHours, "Asia/Shanghai", new Date("2026-07-04T03:00:00.000Z"))).toBe(false);
  });

  test("rejects non-HTTPS webhook URLs before sending", async () => {
    await expect(sendWeComMarkdown("http://example.test/webhook", "message")).rejects.toThrow("must use https");
  });

  test("classifies WeCom HTTP failures by retryability", () => {
    expect(weComFailureKindFromHttpStatus(429)).toBe("transient");
    expect(weComFailureKindFromHttpStatus(500)).toBe("transient");
    expect(weComFailureKindFromHttpStatus(400)).toBe("permanent");
  });

  test("classifies WeCom provider error codes by retryability", () => {
    expect(weComFailureKindFromProviderCode(45009)).toBe("transient");
    expect(weComFailureKindFromProviderCode(40013)).toBe("permanent");
  });

  test("preserves permanent validation errors for worker delivery status", async () => {
    let error: unknown;
    try {
      await sendWeComMarkdown("http://example.test/webhook", "message");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WeComSendError);
    expect(classifyWeComFailure(error)).toBe("permanent");
  });
});
