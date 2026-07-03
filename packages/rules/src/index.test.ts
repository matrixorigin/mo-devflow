import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { normalizeIssue, normalizePullRequest } from "./index";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide"
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
    aiEasyS0ToTestAttentionDays: 7
  },
  testing: {
    handoffSignals: { labels: [], reviewerUsers: [], assigneeUsers: [], comments: [] }
  },
  notifications: { wecom: { enabled: false }, employees: {} },
  raw: {}
};

describe("rules", () => {
  test("critical issue is repo-wide and owner is derived from assignee first", () => {
    const issue = normalizeIssue(
      profile,
      {
        id: 1,
        number: 7,
        title: "panic on insert",
        state: "open",
        user: { login: "reporter" },
        html_url: "https://example.test/7",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T01:00:00Z",
        labels: [{ name: "kind/bug" }, { name: "severity/s0" }],
        assignees: [{ login: "owner" }]
      },
      "anonymous"
    );

    expect(issue.lifecycleState).toBe("critical");
    expect(issue.severity).toBe("severity/s0");
    expect(issue.ownerLogin).toBe("owner");
    expect(issue.ownerReason).toBe("assignee");
    expect(issue.visibilityClass).toBe("anonymous_readable");
  });

  test("stale PR attention uses last human action", () => {
    const pr = normalizePullRequest(
      profile,
      {
        id: 2,
        number: 8,
        title: "fix",
        state: "open",
        user: { login: "alice" },
        html_url: "https://example.test/8",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
        head: { ref: "fix" },
        base: { ref: "main" }
      },
      "anonymous"
    );

    expect(pr.ownerLogin).toBe("alice");
    expect(pr.attentionFlags).toContain("no_human_action_24h");
  });
});
