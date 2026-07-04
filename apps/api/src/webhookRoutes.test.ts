import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { computeGitHubWebhookSignature } from "./githubWebhook";
import { registerWebhookRoutes } from "./webhookRoutes";

const mocks = vi.hoisted(() => ({
  loadRepoProfile: vi.fn(),
  recordGitHubWebhookDelivery: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  recordGitHubWebhookDelivery: mocks.recordGitHubWebhookDelivery,
  upsertRepoProfile: mocks.upsertRepoProfile
}));

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
  notifications: {
    wecom: { enabled: false },
    employees: {},
    routing: { cooldownHours: 12, fallbackRecipient: "maintainer_group" }
  },
  raw: {}
};

let originalWebhookSecret: string | undefined;

async function createWebhookApp() {
  const app = Fastify();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf8");
    request.rawBody = rawBody;
    done(null, rawBody ? JSON.parse(rawBody) : {});
  });
  await registerWebhookRoutes(app);
  return app;
}

describe("webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalWebhookSecret = process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET;
    delete process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET;
    mocks.loadRepoProfile.mockReturnValue(profile);
    mocks.upsertRepoProfile.mockResolvedValue(10);
    mocks.recordGitHubWebhookDelivery.mockResolvedValue({
      duplicate: false,
      deliveryId: "delivery-1",
      status: "pending"
    });
  });

  afterEach(() => {
    if (originalWebhookSecret === undefined) {
      delete process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET;
      return;
    }
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = originalWebhookSecret;
  });

  test("rejects GitHub webhooks when the webhook secret is not configured", async () => {
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-1",
          "x-github-event": "issues"
        },
        payload: JSON.stringify({
          action: "opened",
          repository: { full_name: "matrixorigin/matrixone" }
        })
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        error: "github_webhook_secret_unconfigured",
        message: "GitHub webhook secret is required before webhook deliveries can be ingested."
      });
      expect(mocks.loadRepoProfile).not.toHaveBeenCalled();
      expect(mocks.upsertRepoProfile).not.toHaveBeenCalled();
      expect(mocks.recordGitHubWebhookDelivery).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("stores signed GitHub webhooks when the signature matches the configured secret", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "matrixorigin/matrixone" }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-1",
          "x-github-event": "issues",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        deliveryId: "delivery-1",
        eventName: "issues",
        status: "pending"
      });
      expect(mocks.recordGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-1",
          eventName: "issues",
          action: "opened",
          signature256: computeGitHubWebhookSignature("webhook-secret", rawBody),
          rawPayload: rawBody
        })
      );
    } finally {
      await app.close();
    }
  });
});
