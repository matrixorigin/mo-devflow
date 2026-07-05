import { describe, expect, test } from "vitest";
import type { CacheObjectEvidenceView, DashboardSummary, SessionView, SyncHealth } from "@mo-devflow/shared";
import {
  recommendCacheRepair,
  summarizeCacheEvidence,
  summarizeFreshness,
  summarizeProductionReadiness,
  summarizeUpdatePipeline,
  summarizeWebhookReadiness
} from "./freshness";

function layer(input: Partial<SyncHealth> & Pick<SyncHealth, "layer">): SyncHealth {
  return {
    layer: input.layer,
    status: input.status ?? "success",
    lastSuccessfulAt: input.lastSuccessfulAt ?? "2026-07-04T01:00:00.000Z",
    lastAttemptedAt: input.lastAttemptedAt ?? "2026-07-04T01:00:00.000Z",
    lastFailedAt: input.lastFailedAt ?? null,
    lastFailureMessage: input.lastFailureMessage ?? null,
    cursorValue: input.cursorValue ?? null,
    errorMessage: input.errorMessage ?? null,
    rateLimitRemaining: input.rateLimitRemaining ?? null,
    skipped: input.skipped ?? false,
    skipReason: input.skipReason ?? null
  };
}

function sync(input: Partial<DashboardSummary["sync"]>): DashboardSummary["sync"] {
  return {
    generatedAt: "2026-07-04T02:00:00.000Z",
    health: [
      layer({ layer: "github_sync", lastSuccessfulAt: "2026-07-04T00:30:00.000Z" }),
      layer({ layer: "rules", lastSuccessfulAt: "2026-07-04T01:00:00.000Z" })
    ],
    staleObjects: 0,
    staleThresholdHours: 6,
    oldestCacheAgeHours: 1,
    staleSamples: [],
    partialObjects: 0,
    partialSamples: [],
    viewLimits: [],
    jobQueue: {
      status: "healthy",
      queueDepth: 0,
      runningJobs: 0,
      failedJobs: 0,
      blockedJobs: 0,
      staleLeases: 0,
      oldestPendingAgeHours: null,
      nextRunAt: null,
      latestFailure: null,
      recommendedAction: null,
      byType: []
    },
    manualRefreshRequests: [],
    worker: {
      status: "active",
      phase: "idle",
      workerId: "worker",
      processId: 1,
      host: "localhost",
      heartbeatAt: "2026-07-04T02:00:00.000Z",
      lastTickStartedAt: "2026-07-04T02:00:00.000Z",
      lastTickFinishedAt: "2026-07-04T02:00:00.000Z",
      secondsSinceHeartbeat: 1,
      staleAfterSeconds: 120,
      lastError: null,
      recommendedAction: null,
      details: {}
    },
    ...input
  };
}

function webhooks(input: Partial<DashboardSummary["webhooks"]> = {}): DashboardSummary["webhooks"] {
  return {
    pendingDeliveries: 0,
    processedDeliveries: 0,
    failedDeliveries: 0,
    normalizationFailedDeliveries: 0,
    ignoredDeliveries: 0,
    duplicateDeliveries: 0,
    connectivityProbeDeliveries: 0,
    lastReceivedAt: null,
    lastConnectivityProbeAt: null,
    latestFailure: null,
    eventSummaries: [],
    recentDeliveries: [],
    ...input
  };
}

function webhookWarning(): DashboardSummary["profileWarnings"] {
  return [
    {
      key: "webhook:secret_unconfigured",
      severity: "warning",
      title: "GitHub webhook secret is not configured",
      description: "GitHub webhook delivery ingest is disabled.",
      action: "Set MO_DEVFLOW_GITHUB_WEBHOOK_SECRET."
    }
  ];
}

function sample(input: Partial<CacheObjectEvidenceView> & Pick<CacheObjectEvidenceView, "objectType">) {
  return {
    objectType: input.objectType,
    number: input.number ?? 1,
    title: input.title ?? "sample",
    htmlUrl: input.htmlUrl ?? "https://github.com/example/repo/issues/1",
    ownerLogin: input.ownerLogin ?? "alice",
    state: input.state ?? "open",
    visibilityClass: input.visibilityClass ?? "anonymous_readable",
    sourceAuthType: input.sourceAuthType ?? "anonymous",
    lastSyncedAt: input.lastSyncedAt ?? "2026-07-04T01:00:00.000Z",
    sourceUpdatedAt: input.sourceUpdatedAt ?? "2026-07-04T01:00:00.000Z",
    cacheAgeHours: input.cacheAgeHours ?? 8,
    isComplete: input.isComplete ?? false,
    syncError: input.syncError ?? null,
    reason: input.reason ?? "partial"
  } satisfies CacheObjectEvidenceView;
}

function dashboard(input: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    repo: {
      key: "matrixone",
      owner: "matrixorigin",
      name: "matrixone",
      timezone: "Asia/Shanghai"
    },
    profileConfiguration: {
      localCheckoutConfigured: true,
      writeBackEnabled: true,
      watchedUsersConfigured: true,
      watchedUserCount: 2,
      testersConfigured: true,
      testerCount: 1,
      testingHandoffConfigured: true,
      workflowSkipUsersConfigured: false,
      workflowSkipUserCount: 0,
      notificationEmployeesConfigured: true,
      notificationEmployeeCount: 2,
      webhookSecretConfigured: true,
      githubServiceTokenConfigured: true,
      prDetailBackfillLimit: 25,
      commentBackfillLimit: 25,
      issueTimelineBackfillLimit: 25,
      githubEvidenceBackfillConfigured: true
    },
    profileWarnings: [],
    profileActions: [],
    profileSetup: {
      status: "complete",
      missingCapabilities: [],
      candidateLogins: [],
      yamlPatch: null
    },
    visibility: {
      scope: "anonymous",
      visibleClasses: ["anonymous_readable"],
      hiddenIssues: 0,
      hiddenPullRequests: 0,
      hiddenObjects: 0,
      note: null
    },
    sync: sync({}),
    counts: {
      criticalIssues: 0,
      unownedCriticalIssues: 0,
      nonWatchedCriticalIssues: 0,
      skippedCriticalIssues: 0,
      pendingPrs: 0,
      attentionPrs: 0,
      workflowViolations: 0,
      criticalWorkflowViolations: 0,
      aiDriftSignals: 0,
      criticalAiDriftSignals: 0
    },
    criticalIssues: [],
    criticalOwnerCoverage: [],
    people: [],
    personalViews: [],
    pendingPrs: [],
    workflowViolations: [],
    aiDriftSignals: [],
    writeActions: [],
    analytics: {
      periodDays: 30,
      sourceNote: "test",
      teamDaily: [],
      teamWeekly: [],
      teamMonthly: [],
      peopleDaily: [],
      peopleWeekly: [],
      peopleMonthly: []
    },
    testing: {
      queueIssues: 0,
      queuePrs: 0,
      staleQueueIssues: 0,
      staleQueuePrs: 0,
      averageIssueQueueAgeHours: null,
      averageQueueAgeHours: null,
      issueTransitionEvents: 0,
      lastIssueTransitionAt: null,
      handoffToCloseSamples: 0,
      averageHandoffToCloseHours: null,
      issues: [],
      recentIssueTransitions: [],
      testers: []
    },
    notifications: {
      enabled: false,
      channel: "wecom",
      webhookConfigured: false,
      readiness: {
        status: "disabled",
        blockers: [],
        warnings: [],
        webhookEnvVar: "MO_DEVFLOW_WECOM_WEBHOOK_URL",
        mappedEmployees: 2,
        missingEmployeeMappings: 0,
        fallbackRecipient: "maintainers"
      },
      cooldownHours: 12,
      escalateAfterHours: 24,
      failedDeliveries: 0,
      unacknowledgedDeliveries: 0,
      escalationPendingDeliveries: 0,
      lastDeliveries: []
    },
    webhooks: webhooks(),
    ...input
  } as DashboardSummary;
}

function anonymousSession(input: Partial<SessionView> = {}): SessionView {
  return {
    authenticated: false,
    user: null,
    connectedUsers: [],
    teamSignIn: {
      connectedUsers: 0,
      tokenConnectedUsers: 0,
      activeBrowserSessions: 0,
      lastSeenAt: null
    },
    tokenEncryptionConfigured: true,
    ...input
  };
}

function authenticatedSession(input: Partial<SessionView["user"]> = {}): SessionView {
  return {
    authenticated: true,
    connectedUsers: [],
    teamSignIn: {
      connectedUsers: 1,
      tokenConnectedUsers: 1,
      activeBrowserSessions: 1,
      lastSeenAt: "2026-07-04T01:00:00.000Z"
    },
    tokenEncryptionConfigured: true,
    user: {
      githubLogin: "alice",
      githubId: "1",
      avatarUrl: null,
      tokenScopes: ["repo"],
      tokenRepoPermission: "write",
      tokenLastValidatedAt: "2026-07-04T01:00:00.000Z",
      sessionExpiresAt: "2026-07-05T01:00:00.000Z",
      writeCapabilities: {
        issueLabels: {
          enabled: true,
          status: "ready",
          message: "ready",
          requiredScopes: ["repo", "public_repo"],
          currentScopes: ["repo"],
          requiredRepoPermissions: ["admin", "maintain", "write", "triage"],
          repoPermission: "write"
        }
      },
      ...input
    }
  };
}

describe("freshness summary", () => {
  test("reports a current cache when sync layers and object freshness are healthy", () => {
    expect(summarizeFreshness(sync({}))).toMatchObject({
      severity: "ok",
      label: "cache current",
      tagColor: "green",
      unhealthyLayers: [],
      oldestLayerSuccessAt: "2026-07-04T00:30:00.000Z"
    });
  });

  test("warns when cache objects are stale or partial even if sync layers are green", () => {
    expect(summarizeFreshness(sync({ staleObjects: 2, partialObjects: 1 }))).toMatchObject({
      severity: "warning",
      label: "cache needs attention",
      tagColor: "orange"
    });
  });

  test("warns when dashboard read models hit protection limits", () => {
    expect(
      summarizeFreshness(
        sync({
          viewLimits: [
            {
              key: "pending_prs",
              label: "Pending PR board",
              returned: 300,
              limit: 300,
              message: "Pending PR rows reached the display limit."
            }
          ]
        })
      )
    ).toMatchObject({
      severity: "warning",
      label: "view may be capped",
      tagColor: "orange"
    });
  });

  test("reports critical degradation for failed or blocked sync layers", () => {
    const summary = summarizeFreshness(
      sync({
        health: [
          layer({ layer: "github_sync", status: "success" }),
          layer({ layer: "webhooks", status: "blocked", errorMessage: "permission denied" })
        ]
      })
    );

    expect(summary).toMatchObject({
      severity: "critical",
      label: "sync degraded",
      tagColor: "red"
    });
    expect(summary.unhealthyLayers.map((item) => item.layer)).toEqual(["webhooks"]);
  });
});

describe("update pipeline summary", () => {
  test("reports healthy polling when worker and queue are clear but no webhook delivery was observed", () => {
    const summary = summarizeUpdatePipeline({
      sync: sync({ partialObjects: 0 }),
      webhooks: webhooks()
    });

    expect(summary).toMatchObject({
      tone: "good",
      title: "Updates are flowing from cache"
    });
    expect(summary.detail).toContain("no GitHub webhook delivery");
    expect(summary.tiles.find((tile) => tile.key === "webhooks")).toMatchObject({
      value: "no deliveries",
      tone: "normal"
    });
  });

  test("reports polling-only update path when the webhook secret is missing", () => {
    const summary = summarizeUpdatePipeline({
      sync: sync({ partialObjects: 0 }),
      webhooks: webhooks(),
      profileWarnings: webhookWarning()
    });

    expect(summary).toMatchObject({
      tone: "normal",
      title: "Updates are polling from cache"
    });
    expect(summary.detail).toContain("webhook ingest is not enabled");
    expect(summary.tiles.find((tile) => tile.key === "webhooks")).toMatchObject({
      value: "polling only",
      detail: expect.stringContaining("webhook secret is missing"),
      tone: "normal"
    });
  });

  test("prioritizes operator attention for worker, queue, or webhook failures", () => {
    const summary = summarizeUpdatePipeline({
      sync: sync({
        worker: { ...sync({}).worker, status: "stale" },
        jobQueue: { ...sync({}).jobQueue, status: "attention", failedJobs: 1 }
      }),
      webhooks: webhooks({ failedDeliveries: 2, normalizationFailedDeliveries: 1 })
    });

    expect(summary).toMatchObject({
      tone: "critical",
      title: "Update pipeline needs operator attention"
    });
    expect(summary.tiles.find((tile) => tile.key === "worker")?.tone).toBe("critical");
    expect(summary.tiles.find((tile) => tile.key === "queue")?.tone).toBe("critical");
    expect(summary.tiles.find((tile) => tile.key === "webhooks")).toMatchObject({
      value: "3 failed",
      tone: "critical"
    });
  });

  test("reports flowing updates with evidence gaps for stale or partial cache", () => {
    const summary = summarizeUpdatePipeline({
      sync: sync({ staleObjects: 4, partialObjects: 453, oldestCacheAgeHours: 12.2 }),
      webhooks: webhooks({ lastReceivedAt: "2026-07-04T01:00:00.000Z", processedDeliveries: 10 })
    });

    expect(summary).toMatchObject({
      tone: "attention",
      title: "Updates are flowing with evidence gaps"
    });
    expect(summary.tiles.find((tile) => tile.key === "cache")).toMatchObject({
      value: "4 stale",
      tone: "critical"
    });
    expect(summary.tiles.find((tile) => tile.key === "webhooks")).toMatchObject({
      value: "receiving",
      tone: "good"
    });
  });
});

describe("webhook readiness summary", () => {
  test("reports polling-only mode when the webhook secret is missing", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: webhookWarning(),
      webhooks: webhooks()
    });

    expect(summary).toMatchObject({
      tone: "attention",
      mode: "polling_only",
      title: "Webhook ingest is not enabled"
    });
    expect(summary.description).toContain("polling");
    expect(summary.facts).toContain("endpoint /api/webhooks/github");
  });

  test("reports waiting state when the secret is configured but no delivery has arrived", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks()
    });

    expect(summary).toMatchObject({
      tone: "attention",
      mode: "waiting_for_delivery",
      title: "Waiting for the first GitHub delivery"
    });
    expect(summary.nextActions.join(" ")).toContain("GitHub webhook URL");
  });

  test("reports connected state when GitHub ping is received before workflow events", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks({
        ignoredDeliveries: 1,
        connectivityProbeDeliveries: 1,
        lastReceivedAt: "2026-07-04T01:00:00.000Z",
        lastConnectivityProbeAt: "2026-07-04T01:00:00.000Z"
      })
    });

    expect(summary).toMatchObject({
      tone: "good",
      mode: "connected_waiting_for_activity",
      title: "Webhook endpoint is connected"
    });
    expect(summary.facts).toContain("1 ping probe");
    expect(summary.nextActions.join(" ")).toContain("supported workflow event");
  });

  test("does not treat unsupported ignored deliveries as processed webhook freshness", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks({
        ignoredDeliveries: 1,
        lastReceivedAt: "2026-07-04T01:00:00.000Z"
      })
    });

    expect(summary).toMatchObject({
      tone: "attention",
      mode: "waiting_for_delivery",
      title: "Webhook deliveries are visible but no workflow event has processed"
    });
    expect(summary.facts).toContain("0 processed workflow deliveries");
  });

  test("prioritizes failed deliveries over setup state", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks({ failedDeliveries: 1, normalizationFailedDeliveries: 2, latestFailure: "bad payload" })
    });

    expect(summary).toMatchObject({
      tone: "critical",
      mode: "failed",
      title: "Webhook deliveries need attention"
    });
    expect(summary.facts).toContain("3 failed");
    expect(summary.facts).toContain("latest: bad payload");
  });

  test("reports queued deliveries before healthy receiving state", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks({
        pendingDeliveries: 2,
        processedDeliveries: 4,
        lastReceivedAt: "2026-07-04T01:00:00.000Z"
      })
    });

    expect(summary).toMatchObject({
      tone: "attention",
      mode: "queued",
      title: "Webhook deliveries are queued"
    });
    expect(summary.facts).toContain("2 pending");
  });

  test("reports healthy receiving when deliveries are processed without failures", () => {
    const summary = summarizeWebhookReadiness({
      profileWarnings: [],
      webhooks: webhooks({
        processedDeliveries: 9,
        lastReceivedAt: "2026-07-04T01:00:00.000Z"
      })
    });

    expect(summary).toMatchObject({
      tone: "good",
      mode: "receiving",
      title: "Webhook ingest is receiving workflow events"
    });
    expect(summary.facts).toContain("9 processed");
  });
});

describe("cache evidence summary", () => {
  test("reports clear evidence when sync, cache, and visibility are clean", () => {
    expect(
      summarizeCacheEvidence({
        sync: sync({}),
        visibility: {
          scope: "anonymous",
          visibleClasses: ["anonymous_readable"],
          hiddenIssues: 0,
          hiddenPullRequests: 0,
          hiddenObjects: 0,
          note: null
        }
      })
    ).toMatchObject({
      severity: "ok",
      alertType: "success",
      title: "Evidence quality is clear",
      affectedConclusions: []
    });
  });

  test("treats stale active cache as the highest-priority evidence warning", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({ staleObjects: 3, oldestCacheAgeHours: 9.5, staleThresholdHours: 6, partialObjects: 40 }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 0,
        hiddenPullRequests: 0,
        hiddenObjects: 0,
        note: null
      }
    });

    expect(summary).toMatchObject({
      severity: "warning",
      alertType: "warning",
      title: "Some active cache evidence is stale"
    });
    expect(summary.description).toContain("3 active visible GitHub objects");
    expect(summary.description).toContain("9.5h");
    expect(summary.affectedConclusions).toContain("current s-1/s0 ownership and blockers");
    expect(summary.facts).toContain("40 cached objects are partial");
  });

  test("explains partial cache as incomplete evidence instead of system failure", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({ partialObjects: 350 }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 0,
        hiddenPullRequests: 0,
        hiddenObjects: 0,
        note: null
      }
    });

    expect(summary).toMatchObject({
      severity: "warning",
      alertType: "warning",
      title: "Some workflow evidence is partial"
    });
    expect(summary.description).toContain("Known cached facts remain visible");
    expect(summary.description).toContain("not confirmed conclusions");
    expect(summary.affectedConclusions).toContain("deferred explanation checks");
    expect(summary.affectedConclusions).toContain("review, CI, mergeability, and issue testing rules");
  });

  test("explains skipped successful backfill layers when evidence remains partial", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({
        partialObjects: 12,
        health: [
          layer({
            layer: "issue_timeline_backfill",
            skipped: true,
            skipReason: "MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS is 0"
          })
        ]
      }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 0,
        hiddenPullRequests: 0,
        hiddenObjects: 0,
        note: null
      }
    });

    expect(summary.facts).toContain(
      "Skipped sync layers: issue_timeline_backfill (MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_MAX_ITEMS is 0)"
    );
    expect(summary.recommendedAction).toContain("Enable the skipped backfill layers");
  });

  test("surfaces capped dashboard read models before visibility-only notes", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({
        viewLimits: [
          {
            key: "issue_scan",
            label: "Issue read model",
            returned: 5000,
            limit: 5000,
            message: "Visible issue rows reached the dashboard protection limit."
          }
        ]
      }),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 2,
        hiddenPullRequests: 0,
        hiddenObjects: 2,
        note: "2 cached GitHub objects are hidden from this view."
      }
    });

    expect(summary).toMatchObject({
      severity: "warning",
      alertType: "warning",
      title: "Some dashboard views may be capped"
    });
    expect(summary.facts).toContain("Dashboard read limits reached: Issue read model");
    expect(summary.facts).toContain("2 cached GitHub objects are hidden");
    expect(summary.affectedConclusions).toContain("personal workload comparison");
  });

  test("surfaces visibility filtering as access-scope evidence", () => {
    const summary = summarizeCacheEvidence({
      sync: sync({}),
      visibility: {
        scope: "anonymous",
        visibleClasses: ["anonymous_readable"],
        hiddenIssues: 2,
        hiddenPullRequests: 1,
        hiddenObjects: 3,
        note: "3 cached GitHub objects are hidden from this view."
      }
    });

    expect(summary).toMatchObject({
      severity: "info",
      alertType: "info",
      title: "This view is filtered by access policy"
    });
    expect(summary.description).toContain("anonymous");
    expect(summary.facts).toContain("3 cached GitHub objects are hidden");
  });
});

describe("production readiness summary", () => {
  test("shows anonymous mode as waiting for live token and webhook evidence", () => {
    const summary = summarizeProductionReadiness({
      data: dashboard(),
      session: anonymousSession()
    });

    expect(summary).toMatchObject({
      tone: "attention",
      label: "waiting for evidence"
    });
    expect(summary.gates.find((gate) => gate.key === "token")).toMatchObject({
      status: "waiting",
      value: "observer",
      target: "connect_token"
    });
    expect(summary.gates.find((gate) => gate.key === "service_token")).toMatchObject({
      label: "Service read token",
      status: "ready",
      value: "configured",
      target: "health"
    });
    expect(summary.gates.find((gate) => gate.key === "webhook")).toMatchObject({
      status: "waiting",
      value: "waiting for delivery",
      target: "webhooks"
    });
    expect(summary.gates.find((gate) => gate.key === "write_back")).toMatchObject({
      status: "waiting",
      value: "personal token needed"
    });
  });

  test("blocks production readiness when GitHub evidence backfill is not configured", () => {
    const base = dashboard();
    const summary = summarizeProductionReadiness({
      data: dashboard({
        profileConfiguration: {
          ...base.profileConfiguration,
          githubServiceTokenConfigured: false,
          prDetailBackfillLimit: 0,
          commentBackfillLimit: 0,
          issueTimelineBackfillLimit: 0,
          githubEvidenceBackfillConfigured: false
        }
      }),
      session: anonymousSession()
    });

    expect(summary).toMatchObject({
      tone: "critical",
      label: "action required"
    });
    expect(summary.gates.find((gate) => gate.key === "github_evidence")).toMatchObject({
      status: "needs_action",
      tone: "critical",
      value: "anonymous only",
      target: "health"
    });
    expect(summary.gates.find((gate) => gate.key === "service_token")).toMatchObject({
      status: "needs_action",
      tone: "critical",
      value: "anonymous"
    });
    expect(summary.blockers.map((gate) => gate.key)).toEqual(
      expect.arrayContaining(["service_token", "github_evidence"])
    );
    expect(summary.gates.find((gate) => gate.key === "github_evidence")?.detail).toContain("PR review");
  });

  test("prioritizes failed GitHub evidence sync layers", () => {
    const summary = summarizeProductionReadiness({
      data: dashboard({
        sync: sync({
          health: [
            layer({ layer: "github_sync" }),
            layer({ layer: "pr_backfill", status: "failed", errorMessage: "rate limit" }),
            layer({ layer: "comment_backfill" }),
            layer({ layer: "issue_timeline_backfill" })
          ]
        })
      }),
      session: authenticatedSession()
    });

    expect(summary.gates.find((gate) => gate.key === "github_evidence")).toMatchObject({
      status: "needs_action",
      tone: "critical",
      value: "1 failed"
    });
    expect(summary.blockers.map((gate) => gate.key)).toContain("github_evidence");
  });

  test("prioritizes blocking production gaps from stale cache, failed webhook, and notification setup", () => {
    const summary = summarizeProductionReadiness({
      data: dashboard({
        sync: sync({ staleObjects: 4 }),
        webhooks: webhooks({ failedDeliveries: 2, latestFailure: "signature mismatch" }),
        notifications: {
          ...dashboard().notifications,
          readiness: {
            ...dashboard().notifications.readiness,
            status: "action_required",
            blockers: ["WeCom webhook URL is missing"]
          }
        }
      }),
      session: anonymousSession({ tokenEncryptionConfigured: false })
    });

    expect(summary).toMatchObject({
      tone: "critical",
      label: "action required"
    });
    expect(summary.blockers.map((gate) => gate.key)).toEqual(
      expect.arrayContaining(["cache", "webhook", "token", "notifications"])
    );
    expect(summary.nextActions.join(" ")).toContain("Cache evidence");
  });

  test("marks token and workflow fixes ready when a validated write-capable token is connected", () => {
    const summary = summarizeProductionReadiness({
      data: dashboard({
        webhooks: webhooks({ processedDeliveries: 3, lastReceivedAt: "2026-07-04T02:00:00.000Z" }),
        notifications: {
          ...dashboard().notifications,
          enabled: true,
          webhookConfigured: true,
          readiness: {
            ...dashboard().notifications.readiness,
            status: "ready"
          }
        },
        writeActions: [
          {
            id: 1,
            previewId: "preview",
            githubLogin: "alice",
            actionKey: "add_needs_triage",
            objectType: "issue",
            objectNumber: 42,
            title: "issue",
            htmlUrl: "https://github.com/example/repo/issues/42",
            status: "success",
            executedOperations: [],
            errorMessage: null,
            startedAt: "2026-07-04T02:00:00.000Z",
            finishedAt: "2026-07-04T02:00:00.000Z"
          }
        ]
      }),
      session: authenticatedSession()
    });

    expect(summary).toMatchObject({
      tone: "good",
      label: "ready"
    });
    expect(summary.gates.find((gate) => gate.key === "token")).toMatchObject({ status: "ready" });
    expect(summary.gates.find((gate) => gate.key === "write_back")).toMatchObject({ status: "ready" });
    expect(summary.gates.find((gate) => gate.key === "audit")).toMatchObject({ status: "ready", value: "1 records" });
  });
});

describe("cache repair recommendation", () => {
  test("selects PR backfill and derived layers for stale partial PR evidence", () => {
    const recommendation = recommendCacheRepair(
      sync({
        staleObjects: 2,
        staleSamples: [sample({ objectType: "pull_request", reason: "stale_and_partial" })],
        partialObjects: 2,
        partialSamples: [sample({ objectType: "pull_request", reason: "stale_and_partial" })]
      })
    );

    expect(recommendation.layers).toEqual(["github_sync", "pr_backfill", "rules", "metrics", "ai_drift"]);
    expect(recommendation.reasons.join(" ")).toContain("sampled PRs");
  });

  test("selects issue timeline and comment backfill for partial issue evidence", () => {
    const recommendation = recommendCacheRepair(
      sync({
        partialObjects: 5,
        partialSamples: [sample({ objectType: "issue" })]
      })
    );

    expect(recommendation.layers).toEqual([
      "issue_timeline_backfill",
      "comment_backfill",
      "rules",
      "metrics",
      "ai_drift"
    ]);
    expect(recommendation.reasons.join(" ")).toContain("sampled issues");
  });

  test("falls back to broad evidence repair when partial objects have no samples", () => {
    const recommendation = recommendCacheRepair(sync({ partialObjects: 5 }));

    expect(recommendation).toMatchObject({
      layers: ["pr_backfill", "issue_timeline_backfill", "comment_backfill", "rules", "metrics", "ai_drift"]
    });
  });

  test("includes unhealthy layers in standard sync order", () => {
    expect(
      recommendCacheRepair(
        sync({
          health: [layer({ layer: "webhooks", status: "blocked" })],
          partialObjects: 1,
          partialSamples: [sample({ objectType: "issue" })]
        })
      ).layers
    ).toEqual(["issue_timeline_backfill", "comment_backfill", "webhooks", "rules", "metrics", "ai_drift"]);
  });
});
