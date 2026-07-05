import { describe, expect, test } from "vitest";
import {
  jobQueueHealthStatus,
  jobQueueOldestPendingWarnHoursFromEnv,
  jobQueueRecommendedAction,
  jobQueueTypeHealthFromRows,
  manualRefreshRequestStatusFromJobs,
  manualRefreshRequestViewFromRow
} from "./jobs";

const healthyQueue = {
  blockedJobs: 0,
  failedJobs: 0,
  staleLeases: 0,
  oldestPendingAgeHours: null,
  latestFailure: null
};

describe("job queue health", () => {
  test("keeps an empty or fresh queue healthy", () => {
    expect(jobQueueHealthStatus(healthyQueue)).toBe("healthy");
    expect(jobQueueRecommendedAction(healthyQueue)).toBeNull();
  });

  test("marks blocked jobs as requiring operator attention", () => {
    const health = {
      ...healthyQueue,
      blockedJobs: 2,
      latestFailure: "github_sync: Resource not accessible by integration"
    };

    expect(jobQueueHealthStatus(health)).toBe("attention");
    expect(jobQueueRecommendedAction(health)).toContain("blocked jobs need credentials");
    expect(jobQueueRecommendedAction(health)).toContain("github_sync");
  });

  test("marks stale leases and old due jobs as requiring attention", () => {
    expect(jobQueueHealthStatus({ ...healthyQueue, staleLeases: 1 })).toBe("attention");
    expect(jobQueueHealthStatus({ ...healthyQueue, oldestPendingAgeHours: 0.3 }, 0.25)).toBe("attention");
    expect(jobQueueHealthStatus({ ...healthyQueue, oldestPendingAgeHours: 0.2 }, 0.25)).toBe("healthy");
  });

  test("uses a conservative oldest-pending threshold from environment", () => {
    expect(jobQueueOldestPendingWarnHoursFromEnv({})).toBe(0.25);
    expect(jobQueueOldestPendingWarnHoursFromEnv({ MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS: "0.01" })).toBe(0.05);
    expect(jobQueueOldestPendingWarnHoursFromEnv({ MO_DEVFLOW_JOB_QUEUE_PENDING_WARN_HOURS: "1.5" })).toBe(1.5);
  });

  test("builds job type breakdown with independent attention actions", () => {
    const rows = [
      {
        job_type: "pr_backfill",
        queue_depth: 3,
        running_jobs: 1,
        failed_jobs: 2,
        blocked_jobs: 0,
        stale_leases: 0,
        oldest_pending_at: null,
        next_run_at: "2026-07-05 13:00:00"
      },
      {
        job_type: "notifications",
        queue_depth: 0,
        running_jobs: 0,
        failed_jobs: 0,
        blocked_jobs: 0,
        stale_leases: 0,
        oldest_pending_at: null,
        next_run_at: null
      }
    ];

    const breakdown = jobQueueTypeHealthFromRows(
      rows as Parameters<typeof jobQueueTypeHealthFromRows>[0],
      new Map([["pr_backfill", "pr_backfill: rate limit exceeded"]])
    );

    expect(breakdown[0]).toMatchObject({
      jobType: "pr_backfill",
      queueDepth: 3,
      runningJobs: 1,
      failedJobs: 2,
      latestFailure: "pr_backfill: rate limit exceeded",
      status: "attention"
    });
    expect(breakdown[0]?.recommendedAction).toContain("failed jobs are waiting for retry");
    expect(breakdown[1]).toMatchObject({
      jobType: "notifications",
      queueDepth: 0,
      status: "healthy",
      recommendedAction: null
    });
  });
});

describe("manual refresh request views", () => {
  test("derives request status from current queued job states", () => {
    expect(
      manualRefreshRequestStatusFromJobs("queued", [
        { jobKey: "rules", jobType: "rules", status: "complete", nextRunAt: null },
        { jobKey: "metrics", jobType: "metrics", status: "complete", nextRunAt: null }
      ])
    ).toBe("complete");
    expect(
      manualRefreshRequestStatusFromJobs("queued", [
        { jobKey: "rules", jobType: "rules", status: "running", nextRunAt: null },
        { jobKey: "metrics", jobType: "metrics", status: "complete", nextRunAt: null }
      ])
    ).toBe("running");
    expect(
      manualRefreshRequestStatusFromJobs("queued", [
        { jobKey: "rules", jobType: "rules", status: "failed", nextRunAt: null },
        { jobKey: "metrics", jobType: "metrics", status: "pending", nextRunAt: null }
      ])
    ).toBe("failed");
    expect(
      manualRefreshRequestStatusFromJobs("queued", [
        { jobKey: "rules", jobType: "rules", status: "blocked", nextRunAt: null },
        { jobKey: "metrics", jobType: "metrics", status: "failed", nextRunAt: null }
      ])
    ).toBe("blocked");
  });

  test("maps persisted refresh request rows into dashboard history", () => {
    const view = manualRefreshRequestViewFromRow({
      id: 42,
      github_login: "alice",
      requested_layers_json: JSON.stringify(["github_sync", "rules", "not_a_layer"]),
      queued_jobs_json: JSON.stringify([
        {
          jobKey: "matrixone:github_sync",
          jobType: "github_sync",
          status: "pending",
          nextRunAt: "2026-07-05T06:00:00.000Z"
        },
        {
          jobKey: "matrixone:bad",
          jobType: "bad",
          status: "pending",
          nextRunAt: null
        }
      ]),
      status: "queued",
      created_at: "2026-07-05 06:00:00"
    } as Parameters<typeof manualRefreshRequestViewFromRow>[0]);

    expect(view).toMatchObject({
      requestId: 42,
      githubLogin: "alice",
      requestedLayers: ["github_sync", "rules"],
      queuedJobs: [
        {
          jobKey: "matrixone:github_sync",
          jobType: "github_sync",
          status: "pending",
          nextRunAt: "2026-07-05T06:00:00.000Z"
        }
      ],
      status: "queued"
    });
    expect(view.requestedAt).toBe("2026-07-05T06:00:00Z");
  });

  test("overlays current job status when rendering dashboard history", () => {
    const view = manualRefreshRequestViewFromRow(
      {
        id: 42,
        github_login: "alice",
        requested_layers_json: JSON.stringify(["github_sync", "rules"]),
        queued_jobs_json: JSON.stringify([
          {
            jobKey: "matrixone:github_sync",
            jobType: "github_sync",
            status: "pending",
            nextRunAt: "2026-07-05T06:00:00.000Z"
          },
          {
            jobKey: "matrixone:rules",
            jobType: "rules",
            status: "pending",
            nextRunAt: null
          }
        ]),
        status: "queued",
        created_at: "2026-07-05 06:00:00"
      } as Parameters<typeof manualRefreshRequestViewFromRow>[0],
      new Map([
        ["matrixone:github_sync", { status: "complete", nextRunAt: "2026-07-05T06:30:00.000Z" }],
        ["matrixone:rules", { status: "running", nextRunAt: null }]
      ])
    );

    expect(view.status).toBe("running");
    expect(view.queuedJobs).toEqual([
      {
        jobKey: "matrixone:github_sync",
        jobType: "github_sync",
        status: "complete",
        nextRunAt: "2026-07-05T06:30:00.000Z"
      },
      {
        jobKey: "matrixone:rules",
        jobType: "rules",
        status: "running",
        nextRunAt: null
      }
    ]);
  });

  test("keeps malformed persisted JSON from breaking the health dashboard", () => {
    const view = manualRefreshRequestViewFromRow({
      id: 43,
      github_login: "alice",
      requested_layers_json: "{",
      queued_jobs_json: "{",
      status: "queued",
      created_at: null
    } as Parameters<typeof manualRefreshRequestViewFromRow>[0]);

    expect(view.requestedLayers).toEqual([]);
    expect(view.queuedJobs).toEqual([]);
    expect(view.requestedAt).toBe("1970-01-01T00:00:00.000Z");
  });
});
