import { hostname } from "node:os";
import { loadRepoProfile } from "@mo-devflow/config";
import {
  claimNextDueJob,
  completeLeasedJob,
  ensureRecurringJobs,
  failLeasedJob,
  type LeasedJob,
  type RecurringJobSeed
} from "@mo-devflow/db";
import {
  dateAfterSeconds,
  recomputeAiDriftFromCache,
  recomputeMetricsFromCache,
  recomputeWorkflowViolationsFromCache,
  processGitHubWebhookDeliveriesOnce,
  sendNotificationsOnce,
  syncGitHubSnapshotOnce,
  syncIntervalSecondsFromEnv
} from "./sync";

type ScheduledJobType = "github_sync" | "webhooks" | "rules" | "metrics" | "ai_drift" | "notifications";

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
    case "webhooks": {
      const result = await processGitHubWebhookDeliveriesOnce();
      return `webhook deliveries claimed=${result.claimed} processed=${result.processed} failed=${result.failed} skipped=${result.skipped}`;
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      await failLeasedJob({
        jobId: job.id,
        leaseOwner,
        nextRunAt: dateAfterSeconds(retryDelaySeconds(job.attempts)),
        errorMessage
      });
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
