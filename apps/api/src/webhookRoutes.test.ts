import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { RepoProfile } from "@mo-devflow/shared";
import { computeGitHubWebhookSignature } from "./githubWebhook";
import { registerWebhookRoutes } from "./webhookRoutes";

const mocks = vi.hoisted(() => ({
  loadRepoProfile: vi.fn(),
  enqueueJobsNow: vi.fn(),
  recordGitHubWebhookDelivery: vi.fn(),
  recordIgnoredGitHubWebhookDelivery: vi.fn(),
  upsertRepoProfile: vi.fn()
}));

vi.mock("@mo-devflow/config", () => ({
  loadRepoProfile: mocks.loadRepoProfile
}));

vi.mock("@mo-devflow/db", () => ({
  enqueueJobsNow: mocks.enqueueJobsNow,
  recordGitHubWebhookDelivery: mocks.recordGitHubWebhookDelivery,
  recordIgnoredGitHubWebhookDelivery: mocks.recordIgnoredGitHubWebhookDelivery,
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
    mocks.recordGitHubWebhookDelivery.mockImplementation(async (input: { deliveryId: string }) => ({
      duplicate: false,
      deliveryId: input.deliveryId,
      status: "received"
    }));
    mocks.recordIgnoredGitHubWebhookDelivery.mockImplementation(async (input: { deliveryId: string }) => ({
      duplicate: false,
      deliveryId: input.deliveryId,
      status: "ignored"
    }));
    mocks.enqueueJobsNow.mockResolvedValue([]);
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
        status: "received",
        refreshQueued: true
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
      expect(mocks.recordIgnoredGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            jobKey: "webhooks:matrixorigin/matrixone",
            jobType: "webhooks",
            payload: expect.objectContaining({
              trigger: "github_webhook_delivery",
              deliveryId: "delivery-1",
              eventName: "issues",
              action: "opened"
            })
          }),
          expect.objectContaining({ jobKey: "rules:matrixorigin/matrixone", jobType: "rules" }),
          expect.objectContaining({ jobKey: "metrics:matrixorigin/matrixone", jobType: "metrics" }),
          expect.objectContaining({ jobKey: "ai-drift:matrixorigin/matrixone", jobType: "ai_drift" }),
          expect.objectContaining({ jobKey: "notifications:matrixorigin/matrixone", jobType: "notifications" })
        ])
      );
    } finally {
      await app.close();
    }
  });

  test("stores signed pull request review webhooks for PR insight refresh", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "submitted",
      repository: { full_name: "matrixorigin/matrixone" },
      pull_request: { number: 42 },
      review: { state: "changes_requested" }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-review",
          "x-github-event": "pull_request_review",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        deliveryId: "delivery-review",
        eventName: "pull_request_review",
        status: "received"
      });
      expect(mocks.recordGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-review",
          eventName: "pull_request_review",
          action: "submitted",
          rawPayload: rawBody
        })
      );
      expect(mocks.recordIgnoredGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  test("stores signed issue comment webhooks for issue and PR comment refresh", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "created",
      repository: { full_name: "matrixorigin/matrixone" },
      issue: { number: 45, pull_request: {} },
      comment: { id: 9001, body: "ready for testing" }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-comment",
          "x-github-event": "issue_comment",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        deliveryId: "delivery-comment",
        eventName: "issue_comment",
        status: "received",
        refreshQueued: true
      });
      expect(mocks.recordGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-comment",
          eventName: "issue_comment",
          action: "created",
          rawPayload: rawBody
        })
      );
      expect(mocks.recordIgnoredGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            jobKey: "webhooks:matrixorigin/matrixone",
            jobType: "webhooks",
            payload: expect.objectContaining({
              trigger: "github_webhook_delivery",
              deliveryId: "delivery-comment",
              eventName: "issue_comment",
              action: "created"
            })
          }),
          expect.objectContaining({ jobKey: "rules:matrixorigin/matrixone", jobType: "rules" }),
          expect.objectContaining({ jobKey: "metrics:matrixorigin/matrixone", jobType: "metrics" }),
          expect.objectContaining({ jobKey: "ai-drift:matrixorigin/matrixone", jobType: "ai_drift" }),
          expect.objectContaining({ jobKey: "notifications:matrixorigin/matrixone", jobType: "notifications" })
        ])
      );
    } finally {
      await app.close();
    }
  });

  test("stores signed workflow run webhooks for CI insight refresh", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "completed",
      repository: { full_name: "matrixorigin/matrixone" },
      workflow_run: { id: 123, pull_requests: [{ number: 42 }] }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-workflow",
          "x-github-event": "workflow_run",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({
        accepted: true,
        duplicate: false,
        deliveryId: "delivery-workflow",
        eventName: "workflow_run",
        status: "received"
      });
      expect(mocks.recordGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-workflow",
          eventName: "workflow_run",
          action: "completed",
          rawPayload: rawBody
        })
      );
      expect(mocks.recordIgnoredGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  test("records signed GitHub webhooks ignored for a different repository", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "matrixorigin/other" }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-mismatch",
          "x-github-event": "issues",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        accepted: false,
        duplicate: false,
        ignored: true,
        deliveryId: "delivery-mismatch",
        eventName: "issues",
        reason: "repository_mismatch"
      });
      expect(mocks.upsertRepoProfile).toHaveBeenCalledWith(profile);
      expect(mocks.recordIgnoredGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-mismatch",
          eventName: "issues",
          action: "opened",
          ignoredReason: "repository_mismatch",
          rawPayload: rawBody
        })
      );
      expect(mocks.recordGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("rejects signed GitHub webhooks without repository identity", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "opened",
      issue: { number: 42 }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-2",
          "x-github-event": "issues",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: "missing_repository_identity",
        message: "GitHub webhook payload must include repository.full_name."
      });
      expect(mocks.upsertRepoProfile).not.toHaveBeenCalled();
      expect(mocks.recordGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test("ignores signed GitHub webhooks for events that are not ingested yet", async () => {
    process.env.MO_DEVFLOW_GITHUB_WEBHOOK_SECRET = "webhook-secret";
    const rawBody = JSON.stringify({
      action: "created",
      repository: { full_name: "matrixorigin/matrixone" },
      deployment_status: { id: 123 }
    });
    const app = await createWebhookApp();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/webhooks/github",
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-3",
          "x-github-event": "deployment_status",
          "x-hub-signature-256": computeGitHubWebhookSignature("webhook-secret", rawBody)
        },
        payload: rawBody
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({
        accepted: false,
        duplicate: false,
        ignored: true,
        deliveryId: "delivery-3",
        eventName: "deployment_status",
        reason: "unsupported_event"
      });
      expect(mocks.upsertRepoProfile).toHaveBeenCalledWith(profile);
      expect(mocks.recordIgnoredGitHubWebhookDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          repoId: 10,
          deliveryId: "delivery-3",
          eventName: "deployment_status",
          action: "created",
          ignoredReason: "unsupported_event",
          rawPayload: rawBody
        })
      );
      expect(mocks.recordGitHubWebhookDelivery).not.toHaveBeenCalled();
      expect(mocks.enqueueJobsNow).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
