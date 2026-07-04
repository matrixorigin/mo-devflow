import type { RecurringJobSeed } from "@mo-devflow/db";
import type { ManualRefreshLayer, WorkflowFixPreview } from "@mo-devflow/shared";

export const manualRefreshLayers = [
  "github_sync",
  "pr_backfill",
  "issue_timeline_backfill",
  "comment_backfill",
  "webhooks",
  "rules",
  "metrics",
  "ai_drift",
  "notifications"
] as const satisfies readonly ManualRefreshLayer[];

export type RefreshJobSeed = RecurringJobSeed & { jobType: ManualRefreshLayer };

export function jobKeyForLayer(layer: ManualRefreshLayer, repoKey: string): string {
  switch (layer) {
    case "github_sync":
      return `github-sync:${repoKey}`;
    case "pr_backfill":
      return `pr-backfill:${repoKey}`;
    case "issue_timeline_backfill":
      return `issue-timeline-backfill:${repoKey}`;
    case "comment_backfill":
      return `comment-backfill:${repoKey}`;
    case "webhooks":
      return `webhooks:${repoKey}`;
    case "rules":
      return `rules:${repoKey}`;
    case "metrics":
      return `metrics:${repoKey}`;
    case "ai_drift":
      return `ai-drift:${repoKey}`;
    case "notifications":
      return `notifications:${repoKey}`;
  }
}

export function workflowWriteRefreshJobs(input: {
  repoKey: string;
  githubLogin: string;
  requestedAt: string;
  previewId: string;
  actionKey: WorkflowFixPreview["actionKey"];
  objectType: WorkflowFixPreview["objectType"];
  objectNumber: number;
}): RefreshJobSeed[] {
  const payload = {
    requestedBy: input.githubLogin,
    requestedAt: input.requestedAt,
    trigger: "workflow_fix_execution",
    previewId: input.previewId,
    actionKey: input.actionKey,
    objectType: input.objectType,
    objectNumber: input.objectNumber
  };
  return [
    {
      jobKey: jobKeyForLayer("github_sync", input.repoKey),
      jobType: "github_sync",
      payload
    },
    {
      jobKey: jobKeyForLayer("rules", input.repoKey),
      jobType: "rules",
      payload
    }
  ];
}

export function webhookDeliveryRefreshJobs(input: {
  repoKey: string;
  deliveryId: string;
  eventName: string;
  action: string | null;
  receivedAt: string;
}): RefreshJobSeed[] {
  const payload = {
    trigger: "github_webhook_delivery",
    deliveryId: input.deliveryId,
    eventName: input.eventName,
    action: input.action,
    receivedAt: input.receivedAt
  };
  return (["webhooks", "rules", "metrics", "ai_drift", "notifications"] as const).map((layer) => ({
    jobKey: jobKeyForLayer(layer, input.repoKey),
    jobType: layer,
    payload
  }));
}

export function webhookRetryRefreshJobs(input: {
  repoKey: string;
  githubLogin: string;
  requestedAt: string;
  retriedDeliveries: number;
}): RefreshJobSeed[] {
  const payload = {
    trigger: "webhook_retry",
    requestedBy: input.githubLogin,
    requestedAt: input.requestedAt,
    retriedDeliveries: input.retriedDeliveries
  };
  return (["webhooks", "rules", "metrics", "ai_drift", "notifications"] as const).map((layer) => ({
    jobKey: jobKeyForLayer(layer, input.repoKey),
    jobType: layer,
    payload
  }));
}
