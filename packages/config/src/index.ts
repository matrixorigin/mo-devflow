import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import YAML from "yaml";
import { z } from "zod";
import type { RepoProfile } from "@mo-devflow/shared";

const notificationRoutingEntrySchema = z.object({
  cooldown_hours: z.number().min(0).optional(),
  fallback_recipient: z.string().optional(),
  escalate_after_hours: z.number().min(1).optional()
});

const profileSchema = z.object({
  repo: z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    local_path: z.string().optional()
  }),
  reporting: z
    .object({
      timezone: z.string().default("Asia/Shanghai"),
      week_start: z.enum(["Monday", "Sunday"]).default("Monday")
    })
    .default({ timezone: "Asia/Shanghai", week_start: "Monday" }),
  access: z.object({
    anonymous_read: z.boolean(),
    expose_user_token_synced_private_data: z.boolean(),
    critical_scope: z.enum(["repo-wide", "watched-users"]),
    write_back_enabled: z.boolean()
  }),
  people: z
    .object({
      watched_users: z.array(z.string()).default([]),
      testers: z.array(z.string()).default([])
    })
    .default({ watched_users: [], testers: [] }),
  ownership: z
    .object({
      issue_owner_priority: z
        .array(z.enum(["assignee", "linked_pr_author", "author"]))
        .default(["assignee", "linked_pr_author", "author"]),
      pr_owner: z.enum(["author", "assignee"]).default("author"),
      unowned_bucket: z.boolean().default(true)
    })
    .default({
      issue_owner_priority: ["assignee", "linked_pr_author", "author"],
      pr_owner: "author",
      unowned_bucket: true
    }),
  labels: z.object({
    bug: z.string().default("kind/bug"),
    needs_triage: z.string().default("needs-triage"),
    deferred: z.string().default("deferred"),
    critical: z.array(z.string()).default(["severity/s-1", "severity/s0"]),
    active: z.array(z.string()).default(["severity/s-1", "severity/s0", "severity/s1"]),
    ai_effort: z.array(z.string()).default(["ai-easy", "ai-light", "ai-medium", "ai-heavy", "ai-manual"])
  }),
  thresholds: z
    .object({
      pr_no_action_attention_hours: z.number().default(24),
      critical_no_action_attention_hours: z.number().default(24),
      ai_easy_s0_to_test_attention_days: z.number().default(7),
      needs_triage_stale_hours: z.number().default(72),
      premature_severity_window_hours: z.number().default(24),
      ai_easy_critical_critical_days: z.number().default(14)
    })
    .default({
      pr_no_action_attention_hours: 24,
      critical_no_action_attention_hours: 24,
      ai_easy_s0_to_test_attention_days: 7,
      needs_triage_stale_hours: 72,
      premature_severity_window_hours: 24,
      ai_easy_critical_critical_days: 14
    }),
  testing: z
    .object({
      handoff_signals: z
        .object({
          labels: z.array(z.string()).default([]),
          reviewer_users: z.array(z.string()).default([]),
          assignee_users: z.array(z.string()).default([]),
          comments: z.array(z.string()).default([])
        })
        .default({ labels: [], reviewer_users: [], assignee_users: [], comments: [] }),
      states: z.record(z.string(), z.unknown()).optional()
    })
    .default({
      handoff_signals: { labels: [], reviewer_users: [], assignee_users: [], comments: [] }
    }),
  workflow: z.object({
    skip_users: z.array(z.string())
  }),
  notifications: z
    .object({
      wecom: z
        .object({
          enabled: z.boolean().default(false),
          webhook_url_env: z.string().optional(),
          quiet_hours: z
            .object({
              start: z.string(),
              end: z.string()
            })
            .optional()
        })
        .default({ enabled: false }),
      employees: z.record(z.string(), z.object({ wecom_user_id: z.string() })).default({}),
      routing: z
        .object({
          critical_issue_stalled: notificationRoutingEntrySchema.optional(),
          default: notificationRoutingEntrySchema.optional()
        })
        .passthrough()
        .default({})
    })
    .default({ wecom: { enabled: false }, employees: {}, routing: {} })
});

export function loadRepoProfile(
  profilePath = process.env.MO_DEVFLOW_PROFILE ?? "config/repos/matrixone.yaml"
): RepoProfile {
  const absolutePath = path.resolve(profilePath);
  const rawText = fs.readFileSync(absolutePath, "utf8");
  const raw = YAML.parse(rawText);
  const parsed = profileSchema.parse(raw);
  const key = `${parsed.repo.owner}/${parsed.repo.name}`;

  return {
    key,
    repo: {
      owner: parsed.repo.owner,
      name: parsed.repo.name,
      localPath: parsed.repo.local_path
    },
    reporting: {
      timezone: parsed.reporting.timezone,
      weekStart: parsed.reporting.week_start
    },
    access: {
      anonymousRead: parsed.access.anonymous_read,
      exposeUserTokenSyncedPrivateData: parsed.access.expose_user_token_synced_private_data,
      criticalScope: parsed.access.critical_scope,
      writeBackEnabled: parsed.access.write_back_enabled
    },
    people: {
      watchedUsers: parsed.people.watched_users,
      testers: parsed.people.testers
    },
    ownership: {
      issueOwnerPriority: parsed.ownership.issue_owner_priority,
      prOwner: parsed.ownership.pr_owner,
      unownedBucket: parsed.ownership.unowned_bucket
    },
    labels: {
      bug: parsed.labels.bug,
      needsTriage: parsed.labels.needs_triage,
      deferred: parsed.labels.deferred,
      critical: parsed.labels.critical,
      active: parsed.labels.active,
      aiEffort: parsed.labels.ai_effort
    },
    thresholds: {
      prNoActionAttentionHours: parsed.thresholds.pr_no_action_attention_hours,
      criticalNoActionAttentionHours: parsed.thresholds.critical_no_action_attention_hours,
      aiEasyS0ToTestAttentionDays: parsed.thresholds.ai_easy_s0_to_test_attention_days,
      needsTriageStaleHours: parsed.thresholds.needs_triage_stale_hours,
      prematureSeverityWindowHours: parsed.thresholds.premature_severity_window_hours,
      aiEasyCriticalCriticalDays: parsed.thresholds.ai_easy_critical_critical_days
    },
    testing: {
      handoffSignals: {
        labels: parsed.testing.handoff_signals.labels,
        reviewerUsers: parsed.testing.handoff_signals.reviewer_users,
        assigneeUsers: parsed.testing.handoff_signals.assignee_users,
        comments: parsed.testing.handoff_signals.comments
      }
    },
    workflow: {
      skipUsers: parsed.workflow.skip_users
    },
    notifications: {
      wecom: {
        enabled: parsed.notifications.wecom.enabled,
        webhookUrlEnv: parsed.notifications.wecom.webhook_url_env,
        quietHours: parsed.notifications.wecom.quiet_hours
      },
      employees: Object.fromEntries(
        Object.entries(parsed.notifications.employees).map(([login, value]) => [
          login,
          { wecomUserId: value.wecom_user_id }
        ])
      ),
      routing: {
        cooldownHours:
          parsed.notifications.routing.default?.cooldown_hours ??
          parsed.notifications.routing.critical_issue_stalled?.cooldown_hours ??
          12,
        fallbackRecipient:
          parsed.notifications.routing.default?.fallback_recipient ??
          parsed.notifications.routing.critical_issue_stalled?.fallback_recipient ??
          "maintainer_group",
        escalateAfterHours:
          parsed.notifications.routing.critical_issue_stalled?.escalate_after_hours ??
          parsed.notifications.routing.default?.escalate_after_hours ??
          24
      }
    },
    raw
  };
}

export function loadEnv(): void {
  if (fs.existsSync(".env")) {
    dotenv.config({ quiet: true });
  }
}
