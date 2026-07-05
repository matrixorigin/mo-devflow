import { hostname } from "node:os";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  blockLeasedJob,
  claimNextDueJob,
  completeLeasedJob,
  ensureRecurringJobs,
  failLeasedJob,
  type LeasedJob,
  type RecurringJobSeed
} from "@mo-devflow/db";
import { classifyGitHubError } from "@mo-devflow/github";
import {
  backfillIssueCommentsOnce,
  backfillIssueTimelineOnce,
  backfillPullRequestDetailsOnce,
  dateAfterSeconds,
  recomputeAiDriftFromCache,
  recomputeMetricsFromCache,
  recomputeWorkflowViolationsFromCache,
  processGitHubWebhookDeliveriesOnce,
  sendNotificationsOnce,
  syncGitHubSnapshotOnce,
  syncIntervalSecondsFromEnv
} from "./sync";

type ScheduledJobType =
  | "github_sync"
  | "pr_backfill"
  | "issue_timeline_backfill"
  | "comment_backfill"
  | "webhooks"
  | "rules"
  | "metrics"
  | "ai_drift"
  | "notifications";

interface ScheduledJobDefinition {
  jobKey: string;
  jobType: ScheduledJobType;
  intervalSeconds: number;
}

export interface WorkerJobRun {
  jobKey: string;
  jobType: string;
  status: "success" | "failed";
  message: string;
}

export interface WorkerJobRunSummary {
  seededJobs: number;
  claimedJobs: number;
  completedJobs: number;
  failedJobs: number;
  runs: WorkerJobRun[];
}

export function intervalSecondsFromEnv(envName: string, fallback: number, min = 60): number {
  const parsed = Number(process.env[envName] ?? String(fallback));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.floor(parsed));
}

export function retryDelaySeconds(attempts: number): number {
  const base = intervalSecondsFromEnv("MO_DEVFLOW_JOB_RETRY_BASE_SECONDS", 60, 10);
  const max = intervalSecondsFromEnv("MO_DEVFLOW_JOB_RETRY_MAX_SECONDS", 1800, base);
  return Math.min(max, base * 2 ** Math.max(0, Math.min(attempts - 1, 6)));
}

function rateLimitRetryFallbackSecondsFromEnv(): number {
  return intervalSecondsFromEnv("MO_DEVFLOW_GITHUB_RATE_LIMIT_RETRY_SECONDS", 3600, 60);
}

function blockedRetrySecondsFromEnv(): number {
  return intervalSecondsFromEnv("MO_DEVFLOW_GITHUB_BLOCKED_RECHECK_SECONDS", 3600, 300);
}

export function retryDelaySecondsForJobError(error: unknown, attempts: number): number | null {
  const classified = classifyGitHubError(error);
  if (classified.kind === "permission" || classified.kind === "not_found") {
    return null;
  }
  if (classified.kind === "rate_limited") {
    return Math.max(
      retryDelaySeconds(attempts),
      classified.retryAfterSeconds ?? rateLimitRetryFallbackSecondsFromEnv()
    );
  }
  return retryDelaySeconds(attempts);
}

function jobErrorMessage(error: unknown): string {
  const classified = classifyGitHubError(error);
  if (classified.kind === "unknown" || classified.kind === "network") {
    return error instanceof Error ? error.message : String(error);
  }
  const parts = [`github_${classified.kind}`];
  if (classified.status !== null) {
    parts.push(`status=${classified.status}`);
  }
  if (classified.rateLimitRemaining !== null) {
    parts.push(`rate_remaining=${classified.rateLimitRemaining}`);
  }
  if (classified.rateLimitResetAt) {
    parts.push(`rate_reset=${classified.rateLimitResetAt}`);
  }
  parts.push(classified.message);
  return parts.join(" ");
}

function maxJobsPerTickFromEnv(): number {
  const parsed = Number(process.env.MO_DEVFLOW_WORKER_MAX_JOBS_PER_TICK ?? "3");
  if (!Number.isFinite(parsed)) {
    return 3;
  }
  return Math.max(1, Math.floor(parsed));
}

function leaseSecondsFromEnv(): number {
  return intervalSecondsFromEnv("MO_DEVFLOW_JOB_LEASE_SECONDS", 600, 60);
}

export function workerIdFromEnv(): string {
  return process.env.MO_DEVFLOW_WORKER_ID ?? `${hostname()}-${process.pid}`;
}

function scheduledJobDefinitions(): ScheduledJobDefinition[] {
  const profile = loadRepoProfile();
  const repoKey = profile.key;
  return [
    {
      jobKey: `github-sync:${repoKey}`,
      jobType: "github_sync",
      intervalSeconds: syncIntervalSecondsFromEnv()
    },
    {
      jobKey: `pr-backfill:${repoKey}`,
      jobType: "pr_backfill",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_PR_BACKFILL_INTERVAL_SECONDS", 1800)
    },
    {
      jobKey: `comment-backfill:${repoKey}`,
      jobType: "comment_backfill",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_COMMENT_BACKFILL_INTERVAL_SECONDS", 1800)
    },
    {
      jobKey: `issue-timeline-backfill:${repoKey}`,
      jobType: "issue_timeline_backfill",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_ISSUE_TIMELINE_BACKFILL_INTERVAL_SECONDS", 1800)
    },
    {
      jobKey: `webhooks:${repoKey}`,
      jobType: "webhooks",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_WEBHOOK_PROCESS_INTERVAL_SECONDS", 60, 10)
    },
    {
      jobKey: `rules:${repoKey}`,
      jobType: "rules",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_RULES_INTERVAL_SECONDS", 300)
    },
    {
      jobKey: `metrics:${repoKey}`,
      jobType: "metrics",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_METRICS_INTERVAL_SECONDS", 1800)
    },
    {
      jobKey: `ai-drift:${repoKey}`,
      jobType: "ai_drift",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_AI_DRIFT_INTERVAL_SECONDS", 1800)
    },
    {
      jobKey: `notifications:${repoKey}`,
      jobType: "notifications",
      intervalSeconds: intervalSecondsFromEnv("MO_DEVFLOW_NOTIFICATION_INTERVAL_SECONDS", 300)
    }
  ];
}

async function seedRecurringJobs(definitions: ScheduledJobDefinition[]): Promise<void> {
  const seeds: RecurringJobSeed[] = definitions.map((definition) => ({
    jobKey: definition.jobKey,
    jobType: definition.jobType,
    payload: {
      intervalSeconds: definition.intervalSeconds
    }
  }));
  await ensureRecurringJobs(seeds);
}

function definitionForJob(definitions: ScheduledJobDefinition[], job: LeasedJob): ScheduledJobDefinition {
  const definition = definitions.find((item) => item.jobKey === job.jobKey);
  if (!definition) {
    throw new Error(`No scheduled job definition exists for ${job.jobKey}.`);
  }
  return definition;
}

async function executeJob(job: LeasedJob): Promise<string> {
  switch (job.jobType as ScheduledJobType) {
    case "github_sync": {
      const result = await syncGitHubSnapshotOnce();
      return `synced issues=${result.issues} prs=${result.pullRequests} rate=${result.rateLimitRemaining ?? "unknown"}`;
    }
    case "pr_backfill": {
      const result = await backfillPullRequestDetailsOnce();
      return `pr backfill selected=${result.selected} refreshed=${result.refreshed} failed=${result.failed} skipped=${result.skipped}`;
    }
    case "comment_backfill": {
      const result = await backfillIssueCommentsOnce();
      return `comment backfill selected=${result.selected} refreshed=${result.refreshed} partial=${result.partial} failed=${result.failed} skipped=${result.skipped}`;
    }
    case "issue_timeline_backfill": {
      const result = await backfillIssueTimelineOnce();
      return `issue timeline backfill selected=${result.selected} refreshed=${result.refreshed} partial=${result.partial} failed=${result.failed} skipped=${result.skipped}`;
    }
    case "webhooks": {
      const result = await processGitHubWebhookDeliveriesOnce();
      return `webhook deliveries claimed=${result.claimed} processed=${result.processed} failed=${result.failed} skipped=${result.skipped} leaseLost=${result.leaseLost}`;
    }
    case "rules": {
      const result = await recomputeWorkflowViolationsFromCache();
      return `workflow violations=${result.workflowViolations}`;
    }
    case "metrics": {
      const result = await recomputeMetricsFromCache();
      return `daily metrics=${result.dailyMetrics}`;
    }
    case "ai_drift": {
      const result = await recomputeAiDriftFromCache();
      return `ai drift signals=${result.aiDriftSignals}`;
    }
    case "notifications": {
      const result = await sendNotificationsOnce();
      return `notifications candidates=${result.candidates} sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`;
    }
    default:
      throw new Error(`Unsupported scheduled job type: ${job.jobType}`);
  }
}

export async function runDueJobsOnce(): Promise<WorkerJobRunSummary> {
  const definitions = scheduledJobDefinitions();
  await seedRecurringJobs(definitions);

  const summary: WorkerJobRunSummary = {
    seededJobs: definitions.length,
    claimedJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    runs: []
  };
  const maxJobs = maxJobsPerTickFromEnv();

  for (let index = 0; index < maxJobs; index += 1) {
    const leaseOwner = `${workerIdFromEnv()}-${Date.now()}-${index}`;
    const job = await claimNextDueJob({
      leaseOwner,
      leaseSeconds: leaseSecondsFromEnv()
    });
    if (!job) {
      break;
    }

    summary.claimedJobs += 1;
    const definition = definitionForJob(definitions, job);
    try {
      const message = await executeJob(job);
      await completeLeasedJob({
        jobId: job.id,
        leaseOwner,
        nextRunAt: dateAfterSeconds(definition.intervalSeconds),
        payload: {
          intervalSeconds: definition.intervalSeconds,
          lastResult: message
        }
      });
      summary.completedJobs += 1;
      summary.runs.push({
        jobKey: job.jobKey,
        jobType: job.jobType,
        status: "success",
        message
      });
    } catch (error) {
      const errorMessage = jobErrorMessage(error);
      const retryDelaySecondsForError = retryDelaySecondsForJobError(error, job.attempts);
      if (retryDelaySecondsForError === null) {
        await blockLeasedJob({
          jobId: job.id,
          leaseOwner,
          nextRunAt: dateAfterSeconds(blockedRetrySecondsFromEnv()),
          errorMessage
        });
      } else {
        await failLeasedJob({
          jobId: job.id,
          leaseOwner,
          nextRunAt: dateAfterSeconds(retryDelaySecondsForError),
          errorMessage
        });
      }
      summary.failedJobs += 1;
      summary.runs.push({
        jobKey: job.jobKey,
        jobType: job.jobType,
        status: "failed",
        message: errorMessage
      });
    }
  }

  return summary;
}
