import { describe, expect, test } from "vitest";
import { jobKeyForLayer, workflowWriteRefreshJobs } from "./refreshJobs";

describe("refresh job helpers", () => {
  test("uses stable job keys for configured refresh layers", () => {
    expect(jobKeyForLayer("github_sync", "matrixorigin/matrixone")).toBe("github-sync:matrixorigin/matrixone");
    expect(jobKeyForLayer("pr_backfill", "matrixorigin/matrixone")).toBe("pr-backfill:matrixorigin/matrixone");
    expect(jobKeyForLayer("issue_timeline_backfill", "matrixorigin/matrixone")).toBe(
      "issue-timeline-backfill:matrixorigin/matrixone"
    );
    expect(jobKeyForLayer("comment_backfill", "matrixorigin/matrixone")).toBe(
      "comment-backfill:matrixorigin/matrixone"
    );
    expect(jobKeyForLayer("metrics", "matrixorigin/matrixone")).toBe("metrics:matrixorigin/matrixone");
    expect(jobKeyForLayer("ai_drift", "matrixorigin/matrixone")).toBe("ai-drift:matrixorigin/matrixone");
    expect(jobKeyForLayer("rules", "matrixorigin/matrixone")).toBe("rules:matrixorigin/matrixone");
    expect(jobKeyForLayer("notifications", "matrixorigin/matrixone")).toBe("notifications:matrixorigin/matrixone");
  });

  test("queues cache, evidence, metric, drift, and notification refresh after a successful workflow write", () => {
    const jobs = workflowWriteRefreshJobs({
      repoKey: "matrixorigin/matrixone",
      githubLogin: "alice",
      previewId: "preview-1",
      actionKey: "add_needs_triage",
      objectType: "issue",
      objectNumber: 42,
      requestedAt: "2026-07-04T00:00:00.000Z"
    });

    expect(jobs.map((job) => job.jobType)).toEqual([
      "github_sync",
      "issue_timeline_backfill",
      "comment_backfill",
      "rules",
      "metrics",
      "ai_drift",
      "notifications"
    ]);
    expect(jobs.map((job) => job.jobKey)).toEqual([
      "github-sync:matrixorigin/matrixone",
      "issue-timeline-backfill:matrixorigin/matrixone",
      "comment-backfill:matrixorigin/matrixone",
      "rules:matrixorigin/matrixone",
      "metrics:matrixorigin/matrixone",
      "ai-drift:matrixorigin/matrixone",
      "notifications:matrixorigin/matrixone"
    ]);
    expect(jobs[0].payload).toMatchObject({
      trigger: "workflow_fix_execution",
      requestedBy: "alice",
      previewId: "preview-1",
      objectType: "issue",
      objectNumber: 42
    });
  });
});
