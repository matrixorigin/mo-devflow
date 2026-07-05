import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { dashboardReadAccess } from "./dashboardAccess";

const profile: RepoProfile = {
  key: "owner/repo",
  repo: { owner: "owner", name: "repo" },
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
  testing: { handoffScope: "issue", handoffSignals: { labels: [] } },
  workflow: { skipUsers: [] },
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group", escalateAfterHours: 24 }
  },
  raw: {}
};

describe("dashboard read access", () => {
  test("allows anonymous dashboards when the repo profile permits anonymous reads", () => {
    expect(dashboardReadAccess(profile, { authenticated: false, userId: null })).toEqual({ allowed: true });
  });

  test("requires login for anonymous dashboards when anonymous reads are disabled", () => {
    expect(
      dashboardReadAccess(
        { ...profile, access: { ...profile.access, anonymousRead: false } },
        { authenticated: false, userId: null }
      )
    ).toEqual({
      allowed: false,
      statusCode: 401,
      payload: {
        error: "dashboard_login_required",
        message:
          "This repository profile does not allow anonymous dashboard reads. Sign in with GitHub to view cached data."
      }
    });
  });

  test("allows logged-in dashboards even when anonymous reads are disabled", () => {
    expect(
      dashboardReadAccess(
        { ...profile, access: { ...profile.access, anonymousRead: false } },
        { authenticated: true, userId: 42 }
      )
    ).toEqual({ allowed: true });
  });
});
