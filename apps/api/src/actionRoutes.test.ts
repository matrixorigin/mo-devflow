import Fastify from "fastify";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile, WorkflowFixPreview } from "@mo-devflow/shared";
import { encryptSecret, tokenEncryptionConfigFromEnv } from "./authCrypto";
import { registerActionRoutes } from "./actionRoutes";
import { csrfCookieName, csrfHeaderName } from "./csrf";

const mocks = vi.hoisted(() => ({
  loadRepoProfile: vi.fn(),
  getSessionRecordFromRequest: vi.fn(),
  getWorkflowFixPreviewForUser: vi.fn(),
  markWorkflowFixPreviewStatus: vi.fn(),
  recordWorkflowFixExecution: vi.fn(),
  getActiveGitHubTokenForUser: vi.fn(),
  getActiveWorkflowViolation: vi.fn(),
  getCachedIssueByNumber: vi.fn(),
  getRepoId: vi.fn(),
  fetchIssueFreshState: vi.fn(),
  fetchIssueWritePermission: vi.fn(),
  applyWorkflowFixPreview: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("./authRoutes", () => ({
  getSessionRecordFromRequest: mocks.getSessionRecordFromRequest
}));

vi.mock("@mo-devflow/db", () => ({
  enqueueJobsNow: vi.fn(),
  getActiveGitHubTokenForUser: mocks.getActiveGitHubTokenForUser,
  getActiveWorkflowViolation: mocks.getActiveWorkflowViolation,
  getCachedIssueByNumber: mocks.getCachedIssueByNumber,
  getRepoId: mocks.getRepoId,
  getWorkflowFixPreviewForUser: mocks.getWorkflowFixPreviewForUser,
  markWorkflowFixPreviewStatus: mocks.markWorkflowFixPreviewStatus,
  recordWorkflowFixExecution: mocks.recordWorkflowFixExecution,
  recordWorkflowFixPreview: vi.fn(),
  revokeGitHubTokenForUser: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/github", () => ({
  applyWorkflowFixPreview: mocks.applyWorkflowFixPreview,
  fetchIssueFreshState: mocks.fetchIssueFreshState,
  fetchIssueWritePermission: mocks.fetchIssueWritePermission
}));

const profile: RepoProfile = {
  key: "matrixorigin/matrixone",
  repo: { owner: "matrixorigin", name: "matrixone" },
  reporting: { timezone: "Asia/Shanghai", weekStart: "Monday" },
  access: {
    anonymousRead: true,
    exposeUserTokenSyncedPrivateData: false,
    criticalScope: "repo-wide",
    writeBackEnabled: false
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

const state = {
  source: "github" as const,
  state: "open" as const,
  labels: ["kind/bug"],
  assignees: [],
  lifecycleState: "other" as const,
  severity: null,
  aiEffortLabel: null,
  updatedAt: "2026-07-04T00:00:00.000Z"
};

const preview: WorkflowFixPreview = {
  previewId: "00000000-0000-4000-8000-000000000001",
  actionKey: "add_needs_triage",
  repoKey: "matrixorigin/matrixone",
  objectType: "issue",
  objectNumber: 42,
  ruleKey: "bug_missing_needs_triage",
  title: "panic on insert",
  htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
  reason: "Open bug issue #42 has no needs-triage label.",
  currentState: state,
  proposedState: { ...state, labels: ["kind/bug", "needs-triage"] },
  operations: [{ type: "add_label", label: "needs-triage" }],
  warnings: [],
  blockedReason: null,
  createdAt: "2026-07-04T00:00:00.000Z",
  expiresAt: "2999-07-04T00:00:00.000Z"
};

const csrfToken = "a".repeat(43);
const csrfHeaders = {
  cookie: `${csrfCookieName}=${csrfToken}`,
  [csrfHeaderName]: csrfToken
};

const originalTokenEncryptionKey = process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY;

function encryptedStoredToken() {
  process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const config = tokenEncryptionConfigFromEnv();
  if (!config) {
    throw new Error("test token encryption config missing");
  }
  const encrypted = encryptSecret("test-user-token", config);
  return {
    encryptedToken: encrypted.ciphertext,
    tokenIv: encrypted.iv,
    tokenAuthTag: encrypted.authTag,
    keyVersion: encrypted.keyVersion,
    scopes: ["repo"],
    repoPermission: "write",
    lastValidatedAt: "2026-07-04T00:00:00.000Z"
  };
}

describe("action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalTokenEncryptionKey === undefined) {
      delete process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.MO_DEVFLOW_TOKEN_ENCRYPTION_KEY = originalTokenEncryptionKey;
    }
    mocks.loadRepoProfile.mockReturnValue(profile);
    mocks.getSessionRecordFromRequest.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      tokenScopes: ["repo"],
      tokenRepoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });
    mocks.getRepoId.mockResolvedValue(10);
    mocks.getWorkflowFixPreviewForUser.mockResolvedValue({
      repoId: 10,
      userId: 1,
      githubLogin: "alice",
      previewId: preview.previewId,
      preview,
      status: "previewed",
      expiresAt: preview.expiresAt
    });
    mocks.fetchIssueWritePermission.mockResolvedValue({
      allowed: true,
      permission: "write",
      message: "GitHub token has write permission for issue workflow fixes.",
      rateLimitRemaining: 99
    });
  });

  test("rejects workflow fix previews without a valid CSRF token", async () => {
    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/preview",
        payload: {
          actionKey: "add_needs_triage",
          objectType: "issue",
          objectNumber: 42,
          ruleKey: "bug_missing_needs_triage"
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "csrf_required",
        message: "Refresh the session and retry the request."
      });
      expect(mocks.loadRepoProfile).not.toHaveBeenCalled();
      expect(mocks.getActiveWorkflowViolation).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("scopes workflow fix preview lookups to cache visible to the session user", async () => {
    const writeBackProfile = {
      ...profile,
      access: { ...profile.access, writeBackEnabled: true }
    };
    mocks.loadRepoProfile.mockReturnValue(writeBackProfile);
    mocks.getActiveWorkflowViolation.mockResolvedValue({
      objectType: "issue",
      objectNumber: 42,
      title: "panic on insert",
      htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
      ruleKey: "bug_missing_needs_triage",
      severity: "warning",
      relatedLogin: "alice",
      evidenceSummary: "Open bug issue #42 has no needs-triage label.",
      suggestedAction: "Add needs-triage.",
      fixable: true,
      firstDetectedAt: "2026-07-04T00:00:00.000Z",
      lastDetectedAt: "2026-07-04T00:00:00.000Z"
    });
    mocks.getCachedIssueByNumber.mockResolvedValue(null);

    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/preview",
        headers: csrfHeaders,
        payload: {
          actionKey: "add_needs_triage",
          objectType: "issue",
          objectNumber: 42,
          ruleKey: "bug_missing_needs_triage"
        }
      });

      expect(response.statusCode).toBe(404);
      expect(mocks.getActiveWorkflowViolation).toHaveBeenCalledWith({
        repoId: 10,
        objectType: "issue",
        objectNumber: 42,
        ruleKey: "bug_missing_needs_triage",
        profile: writeBackProfile,
        viewer: { authenticated: true, userId: 1 }
      });
      expect(mocks.getCachedIssueByNumber).toHaveBeenCalledWith({
        repoId: 10,
        issueNumber: 42,
        profile: writeBackProfile,
        viewer: { authenticated: true, userId: 1 }
      });
      expect(mocks.getActiveGitHubTokenForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects workflow fix preview from cached session capability when token lacks repo permission", async () => {
    const writeBackProfile = {
      ...profile,
      access: { ...profile.access, writeBackEnabled: true }
    };
    mocks.loadRepoProfile.mockReturnValue(writeBackProfile);
    mocks.getSessionRecordFromRequest.mockResolvedValue({
      userId: 1,
      githubLogin: "alice",
      tokenScopes: ["repo"],
      tokenRepoPermission: "read",
      tokenLastValidatedAt: "2026-07-04T00:00:00.000Z"
    });

    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/preview",
        headers: csrfHeaders,
        payload: {
          actionKey: "add_needs_triage",
          objectType: "issue",
          objectNumber: 42,
          ruleKey: "bug_missing_needs_triage"
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: "write_capability_unavailable",
        capability: {
          enabled: false,
          status: "insufficient_repo_permission",
          repoPermission: "read"
        }
      });
      expect(mocks.getActiveWorkflowViolation).not.toHaveBeenCalled();
      expect(mocks.getActiveGitHubTokenForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects workflow fix preview before fresh issue read when token lacks repository write permission", async () => {
    const writeBackProfile = {
      ...profile,
      access: { ...profile.access, writeBackEnabled: true }
    };
    mocks.loadRepoProfile.mockReturnValue(writeBackProfile);
    mocks.getActiveWorkflowViolation.mockResolvedValue({
      objectType: "issue",
      objectNumber: 42,
      title: "panic on insert",
      htmlUrl: "https://github.com/matrixorigin/matrixone/issues/42",
      ruleKey: "bug_missing_needs_triage",
      severity: "warning",
      relatedLogin: "alice",
      evidenceSummary: "Open bug issue #42 has no needs-triage label.",
      suggestedAction: "Add needs-triage.",
      fixable: true,
      firstDetectedAt: "2026-07-04T00:00:00.000Z",
      lastDetectedAt: "2026-07-04T00:00:00.000Z"
    });
    mocks.getCachedIssueByNumber.mockResolvedValue({ number: 42 });
    mocks.getActiveGitHubTokenForUser.mockResolvedValue(encryptedStoredToken());
    mocks.fetchIssueWritePermission.mockResolvedValue({
      allowed: false,
      permission: "read",
      message: "GitHub token has read permission for this repository; triage or write access is required.",
      rateLimitRemaining: 98
    });

    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/preview",
        headers: csrfHeaders,
        payload: {
          actionKey: "add_needs_triage",
          objectType: "issue",
          objectNumber: 42,
          ruleKey: "bug_missing_needs_triage"
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: "write_permission_unavailable",
        message: "GitHub token has read permission for this repository; triage or write access is required.",
        permission: "read"
      });
      expect(mocks.fetchIssueWritePermission).toHaveBeenCalledWith({
        token: "test-user-token",
        profile: writeBackProfile
      });
      expect(mocks.fetchIssueFreshState).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("blocks workflow fix confirmation before token access when profile write-back is disabled", async () => {
    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/confirm",
        headers: csrfHeaders,
        payload: { previewId: preview.previewId }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        previewId: preview.previewId,
        status: "blocked",
        message: "GitHub write-back is disabled in the repository profile.",
        executedOperations: []
      });
      expect(mocks.markWorkflowFixPreviewStatus).toHaveBeenCalledWith({
        previewId: preview.previewId,
        userId: 1,
        status: "blocked"
      });
      expect(mocks.recordWorkflowFixExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          userId: 1,
          githubLogin: "alice",
          preview,
          result: expect.objectContaining({ status: "blocked" })
        })
      );
      expect(mocks.getActiveGitHubTokenForUser).not.toHaveBeenCalled();
      expect(mocks.applyWorkflowFixPreview).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("audits workflow fix confirmation as blocked when token loses repository write permission", async () => {
    const writeBackProfile = {
      ...profile,
      access: { ...profile.access, writeBackEnabled: true }
    };
    mocks.loadRepoProfile.mockReturnValue(writeBackProfile);
    mocks.getActiveGitHubTokenForUser.mockResolvedValue(encryptedStoredToken());
    mocks.fetchIssueWritePermission.mockResolvedValue({
      allowed: false,
      permission: "read",
      message: "GitHub token has read permission for this repository; triage or write access is required.",
      rateLimitRemaining: 98
    });

    const app = Fastify();
    await registerActionRoutes(app);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/actions/workflow-fix/confirm",
        headers: csrfHeaders,
        payload: { previewId: preview.previewId }
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        previewId: preview.previewId,
        status: "blocked",
        message: "GitHub token has read permission for this repository; triage or write access is required.",
        executedOperations: []
      });
      expect(mocks.recordWorkflowFixExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          userId: 1,
          githubLogin: "alice",
          preview,
          result: expect.objectContaining({ status: "blocked" })
        })
      );
      expect(mocks.applyWorkflowFixPreview).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
