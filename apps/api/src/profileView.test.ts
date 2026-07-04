import { describe, expect, test } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { publicRepoProfileView } from "./profileView";

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: {
    owner: "matrixorigin",
    name: "matrixone",
    localPath: "/Users/private/github/matrixone"
  },
  reporting: {
    timezone: "Asia/Shanghai",
    weekStart: "Monday"
  },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: false
  },
  people: {
    watchedUsers: ["real-dev-login"],
    testers: ["real-tester-login"]
  },
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
    aiEffort: ["ai-easy", "ai-manual"]
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
    handoffScope: "issue",
    handoffSignals: {
      labels: [],
      reviewerUsers: [],
      assigneeUsers: ["real-tester-login"],
      comments: []
    }
  },
  workflow: {
    skipUsers: ["real-skip-login"]
  },
  notifications: {
    wecom: {
      enabled: true,
      webhookUrlEnv: "MO_DEVFLOW_WECOM_WEBHOOK_URL"
    },
    employees: {
      "real-dev-login": { wecomUserId: "real-wecom-id" }
    },
    routing: {
      cooldownHours: 12,
      fallbackRecipient: "maintainer_group",
      escalateAfterHours: 24
    }
  },
  raw: {}
};

describe("public repo profile view", () => {
  test("redacts local profile identities and paths while keeping configuration state", () => {
    const original = {
      MO_DEVFLOW_GITHUB_TOKEN: process.env.MO_DEVFLOW_GITHUB_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN
    };
    delete process.env.MO_DEVFLOW_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      const view = publicRepoProfileView(profile);
      const serialized = JSON.stringify(view);

      expect(view.repo).toEqual({ owner: "matrixorigin", name: "matrixone" });
      expect(view.configuration).toMatchObject({
        localCheckoutConfigured: true,
        writeBackEnabled: false,
        watchedUsersConfigured: true,
        watchedUserCount: 1,
        testersConfigured: true,
        testerCount: 1,
        testingHandoffConfigured: true,
        workflowSkipUsersConfigured: true,
        workflowSkipUserCount: 1,
        notificationEmployeesConfigured: true,
        notificationEmployeeCount: 1,
        webhookSecretConfigured: false,
        githubServiceTokenConfigured: false,
        prDetailBackfillLimit: 0,
        commentBackfillLimit: 0,
        issueTimelineBackfillLimit: 0,
        githubEvidenceBackfillConfigured: false
      });
      expect(view.access.userTokenPrivateDataProtected).toBe(true);
      expect(serialized).not.toContain("/Users/private");
      expect(serialized).not.toContain("real-dev-login");
      expect(serialized).not.toContain("real-tester-login");
      expect(serialized).not.toContain("real-skip-login");
      expect(serialized).not.toContain("real-wecom-id");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("reports service-token readiness without leaking the token value", () => {
    const original = {
      MO_DEVFLOW_GITHUB_TOKEN: process.env.MO_DEVFLOW_GITHUB_TOKEN,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN
    };
    process.env.MO_DEVFLOW_GITHUB_TOKEN = "secret-service-token";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    try {
      const view = publicRepoProfileView(profile);
      const serialized = JSON.stringify(view);

      expect(view.configuration).toMatchObject({
        githubServiceTokenConfigured: true,
        prDetailBackfillLimit: 25,
        commentBackfillLimit: 25,
        issueTimelineBackfillLimit: 25,
        githubEvidenceBackfillConfigured: true
      });
      expect(serialized).not.toContain("secret-service-token");
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
