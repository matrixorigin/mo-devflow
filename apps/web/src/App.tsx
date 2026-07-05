import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Dropdown,
  Empty,
  Input,
  Layout,
  Modal,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import type {
  AggregatedMetricPoint,
  AiDriftSignalView,
  AnalyticsSummary,
  CriticalIssueBlockerView,
  CriticalIssueLinkedPullRequestView,
  CriticalIssueOwnerScope,
  CriticalIssueView,
  CriticalOwnerCoverageView,
  DailyMetricPoint,
  DashboardSummary,
  GitHubWebhookDeliveryView,
  GitHubWriteCapability,
  ManualRefreshLayer,
  ManualRefreshResult,
  MetricPeriod,
  NotificationDeliveryView,
  NotificationStatus,
  NotificationTraceView,
  PendingPrView,
  PersonalActionView,
  PersonalIssueView,
  PersonalPullRequestView,
  PersonSummary,
  ProfileConfigurationWarning,
  SessionView,
  TestingFlowState,
  TestingIssueQueueView,
  WriteActionExecutionView,
  WorkflowFixActionKey,
  WorkflowFixExecutionResult,
  WorkflowFixPreview,
  WorkflowFixStateSnapshot,
  WorkflowViolationView
} from "@mo-devflow/shared";
import {
  csrfCookieName,
  csrfHeaderName,
  githubWebhookConnectivityEvents,
  notificationStatusAllowsRetry,
  notificationStatusRequiresAcknowledgement,
  supportedGitHubWebhookEvents,
  syncHealthLayers
} from "@mo-devflow/shared";
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import {
  BellRing,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardCheck,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Eye,
  KeyRound,
  LogOut,
  RefreshCcw,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  Trash2,
  UserRound
} from "lucide-react";
import {
  recommendCacheRepair,
  summarizeCacheEvidence,
  summarizeFreshness,
  summarizeProductionReadiness,
  summarizeUpdatePipeline,
  summarizeWebhookReadiness,
  type CacheEvidenceSummary,
  type FreshnessSummary,
  type ProductionReadinessGate,
  type ProductionReadinessSummary,
  type ProductionReadinessTarget,
  type UpdatePipelineSummary,
  type UpdatePipelineTile,
  type WebhookReadinessSummary
} from "./freshness";
import {
  criticalIssueContextsByPullRequest,
  criticalIssueReasons,
  effectiveAiEffortLabel,
  filterPeopleByScope,
  flowEfficiencyDiagnostics,
  flowThreadDurationWarnings,
  flowThreadNextAction,
  flowThreadStatusCounts,
  flowEfficiencySummary,
  observedPeopleFromDashboard,
  observedOwnerThreads,
  notificationDeliveryMatchesScope,
  notificationDeliveryScopeCounts,
  peopleBoardScopeCounts,
  personalActionQueueCounts,
  personalActionQueueItemsForFilter,
  personalGanttChart,
  personalActivityHasBlockingSignal,
  personalActivityItems,
  personalActivityNeedsLink,
  personalActivityNextAction,
  personalActivityPrimarySignal,
  personalDurationText,
  personalFlowThreadCounts,
  personalFlowThreadMatchesFilter,
  personalTestingWorkCount,
  personPrimaryReasons,
  personWorkloadStatus,
  personalIssueReasons,
  prAttentionReasons,
  sortTestingIssuesForAction,
  teamCommandSignals,
  testingStateBusinessLabel,
  testingStateHelpText,
  testingIssueLinkedBlockerCount,
  testingIssueNeedsAttention,
  sortPeopleByWorkload,
  type FlowEfficiencyDiagnostic,
  type FlowEfficiencyDiagnosticTarget,
  type FlowEfficiencySummary,
  type ObservedOwnerThread,
  type NotificationDeliveryScopeFilter,
  type PersonalActionQueueFilter,
  type PersonalActivityItem,
  type PersonalFlowThreadFilter,
  type PersonalGanttChart,
  type PersonalGanttPrBar,
  type PersonalGanttRow,
  type PeopleScopeFilter,
  type PrCriticalIssueContext,
  type TeamCommandSignalTarget,
  type WorkloadStatus
} from "./workbench";

const { Header, Content } = Layout;
const { Paragraph, Text, Title } = Typography;
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const dashboardAutoRefreshMs = 30_000;
const tokenEncryptionSetupHint = "Token encryption is not configured. Run make setup, restart the API, then try again.";

type DashboardReadModelCacheStatus = "miss" | "hit" | "stale-if-error" | "not-modified" | "unknown";

interface DashboardReadModelMeta {
  etag: string | null;
  receivedAt: string;
  status: DashboardReadModelCacheStatus;
  version: string | null;
}

type TrendMetricPoint = DailyMetricPoint | AggregatedMetricPoint;
type CriticalIssueScopeFilter = "all" | "s-1" | "s0" | "no_pr" | "owner_gap" | "timeline_missing" | "skipped";
type CriticalIssueAiFilter = "all" | string;
type PrScopeFilter =
  | "all"
  | "active_issue"
  | "attention"
  | "testing"
  | "stale_testing"
  | "testing_evidence_gap"
  | "ci_failed"
  | "request_changes"
  | "conflict"
  | "no_issue"
  | "issue_link_pending"
  | "evidence_pending"
  | "no_action_24h";
type PrBoardTab = "rotation" | "testing";
type PersonalDrilldownFilter =
  "active_issues" | "pr_attention" | "pending_pr" | "testing" | "triage" | "deferred" | "yesterday_pr" | "threads";
type WebhookDeliveryScopeFilter = "all" | "pending" | "failed" | "processed" | "ignored" | "duplicates";
type WriteAuditScopeFilter =
  "all" | "attention" | "failed" | "stale_preview" | "token_unavailable" | "success" | "workflow_fix" | "notification";

interface ObservedPersonPreview {
  login: string;
  summary: PersonSummary;
  threads: ObservedOwnerThread[];
  issues: CriticalIssueView[];
  prs: PendingPrView[];
}

interface WebhookRetryResult {
  retriedDeliveries: number;
  requestId: number | null;
  requestedLayers: ManualRefreshLayer[];
  queuedJobs: ManualRefreshResult["queuedJobs"];
  requestedAt: string;
}

interface NotificationTestResult {
  status: "sent";
  channel: "wecom";
  attemptedAt: string;
  providerStatus: number;
  auditRecorded: boolean;
}
const viewOptions = [
  "Overview",
  "Issues",
  "Personal",
  "Health",
  "Analytics",
  "People",
  "PRs",
  "Violations",
  "Drift",
  "Notifications",
  "Webhooks",
  "Audit"
] as const;
type DashboardView = (typeof viewOptions)[number];
const primaryViewOptions = ["Overview", "Issues", "Personal", "People", "PRs", "Analytics"] satisfies DashboardView[];
const systemViewOptions = [
  "Health",
  "Violations",
  "Drift",
  "Notifications",
  "Webhooks",
  "Audit"
] satisfies DashboardView[];
const systemViewOptionSet = new Set<DashboardView>(systemViewOptions);

const hashViewMap: Record<string, DashboardView> = {
  overview: "Overview",
  issues: "Issues",
  personal: "Personal",
  health: "Health",
  analytics: "Analytics",
  people: "People",
  prs: "PRs",
  violations: "Violations",
  drift: "Drift",
  notifications: "Notifications",
  webhooks: "Webhooks",
  audit: "Audit"
};

function dashboardViewFromHash(hash: string): DashboardView {
  const key = hash.replace(/^#/, "").split("?")[0].toLowerCase();
  return hashViewMap[key] ?? "Overview";
}

function dashboardHashParams(hash: string): URLSearchParams {
  const query = hash.replace(/^#/, "").split("?")[1] ?? "";
  return new URLSearchParams(query);
}

function selectedPersonFromHash(hash: string): string | null {
  const person = dashboardHashParams(hash).get("person")?.trim();
  return person && person.length > 0 ? person : null;
}

function dashboardHashForView(view: DashboardView, personLogin?: string | null): string {
  const base = view.toLowerCase();
  if (view !== "Personal" || !personLogin) {
    return base;
  }
  const params = new URLSearchParams({ person: personLogin });
  return `${base}?${params.toString()}`;
}

function initialDashboardView(): DashboardView {
  return typeof window === "undefined" ? "Overview" : dashboardViewFromHash(window.location.hash);
}

function initialSelectedPerson(): string | null {
  return typeof window === "undefined" ? null : selectedPersonFromHash(window.location.hash);
}

function isManualRefreshLayer(value: string): value is ManualRefreshLayer {
  return (syncHealthLayers as readonly string[]).includes(value);
}

function manualRefreshLayerDescription(layer: ManualRefreshLayer): string {
  if (layer === "github_sync") {
    return "Refresh open issue and PR cache from GitHub.";
  }
  if (layer === "pr_backfill") {
    return "Repair PR review, CI, mergeability, and linked-issue evidence.";
  }
  if (layer === "issue_timeline_backfill") {
    return "Repair severity promotion and issue handoff timelines.";
  }
  if (layer === "comment_backfill") {
    return "Repair comment evidence for deferred reasons and handoff signals.";
  }
  if (layer === "webhooks") {
    return "Process queued webhook deliveries and missed event repair.";
  }
  if (layer === "rules") {
    return "Recompute workflow violations and attention items from cache.";
  }
  if (layer === "metrics") {
    return "Recompute daily, weekly, and monthly flow metrics.";
  }
  if (layer === "ai_drift") {
    return "Recompute AI effort drift signals.";
  }
  return "Send or retry eligible notification jobs.";
}

function hours(value: number): string {
  if (value < 24) {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
}

function optionalHours(value: number | null): string {
  return value === null ? "-" : hours(value);
}

function percentText(value: number | null): string {
  return value === null ? "-" : `${value}%`;
}

function signedNumber(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function dashboardReadModelMetaFromResponse(response: Response, receivedAt: string): DashboardReadModelMeta {
  const rawStatus = response.headers.get("x-mo-devflow-dashboard-cache");
  const status: DashboardReadModelCacheStatus =
    rawStatus === "miss" || rawStatus === "hit" || rawStatus === "stale-if-error" || rawStatus === "not-modified"
      ? rawStatus
      : "unknown";
  return {
    etag: response.headers.get("etag"),
    receivedAt,
    status,
    version: response.headers.get("x-mo-devflow-dashboard-version")
  };
}

function dashboardReadModelStatusColor(status: DashboardReadModelCacheStatus): string {
  if (status === "stale-if-error") {
    return "orange";
  }
  if (status === "miss") {
    return "blue";
  }
  if (status === "hit" || status === "not-modified") {
    return "green";
  }
  return "default";
}

function dashboardReadModelStatusLabel(status: DashboardReadModelCacheStatus): string {
  if (status === "stale-if-error") {
    return "snapshot fallback";
  }
  if (status === "not-modified") {
    return "not modified";
  }
  return status;
}

function syncHealthTooltip(item: DashboardSummary["sync"]["health"][number]) {
  return (
    <div>
      <div>Last attempt: {formatDate(item.lastAttemptedAt)}</div>
      <div>Last success: {formatDate(item.lastSuccessfulAt)}</div>
      {item.skipped ? <div>Latest run skipped: {item.skipReason ?? "no reason recorded"}</div> : null}
      {item.lastFailedAt ? <div>Last failure: {formatDate(item.lastFailedAt)}</div> : null}
      {item.lastFailureMessage ? <div>Failure reason: {item.lastFailureMessage}</div> : null}
      {item.errorMessage ? <div>Latest error: {item.errorMessage}</div> : null}
    </div>
  );
}

function displayError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

class ApiResponseError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(input: { message: string; status: number; code: string | null; retryAfterSeconds: number | null }) {
    super(input.message);
    this.name = "ApiResponseError";
    this.status = input.status;
    this.code = input.code;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

function parseRetryAfterSeconds(response: Response, bodyRetryAfter: unknown): number | null {
  if (typeof bodyRetryAfter === "number" && Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
    return Math.ceil(bodyRetryAfter);
  }
  const headerRetryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(headerRetryAfter) && headerRetryAfter > 0 ? Math.ceil(headerRetryAfter) : null;
}

async function responseApiError(response: Response): Promise<ApiResponseError> {
  try {
    const body = (await response.json()) as { message?: string; error?: string; retryAfterSeconds?: unknown };
    return new ApiResponseError({
      message: body.message ?? body.error ?? `API returned ${response.status}`,
      status: response.status,
      code: body.error ?? null,
      retryAfterSeconds: parseRetryAfterSeconds(response, body.retryAfterSeconds)
    });
  } catch {
    return new ApiResponseError({
      message: `API returned ${response.status}`,
      status: response.status,
      code: null,
      retryAfterSeconds: parseRetryAfterSeconds(response, null)
    });
  }
}

async function responseError(response: Response): Promise<string> {
  return (await responseApiError(response)).message;
}

interface DashboardLoadError {
  message: string;
  status: number | null;
  code: string | null;
  retryAfterSeconds: number | null;
}

function dashboardLoadErrorFromUnknown(value: unknown): DashboardLoadError {
  if (value instanceof ApiResponseError) {
    return {
      message: value.message,
      status: value.status,
      code: value.code,
      retryAfterSeconds: value.retryAfterSeconds
    };
  }
  return {
    message: displayError(value),
    status: null,
    code: null,
    retryAfterSeconds: null
  };
}

function dashboardLoadErrorMessage(error: DashboardLoadError): string {
  const retryText = error.retryAfterSeconds === null ? "" : ` Retry after about ${error.retryAfterSeconds}s.`;
  return `${error.message}${retryText}`;
}

function DashboardLoadErrorDescription({ error }: { error: DashboardLoadError }) {
  const detail =
    error.code === "dashboard_query_failed"
      ? "The API could not read the local MatrixOne cache. Check API health, API logs, and MO_DEVFLOW_DB_* configuration."
      : error.status === 503
        ? "The API is reachable but unhealthy. Open API health to inspect database, migration, worker, and queue status."
        : error.status === null
          ? "The browser could not complete the dashboard request. Check that the API process is running and the Vite proxy can reach it."
          : "Open API health for the current runtime state, then retry after the service recovers.";

  return (
    <Space orientation="vertical" size={4}>
      <Text>{dashboardLoadErrorMessage(error)}</Text>
      <Text type="secondary">{detail}</Text>
      {error.code ? <Tag color="red">{error.code}</Tag> : null}
    </Space>
  );
}

function readBrowserCookie(name: string): string | null {
  for (const segment of document.cookie.split(";")) {
    const [rawKey, ...valueParts] = segment.trim().split("=");
    if (rawKey === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function csrfHeaders(): Record<string, string> {
  const token = readBrowserCookie(csrfCookieName);
  return token ? { [csrfHeaderName]: token } : {};
}

function jsonHeadersWithCsrf(): Record<string, string> {
  return {
    "content-type": "application/json",
    ...csrfHeaders()
  };
}

function severityColor(severity: string | null): string {
  if (severity === "severity/s-1") {
    return "red";
  }
  if (severity === "severity/s0") {
    return "volcano";
  }
  return "blue";
}

function ownerScopeColor(scope: CriticalIssueOwnerScope): string {
  if (scope === "unowned") {
    return "red";
  }
  if (scope === "non_watched") {
    return "orange";
  }
  return "green";
}

function ownerScopeTooltip(scope: CriticalIssueOwnerScope): string {
  if (scope === "unowned") {
    return "No owner was derived from assignee, linked PR author, or author.";
  }
  if (scope === "non_watched") {
    return "Owner is outside the configured watched users.";
  }
  return "Owner is in the configured watched users.";
}

function workflowSkipTooltip(): string {
  return "This login is in workflow.skip_users: keep visible, but suppress automated violations, drift signals, attention notifications, and setup suggestions.";
}

function labelText(value: string): string {
  return value.replaceAll("_", " ");
}

function retryDelayText(seconds: number): string {
  const safeSeconds = Math.max(1, Math.ceil(seconds));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function workloadStatusColor(status: WorkloadStatus): string {
  if (status === "critical") {
    return "red";
  }
  if (status === "attention") {
    return "orange";
  }
  if (status === "triage") {
    return "gold";
  }
  if (status === "active") {
    return "blue";
  }
  return "green";
}

function workloadStatusText(status: WorkloadStatus): string {
  return status === "critical" ? "s-1/s0" : labelText(status);
}

function capabilityStatusColor(status: GitHubWriteCapability["status"]): string {
  if (status === "ready") {
    return "green";
  }
  if (status === "write_back_disabled") {
    return "default";
  }
  if (status === "missing_token" || status === "scope_unverified" || status === "repo_permission_unverified") {
    return "orange";
  }
  return "red";
}

function repoPermissionColor(permission: GitHubWriteCapability["repoPermission"]): string {
  if (permission === "admin" || permission === "maintain" || permission === "write" || permission === "triage") {
    return "green";
  }
  if (permission === "unverified") {
    return "orange";
  }
  return "red";
}

function TokenCapabilityPanel({ capability }: { capability: GitHubWriteCapability }) {
  return (
    <Space orientation="vertical" size={8} className="token-capability-panel">
      <Space size={[6, 6]} wrap>
        <Tag color={capabilityStatusColor(capability.status)}>{labelText(capability.status)}</Tag>
        <Tag color={repoPermissionColor(capability.repoPermission)}>repo: {capability.repoPermission}</Tag>
      </Space>
      <Text>{capability.message}</Text>
      <div className="token-capability-row">
        <Text type="secondary">Scopes</Text>
        <Space size={[4, 4]} wrap>
          {capability.currentScopes.length > 0 ? (
            capability.currentScopes.map((scope) => <Tag key={scope}>{scope}</Tag>)
          ) : (
            <Tag color="orange">unreported</Tag>
          )}
        </Space>
      </div>
      <div className="token-capability-row">
        <Text type="secondary">Required</Text>
        <Space size={[4, 4]} wrap>
          {capability.requiredScopes.map((scope) => (
            <Tag key={scope}>{scope}</Tag>
          ))}
          {capability.requiredRepoPermissions.map((permission) => (
            <Tag key={permission} color="blue">
              repo:{permission}
            </Tag>
          ))}
        </Space>
      </div>
    </Space>
  );
}

function profileWarningAlertType(severity: ProfileConfigurationWarning["severity"]): "info" | "warning" | "error" {
  if (severity === "critical") {
    return "error";
  }
  if (severity === "warning") {
    return "warning";
  }
  return "info";
}

function profileSetupCapabilityLabel(value: DashboardSummary["profileSetup"]["missingCapabilities"][number]): string {
  if (value === "watched_users") {
    return "watched users";
  }
  if (value === "testing_handoff") {
    return "issue sent to test";
  }
  return "notification employees";
}

interface ProfileCapabilityCard {
  key: string;
  label: string;
  value: string;
  detail: string;
  configured: boolean;
}

function profileCapabilityCards(data: DashboardSummary): ProfileCapabilityCard[] {
  const configuration = data.profileConfiguration;
  const evidenceLimitValue = `${configuration.prDetailBackfillLimit}/${configuration.commentBackfillLimit}/${configuration.issueTimelineBackfillLimit}`;
  return [
    {
      key: "watched-users",
      label: "People",
      value: configuration.watchedUsersConfigured ? `${configuration.watchedUserCount} watched` : "not configured",
      detail: configuration.watchedUsersConfigured
        ? "Personal boards, triage, deferred, and trends use the configured people set."
        : "Personal boards fall back to observed active owners only.",
      configured: configuration.watchedUsersConfigured
    },
    {
      key: "issue-testing",
      label: "Issue testing",
      value: configuration.testingHandoffConfigured ? `${configuration.testerCount} testers` : "not configured",
      detail: configuration.testingHandoffConfigured
        ? "Testing queue is driven by issue assignee or issue label handoff signals."
        : "Testing turnover cannot be trusted until issue handoff signals are configured.",
      configured: configuration.testingHandoffConfigured
    },
    {
      key: "local-checkout",
      label: "Local checkout",
      value: configuration.localCheckoutConfigured ? "available" : "not configured",
      detail: configuration.localCheckoutConfigured
        ? "Local source context can enrich diagnostics without being exposed in API responses."
        : "Dashboards work from GitHub cache only.",
      configured: configuration.localCheckoutConfigured
    },
    {
      key: "service-read-token",
      label: "Service read token",
      value: configuration.githubServiceTokenConfigured ? "configured" : "anonymous",
      detail: configuration.githubServiceTokenConfigured
        ? "Worker polling and backfill use the deployment read-only source; it is not a leader Connect session."
        : "Configure MO_DEVFLOW_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN for production-quality read evidence.",
      configured: configuration.githubServiceTokenConfigured
    },
    {
      key: "github-evidence",
      label: "PR/issue evidence",
      value: configuration.githubEvidenceBackfillConfigured
        ? `backfill ${evidenceLimitValue}`
        : configuration.githubServiceTokenConfigured
          ? `limited ${evidenceLimitValue}`
          : "anonymous only",
      detail: configuration.githubEvidenceBackfillConfigured
        ? "PR detail, comments, and issue timeline backfill can support review, CI, links, and workflow checks."
        : "PR review, CI, issue links, and comment-backed rules can be incomplete until service read token and evidence backfill are configured.",
      configured: configuration.githubEvidenceBackfillConfigured
    },
    {
      key: "workflow-fixes",
      label: "Workflow fixes",
      value: configuration.writeBackEnabled ? "enabled" : "read-only",
      detail: configuration.writeBackEnabled
        ? "Logged-in users with a capable token can preview and confirm workflow fixes."
        : "GitHub write-back is disabled by the repository profile.",
      configured: configuration.writeBackEnabled
    },
    {
      key: "notification-employees",
      label: "Notification mappings",
      value: configuration.notificationEmployeesConfigured
        ? `${configuration.notificationEmployeeCount} mapped`
        : "not configured",
      detail: configuration.notificationEmployeesConfigured
        ? "Owner-routed notification delivery can use employee mappings."
        : "Owner-routed notifications will use fallback routing.",
      configured: configuration.notificationEmployeesConfigured
    },
    {
      key: "webhook-ingest",
      label: "Webhook ingest",
      value: configuration.webhookSecretConfigured ? "enabled" : "polling only",
      detail: configuration.webhookSecretConfigured
        ? "Signed GitHub deliveries can update the cache near real time."
        : "Worker polling and manual refresh are the update path.",
      configured: configuration.webhookSecretConfigured
    }
  ];
}

function attentionSeverityColor(severity: "info" | "warning" | "critical"): string {
  if (severity === "critical") {
    return "red";
  }
  if (severity === "warning") {
    return "orange";
  }
  return "blue";
}

function flagColor(flag: string): string {
  if (flag === "requested_changes" || flag === "ci_failed" || flag === "merge_conflict") {
    return "red";
  }
  if (flag === "no_human_action_24h" || flag === "testing_stalled" || flag === "review_requested_no_response") {
    return "orange";
  }
  return "blue";
}

function workflowFixActionForViolation(violation: WorkflowViolationView): WorkflowFixActionKey | null {
  if (!violation.fixable || violation.objectType !== "issue") {
    return null;
  }
  if (violation.ruleKey === "bug_missing_needs_triage") {
    return "add_needs_triage";
  }
  if (violation.ruleKey === "needs_triage_stale" || violation.ruleKey === "premature_active_severity") {
    return "move_to_deferred";
  }
  return null;
}

function testingStateColor(state: TestingFlowState): string {
  if (state === "test_changes_requested") {
    return "red";
  }
  if (state === "test_passed" || state === "closed_or_merged") {
    return "green";
  }
  if (state === "testing") {
    return "blue";
  }
  return "default";
}

function TestingStateTag({ state, label }: { state: TestingFlowState; label?: string }) {
  return (
    <Tooltip title={testingStateHelpText(state)}>
      <Tag color={testingStateColor(state)}>{label ?? testingStateBusinessLabel(state)}</Tag>
    </Tooltip>
  );
}

function testingSignalBusinessLabel(signal: string): string {
  const issueAssignee = signal.match(/^issue_assignee:#(\d+):(.+)$/);
  if (issueAssignee) {
    return `issue #${issueAssignee[1]} assigned to ${issueAssignee[2]}`;
  }
  const issueLabel = signal.match(/^issue_label:#(\d+):(.+)$/);
  if (issueLabel) {
    return `issue #${issueLabel[1]} label ${issueLabel[2]}`;
  }
  if (signal.startsWith("reviewer:")) {
    return `PR reviewer signal only; not an issue testing handoff: ${signal.slice("reviewer:".length)}`;
  }
  if (signal.startsWith("assignee:")) {
    return `PR assignee signal only; not an issue testing handoff: ${signal.slice("assignee:".length)}`;
  }
  if (signal.startsWith("label:")) {
    return `PR label signal only; not an issue testing handoff: ${signal.slice("label:".length)}`;
  }
  if (signal.startsWith("comment:")) {
    return `PR comment signal only; not an issue testing handoff: ${signal.slice("comment:".length)}`;
  }
  return labelText(signal);
}

function testingSignalTagLabel(signal: string): string {
  const issueAssignee = signal.match(/^issue_assignee:#(\d+):(.+)$/);
  if (issueAssignee) {
    return `tester assignment: ${issueAssignee[2]}`;
  }
  const issueLabel = signal.match(/^issue_label:#(\d+):(.+)$/);
  if (issueLabel) {
    return `issue label: ${issueLabel[2]}`;
  }
  if (signal.startsWith("reviewer:")) {
    return `ignored PR reviewer: ${signal.slice("reviewer:".length)}`;
  }
  if (signal.startsWith("assignee:")) {
    return `ignored PR assignee: ${signal.slice("assignee:".length)}`;
  }
  if (signal.startsWith("label:")) {
    return `ignored PR label: ${signal.slice("label:".length)}`;
  }
  if (signal.startsWith("comment:")) {
    return "ignored PR comment";
  }
  return labelText(signal);
}

function testingSignalTagColor(signal: string): string {
  if (signal.startsWith("issue_label:")) {
    return "purple";
  }
  if (signal.startsWith("issue_assignee:")) {
    return "blue";
  }
  if (
    signal.startsWith("reviewer:") ||
    signal.startsWith("assignee:") ||
    signal.startsWith("label:") ||
    signal.startsWith("comment:")
  ) {
    return "default";
  }
  return "default";
}

function testingIssueQueueAgeEvidenceColor(evidence: TestingIssueQueueView["queueAgeEvidence"]): string {
  if (evidence === "issue_cache_timestamp") {
    return "gold";
  }
  if (evidence === "issue_label_event") {
    return "purple";
  }
  return "green";
}

function testingIssueQueueAgeEvidenceShortLabel(evidence: TestingIssueQueueView["queueAgeEvidence"]): string {
  if (evidence === "issue_assignment_event") {
    return "tester assignment";
  }
  if (evidence === "issue_label_event") {
    return "issue label";
  }
  return "issue update time";
}

function testingIssueQueueAgeEvidenceSourceLabel(evidence: TestingIssueQueueView["queueAgeEvidence"]): string {
  if (evidence === "issue_assignment_event") {
    return "from tester assignment";
  }
  if (evidence === "issue_label_event") {
    return "from issue label";
  }
  return "from issue update time";
}

function testingIssueQueueAgeEvidenceMetricLabel(evidence: TestingIssueQueueView["queueAgeEvidence"]): string {
  if (evidence === "issue_assignment_event") {
    return "assignment time";
  }
  if (evidence === "issue_label_event") {
    return "label time";
  }
  return "issue update time";
}

function testingIssueHandoffSummary(issue: TestingIssueQueueView): string {
  if (issue.testingSignals.length > 0) {
    return `handoff: ${issue.testingSignals.slice(0, 2).map(testingSignalTagLabel).join(", ")}`;
  }
  if (issue.testers.length > 0) {
    return `handoff: tester assignment`;
  }
  return "handoff evidence not visible";
}

function ciColor(value: string): string {
  if (["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(value)) {
    return "red";
  }
  if (value === "pending") {
    return "blue";
  }
  if (value === "success") {
    return "green";
  }
  return "default";
}

function mergeColor(value: string): string {
  if (value === "dirty") {
    return "red";
  }
  if (["blocked", "behind", "unstable"].includes(value)) {
    return "orange";
  }
  if (value === "clean") {
    return "green";
  }
  return "default";
}

function violationColor(value: WorkflowViolationView["severity"]): string {
  if (value === "critical") {
    return "red";
  }
  if (value === "warning") {
    return "orange";
  }
  return "blue";
}

function signalColor(value: AiDriftSignalView["severity"]): string {
  if (value === "critical") {
    return "red";
  }
  if (value === "warning") {
    return "orange";
  }
  return "blue";
}

function notificationStatusColor(value: NotificationStatus): string {
  if (value === "sent") {
    return "green";
  }
  if (value === "failed_transient" || value === "failed_permanent" || value === "skipped_no_webhook") {
    return "red";
  }
  if (value === "retry_requested") {
    return "blue";
  }
  if (value === "dry_run" || value === "skipped_quiet_hours") {
    return "orange";
  }
  return "default";
}

function notificationReadinessColor(value: DashboardSummary["notifications"]["readiness"]["status"]): string {
  if (value === "ready") {
    return "green";
  }
  if (value === "degraded") {
    return "orange";
  }
  if (value === "action_required") {
    return "red";
  }
  return "default";
}

function notificationDeliveryScopeLabel(filter: NotificationDeliveryScopeFilter): string {
  if (filter === "attention") {
    return "attention deliveries";
  }
  if (filter === "failed") {
    return "failed deliveries";
  }
  if (filter === "ack_pending") {
    return "acknowledgement pending";
  }
  if (filter === "digest") {
    return "digest deliveries";
  }
  return "all deliveries";
}

function workflowExecutionStatusColor(value: WriteActionExecutionView["status"]): string {
  if (value === "success") {
    return "green";
  }
  if (value === "failed" || value === "token_unavailable") {
    return "red";
  }
  if (value === "stale_preview" || value === "blocked") {
    return "orange";
  }
  return "default";
}

function workflowOperationSummary(operation: WriteActionExecutionView["executedOperations"][number]): string {
  if (operation.type === "add_label") {
    return `+ ${operation.label}`;
  }
  if (operation.type === "remove_label") {
    return `- ${operation.label}`;
  }
  return "comment";
}

function writeActionObjectLabel(objectType: WriteActionExecutionView["objectType"]): string {
  if (objectType === "issue") {
    return "Issue";
  }
  if (objectType === "pull_request") {
    return "PR";
  }
  if (objectType === "notification_probe") {
    return "Notification test";
  }
  return labelText(objectType);
}

function NotificationTraceTag({ notification }: { notification: NotificationTraceView }) {
  if (!notification.status) {
    return <Tag color="default">not sent</Tag>;
  }
  const statusTag = <Tag color={notificationStatusColor(notification.status)}>{labelText(notification.status)}</Tag>;
  const routeTag = notification.recipientScope ? <Tag>{labelText(notification.recipientScope)}</Tag> : null;
  const attempted = notification.attemptedAt ? formatDate(notification.attemptedAt) : null;
  if (notification.acknowledgedAt) {
    return (
      <Tooltip title={`Sent ${attempted ?? "-"}; acknowledged by ${notification.acknowledgedBy ?? "unknown"}`}>
        <Space size={[4, 4]} wrap>
          {statusTag}
          {routeTag}
          <Tag color="green">ack {formatDate(notification.acknowledgedAt)}</Tag>
        </Space>
      </Tooltip>
    );
  }
  if (notificationStatusRequiresAcknowledgement(notification.status)) {
    return (
      <Tooltip title={`Sent ${attempted ?? "-"}; acknowledgement pending`}>
        <Space size={[4, 4]} wrap>
          {statusTag}
          {routeTag}
          <Tag color="orange">unacknowledged</Tag>
        </Space>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={attempted ? `Attempted ${attempted}` : undefined}>
      <Space size={[4, 4]} wrap>
        {statusTag}
        {routeTag}
      </Space>
    </Tooltip>
  );
}

function workerStatusColor(value: DashboardSummary["sync"]["worker"]["status"]): string {
  if (value === "active") {
    return "#16a34a";
  }
  if (value === "failed") {
    return "#dc2626";
  }
  if (value === "stale") {
    return "#d97706";
  }
  return "#6b7280";
}

function rateLimitColor(remaining: number | null): string {
  if (remaining === null) {
    return "#6b7280";
  }
  if (remaining <= 0) {
    return "#dc2626";
  }
  if (remaining <= 10) {
    return "#d97706";
  }
  return "#16a34a";
}

function rateLimitHealthTagColor(remaining: number | null): string {
  if (remaining === null) {
    return "default";
  }
  if (remaining <= 0) {
    return "red";
  }
  if (remaining <= 10) {
    return "orange";
  }
  return "green";
}

function syncHealthTagColor(status: DashboardSummary["sync"]["health"][number]["status"]): string {
  if (status === "success") {
    return "green";
  }
  if (status === "partial" || status === "not_started") {
    return "orange";
  }
  return "red";
}

function blockerColor(severity: CriticalIssueBlockerView["severity"]): string {
  if (severity === "critical") {
    return "red";
  }
  if (severity === "warning") {
    return "orange";
  }
  return "blue";
}

function workerStatusDescription(worker: DashboardSummary["sync"]["worker"]): string {
  const action = worker.recommendedAction ? ` ${worker.recommendedAction}` : "";
  if (worker.status === "offline") {
    return `No worker heartbeat has been recorded.${action}`;
  }
  if (worker.status === "stale") {
    return `Last heartbeat was ${worker.secondsSinceHeartbeat ?? "unknown"}s ago; stale threshold is ${
      worker.staleAfterSeconds
    }s.${action}`;
  }
  if (worker.status === "failed") {
    return `${worker.lastError ?? "The latest worker tick failed."}${action}`;
  }
  return `Last heartbeat ${formatDate(worker.heartbeatAt)} on ${worker.host ?? "unknown host"}.${action}`;
}

const metricPeriodOptions = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" }
];

function metricPeriodText(period: MetricPeriod): string {
  if (period === "week") {
    return "weekly";
  }
  if (period === "month") {
    return "monthly";
  }
  return "daily";
}

function teamMetricPoints(analytics: AnalyticsSummary, period: MetricPeriod): TrendMetricPoint[] {
  if (period === "week") {
    return analytics.teamWeekly ?? [];
  }
  if (period === "month") {
    return analytics.teamMonthly ?? [];
  }
  return analytics.teamDaily;
}

function personalMetricPoints(person: PersonalActionView, period: MetricPeriod): TrendMetricPoint[] {
  if (period === "week") {
    return person.analyticsWeekly ?? [];
  }
  if (period === "month") {
    return person.analyticsMonthly ?? [];
  }
  return person.analytics;
}

function linkedPrTooltip(pr: CriticalIssueLinkedPullRequestView): string {
  const flags = pr.attentionFlags.length > 0 ? ` | ${pr.attentionFlags.map(labelText).join(", ")}` : "";
  const testers = pr.testingTesters.length > 0 ? ` | testers: ${pr.testingTesters.join(", ")}` : "";
  return `${pr.title} | owner: ${pr.ownerLogin} | age: ${hours(pr.ageHours)} | last human action: ${formatDate(pr.lastHumanActionAt)}${testers}${flags}`;
}

function WorkflowStateSnapshot({ title, snapshot }: { title: string; snapshot: WorkflowFixStateSnapshot }) {
  return (
    <div className="preview-state-panel">
      <Space orientation="vertical" size={6}>
        <Space size={6} wrap>
          <Text strong>{title}</Text>
          <Tag>{snapshot.source}</Tag>
          <Tag color={snapshot.state === "open" ? "green" : "default"}>{snapshot.state}</Tag>
        </Space>
        <Space size={[4, 4]} wrap>
          <Text type="secondary">Labels</Text>
          {snapshot.labels.length > 0 ? (
            snapshot.labels.map((label) => <Tag key={label}>{label}</Tag>)
          ) : (
            <Tag>none</Tag>
          )}
        </Space>
        <Space size={[4, 4]} wrap>
          <Text type="secondary">Assignees</Text>
          {snapshot.assignees.length > 0 ? (
            snapshot.assignees.map((assignee) => <Tag key={assignee}>{assignee}</Tag>)
          ) : (
            <Tag>none</Tag>
          )}
        </Space>
        <Space size={[4, 4]} wrap>
          {snapshot.lifecycleState ? <Tag>{labelText(snapshot.lifecycleState)}</Tag> : null}
          {snapshot.severity ? <Tag color={severityColor(snapshot.severity)}>{snapshot.severity}</Tag> : null}
          <Tag color="blue">{effectiveAiEffortLabel(snapshot.aiEffortLabel)}</Tag>
          {snapshot.updatedAt ? <Text type="secondary">{formatDate(snapshot.updatedAt)}</Text> : null}
        </Space>
      </Space>
    </div>
  );
}

interface MetricSeriesConfig {
  name: string;
  type: "line" | "bar";
  color: string;
  data: (point: TrendMetricPoint) => number;
}

type FlowEfficiencyActions = Partial<{
  prFlow: () => void;
  issueDrain: () => void;
  triageFlow: () => void;
  pendingPrAge: () => void;
  prAttention: () => void;
  activeCriticalAge: () => void;
  testingQueue: () => void;
  workflowViolations: () => void;
}>;

function FlowEfficiencyStrip({
  summary,
  actions = {}
}: {
  summary: FlowEfficiencySummary;
  actions?: FlowEfficiencyActions;
}) {
  const diagnostics = flowEfficiencyDiagnostics(summary);

  return (
    <>
      <div className="flow-efficiency-strip" aria-label="Flow efficiency summary">
        <FlowEfficiencyItem
          label="PR flow"
          value={`${summary.prsMerged}/${summary.prsCreated}`}
          detail={`${percentText(summary.prMergeRatePercent)} merged | open delta ${signedNumber(summary.prOpenDelta)}`}
          tone={summary.prOpenDelta > 0 ? "attention" : "good"}
          actionLabel="Open PRs"
          onClick={actions.prFlow}
        />
        <FlowEfficiencyItem
          label="Issue drain"
          value={`${summary.issuesResolved}/${summary.issuesOpened}`}
          detail={`${percentText(summary.issueDrainRatePercent)} resolved | open delta ${signedNumber(
            summary.issueOpenDelta
          )}`}
          tone={summary.issueOpenDelta > 0 ? "attention" : "good"}
          actionLabel="Open issues"
          onClick={actions.issueDrain}
        />
        <FlowEfficiencyItem
          label="Triage decisions"
          value={String(summary.needsTriageIssues)}
          detail={`${summary.activeCriticalIssues} active | ${summary.deferredIssues} deferred`}
          tone={
            summary.needsTriageIssues > summary.activeCriticalIssues && summary.activeCriticalIssues <= 1
              ? "attention"
              : summary.needsTriageIssues > 0
                ? "normal"
                : "good"
          }
          actionLabel="Open people"
          onClick={actions.triageFlow}
        />
        <FlowEfficiencyItem
          label="Pending PR age"
          value={String(summary.pendingPrs)}
          detail={`avg ${optionalHours(summary.averagePendingPrAgeHours)} | ${summary.attentionPrs} need attention`}
          tone={
            summary.averagePendingPrAgeHours !== null && summary.averagePendingPrAgeHours >= 24 ? "attention" : "normal"
          }
          actionLabel="Open pending"
          onClick={actions.pendingPrAge}
        />
        <FlowEfficiencyItem
          label="PR attention"
          value={percentText(summary.prAttentionRatePercent)}
          detail={`${summary.attentionPrs}/${summary.pendingPrs} pending PRs`}
          tone={summary.attentionPrs > 0 ? "attention" : "good"}
          actionLabel="Open risks"
          onClick={actions.prAttention}
        />
        <FlowEfficiencyItem
          label="Active s-1/s0 age"
          value={String(summary.activeCriticalIssues)}
          detail={`avg ${optionalHours(summary.averageActiveIssueAgeHours)} | highest priority`}
          tone={summary.activeCriticalIssues > 0 ? "critical" : "good"}
          actionLabel="Open issues"
          onClick={actions.activeCriticalAge}
        />
        <FlowEfficiencyItem
          label="Issues in test"
          value={String(summary.testingQueuePrs)}
          detail={`avg wait ${optionalHours(summary.averageTestingQueueAgeHours)} | workflow violations ${
            summary.workflowViolations
          }`}
          tone={summary.testingQueuePrs > 0 ? "attention" : "normal"}
          actionLabel="Open testing"
          onClick={actions.testingQueue}
        />
      </div>
      <FlowEfficiencyDiagnostics diagnostics={diagnostics} actions={actions} />
    </>
  );
}

function FlowEfficiencyDiagnostics({
  diagnostics,
  actions
}: {
  diagnostics: FlowEfficiencyDiagnostic[];
  actions: FlowEfficiencyActions;
}) {
  return (
    <div className="flow-diagnostic-board" aria-label="Flow diagnostics">
      {diagnostics.slice(0, 4).map((diagnostic) => {
        const onClick = flowEfficiencyDiagnosticAction(diagnostic.target, actions);
        return <FlowEfficiencyDiagnosticCard diagnostic={diagnostic} onClick={onClick} key={diagnostic.key} />;
      })}
    </div>
  );
}

function flowEfficiencyDiagnosticAction(
  target: FlowEfficiencyDiagnosticTarget,
  actions: FlowEfficiencyActions
): (() => void) | undefined {
  if (target === "pr_flow") {
    return actions.prFlow;
  }
  if (target === "issue_drain") {
    return actions.issueDrain;
  }
  if (target === "triage_flow") {
    return actions.triageFlow;
  }
  if (target === "pending_pr_age") {
    return actions.pendingPrAge;
  }
  if (target === "pr_attention") {
    return actions.prAttention;
  }
  if (target === "active_critical_age") {
    return actions.activeCriticalAge;
  }
  if (target === "testing_queue") {
    return actions.testingQueue;
  }
  return actions.workflowViolations;
}

function FlowEfficiencyDiagnosticCard({
  diagnostic,
  onClick
}: {
  diagnostic: FlowEfficiencyDiagnostic;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flow-diagnostic-label">Diagnosis</span>
      <strong>{diagnostic.title}</strong>
      <small>{diagnostic.detail}</small>
      {onClick ? <span className="flow-diagnostic-action">Open</span> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={`flow-diagnostic-card flow-diagnostic-${diagnostic.tone}`} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={`flow-diagnostic-card flow-diagnostic-${diagnostic.tone}`}>{content}</div>;
}

function FlowEfficiencyItem({
  label,
  value,
  detail,
  tone,
  actionLabel,
  onClick
}: {
  label: string;
  value: string;
  detail: string;
  tone: "critical" | "attention" | "normal" | "good";
  actionLabel?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Text type="secondary">{label}</Text>
      <strong>{value}</strong>
      <span>{detail}</span>
      {onClick && actionLabel ? <small>{actionLabel}</small> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`flow-efficiency-item flow-efficiency-button flow-efficiency-${tone}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return <div className={`flow-efficiency-item flow-efficiency-${tone}`}>{content}</div>;
}

const defaultCriticalIssueAiLabels = ["ai-easy", "ai-light", "ai-medium", "ai-heavy", "ai-manual"];

function criticalIssueAiOptions(issues: CriticalIssueView[]): Array<{ label: string; value: string }> {
  const labels = new Set(defaultCriticalIssueAiLabels);
  for (const issue of issues) {
    labels.add(effectiveAiEffortLabel(issue.aiEffortLabel));
  }
  return [
    { label: "All AI", value: "all" },
    ...Array.from(labels).map((label) => ({
      label,
      value: label
    }))
  ];
}

function criticalIssueMatchesAi(issue: CriticalIssueView, aiFilter: CriticalIssueAiFilter): boolean {
  return aiFilter === "all" || effectiveAiEffortLabel(issue.aiEffortLabel) === aiFilter;
}

function criticalIssueMatchesScope(issue: CriticalIssueView, scopeFilter: CriticalIssueScopeFilter): boolean {
  if (scopeFilter === "s-1") {
    return issue.severity === "severity/s-1";
  }
  if (scopeFilter === "s0") {
    return issue.severity === "severity/s0";
  }
  if (scopeFilter === "no_pr") {
    return issue.linkedPullRequests.length === 0;
  }
  if (scopeFilter === "owner_gap") {
    return issue.ownerScope !== "watched";
  }
  if (scopeFilter === "timeline_missing") {
    return issue.criticalAgeEvidence === "missing_timeline";
  }
  if (scopeFilter === "skipped") {
    return issue.workflowSkipped;
  }
  return true;
}

function filterCriticalIssues(
  issues: CriticalIssueView[],
  aiFilter: CriticalIssueAiFilter,
  scopeFilter: CriticalIssueScopeFilter
): CriticalIssueView[] {
  return issues.filter(
    (issue) => criticalIssueMatchesAi(issue, aiFilter) && criticalIssueMatchesScope(issue, scopeFilter)
  );
}

function criticalScopeLabel(filter: CriticalIssueScopeFilter): string {
  if (filter === "s-1") {
    return "s-1";
  }
  if (filter === "s0") {
    return "s0";
  }
  if (filter === "no_pr") {
    return "no linked PR";
  }
  if (filter === "owner_gap") {
    return "owner gaps";
  }
  if (filter === "timeline_missing") {
    return "timeline missing";
  }
  if (filter === "skipped") {
    return "skip automation";
  }
  return "all active";
}

function criticalOverflowLabel(filter: CriticalIssueScopeFilter): string {
  if (filter === "s-1") {
    return "s-1 issues";
  }
  if (filter === "s0") {
    return "s0 issues";
  }
  if (filter === "no_pr") {
    return "issues without linked PRs";
  }
  if (filter === "owner_gap") {
    return "owner-gap issues";
  }
  if (filter === "timeline_missing") {
    return "issues missing timeline evidence";
  }
  if (filter === "skipped") {
    return "issues skipped by automation";
  }
  return "active issues";
}

function prScopeLabel(filter: PrScopeFilter): string {
  if (filter === "active_issue") {
    return "linked to active s-1/s0";
  }
  if (filter === "attention") {
    return "PR attention";
  }
  if (filter === "testing") {
    return "issue in testing";
  }
  if (filter === "stale_testing") {
    return "issue testing wait";
  }
  if (filter === "testing_evidence_gap") {
    return "issue test evidence gap";
  }
  if (filter === "ci_failed") {
    return "CI failed";
  }
  if (filter === "request_changes") {
    return "request changes";
  }
  if (filter === "conflict") {
    return "conflict";
  }
  if (filter === "no_issue") {
    return "no linked issue after sync";
  }
  if (filter === "issue_link_pending") {
    return "issue link sync pending";
  }
  if (filter === "evidence_pending") {
    return "PR detail pending";
  }
  if (filter === "no_action_24h") {
    return "no action 24h";
  }
  return "all pending";
}

function prScopeHelp(filter: PrScopeFilter): string | null {
  if (filter === "no_issue") {
    return "Only PRs with completed PR detail and relationship sync, but no discovered issue relationship, are counted here.";
  }
  if (filter === "issue_link_pending") {
    return "These PRs are not treated as unlinked yet because PR detail or relationship evidence is still incomplete.";
  }
  if (filter === "evidence_pending") {
    return "PR review, CI, merge, or issue-link evidence is still incomplete for these rows.";
  }
  if (filter === "testing_evidence_gap") {
    return "The linked issue appears to be in testing, but the PR-side cached evidence is incomplete or not synchronized yet.";
  }
  return null;
}

function prBoardTabForScope(scope: PrScopeFilter): PrBoardTab {
  if (scope === "testing" || scope === "stale_testing" || scope === "testing_evidence_gap") {
    return "testing";
  }
  return "rotation";
}

function isTestingPrScope(scope: PrScopeFilter): boolean {
  return prBoardTabForScope(scope) === "testing";
}

function webhookScopeLabel(filter: WebhookDeliveryScopeFilter): string {
  if (filter === "pending") {
    return "pending";
  }
  if (filter === "failed") {
    return "failed";
  }
  if (filter === "processed") {
    return "processed";
  }
  if (filter === "ignored") {
    return "ignored";
  }
  if (filter === "duplicates") {
    return "duplicates";
  }
  return "all deliveries";
}

function webhookDeliveryMatchesScope(delivery: GitHubWebhookDeliveryView, filter: WebhookDeliveryScopeFilter): boolean {
  if (filter === "pending") {
    return delivery.status === "received" || delivery.status === "processing";
  }
  if (filter === "failed") {
    return delivery.status === "failed" || delivery.status === "failed_normalization";
  }
  if (filter === "processed") {
    return delivery.status === "processed";
  }
  if (filter === "ignored") {
    return delivery.status === "ignored";
  }
  if (filter === "duplicates") {
    return delivery.duplicateCount > 0;
  }
  return true;
}

function webhookDeliveryStatusColor(status: GitHubWebhookDeliveryView["status"]): string {
  if (status === "processed") {
    return "green";
  }
  if (status === "failed" || status === "failed_normalization") {
    return "red";
  }
  if (status === "ignored") {
    return "default";
  }
  return "blue";
}

type WebhookEventHealthView = DashboardSummary["webhooks"]["eventSummaries"][number];

function webhookEventHealthColor(summary: WebhookEventHealthView | undefined): string {
  if (!summary) {
    return "default";
  }
  if (summary.failedDeliveries > 0) {
    return "red";
  }
  if (summary.pendingDeliveries > 0) {
    return "gold";
  }
  if (summary.processedDeliveries > 0) {
    return "green";
  }
  return "default";
}

function webhookEventHealthLabel(summary: WebhookEventHealthView | undefined): string {
  if (!summary) {
    return "not observed";
  }
  if (summary.failedDeliveries > 0) {
    return `${summary.failedDeliveries} failed`;
  }
  if (summary.pendingDeliveries > 0) {
    return `${summary.pendingDeliveries} pending`;
  }
  if (summary.processedDeliveries > 0) {
    return "observed";
  }
  return "ignored only";
}

function webhookEventHealthDetail(summary: WebhookEventHealthView | undefined): string {
  if (!summary) {
    return "No delivery recorded for this event yet.";
  }
  if (summary.latestFailure) {
    return summary.latestFailure;
  }
  if (summary.lastProcessedAt) {
    return `processed ${formatDate(summary.lastProcessedAt)}`;
  }
  if (summary.lastReceivedAt) {
    return `received ${formatDate(summary.lastReceivedAt)}`;
  }
  return "Delivery exists but timestamp is unavailable.";
}

function writeAuditScopeLabel(filter: WriteAuditScopeFilter): string {
  if (filter === "attention") {
    return "attention";
  }
  if (filter === "failed") {
    return "failed";
  }
  if (filter === "stale_preview") {
    return "stale preview";
  }
  if (filter === "token_unavailable") {
    return "token unavailable";
  }
  if (filter === "success") {
    return "success";
  }
  if (filter === "workflow_fix") {
    return "workflow fixes";
  }
  if (filter === "notification") {
    return "notification actions";
  }
  return "all write actions";
}

function writeActionNeedsAttention(action: WriteActionExecutionView): boolean {
  return action.status !== "success";
}

function writeAuditMatchesScope(action: WriteActionExecutionView, filter: WriteAuditScopeFilter): boolean {
  if (filter === "attention") {
    return writeActionNeedsAttention(action);
  }
  if (filter === "failed") {
    return action.status === "failed";
  }
  if (filter === "stale_preview") {
    return action.status === "stale_preview";
  }
  if (filter === "token_unavailable") {
    return action.status === "token_unavailable";
  }
  if (filter === "success") {
    return action.status === "success";
  }
  if (filter === "workflow_fix") {
    return action.actionKey === "add_needs_triage" || action.actionKey === "move_to_deferred";
  }
  if (filter === "notification") {
    return (
      action.actionKey === "acknowledge_notification" ||
      action.actionKey === "retry_notification" ||
      action.actionKey === "send_test_notification"
    );
  }
  return true;
}

function prHasFailedCi(pr: PendingPrView): boolean {
  return ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState ?? "");
}

function prHasRequestChanges(pr: PendingPrView): boolean {
  return pr.reviewDecision === "changes_requested" || pr.latestReviewState === "changes_requested";
}

function prHasConflict(pr: PendingPrView): boolean {
  return pr.mergeStateStatus === "dirty";
}

function prIssueRelationshipComplete(pr: PendingPrView): boolean {
  return pr.isComplete && pr.detailSyncedAt !== null && pr.detailError === null;
}

function prHasNoLinkedIssue(pr: PendingPrView): boolean {
  return pr.linkedIssueNumbers.length === 0 && prIssueRelationshipComplete(pr);
}

function prIssueLinkUnknown(pr: PendingPrView): boolean {
  return pr.linkedIssueNumbers.length === 0 && !prIssueRelationshipComplete(pr);
}

function prEvidencePending(pr: PendingPrView): boolean {
  return !pr.isComplete || pr.detailSyncedAt === null || pr.detailError !== null;
}

function prHasActiveIssue(pr: PendingPrView, criticalIssuesByPr: Map<number, PrCriticalIssueContext[]>): boolean {
  return (criticalIssuesByPr.get(pr.number)?.length ?? 0) > 0;
}

function prMatchesScope(
  pr: PendingPrView,
  scopeFilter: PrScopeFilter,
  criticalIssuesByPr: Map<number, PrCriticalIssueContext[]> = new Map()
): boolean {
  if (scopeFilter === "active_issue") {
    return prHasActiveIssue(pr, criticalIssuesByPr);
  }
  if (scopeFilter === "attention") {
    return pr.attentionFlags.length > 0;
  }
  if (scopeFilter === "testing") {
    return isTestingQueuePr(pr);
  }
  if (scopeFilter === "stale_testing") {
    return isTestingStalePr(pr);
  }
  if (scopeFilter === "testing_evidence_gap") {
    return isTestingEvidenceGapPr(pr);
  }
  if (scopeFilter === "ci_failed") {
    return prHasFailedCi(pr);
  }
  if (scopeFilter === "request_changes") {
    return prHasRequestChanges(pr);
  }
  if (scopeFilter === "conflict") {
    return prHasConflict(pr);
  }
  if (scopeFilter === "no_issue") {
    return prHasNoLinkedIssue(pr);
  }
  if (scopeFilter === "issue_link_pending") {
    return prIssueLinkUnknown(pr);
  }
  if (scopeFilter === "evidence_pending") {
    return prEvidencePending(pr);
  }
  if (scopeFilter === "no_action_24h") {
    return pr.attentionFlags.includes("no_human_action_24h");
  }
  return true;
}

function filterPendingPrs(
  prs: PendingPrView[],
  scopeFilter: PrScopeFilter,
  criticalIssuesByPr: Map<number, PrCriticalIssueContext[]> = new Map()
): PendingPrView[] {
  return prs.filter((pr) => prMatchesScope(pr, scopeFilter, criticalIssuesByPr));
}

function peopleScopeLabel(filter: PeopleScopeFilter): string {
  if (filter === "critical") {
    return "s-1/s0";
  }
  if (filter === "attention") {
    return "PR attention";
  }
  if (filter === "triage") {
    return "needs triage";
  }
  if (filter === "deferred") {
    return "deferred";
  }
  if (filter === "pending_pr") {
    return "pending PR";
  }
  if (filter === "testing") {
    return "issue testing";
  }
  if (filter === "yesterday_pr") {
    return "yesterday PR";
  }
  return "all watched";
}

function personalTestingStaleCount(person: PersonalActionView): number {
  return person.testingIssues.filter(isTestingIssueStale).length;
}

function peopleScopeForPersonalMetric(filter: PersonalDrilldownFilter): PeopleScopeFilter {
  if (filter === "active_issues") {
    return "critical";
  }
  if (filter === "pr_attention") {
    return "attention";
  }
  if (filter === "pending_pr") {
    return "pending_pr";
  }
  if (filter === "testing") {
    return "testing";
  }
  if (filter === "triage") {
    return "triage";
  }
  if (filter === "deferred") {
    return "deferred";
  }
  if (filter === "yesterday_pr") {
    return "yesterday_pr";
  }
  return "all";
}

interface PersonCardFocus {
  title: string;
  detail: string;
  metric: PersonalDrilldownFilter;
  tone: "critical" | "attention" | "normal" | "clear";
}

function personCardFocus(person: PersonSummary, personal: PersonalActionView | undefined): PersonCardFocus {
  const testingWork = personal ? personalTestingWorkCount(personal) : 0;
  const staleTestingWork = personal ? personalTestingStaleCount(personal) : 0;
  const yesterdayPrs = person.prsCreatedYesterday + person.prsMergedYesterday;

  if (person.activeCriticalIssues > 0) {
    return {
      title: "Drive active s-1/s0",
      detail: `${person.activeCriticalIssues} issues, ${person.attentionPrs} PR blockers, ${testingWork} issue tests`,
      metric: "active_issues",
      tone: "critical"
    };
  }
  if (person.attentionPrs > 0) {
    return {
      title: "Unblock PR rotation",
      detail: `${person.attentionPrs} attention PRs, ${person.pendingPrs} pending PRs`,
      metric: "pr_attention",
      tone: "attention"
    };
  }
  if (staleTestingWork > 0) {
    return {
      title: "Move issue testing",
      detail: `${staleTestingWork} waiting over 24h, ${testingWork} issues in test`,
      metric: "testing",
      tone: "attention"
    };
  }
  if (person.needsTriageIssues > 0) {
    return {
      title: "Triage candidate issues",
      detail: "Decide active s-1/s0 or defer with a reason",
      metric: "triage",
      tone: "attention"
    };
  }
  if (person.pendingPrs > 0) {
    return {
      title: "Review pending PR flow",
      detail: `${person.pendingPrs} pending PRs, ${yesterdayPrs} PRs yesterday`,
      metric: "pending_pr",
      tone: "normal"
    };
  }
  if (testingWork > 0) {
    return {
      title: "Track issue test result",
      detail: `${testingWork} issues assigned to testing`,
      metric: "testing",
      tone: "normal"
    };
  }
  if (person.deferredIssues > 0) {
    return {
      title: "Review deferred queue",
      detail: `${person.deferredIssues} deferred issues need a clear reason`,
      metric: "deferred",
      tone: "normal"
    };
  }
  if (yesterdayPrs > 0) {
    return {
      title: "Review recent PR activity",
      detail: `${person.prsCreatedYesterday} created, ${person.prsMergedYesterday} merged yesterday`,
      metric: "yesterday_pr",
      tone: "normal"
    };
  }
  return {
    title: "No watched blocker",
    detail: "Open the personal workbench for visible threads and history",
    metric: "threads",
    tone: "clear"
  };
}

function observedPersonPreview(data: DashboardSummary, login: string): ObservedPersonPreview | null {
  const summary = observedPeopleFromDashboard({
    criticalIssues: data.criticalIssues,
    pendingPrs: data.pendingPrs
  }).find((person) => person.login === login);

  if (!summary) {
    return null;
  }

  const criticalIssuesByPr = criticalIssueContextsByPullRequest(data.criticalIssues);
  const issues = sortCriticalIssuesForAction(data.criticalIssues.filter((issue) => issue.ownerLogin === login));
  const prs = sortPendingPrsForAction(
    data.pendingPrs.filter((pr) => pr.ownerLogin === login),
    criticalIssuesByPr
  );

  return {
    login,
    summary,
    threads: observedOwnerThreads(issues, prs),
    issues,
    prs
  };
}

function CriticalIssueFilterBar({
  issues,
  aiFilter,
  scopeFilter,
  onAiFilterChange,
  onScopeFilterChange
}: {
  issues: CriticalIssueView[];
  aiFilter: CriticalIssueAiFilter;
  scopeFilter: CriticalIssueScopeFilter;
  onAiFilterChange: (value: CriticalIssueAiFilter) => void;
  onScopeFilterChange: (value: CriticalIssueScopeFilter) => void;
}) {
  return (
    <div className="board-filter-bar" aria-label="Critical issue filters">
      <div className="board-filter-group">
        <Text type="secondary">Scope</Text>
        <Segmented
          size="small"
          value={scopeFilter}
          onChange={(value) => onScopeFilterChange(value as CriticalIssueScopeFilter)}
          options={[
            { label: "All", value: "all" },
            { label: "s-1", value: "s-1" },
            { label: "s0", value: "s0" },
            { label: "No PR", value: "no_pr" },
            { label: "Owner gap", value: "owner_gap" },
            { label: "No timeline", value: "timeline_missing" },
            { label: "Skipped", value: "skipped" }
          ]}
        />
      </div>
      <div className="board-filter-group">
        <Text type="secondary">AI</Text>
        <Segmented
          size="small"
          value={aiFilter}
          onChange={(value) => onAiFilterChange(String(value))}
          options={criticalIssueAiOptions(issues)}
        />
      </div>
    </div>
  );
}

function PrFilterBar({
  scopeFilter,
  onScopeFilterChange
}: {
  scopeFilter: PrScopeFilter;
  onScopeFilterChange: (value: PrScopeFilter) => void;
}) {
  const scopeHelp = prScopeHelp(scopeFilter);

  return (
    <div className="board-filter-bar" aria-label="Pending PR filters">
      <div className="board-filter-group">
        <Text type="secondary">Scope</Text>
        <Segmented
          size="small"
          value={scopeFilter}
          onChange={(value) => onScopeFilterChange(value as PrScopeFilter)}
          options={[
            { label: "All", value: "all" },
            { label: "Active issue", value: "active_issue" },
            { label: "Attention", value: "attention" },
            { label: "Issue in test", value: "testing" },
            { label: "Stale test", value: "stale_testing" },
            { label: "Test evidence gap", value: "testing_evidence_gap" },
            { label: "CI failed", value: "ci_failed" },
            { label: "Request change", value: "request_changes" },
            { label: "Conflict", value: "conflict" },
            { label: "No issue after sync", value: "no_issue" },
            { label: "Issue link syncing", value: "issue_link_pending" },
            { label: "PR detail pending", value: "evidence_pending" },
            { label: "No action 24h", value: "no_action_24h" }
          ]}
        />
      </div>
      {scopeHelp ? (
        <Text type="secondary" className="board-filter-help">
          {scopeHelp}
        </Text>
      ) : null}
    </div>
  );
}

function PeopleFilterBar({
  scopeFilter,
  onScopeFilterChange
}: {
  scopeFilter: PeopleScopeFilter;
  onScopeFilterChange: (value: PeopleScopeFilter) => void;
}) {
  return (
    <div className="board-filter-bar" aria-label="People filters">
      <div className="board-filter-group">
        <Text type="secondary">Scope</Text>
        <Segmented
          size="small"
          value={scopeFilter}
          onChange={(value) => onScopeFilterChange(value as PeopleScopeFilter)}
          options={[
            { label: "All", value: "all" },
            { label: "s-1/s0", value: "critical" },
            { label: "PR attention", value: "attention" },
            { label: "Triage", value: "triage" },
            { label: "Deferred", value: "deferred" },
            { label: "Pending PR", value: "pending_pr" },
            { label: "Issue in test", value: "testing" },
            { label: "Yesterday PR", value: "yesterday_pr" }
          ]}
        />
      </div>
    </div>
  );
}

function TeamRotationOverview({
  data,
  session,
  flowSummary,
  trendPoints,
  analyticsPeriod,
  onAnalyticsPeriodChange,
  onNavigate,
  onConnectToken,
  onPersonSelect,
  criticalAiFilter,
  criticalScopeFilter,
  onCriticalAiFilterChange,
  onCriticalScopeFilterChange,
  onOpenIssuesFilter,
  onOpenPrsFilter,
  onOpenPeopleFilter
}: {
  data: DashboardSummary;
  session: SessionView | null;
  flowSummary: FlowEfficiencySummary | null;
  trendPoints: TrendMetricPoint[];
  analyticsPeriod: MetricPeriod;
  onAnalyticsPeriodChange: (period: MetricPeriod) => void;
  onNavigate: (view: DashboardView) => void;
  onConnectToken: () => void;
  onPersonSelect: (login: string) => void;
  criticalAiFilter: CriticalIssueAiFilter;
  criticalScopeFilter: CriticalIssueScopeFilter;
  onCriticalAiFilterChange: (value: CriticalIssueAiFilter) => void;
  onCriticalScopeFilterChange: (value: CriticalIssueScopeFilter) => void;
  onOpenIssuesFilter: (filters: Partial<{ ai: CriticalIssueAiFilter; scope: CriticalIssueScopeFilter }>) => void;
  onOpenPrsFilter: (scope: PrScopeFilter) => void;
  onOpenPeopleFilter: (scope: PeopleScopeFilter) => void;
}) {
  const criticalIssues = sortCriticalIssuesForAction(
    filterCriticalIssues(data.criticalIssues, criticalAiFilter, criticalScopeFilter)
  );
  const criticalIssuesByPr = useMemo(
    () => criticalIssueContextsByPullRequest(data.criticalIssues),
    [data.criticalIssues]
  );
  const prRisks = sortPendingPrsForAction(data.pendingPrs, criticalIssuesByPr);
  const criticalIssueOrder = new Map(criticalIssues.map((issue, index) => [issue.number, index]));
  const criticalFlowRows = observedOwnerThreads(criticalIssues, data.pendingPrs)
    .filter((thread) => thread.issue !== null)
    .sort(
      (left, right) =>
        (criticalIssueOrder.get(left.issue?.number ?? -1) ?? Number.MAX_SAFE_INTEGER) -
        (criticalIssueOrder.get(right.issue?.number ?? -1) ?? Number.MAX_SAFE_INTEGER)
    );
  const testingIssues = sortTestingIssuesForAction(data.testing.issues);
  const observedPeople = observedPeopleFromDashboard({
    criticalIssues: data.criticalIssues,
    pendingPrs: data.pendingPrs
  });
  const peopleSource = data.people.length > 0 ? data.people : observedPeople;
  const peopleSourceIsObserved = data.people.length === 0 && observedPeople.length > 0;
  const peopleFocus = sortPeopleForTeamFocus(peopleSource, data.personalViews).slice(0, 6);
  const sMinusOneIssues = data.criticalIssues.filter((issue) => issue.severity === "severity/s-1").length;
  const triageSnapshot = teamTriageSnapshot(data);
  const teamFocus = teamPrimaryFocus(data, sMinusOneIssues);
  const updatePipeline = summarizeUpdatePipeline(data);
  const productionReadiness = summarizeProductionReadiness({ data, session });
  const commandActions = teamCommandActions({
    data,
    sMinusOneIssues,
    prRisks,
    testingIssues,
    peopleFocus,
    updatePipeline,
    productionReadiness,
    onNavigate,
    onConnectToken,
    onOpenIssuesFilter,
    onOpenPrsFilter,
    onOpenPeopleFilter
  });
  const [workPreview, setWorkPreview] = useState<TeamWorkPreview | null>(null);
  const [testingPreviewIssue, setTestingPreviewIssue] = useState<TestingIssueQueueView | null>(null);

  return (
    <div className="team-overview">
      <section className="team-command-panel">
        <div className="team-command-heading">
          <div>
            <Title level={4}>Team Flow Monitor</Title>
            <Text type="secondary">
              Generated {formatDate(data.sync.generatedAt)} | {data.repo.timezone}
            </Text>
          </div>
          <Space size={[6, 6]} wrap>
            <button
              type="button"
              className={`inline-filter-chip ${sMinusOneIssues > 0 ? "inline-filter-chip-red" : ""}`}
              onClick={() => onOpenIssuesFilter({ scope: "s-1" })}
            >
              {sMinusOneIssues} s-1
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${data.counts.criticalIssues > 0 ? "inline-filter-chip-red" : ""}`}
              onClick={() => onOpenIssuesFilter({ scope: "all" })}
            >
              {data.counts.criticalIssues} active s-1/s0
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${data.counts.attentionPrs > 0 ? "" : "inline-filter-chip-muted"}`}
              onClick={() => onOpenPrsFilter("attention")}
            >
              {data.counts.attentionPrs} PR attention
            </button>
          </Space>
        </div>
        <div className="team-focus-callout">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <Text strong>{teamFocus.title}</Text>
            <span>{teamFocus.detail}</span>
          </div>
        </div>
        <TeamHealthStrip
          data={data}
          flowSummary={flowSummary}
          triageSnapshot={triageSnapshot}
          onOpenIssuesFilter={onOpenIssuesFilter}
          onOpenPrsFilter={onOpenPrsFilter}
          onOpenPeopleFilter={onOpenPeopleFilter}
        />
        <TeamCommandQueue actions={commandActions} />
        <TeamFlowRiskStrip
          data={data}
          onNavigate={onNavigate}
          onOpenIssuesFilter={onOpenIssuesFilter}
          onOpenPrsFilter={onOpenPrsFilter}
        />
        <TeamUpdatePipelineStrip summary={updatePipeline} onNavigate={onNavigate} />
        <ProductionReadinessStrip
          summary={productionReadiness}
          compact
          onNavigate={onNavigate}
          onConnectToken={onConnectToken}
        />
      </section>

      <TeamCriticalFlowPanel
        rows={criticalFlowRows}
        onOpenIssues={() => onOpenIssuesFilter({})}
        onOpenNoPrIssues={() => onOpenIssuesFilter({ scope: "no_pr" })}
        onOpenPrRisks={() => onOpenPrsFilter("attention")}
        onPreviewIssue={(issue) => setWorkPreview({ objectType: "issue", issue })}
      />

      <div className="team-rotation-grid">
        <div className="team-rotation-main">
          <TeamRotationLane
            title={`Critical Issue Rotation (${criticalScopeLabel(criticalScopeFilter)}, ${criticalAiFilter === "all" ? "all AI" : criticalAiFilter})`}
            count={criticalIssues.length}
            visibleCount={Math.min(criticalIssues.length, 6)}
            overflowLabel={criticalOverflowLabel(criticalScopeFilter)}
            actionLabel="Open Issues"
            tone="critical"
            onAction={() => onOpenIssuesFilter({})}
            controls={
              <CriticalIssueFilterBar
                issues={data.criticalIssues}
                aiFilter={criticalAiFilter}
                scopeFilter={criticalScopeFilter}
                onAiFilterChange={onCriticalAiFilterChange}
                onScopeFilterChange={onCriticalScopeFilterChange}
              />
            }
          >
            {criticalIssues.slice(0, 6).map((issue) => (
              <TeamCriticalIssueRow issue={issue} key={issue.number} onPreview={setWorkPreview} />
            ))}
          </TeamRotationLane>
          <TeamRotationLane
            title="PR Rotation Risks"
            count={data.counts.attentionPrs}
            visibleCount={Math.min(prRisks.length, 6)}
            overflowLabel="PRs needing attention"
            actionLabel="Open PRs"
            tone="attention"
            onAction={() => onOpenPrsFilter("attention")}
          >
            {prRisks.slice(0, 6).map((pr) => (
              <TeamPrRiskRow
                activeIssues={criticalIssuesByPr.get(pr.number) ?? []}
                pr={pr}
                key={pr.number}
                onPreview={setWorkPreview}
              />
            ))}
          </TeamRotationLane>
          <TeamRotationLane
            title="Issues Waiting For Test"
            count={data.testing.queueIssues}
            visibleCount={Math.min(testingIssues.length, 5)}
            overflowLabel="issues in test"
            actionLabel="Open Testing"
            tone={data.testing.staleQueueIssues > 0 ? "critical" : "attention"}
            onAction={() => onOpenPrsFilter("testing")}
          >
            {testingIssues.slice(0, 5).map((issue) => (
              <TeamTestingIssueRow issue={issue} key={issue.number} onPreview={setTestingPreviewIssue} />
            ))}
          </TeamRotationLane>
        </div>

        <aside className="team-rotation-side">
          <TeamPeopleFocus
            people={peopleFocus}
            personalViews={data.personalViews}
            observedMode={peopleSourceIsObserved}
            onPersonSelect={peopleSourceIsObserved ? () => onOpenPeopleFilter("attention") : onPersonSelect}
          />
          <TeamOpsStatus data={data} onNavigate={onNavigate} />
        </aside>
      </div>

      <TeamWorkPreviewModal preview={workPreview} onClose={() => setWorkPreview(null)} />
      <TestingIssuePreviewModal issue={testingPreviewIssue} onClose={() => setTestingPreviewIssue(null)} />

      <section className="section team-flow-section">
        <div className="section-heading">
          <div>
            <Title level={4}>Flow Efficiency</Title>
            <Text type="secondary">
              Last {data.analytics.periodDays} days, grouped {metricPeriodText(analyticsPeriod)}
            </Text>
          </div>
          <Space size={[6, 6]} wrap>
            <Segmented
              value={analyticsPeriod}
              onChange={(value) => onAnalyticsPeriodChange(value as MetricPeriod)}
              options={metricPeriodOptions}
            />
            <Button size="small" onClick={() => onNavigate("Analytics")}>
              Open Analytics
            </Button>
          </Space>
        </div>
        {flowSummary ? (
          <FlowEfficiencyStrip
            summary={flowSummary}
            actions={{
              prFlow: () => onOpenPrsFilter("all"),
              issueDrain: () => onOpenIssuesFilter({}),
              triageFlow: () => onOpenPeopleFilter("triage"),
              pendingPrAge: () => onOpenPrsFilter("all"),
              prAttention: () => onOpenPrsFilter("attention"),
              activeCriticalAge: () => onOpenIssuesFilter({}),
              testingQueue: () => onOpenPrsFilter("testing"),
              workflowViolations: () => onNavigate("Violations")
            }}
          />
        ) : null}
        <TrendChart points={trendPoints} />
      </section>
    </div>
  );
}

interface TeamCommandAction {
  key: string;
  title: string;
  detail: string;
  tone: "critical" | "attention" | "normal" | "good";
  actionLabel: string;
  priority: number;
  onClick: () => void;
}

function teamCommandActions({
  data,
  sMinusOneIssues,
  prRisks,
  testingIssues,
  peopleFocus,
  updatePipeline,
  productionReadiness,
  onNavigate,
  onConnectToken,
  onOpenIssuesFilter,
  onOpenPrsFilter,
  onOpenPeopleFilter
}: {
  data: DashboardSummary;
  sMinusOneIssues: number;
  prRisks: PendingPrView[];
  testingIssues: TestingIssueQueueView[];
  peopleFocus: PersonSummary[];
  updatePipeline: UpdatePipelineSummary;
  productionReadiness: ProductionReadinessSummary;
  onNavigate: (view: DashboardView) => void;
  onConnectToken: () => void;
  onOpenIssuesFilter: (filters: Partial<{ ai: CriticalIssueAiFilter; scope: CriticalIssueScopeFilter }>) => void;
  onOpenPrsFilter: (scope: PrScopeFilter) => void;
  onOpenPeopleFilter: (scope: PeopleScopeFilter) => void;
}): TeamCommandAction[] {
  const sMinusOneRows = data.criticalIssues.filter((issue) => issue.severity === "severity/s-1");
  const issuesWithoutPr = data.criticalIssues.filter((issue) => issue.linkedPullRequests.length === 0);
  const staleActiveIssues = data.criticalIssues.filter((issue) => (issue.criticalAgeHours ?? issue.ageHours) >= 72);
  const blockerPrs = prRisks.filter((pr) => prAttentionReasons(pr).length > 0);
  const staleTestingRows = testingIssues.filter(
    (issue) => (issue.queueAgeHours ?? 0) >= 24 || issue.syncError !== null
  );
  const triageSnapshot = teamTriageSnapshot(data);
  const triageHeavy = triageSnapshot.needsTriageIssues > data.counts.criticalIssues && data.counts.criticalIssues <= 1;
  const criticalPeople = peopleFocus.filter((person) => person.activeCriticalIssues > 0 || person.attentionPrs > 0);
  const actions: TeamCommandAction[] = [];

  if (sMinusOneIssues > 0) {
    actions.push({
      key: "s-1",
      title: `${sMinusOneIssues} s-1 issues need movement`,
      detail: `oldest ${optionalHours(maxCriticalActiveAge(sMinusOneRows))}; verify owner, linked PR, and blocker state`,
      tone: "critical",
      actionLabel: "Open s-1",
      priority: 1_000,
      onClick: () => onOpenIssuesFilter({ scope: "s-1" })
    });
  }
  if (issuesWithoutPr.length > 0) {
    actions.push({
      key: "issue-pr-gap",
      title: `${issuesWithoutPr.length} active issues have no visible PR`,
      detail: "confirm whether execution started, or link the PR evidence",
      tone: "critical",
      actionLabel: "Open gaps",
      priority: 940,
      onClick: () => onOpenIssuesFilter({ scope: "no_pr" })
    });
  }
  if (staleActiveIssues.length > 0) {
    actions.push({
      key: "stale-active-issues",
      title: `${staleActiveIssues.length} active s-1/s0 issues have aged over 3 days`,
      detail: `oldest ${optionalHours(maxCriticalActiveAge(staleActiveIssues))}; check owner activity, linked PR, and next action`,
      tone: "critical",
      actionLabel: "Open active",
      priority: 920,
      onClick: () => onOpenIssuesFilter({})
    });
  }
  if (blockerPrs.length > 0) {
    actions.push({
      key: "pr-blockers",
      title: `${blockerPrs.length} PRs need attention`,
      detail: `oldest ${optionalHours(maxPendingPrAge(blockerPrs))}; review CI, requested changes, conflict, or idle state`,
      tone: "attention",
      actionLabel: "Open PRs",
      priority: 900,
      onClick: () => onOpenPrsFilter("attention")
    });
  }
  if (triageHeavy) {
    actions.push({
      key: "triage-heavy",
      title: `${triageSnapshot.needsTriageIssues} needs-triage issues are not being converted`,
      detail: `${data.counts.criticalIssues} active s-1/s0; ${triageSnapshot.deferredIssues} deferred; classify, start, or defer`,
      tone: "attention",
      actionLabel: "Open people",
      priority: 880,
      onClick: () => onOpenPeopleFilter("triage")
    });
  }
  if (staleTestingRows.length > 0) {
    actions.push({
      key: "testing-waits",
      title: `${staleTestingRows.length} issues are waiting in test`,
      detail: `max ${optionalHours(maxTestingIssueAge(staleTestingRows))}; check issue assignment and linked PR evidence`,
      tone: "attention",
      actionLabel: "Open testing",
      priority: 860,
      onClick: () => onOpenPrsFilter("stale_testing")
    });
  }
  if (criticalPeople.length > 0) {
    actions.push({
      key: "people-focus",
      title: `${criticalPeople.length} people carry active risk`,
      detail: "open People to compare owner load and drill into personal workbench",
      tone: "normal",
      actionLabel: "Open people",
      priority: 760,
      onClick: () => onOpenPeopleFilter("critical")
    });
  }

  for (const signal of teamCommandSignals({
    counts: data.counts,
    notifications: {
      failedDeliveries: data.notifications.failedDeliveries,
      unacknowledgedDeliveries: data.notifications.unacknowledgedDeliveries,
      escalationPendingDeliveries: data.notifications.escalationPendingDeliveries,
      readinessStatus: data.notifications.readiness.status
    }
  })) {
    actions.push({
      key: signal.key,
      title: signal.title,
      detail: signal.detail,
      tone: signal.tone,
      actionLabel: teamCommandSignalActionLabel(signal.target),
      priority: signal.priority,
      onClick: () => onNavigate(teamCommandSignalTargetView(signal.target))
    });
  }

  if (productionReadiness.blockers.length > 0) {
    const blocker = productionReadiness.blockers[0];
    actions.push({
      key: "production-readiness",
      title: `${productionReadiness.blockers.length} production readiness blockers`,
      detail: `${blocker.label}: ${blocker.action}`,
      tone: "attention",
      actionLabel: "Open gate",
      priority: 700,
      onClick: () => openProductionReadinessTarget(blocker.target, onNavigate, onConnectToken)
    });
  } else if (updatePipeline.tone === "critical" || updatePipeline.tone === "attention") {
    actions.push({
      key: "update-pipeline",
      title: updatePipeline.title,
      detail: updatePipeline.detail,
      tone: updatePipeline.tone === "critical" ? "critical" : "attention",
      actionLabel: "Open health",
      priority: 640,
      onClick: () => onNavigate("Health")
    });
  }

  if (actions.length === 0) {
    actions.push({
      key: "analytics",
      title: "No urgent blocker in cached data",
      detail: "review trend charts and spot throughput changes before they become backlog",
      tone: "good",
      actionLabel: "Open analytics",
      priority: 100,
      onClick: () => onNavigate("Analytics")
    });
  }

  return actions.sort((left, right) => right.priority - left.priority).slice(0, 4);
}

function teamCommandSignalActionLabel(target: TeamCommandSignalTarget): string {
  if (target === "violations") {
    return "Open violations";
  }
  if (target === "drift") {
    return "Open drift";
  }
  return "Open notifications";
}

function teamCommandSignalTargetView(target: TeamCommandSignalTarget): DashboardView {
  if (target === "violations") {
    return "Violations";
  }
  if (target === "drift") {
    return "Drift";
  }
  return "Notifications";
}

function TeamCommandQueue({ actions }: { actions: TeamCommandAction[] }) {
  return (
    <div className="team-command-queue" aria-label="Team command queue">
      {actions.map((action, index) => (
        <button
          type="button"
          className={`team-command-action team-command-action-${action.tone}`}
          onClick={action.onClick}
          key={action.key}
        >
          <span className="team-command-action-rank">{index + 1}</span>
          <span className="team-command-action-copy">
            <strong>{action.title}</strong>
            <small>{action.detail}</small>
          </span>
          <span className="team-command-action-open">{action.actionLabel}</span>
        </button>
      ))}
    </div>
  );
}

interface TeamTriageSnapshot {
  needsTriageIssues: number;
  deferredIssues: number;
  peopleWithNeedsTriage: number;
  peopleWithDeferred: number;
}

function teamTriageSnapshot(data: DashboardSummary): TeamTriageSnapshot {
  if (data.personalViews.length > 0) {
    const needsTriageIssues = new Set<number>();
    const deferredIssues = new Set<number>();
    let peopleWithNeedsTriage = 0;
    let peopleWithDeferred = 0;

    for (const person of data.personalViews) {
      if (person.needsTriageIssues.length > 0) {
        peopleWithNeedsTriage += 1;
      }
      if (person.deferredIssues.length > 0) {
        peopleWithDeferred += 1;
      }
      for (const issue of person.needsTriageIssues) {
        needsTriageIssues.add(issue.number);
      }
      for (const issue of person.deferredIssues) {
        deferredIssues.add(issue.number);
      }
    }

    return {
      needsTriageIssues: needsTriageIssues.size,
      deferredIssues: deferredIssues.size,
      peopleWithNeedsTriage,
      peopleWithDeferred
    };
  }

  return {
    needsTriageIssues: data.people.reduce((total, person) => total + person.needsTriageIssues, 0),
    deferredIssues: data.people.reduce((total, person) => total + person.deferredIssues, 0),
    peopleWithNeedsTriage: data.people.filter((person) => person.needsTriageIssues > 0).length,
    peopleWithDeferred: data.people.filter((person) => person.deferredIssues > 0).length
  };
}

interface TeamPrBlockerSnapshot {
  ciFailed: number;
  requestedChanges: number;
  conflicts: number;
  idle: number;
}

function teamPrBlockerSnapshot(prs: PendingPrView[]): TeamPrBlockerSnapshot {
  return {
    ciFailed: prs.filter(prHasFailedCi).length,
    requestedChanges: prs.filter(prHasRequestChanges).length,
    conflicts: prs.filter(prHasConflict).length,
    idle: prs.filter((pr) => pr.attentionFlags.includes("no_human_action_24h")).length
  };
}

function teamPrBlockerDetail(snapshot: TeamPrBlockerSnapshot): string {
  const parts = [
    snapshot.ciFailed > 0 ? `${snapshot.ciFailed} CI` : null,
    snapshot.requestedChanges > 0 ? `${snapshot.requestedChanges} changes` : null,
    snapshot.conflicts > 0 ? `${snapshot.conflicts} conflicts` : null,
    snapshot.idle > 0 ? `${snapshot.idle} idle` : null
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "no blockers" : parts.slice(0, 3).join(" | ");
}

function TeamHealthStrip({
  data,
  flowSummary,
  triageSnapshot,
  onOpenIssuesFilter,
  onOpenPrsFilter,
  onOpenPeopleFilter
}: {
  data: DashboardSummary;
  flowSummary: FlowEfficiencySummary | null;
  triageSnapshot: TeamTriageSnapshot;
  onOpenIssuesFilter: (filters: Partial<{ ai: CriticalIssueAiFilter; scope: CriticalIssueScopeFilter }>) => void;
  onOpenPrsFilter: (scope: PrScopeFilter) => void;
  onOpenPeopleFilter: (scope: PeopleScopeFilter) => void;
}) {
  const staleActiveIssues = data.criticalIssues.filter((issue) => (issue.criticalAgeHours ?? issue.ageHours) >= 72);
  const issuesWithoutPr = data.criticalIssues.filter((issue) => issue.linkedPullRequests.length === 0);
  const prBlockers = teamPrBlockerSnapshot(data.pendingPrs);
  const testingCloseText =
    data.testing.averageHandoffToCloseHours === null
      ? `${data.testing.handoffToCloseSamples} close samples`
      : `close ${optionalHours(data.testing.averageHandoffToCloseHours)} (${data.testing.handoffToCloseSamples})`;
  const triageHeavy = triageSnapshot.needsTriageIssues > data.counts.criticalIssues && data.counts.criticalIssues <= 1;

  return (
    <div className="team-health-strip" aria-label="Team workflow health">
      <TeamMonitorTile
        label="Issue consumption"
        value={data.counts.criticalIssues}
        detail={`${staleActiveIssues.length} >3d | ${issuesWithoutPr.length} no PR | avg ${optionalHours(
          flowSummary?.averageActiveIssueAgeHours ?? null
        )}`}
        tone={staleActiveIssues.length > 0 || issuesWithoutPr.length > 0 ? "critical" : "good"}
        onClick={() => onOpenIssuesFilter({ scope: issuesWithoutPr.length > 0 ? "no_pr" : "all" })}
      />
      <TeamMonitorTile
        label="PR pushing"
        value={data.counts.attentionPrs}
        detail={`${data.counts.pendingPrs} pending | ${teamPrBlockerDetail(prBlockers)} | avg ${optionalHours(
          flowSummary?.averagePendingPrAgeHours ?? null
        )}`}
        tone={data.counts.attentionPrs > 0 ? "attention" : "good"}
        onClick={() => onOpenPrsFilter(data.counts.attentionPrs > 0 ? "attention" : "all")}
      />
      <TeamMonitorTile
        label="Testing validation"
        value={data.testing.queueIssues}
        detail={`${data.testing.staleQueueIssues} >24h | avg wait ${optionalHours(
          data.testing.averageIssueQueueAgeHours
        )} | ${testingCloseText}`}
        tone={data.testing.staleQueueIssues > 0 ? "critical" : data.testing.queueIssues > 0 ? "attention" : "good"}
        onClick={() => onOpenPrsFilter(data.testing.staleQueueIssues > 0 ? "stale_testing" : "testing")}
      />
      <TeamMonitorTile
        label="Triage decisions"
        value={triageSnapshot.needsTriageIssues}
        detail={`${triageSnapshot.peopleWithNeedsTriage} people | ${data.counts.criticalIssues} active | ${triageSnapshot.deferredIssues} deferred`}
        tone={triageHeavy || triageSnapshot.needsTriageIssues > 0 ? "attention" : "good"}
        onClick={() => onOpenPeopleFilter(triageSnapshot.needsTriageIssues > 0 ? "triage" : "deferred")}
      />
    </div>
  );
}

function TeamFlowRiskStrip({
  data,
  onNavigate,
  onOpenIssuesFilter,
  onOpenPrsFilter
}: {
  data: DashboardSummary;
  onNavigate: (view: DashboardView) => void;
  onOpenIssuesFilter: (filters: Partial<{ ai: CriticalIssueAiFilter; scope: CriticalIssueScopeFilter }>) => void;
  onOpenPrsFilter: (scope: PrScopeFilter) => void;
}) {
  const sMinusOneIssues = data.criticalIssues.filter((issue) => issue.severity === "severity/s-1");
  const prBlockers = data.pendingPrs.filter(
    (pr) =>
      prHasFailedCi(pr) ||
      prHasRequestChanges(pr) ||
      prHasConflict(pr) ||
      pr.attentionFlags.includes("no_human_action_24h")
  );
  const dataRiskCount = data.sync.staleObjects + data.sync.partialObjects;
  const dataRiskTone = data.sync.worker.status === "failed" || data.sync.staleObjects > 0 ? "attention" : "normal";

  return (
    <div className="team-flow-risk-strip" aria-label="Team flow risk shortcuts">
      <TeamFlowRiskCard
        label="Highest priority"
        value={sMinusOneIssues.length}
        detail={`oldest ${optionalHours(maxCriticalActiveAge(sMinusOneIssues))}`}
        tone={sMinusOneIssues.length > 0 ? "critical" : "good"}
        action="Open s-1"
        onClick={() => onOpenIssuesFilter({ scope: "s-1" })}
      />
      <TeamFlowRiskCard
        label="PR blockers"
        value={prBlockers.length}
        detail={`${data.counts.pendingPrs} pending | oldest ${optionalHours(maxPendingPrAge(prBlockers))}`}
        tone={prBlockers.length > 0 ? "attention" : "good"}
        action="Open PR risks"
        onClick={() => onOpenPrsFilter("attention")}
      />
      <TeamFlowRiskCard
        label="Issue test waits"
        value={data.testing.staleQueueIssues}
        detail={`${data.testing.queueIssues} issues in test | max ${optionalHours(maxTestingIssueAge(data.testing.issues))}`}
        tone={data.testing.staleQueueIssues > 0 ? "critical" : data.testing.queueIssues > 0 ? "attention" : "good"}
        action="Open test queue"
        onClick={() => onOpenPrsFilter("stale_testing")}
      />
      <TeamFlowRiskCard
        label="Data risk"
        value={dataRiskCount}
        detail={`${data.sync.staleObjects} stale | ${data.sync.partialObjects} incomplete | ${labelText(
          data.sync.worker.status
        )}`}
        tone={dataRiskCount > 0 || data.sync.worker.status !== "active" ? dataRiskTone : "good"}
        action="Open health"
        onClick={() => onNavigate("Health")}
      />
    </div>
  );
}

function TeamFlowRiskCard({
  label,
  value,
  detail,
  tone,
  action,
  onClick
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "critical" | "attention" | "normal" | "good";
  action: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`team-flow-risk-card team-flow-risk-${tone}`} onClick={onClick}>
      <span className="team-flow-risk-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <span className="team-flow-risk-action">{action}</span>
    </button>
  );
}

function TeamUpdatePipelineStrip({
  summary,
  onNavigate
}: {
  summary: UpdatePipelineSummary;
  onNavigate: (view: DashboardView) => void;
}) {
  return (
    <section className={`update-pipeline-strip update-pipeline-${summary.tone}`} aria-label="Update pipeline status">
      <div className="update-pipeline-heading">
        <Tag color={updatePipelineToneColor(summary.tone)}>{updatePipelineToneLabel(summary.tone)}</Tag>
        <div>
          <Text strong>{summary.title}</Text>
          <span>{summary.detail}</span>
        </div>
      </div>
      <div className="update-pipeline-mini-facts">
        {summary.tiles.map((tile) => (
          <button
            type="button"
            className={`update-pipeline-mini-fact update-pipeline-mini-fact-${tile.tone}`}
            key={tile.key}
            title={formatPipelineDetail(tile.detail)}
            onClick={() => onNavigate(updatePipelineTargetView(tile))}
          >
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProductionReadinessStrip({
  summary,
  compact = false,
  onNavigate,
  onConnectToken
}: {
  summary: ProductionReadinessSummary;
  compact?: boolean;
  onNavigate: (view: DashboardView) => void;
  onConnectToken: () => void;
}) {
  const visibleGates = compact
    ? [...summary.blockers, ...summary.waiting, ...summary.gates.filter((gate) => gate.status === "ready")].slice(0, 5)
    : summary.gates;

  return (
    <section
      className={`production-readiness production-readiness-${summary.tone} ${
        compact ? "production-readiness-compact" : ""
      }`}
      aria-label="Production readiness"
    >
      <div className="production-readiness-heading">
        <div className="production-readiness-score">
          <strong>{summary.score}</strong>
          <span>/100</span>
        </div>
        <div>
          <Space size={[6, 6]} wrap>
            <Tag color={updatePipelineToneColor(summary.tone)}>{summary.label}</Tag>
            <Text strong>{summary.title}</Text>
          </Space>
          <span>{summary.detail}</span>
        </div>
      </div>
      <div className="production-readiness-gates">
        {visibleGates.map((gate) => (
          <ProductionReadinessGateButton
            gate={gate}
            onNavigate={onNavigate}
            onConnectToken={onConnectToken}
            key={gate.key}
          />
        ))}
      </div>
      {!compact && summary.nextActions.length > 0 ? (
        <div className="production-readiness-actions">
          {summary.nextActions.map((action) => (
            <Tag color="orange" key={action}>
              {action}
            </Tag>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ProductionReadinessGateButton({
  gate,
  onNavigate,
  onConnectToken
}: {
  gate: ProductionReadinessGate;
  onNavigate: (view: DashboardView) => void;
  onConnectToken: () => void;
}) {
  return (
    <button
      type="button"
      className={`production-readiness-gate production-readiness-gate-${gate.tone}`}
      title={`${gate.detail} ${gate.action}.`}
      onClick={() => openProductionReadinessTarget(gate.target, onNavigate, onConnectToken)}
    >
      <span>{gate.label}</span>
      <strong>{gate.value}</strong>
      <small>{gate.action}</small>
    </button>
  );
}

function TeamCriticalFlowPanel({
  rows,
  onOpenIssues,
  onOpenNoPrIssues,
  onOpenPrRisks,
  onPreviewIssue
}: {
  rows: ObservedOwnerThread[];
  onOpenIssues: () => void;
  onOpenNoPrIssues: () => void;
  onOpenPrRisks: () => void;
  onPreviewIssue: (issue: CriticalIssueView) => void;
}) {
  const visibleRows = rows.slice(0, 7);
  const hiddenRows = Math.max(0, rows.length - visibleRows.length);
  const noVisiblePrRows = rows.filter((row) => row.needsLink).length;
  const blockedPrs = teamCriticalFlowBlockedPrCount(rows);

  return (
    <section className="team-critical-flow-panel" aria-label="Critical issue and PR flow">
      <div className="team-critical-flow-heading">
        <div>
          <Title level={4}>Critical Issue / PR Flow</Title>
          <Text type="secondary">Active s-1/s0 issues linked to execution PRs and current blockers.</Text>
        </div>
        <div className="team-critical-flow-counts">
          <button type="button" onClick={onOpenIssues}>
            <strong>{rows.length}</strong>
            <span>active issues</span>
          </button>
          <button type="button" className={noVisiblePrRows > 0 ? "is-attention" : ""} onClick={onOpenNoPrIssues}>
            <strong>{noVisiblePrRows}</strong>
            <span>without visible PR</span>
          </button>
          <button type="button" className={blockedPrs > 0 ? "is-attention" : ""} onClick={onOpenPrRisks}>
            <strong>{blockedPrs}</strong>
            <span>blocked PRs</span>
          </button>
        </div>
      </div>

      <div className="team-critical-flow-list">
        {visibleRows.length > 0 ? (
          visibleRows.map((row) => (
            <TeamCriticalFlowRow key={row.id} row={row} onOpenPrRisks={onOpenPrRisks} onPreviewIssue={onPreviewIssue} />
          ))
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active s-1/s0 issue matches this filter" />
        )}
      </div>

      {hiddenRows > 0 ? (
        <button type="button" className="team-critical-flow-more" onClick={onOpenIssues}>
          <span>{hiddenRows} more active issues match this filter</span>
          <strong>Open Issues</strong>
        </button>
      ) : null}
    </section>
  );
}

function TeamCriticalFlowRow({
  row,
  onOpenPrRisks,
  onPreviewIssue
}: {
  row: ObservedOwnerThread;
  onOpenPrRisks: () => void;
  onPreviewIssue: (issue: CriticalIssueView) => void;
}) {
  const issue = row.issue;
  const prs = observedThreadPullRequests(row);
  const visiblePrs = prs.slice(0, 4);
  const status = teamCriticalFlowStatus(row);

  if (!issue) {
    return null;
  }

  return (
    <article className={`team-critical-flow-row team-critical-flow-row-${row.tone}`}>
      <div className="team-critical-flow-issue">
        <div className="team-critical-flow-title-line">
          <WorkObjectLink href={issue.htmlUrl} icon={<ShieldAlert size={15} aria-hidden="true" />}>
            Issue #{issue.number}
          </WorkObjectLink>
          <Tag color={severityColor(issue.severity)}>{severityShortLabel(issue.severity)}</Tag>
          <Tag color={issue.criticalAgeHours === null ? "gold" : "red"}>{criticalIssueDuration(issue)}</Tag>
          <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag>
        </div>
        <a className="team-critical-flow-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <div className="team-critical-flow-meta">
          <Tag color={ownerScopeColor(issue.ownerScope)}>{issue.ownerLogin ?? "unowned"}</Tag>
          <span>{criticalIssueNextAction(issue)}</span>
          <span>last {formatDate(issue.lastHumanActionAt)}</span>
        </div>
      </div>

      <div className="team-critical-flow-prs">
        <div className="team-critical-flow-pr-heading">
          <Tag color={status.color}>{status.label}</Tag>
          <span>{status.detail}</span>
        </div>
        <div className="team-critical-flow-pr-list">
          {visiblePrs.length > 0 ? (
            visiblePrs.map((pr) => {
              const reasons = prAttentionReasons(pr as PendingPrView);
              return (
                <Tooltip title={teamCriticalFlowPrTooltip(pr, reasons)} key={pr.number}>
                  <a
                    className={`team-critical-flow-pr ${reasons.length > 0 ? "team-critical-flow-pr-attention" : ""}`}
                    href={pr.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>PR #{pr.number}</span>
                    <small>{teamCriticalFlowPrSummary(pr, reasons)}</small>
                  </a>
                </Tooltip>
              );
            })
          ) : (
            <span className="team-critical-flow-no-pr">No visible execution PR</span>
          )}
          {prs.length > visiblePrs.length ? (
            <LinkedOverflowButton
              ariaLabel={`Preview issue ${issue.number} with ${prs.length - visiblePrs.length} more linked PRs`}
              count={prs.length - visiblePrs.length}
              label="more PRs"
              onClick={() => onPreviewIssue(issue)}
            />
          ) : null}
        </div>
      </div>

      <div className="team-critical-flow-actions">
        <Tooltip title="Preview issue">
          <Button
            aria-label={`Preview issue ${issue.number}`}
            icon={<Eye size={14} />}
            size="small"
            onClick={() => onPreviewIssue(issue)}
          />
        </Tooltip>
        {prs.some((pr) => prAttentionReasons(pr as PendingPrView).length > 0) ? (
          <Button size="small" onClick={onOpenPrRisks}>
            PR Risks
          </Button>
        ) : (
          <Button href={issue.htmlUrl} size="small" target="_blank">
            GitHub
          </Button>
        )}
      </div>
    </article>
  );
}

function teamCriticalFlowBlockedPrCount(rows: ObservedOwnerThread[]): number {
  const blockedPrNumbers = new Set<number>();
  for (const row of rows) {
    for (const pr of observedThreadPullRequests(row)) {
      if (prAttentionReasons(pr as PendingPrView).length > 0) {
        blockedPrNumbers.add(pr.number);
      }
    }
  }
  return blockedPrNumbers.size;
}

function teamCriticalFlowStatus(row: ObservedOwnerThread): { label: string; color: string; detail: string } {
  const issue = row.issue;
  const prs = observedThreadPullRequests(row);
  const blockedPrs = prs.filter((pr) => prAttentionReasons(pr as PendingPrView).length > 0);

  if (!issue) {
    return { label: "pending PR", color: "default", detail: `${prs.length} PRs without a visible active issue` };
  }
  if (row.needsLink) {
    return { label: "no visible PR", color: "red", detail: "execution is not visible from issue linkage" };
  }
  if (blockedPrs.length > 0) {
    return {
      label: `${blockedPrs.length} PR blocker${blockedPrs.length === 1 ? "" : "s"}`,
      color: "orange",
      detail: prAttentionReasons(blockedPrs[0] as PendingPrView)[0] ?? "PR needs attention"
    };
  }
  if (issue.criticalAgeHours === null) {
    return { label: "timeline missing", color: "gold", detail: "severity start time is not in cache yet" };
  }
  return {
    label: "flow visible",
    color: issue.severity === "severity/s-1" ? "red" : "blue",
    detail: `${prs.length} PRs linked`
  };
}

function teamCriticalFlowPrSummary(pr: ObservedThreadPullRequest, reasons: string[]): string {
  if (reasons.length > 0) {
    return reasons[0];
  }
  if (pr.testingState !== "not_ready") {
    return testingStateBusinessLabel(pr.testingState);
  }
  if ("state" in pr && pr.state === "closed") {
    return "closed";
  }
  return hours(pr.ageHours);
}

function teamCriticalFlowPrTooltip(pr: ObservedThreadPullRequest, reasons: string[]): string {
  const state = "state" in pr ? pr.state : "open";
  const reasonText = reasons.length > 0 ? ` | ${reasons.join(", ")}` : "";
  return `PR #${pr.number} | ${state} | age ${hours(pr.ageHours)}${reasonText}`;
}

function updatePipelineTargetView(tile: UpdatePipelineTile): DashboardView {
  return tile.target === "webhooks" ? "Webhooks" : "Health";
}

function openProductionReadinessTarget(
  target: ProductionReadinessTarget,
  onNavigate: (view: DashboardView) => void,
  onConnectToken: () => void
): void {
  if (target === "connect_token") {
    onConnectToken();
    return;
  }
  onNavigate(productionReadinessTargetView(target));
}

function productionReadinessTargetView(target: Exclude<ProductionReadinessTarget, "connect_token">): DashboardView {
  if (target === "webhooks") {
    return "Webhooks";
  }
  if (target === "notifications") {
    return "Notifications";
  }
  if (target === "audit") {
    return "Audit";
  }
  return "Health";
}

function updatePipelineToneColor(tone: UpdatePipelineSummary["tone"]): string {
  if (tone === "critical") {
    return "red";
  }
  if (tone === "attention") {
    return "orange";
  }
  if (tone === "good") {
    return "green";
  }
  return "default";
}

function updatePipelineToneLabel(tone: UpdatePipelineSummary["tone"]): string {
  if (tone === "critical") {
    return "needs attention";
  }
  if (tone === "attention") {
    return "evidence gaps";
  }
  if (tone === "good") {
    return "flowing";
  }
  return "polling";
}

function formatPipelineDetail(detail: string): string {
  return detail.replace(/\b(next|last) (\d{4}-\d{2}-\d{2}T[^\s;]+)/g, (_match, prefix: string, iso: string) => {
    return `${prefix} ${formatDate(iso)}`;
  });
}

function maxCriticalActiveAge(issues: CriticalIssueView[]): number | null {
  const values = issues
    .map((issue) => issue.criticalAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(...values);
}

function maxPendingPrAge(prs: PendingPrView[]): number | null {
  return prs.length === 0 ? null : Math.max(...prs.map((pr) => pr.ageHours));
}

function maxTestingPrAge(prs: PendingPrView[]): number | null {
  const values = prs
    .map((pr) => pr.testingQueueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(...values);
}

function maxTestingIssueAge(issues: TestingIssueQueueView[]): number | null {
  const values = issues
    .map((issue) => issue.queueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(...values);
}

function TeamMonitorTile({
  label,
  value,
  detail,
  tone,
  onClick
}: {
  label: string;
  value: number;
  detail: string;
  tone: "critical" | "attention" | "good";
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </>
  );
  if (!onClick) {
    return <div className={`team-monitor-tile team-monitor-${tone}`}>{content}</div>;
  }
  return (
    <button type="button" className={`team-monitor-tile team-monitor-${tone}`} onClick={onClick}>
      {content}
    </button>
  );
}

type TeamWorkPreview =
  | { objectType: "issue"; issue: CriticalIssueView }
  | { objectType: "pull_request"; pr: PendingPrView; activeIssues: PrCriticalIssueContext[] };

function TeamRotationLane({
  title,
  count,
  visibleCount,
  overflowLabel,
  actionLabel,
  tone,
  onAction,
  children,
  controls
}: {
  title: string;
  count: number;
  visibleCount?: number;
  overflowLabel?: string;
  actionLabel: string;
  tone: "critical" | "attention";
  onAction: () => void;
  children: ReactNode;
  controls?: ReactNode;
}) {
  const hiddenCount = Math.max(0, count - (visibleCount ?? count));

  return (
    <section className={`team-rotation-lane team-rotation-lane-${tone}`}>
      <div className="team-rotation-lane-heading">
        <div className="team-rotation-lane-title">
          <Space size={[6, 6]} wrap>
            <Text strong>{title}</Text>
            <button type="button" className={`team-lane-count team-lane-count-${tone}`} onClick={onAction}>
              {count}
            </button>
          </Space>
          {controls}
        </div>
        <Button size="small" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
      <div className="team-rotation-list">{children}</div>
      {hiddenCount > 0 ? (
        <button type="button" className="team-rotation-more" onClick={onAction}>
          <span>
            {hiddenCount} more {overflowLabel ?? "items"} match this filter
          </span>
          <strong>{actionLabel}</strong>
        </button>
      ) : null}
    </section>
  );
}

function TeamCriticalIssueRow({
  issue,
  onPreview
}: {
  issue: CriticalIssueView;
  onPreview: (preview: TeamWorkPreview) => void;
}) {
  const riskTags = criticalIssueRiskTags(issue);
  const linkedPrs = issue.linkedPullRequests.slice(0, 4);
  return (
    <article className="team-work-row">
      <div className="team-work-object">
        <div className="team-work-title-row">
          <WorkObjectLink href={issue.htmlUrl} icon={<ShieldAlert size={15} aria-hidden="true" />}>
            Issue #{issue.number}
          </WorkObjectLink>
          <Tag color={severityColor(issue.severity)}>{issue.severity ?? "unknown"}</Tag>
          <Tag color={issue.criticalAgeHours === null ? "gold" : "red"}>{criticalIssueDuration(issue)}</Tag>
          <Tooltip title="Preview issue">
            <Button
              aria-label={`Preview issue ${issue.number}`}
              icon={<Eye size={14} />}
              size="small"
              type="text"
              onClick={() => onPreview({ objectType: "issue", issue })}
            />
          </Tooltip>
        </div>
        <a className="team-work-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <div className="team-work-tags">
          <Tag color={ownerScopeColor(issue.ownerScope)}>{issue.ownerLogin ?? "unowned"}</Tag>
          <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag>
          {riskTags.slice(0, 4).map((tag) => (
            <Tooltip title={tag.tooltip} key={tag.key}>
              <Tag color={tag.color}>{tag.label}</Tag>
            </Tooltip>
          ))}
        </div>
        {linkedPrs.length > 0 ? (
          <div className="team-linked-row">
            <span>PRs</span>
            {linkedPrs.map((pr) => (
              <Tooltip title={linkedPrTooltip(pr)} key={pr.number}>
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                  #{pr.number}
                  {pr.testingState !== "not_ready" ? ` ${testingStateBusinessLabel(pr.testingState)}` : ""}
                </a>
              </Tooltip>
            ))}
            {issue.linkedPullRequests.length > linkedPrs.length ? (
              <LinkedOverflowButton
                ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - linkedPrs.length} more linked PRs`}
                count={issue.linkedPullRequests.length - linkedPrs.length}
                onClick={() => onPreview({ objectType: "issue", issue })}
              />
            ) : null}
          </div>
        ) : (
          <div className="team-linked-row team-linked-row-missing">No linked PR visible</div>
        )}
      </div>
      <div className="team-work-action">
        <Text type="secondary">Next</Text>
        <Text strong>{criticalIssueNextAction(issue)}</Text>
        <small>{issue.linkedPullRequests.length} linked PR</small>
      </div>
    </article>
  );
}

function TeamPrRiskRow({
  activeIssues = [],
  pr,
  onPreview
}: {
  activeIssues?: PrCriticalIssueContext[];
  pr: PendingPrView;
  onPreview?: (preview: TeamWorkPreview) => void;
}) {
  const reasons = prAttentionReasons(pr);
  const visibleReasons = reasons.slice(0, 4);
  const activeIssueNumbers = new Set(activeIssues.map((issue) => issue.number));
  const visibleActiveIssues = activeIssues.slice(0, 3);
  const linkedIssues = pr.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));
  const otherLinkedIssues = linkedIssues.filter((link) => !activeIssueNumbers.has(link.number));
  const visibleIssueLinks = (activeIssues.length > 0 ? otherLinkedIssues : linkedIssues).slice(0, 4);
  const hiddenIssueLinks =
    (activeIssues.length > 0 ? otherLinkedIssues : linkedIssues).length - visibleIssueLinks.length;

  return (
    <article className="team-work-row">
      <div className="team-work-object">
        <div className="team-work-title-row">
          <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
            PR #{pr.number}
          </WorkObjectLink>
          <Tag>{hours(pr.ageHours)}</Tag>
          {activeIssues.length > 0 ? (
            <Tag color={severityColor(activeIssues[0]?.severity ?? null)}>
              {activeIssues.length} active issue{activeIssues.length === 1 ? "" : "s"}
            </Tag>
          ) : null}
          {pr.testingState !== "not_ready" ? <TestingStateTag state={pr.testingState} /> : null}
          {onPreview ? (
            <Tooltip title="Preview PR">
              <Button
                aria-label={`Preview PR ${pr.number}`}
                icon={<Eye size={14} />}
                size="small"
                type="text"
                onClick={() => onPreview({ objectType: "pull_request", pr, activeIssues })}
              />
            </Tooltip>
          ) : null}
        </div>
        <a className="team-work-title" href={pr.htmlUrl} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        <div className="team-work-tags">
          <Tag>{pr.ownerLogin}</Tag>
          {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
          {pr.reviewDecision ? (
            <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>{labelText(pr.reviewDecision)}</Tag>
          ) : null}
          {pr.mergeStateStatus ? (
            <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
          ) : null}
          {visibleReasons.map((reason) => (
            <Tag color={activityReasonColor(reason)} key={reason}>
              {reason}
            </Tag>
          ))}
        </div>
        {activeIssues.length > 0 ? (
          <div className="team-linked-row team-critical-context-row">
            <span>Active issues</span>
            {visibleActiveIssues.map((issue) => (
              <Tooltip title={prCriticalIssueTooltip(issue)} key={issue.number}>
                <a href={issue.htmlUrl} target="_blank" rel="noreferrer">
                  #{issue.number} {severityShortLabel(issue.severity)}
                </a>
              </Tooltip>
            ))}
            {activeIssues.length > visibleActiveIssues.length ? (
              onPreview ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview PR ${pr.number} with ${activeIssues.length - visibleActiveIssues.length} more active issues`}
                  count={activeIssues.length - visibleActiveIssues.length}
                  label="more active"
                  onClick={() => onPreview({ objectType: "pull_request", pr, activeIssues })}
                />
              ) : (
                <span>+{activeIssues.length - visibleActiveIssues.length}</span>
              )
            ) : null}
          </div>
        ) : null}
        {visibleIssueLinks.length > 0 ? (
          <div className="team-linked-row">
            <>
              <span>{activeIssues.length > 0 ? "Other issues" : "Issues"}</span>
              {visibleIssueLinks.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                  #{link.number}
                </a>
              ))}
              {hiddenIssueLinks > 0 ? (
                onPreview ? (
                  <LinkedOverflowButton
                    ariaLabel={`Preview PR ${pr.number} with ${hiddenIssueLinks} more linked issues`}
                    count={hiddenIssueLinks}
                    label="more issues"
                    onClick={() => onPreview({ objectType: "pull_request", pr, activeIssues })}
                  />
                ) : (
                  <span>+{hiddenIssueLinks}</span>
                )
              ) : null}
            </>
          </div>
        ) : activeIssues.length === 0 ? (
          <div className="team-linked-row team-linked-row-missing">
            {prIssueLinkUnknown(pr) ? "Issue link sync pending" : "Unlinked after sync"}
          </div>
        ) : null}
      </div>
      <div className="team-work-action">
        <Text type="secondary">Next</Text>
        <Text strong>{teamPrNextAction(pr)}</Text>
        <small>{activeIssues.length > 0 ? prActiveIssueActionContext(activeIssues, pr) : prActionContext(pr)}</small>
      </div>
    </article>
  );
}

function LinkedOverflowButton({
  ariaLabel,
  count,
  label = "more",
  onClick
}: {
  ariaLabel: string;
  count: number;
  label?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="linked-overflow-button" aria-label={ariaLabel} onClick={onClick}>
      +{count} {label}
    </button>
  );
}

function TeamWorkPreviewModal({ preview, onClose }: { preview: TeamWorkPreview | null; onClose: () => void }) {
  if (!preview) {
    return null;
  }

  if (preview.objectType === "issue") {
    return <TeamIssuePreviewModal issue={preview.issue} onClose={onClose} />;
  }
  return <TeamPullRequestPreviewModal activeIssues={preview.activeIssues} pr={preview.pr} onClose={onClose} />;
}

function TeamIssuePreviewModal({ issue, onClose }: { issue: CriticalIssueView; onClose: () => void }) {
  const riskTags = criticalIssueRiskTags(issue);
  const [linkedPrsExpanded, setLinkedPrsExpanded] = useState(false);
  const linkedPrs = linkedPrsExpanded ? issue.linkedPullRequests : issue.linkedPullRequests.slice(0, 8);
  const hiddenLinkedPrCount = Math.max(0, issue.linkedPullRequests.length - linkedPrs.length);

  useEffect(() => {
    setLinkedPrsExpanded(false);
  }, [issue.number]);

  return (
    <Modal
      className="team-object-preview-modal"
      open
      width={820}
      title={`Issue #${issue.number}`}
      onCancel={onClose}
      footer={[
        <Button href={issue.htmlUrl} icon={<ExternalLink size={14} />} key="github" target="_blank">
          Open GitHub
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
    >
      <div className="team-object-preview">
        <a className="team-object-preview-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <Space size={[4, 4]} wrap>
          <Tag color={severityColor(issue.severity)}>{issue.severity ?? "unknown severity"}</Tag>
          <Tag color={ownerScopeColor(issue.ownerScope)}>{issue.ownerLogin ?? "unowned"}</Tag>
          <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag>
          <Tag color={issue.criticalAgeHours === null ? "gold" : "red"}>{criticalIssueDuration(issue)}</Tag>
          {issue.workflowSkipped ? <Tag>skip automation</Tag> : null}
        </Space>

        <div className="team-object-preview-grid">
          <div className="team-object-preview-metric">
            <span>Active duration</span>
            <strong>{criticalIssueDuration(issue)}</strong>
            <small>
              {issue.criticalStartedAt ? `since ${formatDate(issue.criticalStartedAt)}` : "timeline missing"}
            </small>
          </div>
          <div className="team-object-preview-metric">
            <span>Linked PRs</span>
            <strong>{issue.linkedPullRequests.length}</strong>
            <small>{issue.linkedPullRequests.length > 0 ? "execution visible" : "needs PR link"}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Last action</span>
            <strong>{formatDate(issue.lastHumanActionAt)}</strong>
            <small>{issue.lastHumanActionAt ? "human activity" : "not visible in cache"}</small>
          </div>
        </div>

        <section className="team-object-preview-section">
          <Text strong>Next action</Text>
          <Text>{criticalIssueNextAction(issue)}</Text>
        </section>

        {riskTags.length > 0 ? (
          <section className="team-object-preview-section">
            <Text strong>Why it needs attention</Text>
            <Space size={[4, 4]} wrap>
              {riskTags.map((tag) => (
                <Tooltip title={tag.tooltip} key={tag.key}>
                  <Tag color={tag.color}>{tag.label}</Tag>
                </Tooltip>
              ))}
            </Space>
          </section>
        ) : null}

        <section className="team-object-preview-section">
          <Text strong>Linked PRs</Text>
          {linkedPrs.length > 0 ? (
            <div className="team-object-preview-list">
              {linkedPrs.map((pr) => (
                <a
                  className="team-object-preview-linked"
                  href={pr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={pr.number}
                >
                  <span>
                    <GitPullRequest size={14} aria-hidden="true" />
                    PR #{pr.number}
                  </span>
                  <strong>{pr.title}</strong>
                  <small>
                    owner {pr.ownerLogin} | age {hours(pr.ageHours)} | last {formatDate(pr.lastHumanActionAt)}
                  </small>
                  <Space size={[4, 4]} wrap>
                    {pr.testingState !== "not_ready" ? <TestingStateTag state={pr.testingState} /> : null}
                    {pr.attentionFlags.slice(0, 4).map((flag) => (
                      <Tag color={flagColor(flag)} key={flag}>
                        {labelText(flag)}
                      </Tag>
                    ))}
                  </Space>
                </a>
              ))}
              {hiddenLinkedPrCount > 0 ? (
                <button type="button" className="team-object-preview-more" onClick={() => setLinkedPrsExpanded(true)}>
                  +{hiddenLinkedPrCount} more PRs. Show all
                </button>
              ) : issue.linkedPullRequests.length > 8 && linkedPrsExpanded ? (
                <button type="button" className="team-object-preview-more" onClick={() => setLinkedPrsExpanded(false)}>
                  Show compact PR list
                </button>
              ) : null}
            </div>
          ) : (
            <Text type="secondary">No linked PR is visible in cache.</Text>
          )}
        </section>
      </div>
    </Modal>
  );
}

function TeamPullRequestPreviewModal({
  activeIssues,
  pr,
  onClose
}: {
  activeIssues: PrCriticalIssueContext[];
  pr: PendingPrView;
  onClose: () => void;
}) {
  const reasons = prAttentionReasons(pr);
  const issueLinks = pr.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));

  return (
    <Modal
      className="team-object-preview-modal"
      open
      width={820}
      title={`PR #${pr.number}`}
      onCancel={onClose}
      footer={[
        <Button href={pr.htmlUrl} icon={<ExternalLink size={14} />} key="github" target="_blank">
          Open GitHub
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
    >
      <div className="team-object-preview">
        <a className="team-object-preview-title" href={pr.htmlUrl} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        <Space size={[4, 4]} wrap>
          <Tag>{pr.ownerLogin}</Tag>
          <Tag>{hours(pr.ageHours)}</Tag>
          {pr.testingState !== "not_ready" ? <TestingStateTag state={pr.testingState} /> : null}
          {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
          {pr.reviewDecision ? (
            <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>{labelText(pr.reviewDecision)}</Tag>
          ) : null}
          {pr.mergeStateStatus ? (
            <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
          ) : null}
          {!pr.isComplete ? <Tag color="gold">PR detail sync pending</Tag> : null}
        </Space>

        <div className="team-object-preview-grid">
          <div className="team-object-preview-metric">
            <span>PR age</span>
            <strong>{hours(pr.ageHours)}</strong>
            <small>current cached age</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Last human action</span>
            <strong>{formatDate(pr.lastHumanActionAt)}</strong>
            <small>{pr.lastHumanActionAt ? "cached activity" : "not visible in cache"}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Issue links</span>
            <strong>{pr.linkedIssueNumbers.length}</strong>
            <small>
              {prIssueLinkUnknown(pr)
                ? "sync pending"
                : pr.linkedIssueNumbers.length > 0
                  ? "linked"
                  : "none after sync"}
            </small>
          </div>
        </div>

        <section className="team-object-preview-section">
          <Text strong>Next action</Text>
          <Text>{activeIssues.length > 0 ? prActiveIssueActionContext(activeIssues, pr) : prActionContext(pr)}</Text>
          <Text type="secondary">{teamPrNextAction(pr)}</Text>
        </section>

        {reasons.length > 0 ? (
          <section className="team-object-preview-section">
            <Text strong>Why it needs attention</Text>
            <Space size={[4, 4]} wrap>
              {reasons.map((reason) => (
                <Tag color={activityReasonColor(reason)} key={reason}>
                  {reason}
                </Tag>
              ))}
            </Space>
          </section>
        ) : null}

        <section className="team-object-preview-section">
          <Text strong>Issue context</Text>
          {activeIssues.length > 0 ? (
            <div className="team-object-preview-list">
              {activeIssues.map((issue) => (
                <a
                  className="team-object-preview-linked"
                  href={issue.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={issue.number}
                >
                  <span>
                    <ShieldAlert size={14} aria-hidden="true" />
                    Issue #{issue.number}
                  </span>
                  <strong>{issue.title}</strong>
                  <small>
                    {severityShortLabel(issue.severity)} | owner {issue.ownerLogin ?? "unowned"} |{" "}
                    {issue.criticalAgeHours === null ? "active duration unknown" : hours(issue.criticalAgeHours)}
                  </small>
                </a>
              ))}
            </div>
          ) : issueLinks.length > 0 ? (
            <Space size={[4, 4]} wrap>
              {issueLinks.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                  issue #{link.number}
                </a>
              ))}
            </Space>
          ) : (
            <Text type="secondary">
              {prIssueLinkUnknown(pr) ? "Issue link sync is still pending." : "No linked issue found after sync."}
            </Text>
          )}
        </section>
      </div>
    </Modal>
  );
}

function PrIssueContextCell({
  activeIssues = [],
  pr,
  onPreview
}: {
  activeIssues?: PrCriticalIssueContext[];
  pr: PendingPrView;
  onPreview: () => void;
}) {
  const activeIssueNumbers = new Set(activeIssues.map((issue) => issue.number));
  const otherIssueNumbers = pr.linkedIssueNumbers.filter((number) => !activeIssueNumbers.has(number));

  return (
    <Space orientation="vertical" size={4}>
      {activeIssues.length > 0 ? (
        <Space size={[4, 4]} wrap>
          {activeIssues.slice(0, 3).map((issue) => (
            <Tooltip title={prCriticalIssueTooltip(issue)} key={issue.number}>
              <Tag color={severityColor(issue.severity)}>
                <a className="critical-issue-tag-link" href={issue.htmlUrl} target="_blank" rel="noreferrer">
                  #{issue.number} {severityShortLabel(issue.severity)}
                </a>
              </Tag>
            </Tooltip>
          ))}
          {activeIssues.length > 3 ? (
            <LinkedOverflowButton
              ariaLabel={`Preview PR ${pr.number} with ${activeIssues.length - 3} more active issues`}
              count={activeIssues.length - 3}
              label="more active"
              onClick={onPreview}
            />
          ) : null}
        </Space>
      ) : null}
      {otherIssueNumbers.length > 0 ? (
        <Space size={[4, 4]} wrap>
          <Text type="secondary">{activeIssues.length > 0 ? "other" : "issues"}</Text>
          {otherIssueNumbers.slice(0, 3).map((number) => (
            <a href={linkedObjectUrl(pr.htmlUrl, "issues", number)} target="_blank" rel="noreferrer" key={number}>
              #{number}
            </a>
          ))}
          {otherIssueNumbers.length > 3 ? (
            <LinkedOverflowButton
              ariaLabel={`Preview PR ${pr.number} with ${otherIssueNumbers.length - 3} more linked issues`}
              count={otherIssueNumbers.length - 3}
              label="more issues"
              onClick={onPreview}
            />
          ) : null}
        </Space>
      ) : activeIssues.length === 0 ? (
        <Space size={[4, 4]} wrap>
          {prIssueLinkUnknown(pr) ? (
            <Tooltip title="PR detail or relationship sync has not completed. GitHub linked issues may still be missing from cache.">
              <Tag color="gold">issue link sync pending</Tag>
            </Tooltip>
          ) : (
            <Tooltip title="PR detail sync completed, and no related issue was found in GitHub relationship data or PR text.">
              <Tag color="orange">unlinked after sync</Tag>
            </Tooltip>
          )}
        </Space>
      ) : null}
      {isTestingQueuePr(pr) ? (
        <Space size={[4, 4]} wrap>
          <TestingStateTag state={pr.testingState} label="issue in testing" />
          {pr.testingQueueAgeHours !== null ? <Tag>linked issue wait {hours(pr.testingQueueAgeHours)}</Tag> : null}
        </Space>
      ) : null}
    </Space>
  );
}

function TeamTestingIssueRow({
  issue,
  onPreview
}: {
  issue: TestingIssueQueueView;
  onPreview: (issue: TestingIssueQueueView) => void;
}) {
  const linkedPrs = issue.linkedPullRequests.slice(0, 4);
  const blockerCount = testingIssueLinkedBlockerCount(issue);

  return (
    <article className="team-work-row">
      <div className="team-work-object">
        <div className="team-work-title-row">
          <WorkObjectLink href={issue.htmlUrl} icon={<ClipboardCheck size={15} aria-hidden="true" />}>
            Issue #{issue.number}
          </WorkObjectLink>
          <Tag color={isTestingIssueStale(issue) ? "red" : "blue"}>{testingIssueWaitText(issue)}</Tag>
          <Tag color={testingIssueQueueAgeEvidenceColor(issue.queueAgeEvidence)}>
            {testingIssueQueueAgeEvidenceShortLabel(issue.queueAgeEvidence)}
          </Tag>
          {!issue.isComplete ? <Tag color="gold">issue sync pending</Tag> : null}
          <Tooltip title="Preview issue">
            <Button
              aria-label={`Preview issue ${issue.number}`}
              icon={<Eye size={14} />}
              size="small"
              type="text"
              onClick={() => onPreview(issue)}
            />
          </Tooltip>
        </div>
        <a className="team-work-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <div className="team-work-tags">
          {issue.testers.slice(0, 4).map((tester) => (
            <Tag key={tester}>{tester}</Tag>
          ))}
          {issue.testingSignals.slice(0, 3).map((signal) => (
            <Tooltip title={testingSignalBusinessLabel(signal)} key={signal}>
              <Tag color={testingSignalTagColor(signal)}>{testingSignalTagLabel(signal)}</Tag>
            </Tooltip>
          ))}
          {issue.testers.length === 0 && issue.testingSignals.length === 0 ? (
            <Tag color="gold">handoff evidence pending</Tag>
          ) : null}
          <Tag>{issue.linkedPullRequests.length} linked PR</Tag>
          {blockerCount > 0 ? <Tag color="orange">{blockerCount} PR blockers</Tag> : null}
          {issue.syncError ? (
            <Tooltip title={issue.syncError}>
              <Tag color="red">sync error</Tag>
            </Tooltip>
          ) : null}
        </div>
        {linkedPrs.length > 0 ? (
          <div className="team-linked-row">
            <span>PRs</span>
            {linkedPrs.map((pr) => (
              <Tooltip title={pr.title} key={pr.number}>
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                  #{pr.number}
                </a>
              </Tooltip>
            ))}
            {issue.linkedPullRequests.length > linkedPrs.length ? (
              <LinkedOverflowButton
                ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - linkedPrs.length} more linked PRs`}
                count={issue.linkedPullRequests.length - linkedPrs.length}
                label="more PRs"
                onClick={() => onPreview(issue)}
              />
            ) : null}
          </div>
        ) : (
          <div className="team-linked-row team-linked-row-missing">No linked PR visible</div>
        )}
      </div>
      <div className="team-work-action">
        <Text type="secondary">Next</Text>
        <Text strong>{teamTestingIssueNextAction(issue, blockerCount)}</Text>
        <small>{testingIssueHandoffSummary(issue)}</small>
      </div>
    </article>
  );
}

function TeamPeopleFocus({
  people,
  personalViews,
  observedMode,
  onPersonSelect
}: {
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  observedMode: boolean;
  onPersonSelect: (login: string) => void;
}) {
  return (
    <section className="team-side-panel">
      <div className="team-side-heading">
        <Text strong>People Focus</Text>
        <Tag>{observedMode ? "observed" : "watched"}</Tag>
      </div>
      <div className="team-people-list">
        {people.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={observedMode ? "No active owners observed" : "No watched people with active risk"}
          />
        ) : (
          people.map((person) => (
            <button
              type="button"
              className="team-person-row"
              onClick={() => onPersonSelect(person.login)}
              key={person.login}
            >
              <span className="person-avatar" aria-hidden="true">
                {person.login.slice(0, 1).toUpperCase()}
              </span>
              <span className="team-person-main">
                <strong>{person.login}</strong>
                <small>
                  {person.activeCriticalIssues} s-1/s0 | {person.attentionPrs} PR attention |{" "}
                  {testingCountForPerson(person.login, personalViews)} issue testing
                </small>
                {observedMode ? (
                  <small>Visible cache owner; configure watched users for full personal view</small>
                ) : null}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function TeamOpsStatus({ data, onNavigate }: { data: DashboardSummary; onNavigate: (view: DashboardView) => void }) {
  const notificationRisk =
    data.notifications.failedDeliveries +
    data.notifications.unacknowledgedDeliveries +
    data.notifications.escalationPendingDeliveries;
  const webhookReadiness = summarizeWebhookReadiness(data);
  return (
    <section className="team-side-panel">
      <div className="team-side-heading">
        <Text strong>Data And Automation</Text>
        <Tag color={data.sync.worker.status === "active" ? "green" : "orange"}>
          {labelText(data.sync.worker.status)}
        </Tag>
      </div>
      <div className="team-status-list">
        <TeamStatusRow
          label="Cache"
          value={`${data.sync.staleObjects} stale / ${data.sync.partialObjects} incomplete`}
          onClick={() => onNavigate("Health")}
        />
        <TeamStatusRow
          label="Worker"
          value={`${labelText(data.sync.worker.phase ?? data.sync.worker.status)} | queue ${data.sync.jobQueue.queueDepth}`}
          onClick={() => onNavigate("Health")}
        />
        <TeamStatusRow
          label="Webhook"
          value={`${webhookReadinessModeLabel(webhookReadiness.mode)} | ${data.webhooks.pendingDeliveries} pending / ${data.webhooks.failedDeliveries} failed`}
          onClick={() => onNavigate("Webhooks")}
        />
        <TeamStatusRow
          label="Notifications"
          value={`${notificationRisk} active delivery risk`}
          onClick={() => onNavigate("Notifications")}
        />
      </div>
    </section>
  );
}

function TeamStatusRow({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (!onClick) {
    return <div className="team-status-row">{content}</div>;
  }

  return (
    <button type="button" className="team-status-row" onClick={onClick}>
      {content}
    </button>
  );
}

type HealthTileTone = "critical" | "attention" | "good" | "normal";

function healthTileToneColor(tone: HealthTileTone): string {
  if (tone === "critical") {
    return "red";
  }
  if (tone === "attention") {
    return "orange";
  }
  if (tone === "good") {
    return "green";
  }
  return "blue";
}

function operationalHealthScore(data: DashboardSummary): { label: string; tone: HealthTileTone } {
  if (
    data.sync.worker.status === "failed" ||
    data.sync.worker.status === "offline" ||
    data.sync.jobQueue.failedJobs > 0 ||
    data.sync.jobQueue.blockedJobs > 0 ||
    data.webhooks.failedDeliveries > 0 ||
    data.notifications.failedDeliveries > 0
  ) {
    return { label: "action required", tone: "critical" };
  }
  if (
    data.sync.staleObjects > 0 ||
    data.sync.partialObjects > 0 ||
    data.sync.jobQueue.status === "attention" ||
    data.notifications.readiness.status === "action_required" ||
    data.notifications.readiness.status === "degraded"
  ) {
    return { label: "needs attention", tone: "attention" };
  }
  return { label: "healthy", tone: "good" };
}

function HealthMetricCard({
  label,
  value,
  detail,
  tone,
  action,
  disabled = false,
  disabledReason,
  loading = false,
  onClick
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: HealthTileTone;
  action?: string;
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  onClick?: () => void;
}) {
  return (
    <article className={`health-metric-card health-metric-${tone}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {action && onClick ? (
        <Tooltip title={disabled ? disabledReason : undefined}>
          <span>
            <Button size="small" disabled={disabled} loading={loading} onClick={onClick}>
              {action}
            </Button>
          </span>
        </Tooltip>
      ) : null}
    </article>
  );
}

function HealthLayerRow({
  item,
  authenticated,
  saving,
  onQueueLayer
}: {
  item: DashboardSummary["sync"]["health"][number];
  authenticated: boolean;
  saving: boolean;
  onQueueLayer: (layer: ManualRefreshLayer) => void;
}) {
  return (
    <article className="health-layer-row">
      <div className="health-layer-main">
        <Space size={6} wrap>
          <Tag color={syncHealthTagColor(item.status)}>{labelText(item.status)}</Tag>
          {item.skipped ? <Tag color="gold">skipped</Tag> : null}
          <Text strong>{labelText(item.layer)}</Text>
        </Space>
        <Text type="secondary">{manualRefreshLayerDescription(item.layer)}</Text>
      </div>
      <div className="health-layer-meta">
        <span>success {formatDate(item.lastSuccessfulAt)}</span>
        <span>attempt {formatDate(item.lastAttemptedAt)}</span>
        {item.rateLimitRemaining !== null ? <span>rate {item.rateLimitRemaining}</span> : null}
        {item.skipped ? <span>skipped {item.skipReason ?? "no reason recorded"}</span> : null}
        {item.errorMessage ? <span className="health-layer-error">{item.errorMessage}</span> : null}
      </div>
      <Tooltip title={authenticated ? "Queue this sync layer" : "Connect GitHub token to queue worker refresh jobs"}>
        <span>
          <Button size="small" disabled={!authenticated} loading={saving} onClick={() => onQueueLayer(item.layer)}>
            Refresh layer
          </Button>
        </span>
      </Tooltip>
    </article>
  );
}

function HealthBoard({
  data,
  session,
  authenticated,
  manualRefreshSaving,
  webhookRetrySaving,
  cacheImpactItems,
  onQueueLayers,
  onOpenView,
  onImpactSelect,
  onConnectToken,
  onRetryFailedWebhooks
}: {
  data: DashboardSummary;
  session: SessionView | null;
  authenticated: boolean;
  manualRefreshSaving: boolean;
  webhookRetrySaving: boolean;
  cacheImpactItems: CacheEvidenceImpactItem[];
  onQueueLayers: (layers: ManualRefreshLayer[]) => void;
  onOpenView: (view: DashboardView) => void;
  onImpactSelect: (target: CacheEvidenceImpactTarget) => void;
  onConnectToken: () => void;
  onRetryFailedWebhooks: () => void;
}) {
  const score = operationalHealthScore(data);
  const notificationRisk =
    data.notifications.failedDeliveries +
    data.notifications.unacknowledgedDeliveries +
    data.notifications.escalationPendingDeliveries;
  const repairRecommendation = recommendCacheRepair(data.sync);
  const unhealthyLayers = data.sync.health.filter((item) => item.status !== "success").length;
  const webhookReadiness = summarizeWebhookReadiness(data);
  const productionReadiness = summarizeProductionReadiness({ data, session });
  const refreshDisabledReason = authenticated
    ? undefined
    : "Anonymous users can inspect cached health only. Connect a GitHub token to queue worker refresh jobs.";

  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <Title level={4}>Operational Health</Title>
          <Text type="secondary">
            Cache quality, worker state, webhook ingestion, notification readiness, and targeted repair controls.
          </Text>
        </div>
        <Tag color={healthTileToneColor(score.tone)}>{score.label}</Tag>
      </div>

      {!authenticated ? (
        <Alert
          className="health-readonly-alert"
          type="info"
          showIcon
          title="Observer mode"
          description="Cached data remains visible. Queueing repair, webhook retry, and worker refresh actions requires a connected GitHub token and CSRF-protected session."
          action={
            <Button size="small" onClick={onConnectToken}>
              Connect
            </Button>
          }
        />
      ) : null}

      <ProductionReadinessStrip summary={productionReadiness} onNavigate={onOpenView} onConnectToken={onConnectToken} />

      <div className="health-command-grid">
        <HealthMetricCard
          label="Cache evidence"
          value={`${data.sync.staleObjects}/${data.sync.partialObjects}`}
          detail={`${data.sync.staleObjects} stale, ${data.sync.partialObjects} incomplete`}
          tone={data.sync.staleObjects > 0 || data.sync.partialObjects > 0 ? "attention" : "good"}
          action={repairRecommendation.layers.length > 0 ? "Queue repair" : "Refresh cache"}
          disabled={!authenticated}
          disabledReason={refreshDisabledReason}
          loading={manualRefreshSaving}
          onClick={() =>
            onQueueLayers(repairRecommendation.layers.length > 0 ? repairRecommendation.layers : ["github_sync"])
          }
        />
        <HealthMetricCard
          label="Sync layers"
          value={unhealthyLayers}
          detail={`${data.sync.health.length} layers tracked; oldest sync ${formatDate(
            summarizeFreshness(data.sync).oldestLayerSuccessAt
          )}`}
          tone={unhealthyLayers > 0 ? "attention" : "good"}
          action="Refresh all"
          disabled={!authenticated}
          disabledReason={refreshDisabledReason}
          loading={manualRefreshSaving}
          onClick={() => onQueueLayers([...syncHealthLayers])}
        />
        <HealthMetricCard
          label="Worker and jobs"
          value={labelText(data.sync.worker.status)}
          detail={`${data.sync.jobQueue.queueDepth} queued, ${data.sync.jobQueue.runningJobs} running, ${data.sync.jobQueue.failedJobs} failed`}
          tone={data.sync.worker.status === "active" && data.sync.jobQueue.status === "healthy" ? "good" : "critical"}
          action="Refresh status"
          disabled={!authenticated}
          disabledReason={refreshDisabledReason}
          loading={manualRefreshSaving}
          onClick={() => onQueueLayers(["rules", "metrics", "ai_drift", "notifications"])}
        />
        <HealthMetricCard
          label="Webhooks"
          value={webhookReadinessModeLabel(webhookReadiness.mode)}
          detail={webhookReadiness.facts.slice(0, 3).join(", ")}
          tone={webhookReadiness.tone}
          action={data.webhooks.failedDeliveries > 0 ? "Retry failed" : "Open webhooks"}
          disabled={data.webhooks.failedDeliveries > 0 && !authenticated}
          disabledReason={refreshDisabledReason}
          loading={webhookRetrySaving}
          onClick={() => (data.webhooks.failedDeliveries > 0 ? onRetryFailedWebhooks() : onOpenView("Webhooks"))}
        />
        <HealthMetricCard
          label="Notifications"
          value={labelText(data.notifications.readiness.status)}
          detail={`${notificationRisk} delivery risk, ${data.notifications.readiness.missingEmployeeMappings} missing mappings`}
          tone={
            data.notifications.failedDeliveries > 0 || data.notifications.readiness.status === "action_required"
              ? "critical"
              : data.notifications.readiness.status === "disabled"
                ? "normal"
                : data.notifications.readiness.status === "degraded"
                  ? "attention"
                  : "good"
          }
          action="Open notifications"
          onClick={() => onOpenView("Notifications")}
        />
      </div>

      {cacheImpactItems.length > 0 ? (
        <CacheEvidenceImpactBoard items={cacheImpactItems} onSelect={onImpactSelect} />
      ) : null}

      <div className="health-detail-grid">
        <section className="health-panel">
          <div className="subsection-heading">
            <Title level={5}>Sync Layers</Title>
            <Tag color={unhealthyLayers > 0 ? "orange" : "green"}>{unhealthyLayers} need attention</Tag>
          </div>
          <div className="health-layer-list">
            {data.sync.health.map((item) => (
              <HealthLayerRow
                item={item}
                authenticated={authenticated}
                saving={manualRefreshSaving}
                onQueueLayer={(layer) => onQueueLayers([layer])}
                key={item.layer}
              />
            ))}
          </div>
        </section>

        <section className="health-panel">
          <div className="subsection-heading">
            <Title level={5}>Automation State</Title>
            <Tag color={data.sync.worker.status === "active" ? "green" : "orange"}>
              worker {labelText(data.sync.worker.status)}
            </Tag>
          </div>
          <div className="health-fact-list">
            <HealthFact label="Worker" value={workerStatusDescription(data.sync.worker)} />
            <HealthFact
              label="Job queue"
              value={
                data.sync.jobQueue.recommendedAction ??
                `${data.sync.jobQueue.queueDepth} queued, next ${formatDate(data.sync.jobQueue.nextRunAt)}`
              }
            />
            <HealthFact
              label="Webhook"
              value={
                data.webhooks.latestFailure ??
                `${data.webhooks.pendingDeliveries} pending, ${data.webhooks.failedDeliveries} failed`
              }
            />
            <HealthFact
              label="Notification readiness"
              value={
                data.notifications.readiness.blockers[0] ??
                data.notifications.readiness.warnings[0] ??
                `${data.notifications.readiness.mappedEmployees} mapped employees`
              }
            />
          </div>
        </section>
      </div>
    </section>
  );
}

function HealthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="health-fact-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function teamPrimaryFocus(data: DashboardSummary, sMinusOneIssues: number): { title: string; detail: string } {
  if (sMinusOneIssues > 0) {
    return {
      title: `${sMinusOneIssues} active s-1 issues are the first queue.`,
      detail: `${data.counts.criticalIssues} active s-1/s0 total; ${data.counts.attentionPrs} PRs also need attention.`
    };
  }
  if (data.testing.staleQueueIssues > 0) {
    return {
      title: `${data.testing.staleQueueIssues} issues have waited on test too long.`,
      detail: `${data.testing.queueIssues} issues match configured issue testing rules.`
    };
  }
  if (data.counts.attentionPrs > 0) {
    return {
      title: `${data.counts.attentionPrs} pending PRs need attention.`,
      detail: `${data.counts.pendingPrs} pending PRs are visible in cache.`
    };
  }
  if (data.counts.workflowViolations + data.counts.aiDriftSignals > 0) {
    return {
      title: `${data.counts.workflowViolations + data.counts.aiDriftSignals} workflow or AI drift signals are open.`,
      detail: `${data.counts.workflowViolations} workflow violations; ${data.counts.aiDriftSignals} AI drift signals.`
    };
  }
  return {
    title: "No high-priority rotation blockers in cached data.",
    detail: `${data.counts.pendingPrs} pending PRs and ${data.counts.criticalIssues} active s-1/s0 issues remain visible.`
  };
}

function oldestPendingPrText(prs: PendingPrView[]): string {
  const oldest = maxPrAge(prs);
  return oldest === null ? "no PR age" : `oldest ${hours(oldest)}`;
}

function maxPrAge(prs: PendingPrView[]): number | null {
  if (prs.length === 0) {
    return null;
  }
  return Math.max(...prs.map((pr) => pr.ageHours));
}

function sortPendingPrsForAction(
  prs: PendingPrView[],
  criticalIssuesByPr: Map<number, PrCriticalIssueContext[]> = new Map()
): PendingPrView[] {
  return [...prs].sort((left, right) => {
    const riskDelta =
      pendingPrRiskScore(right, criticalIssuesByPr.get(right.number) ?? []) -
      pendingPrRiskScore(left, criticalIssuesByPr.get(left.number) ?? []);
    if (riskDelta !== 0) {
      return riskDelta;
    }
    return right.ageHours - left.ageHours || left.number - right.number;
  });
}

function pendingPrRiskScore(pr: PendingPrView, activeIssues: PrCriticalIssueContext[] = []): number {
  return (
    prActiveIssueRiskScore(activeIssues) +
    prAttentionReasons(pr).length * 80 +
    (pr.reviewDecision === "changes_requested" ? 180 : 0) +
    (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)
      ? 160
      : 0) +
    (pr.mergeStateStatus === "dirty" ? 160 : 0) +
    (isTestingStalePr(pr) ? 150 : 0) +
    (pr.testingQueueAgeHours !== null ? 80 : 0) +
    (pr.ageHours >= 24 ? 60 : 0) +
    (prHasNoLinkedIssue(pr) ? 45 : 0) +
    (!pr.isComplete ? 30 : 0)
  );
}

function prActiveIssueRiskScore(activeIssues: PrCriticalIssueContext[]): number {
  if (activeIssues.length === 0) {
    return 0;
  }
  const highestSeverity = activeIssues.some((issue) => issue.severity === "severity/s-1") ? 260 : 170;
  const blockerScore = activeIssues.reduce((total, issue) => total + issue.blockerCount * 35, 0);
  const durationScore = Math.min(
    120,
    activeIssues.reduce((max, issue) => Math.max(max, issue.criticalAgeHours ?? 0), 0) / 4
  );
  return highestSeverity + blockerScore + durationScore + Math.min(80, activeIssues.length * 20);
}

function prActionContext(pr: PendingPrView): string {
  if (isTestingQueuePr(pr)) {
    return pr.testingTesters.length > 0
      ? `linked issue testers ${pr.testingTesters.slice(0, 3).join(", ")}`
      : "issue in testing";
  }
  if (pr.linkedIssueNumbers.length > 0) {
    return `${pr.linkedIssueNumbers.length} linked issue${pr.linkedIssueNumbers.length === 1 ? "" : "s"}`;
  }
  return prIssueLinkUnknown(pr) ? "issue link sync pending" : "unlinked after sync";
}

function prActiveIssueActionContext(activeIssues: PrCriticalIssueContext[], pr: PendingPrView): string {
  const primary = activeIssues[0];
  const prefix = primary
    ? `active ${severityShortLabel(primary.severity)} #${primary.number}`
    : `${activeIssues.length} active issues`;
  return `${prefix} | ${prActionContext(pr)}`;
}

function teamPrNextAction(pr: PendingPrView): string {
  const syntheticItem: PersonalActivityItem = {
    id: `pull_request:${pr.number}`,
    objectType: "pull_request",
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    ownerLogin: pr.ownerLogin,
    phase: isTestingQueuePr(pr) ? "Linked issue test evidence" : "Pending PR",
    tone: prAttentionReasons(pr).length > 0 ? "attention" : "normal",
    priority: 0,
    ageHours: pr.ageHours,
    durationHours: pr.ageHours,
    durationKind: "pr_age",
    durationEvidence: "pull_request_created_at",
    lastHumanActionAt: pr.lastHumanActionAt,
    testingQueueAgeHours: pr.testingQueueAgeHours,
    severity: null,
    lifecycleState: null,
    reviewDecision: pr.reviewDecision,
    ciState: pr.ciState,
    mergeStateStatus: pr.mergeStateStatus,
    testingState: pr.testingState,
    linkedIssueNumbers: pr.linkedIssueNumbers,
    linkedPullRequestNumbers: [],
    reasons: prAttentionReasons(pr),
    isComplete: pr.isComplete
  };
  return personalActivityNextAction(syntheticItem);
}

function teamTestingIssueNextAction(issue: TestingIssueQueueView, blockerCount: number): string {
  if (blockerCount > 0) {
    return "Clear linked PR blockers";
  }
  if (issue.linkedPullRequests.length === 0) {
    return "Link tested PR";
  }
  if (isTestingIssueStale(issue)) {
    return "Check issue test status";
  }
  if (issue.queueAgeEvidence === "issue_cache_timestamp") {
    return "Backfill handoff time";
  }
  return "Track test result";
}

function sortPeopleForTeamFocus(people: PersonSummary[], personalViews: PersonalActionView[]): PersonSummary[] {
  const testingByLogin = new Map(personalViews.map((person) => [person.login, personalTestingWorkCount(person)]));
  return [...people]
    .filter(
      (person) =>
        person.activeCriticalIssues > 0 ||
        person.attentionPrs > 0 ||
        person.needsTriageIssues > 0 ||
        (testingByLogin.get(person.login) ?? 0) > 0
    )
    .sort((left, right) => {
      const leftTesting = testingByLogin.get(left.login) ?? 0;
      const rightTesting = testingByLogin.get(right.login) ?? 0;
      const leftScore =
        left.activeCriticalIssues * 1_000 + left.attentionPrs * 120 + leftTesting * 80 + left.needsTriageIssues * 20;
      const rightScore =
        right.activeCriticalIssues * 1_000 +
        right.attentionPrs * 120 +
        rightTesting * 80 +
        right.needsTriageIssues * 20;
      return rightScore - leftScore || left.login.localeCompare(right.login);
    });
}

function testingCountForPerson(login: string, personalViews: PersonalActionView[]): number {
  const person = personalViews.find((candidate) => candidate.login === login);
  return person ? personalTestingWorkCount(person) : 0;
}

function TrendChart({ points }: { points: TrendMetricPoint[] }) {
  if (points.length === 0) {
    return <Empty description="No cached analytics metrics yet" />;
  }
  return (
    <div className="flow-chart-grid">
      <MetricFlowChart
        title="PR Flow"
        points={points}
        series={[
          { name: "Created", type: "bar", color: "#2563eb", data: (point) => point.prsCreated },
          { name: "Merged", type: "bar", color: "#16a34a", data: (point) => point.prsMerged },
          {
            name: "Open delta",
            type: "line",
            color: "#d97706",
            data: (point) => point.prsCreated - point.prsMerged
          }
        ]}
      />
      <MetricFlowChart
        title="Issue Flow"
        points={points}
        series={[
          { name: "Opened", type: "bar", color: "#7c3aed", data: (point) => point.issuesOpened },
          { name: "Closed", type: "bar", color: "#16a34a", data: (point) => point.issuesClosed },
          { name: "Deferred", type: "bar", color: "#64748b", data: (point) => point.issuesDeferred }
        ]}
      />
      <MetricFlowChart
        title="Risk Flow"
        points={points}
        series={[
          {
            name: "Violations",
            type: "bar",
            color: "#dc2626",
            data: (point) => point.workflowViolationsDetected
          },
          {
            name: "Issue drain",
            type: "line",
            color: "#0f766e",
            data: (point) => point.issuesClosed + point.issuesDeferred - point.issuesOpened
          }
        ]}
      />
      <MetricFlowChart
        title="Backlog Snapshot"
        points={points}
        series={[
          {
            name: "Active s-1/s0",
            type: "line",
            color: "#dc2626",
            data: (point) => point.activeCriticalIssues
          },
          { name: "Pending PR", type: "line", color: "#2563eb", data: (point) => point.pendingPrs },
          { name: "Needs triage", type: "line", color: "#ca8a04", data: (point) => point.needsTriageIssues },
          { name: "PR attention", type: "bar", color: "#d97706", data: (point) => point.attentionPrs }
        ]}
      />
      <MetricFlowChart
        title="PR Quality"
        points={points}
        series={[
          { name: "CI failed", type: "bar", color: "#dc2626", data: (point) => point.ciFailedPrs },
          {
            name: "Requested changes",
            type: "bar",
            color: "#ea580c",
            data: (point) => point.requestedChangePrs
          },
          { name: "Review waiting", type: "line", color: "#2563eb", data: (point) => point.reviewWaitingPrs },
          { name: "Merge conflict", type: "bar", color: "#7f1d1d", data: (point) => point.mergeConflictPrs }
        ]}
      />
      <MetricFlowChart
        title="Testing Flow"
        points={points}
        series={[
          { name: "Testing queue", type: "bar", color: "#2563eb", data: (point) => point.testingQueuePrs },
          {
            name: "Avg wait h",
            type: "line",
            color: "#d97706",
            data: (point) => point.averageTestingQueueAgeHours ?? 0
          },
          { name: "PR attention", type: "line", color: "#dc2626", data: (point) => point.attentionPrs }
        ]}
      />
    </div>
  );
}

function MetricFlowChart({
  title,
  points,
  series
}: {
  title: string;
  points: TrendMetricPoint[];
  series: MetricSeriesConfig[];
}) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current || points.length === 0) {
      return;
    }
    const chart = echarts.init(chartRef.current);
    const labels = points.map((point) => ("label" in point ? point.label : point.date.slice(5)));
    chart.setOption({
      color: series.map((item) => item.color),
      tooltip: { trigger: "axis" },
      legend: { top: 0, itemWidth: 12, itemHeight: 8, textStyle: { fontSize: 11 } },
      grid: { left: 32, right: 12, top: 42, bottom: 28 },
      xAxis: { type: "category", data: labels, boundaryGap: true, axisLabel: { fontSize: 11 } },
      yAxis: { type: "value", minInterval: 1 },
      series: series.map((item) => ({
        name: item.name,
        type: item.type,
        smooth: item.type === "line",
        barMaxWidth: 18,
        data: points.map(item.data)
      }))
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [points, series]);

  return (
    <div className="flow-chart-block">
      <Text strong>{title}</Text>
      <div className="chart-canvas chart-canvas-compact" ref={chartRef} />
    </div>
  );
}

function WorkObjectLink({ href, children, icon }: { href: string; children: ReactNode; icon: ReactNode }) {
  return (
    <a className="work-object-link" href={href} target="_blank" rel="noreferrer">
      {icon}
      <span>{children}</span>
      <ExternalLink size={13} aria-hidden="true" />
    </a>
  );
}

type CacheEvidenceSample = DashboardSummary["sync"]["staleSamples"][number];
type CacheEvidenceImpactTarget = "issues" | "prs" | "testing" | "drift";

interface CacheEvidenceImpactItem {
  key: string;
  target: CacheEvidenceImpactTarget;
  label: string;
  value: number;
  detail: string;
  tone: "critical" | "attention" | "normal";
}

function cacheEvidenceObjectLabel(sample: CacheEvidenceSample): string {
  return sample.objectType === "pull_request" ? `PR #${sample.number}` : `Issue #${sample.number}`;
}

function uniqueSampleNumbers(
  samples: CacheEvidenceSample[],
  objectType: CacheEvidenceSample["objectType"]
): Set<number> {
  return new Set(samples.filter((sample) => sample.objectType === objectType).map((sample) => sample.number));
}

function cacheEvidenceImpactItems(data: DashboardSummary): CacheEvidenceImpactItem[] {
  const samples = [...data.sync.staleSamples, ...data.sync.partialSamples];
  const sampledIssueNumbers = uniqueSampleNumbers(samples, "issue");
  const sampledPrNumbers = uniqueSampleNumbers(samples, "pull_request");
  const criticalNumbers = new Set(data.criticalIssues.map((issue) => issue.number));
  const pendingPrNumbers = new Set(data.pendingPrs.map((pr) => pr.number));
  const sampledActiveIssues = Array.from(sampledIssueNumbers).filter((number) => criticalNumbers.has(number)).length;
  const sampledPendingPrs = Array.from(sampledPrNumbers).filter((number) => pendingPrNumbers.has(number)).length;
  const timelineMissingIssues = data.criticalIssues.filter(
    (issue) => issue.criticalAgeEvidence === "missing_timeline"
  ).length;
  const evidencePendingPrs = data.pendingPrs.filter(prEvidencePending).length;
  const testingEvidenceGaps =
    data.pendingPrs.filter(isTestingEvidenceGapPr).length +
    data.testing.issues.filter(
      (issue) => issue.queueAgeEvidence === "issue_cache_timestamp" || !issue.isComplete || issue.syncError !== null
    ).length;
  const partialDriftSignals = data.aiDriftSignals.filter(
    (signal) => signal.sourceCompleteness === "partial_cache"
  ).length;

  const items: CacheEvidenceImpactItem[] = [
    {
      key: "active-issues",
      target: "issues",
      label: "Active issues",
      value: Math.max(sampledActiveIssues, timelineMissingIssues),
      detail:
        sampledActiveIssues > 0
          ? `${sampledActiveIssues} sampled active issue objects need cache attention`
          : `${timelineMissingIssues} active issues are missing severity timeline evidence`,
      tone: timelineMissingIssues > 0 ? "attention" : "normal"
    },
    {
      key: "pending-prs",
      target: "prs",
      label: "Pending PRs",
      value: Math.max(sampledPendingPrs, evidencePendingPrs),
      detail:
        sampledPendingPrs > 0
          ? `${sampledPendingPrs} sampled pending PR objects need cache attention`
          : `${evidencePendingPrs} pending PRs have incomplete review, CI, merge, or link evidence`,
      tone: evidencePendingPrs > 0 ? "attention" : "normal"
    },
    {
      key: "testing",
      target: "testing",
      label: "Testing flow",
      value: testingEvidenceGaps,
      detail: `${testingEvidenceGaps} issue or PR testing records depend on incomplete cache evidence`,
      tone: testingEvidenceGaps > 0 ? "attention" : "normal"
    },
    {
      key: "drift",
      target: "drift",
      label: "AI drift",
      value: partialDriftSignals,
      detail: `${partialDriftSignals} drift signals are based on incomplete cache evidence`,
      tone: partialDriftSignals > 0 ? "attention" : "normal"
    }
  ];
  return items.filter((item) => item.value > 0);
}

function cacheEvidenceReasonLabel(sample: CacheEvidenceSample): string {
  if (sample.reason === "stale_and_partial") {
    return "stale + incomplete";
  }
  if (sample.reason === "partial") {
    return "incomplete";
  }
  return sample.reason;
}

function cacheEvidenceReasonColor(sample: CacheEvidenceSample): string {
  if (sample.reason === "stale_and_partial") {
    return "red";
  }
  return sample.reason === "stale" ? "orange" : "gold";
}

function CacheEvidenceSampleRow({ sample }: { sample: CacheEvidenceSample }) {
  const icon =
    sample.objectType === "pull_request" ? (
      <GitPullRequest size={15} aria-hidden="true" />
    ) : (
      <CircleAlert size={15} aria-hidden="true" />
    );

  return (
    <div className="cache-evidence-row">
      <div className="cache-evidence-object">
        <WorkObjectLink href={sample.htmlUrl} icon={icon}>
          {cacheEvidenceObjectLabel(sample)}
        </WorkObjectLink>
        <a className="cache-evidence-title" href={sample.htmlUrl} target="_blank" rel="noreferrer">
          {sample.title || "(untitled)"}
        </a>
      </div>
      <div className="cache-evidence-meta">
        <span>{sample.ownerLogin ?? "unowned"}</span>
        <span>cache {hours(sample.cacheAgeHours)}</span>
        <span>synced {formatDate(sample.lastSyncedAt)}</span>
        <span>source {formatDate(sample.sourceUpdatedAt)}</span>
      </div>
      <div className="cache-evidence-tags">
        <Tag color={cacheEvidenceReasonColor(sample)}>{cacheEvidenceReasonLabel(sample)}</Tag>
        <Tag>{labelText(sample.sourceAuthType)}</Tag>
        <Tag>{labelText(sample.visibilityClass)}</Tag>
        {!sample.isComplete ? <Tag color="gold">incomplete</Tag> : null}
        {sample.syncError ? (
          <Tooltip title={sample.syncError}>
            <Tag color="red">sync error</Tag>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

function CacheEvidenceSampleGroup({
  title,
  total,
  samples,
  emptyText
}: {
  title: string;
  total: number;
  samples: CacheEvidenceSample[];
  emptyText: string;
}) {
  if (total <= 0) {
    return null;
  }
  const visibleSamples = samples.slice(0, 6);
  const hiddenFetchedSamples = Math.max(0, samples.length - visibleSamples.length);
  const notFetchedSamples = Math.max(0, total - samples.length);

  return (
    <div className="cache-evidence-sample-group">
      <div className="cache-evidence-group-heading">
        <Text strong>{title}</Text>
        <Text type="secondary">
          {visibleSamples.length > 0 ? `${visibleSamples.length} shown` : "no open sample"} / {total} total
        </Text>
      </div>
      {visibleSamples.length > 0 ? (
        <div className="cache-evidence-list">
          {visibleSamples.map((sample) => (
            <CacheEvidenceSampleRow sample={sample} key={`${sample.objectType}-${sample.number}`} />
          ))}
        </div>
      ) : (
        <Text type="secondary">{emptyText}</Text>
      )}
      {hiddenFetchedSamples > 0 || notFetchedSamples > 0 ? (
        <Text type="secondary" className="cache-evidence-overflow">
          {hiddenFetchedSamples > 0 ? `+${hiddenFetchedSamples} sampled objects hidden in this compact view. ` : ""}
          {notFetchedSamples > 0 ? `+${notFetchedSamples} other visible objects outside the sample.` : ""}
        </Text>
      ) : null}
    </div>
  );
}

function CacheEvidenceSamples({ sync }: { sync: DashboardSummary["sync"] }) {
  if (sync.staleObjects <= 0 && sync.partialObjects <= 0) {
    return null;
  }

  return (
    <div className="cache-evidence-samples">
      <CacheEvidenceSampleGroup
        title="Stale active cache"
        total={sync.staleObjects}
        samples={sync.staleSamples}
        emptyText="No open visible stale objects were returned in the diagnostic sample."
      />
      <CacheEvidenceSampleGroup
        title="Incomplete workflow evidence"
        total={sync.partialObjects}
        samples={sync.partialSamples}
        emptyText="Incomplete objects exist in the cache, but no open visible objects were returned in the sample."
      />
    </div>
  );
}

function CacheEvidenceImpactBoard({
  items,
  onSelect
}: {
  items: CacheEvidenceImpactItem[];
  onSelect: (target: CacheEvidenceImpactTarget) => void;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="cache-impact-board" aria-label="Cache evidence impact by board">
      <div className="cache-impact-heading">
        <Text strong>Board impact</Text>
        <Text type="secondary">Where this cache condition can change visible workflow conclusions.</Text>
      </div>
      <div className="cache-impact-grid">
        {items.map((item) => (
          <button
            type="button"
            className={`cache-impact-card cache-impact-card-${item.tone}`}
            onClick={() => onSelect(item.target)}
            key={item.key}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function CacheRepairPlan({
  sync,
  authenticated,
  saving,
  onPrepare,
  onQueue
}: {
  sync: DashboardSummary["sync"];
  authenticated: boolean;
  saving: boolean;
  onPrepare: (layers: ManualRefreshLayer[]) => void;
  onQueue: (layers: ManualRefreshLayer[]) => void;
}) {
  const recommendation = recommendCacheRepair(sync);
  if (recommendation.layers.length === 0) {
    return null;
  }

  return (
    <div className="cache-repair-plan">
      <div className="cache-repair-plan-heading">
        <div>
          <Text strong>Repair plan</Text>
          <Text type="secondary">
            Suggested worker layers based on the sampled stale or incomplete objects and sync health.
          </Text>
        </div>
        <Tooltip title={authenticated ? "Queue these repair layers" : "Connect GitHub token first"}>
          <Space size={6}>
            <Button
              size="small"
              type="primary"
              icon={<RefreshCcw size={14} />}
              disabled={!authenticated}
              loading={saving}
              onClick={() => onQueue(recommendation.layers)}
            >
              Queue repair
            </Button>
            <Button size="small" disabled={!authenticated} onClick={() => onPrepare(recommendation.layers)}>
              Edit layers
            </Button>
          </Space>
        </Tooltip>
      </div>
      <Space size={[4, 4]} wrap>
        {recommendation.layers.map((layer) => (
          <Tooltip title={manualRefreshLayerDescription(layer)} key={layer}>
            <Tag color={sync.health.find((item) => item.layer === layer)?.status === "success" ? "blue" : "orange"}>
              {labelText(layer)}
            </Tag>
          </Tooltip>
        ))}
      </Space>
      <div className="cache-repair-reasons">
        {recommendation.reasons.map((reason) => (
          <Text type="secondary" key={reason}>
            {reason}
          </Text>
        ))}
        {!authenticated ? (
          <Text type="secondary">Manual repair queueing requires a connected GitHub token.</Text>
        ) : null}
      </div>
    </div>
  );
}

function FreshnessStatusBar({
  freshness,
  sync,
  webhookReadiness,
  readModel,
  refreshing,
  autoRefreshError,
  lastLoadedAt,
  expanded,
  onExpandedChange,
  onOpenHealth,
  onOpenWebhooks
}: {
  freshness: FreshnessSummary;
  sync: DashboardSummary["sync"];
  webhookReadiness: WebhookReadinessSummary;
  readModel: DashboardReadModelMeta | null;
  refreshing: boolean;
  autoRefreshError: string | null;
  lastLoadedAt: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onOpenHealth: () => void;
  onOpenWebhooks: () => void;
}) {
  const problemLayers = sync.health.filter((item) => item.status !== "success" || item.skipped);

  return (
    <section className={`freshness-bar ${expanded ? "freshness-bar-expanded" : "freshness-bar-compact"}`}>
      <div className="freshness-topline">
        <Space className="freshness-main" size={[8, 8]} wrap>
          <Text strong>Data status</Text>
          <Tag color={freshness.tagColor}>{freshness.label}</Tag>
          {readModel ? (
            <Tooltip title={readModel.version ? `Read-model version ${readModel.version}` : "Read-model cache status"}>
              <Tag color={dashboardReadModelStatusColor(readModel.status)}>
                read model {dashboardReadModelStatusLabel(readModel.status)}
              </Tag>
            </Tooltip>
          ) : null}
          <Tag>generated {formatDate(sync.generatedAt)}</Tag>
          <button
            type="button"
            className={`freshness-chip freshness-chip-${webhookReadiness.tone}`}
            title={webhookReadiness.description}
            onClick={onOpenWebhooks}
          >
            {webhookStatusChipLabel(webhookReadiness)}
          </button>
          <button
            type="button"
            className={`freshness-chip ${sync.staleObjects > 0 ? "freshness-chip-attention" : "freshness-chip-good"}`}
            onClick={onOpenHealth}
          >
            {sync.staleObjects} stale
          </button>
          <button
            type="button"
            className={`freshness-chip ${sync.partialObjects > 0 ? "freshness-chip-attention" : "freshness-chip-good"}`}
            onClick={onOpenHealth}
          >
            {sync.partialObjects} incomplete
          </button>
          {problemLayers.length > 0 ? (
            <button type="button" className="freshness-chip freshness-chip-attention" onClick={onOpenHealth}>
              {problemLayers.length} sync warnings
            </button>
          ) : null}
          <Tag color={refreshing ? "blue" : autoRefreshError ? "orange" : "green"}>
            {refreshing ? "refreshing" : `auto ${Math.round(dashboardAutoRefreshMs / 1000)}s`}
          </Tag>
        </Space>
        <Button
          size="small"
          type="text"
          icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? "Hide sync details" : "Sync details"}
        </Button>
      </div>
      {expanded ? (
        <div className="freshness-detail">
          <Space className="freshness-meta" size={[4, 4]} wrap>
            <Tag color={freshness.oldestLayerSuccessAt ? "default" : "red"}>
              oldest sync {formatDate(freshness.oldestLayerSuccessAt)}
            </Tag>
            <Tag>loaded {formatDate(lastLoadedAt)}</Tag>
          </Space>
          <Space className="freshness-layers" size={[4, 4]} wrap>
            {sync.health.map((item) => (
              <Tooltip title={syncHealthTooltip(item)} key={item.layer}>
                <Tag color={syncHealthTagColor(item.status)}>
                  {labelText(item.layer)} {formatDate(item.lastSuccessfulAt)}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        </div>
      ) : null}
    </section>
  );
}

function webhookStatusChipLabel(readiness: WebhookReadinessSummary): string {
  if (readiness.mode === "polling_only") {
    return "updates: polling only";
  }
  if (readiness.mode === "waiting_for_delivery") {
    return "hook: waiting";
  }
  if (readiness.mode === "connected_waiting_for_activity") {
    return "hook: connected";
  }
  if (readiness.mode === "queued") {
    return "hook: queued";
  }
  if (readiness.mode === "failed") {
    return "hook: failed";
  }
  return "hook: receiving";
}

function CacheEvidenceBanner({
  cacheEvidence,
  sync,
  authenticated,
  saving,
  impactItems,
  expanded,
  onExpandedChange,
  onImpactSelect,
  onPrepare,
  onQueue
}: {
  cacheEvidence: CacheEvidenceSummary;
  sync: DashboardSummary["sync"];
  authenticated: boolean;
  saving: boolean;
  impactItems: CacheEvidenceImpactItem[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onImpactSelect: (target: CacheEvidenceImpactTarget) => void;
  onPrepare: (layers: ManualRefreshLayer[]) => void;
  onQueue: (layers: ManualRefreshLayer[]) => void;
}) {
  const compactDescription = "Cached facts remain visible; expand for affected conclusions and repair options.";
  const compactImpactItems = impactItems.slice(0, 4);
  const hiddenImpactItems = Math.max(0, impactItems.length - compactImpactItems.length);
  const compactRepair = recommendCacheRepair(sync);

  return (
    <Alert
      className={`band evidence-alert ${expanded ? "evidence-alert-expanded" : "evidence-alert-compact"}`}
      type={cacheEvidence.alertType}
      title={cacheEvidence.title}
      description={
        <Space orientation="vertical" size={expanded ? 8 : 6} className="full-width">
          <div className="evidence-alert-summary">
            <Text>{expanded ? cacheEvidence.description : compactDescription}</Text>
            <Button
              size="small"
              type="text"
              icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded ? "Hide evidence" : "Show evidence"}
            </Button>
          </div>
          {!expanded && (compactImpactItems.length > 0 || compactRepair.layers.length > 0) ? (
            <div className="evidence-alert-quick-row">
              {compactImpactItems.length > 0 ? (
                <div className="evidence-alert-impact-chips" aria-label="Affected boards">
                  <Text type="secondary">Board impact</Text>
                  <div>
                    {compactImpactItems.map((item) => (
                      <button
                        type="button"
                        className={`evidence-impact-chip evidence-impact-chip-${item.tone}`}
                        title={item.detail}
                        onClick={() => onImpactSelect(item.target)}
                        key={item.key}
                      >
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </button>
                    ))}
                    {hiddenImpactItems > 0 ? <Tag color="orange">+{hiddenImpactItems} more</Tag> : null}
                  </div>
                </div>
              ) : null}
              {compactRepair.layers.length > 0 ? (
                <Space size={6} wrap className="evidence-alert-repair-actions">
                  <Tooltip
                    title={authenticated ? "Queue the recommended cache repair layers" : "Connect GitHub token first"}
                  >
                    <Button
                      size="small"
                      type="primary"
                      icon={<RefreshCcw size={14} />}
                      disabled={!authenticated}
                      loading={saving}
                      onClick={() => onQueue(compactRepair.layers)}
                    >
                      Queue repair
                    </Button>
                  </Tooltip>
                  <Button size="small" disabled={!authenticated} onClick={() => onPrepare(compactRepair.layers)}>
                    Edit layers
                  </Button>
                </Space>
              ) : null}
            </div>
          ) : null}
          {expanded ? (
            <>
              {cacheEvidence.facts.length > 0 ? (
                <div className="evidence-detail-list">
                  <Text type="secondary">Evidence details</Text>
                  <Space size={[4, 4]} wrap>
                    {cacheEvidence.facts.map((fact) => (
                      <Tag key={fact}>{fact}</Tag>
                    ))}
                  </Space>
                </div>
              ) : null}
              {cacheEvidence.affectedConclusions.length > 0 ? (
                <div className="evidence-detail-list">
                  <Text type="secondary">Affected conclusions</Text>
                  <Space size={[4, 4]} wrap>
                    {cacheEvidence.affectedConclusions.map((item) => (
                      <Tag color={cacheEvidence.severity === "critical" ? "red" : "orange"} key={item}>
                        {item}
                      </Tag>
                    ))}
                  </Space>
                </div>
              ) : null}
              <CacheEvidenceSamples sync={sync} />
              <CacheEvidenceImpactBoard items={impactItems} onSelect={onImpactSelect} />
              <CacheRepairPlan
                sync={sync}
                authenticated={authenticated}
                saving={saving}
                onPrepare={onPrepare}
                onQueue={onQueue}
              />
              {cacheEvidence.recommendedAction ? <Text type="secondary">{cacheEvidence.recommendedAction}</Text> : null}
            </>
          ) : null}
        </Space>
      }
      showIcon
    />
  );
}

function UpdateRuntimeBanner({ data, onOpenHealth }: { data: DashboardSummary; onOpenHealth: () => void }) {
  const issues: Array<{ key: string; label: string; detail: string; color: string }> = [];
  if (data.sync.jobQueue.status === "attention") {
    issues.push({
      key: "queue",
      label: "queue",
      detail:
        data.sync.jobQueue.recommendedAction ??
        data.sync.jobQueue.latestFailure ??
        `${data.sync.jobQueue.failedJobs} failed jobs, ${data.sync.jobQueue.blockedJobs} blocked jobs, ${data.sync.jobQueue.staleLeases} stale leases.`,
      color: "orange"
    });
  }
  if (data.sync.worker.status !== "active") {
    issues.push({
      key: "worker",
      label: "worker",
      detail: workerStatusDescription(data.sync.worker),
      color: data.sync.worker.status === "failed" ? "red" : "orange"
    });
  }

  if (issues.length === 0) {
    return null;
  }

  return (
    <Alert
      className="band"
      type={issues.some((issue) => issue.color === "red") ? "error" : "warning"}
      title={issues.length === 1 ? `${issues[0].label} needs attention` : "Update pipeline needs attention"}
      description={
        <Space orientation="vertical" size={6} className="full-width">
          <Text>{issues[0].detail}</Text>
          {issues.length > 1 ? (
            <Space size={[4, 4]} wrap>
              {issues.map((issue) => (
                <Tooltip title={issue.detail} key={issue.key}>
                  <Tag color={issue.color}>{issue.label}</Tag>
                </Tooltip>
              ))}
            </Space>
          ) : null}
          <Button size="small" onClick={onOpenHealth}>
            Open Health
          </Button>
        </Space>
      }
      showIcon
    />
  );
}

type CriticalRiskTag = {
  key: string;
  label: string;
  color: string;
  tooltip?: string;
};

function criticalIssueDuration(issue: CriticalIssueView): string {
  return personalDurationText({ durationHours: issue.criticalAgeHours, durationKind: "critical_active" });
}

function severityShortLabel(severity: string | null): string {
  return severity?.replace("severity/", "") ?? "active";
}

function prCriticalIssueTooltip(issue: PrCriticalIssueContext): string {
  return [
    issue.title,
    `severity ${severityShortLabel(issue.severity)}`,
    `owner ${issue.ownerLogin ?? "unowned"}`,
    issue.aiEffortLabel,
    personalDurationText({ durationHours: issue.criticalAgeHours, durationKind: "critical_active" }),
    issue.criticalAgeEvidence === "missing_timeline" ? "duration evidence missing" : null,
    !issue.isComplete ? "issue cache incomplete" : null
  ]
    .filter((part): part is string => part !== null)
    .join(" | ");
}

function criticalIssueRiskTags(issue: CriticalIssueView): CriticalRiskTag[] {
  const tags: CriticalRiskTag[] = [];
  if (issue.ownerScope === "unowned") {
    tags.push({ key: "unowned", label: "unowned", color: "red", tooltip: ownerScopeTooltip(issue.ownerScope) });
  } else if (issue.ownerScope === "non_watched") {
    tags.push({
      key: "non-watched",
      label: "non-watched",
      color: "orange",
      tooltip: ownerScopeTooltip(issue.ownerScope)
    });
  }
  if (issue.workflowSkipped) {
    tags.push({ key: "skip", label: "skip automation", color: "default", tooltip: workflowSkipTooltip() });
  }
  if (issue.linkedPullRequests.length === 0) {
    tags.push({ key: "no-pr", label: "no linked PR", color: "orange" });
  }
  if (issue.criticalAgeEvidence === "missing_timeline") {
    tags.push({
      key: "timeline",
      label: "timeline missing",
      color: "gold",
      tooltip: "Severity promotion time is missing; active duration is unknown."
    });
  }
  if (!issue.isComplete) {
    tags.push({ key: "sync-pending", label: "issue detail sync pending", color: "gold" });
  }
  if (issue.syncError) {
    tags.push({ key: "sync-error", label: "sync error", color: "red", tooltip: issue.syncError });
  }
  for (const blocker of issue.blockers.filter((item) => item.severity !== "info").slice(0, 3)) {
    tags.push({
      key: blocker.key,
      label: labelText(blocker.key.split(":").at(-1) ?? blocker.key),
      color: blockerColor(blocker.severity),
      tooltip: blocker.message
    });
  }
  return tags;
}

function criticalIssueRiskScore(issue: CriticalIssueView): number {
  const blockerScore = issue.blockers.reduce((score, blocker) => {
    if (blocker.severity === "critical") {
      return score + 180;
    }
    if (blocker.severity === "warning") {
      return score + 100;
    }
    return score + 15;
  }, 0);
  return (
    (issue.severity === "severity/s-1" ? 700 : 0) +
    (issue.ownerScope === "unowned" ? 260 : 0) +
    (issue.ownerScope === "non_watched" ? 120 : 0) +
    (issue.workflowSkipped ? 40 : 0) +
    (issue.linkedPullRequests.length === 0 ? 120 : 0) +
    (issue.criticalAgeEvidence === "missing_timeline" ? 60 : 0) +
    (!issue.isComplete ? 30 : 0) +
    (issue.syncError ? 160 : 0) +
    blockerScore
  );
}

function sortCriticalIssuesForAction(issues: CriticalIssueView[]): CriticalIssueView[] {
  return [...issues].sort((left, right) => {
    const riskDelta = criticalIssueRiskScore(right) - criticalIssueRiskScore(left);
    if (riskDelta !== 0) {
      return riskDelta;
    }
    const durationDelta = (right.criticalAgeHours ?? -1) - (left.criticalAgeHours ?? -1);
    if (durationDelta !== 0) {
      return durationDelta;
    }
    return left.number - right.number;
  });
}

function criticalIssueNextAction(issue: CriticalIssueView): string {
  if (issue.ownerScope === "unowned") {
    return "Assign an owner";
  }
  if (issue.linkedPullRequests.length === 0) {
    return "Link execution PR";
  }
  if (issue.blockers.some((blocker) => blocker.relatedPrNumber !== null && blocker.severity !== "info")) {
    return "Unblock linked PR";
  }
  if (issue.workflowSkipped) {
    return "Manual follow-up";
  }
  if (issue.criticalAgeEvidence === "missing_timeline") {
    return "Confirm severity start";
  }
  return issue.severity === "severity/s-1" ? "Drive emergency closure" : "Drive active execution";
}

function CriticalIssueBoard({
  issues,
  aiFilter,
  scopeFilter,
  onAiFilterChange,
  onScopeFilterChange,
  onPreview
}: {
  issues: CriticalIssueView[];
  aiFilter: CriticalIssueAiFilter;
  scopeFilter: CriticalIssueScopeFilter;
  onAiFilterChange: (value: CriticalIssueAiFilter) => void;
  onScopeFilterChange: (value: CriticalIssueScopeFilter) => void;
  onPreview: (preview: TeamWorkPreview) => void;
}) {
  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active s-1/s0 issues" />;
  }
  const filteredIssues = filterCriticalIssues(issues, aiFilter, scopeFilter);
  const sMinusOneIssues = sortCriticalIssuesForAction(
    filteredIssues.filter((issue) => issue.severity === "severity/s-1")
  );
  const sZeroIssues = sortCriticalIssuesForAction(filteredIssues.filter((issue) => issue.severity === "severity/s0"));
  const otherCriticalIssues = sortCriticalIssuesForAction(
    filteredIssues.filter((issue) => issue.severity !== "severity/s-1" && issue.severity !== "severity/s0")
  );
  const missingTimeline = issues.filter((issue) => issue.criticalAgeEvidence === "missing_timeline").length;
  const noLinkedPr = issues.filter((issue) => issue.linkedPullRequests.length === 0).length;
  const ownerGaps = issues.filter((issue) => issue.ownerScope !== "watched").length;
  const skipped = issues.filter((issue) => issue.workflowSkipped).length;

  return (
    <div className="critical-board">
      <CriticalIssueFilterBar
        issues={issues}
        aiFilter={aiFilter}
        scopeFilter={scopeFilter}
        onAiFilterChange={onAiFilterChange}
        onScopeFilterChange={onScopeFilterChange}
      />
      <div className="critical-board-summary" aria-label="Active critical issue summary">
        <CriticalBoardStat
          label="shown"
          value={filteredIssues.length}
          tone={filteredIssues.length > 0 ? "attention" : "good"}
          active={scopeFilter === "all" && aiFilter === "all"}
          onClick={() => {
            onScopeFilterChange("all");
            onAiFilterChange("all");
          }}
        />
        <CriticalBoardStat
          label="s-1"
          value={issues.filter((issue) => issue.severity === "severity/s-1").length}
          tone="critical"
          active={scopeFilter === "s-1"}
          onClick={() => onScopeFilterChange("s-1")}
        />
        <CriticalBoardStat
          label="s0"
          value={issues.filter((issue) => issue.severity === "severity/s0").length}
          tone="attention"
          active={scopeFilter === "s0"}
          onClick={() => onScopeFilterChange("s0")}
        />
        <CriticalBoardStat
          label="no linked PR"
          value={noLinkedPr}
          tone={noLinkedPr > 0 ? "attention" : "good"}
          active={scopeFilter === "no_pr"}
          onClick={() => onScopeFilterChange("no_pr")}
        />
        <CriticalBoardStat
          label="timeline missing"
          value={missingTimeline}
          tone={missingTimeline > 0 ? "attention" : "good"}
          active={scopeFilter === "timeline_missing"}
          onClick={() => onScopeFilterChange("timeline_missing")}
        />
        <CriticalBoardStat
          label="owner gaps"
          value={ownerGaps}
          tone={ownerGaps > 0 ? "attention" : "good"}
          active={scopeFilter === "owner_gap"}
          onClick={() => onScopeFilterChange("owner_gap")}
        />
        <CriticalBoardStat
          label="skip automation"
          value={skipped}
          tone={skipped > 0 ? "muted" : "good"}
          active={scopeFilter === "skipped"}
          onClick={() => onScopeFilterChange("skipped")}
        />
      </div>
      <div className="critical-board-lanes">
        <CriticalIssueLane
          title="s-1 Emergency Lane"
          description="Highest-severity active issues. These should be reviewed before s0 work."
          issues={sMinusOneIssues}
          tone="critical"
          emptyText="No active s-1 issues"
          onPreview={(issue) => onPreview({ objectType: "issue", issue })}
        />
        <CriticalIssueLane
          title="s0 Execution Risks"
          description="s0 issues sorted by owner, linked PR, blocker, and evidence risk."
          issues={sZeroIssues}
          tone="attention"
          emptyText="No active s0 issues"
          overflowLabel="s0 issues"
          visibleLimit={10}
          onPreview={(issue) => onPreview({ objectType: "issue", issue })}
        />
        {otherCriticalIssues.length > 0 ? (
          <CriticalIssueLane
            title="Other Active Severity"
            description="Configured active severity labels outside s-1/s0."
            issues={otherCriticalIssues}
            tone="normal"
            emptyText="No other active severity issues"
            onPreview={(issue) => onPreview({ objectType: "issue", issue })}
          />
        ) : null}
      </div>
    </div>
  );
}

function CriticalBoardStat({
  label,
  value,
  tone,
  active = false,
  onClick
}: {
  label: string;
  value: number;
  tone: "critical" | "attention" | "good" | "muted";
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <small>{label}</small>
      {onClick ? <span className="critical-board-stat-action">Filter</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`critical-board-stat critical-board-stat-${tone} ${active ? "critical-board-stat-active" : ""}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <span className={`critical-board-stat critical-board-stat-${tone} ${active ? "critical-board-stat-active" : ""}`}>
      {content}
    </span>
  );
}

function PrBoardSummary({
  prs,
  filteredPrs,
  criticalIssuesByPr,
  scopeFilter,
  onScopeFilterChange
}: {
  prs: PendingPrView[];
  filteredPrs: PendingPrView[];
  criticalIssuesByPr: Map<number, PrCriticalIssueContext[]>;
  scopeFilter: PrScopeFilter;
  onScopeFilterChange: (value: PrScopeFilter) => void;
}) {
  const activeIssuePrs = prs.filter((pr) => prHasActiveIssue(pr, criticalIssuesByPr)).length;
  const attentionPrs = prs.filter((pr) => pr.attentionFlags.length > 0).length;
  const testingPrs = prs.filter(isTestingQueuePr).length;
  const staleTestingPrs = prs.filter(isTestingStalePr).length;
  const testingEvidenceGapPrs = prs.filter(isTestingEvidenceGapPr).length;
  const ciFailedPrs = prs.filter(prHasFailedCi).length;
  const requestedChangePrs = prs.filter(prHasRequestChanges).length;
  const conflictPrs = prs.filter(prHasConflict).length;
  const noIssuePrs = prs.filter(prHasNoLinkedIssue).length;
  const issueLinkPendingPrs = prs.filter(prIssueLinkUnknown).length;
  const evidencePendingPrs = prs.filter(prEvidencePending).length;
  const noActionPrs = prs.filter((pr) => pr.attentionFlags.includes("no_human_action_24h")).length;

  return (
    <div className="critical-board-summary pr-board-summary" aria-label="Pending PR summary">
      <CriticalBoardStat
        label="shown"
        value={filteredPrs.length}
        tone={filteredPrs.length > 0 ? "attention" : "good"}
        active={scopeFilter === "all"}
        onClick={() => onScopeFilterChange("all")}
      />
      <CriticalBoardStat
        label="active issue PR"
        value={activeIssuePrs}
        tone={activeIssuePrs > 0 ? "critical" : "good"}
        active={scopeFilter === "active_issue"}
        onClick={() => onScopeFilterChange("active_issue")}
      />
      <CriticalBoardStat
        label="attention"
        value={attentionPrs}
        tone={attentionPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "attention"}
        onClick={() => onScopeFilterChange("attention")}
      />
      <CriticalBoardStat
        label="issue in testing"
        value={testingPrs}
        tone={testingPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "testing"}
        onClick={() => onScopeFilterChange("testing")}
      />
      <CriticalBoardStat
        label="linked issue wait >24h"
        value={staleTestingPrs}
        tone={staleTestingPrs > 0 ? "critical" : "good"}
        active={scopeFilter === "stale_testing"}
        onClick={() => onScopeFilterChange("stale_testing")}
      />
      <CriticalBoardStat
        label="issue test evidence gap"
        value={testingEvidenceGapPrs}
        tone={testingEvidenceGapPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "testing_evidence_gap"}
        onClick={() => onScopeFilterChange("testing_evidence_gap")}
      />
      <CriticalBoardStat
        label="CI failed"
        value={ciFailedPrs}
        tone={ciFailedPrs > 0 ? "critical" : "good"}
        active={scopeFilter === "ci_failed"}
        onClick={() => onScopeFilterChange("ci_failed")}
      />
      <CriticalBoardStat
        label="request changes"
        value={requestedChangePrs}
        tone={requestedChangePrs > 0 ? "critical" : "good"}
        active={scopeFilter === "request_changes"}
        onClick={() => onScopeFilterChange("request_changes")}
      />
      <CriticalBoardStat
        label="conflict"
        value={conflictPrs}
        tone={conflictPrs > 0 ? "critical" : "good"}
        active={scopeFilter === "conflict"}
        onClick={() => onScopeFilterChange("conflict")}
      />
      <CriticalBoardStat
        label="unlinked after sync"
        value={noIssuePrs}
        tone={noIssuePrs > 0 ? "attention" : "good"}
        active={scopeFilter === "no_issue"}
        onClick={() => onScopeFilterChange("no_issue")}
      />
      <CriticalBoardStat
        label="issue link sync pending"
        value={issueLinkPendingPrs}
        tone={issueLinkPendingPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "issue_link_pending"}
        onClick={() => onScopeFilterChange("issue_link_pending")}
      />
      <CriticalBoardStat
        label="PR evidence pending"
        value={evidencePendingPrs}
        tone={evidencePendingPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "evidence_pending"}
        onClick={() => onScopeFilterChange("evidence_pending")}
      />
      <CriticalBoardStat
        label="no action 24h"
        value={noActionPrs}
        tone={noActionPrs > 0 ? "attention" : "good"}
        active={scopeFilter === "no_action_24h"}
        onClick={() => onScopeFilterChange("no_action_24h")}
      />
    </div>
  );
}

function PeopleBoardSummary({
  people,
  personalViews,
  filteredPeople,
  scopeFilter,
  onScopeFilterChange
}: {
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  filteredPeople: PersonSummary[];
  scopeFilter: PeopleScopeFilter;
  onScopeFilterChange: (value: PeopleScopeFilter) => void;
}) {
  const counts = peopleBoardScopeCounts(people, personalViews);

  return (
    <div className="critical-board-summary people-board-summary" aria-label="People summary">
      <CriticalBoardStat
        label="shown"
        value={filteredPeople.length}
        tone={filteredPeople.length > 0 ? "attention" : "good"}
        active={scopeFilter === "all"}
        onClick={() => onScopeFilterChange("all")}
      />
      <CriticalBoardStat
        label="s-1/s0"
        value={counts.critical}
        tone={counts.critical > 0 ? "critical" : "good"}
        active={scopeFilter === "critical"}
        onClick={() => onScopeFilterChange("critical")}
      />
      <CriticalBoardStat
        label="PR attention"
        value={counts.attention}
        tone={counts.attention > 0 ? "attention" : "good"}
        active={scopeFilter === "attention"}
        onClick={() => onScopeFilterChange("attention")}
      />
      <CriticalBoardStat
        label="triage"
        value={counts.triage}
        tone={counts.triage > 0 ? "attention" : "good"}
        active={scopeFilter === "triage"}
        onClick={() => onScopeFilterChange("triage")}
      />
      <CriticalBoardStat
        label="deferred"
        value={counts.deferred}
        tone={counts.deferred > 0 ? "attention" : "good"}
        active={scopeFilter === "deferred"}
        onClick={() => onScopeFilterChange("deferred")}
      />
      <CriticalBoardStat
        label="pending PR"
        value={counts.pending_pr}
        tone={counts.pending_pr > 0 ? "attention" : "good"}
        active={scopeFilter === "pending_pr"}
        onClick={() => onScopeFilterChange("pending_pr")}
      />
      <CriticalBoardStat
        label="issue testing"
        value={counts.testing}
        tone={counts.testing > 0 ? "attention" : "good"}
        active={scopeFilter === "testing"}
        onClick={() => onScopeFilterChange("testing")}
      />
      <CriticalBoardStat
        label="yesterday PR"
        value={counts.yesterday_pr}
        tone={counts.yesterday_pr > 0 ? "attention" : "good"}
        active={scopeFilter === "yesterday_pr"}
        onClick={() => onScopeFilterChange("yesterday_pr")}
      />
    </div>
  );
}

function CriticalIssueLane({
  title,
  description,
  issues,
  tone,
  emptyText,
  overflowLabel = "issues",
  visibleLimit,
  onPreview
}: {
  title: string;
  description: string;
  issues: CriticalIssueView[];
  tone: "critical" | "attention" | "normal";
  emptyText: string;
  overflowLabel?: string;
  visibleLimit?: number;
  onPreview?: (issue: CriticalIssueView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = visibleLimit !== undefined && issues.length > visibleLimit;
  const visibleIssues = hasOverflow && !expanded ? issues.slice(0, visibleLimit) : issues;
  const hiddenCount = Math.max(0, issues.length - visibleIssues.length);

  return (
    <section className={`critical-lane critical-lane-${tone}`}>
      <div className="critical-lane-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>{issues.length}</Tag>
      </div>
      {visibleIssues.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <div className="critical-issue-list">
          {visibleIssues.map((issue) => (
            <CriticalIssueBoardRow issue={issue} key={issue.number} onPreview={onPreview} />
          ))}
        </div>
      )}
      {hiddenCount > 0 ? (
        <button type="button" className="critical-lane-more" onClick={() => setExpanded(true)}>
          <ChevronDown size={14} aria-hidden="true" />
          <span>
            Show {hiddenCount} more {overflowLabel}
          </span>
        </button>
      ) : hasOverflow && expanded ? (
        <button
          type="button"
          className="critical-lane-more critical-lane-more-muted"
          onClick={() => setExpanded(false)}
        >
          <ChevronUp size={14} aria-hidden="true" />
          <span>Show compact list</span>
        </button>
      ) : null}
    </section>
  );
}

function CriticalIssueBoardRow({
  issue,
  onPreview
}: {
  issue: CriticalIssueView;
  onPreview?: (issue: CriticalIssueView) => void;
}) {
  const riskTags = criticalIssueRiskTags(issue);
  const linkedPrs = issue.linkedPullRequests.slice(0, 3);
  return (
    <article
      className={`critical-issue-row critical-issue-row-${issue.severity === "severity/s-1" ? "critical" : "attention"}`}
    >
      <div className="critical-issue-main">
        <div className="critical-issue-object">
          <WorkObjectLink href={issue.htmlUrl} icon={<ShieldAlert size={15} aria-hidden="true" />}>
            Issue #{issue.number}
          </WorkObjectLink>
          <Tag color={severityColor(issue.severity)}>{issue.severity ?? "unknown"}</Tag>
        </div>
        <a className="critical-issue-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <div className="critical-issue-tags">
          <Tooltip title={issue.ownerReason ? `Owner derived by ${labelText(issue.ownerReason)}` : undefined}>
            <Tag color={ownerScopeColor(issue.ownerScope)}>{issue.ownerLogin ?? "unowned"}</Tag>
          </Tooltip>
          <Tag color={issue.criticalAgeHours === null ? "gold" : "red"}>{criticalIssueDuration(issue)}</Tag>
          <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag>
          {riskTags.slice(0, 5).map((tag) => (
            <Tooltip title={tag.tooltip} key={tag.key}>
              <Tag color={tag.color}>{tag.label}</Tag>
            </Tooltip>
          ))}
          {riskTags.length > 5 && onPreview ? (
            <LinkedOverflowButton
              ariaLabel={`Preview issue ${issue.number} with ${riskTags.length - 5} more risk signals`}
              count={riskTags.length - 5}
              label="more risks"
              onClick={() => onPreview(issue)}
            />
          ) : riskTags.length > 5 ? (
            <Tag>+{riskTags.length - 5}</Tag>
          ) : null}
        </div>
      </div>
      <div className="critical-issue-action">
        <div className="critical-issue-action-heading">
          <Text type="secondary">Next</Text>
          {onPreview ? (
            <Tooltip title={`Preview issue ${issue.number}`}>
              <Button
                aria-label={`Preview issue ${issue.number}`}
                icon={<Eye size={14} />}
                size="small"
                onClick={() => onPreview(issue)}
              />
            </Tooltip>
          ) : null}
        </div>
        <Text strong>{criticalIssueNextAction(issue)}</Text>
        {linkedPrs.length > 0 ? (
          <div className="critical-linked-prs">
            {linkedPrs.map((pr) => (
              <Tooltip title={linkedPrTooltip(pr)} key={pr.number}>
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                  PR #{pr.number}
                </a>
              </Tooltip>
            ))}
            {issue.linkedPullRequests.length > linkedPrs.length ? (
              onPreview ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - linkedPrs.length} more linked PRs`}
                  count={issue.linkedPullRequests.length - linkedPrs.length}
                  label="more PRs"
                  onClick={() => onPreview(issue)}
                />
              ) : (
                <span>+{issue.linkedPullRequests.length - linkedPrs.length}</span>
              )
            ) : null}
          </div>
        ) : (
          <Text type="secondary">No linked PR visible</Text>
        )}
      </div>
    </article>
  );
}

function isTestingQueuePr(pr: PendingPrView): boolean {
  return pr.testingQueueAgeHours !== null || pr.testingTesters.length > 0;
}

function isTestingStalePr(pr: PendingPrView): boolean {
  return pr.attentionFlags.includes("testing_stalled") || (pr.testingQueueAgeHours ?? 0) >= 24;
}

function isTestingEvidenceGapPr(pr: PendingPrView): boolean {
  return (
    isTestingQueuePr(pr) &&
    (pr.testingQueueAgeHours === null || !pr.isComplete || !pr.detailSyncedAt || pr.detailError !== null)
  );
}

function sortTestingQueuePrs<T extends PendingPrView>(prs: T[]): T[] {
  return [...prs].sort((left, right) => {
    const staleDelta = Number(isTestingStalePr(right)) - Number(isTestingStalePr(left));
    if (staleDelta !== 0) {
      return staleDelta;
    }
    const ageDelta = (right.testingQueueAgeHours ?? right.ageHours) - (left.testingQueueAgeHours ?? left.ageHours);
    if (ageDelta !== 0) {
      return ageDelta;
    }
    return left.number - right.number;
  });
}

function testingQueueAgeText(pr: PendingPrView): string {
  return pr.testingQueueAgeHours === null
    ? "issue test wait unknown"
    : `issue waiting ${hours(pr.testingQueueAgeHours)}`;
}

function testingQueueNextAction(pr: PendingPrView): string {
  if (pr.testingState === "test_changes_requested" || pr.reviewDecision === "changes_requested") {
    return "Handle requested changes";
  }
  if (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)) {
    return "Fix CI before test can finish";
  }
  if (pr.mergeStateStatus === "dirty") {
    return "Resolve merge conflict";
  }
  if (isTestingStalePr(pr)) {
    return "Check issue test status";
  }
  if (pr.testingState === "testing") {
    return "Check issue test status";
  }
  return "Confirm issue test status";
}

function testingQueueRiskTags(pr: PendingPrView): string[] {
  const tags = pr.attentionFlags.map(labelText);
  if (pr.testingQueueAgeHours === null) {
    tags.push("issue test wait unknown");
  }
  if (!pr.isComplete) {
    tags.push("PR detail sync pending");
  }
  if (pr.reviewDecision === "changes_requested") {
    tags.push("changes requested");
  }
  if (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)) {
    tags.push("CI failed");
  }
  if (pr.mergeStateStatus === "dirty") {
    tags.push("merge conflict");
  }
  return Array.from(new Set(tags));
}

function testingRiskColor(risk: string): string {
  const normalized = risk.toLowerCase();
  if (
    normalized.includes("stalled") ||
    normalized.includes("changes") ||
    normalized.includes("failed") ||
    normalized.includes("conflict")
  ) {
    return "red";
  }
  if (normalized.includes("pending") || normalized.includes("unknown")) {
    return "gold";
  }
  return "orange";
}

function TestingCommandBoard({
  pendingPrs,
  testing,
  testingIssueFilter,
  onTestingIssueFilterChange,
  onOpenPrsFilter
}: {
  pendingPrs: PendingPrView[];
  testing: DashboardSummary["testing"];
  testingIssueFilter: TestingIssueQueueFilter;
  onTestingIssueFilterChange: (filter: TestingIssueQueueFilter) => void;
  onOpenPrsFilter: (scope: PrScopeFilter) => void;
}) {
  const queuePrs = sortTestingQueuePrs(pendingPrs.filter(isTestingQueuePr));
  const stalePrs = queuePrs.filter(isTestingStalePr);
  const evidenceGapPrs = queuePrs.filter(isTestingEvidenceGapPr);
  const activePrs = queuePrs.filter((pr) => !isTestingStalePr(pr) && !isTestingEvidenceGapPr(pr));
  const partialIssueTransitions = testing.recentIssueTransitions.filter(
    (transition) => transition.sourceCompleteness === "partial_cache"
  ).length;
  const hasTurnoverHistory = testing.issueTransitionEvents > 0 || testing.handoffToCloseSamples > 0;
  const testerRows = [...testing.testers]
    .sort((left, right) => {
      const queueDelta = right.queueIssues - left.queueIssues;
      if (queueDelta !== 0) {
        return queueDelta;
      }
      return (right.averageIssueQueueAgeHours ?? 0) - (left.averageIssueQueueAgeHours ?? 0);
    })
    .slice(0, 8);
  const scrollToIssueQueue = () => {
    document.getElementById("testing-issue-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openIssueQueueFilter = (nextFilter: TestingIssueQueueFilter) => {
    onTestingIssueFilterChange(nextFilter);
    window.setTimeout(scrollToIssueQueue, 0);
  };

  if (testing.issues.length === 0 && queuePrs.length === 0 && testing.testers.length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issue is currently assigned to configured testers" />
    );
  }

  return (
    <div className="testing-command-board">
      <div className="testing-scope-note">
        <Text strong>An issue enters testing when it matches configured handoff rules.</Text>
        <Text type="secondary">
          Supported evidence is configured tester assignment or configured issue label. PR reviewer, assignee, label,
          and comment signals are PR-only evidence, not issue testing handoffs.
        </Text>
      </div>

      <div className="testing-command-summary" aria-label="Testing command summary">
        <TestingBoardStat
          label="issues in test"
          value={testing.queueIssues}
          tone="normal"
          active={testingIssueFilter === "all"}
          actionLabel="Filter"
          onClick={() => openIssueQueueFilter("all")}
        />
        <TestingBoardStat
          label="waiting >24h"
          value={testing.staleQueueIssues}
          tone="critical"
          active={testingIssueFilter === "stale"}
          actionLabel="Filter"
          onClick={() => openIssueQueueFilter("stale")}
        />
        <TestingBoardStat
          label="avg issue wait"
          value={testing.averageIssueQueueAgeHours === null ? "-" : hours(testing.averageIssueQueueAgeHours)}
          tone={
            testing.averageIssueQueueAgeHours !== null && testing.averageIssueQueueAgeHours >= 24
              ? "attention"
              : "normal"
          }
        />
        <TestingBoardStat
          label="linked PRs"
          value={testing.queuePrs}
          tone={testing.queuePrs > 0 ? "normal" : "muted"}
          actionLabel="Filter"
          onClick={testing.queuePrs > 0 ? () => onOpenPrsFilter("testing") : undefined}
        />
        <TestingBoardStat
          label="testers"
          value={testing.testers.length}
          tone="normal"
          actionLabel="View"
          onClick={scrollToIssueQueue}
        />
        <TestingBoardStat
          label="issue handoffs"
          value={testing.issueTransitionEvents}
          tone={testing.issueTransitionEvents > 0 ? "normal" : "muted"}
          actionLabel="View"
          onClick={testing.issueTransitionEvents > 0 ? scrollToIssueQueue : undefined}
        />
        <TestingBoardStat
          label="linked PR gaps"
          value={evidenceGapPrs.length}
          tone={evidenceGapPrs.length > 0 ? "attention" : "normal"}
          actionLabel="Filter"
          onClick={evidenceGapPrs.length > 0 ? () => onOpenPrsFilter("testing_evidence_gap") : undefined}
        />
        {hasTurnoverHistory ? (
          <TestingBoardStat
            label="handoff to close"
            value={testing.averageHandoffToCloseHours === null ? "-" : hours(testing.averageHandoffToCloseHours)}
            tone={
              testing.averageHandoffToCloseHours !== null && testing.averageHandoffToCloseHours >= 24
                ? "attention"
                : "normal"
            }
          />
        ) : null}
        {hasTurnoverHistory ? (
          <TestingBoardStat
            label="issue evidence gaps"
            value={partialIssueTransitions}
            tone={partialIssueTransitions > 0 ? "attention" : "normal"}
            actionLabel="Filter"
            onClick={partialIssueTransitions > 0 ? () => openIssueQueueFilter("data_gap") : undefined}
          />
        ) : null}
      </div>

      {testing.queueIssues > 0 || hasTurnoverHistory ? (
        <TestingTurnoverBreakdown testing={testing} partialIssueTransitions={partialIssueTransitions} />
      ) : null}

      <TestingIssueQueuePanel
        filter={testingIssueFilter}
        issues={testing.issues}
        onFilterChange={onTestingIssueFilterChange}
      />

      {testerRows.length > 0 ? (
        <div className="testing-tester-strip" id="testing-tester-queue" aria-label="Tester queue ownership">
          {testerRows.map((tester) => (
            <article className="testing-tester-card" key={tester.login}>
              <div>
                <Text strong>{tester.login}</Text>
                <Text type="secondary">{tester.queuePrs} linked PRs</Text>
              </div>
              <strong>
                {tester.averageIssueQueueAgeHours === null ? "-" : hours(tester.averageIssueQueueAgeHours)}
              </strong>
              <small>{tester.queueIssues} issues | avg wait</small>
            </article>
          ))}
        </div>
      ) : null}

      {queuePrs.length > 0 ? (
        <div className="testing-command-lanes">
          <TestingQueueLane
            title="Linked Issue Wait >24h"
            description="PRs whose linked issues are assigned to testers and have waited more than a day."
            prs={stalePrs}
            visibleLimit={8}
            tone="critical"
            emptyText="No issue in testing has waited more than a day"
          />
          <TestingQueueLane
            title="Linked PR Data Gaps"
            description="PRs whose linked issue is in testing but cached wait time or PR details are incomplete."
            prs={evidenceGapPrs}
            visibleLimit={6}
            tone="attention"
            emptyText="No linked PR data gaps in cached pending PRs"
          />
          <TestingQueueLane
            title="PRs With Linked Issue In Test"
            description="PRs attached to issues already assigned to testers, without current blocker evidence."
            prs={activePrs}
            visibleLimit={6}
            tone="normal"
            emptyText="No active linked-issue test movement outside waiting lanes"
          />
        </div>
      ) : null}
    </div>
  );
}

type TestingIssueQueueFilter = "all" | "stale" | "attention" | "unlinked" | "data_gap";
type TestingIssueQueueSort = "priority" | "wait" | "number";

function testingIssueHasDataGap(issue: TestingIssueQueueView): boolean {
  return issue.queueAgeEvidence === "issue_cache_timestamp" || !issue.isComplete || issue.syncError !== null;
}

function testingIssueMatchesFilter(issue: TestingIssueQueueView, filter: TestingIssueQueueFilter): boolean {
  if (filter === "stale") {
    return isTestingIssueStale(issue);
  }
  if (filter === "attention") {
    return testingIssueNeedsAttention(issue);
  }
  if (filter === "unlinked") {
    return issue.linkedPullRequests.length === 0;
  }
  if (filter === "data_gap") {
    return testingIssueHasDataGap(issue);
  }
  return true;
}

function sortTestingIssueQueue(issues: TestingIssueQueueView[], sort: TestingIssueQueueSort): TestingIssueQueueView[] {
  if (sort === "wait") {
    return [...issues].sort(
      (left, right) =>
        (right.queueAgeHours ?? 0) - (left.queueAgeHours ?? 0) ||
        testingIssueLinkedBlockerCount(right) - testingIssueLinkedBlockerCount(left) ||
        left.number - right.number
    );
  }
  if (sort === "number") {
    return [...issues].sort((left, right) => right.number - left.number);
  }
  return sortTestingIssuesForAction(issues);
}

function TestingIssueQueuePanel({
  filter,
  issues,
  onFilterChange
}: {
  filter: TestingIssueQueueFilter;
  issues: TestingIssueQueueView[];
  onFilterChange: (filter: TestingIssueQueueFilter) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<TestingIssueQueueSort>("priority");
  const [previewIssue, setPreviewIssue] = useState<TestingIssueQueueView | null>(null);
  const visibleLimit = 8;
  const filterCounts: Record<TestingIssueQueueFilter, number> = {
    all: issues.length,
    stale: issues.filter(isTestingIssueStale).length,
    attention: issues.filter(testingIssueNeedsAttention).length,
    unlinked: issues.filter((issue) => issue.linkedPullRequests.length === 0).length,
    data_gap: issues.filter(testingIssueHasDataGap).length
  };
  const sortedIssues = sortTestingIssueQueue(
    issues.filter((issue) => testingIssueMatchesFilter(issue, filter)),
    sort
  );
  const visibleIssues = expanded ? sortedIssues : sortedIssues.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, sortedIssues.length - visibleIssues.length);
  const changeFilter = (nextFilter: TestingIssueQueueFilter) => {
    onFilterChange(nextFilter);
    setExpanded(false);
  };
  const changeSort = (nextSort: TestingIssueQueueSort) => {
    setSort(nextSort);
    setExpanded(false);
  };

  if (issues.length === 0) {
    return null;
  }

  return (
    <section className="testing-issue-panel" id="testing-issue-queue" aria-label="Issue-level testing queue">
      <div className="testing-issue-panel-heading">
        <div>
          <Text strong>Issue Testing Queue</Text>
          <Text type="secondary">Issues assigned to configured testers. Linked PRs show execution and blockers.</Text>
        </div>
        <Tag color={sortedIssues.some(isTestingIssueStale) ? "red" : "blue"}>{sortedIssues.length} shown</Tag>
      </div>
      <div className="testing-issue-controls">
        <div className="board-filter-group">
          <button
            type="button"
            className={`inline-filter-chip ${filter === "all" ? "inline-filter-chip-active" : ""}`}
            onClick={() => changeFilter("all")}
          >
            All {filterCounts.all}
          </button>
          <button
            type="button"
            className={`inline-filter-chip ${
              filterCounts.stale > 0 ? "inline-filter-chip-red" : "inline-filter-chip-muted"
            } ${filter === "stale" ? "inline-filter-chip-active" : ""}`}
            onClick={() => changeFilter("stale")}
          >
            Waiting &gt;24h {filterCounts.stale}
          </button>
          <button
            type="button"
            className={`inline-filter-chip ${
              filterCounts.attention > 0 ? "inline-filter-chip-red" : "inline-filter-chip-muted"
            } ${filter === "attention" ? "inline-filter-chip-active" : ""}`}
            onClick={() => changeFilter("attention")}
          >
            Needs attention {filterCounts.attention}
          </button>
          <button
            type="button"
            className={`inline-filter-chip ${filter === "unlinked" ? "inline-filter-chip-active" : ""}`}
            onClick={() => changeFilter("unlinked")}
          >
            No linked PR {filterCounts.unlinked}
          </button>
          <button
            type="button"
            className={`inline-filter-chip ${filter === "data_gap" ? "inline-filter-chip-active" : ""}`}
            onClick={() => changeFilter("data_gap")}
          >
            Data gaps {filterCounts.data_gap}
          </button>
        </div>
        <Segmented
          value={sort}
          onChange={(value) => changeSort(value as TestingIssueQueueSort)}
          options={[
            { label: "Priority", value: "priority" },
            { label: "Wait", value: "wait" },
            { label: "Issue #", value: "number" }
          ]}
        />
      </div>
      {visibleIssues.length > 0 ? (
        <div className="testing-issue-list">
          {visibleIssues.map((issue) => (
            <TestingIssueQueueRow issue={issue} key={issue.number} onPreview={setPreviewIssue} />
          ))}
        </div>
      ) : (
        <div className="testing-issue-empty">
          <Text type="secondary">No issues match this filter</Text>
        </div>
      )}
      {hiddenCount > 0 ? (
        <button type="button" className="testing-issue-more" onClick={() => setExpanded(true)}>
          +{hiddenCount} more issues in test. Show all
        </button>
      ) : sortedIssues.length > visibleLimit && expanded ? (
        <button
          type="button"
          className="testing-issue-more testing-issue-more-muted"
          onClick={() => setExpanded(false)}
        >
          Show compact queue
        </button>
      ) : null}
      <TestingIssuePreviewModal issue={previewIssue} onClose={() => setPreviewIssue(null)} />
    </section>
  );
}

function TestingIssueQueueRow({
  issue,
  onPreview
}: {
  issue: TestingIssueQueueView;
  onPreview: (issue: TestingIssueQueueView) => void;
}) {
  const linkedBlockers = testingIssueLinkedBlockerCount(issue);

  return (
    <article className={`testing-issue-row ${isTestingIssueStale(issue) ? "testing-issue-row-critical" : ""}`}>
      <div className="testing-issue-main">
        <div className="testing-issue-title-row">
          <WorkObjectLink href={issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
            Issue #{issue.number}
          </WorkObjectLink>
          <Tag color={isTestingIssueStale(issue) ? "red" : "blue"}>{testingIssueWaitText(issue)}</Tag>
          <Tag color={testingIssueQueueAgeEvidenceColor(issue.queueAgeEvidence)}>
            {testingIssueQueueAgeEvidenceSourceLabel(issue.queueAgeEvidence)}
          </Tag>
          {!issue.isComplete ? <Tag color="gold">issue detail sync pending</Tag> : null}
          {issue.syncError ? (
            <Tooltip title={issue.syncError}>
              <Tag color="red">sync error</Tag>
            </Tooltip>
          ) : null}
          <Tooltip title="Preview issue">
            <Button
              aria-label={`Preview issue ${issue.number}`}
              icon={<Eye size={14} />}
              size="small"
              type="text"
              onClick={() => onPreview(issue)}
            />
          </Tooltip>
        </div>
        <a className="testing-issue-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <div className="testing-issue-meta">
          <span>
            {issue.testers.length > 0 ? `testers ${issue.testers.slice(0, 4).join(", ")}` : "no tester assigned"}
          </span>
          <span>{testingIssueHandoffSummary(issue)}</span>
          <span>{issue.linkedPullRequests.length} linked PRs</span>
          {linkedBlockers > 0 ? <span>{linkedBlockers} PR blockers</span> : null}
        </div>
      </div>
      <div className="testing-issue-prs">
        {issue.linkedPullRequests.length === 0 ? (
          <Text type="secondary">No linked PR visible</Text>
        ) : (
          issue.linkedPullRequests.slice(0, 5).map((pr) => (
            <Tooltip title={pr.title} key={pr.number}>
              <a
                className={
                  pr.attentionFlags.length > 0 ? "testing-issue-pr testing-issue-pr-attention" : "testing-issue-pr"
                }
                href={pr.htmlUrl}
                target="_blank"
                rel="noreferrer"
              >
                PR #{pr.number}
              </a>
            </Tooltip>
          ))
        )}
        {issue.linkedPullRequests.length > 5 ? (
          <LinkedOverflowButton
            ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - 5} more linked PRs`}
            count={issue.linkedPullRequests.length - 5}
            label="more PRs"
            onClick={() => onPreview(issue)}
          />
        ) : null}
      </div>
    </article>
  );
}

function TestingIssuePreviewModal({ issue, onClose }: { issue: TestingIssueQueueView | null; onClose: () => void }) {
  const [linkedPrsExpanded, setLinkedPrsExpanded] = useState(false);

  useEffect(() => {
    setLinkedPrsExpanded(false);
  }, [issue?.number]);

  if (!issue) {
    return null;
  }

  const linkedBlockers = testingIssueLinkedBlockerCount(issue);
  const linkedPullRequests = linkedPrsExpanded ? issue.linkedPullRequests : issue.linkedPullRequests.slice(0, 8);
  const hiddenLinkedPrCount = Math.max(0, issue.linkedPullRequests.length - linkedPullRequests.length);

  return (
    <Modal
      className="testing-issue-preview-modal"
      open
      width={760}
      title={`Issue #${issue.number}`}
      onCancel={onClose}
      footer={[
        <Button href={issue.htmlUrl} icon={<ExternalLink size={14} />} key="github" target="_blank">
          Open GitHub
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
    >
      <div className="testing-issue-preview">
        <a className="testing-issue-preview-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
        <Space size={[4, 4]} wrap>
          <Tag color={isTestingIssueStale(issue) ? "red" : "blue"}>{testingIssueWaitText(issue)}</Tag>
          <Tag color={testingIssueQueueAgeEvidenceColor(issue.queueAgeEvidence)}>
            {testingIssueQueueAgeEvidenceMetricLabel(issue.queueAgeEvidence)}
          </Tag>
          {linkedBlockers > 0 ? <Tag color="orange">{linkedBlockers} linked PR blockers</Tag> : null}
          {testingIssueHasDataGap(issue) ? <Tag color="gold">data gap</Tag> : null}
        </Space>

        <div className="testing-issue-preview-grid">
          <div className="testing-issue-preview-metric">
            <span>Wait</span>
            <strong>{issue.queueAgeHours === null ? "-" : hours(issue.queueAgeHours)}</strong>
            <small>
              {issue.queueStartedAt ? `since ${formatDate(issue.queueStartedAt)}` : "start time unavailable"}
            </small>
          </div>
          <div className="testing-issue-preview-metric">
            <span>Testers</span>
            <strong>{issue.testers.length}</strong>
            <small>{issue.testers.length > 0 ? issue.testers.join(", ") : "none in cache"}</small>
          </div>
          <div className="testing-issue-preview-metric">
            <span>Linked PRs</span>
            <strong>{issue.linkedPullRequests.length}</strong>
            <small>{linkedBlockers > 0 ? `${linkedBlockers} need attention` : "no linked PR blocker"}</small>
          </div>
        </div>

        <section className="testing-issue-preview-section">
          <Text strong>Handoff evidence</Text>
          {issue.testingSignals.length === 0 ? (
            <Text type="secondary">No configured issue testing signal is visible in cache.</Text>
          ) : (
            <Space size={[4, 4]} wrap>
              {issue.testingSignals.map((signal) => (
                <Tooltip title={testingSignalBusinessLabel(signal)} key={signal}>
                  <Tag color={testingSignalTagColor(signal)}>{testingSignalTagLabel(signal)}</Tag>
                </Tooltip>
              ))}
            </Space>
          )}
        </section>

        <section className="testing-issue-preview-section">
          <Text strong>Linked PRs</Text>
          {linkedPullRequests.length > 0 ? (
            <div className="testing-issue-preview-pr-list">
              {linkedPullRequests.map((pr) => (
                <a
                  className="testing-issue-preview-pr"
                  href={pr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={pr.number}
                >
                  <span>
                    <GitPullRequest size={14} aria-hidden="true" />
                    PR #{pr.number}
                  </span>
                  <strong>{pr.title}</strong>
                  <small>
                    owner {pr.ownerLogin} | age {hours(pr.ageHours)}
                  </small>
                  <Space size={[4, 4]} wrap>
                    {pr.reviewDecision === "changes_requested" ? <Tag color="red">changes requested</Tag> : null}
                    {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
                    {pr.mergeStateStatus ? (
                      <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
                    ) : null}
                    {!pr.isComplete ? <Tag color="gold">PR detail sync pending</Tag> : null}
                  </Space>
                </a>
              ))}
              {hiddenLinkedPrCount > 0 ? (
                <button type="button" className="team-object-preview-more" onClick={() => setLinkedPrsExpanded(true)}>
                  +{hiddenLinkedPrCount} more PRs. Show all
                </button>
              ) : issue.linkedPullRequests.length > 8 && linkedPrsExpanded ? (
                <button type="button" className="team-object-preview-more" onClick={() => setLinkedPrsExpanded(false)}>
                  Show compact PR list
                </button>
              ) : null}
            </div>
          ) : (
            <Text type="secondary">No linked PR is visible in cache.</Text>
          )}
        </section>
      </div>
    </Modal>
  );
}

function isTestingIssueStale(issue: TestingIssueQueueView): boolean {
  return (issue.queueAgeHours ?? 0) >= 24;
}

function testingIssueWaitText(issue: TestingIssueQueueView): string {
  return issue.queueAgeHours === null ? "wait unknown" : `waiting ${hours(issue.queueAgeHours)}`;
}

function TestingBoardStat({
  label,
  value,
  tone,
  active = false,
  actionLabel,
  onClick
}: {
  label: string;
  value: string | number;
  tone: "critical" | "attention" | "normal" | "muted";
  active?: boolean;
  actionLabel?: "Filter" | "View";
  onClick?: () => void;
}) {
  const content = (
    <>
      <strong>{value}</strong>
      <small>{label}</small>
      {onClick ? <span className="testing-board-stat-action">{actionLabel ?? "Open"}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`testing-board-stat testing-board-stat-${tone} ${active ? "testing-board-stat-active" : ""}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return <span className={`testing-board-stat testing-board-stat-${tone}`}>{content}</span>;
}

function TestingTurnoverBreakdown({
  testing,
  partialIssueTransitions
}: {
  testing: DashboardSummary["testing"];
  partialIssueTransitions: number;
}) {
  const handoffToCloseTone =
    testing.averageHandoffToCloseHours !== null && testing.averageHandoffToCloseHours >= 24 ? "attention" : "normal";

  return (
    <div className="testing-turnover-strip" aria-label="Testing turnover breakdown">
      <TestingTurnoverCard
        label="Current wait"
        value={testing.averageIssueQueueAgeHours === null ? "-" : hours(testing.averageIssueQueueAgeHours)}
        detail={`${testing.queueIssues} issues in test | ${testing.staleQueueIssues} waiting`}
        tone={testing.staleQueueIssues > 0 ? "critical" : testing.queueIssues > 0 ? "attention" : "normal"}
      />
      <TestingTurnoverCard
        label="Handoff to close"
        value={testing.averageHandoffToCloseHours === null ? "-" : hours(testing.averageHandoffToCloseHours)}
        detail={`${testing.handoffToCloseSamples} closed issue samples`}
        tone={handoffToCloseTone}
      />
      <TestingTurnoverCard
        label="Data gaps"
        value={partialIssueTransitions}
        detail="timeline evidence still backfilling"
        tone={partialIssueTransitions > 0 ? "attention" : "normal"}
      />
    </div>
  );
}

function TestingTurnoverCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "critical" | "attention" | "normal";
}) {
  return (
    <article className={`testing-turnover-card testing-turnover-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function TestingQueueLane({
  title,
  description,
  prs,
  tone,
  emptyText,
  visibleLimit
}: {
  title: string;
  description: string;
  prs: PendingPrView[];
  tone: "critical" | "attention" | "normal";
  emptyText: string;
  visibleLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = visibleLimit !== undefined && prs.length > visibleLimit;
  const visiblePrs = hasOverflow && !expanded ? prs.slice(0, visibleLimit) : prs;
  const hiddenCount = Math.max(0, prs.length - visiblePrs.length);

  return (
    <section className={`testing-queue-lane testing-queue-lane-${tone}`}>
      <div className="testing-queue-lane-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>{prs.length}</Tag>
      </div>
      {visiblePrs.length > 0 ? (
        <div className="testing-queue-list">
          {visiblePrs.map((pr) => (
            <TestingQueueRow pr={pr} key={pr.number} />
          ))}
        </div>
      ) : (
        <div className="testing-queue-empty">
          <Text type="secondary">{emptyText}</Text>
        </div>
      )}
      {hiddenCount > 0 ? (
        <button type="button" className="testing-queue-more" onClick={() => setExpanded(true)}>
          +{hiddenCount} more PRs. Show all in this lane
        </button>
      ) : hasOverflow && expanded ? (
        <button
          type="button"
          className="testing-queue-more testing-queue-more-muted"
          onClick={() => setExpanded(false)}
        >
          Show compact list
        </button>
      ) : null}
    </section>
  );
}

function TestingQueueRow({ pr }: { pr: PendingPrView }) {
  const risks = testingQueueRiskTags(pr);
  const issueLinks = pr.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));
  const [risksExpanded, setRisksExpanded] = useState(false);
  const [issueLinksExpanded, setIssueLinksExpanded] = useState(false);
  const visibleRisks = risksExpanded ? risks : risks.slice(0, 4);
  const hiddenRiskCount = Math.max(0, risks.length - visibleRisks.length);
  const visibleIssueLinks = issueLinksExpanded ? issueLinks : issueLinks.slice(0, 4);
  const hiddenIssueLinkCount = Math.max(0, issueLinks.length - visibleIssueLinks.length);

  return (
    <article className={`testing-queue-row ${isTestingStalePr(pr) ? "testing-queue-row-critical" : ""}`}>
      <div className="testing-queue-main">
        <div className="testing-queue-object">
          <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
            PR #{pr.number}
          </WorkObjectLink>
          <TestingStateTag state={pr.testingState} />
          <Tag>{testingQueueAgeText(pr)}</Tag>
          {!pr.isComplete ? <Tag color="gold">PR detail sync pending</Tag> : null}
        </div>
        <a className="testing-queue-title" href={pr.htmlUrl} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        <div className="testing-queue-meta">
          <span>
            <UserRound size={13} aria-hidden="true" />
            owner {pr.ownerLogin}
          </span>
          <span>last {formatDate(pr.lastHumanActionAt)}</span>
          {pr.testingTesters.length > 0 ? (
            <span>testers {pr.testingTesters.slice(0, 3).join(", ")}</span>
          ) : (
            <span>issue handoff evidence is on the linked issue</span>
          )}
        </div>
      </div>
      <div className="testing-queue-action">
        <Text type="secondary">Next</Text>
        <Text strong>{testingQueueNextAction(pr)}</Text>
        <div className="testing-queue-risks">
          {visibleRisks.map((risk) => (
            <Tag color={testingRiskColor(risk)} key={risk}>
              {risk}
            </Tag>
          ))}
          {hiddenRiskCount > 0 ? (
            <button type="button" className="linked-overflow-button" onClick={() => setRisksExpanded(true)}>
              +{hiddenRiskCount} more risks
            </button>
          ) : risks.length > 4 && risksExpanded ? (
            <button type="button" className="linked-overflow-button" onClick={() => setRisksExpanded(false)}>
              Show fewer risks
            </button>
          ) : null}
          {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
          {pr.mergeStateStatus ? (
            <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
          ) : null}
        </div>
        {issueLinks.length > 0 ? (
          <div className="testing-queue-links">
            {visibleIssueLinks.map((link) => (
              <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                issue #{link.number}
              </a>
            ))}
            {hiddenIssueLinkCount > 0 ? (
              <button type="button" className="linked-overflow-button" onClick={() => setIssueLinksExpanded(true)}>
                +{hiddenIssueLinkCount} more issues
              </button>
            ) : issueLinks.length > 4 && issueLinksExpanded ? (
              <button type="button" className="linked-overflow-button" onClick={() => setIssueLinksExpanded(false)}>
                Show fewer issues
              </button>
            ) : null}
          </div>
        ) : (
          <Text type="secondary">Issue link sync pending</Text>
        )}
      </div>
    </article>
  );
}

function PersonWorkloadBoard({
  people,
  personalViews,
  selectedLogin,
  onSelect,
  onMetricSelect,
  mode = "watched",
  compact = false
}: {
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  selectedLogin: string | null;
  onSelect: (login: string) => void;
  onMetricSelect?: (login: string, metric: PersonalDrilldownFilter) => void;
  mode?: "watched" | "observed";
  compact?: boolean;
}) {
  const personalByLogin = new Map(personalViews.map((person) => [person.login, person]));
  const sortedPeopleByWorkload = sortPeopleByWorkload(people);
  const sortedPeople =
    compact && selectedLogin
      ? [
          ...sortedPeopleByWorkload.filter((person) => person.login === selectedLogin),
          ...sortedPeopleByWorkload.filter((person) => person.login !== selectedLogin)
        ]
      : sortedPeopleByWorkload;

  if (sortedPeople.length === 0) {
    return (
      <Empty
        description={mode === "observed" ? "No active owners observed in visible cache" : "No watched users configured"}
      />
    );
  }

  return (
    <div className={`person-board${compact ? " person-board-compact" : ""}`} role="list">
      {sortedPeople.map((person) => {
        const personal = personalByLogin.get(person.login);
        const testingWork = personal ? personalTestingWorkCount(personal) : 0;
        const status = personWorkloadStatus(person);
        const reasons = personPrimaryReasons(person, testingWork);
        const focus = personCardFocus(person, personal);
        const selected = selectedLogin === person.login;
        const openMetric = (metric: PersonalDrilldownFilter) => {
          if (onMetricSelect) {
            onMetricSelect(person.login, metric);
            return;
          }
          onSelect(person.login);
        };

        return (
          <article className={`person-card person-card-${status}${selected ? " is-selected" : ""}`} key={person.login}>
            <button
              type="button"
              className="person-card-open"
              aria-pressed={selected}
              aria-label={
                mode === "observed" ? `Preview ${person.login} observed work` : `Open ${person.login} workbench`
              }
              onClick={() => onSelect(person.login)}
            >
              <span className="person-card-header">
                <span className="person-avatar" aria-hidden="true">
                  {person.login.slice(0, 1).toUpperCase()}
                </span>
                <span className="person-card-title">
                  <Text strong>{person.login}</Text>
                  <Tag color={workloadStatusColor(status)}>{workloadStatusText(status)}</Tag>
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`person-next-action person-next-action-${focus.tone}`}
              onClick={() => openMetric(focus.metric)}
              aria-label={`Open ${person.login} ${focus.title}`}
            >
              <span>Next action</span>
              <strong>{focus.title}</strong>
              <small>{focus.detail}</small>
            </button>
            <span className="person-stat-grid">
              <button
                type="button"
                onClick={() => openMetric("active_issues")}
                aria-label={`Open ${person.login} active s-1/s0 issues`}
              >
                <strong>{person.activeCriticalIssues}</strong>
                <small>s-1/s0</small>
              </button>
              <button
                type="button"
                onClick={() => openMetric("pr_attention")}
                aria-label={`Open ${person.login} PR attention items`}
              >
                <strong>{person.attentionPrs}</strong>
                <small>attention</small>
              </button>
              <button
                type="button"
                onClick={() => openMetric("triage")}
                aria-label={`Open ${person.login} needs triage issues`}
              >
                <strong>{person.needsTriageIssues}</strong>
                <small>triage</small>
              </button>
              <button
                type="button"
                onClick={() => openMetric("pending_pr")}
                aria-label={`Open ${person.login} pending PRs`}
              >
                <strong>{person.pendingPrs}</strong>
                <small>pending PR</small>
              </button>
              <button
                type="button"
                onClick={() => openMetric("testing")}
                aria-label={`Open ${person.login} issue testing`}
              >
                <strong>{testingWork}</strong>
                <small>issue test</small>
              </button>
              <button
                type="button"
                onClick={() => openMetric("yesterday_pr")}
                aria-label={`Open ${person.login} yesterday PR activity`}
              >
                <strong>
                  {person.prsCreatedYesterday}/{person.prsMergedYesterday}
                </strong>
                <small>PR yday</small>
              </button>
            </span>
            <span className="person-reasons">
              {reasons.slice(0, 3).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </span>
          </article>
        );
      })}
    </div>
  );
}

type ObservedThreadPullRequest = CriticalIssueLinkedPullRequestView | PendingPrView;

function ObservedPersonThreadBoard({ threads }: { threads: ObservedOwnerThread[] }) {
  const visibleThreads = threads.slice(0, 8);
  const hiddenThreads = Math.max(0, threads.length - visibleThreads.length);

  return (
    <section className="observed-thread-panel" aria-label="Observed issue and PR flow">
      <div className="observed-thread-panel-title">
        <span>
          <Text strong>Issue and PR Flow</Text>
          <Text type="secondary">Active issue first, then linked PR evidence</Text>
        </span>
        <Tag>{threads.length}</Tag>
      </div>
      <div className="observed-thread-list">
        {threads.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No visible issue or PR work for this owner" />
        ) : (
          visibleThreads.map((thread) => <ObservedPersonThreadRow thread={thread} key={thread.id} />)
        )}
      </div>
      {hiddenThreads > 0 ? (
        <Text type="secondary">{hiddenThreads} more rows are available in the detail lists below.</Text>
      ) : null}
    </section>
  );
}

function ObservedPersonThreadRow({ thread }: { thread: ObservedOwnerThread }) {
  const action = observedThreadAction(thread);
  const prs = observedThreadPullRequests(thread);
  const sourceUrl = thread.issue?.htmlUrl ?? prs[0]?.htmlUrl ?? null;

  return (
    <article className={`observed-thread-row observed-thread-row-${thread.tone}`}>
      <div className="observed-thread-main">
        <span className="observed-thread-title">
          {thread.issue ? (
            <a href={thread.issue.htmlUrl} target="_blank" rel="noreferrer">
              #{thread.issue.number} {thread.issue.title}
            </a>
          ) : (
            <span>PRs without a visible active issue</span>
          )}
        </span>
        <span className="observed-thread-meta">
          <Tag color={action.color}>{action.label}</Tag>
          <Text type="secondary">{observedThreadDurationText(thread)}</Text>
          {thread.issue?.aiEffortLabel ? <Tag>{effectiveAiEffortLabel(thread.issue.aiEffortLabel)}</Tag> : null}
          {thread.issue?.severity ? (
            <Tag color={severityColor(thread.issue.severity)}>{thread.issue.severity}</Tag>
          ) : null}
        </span>
      </div>
      <div className="observed-thread-links">
        {prs.length > 0 ? (
          prs.slice(0, 4).map((pr) => {
            const reasons = prAttentionReasons(pr as PendingPrView);
            return (
              <a className="observed-thread-pr" href={pr.htmlUrl} target="_blank" rel="noreferrer" key={pr.number}>
                <span>
                  PR #{pr.number}
                  {"state" in pr && pr.state === "closed" ? " closed" : ""}
                </span>
                <small>
                  {hours(pr.ageHours)} open
                  {reasons.length > 0 ? ` | ${reasons[0]}` : ""}
                </small>
              </a>
            );
          })
        ) : (
          <Text type="secondary">No visible PR linked to this active issue</Text>
        )}
        {prs.length > 4 ? <Tag>{prs.length - 4} more PRs</Tag> : null}
        {!thread.issue && thread.linkedIssueNumbers.length > 0 && sourceUrl ? (
          <span className="observed-thread-issues">
            {thread.linkedIssueNumbers.slice(0, 3).map((number) => (
              <a href={linkedObjectUrl(sourceUrl, "issues", number)} target="_blank" rel="noreferrer" key={number}>
                Issue #{number}
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function observedThreadPullRequests(thread: ObservedOwnerThread): ObservedThreadPullRequest[] {
  const byNumber = new Map<number, ObservedThreadPullRequest>();
  for (const pr of thread.issue?.linkedPullRequests ?? []) {
    byNumber.set(pr.number, pr);
  }
  for (const pr of thread.prs) {
    byNumber.set(pr.number, pr);
  }
  return [...byNumber.values()].sort(
    (left, right) =>
      right.attentionFlags.length - left.attentionFlags.length ||
      right.ageHours - left.ageHours ||
      left.number - right.number
  );
}

function observedThreadAction(thread: ObservedOwnerThread): { label: string; color: string } {
  const prs = observedThreadPullRequests(thread);
  if (thread.issue && thread.issue.criticalAgeHours === null) {
    return { label: "severity timeline missing", color: "orange" };
  }
  if (thread.needsLink && thread.issue) {
    return { label: "no visible PR", color: "red" };
  }
  if (thread.needsLink) {
    return { label: "confirm issue link", color: "orange" };
  }
  if (prs.some((pr) => prAttentionReasons(pr as PendingPrView).length > 0)) {
    return { label: "PR needs attention", color: "orange" };
  }
  if (thread.issue) {
    return { label: "active issue", color: "blue" };
  }
  return { label: "pending PR", color: "default" };
}

function observedThreadDurationText(thread: ObservedOwnerThread): string {
  if (thread.issue) {
    return thread.durationHours === null
      ? "severity start unknown"
      : `${hours(thread.durationHours)} since s-1/s0 start`;
  }
  return thread.durationHours === null ? "PR age unknown" : `${hours(thread.durationHours)} oldest PR`;
}

function ObservedPersonInlineWorkbench({
  preview,
  focus,
  onFocusChange,
  onOpenPreview
}: {
  preview: ObservedPersonPreview;
  focus: PersonalDrilldownFilter;
  onFocusChange: (filter: PersonalDrilldownFilter) => void;
  onOpenPreview: () => void;
}) {
  const focusedPrs = observedPersonPrsForFocus(preview, focus);

  return (
    <div className="observed-person-workbench">
      <section className="person-focus-header observed-person-focus-header">
        <div className="person-focus-title">
          <Avatar className="person-avatar-large">{preview.login.slice(0, 1).toUpperCase()}</Avatar>
          <div>
            <Title level={5}>{preview.login}</Title>
            <Text type="secondary">Observed owner from visible active issue and pending PR cache</Text>
          </div>
        </div>
        <Button size="small" icon={<Eye size={14} />} onClick={onOpenPreview}>
          Quick Preview
        </Button>
      </section>

      <div className="observed-person-summary observed-person-summary-actions">
        <button
          type="button"
          className={focus === "active_issues" ? "is-active" : ""}
          onClick={() => onFocusChange("active_issues")}
        >
          <strong>{preview.summary.activeCriticalIssues}</strong>
          <small>s-1/s0</small>
        </button>
        <button
          type="button"
          className={focus === "pr_attention" ? "is-active" : ""}
          onClick={() => onFocusChange("pr_attention")}
        >
          <strong>{preview.summary.attentionPrs}</strong>
          <small>PR attention</small>
        </button>
        <button
          type="button"
          className={focus === "pending_pr" ? "is-active" : ""}
          onClick={() => onFocusChange("pending_pr")}
        >
          <strong>{preview.summary.pendingPrs}</strong>
          <small>pending PR</small>
        </button>
        <button
          type="button"
          className={focus === "threads" ? "is-active" : ""}
          onClick={() => onFocusChange("threads")}
        >
          <strong>{preview.threads.length}</strong>
          <small>threads</small>
        </button>
      </div>

      <ObservedPersonThreadBoard threads={preview.threads} />
      <ObservedPersonDetailPanels
        issueTitle="Active s-1/s0 Issues"
        issues={preview.issues}
        prTitle={observedPersonPrPanelTitle(focus)}
        prs={focusedPrs}
      />
    </div>
  );
}

function observedPersonPrsForFocus(preview: ObservedPersonPreview, focus: PersonalDrilldownFilter): PendingPrView[] {
  if (focus === "pr_attention") {
    return preview.prs.filter((pr) => prAttentionReasons(pr).length > 0);
  }
  return preview.prs;
}

function observedPersonPrPanelTitle(focus: PersonalDrilldownFilter): string {
  if (focus === "pr_attention") {
    return "PRs Needing Attention";
  }
  if (focus === "pending_pr") {
    return "Pending PRs";
  }
  return "Visible PRs";
}

function ObservedPersonDetailPanels({
  issueTitle,
  issues,
  prTitle,
  prs
}: {
  issueTitle: string;
  issues: CriticalIssueView[];
  prTitle: string;
  prs: PendingPrView[];
}) {
  return (
    <div className="observed-person-columns">
      <ObservedPersonIssuePanel title={issueTitle} issues={issues} />
      <ObservedPersonPrPanel title={prTitle} prs={prs} />
    </div>
  );
}

function ObservedPersonIssuePanel({ title, issues }: { title: string; issues: CriticalIssueView[] }) {
  return (
    <section>
      <div className="observed-person-section-title">
        <Text strong>{title}</Text>
        <Tag>{issues.length}</Tag>
      </div>
      <div className="observed-person-list">
        {issues.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No visible active issue owned by this login" />
        ) : (
          issues.map((issue) => (
            <a className="observed-person-row" href={issue.htmlUrl} target="_blank" rel="noreferrer" key={issue.number}>
              <span className="observed-person-row-main">
                <span>
                  #{issue.number} {issue.title}
                </span>
                <small>
                  {issue.criticalAgeHours === null
                    ? "severity start unknown"
                    : `${hours(issue.criticalAgeHours)} since severity start`}
                </small>
              </span>
              <span className="observed-person-row-tags">
                {issue.severity ? <Tag color={severityColor(issue.severity)}>{issue.severity}</Tag> : null}
                <Tag color={issue.isComplete ? "green" : "orange"}>
                  {issue.isComplete ? "complete cache" : "incomplete cache"}
                </Tag>
                <ExternalLink size={13} aria-hidden="true" />
              </span>
            </a>
          ))
        )}
      </div>
    </section>
  );
}

function ObservedPersonPrPanel({ title, prs }: { title: string; prs: PendingPrView[] }) {
  return (
    <section>
      <div className="observed-person-section-title">
        <Text strong>{title}</Text>
        <Tag>{prs.length}</Tag>
      </div>
      <div className="observed-person-list">
        {prs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No visible pending PR by this login" />
        ) : (
          prs.map((pr) => {
            const reasons = prAttentionReasons(pr);
            return (
              <a className="observed-person-row" href={pr.htmlUrl} target="_blank" rel="noreferrer" key={pr.number}>
                <span className="observed-person-row-main">
                  <span>
                    #{pr.number} {pr.title}
                  </span>
                  <small>
                    {hours(pr.ageHours)} open | last human action {formatDate(pr.lastHumanActionAt)}
                  </small>
                </span>
                <span className="observed-person-row-tags">
                  {reasons.length > 0 ? (
                    reasons.slice(0, 2).map((reason) => (
                      <Tag color="orange" key={reason}>
                        {reason}
                      </Tag>
                    ))
                  ) : (
                    <Tag>no blocker</Tag>
                  )}
                  {pr.linkedIssueNumbers.length > 0 ? (
                    <Tag color="blue">#{pr.linkedIssueNumbers.slice(0, 2).join(", #")}</Tag>
                  ) : (
                    <Tag color={pr.isComplete ? "orange" : "default"}>
                      {pr.isComplete ? "unlinked" : "link sync pending"}
                    </Tag>
                  )}
                  <ExternalLink size={13} aria-hidden="true" />
                </span>
              </a>
            );
          })
        )}
      </div>
    </section>
  );
}

function ObservedPersonPreviewModal({
  preview,
  onClose
}: {
  preview: ObservedPersonPreview | null;
  onClose: () => void;
}) {
  return (
    <Modal
      title={preview ? `Observed owner: ${preview.login}` : "Observed owner"}
      open={Boolean(preview)}
      width={920}
      footer={<Button onClick={onClose}>Close</Button>}
      onCancel={onClose}
    >
      {preview ? (
        <Space orientation="vertical" size={14} className="observed-person-preview">
          <Alert
            type="info"
            showIcon
            title="Derived from visible issue and PR cache"
            description="Watched users are not configured, so this preview uses only current active s-1/s0 issue owners and pending PR authors. Configure watched users for triage, deferred, yesterday PR, tester workload, and personal analytics."
          />
          <div className="observed-person-summary" aria-label={`${preview.login} observed workload summary`}>
            <span>
              <strong>{preview.summary.activeCriticalIssues}</strong>
              <small>s-1/s0</small>
            </span>
            <span>
              <strong>{preview.summary.attentionPrs}</strong>
              <small>PR attention</small>
            </span>
            <span>
              <strong>{preview.summary.pendingPrs}</strong>
              <small>pending PR</small>
            </span>
          </div>
          <ObservedPersonThreadBoard threads={preview.threads} />
          <ObservedPersonDetailPanels
            issueTitle="Active s-1/s0 Issues"
            issues={preview.issues}
            prTitle="Pending PRs"
            prs={preview.prs}
          />
        </Space>
      ) : null}
    </Modal>
  );
}

function isCriticalIssueView(issue: CriticalIssueView | PersonalIssueView): issue is CriticalIssueView {
  return "linkedPullRequests" in issue;
}

type IssueListSort = "priority" | "duration" | "number";
type PullRequestListFilter = "all" | "attention" | "ci" | "review" | "merge" | "testing";
type PullRequestListSort = "age" | "last_action" | "number";

function issueCommentEvidenceDisplay(issue: CriticalIssueView | PersonalIssueView): {
  label: string;
  color: string;
  tooltip: string;
} | null {
  if (!("commentEvidence" in issue) || issue.lifecycleState !== "deferred") {
    return null;
  }

  const syncedAt = issue.commentEvidence.lastSyncedAt
    ? ` Last synced ${formatDate(issue.commentEvidence.lastSyncedAt)}.`
    : "";
  if (issue.commentEvidence.state === "complete") {
    return {
      label: "defer comments checked",
      color: "green",
      tooltip: `Issue comments are fully backfilled, so defer-reason checks can be trusted.${syncedAt}`
    };
  }
  if (issue.commentEvidence.state === "error") {
    return {
      label: "defer comment sync failed",
      color: "red",
      tooltip: issue.commentEvidence.syncError
        ? `Issue comment backfill failed: ${issue.commentEvidence.syncError}`
        : "Issue comment backfill failed."
    };
  }
  return {
    label: "defer comments pending",
    color: "gold",
    tooltip: `Backfill issue comments before treating a missing defer reason as confirmed.${syncedAt}`
  };
}

function issueAiFilterLabel(issue: CriticalIssueView | PersonalIssueView): string {
  if (isCriticalIssueView(issue)) {
    return effectiveAiEffortLabel(issue.aiEffortLabel);
  }
  return issue.labels.find((label) => label.startsWith("ai-")) ?? "ai-easy";
}

function issueListPriority(issue: CriticalIssueView | PersonalIssueView): number {
  if (isCriticalIssueView(issue)) {
    if (issue.severity === "severity/s-1") {
      return 50;
    }
    if (issue.severity === "severity/s0") {
      return 40;
    }
    return 30;
  }
  if (issue.lifecycleState === "needs-triage") {
    return 20;
  }
  if (issue.lifecycleState === "deferred") {
    return 5;
  }
  return 10;
}

function issueListDuration(issue: CriticalIssueView | PersonalIssueView): number {
  if (isCriticalIssueView(issue)) {
    return issue.criticalAgeHours ?? issue.ageHours;
  }
  return issue.ageHours;
}

function sortIssueList(
  issues: Array<CriticalIssueView | PersonalIssueView>,
  sort: IssueListSort
): Array<CriticalIssueView | PersonalIssueView> {
  return [...issues].sort((left, right) => {
    if (sort === "duration") {
      return issueListDuration(right) - issueListDuration(left) || right.number - left.number;
    }
    if (sort === "number") {
      return right.number - left.number;
    }
    return issueListPriority(right) - issueListPriority(left) || issueListDuration(right) - issueListDuration(left);
  });
}

function pullRequestMatchesListFilter(pr: PersonalPullRequestView, filter: PullRequestListFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "attention") {
    return prAttentionReasons(pr).length > 0 || isTestingQueuePr(pr);
  }
  if (filter === "ci") {
    return pr.ciState !== null && ["failure", "failed", "error", "timed_out", "action_required"].includes(pr.ciState);
  }
  if (filter === "review") {
    return pr.reviewDecision === "changes_requested";
  }
  if (filter === "merge") {
    return pr.mergeStateStatus === "dirty";
  }
  return isTestingQueuePr(pr);
}

function sortPullRequestList(prs: PersonalPullRequestView[], sort: PullRequestListSort): PersonalPullRequestView[] {
  return [...prs].sort((left, right) => {
    if (sort === "last_action") {
      return Date.parse(left.lastHumanActionAt) - Date.parse(right.lastHumanActionAt) || right.number - left.number;
    }
    if (sort === "number") {
      return right.number - left.number;
    }
    return right.ageHours - left.ageHours || right.number - left.number;
  });
}

function IssueWorkCard({
  issue,
  onPreview
}: {
  issue: CriticalIssueView | PersonalIssueView;
  onPreview?: (issue: CriticalIssueView | PersonalIssueView) => void;
}) {
  const critical = isCriticalIssueView(issue);
  const reasons = critical ? criticalIssueReasons(issue) : personalIssueReasons(issue);
  const commentEvidence = issueCommentEvidenceDisplay(issue);
  const durationText = critical
    ? personalDurationText({ durationHours: issue.criticalAgeHours, durationKind: "critical_active" })
    : hours(issue.ageHours);

  return (
    <article className={`work-item-card ${critical ? "work-item-critical" : ""}`}>
      <div className="work-item-header">
        <WorkObjectLink href={issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
          Issue #{issue.number}
        </WorkObjectLink>
        <Space size={[4, 4]} wrap>
          <Tag color={critical && issue.criticalAgeHours === null ? "gold" : undefined}>{durationText}</Tag>
          {onPreview ? (
            <Tooltip title={`Preview issue ${issue.number}`}>
              <Button
                aria-label={`Preview issue ${issue.number}`}
                icon={<Eye size={14} />}
                size="small"
                type="text"
                onClick={() => onPreview(issue)}
              />
            </Tooltip>
          ) : null}
        </Space>
      </div>
      <a className="work-item-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
        {issue.title}
      </a>
      <div className="work-tag-row">
        <Tag>{labelText(issue.lifecycleState)}</Tag>
        {issue.severity ? <Tag color={severityColor(issue.severity)}>{issue.severity}</Tag> : null}
        {critical ? <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag> : null}
        {critical && issue.criticalAgeEvidence === "missing_timeline" ? <Tag color="gold">timeline missing</Tag> : null}
        {critical && issue.lastHumanActionAt ? (
          <Tag color={issue.lastHumanActionEvidence === "complete_cache" ? "green" : "gold"}>
            last action {formatDate(issue.lastHumanActionAt)}
          </Tag>
        ) : null}
        {commentEvidence ? (
          <Tooltip title={commentEvidence.tooltip}>
            <Tag color={commentEvidence.color}>{commentEvidence.label}</Tag>
          </Tooltip>
        ) : null}
        {!issue.isComplete ? <Tag color="gold">issue detail sync pending</Tag> : null}
        {critical && issue.ownerLogin ? <Tag>{issue.ownerLogin}</Tag> : null}
        {critical && issue.workflowSkipped ? (
          <Tooltip title={workflowSkipTooltip()}>
            <Tag color="default">skip automation</Tag>
          </Tooltip>
        ) : null}
      </div>
      {critical && issue.linkedPullRequests.length > 0 ? (
        <div className="linked-pr-strip">
          {issue.linkedPullRequests.slice(0, 4).map((pr) => (
            <Tooltip title={linkedPrTooltip(pr)} key={pr.number}>
              <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                #{pr.number}
                {pr.testingState !== "not_ready" ? ` ${testingStateBusinessLabel(pr.testingState)}` : ""}
              </a>
            </Tooltip>
          ))}
          {issue.linkedPullRequests.length > 4 ? (
            onPreview ? (
              <LinkedOverflowButton
                ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - 4} more linked PRs`}
                count={issue.linkedPullRequests.length - 4}
                label="more PRs"
                onClick={() => onPreview(issue)}
              />
            ) : (
              <span>+{issue.linkedPullRequests.length - 4}</span>
            )
          ) : null}
        </div>
      ) : null}
      {reasons.length > 0 ? (
        <div className="work-reasons">
          {reasons.slice(0, 4).map((reason) => (
            <Tag color={reason.toLowerCase().includes("partial") ? "gold" : "orange"} key={reason}>
              {reason}
            </Tag>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PullRequestWorkCard({
  pr,
  emphasized = false,
  onPreview
}: {
  pr: PersonalPullRequestView;
  emphasized?: boolean;
  onPreview?: (pr: PersonalPullRequestView) => void;
}) {
  const attentionReasons = prAttentionReasons(pr);

  return (
    <article className={`work-item-card ${emphasized || attentionReasons.length > 0 ? "work-item-attention" : ""}`}>
      <div className="work-item-header">
        <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
          PR #{pr.number}
        </WorkObjectLink>
        <Space size={[4, 4]} wrap>
          <Tag>{hours(pr.ageHours)}</Tag>
          {onPreview ? (
            <Tooltip title={`Preview PR ${pr.number}`}>
              <Button
                aria-label={`Preview PR ${pr.number}`}
                icon={<Eye size={14} />}
                size="small"
                type="text"
                onClick={() => onPreview(pr)}
              />
            </Tooltip>
          ) : null}
        </Space>
      </div>
      <a className="work-item-title" href={pr.htmlUrl} target="_blank" rel="noreferrer">
        {pr.title}
      </a>
      <div className="work-tag-row">
        <Tag color={pr.state === "open" ? "green" : "default"}>{pr.state}</Tag>
        {pr.draft ? <Tag color="gold">draft</Tag> : null}
        {pr.reviewDecision ? (
          <Tag
            color={
              pr.reviewDecision === "changes_requested" ? "red" : pr.reviewDecision === "approved" ? "green" : "blue"
            }
          >
            {labelText(pr.reviewDecision)}
          </Tag>
        ) : null}
        {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
        {pr.mergeStateStatus ? (
          <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
        ) : null}
        {isTestingQueuePr(pr) ? <TestingStateTag state={pr.testingState} /> : null}
        {!pr.isComplete ? <Tag color="gold">PR detail sync pending</Tag> : null}
      </div>
      <div className="work-meta-row">
        <span>
          <UserRound size={13} aria-hidden="true" />
          {pr.ownerLogin}
        </span>
        <span>
          <TimerReset size={13} aria-hidden="true" />
          {formatDate(pr.lastHumanActionAt)}
        </span>
        {pr.mergedAt ? (
          <span>
            <GitMerge size={13} aria-hidden="true" />
            {formatDate(pr.mergedAt)}
          </span>
        ) : null}
      </div>
      {pr.testingTesters.length > 0 ? (
        <div className="work-tag-row">
          {pr.testingTesters.map((tester) => (
            <Tag key={tester}>{tester}</Tag>
          ))}
          {pr.testingQueueAgeHours !== null ? <Tag>{hours(pr.testingQueueAgeHours)}</Tag> : null}
        </div>
      ) : null}
      {attentionReasons.length > 0 ? (
        <div className="work-reasons">
          {attentionReasons.map((reason) => (
            <Tag
              color={
                reason.includes("failed") || reason.includes("conflict") || reason.includes("Changes")
                  ? "red"
                  : "orange"
              }
              key={reason}
            >
              {reason}
            </Tag>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function WorkLane({
  title,
  count,
  tone,
  children
}: {
  title: string;
  count: number;
  tone: "critical" | "attention" | "normal";
  children: ReactNode;
}) {
  return (
    <section className={`work-lane work-lane-${tone}`}>
      <div className="work-lane-heading">
        <Title level={5}>{title}</Title>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>{count}</Tag>
      </div>
      {children}
    </section>
  );
}

function IssueCardList({
  issues,
  emptyText,
  onPreview
}: {
  issues: Array<CriticalIssueView | PersonalIssueView>;
  emptyText: string;
  onPreview?: (issue: CriticalIssueView | PersonalIssueView) => void;
}) {
  const [aiFilter, setAiFilter] = useState("all");
  const [sort, setSort] = useState<IssueListSort>("priority");
  const aiOptions = Array.from(new Set(issues.map(issueAiFilterLabel))).sort();
  const filteredIssues = aiFilter === "all" ? issues : issues.filter((issue) => issueAiFilterLabel(issue) === aiFilter);
  const visibleIssues = sortIssueList(filteredIssues, sort);

  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <>
      {issues.length > 1 || aiOptions.length > 1 ? (
        <div className="work-list-toolbar">
          <Segmented
            size="small"
            value={aiFilter}
            onChange={(value) => setAiFilter(String(value))}
            options={[
              { label: `All ${issues.length}`, value: "all" },
              ...aiOptions.map((label) => ({
                label,
                value: label
              }))
            ]}
          />
          <Segmented
            size="small"
            value={sort}
            onChange={(value) => setSort(value as IssueListSort)}
            options={[
              { label: "Priority", value: "priority" },
              { label: "Duration", value: "duration" },
              { label: "#", value: "number" }
            ]}
          />
        </div>
      ) : null}
      {visibleIssues.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issues for this filter" />
      ) : (
        <div className="work-item-list">
          {visibleIssues.map((issue) => (
            <IssueWorkCard issue={issue} key={issue.number} onPreview={onPreview} />
          ))}
        </div>
      )}
    </>
  );
}

function PullRequestCardList({
  prs,
  emptyText,
  emphasized = false,
  onPreview
}: {
  prs: PersonalPullRequestView[];
  emptyText: string;
  emphasized?: boolean;
  onPreview?: (pr: PersonalPullRequestView) => void;
}) {
  const [filter, setFilter] = useState<PullRequestListFilter>("all");
  const [sort, setSort] = useState<PullRequestListSort>("age");
  const baseFilterOptions: Array<{ label: string; value: PullRequestListFilter }> = [
    { label: `All ${prs.length}`, value: "all" },
    { label: "Attention", value: "attention" },
    { label: "CI", value: "ci" },
    { label: "Review", value: "review" },
    { label: "Merge", value: "merge" },
    { label: "Issue in test", value: "testing" }
  ];
  const filterOptions = baseFilterOptions.filter(
    (option) => option.value === "all" || prs.some((pr) => pullRequestMatchesListFilter(pr, option.value))
  );
  const visiblePrs = sortPullRequestList(
    prs.filter((pr) => pullRequestMatchesListFilter(pr, filter)),
    sort
  );

  if (prs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <>
      {prs.length > 1 || filterOptions.length > 1 ? (
        <div className="work-list-toolbar">
          <Segmented
            size="small"
            value={filter}
            onChange={(value) => setFilter(value as PullRequestListFilter)}
            options={filterOptions}
          />
          <Segmented
            size="small"
            value={sort}
            onChange={(value) => setSort(value as PullRequestListSort)}
            options={[
              { label: "Age", value: "age" },
              { label: "Last action", value: "last_action" },
              { label: "#", value: "number" }
            ]}
          />
        </div>
      ) : null}
      {visiblePrs.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No PRs for this filter" />
      ) : (
        <div className="work-item-list">
          {visiblePrs.map((pr) => (
            <PullRequestWorkCard emphasized={emphasized} pr={pr} key={pr.number} onPreview={onPreview} />
          ))}
        </div>
      )}
    </>
  );
}

type PersonalActionQueueSort = "risk" | "duration" | "last_action";

function sortPersonalActionItemsForDisplay(
  items: PersonalActivityItem[],
  sort: PersonalActionQueueSort
): PersonalActivityItem[] {
  if (sort === "duration") {
    return [...items].sort((left, right) => {
      const leftDuration = left.durationHours ?? left.testingQueueAgeHours ?? left.ageHours;
      const rightDuration = right.durationHours ?? right.testingQueueAgeHours ?? right.ageHours;
      return rightDuration - leftDuration;
    });
  }
  if (sort === "last_action") {
    return [...items].sort((left, right) => {
      const leftTime = left.lastHumanActionAt ? Date.parse(left.lastHumanActionAt) : 0;
      const rightTime = right.lastHumanActionAt ? Date.parse(right.lastHumanActionAt) : 0;
      return leftTime - rightTime;
    });
  }
  return items;
}

function PersonalActionQueue({ items }: { items: PersonalActivityItem[] }) {
  const [queueFilter, setQueueFilter] = useState<PersonalActionQueueFilter>("all");
  const [queueSort, setQueueSort] = useState<PersonalActionQueueSort>("risk");
  const [previewItem, setPreviewItem] = useState<PersonalActivityItem | null>(null);

  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No current activity" />;
  }
  const counts = personalActionQueueCounts(items);
  const criticalItems = sortPersonalActionItemsForDisplay(
    items.filter((item) => item.tone === "critical"),
    queueSort
  );
  const attentionItems = sortPersonalActionItemsForDisplay(
    items.filter((item) => item.tone === "attention"),
    queueSort
  );
  const routineItems = sortPersonalActionItemsForDisplay(
    items.filter((item) => item.tone !== "critical" && item.tone !== "attention"),
    queueSort
  );
  const prItems = items.filter((item) => item.objectType === "pull_request");
  const testingItems = items.filter(
    (item) => item.durationKind === "testing_queue" || item.testingQueueAgeHours !== null
  );
  const blockedPrItems = prItems.filter(personalActivityHasBlockingSignal);
  const selectedItems = sortPersonalActionItemsForDisplay(
    personalActionQueueItemsForFilter(items, queueFilter),
    queueSort
  );
  const selectedTone = actionQueueToneForItems(selectedItems);

  return (
    <div className="activity-command-center">
      <div className="activity-summary-strip" aria-label="Personal activity summary">
        <ActivitySummaryTile
          label="All"
          value={counts.all}
          detail="full queue"
          tone="normal"
          active={queueFilter === "all"}
          onSelect={() => setQueueFilter("all")}
        />
        <ActivitySummaryTile
          label="S0/S-1"
          value={criticalItems.length}
          detail={criticalActivitySummary(criticalItems)}
          tone="critical"
          active={queueFilter === "critical"}
          onSelect={() => setQueueFilter("critical")}
        />
        <ActivitySummaryTile
          label="Blocked PRs"
          value={blockedPrItems.length}
          detail={`${attentionItems.length} attention`}
          tone="attention"
          active={queueFilter === "pr_blockers"}
          onSelect={() => setQueueFilter("pr_blockers")}
        />
        <ActivitySummaryTile
          label="Issue testing"
          value={testingItems.length}
          detail={optionalHours(maxTestingAge(testingItems))}
          tone="normal"
          active={queueFilter === "testing"}
          onSelect={() => setQueueFilter("testing")}
        />
        <ActivitySummaryTile
          label="Link gaps"
          value={counts.needs_link}
          detail="issue-PR gaps"
          tone={counts.needs_link > 0 ? "attention" : "muted"}
          active={queueFilter === "needs_link"}
          onSelect={() => setQueueFilter("needs_link")}
        />
      </div>
      <div className="action-queue-toolbar">
        <Text type="secondary">
          Showing {selectedItems.length} of {items.length} objects for {actionQueueFilterLabel(queueFilter)}
        </Text>
        <Segmented
          size="small"
          value={queueSort}
          onChange={(value) => setQueueSort(value as PersonalActionQueueSort)}
          options={[
            { label: "Risk", value: "risk" },
            { label: "Duration", value: "duration" },
            { label: "Last action", value: "last_action" }
          ]}
        />
      </div>
      {selectedItems.length > 0 ? <ActionQueueFocusStrip item={selectedItems[0]} onPreview={setPreviewItem} /> : null}
      {queueFilter === "all" ? (
        <div className="action-queue-sections" role="list" aria-label="Personal action queue">
          <ActionQueueSection
            title="Critical now"
            description="Active s-1/s0 issues that should drive the day."
            items={criticalItems}
            offset={0}
            tone="critical"
            onPreview={setPreviewItem}
          />
          <ActionQueueSection
            title="Needs attention"
            description="PRs, issue testing, and triage items with blocking signals."
            items={attentionItems}
            offset={criticalItems.length}
            tone="attention"
            visibleLimit={8}
            onPreview={setPreviewItem}
          />
          <ActionQueueSection
            title="Routine movement"
            description="Pending, deferred, created, or merged work to keep rotating."
            items={routineItems}
            offset={criticalItems.length + attentionItems.length}
            tone="normal"
            visibleLimit={6}
            onPreview={setPreviewItem}
          />
        </div>
      ) : selectedItems.length === 0 ? (
        <div className="action-queue-empty" role="status">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`No ${actionQueueFilterLabel(queueFilter)}`} />
        </div>
      ) : (
        <div className="action-queue-sections" role="list" aria-label={`${actionQueueFilterLabel(queueFilter)} queue`}>
          <ActionQueueSection
            title={actionQueueFilterLabel(queueFilter)}
            description={actionQueueFilterDescription(queueFilter)}
            items={selectedItems}
            offset={0}
            tone={selectedTone}
            visibleLimit={10}
            onPreview={setPreviewItem}
          />
        </div>
      )}
      <PersonalActivityPreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
    </div>
  );
}

function ActionQueueFocusStrip({
  item,
  onPreview
}: {
  item: PersonalActivityItem;
  onPreview: (item: PersonalActivityItem) => void;
}) {
  const objectLabel = item.objectType === "pull_request" ? `PR #${item.number}` : `Issue #${item.number}`;
  const nextAction = personalActivityNextAction(item);
  const duration = personalDurationText(item);
  const linkCount = item.linkedIssueNumbers.length + item.linkedPullRequestNumbers.length;
  const linkSummary =
    linkCount === 0
      ? "No visible link"
      : `${item.linkedIssueNumbers.length} issue / ${item.linkedPullRequestNumbers.length} PR`;
  const lastAction = item.lastHumanActionAt ? formatDate(item.lastHumanActionAt) : "no human action";

  return (
    <section className={`action-queue-focus-strip action-queue-focus-${item.tone}`} aria-label="Top queue focus">
      <div className="action-queue-focus-main">
        <Text type="secondary">Top next action</Text>
        <strong>
          <TimerReset size={15} aria-hidden="true" />
          {nextAction}
        </strong>
        <a href={item.htmlUrl} target="_blank" rel="noreferrer">
          {objectLabel} - {item.title}
        </a>
      </div>
      <div className="action-queue-focus-facts">
        <span>
          <strong>{duration}</strong>
          <small>{labelText(item.durationEvidence)}</small>
        </span>
        <span>
          <strong>{linkSummary}</strong>
          <small>{personalActivityPrimarySignal(item)}</small>
        </span>
        <span>
          <strong>{lastAction}</strong>
          <small>last action</small>
        </span>
      </div>
      <Button size="small" icon={<Eye size={14} />} onClick={() => onPreview(item)}>
        Preview
      </Button>
    </section>
  );
}

function ActivitySummaryTile({
  label,
  value,
  detail,
  tone,
  active,
  onSelect
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "critical" | "attention" | "normal" | "muted";
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`activity-summary-tile activity-summary-${tone} ${active ? "activity-summary-active" : ""}`}
      aria-pressed={active}
      onClick={onSelect}
    >
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function actionQueueToneForItems(items: PersonalActivityItem[]): "critical" | "attention" | "normal" {
  if (items.some((item) => item.tone === "critical")) {
    return "critical";
  }
  if (items.some((item) => item.tone === "attention")) {
    return "attention";
  }
  return "normal";
}

function actionQueueFilterLabel(filter: PersonalActionQueueFilter): string {
  if (filter === "critical") {
    return "Critical now";
  }
  if (filter === "pr_blockers") {
    return "Blocked PRs";
  }
  if (filter === "issues") {
    return "Issue threads";
  }
  if (filter === "testing") {
    return "Issue testing";
  }
  if (filter === "prs") {
    return "PR rotation";
  }
  if (filter === "needs_link") {
    return "Needs link";
  }
  return "All activity";
}

function actionQueueFilterDescription(filter: PersonalActionQueueFilter): string {
  if (filter === "critical") {
    return "Active s-1/s0 issues and their execution gaps.";
  }
  if (filter === "pr_blockers") {
    return "Open PRs blocked by review, CI, merge, idle, or test signals.";
  }
  if (filter === "issues") {
    return "Visible issue work owned by this person.";
  }
  if (filter === "testing") {
    return "Issues currently in testing, plus linked PR evidence.";
  }
  if (filter === "prs") {
    return "All visible PR work for this person.";
  }
  if (filter === "needs_link") {
    return "Critical issues without execution PRs and PRs without visible issue links.";
  }
  return "All visible action objects.";
}

function ActionQueueSection({
  title,
  description,
  items,
  offset,
  tone,
  visibleLimit,
  onPreview
}: {
  title: string;
  description: string;
  items: PersonalActivityItem[];
  offset: number;
  tone: "critical" | "attention" | "normal";
  visibleLimit?: number;
  onPreview: (item: PersonalActivityItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = visibleLimit !== undefined && items.length > visibleLimit;
  const visibleItems = hasOverflow && !expanded ? items.slice(0, visibleLimit) : items;
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={`action-queue-section action-queue-section-${tone}`} role="listitem" aria-label={title}>
      <div className="action-queue-section-heading">
        <div className="action-queue-section-copy">
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <ActionQueueSectionStats hiddenCount={hiddenCount} items={visibleItems} tone={tone} />
      </div>
      {visibleItems.length > 0 ? (
        <div className="action-queue-section-list" role="list">
          {visibleItems.map((item, index) => (
            <PersonalActionQueueItem index={offset + index + 1} item={item} key={item.id} onPreview={onPreview} />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 ? (
        <button type="button" className="action-queue-more" onClick={() => setExpanded(true)}>
          {hiddenCount} more {title.toLowerCase()} objects. Show all
        </button>
      ) : hasOverflow && expanded ? (
        <button type="button" className="action-queue-more action-queue-more-muted" onClick={() => setExpanded(false)}>
          Show compact queue
        </button>
      ) : null}
    </section>
  );
}

function ActionQueueSectionStats({
  items,
  hiddenCount,
  tone
}: {
  items: PersonalActivityItem[];
  hiddenCount: number;
  tone: "critical" | "attention" | "normal";
}) {
  const oldestDuration = maxDuration(items);
  const hasCriticalActiveDuration = items.some((item) => item.durationKind === "critical_active");
  const hasTestingDuration = items.some((item) => item.durationKind === "testing_queue");
  const oldestAge = hasCriticalActiveDuration ? null : maxAge(items);
  const missingCriticalDuration = items.filter(
    (item) => item.durationKind === "critical_active" && item.durationHours === null
  ).length;
  const blocked = items.filter(personalActivityHasBlockingSignal).length;
  const needsLink = items.filter(personalActivityNeedsLink).length;
  const ageText =
    oldestDuration !== null
      ? `${hours(oldestDuration)} ${hasCriticalActiveDuration ? "active" : hasTestingDuration ? "test" : "duration"}`
      : oldestAge !== null
        ? `${hours(oldestAge)} oldest`
        : missingCriticalDuration > 0
          ? `${missingCriticalDuration} timeline missing`
          : null;

  return (
    <div className="action-queue-section-stats" aria-label={`${items.length + hiddenCount} queue objects`}>
      <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>
        {items.length + hiddenCount}
      </Tag>
      {ageText ? <span>{ageText}</span> : null}
      {blocked > 0 ? <span>{blocked} blocked</span> : null}
      {needsLink > 0 ? <span>{needsLink} need links</span> : null}
    </div>
  );
}

function PersonalActionQueueItem({
  item,
  index,
  onPreview
}: {
  item: PersonalActivityItem;
  index: number;
  onPreview: (item: PersonalActivityItem) => void;
}) {
  const icon =
    item.objectType === "pull_request" ? (
      <GitPullRequest size={15} aria-hidden="true" />
    ) : (
      <CircleAlert size={15} aria-hidden="true" />
    );
  const objectLabel = item.objectType === "pull_request" ? `PR #${item.number}` : `Issue #${item.number}`;
  const linkedIssueUrls = item.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(item.htmlUrl, "issues", number)
  }));
  const linkedPrUrls = item.linkedPullRequestNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(item.htmlUrl, "pull", number)
  }));
  const nextAction = personalActivityNextAction(item);
  const primarySignal = personalActivityPrimarySignal(item);
  const actionTone = item.tone === "critical" ? "red" : item.tone === "attention" ? "orange" : "blue";
  const duration = personalDurationText(item);
  const visibleReasons = item.reasons.slice(0, 4);
  const hiddenReasonCount = Math.max(0, item.reasons.length - visibleReasons.length);

  return (
    <article className={`action-queue-item action-queue-item-${item.tone}`} role="listitem">
      <div className="action-queue-rank">
        <span className="action-index">{index}</span>
        <span className="action-queue-type">{item.objectType === "pull_request" ? "PR" : "ISSUE"}</span>
      </div>
      <div className="action-queue-card-main">
        <div className="action-queue-card-header">
          <div className="action-queue-object">
            <div className="action-queue-title-row">
              <WorkObjectLink href={item.htmlUrl} icon={icon}>
                {objectLabel}
              </WorkObjectLink>
              <Tag color={actionTone}>{item.phase}</Tag>
              {item.severity ? <Tag color={severityColor(item.severity)}>{item.severity}</Tag> : null}
              {item.testingState && item.testingState !== "not_ready" ? (
                <TestingStateTag state={item.testingState} />
              ) : null}
              {!item.isComplete ? <Tag color="gold">cache sync pending</Tag> : null}
              <Tooltip title={`Preview ${objectLabel}`}>
                <Button
                  aria-label={`Preview ${objectLabel}`}
                  icon={<Eye size={14} />}
                  size="small"
                  onClick={() => onPreview(item)}
                />
              </Tooltip>
            </div>
            <a className="activity-title" href={item.htmlUrl} target="_blank" rel="noreferrer">
              {item.title}
            </a>
          </div>
          <div className="action-queue-object-meta">
            {item.ownerLogin ? (
              <span>
                <UserRound size={13} aria-hidden="true" />
                {item.ownerLogin}
              </span>
            ) : null}
            {item.lastHumanActionAt ? (
              <span>
                <UserRound size={13} aria-hidden="true" />
                last {formatDate(item.lastHumanActionAt)}
              </span>
            ) : null}
            {item.testingQueueAgeHours !== null ? (
              <span>
                <ClipboardCheck size={13} aria-hidden="true" />
                issue test {hours(item.testingQueueAgeHours)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="action-queue-decision-row">
          <span className="action-queue-next-action">
            <span className="action-queue-next-label">Next action</span>
            <strong>
              <TimerReset size={14} aria-hidden="true" />
              {nextAction}
            </strong>
          </span>
          <span className="action-queue-fact">
            <strong>{duration}</strong>
            <small>{labelText(item.durationEvidence)}</small>
          </span>
          <span className="action-queue-fact">
            <strong>
              {item.linkedIssueNumbers.length + item.linkedPullRequestNumbers.length === 0
                ? "No visible link"
                : `${item.linkedIssueNumbers.length} issue / ${item.linkedPullRequestNumbers.length} PR`}
            </strong>
            <small>{primarySignal}</small>
          </span>
        </div>
        <div className="action-queue-footer">
          <div className="action-queue-tags" aria-label="Queue evidence">
            {visibleReasons.map((reason) => (
              <Tag color={activityReasonColor(reason)} key={reason}>
                {reason}
              </Tag>
            ))}
            {hiddenReasonCount > 0 ? (
              <button type="button" className="linked-overflow-button" onClick={() => onPreview(item)}>
                +{hiddenReasonCount} more signals
              </button>
            ) : null}
            {item.ciState ? <Tag color={ciColor(item.ciState)}>ci {labelText(item.ciState)}</Tag> : null}
            {item.reviewDecision === "changes_requested" ? <Tag color="red">changes requested</Tag> : null}
            {item.mergeStateStatus === "dirty" ? <Tag color="red">merge conflict</Tag> : null}
          </div>
          <ActionQueueLinks issueLinks={linkedIssueUrls} prLinks={linkedPrUrls} />
        </div>
      </div>
    </article>
  );
}

function PersonalActivityPreviewModal({ item, onClose }: { item: PersonalActivityItem | null; onClose: () => void }) {
  if (!item) {
    return null;
  }

  const objectLabel = item.objectType === "pull_request" ? `PR #${item.number}` : `Issue #${item.number}`;
  const linkedIssueUrls = item.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(item.htmlUrl, "issues", number)
  }));
  const linkedPrUrls = item.linkedPullRequestNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(item.htmlUrl, "pull", number)
  }));
  const nextAction = personalActivityNextAction(item);
  const primarySignal = personalActivityPrimarySignal(item);

  return (
    <Modal
      className="team-object-preview-modal"
      open
      width={760}
      title={objectLabel}
      onCancel={onClose}
      footer={[
        <Button href={item.htmlUrl} icon={<ExternalLink size={14} />} key="github" target="_blank">
          Open GitHub
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
    >
      <div className="team-object-preview">
        <a className="team-object-preview-title" href={item.htmlUrl} target="_blank" rel="noreferrer">
          {item.title}
        </a>
        <Space size={[4, 4]} wrap>
          <Tag color={item.tone === "critical" ? "red" : item.tone === "attention" ? "orange" : "blue"}>
            {item.phase}
          </Tag>
          {item.ownerLogin ? <Tag>{item.ownerLogin}</Tag> : null}
          {item.severity ? <Tag color={severityColor(item.severity)}>{item.severity}</Tag> : null}
          {item.lifecycleState ? <Tag>{labelText(item.lifecycleState)}</Tag> : null}
          {item.testingState && item.testingState !== "not_ready" ? (
            <TestingStateTag state={item.testingState} />
          ) : null}
          {!item.isComplete ? <Tag color="gold">cache sync pending</Tag> : null}
        </Space>

        <div className="team-object-preview-grid">
          <div className="team-object-preview-metric">
            <span>Duration</span>
            <strong>{personalDurationText(item)}</strong>
            <small>{labelText(item.durationEvidence)}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Last action</span>
            <strong>{formatDate(item.lastHumanActionAt)}</strong>
            <small>{item.lastHumanActionAt ? "cached human activity" : "not visible in cache"}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Links</span>
            <strong>{item.linkedIssueNumbers.length + item.linkedPullRequestNumbers.length}</strong>
            <small>
              {item.linkedIssueNumbers.length} issue | {item.linkedPullRequestNumbers.length} PR
            </small>
          </div>
        </div>

        <section className="team-object-preview-section">
          <Text strong>Next action</Text>
          <Text>{nextAction}</Text>
          <Text type="secondary">{primarySignal}</Text>
        </section>

        {item.reasons.length > 0 ? (
          <section className="team-object-preview-section">
            <Text strong>Signals</Text>
            <Space size={[4, 4]} wrap>
              {item.reasons.map((reason) => (
                <Tag color={activityReasonColor(reason)} key={reason}>
                  {reason}
                </Tag>
              ))}
              {item.ciState ? <Tag color={ciColor(item.ciState)}>ci {labelText(item.ciState)}</Tag> : null}
              {item.reviewDecision === "changes_requested" ? <Tag color="red">changes requested</Tag> : null}
              {item.mergeStateStatus === "dirty" ? <Tag color="red">merge conflict</Tag> : null}
            </Space>
          </section>
        ) : null}

        <section className="team-object-preview-section">
          <Text strong>Linked work</Text>
          {linkedIssueUrls.length === 0 && linkedPrUrls.length === 0 ? (
            <Text type="secondary">No linked issue or PR is visible in cache.</Text>
          ) : (
            <Space size={[6, 6]} wrap>
              {linkedIssueUrls.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={`issue-${link.number}`}>
                  issue #{link.number}
                </a>
              ))}
              {linkedPrUrls.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={`pr-${link.number}`}>
                  PR #{link.number}
                </a>
              ))}
            </Space>
          )}
        </section>
      </div>
    </Modal>
  );
}

function ActionQueueLinks({
  issueLinks,
  prLinks
}: {
  issueLinks: Array<{ number: number; url: string }>;
  prLinks: Array<{ number: number; url: string }>;
}) {
  if (issueLinks.length === 0 && prLinks.length === 0) {
    return <span className="action-no-links">No linked object</span>;
  }

  return (
    <div className="action-queue-links">
      {issueLinks.length > 0 ? (
        <span>
          issues
          {issueLinks.map((link) => (
            <a href={link.url} target="_blank" rel="noreferrer" key={`issue-${link.number}`}>
              #{link.number}
            </a>
          ))}
        </span>
      ) : null}
      {prLinks.length > 0 ? (
        <span>
          PRs
          {prLinks.map((link) => (
            <a href={link.url} target="_blank" rel="noreferrer" key={`pr-${link.number}`}>
              #{link.number}
            </a>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function criticalActivitySummary(items: PersonalActivityItem[]): string {
  const oldest = maxDuration(items);
  if (oldest !== null) {
    return `${hours(oldest)} active`;
  }
  const missingTimeline = items.filter(
    (item) => item.durationKind === "critical_active" && item.durationHours === null
  ).length;
  if (missingTimeline > 0) {
    return `${missingTimeline} timeline missing`;
  }
  return "no active";
}

function maxAge(items: Array<Pick<PersonalActivityItem, "ageHours">>): number | null {
  if (items.length === 0) {
    return null;
  }
  return Math.max(...items.map((item) => item.ageHours));
}

function maxDuration(items: Array<Pick<PersonalActivityItem, "durationHours">>): number | null {
  const values = items
    .map((item) => item.durationHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(...values);
}

function maxTestingAge(items: Array<Pick<PersonalActivityItem, "testingQueueAgeHours">>): number | null {
  const values = items
    .map((item) => item.testingQueueAgeHours)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length === 0 ? null : Math.max(...values);
}

type PersonalFlowThreadSort = "risk" | "duration" | "pr_count";

function sortPersonalFlowThreads(rows: PersonalGanttRow[], sort: PersonalFlowThreadSort): PersonalGanttRow[] {
  if (sort === "duration") {
    return [...rows].sort((left, right) => (right.issue.durationHours ?? 0) - (left.issue.durationHours ?? 0));
  }
  if (sort === "pr_count") {
    return [...rows].sort((left, right) => right.prs.length - left.prs.length);
  }
  return rows;
}

function PersonalFlowMap({ chart }: { chart: PersonalGanttChart }) {
  const [threadFilter, setThreadFilter] = useState<PersonalFlowThreadFilter>("all");
  const [threadSort, setThreadSort] = useState<PersonalFlowThreadSort>("risk");
  const [previewThread, setPreviewThread] = useState<PersonalGanttRow | null>(null);

  if (chart.rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issue or PR flow data" />;
  }
  const counts = personalFlowThreadCounts(chart.rows);
  const filteredRows = sortPersonalFlowThreads(
    chart.rows.filter((row) => personalFlowThreadMatchesFilter(row, threadFilter)),
    threadSort
  );
  const criticalRows = filteredRows.filter((row) => row.tone === "critical");
  const attentionRows = filteredRows.filter((row) => row.tone === "attention");
  const routineRows = filteredRows.filter((row) => row.tone !== "critical" && row.tone !== "attention");

  return (
    <div className="flow-map">
      <div className="flow-map-summary">
        <button
          type="button"
          className={`flow-map-summary-button ${threadFilter === "all" ? "flow-map-summary-active" : ""}`}
          onClick={() => setThreadFilter("all")}
        >
          <strong>{counts.all}</strong> all threads
        </button>
        <button
          type="button"
          className={`flow-map-summary-button ${threadFilter === "critical" ? "flow-map-summary-active" : ""}`}
          onClick={() => setThreadFilter("critical")}
        >
          <strong>{counts.critical}</strong> critical
        </button>
        <button
          type="button"
          className={`flow-map-summary-button ${threadFilter === "blocked" ? "flow-map-summary-active" : ""}`}
          onClick={() => setThreadFilter("blocked")}
        >
          <strong>{counts.blocked}</strong> blocked PR
        </button>
        <button
          type="button"
          className={`flow-map-summary-button ${threadFilter === "testing" ? "flow-map-summary-active" : ""}`}
          onClick={() => setThreadFilter("testing")}
        >
          <strong>{counts.testing}</strong> testing
        </button>
        <button
          type="button"
          className={`flow-map-summary-button ${threadFilter === "needs_link" ? "flow-map-summary-active" : ""}`}
          onClick={() => setThreadFilter("needs_link")}
        >
          <strong>{counts.needs_link}</strong> needs link
        </button>
        <span className="flow-map-summary-static">
          <strong>{hours(chart.maxAgeHours)}</strong> oldest visible work
        </span>
        <Segmented
          size="small"
          value={threadSort}
          onChange={(value) => setThreadSort(value as PersonalFlowThreadSort)}
          options={[
            { label: "Risk", value: "risk" },
            { label: "Duration", value: "duration" },
            { label: "PR count", value: "pr_count" }
          ]}
        />
      </div>
      <div className="flow-map-filter-status">
        <Text type="secondary">
          Showing {filteredRows.length} of {chart.rows.length} threads for {personalFlowThreadFilterLabel(threadFilter)}
          .
        </Text>
      </div>
      {filteredRows.length > 0 ? <FlowThreadFocusStrip row={filteredRows[0]} onPreview={setPreviewThread} /> : null}
      <div className="flow-thread-sections" role="list" aria-label="Personal work threads">
        <FlowThreadSection
          title="Critical issue threads"
          description="Active s-1/s0 issue lanes and their visible execution PRs."
          rows={criticalRows}
          tone="critical"
          visibleLimit={6}
          onPreview={setPreviewThread}
        />
        <FlowThreadSection
          title="Attention threads"
          description="PR or issue lanes with blockers, issue testing, review, CI, or linking risks."
          rows={attentionRows}
          tone="attention"
          visibleLimit={6}
          onPreview={setPreviewThread}
        />
        <FlowThreadSection
          title="Routine threads"
          description="Open movement that should keep rotating after critical and blocked work."
          rows={routineRows}
          tone="normal"
          visibleLimit={8}
          onPreview={setPreviewThread}
        />
      </div>
      {filteredRows.length === 0 ? (
        <div className="flow-thread-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No work threads match this filter" />
        </div>
      ) : null}
      <FlowThreadPreviewModal row={previewThread} onClose={() => setPreviewThread(null)} />
    </div>
  );
}

function personalFlowThreadFilterLabel(filter: PersonalFlowThreadFilter): string {
  if (filter === "critical") {
    return "critical issue work";
  }
  if (filter === "blocked") {
    return "blocked PR or duration-risk work";
  }
  if (filter === "testing") {
    return "issue testing";
  }
  if (filter === "needs_link") {
    return "issue-PR linking gaps";
  }
  if (filter === "shared") {
    return "PRs linked to multiple issues";
  }
  return "all visible work";
}

function flowIssueDurationLabel(kind: PersonalGanttRow["issue"]["durationKind"]): string {
  if (kind === "critical_active") {
    return "s0/s-1";
  }
  if (kind === "testing_queue") {
    return "test wait";
  }
  if (kind === "pr_age") {
    return "PR age";
  }
  return "issue age";
}

function FlowThreadFocusStrip({
  row,
  onPreview
}: {
  row: PersonalGanttRow;
  onPreview: (row: PersonalGanttRow) => void;
}) {
  const statusCounts = flowThreadStatusCounts(row);
  const nextAction = flowThreadNextAction(row);
  const durationLabel = flowIssueDurationLabel(row.issue.durationKind);
  const objectHref = row.issue.htmlUrl ?? row.prs[0]?.htmlUrl ?? null;
  const objectLabel =
    row.issue.number !== null
      ? `Issue #${row.issue.number}`
      : row.prs.length > 0
        ? `${row.prs.length} visible PRs`
        : "Thread";

  return (
    <section className={`flow-thread-focus-strip flow-thread-focus-${row.tone}`} aria-label="Top work thread focus">
      <div className="flow-thread-focus-main">
        <Text type="secondary">Top work thread</Text>
        <strong>
          <TimerReset size={15} aria-hidden="true" />
          {nextAction}
        </strong>
        {objectHref ? (
          <a href={objectHref} target="_blank" rel="noreferrer">
            {objectLabel} - {row.issue.title}
          </a>
        ) : (
          <span>
            {objectLabel} - {row.issue.title}
          </span>
        )}
      </div>
      <div className="flow-thread-focus-facts">
        <span>
          <strong>{row.issue.durationHours === null ? "unknown" : hours(row.issue.durationHours)}</strong>
          <small>{durationLabel}</small>
        </span>
        <span>
          <strong>{statusCounts.prs}</strong>
          <small>visible PRs</small>
        </span>
        <span>
          <strong>{statusCounts.blockedPrs}</strong>
          <small>blocked</small>
        </span>
        <span>
          <strong>{statusCounts.testingIssues + statusCounts.testingPrs}</strong>
          <small>testing</small>
        </span>
      </div>
      <Button size="small" icon={<Eye size={14} />} onClick={() => onPreview(row)}>
        Preview
      </Button>
    </section>
  );
}

function FlowThreadSection({
  title,
  description,
  rows,
  tone,
  visibleLimit,
  onPreview
}: {
  title: string;
  description: string;
  rows: PersonalGanttRow[];
  tone: "critical" | "attention" | "normal";
  visibleLimit?: number;
  onPreview: (row: PersonalGanttRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOverflow = visibleLimit !== undefined && rows.length > visibleLimit;
  const visibleRows = hasOverflow && !expanded ? rows.slice(0, visibleLimit) : rows;
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className={`flow-thread-section flow-thread-section-${tone}`} role="listitem" aria-label={title}>
      <div className="flow-thread-section-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>{rows.length}</Tag>
      </div>
      {visibleRows.length > 0 ? (
        <div className="flow-thread-list" role="list">
          {visibleRows.map((row) => (
            <PersonalFlowThread row={row} key={row.id} onPreview={onPreview} />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 ? (
        <button type="button" className="flow-thread-more" onClick={() => setExpanded(true)}>
          {hiddenCount} more {title.toLowerCase()}. Show all
        </button>
      ) : hasOverflow && expanded ? (
        <button type="button" className="flow-thread-more flow-thread-more-muted" onClick={() => setExpanded(false)}>
          Show compact list
        </button>
      ) : null}
    </section>
  );
}

function PersonalFlowThread({ row, onPreview }: { row: PersonalGanttRow; onPreview: (row: PersonalGanttRow) => void }) {
  const reasons = flowThreadReasons(row);
  const nextAction = flowThreadNextAction(row);
  const durationWarnings = flowThreadDurationWarnings(row);
  const statusCounts = flowThreadStatusCounts(row);
  const testingWorkCount = statusCounts.testingIssues + statusCounts.testingPrs;
  const issueDurationLabel = flowIssueDurationLabel(row.issue.durationKind);
  const sourceUrl = row.issue.htmlUrl ?? row.prs[0]?.htmlUrl ?? null;
  const linkedIssueUrls = sourceUrl
    ? row.linkedIssueNumbers.map((number) => ({ number, url: linkedObjectUrl(sourceUrl, "issues", number) }))
    : [];
  const visibleSignals = reasons.slice(0, 4);
  const hiddenSignalCount = Math.max(0, reasons.length - visibleSignals.length);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expandedPrs, setExpandedPrs] = useState(false);
  const visiblePrs = expandedPrs ? row.prs : row.prs.slice(0, 6);
  const hiddenPrCount = Math.max(0, row.prs.length - visiblePrs.length);
  const issueNodeLabel =
    row.issue.number !== null
      ? `Issue #${row.issue.number}`
      : row.linkedIssueNumbers.length > 0
        ? `${row.linkedIssueNumbers.length} linked issues`
        : "No visible issue";
  const prNodeLabel = row.prs.length === 0 ? "No visible PR" : `${row.prs.length} visible PRs`;
  const visibleTopologyPrs = row.prs.slice(0, 4);
  const hiddenTopologyPrCount = Math.max(0, row.prs.length - visibleTopologyPrs.length);
  const showAllPrs = (): void => {
    setDetailsOpen(true);
    setExpandedPrs(true);
  };

  return (
    <article className={`flow-thread flow-thread-${row.tone}`} role="listitem">
      <div className="flow-thread-header">
        <div className="flow-thread-object">
          {row.issue.htmlUrl ? (
            <WorkObjectLink href={row.issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
              {row.title}
            </WorkObjectLink>
          ) : (
            <span>{row.title}</span>
          )}
          <Tag color={ganttToneColor(row.tone)}>{row.kind === "issue" ? "issue" : "PR group"}</Tag>
          <Tooltip title="Preview thread">
            <Button
              aria-label={`Preview ${row.title}`}
              icon={<Eye size={14} />}
              size="small"
              onClick={() => onPreview(row)}
            />
          </Tooltip>
        </div>
        <div className="flow-thread-next">
          <span>Next action</span>
          <strong>
            <TimerReset size={14} aria-hidden="true" />
            {nextAction}
          </strong>
        </div>
      </div>

      <div className="flow-thread-meta">
        {row.issue.htmlUrl ? (
          <a className="flow-thread-title" href={row.issue.htmlUrl} target="_blank" rel="noreferrer">
            {row.issue.title}
          </a>
        ) : (
          <span className="flow-thread-title flow-thread-title-muted">{row.issue.title}</span>
        )}
        <div className="flow-thread-tags">
          {row.issue.severity ? <Tag color={severityColor(row.issue.severity)}>{row.issue.severity}</Tag> : null}
          {row.issue.lifecycleState ? <Tag>{labelText(row.issue.lifecycleState)}</Tag> : null}
          {row.issue.aiEffortLabel ? <Tag color="blue">{row.issue.aiEffortLabel}</Tag> : null}
          <Tag color={row.issue.durationHours === null ? "gold" : undefined}>{personalDurationText(row.issue)}</Tag>
          <Tag>{labelText(row.issue.durationEvidence)}</Tag>
          {statusCounts.prs > 0 ? <Tag>{statusCounts.prs} PR</Tag> : null}
          {statusCounts.blockedPrs > 0 ? <Tag color="orange">{statusCounts.blockedPrs} blocked</Tag> : null}
          {statusCounts.testingIssues > 0 ? <Tag color="blue">{statusCounts.testingIssues} testing issue</Tag> : null}
          {statusCounts.testingPrs > 0 ? <Tag color="cyan">{statusCounts.testingPrs} linked PR</Tag> : null}
          {statusCounts.sharedPrs > 0 ? <Tag color="purple">{statusCounts.sharedPrs} shared</Tag> : null}
        </div>
      </div>

      <div className="flow-thread-topology" aria-label="Issue and PR relationship">
        <span className="flow-thread-node flow-thread-node-issue">{issueNodeLabel}</span>
        <span className="flow-thread-edge">links to</span>
        <span className={`flow-thread-node ${row.prs.length === 0 ? "flow-thread-node-gap" : "flow-thread-node-pr"}`}>
          {prNodeLabel}
        </span>
        <div className="flow-thread-topology-links">
          {linkedIssueUrls.length > 0 && row.kind !== "issue" ? (
            <span>
              issues
              {linkedIssueUrls.slice(0, 3).map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={`issue-${link.number}`}>
                  #{link.number}
                </a>
              ))}
              {linkedIssueUrls.length > 3 ? (
                <button type="button" onClick={() => onPreview(row)}>
                  +{linkedIssueUrls.length - 3}
                </button>
              ) : null}
            </span>
          ) : null}
          {visibleTopologyPrs.length > 0 ? (
            <span>
              PRs
              {visibleTopologyPrs.map((pr) => (
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer" key={`pr-${pr.number}`}>
                  #{pr.number}
                </a>
              ))}
              {hiddenTopologyPrCount > 0 ? (
                <button type="button" onClick={showAllPrs}>
                  +{hiddenTopologyPrCount}
                </button>
              ) : null}
            </span>
          ) : null}
          {statusCounts.sharedPrs > 0 ? (
            <span className="flow-thread-topology-flag">{statusCounts.sharedPrs} shared PR</span>
          ) : null}
          {statusCounts.unlinkedPrs > 0 ? (
            <span className="flow-thread-topology-flag">
              {statusCounts.unlinkedPrs} {statusCounts.unlinkedPrs === 1 ? "PR needs" : "PRs need"} issue link
            </span>
          ) : null}
        </div>
      </div>

      <div className="flow-thread-signals">
        <div className="flow-thread-facts">
          <span className="flow-thread-fact">
            <strong>{row.issue.durationHours === null ? "unknown" : hours(row.issue.durationHours)}</strong>
            <small>{issueDurationLabel}</small>
          </span>
          <span className="flow-thread-fact">
            <strong>{statusCounts.prs}</strong>
            <small>PRs</small>
          </span>
          <span className="flow-thread-fact">
            <strong>{statusCounts.blockedPrs}</strong>
            <small>blocked</small>
          </span>
          <span className="flow-thread-fact">
            <strong>{testingWorkCount}</strong>
            <small>testing</small>
          </span>
        </div>
        <div className="flow-signal-tags">
          {reasons.length === 0 ? <Tag color="green">clear</Tag> : null}
          {durationWarnings.map((warning) => (
            <Tag color="red" key={warning}>
              {warning}
            </Tag>
          ))}
          {visibleSignals.map((reason) => (
            <Tag color={activityReasonColor(reason)} key={reason}>
              {reason}
            </Tag>
          ))}
          {hiddenSignalCount > 0 ? (
            <button type="button" className="linked-overflow-button" onClick={() => onPreview(row)}>
              +{hiddenSignalCount} more signals
            </button>
          ) : null}
        </div>
        {linkedIssueUrls.length > 0 && row.kind !== "issue" ? (
          <div className="flow-linked-row">
            <span>Issues</span>
            {linkedIssueUrls.map((link) => (
              <a href={link.url} target="_blank" rel="noreferrer" key={`issue-${link.number}`}>
                #{link.number}
              </a>
            ))}
          </div>
        ) : null}
      </div>

      <FlowThreadTimeline row={row} />

      <button type="button" className="flow-thread-toggle" onClick={() => setDetailsOpen((open) => !open)}>
        {detailsOpen ? "Hide PR details" : "Show PR details"}
      </button>

      {detailsOpen ? (
        <div className="flow-thread-body flow-thread-body-pr-only">
          <div className="flow-pr-stack">
            {row.prs.length === 0 ? (
              <div className="flow-pr-empty">No linked PR visible</div>
            ) : (
              <>
                {visiblePrs.map((pr) => (
                  <FlowPrRow pr={pr} key={pr.number} />
                ))}
                {hiddenPrCount > 0 ? (
                  <button type="button" className="flow-pr-more" onClick={() => setExpandedPrs(true)}>
                    +{hiddenPrCount} more PRs. Show all
                  </button>
                ) : row.prs.length > 6 && expandedPrs ? (
                  <button
                    type="button"
                    className="flow-pr-more flow-pr-more-muted"
                    onClick={() => setExpandedPrs(false)}
                  >
                    Show compact PR list
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function FlowThreadPreviewModal({ row, onClose }: { row: PersonalGanttRow | null; onClose: () => void }) {
  const [previewPrsExpanded, setPreviewPrsExpanded] = useState(false);

  useEffect(() => {
    setPreviewPrsExpanded(false);
  }, [row?.id]);

  if (!row) {
    return null;
  }

  const reasons = flowThreadReasons(row);
  const warnings = flowThreadDurationWarnings(row);
  const statusCounts = flowThreadStatusCounts(row);
  const testingWorkCount = statusCounts.testingIssues + statusCounts.testingPrs;
  const nextAction = flowThreadNextAction(row);
  const sourceUrl = row.issue.htmlUrl ?? row.prs[0]?.htmlUrl ?? null;
  const linkedIssueUrls = sourceUrl
    ? row.linkedIssueNumbers.map((number) => ({ number, url: linkedObjectUrl(sourceUrl, "issues", number) }))
    : [];
  const previewPrs = previewPrsExpanded ? row.prs : row.prs.slice(0, 10);
  const hiddenPreviewPrCount = Math.max(0, row.prs.length - previewPrs.length);

  return (
    <Modal
      className="team-object-preview-modal"
      open
      width={840}
      title={row.title}
      onCancel={onClose}
      footer={[
        row.issue.htmlUrl ? (
          <Button href={row.issue.htmlUrl} icon={<ExternalLink size={14} />} key="issue" target="_blank">
            Open Issue
          </Button>
        ) : null,
        <Button key="close" type="primary" onClick={onClose}>
          Close
        </Button>
      ]}
    >
      <div className="team-object-preview">
        <div>
          {row.issue.htmlUrl ? (
            <a className="team-object-preview-title" href={row.issue.htmlUrl} target="_blank" rel="noreferrer">
              {row.issue.title}
            </a>
          ) : (
            <Text className="team-object-preview-title">{row.issue.title}</Text>
          )}
        </div>
        <Space size={[4, 4]} wrap>
          <Tag color={ganttToneColor(row.tone)}>{row.kind === "issue" ? "issue thread" : "PR group"}</Tag>
          {row.issue.severity ? <Tag color={severityColor(row.issue.severity)}>{row.issue.severity}</Tag> : null}
          {row.issue.lifecycleState ? <Tag>{labelText(row.issue.lifecycleState)}</Tag> : null}
          {row.issue.aiEffortLabel ? <Tag color="blue">{row.issue.aiEffortLabel}</Tag> : null}
          <Tag color={row.issue.durationHours === null ? "gold" : undefined}>{personalDurationText(row.issue)}</Tag>
          {statusCounts.sharedPrs > 0 ? <Tag color="purple">{statusCounts.sharedPrs} shared PR</Tag> : null}
        </Space>

        <div className="team-object-preview-grid">
          <div className="team-object-preview-metric">
            <span>Current lane</span>
            <strong>{row.issue.durationHours === null ? "unknown" : hours(row.issue.durationHours)}</strong>
            <small>{labelText(row.issue.durationEvidence)}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Linked PRs</span>
            <strong>{statusCounts.prs}</strong>
            <small>{statusCounts.blockedPrs > 0 ? `${statusCounts.blockedPrs} blocked` : "no PR blocker"}</small>
          </div>
          <div className="team-object-preview-metric">
            <span>Issue testing</span>
            <strong>{testingWorkCount}</strong>
            <small>{testingWorkCount > 0 ? "issue testing visible" : "not in test"}</small>
          </div>
        </div>

        <section className="team-object-preview-section">
          <Text strong>Next action</Text>
          <Text>{nextAction}</Text>
        </section>

        <section className="team-object-preview-section">
          <Text strong>Timeline</Text>
          <FlowThreadTimeline row={row} />
        </section>

        {warnings.length > 0 || reasons.length > 0 ? (
          <section className="team-object-preview-section">
            <Text strong>Signals</Text>
            <Space size={[4, 4]} wrap>
              {warnings.map((warning) => (
                <Tag color="red" key={warning}>
                  {warning}
                </Tag>
              ))}
              {reasons.map((reason) => (
                <Tag color={activityReasonColor(reason)} key={reason}>
                  {reason}
                </Tag>
              ))}
            </Space>
          </section>
        ) : null}

        <section className="team-object-preview-section">
          <Text strong>PR rotation</Text>
          {row.prs.length === 0 ? (
            <Text type="secondary">No linked PR is visible in cache.</Text>
          ) : (
            <div className="team-object-preview-list">
              {previewPrs.map((pr) => (
                <a
                  className="team-object-preview-linked"
                  href={pr.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  key={pr.number}
                >
                  <span>
                    <GitPullRequest size={14} aria-hidden="true" />
                    PR #{pr.number}
                  </span>
                  <strong>{pr.title}</strong>
                  <small>
                    owner {pr.ownerLogin} | age {hours(pr.startAgeHours)}
                    {pr.testingQueueAgeHours !== null ? ` | issue test wait ${hours(pr.testingQueueAgeHours)}` : ""}
                  </small>
                  <Space size={[4, 4]} wrap>
                    {pr.isShared ? <Tag color="purple">shared</Tag> : null}
                    {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
                    {pr.reviewDecision ? (
                      <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>
                        {labelText(pr.reviewDecision)}
                      </Tag>
                    ) : null}
                    {pr.mergeStateStatus ? (
                      <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
                    ) : null}
                    {pr.testingState !== "not_ready" ? <TestingStateTag state={pr.testingState} /> : null}
                  </Space>
                </a>
              ))}
              {hiddenPreviewPrCount > 0 ? (
                <button type="button" className="team-object-preview-more" onClick={() => setPreviewPrsExpanded(true)}>
                  +{hiddenPreviewPrCount} more PRs. Show all
                </button>
              ) : row.prs.length > 10 && previewPrsExpanded ? (
                <button type="button" className="team-object-preview-more" onClick={() => setPreviewPrsExpanded(false)}>
                  Show compact PR list
                </button>
              ) : null}
            </div>
          )}
        </section>

        {linkedIssueUrls.length > 0 && row.kind !== "issue" ? (
          <section className="team-object-preview-section">
            <Text strong>Linked issues</Text>
            <Space size={[6, 6]} wrap>
              {linkedIssueUrls.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                  issue #{link.number}
                </a>
              ))}
            </Space>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function FlowThreadTimeline({ row }: { row: PersonalGanttRow }) {
  const visiblePrs = row.prs.slice(0, 4);
  const hiddenPrs = Math.max(0, row.prs.length - visiblePrs.length);
  const issueLabel = row.issue.number === null ? "PR group" : `Issue #${row.issue.number}`;
  const issueDuration = row.issue.durationHours === null ? "unknown duration" : hours(row.issue.durationHours);
  const issueBarText =
    row.issue.durationKind === "critical_active"
      ? `s0/s-1 ${issueDuration}`
      : row.issue.durationKind === "testing_queue"
        ? `test ${issueDuration}`
        : issueDuration;
  const issueBarTitle = `${issueLabel} | ${row.issue.title} | ${issueDuration} | ${row.issue.durationEvidence}`;
  const issueBar = (
    <span
      className={`flow-timeline-bar flow-timeline-bar-${row.issue.tone}`}
      style={flowTimelineStyle(row.issue)}
      title={issueBarTitle}
    >
      <span>{issueBarText}</span>
    </span>
  );

  return (
    <div className="flow-thread-timeline" aria-label={`${row.title} issue and PR timeline`}>
      <div className="flow-timeline-axis" aria-hidden="true">
        <span>oldest</span>
        <span>now</span>
      </div>
      <div className="flow-timeline-row flow-timeline-row-issue">
        <span className="flow-timeline-label">{issueLabel}</span>
        <div className="flow-timeline-track">
          {row.issue.htmlUrl ? (
            <a href={row.issue.htmlUrl} target="_blank" rel="noreferrer" className="flow-timeline-link">
              {issueBar}
            </a>
          ) : (
            issueBar
          )}
        </div>
      </div>
      {visiblePrs.length === 0 ? (
        <div className="flow-timeline-row">
          <span className="flow-timeline-label">PR</span>
          <div className="flow-timeline-empty">No execution PR linked in cache</div>
        </div>
      ) : (
        visiblePrs.map((pr) => <FlowTimelinePrRow pr={pr} key={pr.number} />)
      )}
      {hiddenPrs > 0 ? <span className="flow-timeline-overflow">+{hiddenPrs} more PRs in the list</span> : null}
    </div>
  );
}

function FlowTimelinePrRow({ pr }: { pr: PersonalGanttPrBar }) {
  const title = [
    `PR #${pr.number}`,
    pr.title,
    `owner ${pr.ownerLogin}`,
    `age ${hours(pr.startAgeHours)}`,
    pr.testingQueueAgeHours !== null ? `issue test wait ${hours(pr.testingQueueAgeHours)}` : null,
    pr.reasons.length > 0 ? pr.reasons.join(", ") : null
  ]
    .filter((value): value is string => value !== null)
    .join(" | ");

  return (
    <div className="flow-timeline-row">
      <a className="flow-timeline-label flow-timeline-label-link" href={pr.htmlUrl} target="_blank" rel="noreferrer">
        PR #{pr.number}
      </a>
      <div className="flow-timeline-track">
        <a
          className={`flow-timeline-bar flow-timeline-bar-${pr.tone}`}
          href={pr.htmlUrl}
          target="_blank"
          rel="noreferrer"
          style={flowTimelineStyle(pr)}
          title={title}
        >
          <span>{hours(pr.startAgeHours)}</span>
        </a>
      </div>
    </div>
  );
}

function flowTimelineStyle(bar: { offsetPercent: number; widthPercent: number }) {
  return {
    left: `${bar.offsetPercent}%`,
    width: `${bar.widthPercent}%`
  };
}

function FlowPrRow({ pr }: { pr: PersonalGanttPrBar }) {
  const title = [
    `PR #${pr.number}`,
    pr.title,
    `owner ${pr.ownerLogin}`,
    `age ${hours(pr.startAgeHours)}`,
    pr.isShared ? `linked issues ${pr.linkedIssueNumbers.join(", ")}` : null,
    pr.reasons.length > 0 ? pr.reasons.join(", ") : null
  ]
    .filter((value): value is string => value !== null)
    .join(" | ");
  const linkedIssues = pr.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));

  return (
    <div className={`flow-pr-row flow-pr-row-${pr.tone}`}>
      <div className="flow-pr-row-main">
        <Tooltip title={title}>
          <a className="flow-pr-title" href={pr.htmlUrl} target="_blank" rel="noreferrer">
            PR #{pr.number} {pr.title}
          </a>
        </Tooltip>
        <div className="flow-pr-meta">
          <span>{pr.ownerLogin}</span>
          <span>{hours(pr.startAgeHours)}</span>
          {pr.isShared ? <Tag color="purple">shared</Tag> : null}
          {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
          {pr.reviewDecision ? (
            <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>{labelText(pr.reviewDecision)}</Tag>
          ) : null}
          {pr.testingState !== "not_ready" ? <TestingStateTag state={pr.testingState} /> : null}
        </div>
        {linkedIssues.length > 0 ? (
          <div className="flow-pr-links">
            <span>issues</span>
            {linkedIssues.slice(0, 4).map((link) => (
              <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                #{link.number}
              </a>
            ))}
            {linkedIssues.length > 4 ? <span>+{linkedIssues.length - 4}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="flow-pr-age">
        <div className="flow-age-track" aria-label={`PR ${pr.number} elapsed ${hours(pr.startAgeHours)}`}>
          <span
            className={`flow-age-fill flow-tone-${pr.tone}`}
            style={{ width: `${Math.max(4, pr.widthPercent)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function flowThreadReasons(row: PersonalGanttRow): string[] {
  return Array.from(new Set([...row.issue.reasons, ...row.prs.flatMap((pr) => pr.reasons)])).filter(
    (reason) => !["ai-easy", "ai-light", "ai-medium", "ai-heavy", "ai-manual"].includes(reason)
  );
}

function ganttToneColor(tone: PersonalGanttRow["tone"]): string {
  if (tone === "critical") {
    return "red";
  }
  if (tone === "attention") {
    return "orange";
  }
  if (tone === "muted") {
    return "default";
  }
  return "blue";
}

function linkedObjectUrl(sourceUrl: string, kind: "issues" | "pull", number: number): string {
  return sourceUrl.replace(/\/(?:issues|pull)\/\d+$/, `/${kind}/${number}`);
}

function activityToneColor(tone: PersonalActivityItem["tone"]): string {
  if (tone === "critical") {
    return "red";
  }
  if (tone === "attention") {
    return "orange";
  }
  if (tone === "muted") {
    return "default";
  }
  return "blue";
}

function activityReasonColor(reason: string): string {
  const normalized = reason.toLowerCase();
  if (normalized.includes("failed") || normalized.includes("conflict") || normalized.includes("changes requested")) {
    return "red";
  }
  if (normalized.includes("checked")) {
    return "green";
  }
  if (normalized.includes("partial") || normalized.includes("pending") || normalized.includes("incomplete")) {
    return "gold";
  }
  return "orange";
}

function PersonalRotationOverview({
  person,
  chart,
  activityItems,
  drilldownFilter,
  onDrilldownChange
}: {
  person: PersonalActionView;
  chart: PersonalGanttChart;
  activityItems: PersonalActivityItem[];
  drilldownFilter: PersonalDrilldownFilter;
  onDrilldownChange: (filter: PersonalDrilldownFilter) => void;
}) {
  const criticalItems = activityItems.filter((item) => item.tone === "critical");
  const attentionItems = activityItems.filter((item) => item.tone === "attention");
  const blockedPrItems = activityItems.filter(
    (item) => item.objectType === "pull_request" && personalActivityHasBlockingSignal(item)
  );
  const [aiFilter, setAiFilter] = useState<CriticalIssueAiFilter>("all");
  const testingStaleIssues = person.testingIssues.filter(isTestingIssueStale);
  const testingWorkCount = personalTestingWorkCount(person);
  const staleTestingWorkCount = testingStaleIssues.length;
  const testingIssueRows = sortTestingIssueQueue(person.testingIssues, "priority").slice(0, 4);
  const testingPrRows = sortTestingQueuePrs(person.testingPrs).slice(0, Math.max(0, 4 - testingIssueRows.length));
  const filteredRows = chart.rows.filter((row) => personalThreadMatchesAi(row, aiFilter));
  const focusRows = filteredRows.slice(0, 6);
  const primaryFocus = personalPrimaryFocus(person, chart, blockedPrItems.length, staleTestingWorkCount);
  const criticalIssuesByPr = useMemo(
    () => criticalIssueContextsByPullRequest(person.activeCriticalIssues),
    [person.activeCriticalIssues]
  );
  const [previewThread, setPreviewThread] = useState<PersonalGanttRow | null>(null);
  const [testingPreviewIssue, setTestingPreviewIssue] = useState<TestingIssueQueueView | null>(null);
  const [prPreview, setPrPreview] = useState<TeamWorkPreview | null>(null);

  return (
    <div className="personal-rotation-overview">
      <section className="team-command-panel personal-command-panel">
        <div className="team-command-heading">
          <div>
            <Title level={5}>Personal Flow Monitor</Title>
            <Text type="secondary">Issue and PR rotation for {person.login}</Text>
          </div>
          <Space size={[6, 6]} wrap>
            <button
              type="button"
              className={`inline-filter-chip ${criticalItems.length > 0 ? "inline-filter-chip-red" : ""} ${
                drilldownFilter === "active_issues" ? "inline-filter-chip-active" : ""
              }`}
              onClick={() => onDrilldownChange("active_issues")}
            >
              {criticalItems.length} active s-1/s0
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${
                person.needsTriageIssues.length > 0 ? "" : "inline-filter-chip-muted"
              } ${drilldownFilter === "triage" ? "inline-filter-chip-active" : ""}`}
              onClick={() => onDrilldownChange("triage")}
            >
              {person.needsTriageIssues.length} needs triage
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${attentionItems.length > 0 ? "" : "inline-filter-chip-muted"} ${
                drilldownFilter === "pr_attention" ? "inline-filter-chip-active" : ""
              }`}
              onClick={() => onDrilldownChange("pr_attention")}
            >
              {attentionItems.length} attention
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${person.pendingPrs.length > 0 ? "" : "inline-filter-chip-muted"} ${
                drilldownFilter === "pending_pr" ? "inline-filter-chip-active" : ""
              }`}
              onClick={() => onDrilldownChange("pending_pr")}
            >
              {person.pendingPrs.length} pending PR
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${person.deferredIssues.length > 0 ? "" : "inline-filter-chip-muted"} ${
                drilldownFilter === "deferred" ? "inline-filter-chip-active" : ""
              }`}
              onClick={() => onDrilldownChange("deferred")}
            >
              {person.deferredIssues.length} deferred
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${drilldownFilter === "yesterday_pr" ? "inline-filter-chip-active" : ""}`}
              onClick={() => onDrilldownChange("yesterday_pr")}
            >
              {person.prsCreatedYesterday.length + person.prsMergedYesterday.length} PR yday
            </button>
            <button
              type="button"
              className={`inline-filter-chip ${drilldownFilter === "threads" ? "inline-filter-chip-active" : ""}`}
              onClick={() => onDrilldownChange("threads")}
            >
              {chart.rows.length} threads
            </button>
          </Space>
        </div>
        <div className="team-focus-callout personal-focus-callout">
          <UserRound size={18} aria-hidden="true" />
          <div>
            <Text strong>{primaryFocus.title}</Text>
            <span>{primaryFocus.detail}</span>
          </div>
        </div>
        <div className="team-monitor-grid personal-monitor-grid" aria-label="Personal flow monitor">
          <TeamMonitorTile
            label="Active issues"
            value={person.activeCriticalIssues.length}
            detail={activeIssueHealthText(person, criticalItems)}
            tone={person.activeCriticalIssues.length > 0 ? "critical" : "good"}
            onClick={() => onDrilldownChange("active_issues")}
          />
          <TeamMonitorTile
            label="Pending PRs"
            value={person.pendingPrs.length}
            detail={`${person.attentionPrs.length} attention | ${oldestPersonalPrText(person.pendingPrs)}`}
            tone={person.pendingPrs.length > 0 ? "attention" : "good"}
            onClick={() => onDrilldownChange("pending_pr")}
          />
          <TeamMonitorTile
            label="PR blockers"
            value={blockedPrItems.length}
            detail={prBlockerBreakdownText(person.attentionPrs)}
            tone={blockedPrItems.length > 0 ? "attention" : "good"}
            onClick={() => onDrilldownChange("pr_attention")}
          />
          <TeamMonitorTile
            label="Issue testing"
            value={testingWorkCount}
            detail={`${staleTestingWorkCount} waiting >24h | ${person.testingPrs.length} linked PR evidence | ${oldestPersonalTestingText([], person.testingIssues)}`}
            tone={staleTestingWorkCount > 0 ? "critical" : testingWorkCount > 0 ? "attention" : "good"}
            onClick={() => onDrilldownChange("testing")}
          />
          <TeamMonitorTile
            label="Triage"
            value={person.needsTriageIssues.length}
            detail={triageHealthText(person)}
            tone={person.needsTriageIssues.length > 0 ? "attention" : "good"}
            onClick={() => onDrilldownChange("triage")}
          />
        </div>
      </section>

      <div className="personal-rotation-grid">
        <section className="personal-rotation-lane personal-rotation-lane-critical">
          <div className="team-rotation-lane-heading">
            <Space size={[6, 6]} wrap>
              <Text strong>Issue-PR Threads</Text>
              <button
                type="button"
                className="team-lane-count team-lane-count-critical"
                onClick={() => onDrilldownChange("threads")}
              >
                {filteredRows.length}
              </button>
            </Space>
            <div className="board-filter-group board-filter-group-inline">
              <Text type="secondary">AI</Text>
              <Segmented
                size="small"
                value={aiFilter}
                onChange={(value) => setAiFilter(String(value))}
                options={criticalIssueAiOptions(person.activeCriticalIssues)}
              />
            </div>
          </div>
          <div className="team-rotation-list">
            {focusRows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No visible personal work threads" />
            ) : (
              focusRows.map((row) => <PersonalRotationThreadRow row={row} key={row.id} onPreview={setPreviewThread} />)
            )}
          </div>
        </section>

        <section className="personal-rotation-lane personal-rotation-lane-triage">
          <div className="team-rotation-lane-heading">
            <Space size={[6, 6]} wrap>
              <Text strong>Triage & Deferred</Text>
              <button
                type="button"
                className={`team-lane-count ${person.needsTriageIssues.length > 0 ? "team-lane-count-attention" : ""}`}
                onClick={() => onDrilldownChange("triage")}
              >
                {person.needsTriageIssues.length}
              </button>
            </Space>
            <Text type="secondary">{triageHealthText(person)}</Text>
          </div>
          <div className="team-rotation-list">
            {person.needsTriageIssues.length === 0 && person.deferredIssues.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No triage or deferred backlog" />
            ) : (
              <>
                <IssueCardList
                  issues={person.needsTriageIssues.slice(0, 4)}
                  emptyText="No needs-triage issues"
                  onPreview={(_issue) => onDrilldownChange("triage")}
                />
                {person.deferredIssues.length > 0 ? (
                  <button type="button" className="critical-lane-more" onClick={() => onDrilldownChange("deferred")}>
                    Open {person.deferredIssues.length} deferred issues
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className="personal-rotation-lane personal-rotation-lane-attention">
          <div className="team-rotation-lane-heading">
            <Space size={[6, 6]} wrap>
              <Text strong>PR Rotation</Text>
              <button type="button" className="team-lane-count" onClick={() => onDrilldownChange("pr_attention")}>
                {person.attentionPrs.length}
              </button>
            </Space>
            <Text type="secondary">review, CI, merge, issue testing</Text>
          </div>
          <div className="team-rotation-list">
            {person.attentionPrs.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No PR blockers" />
            ) : (
              person.attentionPrs
                .slice(0, 5)
                .map((pr) => (
                  <TeamPrRiskRow
                    activeIssues={criticalIssuesByPr.get(pr.number) ?? []}
                    pr={pr}
                    key={pr.number}
                    onPreview={setPrPreview}
                  />
                ))
            )}
          </div>
        </section>

        <section className="personal-rotation-lane personal-rotation-lane-attention">
          <div className="team-rotation-lane-heading">
            <Space size={[6, 6]} wrap>
              <Text strong>Issue Testing</Text>
              <button
                type="button"
                className={`team-lane-count ${staleTestingWorkCount > 0 ? "team-lane-count-critical" : ""}`}
                onClick={() => onDrilldownChange("testing")}
              >
                {testingWorkCount}
              </button>
            </Space>
            <Text type="secondary">issue handoff status and linked PR evidence</Text>
          </div>
          <div className="team-rotation-list">
            {testingWorkCount === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issues in testing" />
            ) : (
              <>
                {testingIssueRows.map((issue) => (
                  <TeamTestingIssueRow issue={issue} key={issue.number} onPreview={setTestingPreviewIssue} />
                ))}
                {testingPrRows.map((pr) => (
                  <TeamPrRiskRow
                    activeIssues={criticalIssuesByPr.get(pr.number) ?? []}
                    pr={pr}
                    key={pr.number}
                    onPreview={setPrPreview}
                  />
                ))}
              </>
            )}
          </div>
        </section>
      </div>
      <FlowThreadPreviewModal row={previewThread} onClose={() => setPreviewThread(null)} />
      <TestingIssuePreviewModal issue={testingPreviewIssue} onClose={() => setTestingPreviewIssue(null)} />
      <TeamWorkPreviewModal preview={prPreview} onClose={() => setPrPreview(null)} />
    </div>
  );
}

function PersonalRotationThreadRow({
  row,
  onPreview
}: {
  row: PersonalGanttRow;
  onPreview: (row: PersonalGanttRow) => void;
}) {
  const nextAction = flowThreadNextAction(row);
  const warnings = flowThreadDurationWarnings(row);
  const reasons = flowThreadReasons(row);

  return (
    <article className={`personal-thread-row personal-thread-${row.tone}`}>
      <div className="personal-thread-main">
        <div className="team-work-title-row">
          {row.issue.htmlUrl ? (
            <WorkObjectLink href={row.issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
              {row.title}
            </WorkObjectLink>
          ) : (
            <Text strong>{row.title}</Text>
          )}
          <Tag color={ganttToneColor(row.tone)}>{row.kind === "issue" ? "issue" : "PR group"}</Tag>
          {row.issue.severity ? <Tag color={severityColor(row.issue.severity)}>{row.issue.severity}</Tag> : null}
          <Tag color={row.issue.durationHours === null ? "gold" : undefined}>{personalDurationText(row.issue)}</Tag>
          <Tooltip title="Preview thread">
            <Button
              aria-label={`Preview ${row.title}`}
              icon={<Eye size={14} />}
              size="small"
              onClick={() => onPreview(row)}
            />
          </Tooltip>
        </div>
        <div className="personal-thread-title">{row.issue.title}</div>
        <div className="team-work-tags">
          {warnings.map((warning) => (
            <Tag color="red" key={warning}>
              {warning}
            </Tag>
          ))}
          {reasons.slice(0, 4).map((reason) => (
            <Tag color={activityReasonColor(reason)} key={reason}>
              {reason}
            </Tag>
          ))}
          {row.prs.length > 0 ? <Tag>{row.prs.length} PR</Tag> : null}
          {row.prs.some((pr) => pr.isShared) ? <Tag color="purple">shared PR</Tag> : null}
        </div>
        <div className="team-linked-row">
          {row.prs.length > 0 ? (
            <>
              <span>PRs</span>
              {row.prs.slice(0, 5).map((pr) => (
                <a href={pr.htmlUrl} target="_blank" rel="noreferrer" key={pr.number}>
                  #{pr.number}
                  {pr.testingState !== "not_ready" ? ` ${testingStateBusinessLabel(pr.testingState)}` : ""}
                </a>
              ))}
              {row.prs.length > 5 ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview ${row.title} with ${row.prs.length - 5} more linked PRs`}
                  count={row.prs.length - 5}
                  label="more PRs"
                  onClick={() => onPreview(row)}
                />
              ) : null}
            </>
          ) : (
            <span className="team-linked-row-missing">No linked PR visible</span>
          )}
        </div>
        <FlowThreadTimeline row={row} />
      </div>
      <div className="team-work-action">
        <Text type="secondary">Next</Text>
        <Text strong>{nextAction}</Text>
        <small>
          {row.issue.durationHours === null ? "duration unknown" : `${hours(row.issue.durationHours)} current lane`}
        </small>
      </div>
    </article>
  );
}

function personalThreadMatchesAi(row: PersonalGanttRow, aiFilter: CriticalIssueAiFilter): boolean {
  if (aiFilter === "all") {
    return true;
  }
  if (!row.issue.aiEffortLabel) {
    return row.kind === "issue" && aiFilter === "ai-easy";
  }
  return row.issue.aiEffortLabel === aiFilter;
}

function personalPrimaryFocus(
  person: PersonalActionView,
  chart: PersonalGanttChart,
  blockedPrs: number,
  staleTestingPrs: number
): { title: string; detail: string } {
  if (person.activeCriticalIssues.length > 0) {
    return {
      title: `${person.activeCriticalIssues.length} active s-1/s0 issues should drive the day.`,
      detail: `${blockedPrs} PR blockers, ${staleTestingPrs} issue test waits, ${chart.rows.length} issue/PR threads.`
    };
  }
  if (blockedPrs > 0) {
    return {
      title: `${blockedPrs} PRs need owner movement.`,
      detail: `${person.pendingPrs.length} pending PRs; ${personalTestingWorkCount(person)} issues in testing.`
    };
  }
  if (person.needsTriageIssues.length > 0) {
    return {
      title: `${person.needsTriageIssues.length} issues need triage decisions.`,
      detail: "Decide active s-1/s0 execution or defer with a clear reason."
    };
  }
  return {
    title: "No high-priority personal blockers in cached data.",
    detail: `${person.pendingPrs.length} pending PRs and ${chart.rows.length} visible issue/PR threads remain.`
  };
}

function oldestPersonalPrText(prs: PersonalPullRequestView[]): string {
  if (prs.length === 0) {
    return "no pending PR";
  }
  return `oldest ${hours(Math.max(...prs.map((pr) => pr.ageHours)))}`;
}

function oldestPersonalIssueText(issues: PersonalIssueView[]): string {
  if (issues.length === 0) {
    return "no issue backlog";
  }
  return `oldest ${hours(Math.max(...issues.map((issue) => issue.ageHours)))}`;
}

function activeIssueHealthText(person: PersonalActionView, criticalItems: PersonalActivityItem[]): string {
  if (person.activeCriticalIssues.length === 0) {
    return "no active s-1/s0";
  }
  const noLinkedPrs = person.activeCriticalIssues.filter((issue) => issue.linkedPullRequests.length === 0).length;
  const staleCritical = criticalItems.filter((item) => (item.durationHours ?? 0) >= 72).length;
  return `${criticalActivitySummary(criticalItems)} | ${staleCritical} >3d | ${noLinkedPrs} no PR`;
}

function triageHealthText(person: PersonalActionView): string {
  if (person.needsTriageIssues.length === 0) {
    return `${person.deferredIssues.length} deferred`;
  }
  const activeCount = person.activeCriticalIssues.length;
  const backlogBalance =
    person.needsTriageIssues.length > activeCount && activeCount <= 1 ? "triage-heavy" : `${activeCount} active`;
  return `${oldestPersonalIssueText(person.needsTriageIssues)} | ${backlogBalance} | ${person.deferredIssues.length} deferred`;
}

function prBlockerBreakdownText(prs: PersonalPullRequestView[]): string {
  if (prs.length === 0) {
    return "no PR blockers";
  }
  const reasonText = prs.flatMap(prAttentionReasons).join(" ").toLowerCase();
  const ci = (reasonText.match(/ci failed/g) ?? []).length;
  const review = (reasonText.match(/review waiting/g) ?? []).length;
  const changes = (reasonText.match(/changes requested/g) ?? []).length;
  const conflict = (reasonText.match(/merge conflict/g) ?? []).length;
  const idle = (reasonText.match(/no human action/g) ?? []).length;
  const parts = [
    ci > 0 ? `${ci} CI` : null,
    review > 0 ? `${review} review` : null,
    changes > 0 ? `${changes} changes` : null,
    conflict > 0 ? `${conflict} conflict` : null,
    idle > 0 ? `${idle} idle` : null
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" | ") : `${prs.length} attention PR`;
}

function oldestPersonalTestingText(prs: PersonalPullRequestView[], issues: TestingIssueQueueView[] = []): string {
  const waits = [...prs.map((pr) => pr.testingQueueAgeHours), ...issues.map((issue) => issue.queueAgeHours)].filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  if (waits.length === 0) {
    return "wait unknown";
  }
  return `max wait ${hours(Math.max(...waits))}`;
}

function personalDrilldownLabel(filter: PersonalDrilldownFilter): string {
  if (filter === "active_issues") {
    return "Active s-1/s0 Issues";
  }
  if (filter === "pr_attention") {
    return "PR Attention";
  }
  if (filter === "pending_pr") {
    return "Pending PRs";
  }
  if (filter === "testing") {
    return "Issue Testing";
  }
  if (filter === "triage") {
    return "Needs Triage";
  }
  if (filter === "deferred") {
    return "Deferred Issues";
  }
  if (filter === "yesterday_pr") {
    return "Yesterday PR";
  }
  return "Issue-PR Threads";
}

function PersonalDrilldownBoard({
  person,
  chart,
  filter,
  onIssuePreview,
  onPullRequestPreview
}: {
  person: PersonalActionView;
  chart: PersonalGanttChart;
  filter: PersonalDrilldownFilter;
  onIssuePreview: (issue: CriticalIssueView | PersonalIssueView) => void;
  onPullRequestPreview: (pr: PersonalPullRequestView) => void;
}) {
  const title = personalDrilldownLabel(filter);
  const [testingIssueFilter, setTestingIssueFilter] = useState<TestingIssueQueueFilter>("all");

  if (filter === "threads") {
    return (
      <section className="personal-filtered-board personal-filtered-board-critical">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Space size={[4, 4]} wrap>
            <Tag>{chart.rows.length} threads</Tag>
            <Tag>{chart.sharedPrCount} shared PR</Tag>
            <Tag color={chart.unlinkedPrCount > 0 ? "orange" : "default"}>{chart.unlinkedPrCount} unlinked PR</Tag>
          </Space>
        </div>
        <PersonalFlowMap chart={chart} />
      </section>
    );
  }

  if (filter === "yesterday_pr") {
    return (
      <section className="personal-filtered-board">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Space size={[4, 4]} wrap>
            <Tag>{person.prsCreatedYesterday.length} created</Tag>
            <Tag>{person.prsMergedYesterday.length} merged</Tag>
          </Space>
        </div>
        <div className="work-lane-grid work-lane-grid-secondary">
          <WorkLane title="PRs Created Yesterday" count={person.prsCreatedYesterday.length} tone="normal">
            <PullRequestCardList
              prs={person.prsCreatedYesterday}
              emptyText="No PRs created yesterday"
              onPreview={onPullRequestPreview}
            />
          </WorkLane>
          <WorkLane title="PRs Merged Yesterday" count={person.prsMergedYesterday.length} tone="normal">
            <PullRequestCardList
              prs={person.prsMergedYesterday}
              emptyText="No PRs merged yesterday"
              onPreview={onPullRequestPreview}
            />
          </WorkLane>
        </div>
      </section>
    );
  }

  if (filter === "active_issues") {
    return (
      <section className="personal-filtered-board personal-filtered-board-critical">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Tag color={person.activeCriticalIssues.length > 0 ? "red" : "default"}>
            {person.activeCriticalIssues.length} active
          </Tag>
        </div>
        <IssueCardList
          issues={person.activeCriticalIssues}
          emptyText="No active s-1/s0 issues"
          onPreview={onIssuePreview}
        />
      </section>
    );
  }

  if (filter === "deferred") {
    return (
      <section className="personal-filtered-board">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Tag color={person.deferredIssues.length > 0 ? "blue" : "default"}>{person.deferredIssues.length} issue</Tag>
        </div>
        <IssueCardList issues={person.deferredIssues} emptyText="No deferred issues" onPreview={onIssuePreview} />
      </section>
    );
  }

  if (filter === "pr_attention") {
    return (
      <section className="personal-filtered-board personal-filtered-board-attention">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Tag color={person.attentionPrs.length > 0 ? "orange" : "default"}>{person.attentionPrs.length} PR</Tag>
        </div>
        <PullRequestCardList
          emphasized
          prs={person.attentionPrs}
          emptyText="No PR attention items"
          onPreview={onPullRequestPreview}
        />
      </section>
    );
  }

  if (filter === "pending_pr") {
    return (
      <section className="personal-filtered-board">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Tag>{person.pendingPrs.length} PR</Tag>
        </div>
        <PullRequestCardList prs={person.pendingPrs} emptyText="No pending PRs" onPreview={onPullRequestPreview} />
      </section>
    );
  }

  if (filter === "testing") {
    const testingWorkCount = personalTestingWorkCount(person);
    const staleTestingWorkCount = personalTestingStaleCount(person);

    return (
      <section className="personal-filtered-board personal-filtered-board-attention">
        <div className="subsection-heading">
          <Title level={5}>{title}</Title>
          <Space size={[4, 4]} wrap>
            <Tag color={staleTestingWorkCount > 0 ? "red" : "blue"}>{testingWorkCount} issue testing</Tag>
            <Tag>{person.testingPrs.length} linked PR evidence</Tag>
          </Space>
        </div>
        <TestingIssueQueuePanel
          filter={testingIssueFilter}
          issues={person.testingIssues}
          onFilterChange={setTestingIssueFilter}
        />
        {person.testingPrs.length > 0 || person.testingIssues.length === 0 ? (
          <div className="testing-linked-pr-evidence">
            <div className="subsection-heading subsection-heading-compact">
              <Text strong>Linked PR Evidence</Text>
              <Tag>{person.testingPrs.length} PR</Tag>
            </div>
            <PullRequestCardList
              prs={sortTestingQueuePrs(person.testingPrs)}
              emptyText="No linked PR evidence in cache"
              onPreview={onPullRequestPreview}
            />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="personal-filtered-board">
      <div className="subsection-heading">
        <Title level={5}>{title}</Title>
        <Tag color={person.needsTriageIssues.length > 0 ? "gold" : "default"}>
          {person.needsTriageIssues.length} issue
        </Tag>
      </div>
      <IssueCardList issues={person.needsTriageIssues} emptyText="No needs-triage issues" onPreview={onIssuePreview} />
    </section>
  );
}

function SelectedPersonWorkbench({
  person,
  analyticsPeriod,
  trendPoints,
  onAnalyticsPeriodChange,
  drilldownFilter,
  onDrilldownChange
}: {
  person: PersonalActionView;
  analyticsPeriod: MetricPeriod;
  trendPoints: TrendMetricPoint[];
  onAnalyticsPeriodChange: (period: MetricPeriod) => void;
  drilldownFilter: PersonalDrilldownFilter;
  onDrilldownChange: (filter: PersonalDrilldownFilter) => void;
}) {
  const attentionNumbers = new Set(person.attentionPrs.map((pr) => pr.number));
  const routinePendingPrs = person.pendingPrs.filter((pr) => !attentionNumbers.has(pr.number));
  const activityItems = personalActivityItems(person);
  const activityItemById = new Map(activityItems.map((item) => [item.id, item]));
  const [objectPreviewItem, setObjectPreviewItem] = useState<PersonalActivityItem | null>(null);
  const gantt = personalGanttChart(person);
  const flowSummary = flowEfficiencySummary({
    points: trendPoints,
    pendingPrs: person.pendingPrs,
    activeIssues: person.activeCriticalIssues,
    testingPrs: person.testingPrs,
    testingIssues: person.testingIssues
  });
  const previewIssue = (issue: CriticalIssueView | PersonalIssueView): void => {
    const item = activityItemById.get(`issue:${issue.number}`);
    if (item) {
      setObjectPreviewItem(item);
    }
  };
  const previewPullRequest = (pr: PersonalPullRequestView): void => {
    const item = activityItemById.get(`pull_request:${pr.number}`);
    if (item) {
      setObjectPreviewItem(item);
    }
  };

  return (
    <div className="selected-person-workbench">
      <div className="person-focus-header">
        <div className="person-focus-title">
          <span className="person-avatar person-avatar-large" aria-hidden="true">
            {person.login.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <Title level={4}>{person.login}</Title>
            <Space size={[6, 6]} wrap>
              <Tag color={person.summary.activeCriticalIssues > 0 ? "red" : "default"}>
                {person.summary.activeCriticalIssues} s-1/s0
              </Tag>
              <Tag color={person.summary.attentionPrs > 0 ? "orange" : "default"}>
                {person.summary.attentionPrs} PR attention
              </Tag>
              <Tag color={person.summary.needsTriageIssues > 0 ? "gold" : "default"}>
                {person.summary.needsTriageIssues} needs triage
              </Tag>
              <Tag>{personalTestingWorkCount(person)} issue testing</Tag>
              <Tag>
                yesterday {person.summary.prsCreatedYesterday}/{person.summary.prsMergedYesterday}
              </Tag>
            </Space>
          </div>
        </div>
      </div>

      <PersonalRotationOverview
        person={person}
        chart={gantt}
        activityItems={activityItems}
        drilldownFilter={drilldownFilter}
        onDrilldownChange={onDrilldownChange}
      />

      <section className="activity-panel personal-action-panel">
        <div className="subsection-heading">
          <Title level={5}>Action Queue</Title>
          <Space size={[6, 6]} wrap>
            <Tag color={activityItems.some((item) => item.tone === "critical") ? "red" : "default"}>
              {activityItems.filter((item) => item.tone === "critical").length} critical
            </Tag>
            <Tag color={activityItems.some((item) => item.tone === "attention") ? "orange" : "default"}>
              {activityItems.filter((item) => item.tone === "attention").length} attention
            </Tag>
            <Tag>{gantt.rows.length} threads</Tag>
          </Space>
        </div>
        <PersonalActionQueue items={activityItems} />
      </section>

      <PersonalDrilldownBoard
        person={person}
        chart={gantt}
        filter={drilldownFilter}
        onIssuePreview={previewIssue}
        onPullRequestPreview={previewPullRequest}
      />

      <details className="secondary-disclosure personal-detail-disclosure">
        <summary>
          <span>Object lists</span>
          <Space size={[4, 4]} wrap>
            <Tag>{routinePendingPrs.length} routine PR</Tag>
            <Tag>{person.deferredIssues.length} deferred</Tag>
            <Tag>
              yesterday {person.prsCreatedYesterday.length}/{person.prsMergedYesterday.length}
            </Tag>
          </Space>
        </summary>
        <div className="secondary-disclosure-body">
          <div className="work-lane-grid work-lane-grid-priority">
            <WorkLane title="Active s-1/s0 Issues" count={person.activeCriticalIssues.length} tone="critical">
              <IssueCardList
                issues={person.activeCriticalIssues}
                emptyText="No active s-1/s0 issues"
                onPreview={previewIssue}
              />
            </WorkLane>
            <WorkLane title="PR Attention" count={person.attentionPrs.length} tone="attention">
              <PullRequestCardList
                emphasized
                prs={person.attentionPrs}
                emptyText="No PR attention items"
                onPreview={previewPullRequest}
              />
            </WorkLane>
            <WorkLane title="Needs Triage" count={person.needsTriageIssues.length} tone="attention">
              <IssueCardList
                issues={person.needsTriageIssues}
                emptyText="No needs-triage issues"
                onPreview={previewIssue}
              />
            </WorkLane>
          </div>

          <div className="work-lane-grid">
            <WorkLane title="Pending PRs" count={routinePendingPrs.length} tone="normal">
              <PullRequestCardList
                prs={routinePendingPrs}
                emptyText="No routine pending PRs"
                onPreview={previewPullRequest}
              />
            </WorkLane>
            <WorkLane title="Linked PR Evidence" count={person.testingPrs.length} tone="normal">
              <PullRequestCardList
                prs={person.testingPrs}
                emptyText="No linked PR evidence in cache"
                onPreview={previewPullRequest}
              />
            </WorkLane>
            <WorkLane title="Deferred Issues" count={person.deferredIssues.length} tone="normal">
              <IssueCardList issues={person.deferredIssues} emptyText="No deferred issues" onPreview={previewIssue} />
            </WorkLane>
          </div>

          <div className="work-lane-grid work-lane-grid-secondary">
            <WorkLane title="PRs Created Yesterday" count={person.prsCreatedYesterday.length} tone="normal">
              <PullRequestCardList
                prs={person.prsCreatedYesterday}
                emptyText="No PRs created yesterday"
                onPreview={previewPullRequest}
              />
            </WorkLane>
            <WorkLane title="PRs Merged Yesterday" count={person.prsMergedYesterday.length} tone="normal">
              <PullRequestCardList
                prs={person.prsMergedYesterday}
                emptyText="No PRs merged yesterday"
                onPreview={previewPullRequest}
              />
            </WorkLane>
          </div>
        </div>
      </details>
      <PersonalActivityPreviewModal item={objectPreviewItem} onClose={() => setObjectPreviewItem(null)} />

      <section className="trend-panel">
        <div className="subsection-heading">
          <Title level={5}>Personal Flow Efficiency</Title>
          <Segmented
            size="small"
            value={analyticsPeriod}
            onChange={(value) => onAnalyticsPeriodChange(value as MetricPeriod)}
            options={metricPeriodOptions}
          />
        </div>
        <FlowEfficiencyStrip
          summary={flowSummary}
          actions={{
            pendingPrAge: () => onDrilldownChange("pending_pr"),
            prFlow: () => onDrilldownChange("pending_pr"),
            issueDrain: () => onDrilldownChange("active_issues"),
            prAttention: () => onDrilldownChange("pr_attention"),
            activeCriticalAge: () => onDrilldownChange("active_issues"),
            testingQueue: () => onDrilldownChange("testing")
          }}
        />
        <TrendChart points={trendPoints} />
      </section>
    </div>
  );
}

function WebhookIngestionBoard({
  data,
  scopeFilter,
  onScopeFilterChange,
  authenticated,
  retrySaving,
  onRetryFailed,
  onRefreshWebhooks
}: {
  data: DashboardSummary;
  scopeFilter: WebhookDeliveryScopeFilter;
  onScopeFilterChange: (value: WebhookDeliveryScopeFilter) => void;
  authenticated: boolean;
  retrySaving: boolean;
  onRetryFailed: () => void;
  onRefreshWebhooks: () => void;
}) {
  const secretConfigured = !data.profileWarnings.some((warning) => warning.key === "webhook:secret_unconfigured");
  const readiness = summarizeWebhookReadiness(data);
  const recentDeliveries = data.webhooks.recentDeliveries.filter((delivery) =>
    webhookDeliveryMatchesScope(delivery, scopeFilter)
  );
  const pendingDeliveries = data.webhooks.pendingDeliveries;
  const failedDeliveries = data.webhooks.failedDeliveries;
  const duplicateDeliveries = data.webhooks.duplicateDeliveries;
  const connectivityProbeDeliveries = data.webhooks.connectivityProbeDeliveries;
  const eventSummaryByName = new Map(data.webhooks.eventSummaries.map((summary) => [summary.eventName, summary]));
  const observedUnsupportedEvents = data.webhooks.eventSummaries.filter(
    (summary) =>
      !supportedGitHubWebhookEvents.includes(summary.eventName as (typeof supportedGitHubWebhookEvents)[number]) &&
      !githubWebhookConnectivityEvents.includes(summary.eventName as (typeof githubWebhookConnectivityEvents)[number])
  );
  const columns: ColumnsType<GitHubWebhookDeliveryView> = [
    {
      title: "Delivery",
      dataIndex: "deliveryId",
      width: 220,
      render: (deliveryId) => (
        <Text code copyable={{ text: deliveryId }}>
          {deliveryId}
        </Text>
      )
    },
    {
      title: "Event",
      width: 210,
      render: (_, delivery) => (
        <Space size={[4, 4]} wrap>
          <Tag color="blue">{delivery.eventName}</Tag>
          {delivery.action ? <Tag>{delivery.action}</Tag> : null}
        </Space>
      )
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 170,
      render: (status, delivery) => (
        <Space size={[4, 4]} wrap>
          <Tag color={webhookDeliveryStatusColor(status)}>{labelText(status)}</Tag>
          {delivery.duplicateCount > 0 ? <Tag color="gold">{delivery.duplicateCount} duplicate</Tag> : null}
        </Space>
      )
    },
    {
      title: "Attempts",
      dataIndex: "attempts",
      width: 100,
      render: (attempts) => <Text>{attempts}</Text>
    },
    {
      title: "Received",
      dataIndex: "receivedAt",
      width: 168,
      render: (value) => formatDate(value)
    },
    {
      title: "Processed",
      dataIndex: "processedAt",
      width: 168,
      render: (value) => formatDate(value)
    },
    {
      title: "Error",
      dataIndex: "errorMessage",
      ellipsis: true,
      render: (errorMessage) =>
        errorMessage ? (
          <Text type="danger" ellipsis={{ tooltip: errorMessage }}>
            {errorMessage}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        )
    }
  ];

  return (
    <section className="section">
      <div className="section-heading">
        <Space>
          <RefreshCw size={18} />
          <Title level={4}>Webhook Ingestion</Title>
        </Space>
        <Space size={[6, 6]} wrap>
          <Tag color={secretConfigured ? "green" : "orange"}>
            {secretConfigured ? "secret configured" : "secret missing"}
          </Tag>
          <Tag color={data.webhooks.lastReceivedAt ? "green" : "default"}>
            last {formatDate(data.webhooks.lastReceivedAt)}
          </Tag>
          <Button size="small" disabled={!authenticated} onClick={onRefreshWebhooks}>
            Refresh webhooks
          </Button>
        </Space>
      </div>

      <WebhookReadinessPanel readiness={readiness} />
      <WebhookSetupPanel
        data={data}
        secretConfigured={secretConfigured}
        authenticated={authenticated}
        onRefreshWebhooks={onRefreshWebhooks}
      />

      {failedDeliveries > 0 ? (
        <Alert
          className="band"
          type="warning"
          title={`${failedDeliveries} webhook deliveries need attention`}
          description={data.webhooks.latestFailure ?? "Failed deliveries are retained in the cache for retry."}
          action={
            <Button size="small" disabled={!authenticated} loading={retrySaving} onClick={onRetryFailed}>
              Retry failed
            </Button>
          }
          showIcon
        />
      ) : null}

      <div className="webhook-command-grid">
        <div className="critical-board-summary webhook-summary" aria-label="Webhook delivery filters">
          <CriticalBoardStat
            label="shown"
            value={recentDeliveries.length}
            tone={recentDeliveries.length > 0 ? "attention" : "good"}
            active={scopeFilter === "all"}
            onClick={() => onScopeFilterChange("all")}
          />
          <CriticalBoardStat
            label="pending"
            value={pendingDeliveries}
            tone={pendingDeliveries > 0 ? "attention" : "good"}
            active={scopeFilter === "pending"}
            onClick={() => onScopeFilterChange("pending")}
          />
          <CriticalBoardStat
            label="failed"
            value={failedDeliveries}
            tone={failedDeliveries > 0 ? "critical" : "good"}
            active={scopeFilter === "failed"}
            onClick={() => onScopeFilterChange("failed")}
          />
          <CriticalBoardStat
            label="processed"
            value={data.webhooks.processedDeliveries}
            tone="good"
            active={scopeFilter === "processed"}
            onClick={() => onScopeFilterChange("processed")}
          />
          <CriticalBoardStat
            label="ignored"
            value={data.webhooks.ignoredDeliveries}
            tone={data.webhooks.ignoredDeliveries > 0 ? "muted" : "good"}
            active={scopeFilter === "ignored"}
            onClick={() => onScopeFilterChange("ignored")}
          />
          <CriticalBoardStat
            label="ping"
            value={connectivityProbeDeliveries}
            tone={connectivityProbeDeliveries > 0 ? "good" : "muted"}
            active={scopeFilter === "ignored"}
            onClick={() => onScopeFilterChange("ignored")}
          />
          <CriticalBoardStat
            label="duplicates"
            value={duplicateDeliveries}
            tone={duplicateDeliveries > 0 ? "muted" : "good"}
            active={scopeFilter === "duplicates"}
            onClick={() => onScopeFilterChange("duplicates")}
          />
        </div>

        <div className="webhook-event-panel">
          <div className="webhook-event-heading">
            <Text strong>Event Coverage</Text>
            <Text type="secondary">Which GitHub changes have actually reached this cache.</Text>
          </div>
          <div className="webhook-event-list">
            {supportedGitHubWebhookEvents.map((eventName) => {
              const summary = eventSummaryByName.get(eventName);
              return (
                <div className="webhook-event-card" key={eventName}>
                  <div>
                    <Text code>{eventName}</Text>
                    <Tag color={webhookEventHealthColor(summary)}>{webhookEventHealthLabel(summary)}</Tag>
                  </div>
                  <span>{webhookEventHealthDetail(summary)}</span>
                </div>
              );
            })}
          </div>
          {observedUnsupportedEvents.length > 0 ? (
            <div className="webhook-extra-events">
              <Text type="secondary">Ignored or repo-mismatched events</Text>
              <Space size={[4, 4]} wrap>
                {observedUnsupportedEvents.map((summary) => (
                  <Tag key={summary.eventName}>{summary.eventName}</Tag>
                ))}
              </Space>
            </div>
          ) : null}
        </div>
      </div>

      <Table
        rowKey="deliveryId"
        size="middle"
        columns={columns}
        dataSource={recentDeliveries}
        scroll={{ x: 1240 }}
        pagination={{ pageSize: 8 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={`No recent ${webhookScopeLabel(scopeFilter)} recorded`}
            />
          )
        }}
      />
    </section>
  );
}

function WebhookSetupPanel({
  data,
  secretConfigured,
  authenticated,
  onRefreshWebhooks
}: {
  data: DashboardSummary;
  secretConfigured: boolean;
  authenticated: boolean;
  onRefreshWebhooks: () => void;
}) {
  const endpoint = githubWebhookEndpoint();
  const eventList = supportedGitHubWebhookEvents.join(", ");
  const workerHealthy = data.sync.worker.status === "active";
  const queueHealthy = data.sync.jobQueue.status === "healthy";
  const repoFullName = `${data.repo.owner}/${data.repo.name}`;

  return (
    <section className="webhook-setup-panel" aria-label="GitHub webhook setup">
      <div className="webhook-setup-heading">
        <div>
          <Text strong>GitHub Hook Setup</Text>
          <Text type="secondary">{repoFullName}</Text>
        </div>
        <Button size="small" disabled={!authenticated} onClick={onRefreshWebhooks}>
          Process queued deliveries
        </Button>
      </div>
      <div className="webhook-setup-grid">
        <WebhookSetupCard label="Payload URL">
          <Text code copyable={{ text: endpoint.copyText }}>
            {endpoint.displayText}
          </Text>
        </WebhookSetupCard>
        <WebhookSetupCard label="Content type">
          <Tag color="blue">application/json</Tag>
        </WebhookSetupCard>
        <WebhookSetupCard label="Secret">
          <Space orientation="vertical" size={4}>
            <Tag color={secretConfigured ? "green" : "orange"}>{secretConfigured ? "configured" : "missing env"}</Tag>
            <Text type="secondary">
              {secretConfigured ? "Use the same secret in GitHub." : "Run make setup locally, then restart API."}
            </Text>
          </Space>
        </WebhookSetupCard>
        <WebhookSetupCard label="Ping probe">
          <Space orientation="vertical" size={4}>
            <Tag color={data.webhooks.lastConnectivityProbeAt ? "green" : "default"}>
              {data.webhooks.lastConnectivityProbeAt ? "connected" : "not observed"}
            </Tag>
            <Text type="secondary">
              {data.webhooks.lastConnectivityProbeAt
                ? `Last ping ${formatDate(data.webhooks.lastConnectivityProbeAt)}`
                : "GitHub sends ping when the hook is saved."}
            </Text>
          </Space>
        </WebhookSetupCard>
        <WebhookSetupCard label="Events">
          <Space size={[4, 4]} wrap>
            <Text code copyable={{ text: eventList }}>
              copy list
            </Text>
            {supportedGitHubWebhookEvents.map((eventName) => (
              <Tag key={eventName}>{eventName}</Tag>
            ))}
          </Space>
        </WebhookSetupCard>
        <WebhookSetupCard label="Runtime">
          <Space size={[4, 4]} wrap>
            <Tag color={workerHealthy ? "green" : "orange"}>worker {labelText(data.sync.worker.status)}</Tag>
            <Tag color={queueHealthy ? "green" : "orange"}>queue {labelText(data.sync.jobQueue.status)}</Tag>
            <Tag color={data.webhooks.lastReceivedAt ? "green" : "default"}>
              last {formatDate(data.webhooks.lastReceivedAt)}
            </Tag>
          </Space>
        </WebhookSetupCard>
      </div>
    </section>
  );
}

function WebhookSetupCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="webhook-setup-card">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function githubWebhookEndpoint(): { displayText: string; copyText: string } {
  const path = "/api/webhooks/github";
  if (typeof window === "undefined" || !window.location?.origin) {
    return { displayText: path, copyText: path };
  }
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return { displayText: `<public API origin>${path}`, copyText: path };
  }
  const url = `${window.location.origin}${path}`;
  return { displayText: url, copyText: url };
}

function WebhookReadinessPanel({ readiness }: { readiness: WebhookReadinessSummary }) {
  return (
    <section className={`webhook-readiness webhook-readiness-${readiness.tone}`} aria-label="Webhook readiness">
      <div className="webhook-readiness-main">
        <Tag color={updatePipelineToneColor(readiness.tone)}>{webhookReadinessModeLabel(readiness.mode)}</Tag>
        <div>
          <Text strong>{readiness.title}</Text>
          <span>{readiness.description}</span>
        </div>
      </div>
      <div className="webhook-readiness-grid">
        <div>
          <Text type="secondary">Current facts</Text>
          <div className="webhook-readiness-tags">
            {readiness.facts.map((fact) => (
              <Tag key={fact}>{fact}</Tag>
            ))}
          </div>
        </div>
        <div>
          <Text type="secondary">Next action</Text>
          <ul className="webhook-readiness-actions">
            {readiness.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function webhookReadinessModeLabel(mode: WebhookReadinessSummary["mode"]): string {
  if (mode === "polling_only") {
    return "polling only";
  }
  if (mode === "waiting_for_delivery") {
    return "waiting";
  }
  if (mode === "connected_waiting_for_activity") {
    return "connected";
  }
  if (mode === "queued") {
    return "queued";
  }
  if (mode === "failed") {
    return "failed";
  }
  return "receiving";
}

function WriteAuditBoard({
  actions,
  columns,
  scopeFilter,
  onScopeFilterChange,
  authenticated
}: {
  actions: WriteActionExecutionView[];
  columns: ColumnsType<WriteActionExecutionView>;
  scopeFilter: WriteAuditScopeFilter;
  onScopeFilterChange: (value: WriteAuditScopeFilter) => void;
  authenticated: boolean;
}) {
  const filteredActions = actions.filter((action) => writeAuditMatchesScope(action, scopeFilter));
  const attentionActions = actions.filter(writeActionNeedsAttention).length;
  const failedActions = actions.filter((action) => action.status === "failed").length;
  const stalePreviewActions = actions.filter((action) => action.status === "stale_preview").length;
  const tokenUnavailableActions = actions.filter((action) => action.status === "token_unavailable").length;
  const successActions = actions.filter((action) => action.status === "success").length;
  const workflowFixActions = actions.filter((action) => writeAuditMatchesScope(action, "workflow_fix")).length;
  const notificationActions = actions.filter((action) => writeAuditMatchesScope(action, "notification")).length;

  return (
    <section className="section">
      <div className="section-heading">
        <Space>
          <ClipboardCheck size={18} />
          <Title level={4}>Write Audit</Title>
        </Space>
        <Space size={[6, 6]} wrap>
          <Text type="secondary">{authenticated ? "Recent write actions" : "Login required"}</Text>
          <Tag color={attentionActions > 0 ? "orange" : "green"}>{attentionActions} need attention</Tag>
        </Space>
      </div>

      <div className="critical-board-summary write-audit-summary" aria-label="Write audit filters">
        <CriticalBoardStat
          label="shown"
          value={filteredActions.length}
          tone={filteredActions.length > 0 ? "attention" : "good"}
          active={scopeFilter === "all"}
          onClick={() => onScopeFilterChange("all")}
        />
        <CriticalBoardStat
          label="attention"
          value={attentionActions}
          tone={attentionActions > 0 ? "attention" : "good"}
          active={scopeFilter === "attention"}
          onClick={() => onScopeFilterChange("attention")}
        />
        <CriticalBoardStat
          label="failed"
          value={failedActions}
          tone={failedActions > 0 ? "critical" : "good"}
          active={scopeFilter === "failed"}
          onClick={() => onScopeFilterChange("failed")}
        />
        <CriticalBoardStat
          label="stale preview"
          value={stalePreviewActions}
          tone={stalePreviewActions > 0 ? "attention" : "good"}
          active={scopeFilter === "stale_preview"}
          onClick={() => onScopeFilterChange("stale_preview")}
        />
        <CriticalBoardStat
          label="token issue"
          value={tokenUnavailableActions}
          tone={tokenUnavailableActions > 0 ? "critical" : "good"}
          active={scopeFilter === "token_unavailable"}
          onClick={() => onScopeFilterChange("token_unavailable")}
        />
        <CriticalBoardStat
          label="success"
          value={successActions}
          tone="good"
          active={scopeFilter === "success"}
          onClick={() => onScopeFilterChange("success")}
        />
        <CriticalBoardStat
          label="workflow fix"
          value={workflowFixActions}
          tone={workflowFixActions > 0 ? "attention" : "good"}
          active={scopeFilter === "workflow_fix"}
          onClick={() => onScopeFilterChange("workflow_fix")}
        />
        <CriticalBoardStat
          label="notification"
          value={notificationActions}
          tone={notificationActions > 0 ? "attention" : "good"}
          active={scopeFilter === "notification"}
          onClick={() => onScopeFilterChange("notification")}
        />
      </div>

      {!authenticated ? (
        <Alert
          className="band"
          type="info"
          title="Connect GitHub token to view write audit"
          description="Write audit rows are only shown to logged-in users and are filtered by the same cached object visibility policy as issues and PRs."
          showIcon
        />
      ) : null}

      <Table
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={filteredActions}
        scroll={{ x: 1420 }}
        pagination={{ pageSize: 8 }}
        locale={{
          emptyText: (
            <Empty
              description={
                authenticated
                  ? `No ${writeAuditScopeLabel(scopeFilter)} visible in cache`
                  : "Connect GitHub token to view write audit"
              }
            />
          )
        }}
      />
    </section>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDashboardLoadedAt, setLastDashboardLoadedAt] = useState<string | null>(null);
  const [dashboardReadModel, setDashboardReadModel] = useState<DashboardReadModelMeta | null>(null);
  const [autoRefreshError, setAutoRefreshError] = useState<string | null>(null);
  const [error, setError] = useState<DashboardLoadError | null>(null);
  const [view, setView] = useState<DashboardView>(initialDashboardView);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenRevoking, setTokenRevoking] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [tokenRetryUntil, setTokenRetryUntil] = useState<number | null>(null);
  const [tokenRetryRemainingSeconds, setTokenRetryRemainingSeconds] = useState<number | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(initialSelectedPerson);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<MetricPeriod>("day");
  const [criticalIssueAiFilter, setCriticalIssueAiFilter] = useState<CriticalIssueAiFilter>("all");
  const [criticalIssueScopeFilter, setCriticalIssueScopeFilter] = useState<CriticalIssueScopeFilter>("all");
  const [prScopeFilter, setPrScopeFilter] = useState<PrScopeFilter>("all");
  const [prBoardTab, setPrBoardTab] = useState<PrBoardTab>("rotation");
  const [testingIssueQueueFilter, setTestingIssueQueueFilter] = useState<TestingIssueQueueFilter>("all");
  const [peopleScopeFilter, setPeopleScopeFilter] = useState<PeopleScopeFilter>("all");
  const [webhookScopeFilter, setWebhookScopeFilter] = useState<WebhookDeliveryScopeFilter>("failed");
  const [notificationDeliveryScopeFilter, setNotificationDeliveryScopeFilter] =
    useState<NotificationDeliveryScopeFilter>("attention");
  const [writeAuditScopeFilter, setWriteAuditScopeFilter] = useState<WriteAuditScopeFilter>("attention");
  const [personalDrilldownFilter, setPersonalDrilldownFilter] = useState<PersonalDrilldownFilter>("active_issues");
  const [workObjectPreview, setWorkObjectPreview] = useState<TeamWorkPreview | null>(null);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowFixPreview | null>(null);
  const [workflowExecution, setWorkflowExecution] = useState<WorkflowFixExecutionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const [executionSaving, setExecutionSaving] = useState(false);
  const [manualRefreshModalOpen, setManualRefreshModalOpen] = useState(false);
  const [manualRefreshLayers, setManualRefreshLayers] = useState<ManualRefreshLayer[]>([...syncHealthLayers]);
  const [manualRefreshSaving, setManualRefreshSaving] = useState(false);
  const [manualRefreshResult, setManualRefreshResult] = useState<ManualRefreshResult | null>(null);
  const [manualRefreshError, setManualRefreshError] = useState<string | null>(null);
  const [webhookRetrySaving, setWebhookRetrySaving] = useState(false);
  const [webhookRetryResult, setWebhookRetryResult] = useState<WebhookRetryResult | null>(null);
  const [webhookRetryError, setWebhookRetryError] = useState<string | null>(null);
  const [observedPersonPreviewState, setObservedPersonPreviewState] = useState<ObservedPersonPreview | null>(null);
  const [freshnessExpanded, setFreshnessExpanded] = useState(false);
  const [cacheEvidenceExpanded, setCacheEvidenceExpanded] = useState(false);
  const [notificationAckSavingId, setNotificationAckSavingId] = useState<number | null>(null);
  const [notificationRetrySavingId, setNotificationRetrySavingId] = useState<number | null>(null);
  const [notificationAckError, setNotificationAckError] = useState<string | null>(null);
  const [notificationTestSaving, setNotificationTestSaving] = useState(false);
  const [notificationTestResult, setNotificationTestResult] = useState<NotificationTestResult | null>(null);
  const dashboardRefreshInFlight = useRef(false);
  const latestDataRef = useRef<DashboardSummary | null>(null);
  const dashboardReadModelRef = useRef<DashboardReadModelMeta | null>(null);
  const criticalIssuesByPr = useMemo(
    () =>
      data ? criticalIssueContextsByPullRequest(data.criticalIssues) : new Map<number, PrCriticalIssueContext[]>(),
    [data]
  );

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    dashboardReadModelRef.current = dashboardReadModel;
  }, [dashboardReadModel]);

  useEffect(() => {
    if (tokenRetryUntil === null) {
      setTokenRetryRemainingSeconds(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((tokenRetryUntil - Date.now()) / 1000));
      setTokenRetryRemainingSeconds(remaining);
      if (remaining === 0) {
        setTokenRetryUntil(null);
      }
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [tokenRetryUntil]);

  async function load(options: { silent?: boolean } = {}) {
    if (dashboardRefreshInFlight.current) {
      return;
    }
    dashboardRefreshInFlight.current = true;
    const silent = Boolean(options.silent && latestDataRef.current);
    if (silent) {
      setRefreshing(true);
      setAutoRefreshError(null);
    } else {
      setLoading(true);
      setError(null);
    }
    try {
      const cachedEtag = dashboardReadModelRef.current?.etag;
      const response = await fetch("/api/dashboard", {
        headers: latestDataRef.current && cachedEtag ? { "if-none-match": cachedEtag } : undefined
      });
      const loadedAt = new Date().toISOString();
      if (response.status === 304) {
        setLastDashboardLoadedAt(loadedAt);
        setDashboardReadModel(dashboardReadModelMetaFromResponse(response, loadedAt));
        setAutoRefreshError(null);
        return;
      }
      if (!response.ok) {
        throw await responseApiError(response);
      }
      setData((await response.json()) as DashboardSummary);
      setLastDashboardLoadedAt(loadedAt);
      setDashboardReadModel(dashboardReadModelMetaFromResponse(response, loadedAt));
      setAutoRefreshError(null);
    } catch (err) {
      const loadError = dashboardLoadErrorFromUnknown(err);
      if (silent) {
        setAutoRefreshError(dashboardLoadErrorMessage(loadError));
      } else {
        setError(loadError);
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
      dashboardRefreshInFlight.current = false;
    }
  }

  async function loadSession() {
    try {
      const response = await fetch("/api/session", { credentials: "same-origin" });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setSession((await response.json()) as SessionView);
    } catch (err) {
      setSession({
        authenticated: false,
        user: null,
        tokenEncryptionConfigured: false
      });
      setTokenError(displayError(err));
    }
  }

  async function connectGitHubToken() {
    setTokenSaving(true);
    setTokenError(null);
    try {
      const response = await fetch("/api/session/github-token", {
        method: "POST",
        headers: jsonHeadersWithCsrf(),
        credentials: "same-origin",
        body: JSON.stringify({ token: tokenInput.trim() })
      });
      if (!response.ok) {
        throw await responseApiError(response);
      }
      setSession((await response.json()) as SessionView);
      setTokenInput("");
      setTokenRetryUntil(null);
      setTokenModalOpen(false);
    } catch (err) {
      if (err instanceof ApiResponseError && err.retryAfterSeconds) {
        setTokenRetryUntil(Date.now() + err.retryAfterSeconds * 1000);
        setTokenError(`${err.message} Try again in ${retryDelayText(err.retryAfterSeconds)}.`);
      } else {
        setTokenError(displayError(err));
      }
    } finally {
      setTokenSaving(false);
    }
  }

  function openTokenReconnect() {
    setTokenError(null);
    setTokenInput("");
    setTokenModalOpen(true);
  }

  async function removeConnectedGitHubToken() {
    setTokenRevoking(true);
    setTokenError(null);
    try {
      const response = await fetch("/api/session/github-token", {
        method: "DELETE",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setSession((await response.json()) as SessionView);
      setTokenInput("");
      setTokenModalOpen(false);
    } catch (err) {
      setTokenError(displayError(err));
    } finally {
      setTokenRevoking(false);
    }
  }

  function confirmRemoveConnectedToken(githubLogin: string) {
    Modal.confirm({
      title: `Remove saved GitHub token for ${githubLogin}?`,
      content:
        "This keeps the current browser signed in, but disables GitHub writes until this user connects a token again.",
      okText: "Remove token",
      okButtonProps: { danger: true },
      cancelText: "Keep token",
      onOk: () => removeConnectedGitHubToken()
    });
  }

  async function disconnectSession() {
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setSession((await response.json()) as SessionView);
    } catch (err) {
      setTokenError(displayError(err));
    }
  }

  function replaceDashboardHash(nextView: DashboardView, personLogin: string | null = selectedPerson) {
    if (typeof window === "undefined") {
      return;
    }
    const nextHash = `#${dashboardHashForView(nextView, personLogin)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }

  function selectView(nextView: DashboardView, personLogin: string | null = selectedPerson) {
    setView(nextView);
    replaceDashboardHash(nextView, personLogin);
  }

  function selectPerson(login: string) {
    setSelectedPerson(login);
    if (view === "Personal") {
      replaceDashboardHash("Personal", login);
    }
  }

  function openPersonWorkbench(login: string) {
    setSelectedPerson(login);
    selectView("Personal", login);
  }

  function openPersonalDrilldown(login: string, filter: PersonalDrilldownFilter) {
    setPersonalDrilldownFilter(filter);
    setSelectedPerson(login);
    selectView("Personal", login);
  }

  function openObservedPersonPreview(login: string) {
    if (!data) {
      return;
    }
    const preview = observedPersonPreview(data, login);
    if (preview) {
      setObservedPersonPreviewState(preview);
    }
  }

  function selectObservedPersonal(login: string) {
    setSelectedPerson(login);
    if (view === "Personal") {
      replaceDashboardHash("Personal", login);
    }
  }

  function openObservedPersonalPreview(login: string) {
    selectObservedPersonal(login);
    openObservedPersonPreview(login);
  }

  function openPeopleBoardPerson(login: string) {
    if (peopleBoardUsesObserved) {
      openObservedPersonPreview(login);
      return;
    }
    openPersonWorkbench(login);
  }

  function openPeopleBoardMetric(login: string, filter: PersonalDrilldownFilter) {
    if (peopleBoardUsesObserved) {
      setPeopleScopeFilter(peopleScopeForPersonalMetric(filter));
      openObservedPersonPreview(login);
      return;
    }
    openPersonalDrilldown(login, filter);
  }

  function openObservedPersonalMetric(login: string, filter: PersonalDrilldownFilter) {
    setPeopleScopeFilter(peopleScopeForPersonalMetric(filter));
    setPersonalDrilldownFilter(filter);
    selectObservedPersonal(login);
  }

  function openIssuesWithFilter(filters: Partial<{ ai: CriticalIssueAiFilter; scope: CriticalIssueScopeFilter }>) {
    if (filters.ai) {
      setCriticalIssueAiFilter(filters.ai);
    }
    if (filters.scope) {
      setCriticalIssueScopeFilter(filters.scope);
    }
    selectView("Issues");
  }

  function openPrsWithFilter(scope: PrScopeFilter) {
    setPrScopeFilter(scope);
    setPrBoardTab(prBoardTabForScope(scope));
    if (scope === "stale_testing") {
      setTestingIssueQueueFilter("stale");
    } else if (scope === "testing_evidence_gap") {
      setTestingIssueQueueFilter("data_gap");
    } else if (scope === "testing") {
      setTestingIssueQueueFilter("all");
    }
    selectView("PRs");
  }

  function switchPrBoardTab(nextTab: PrBoardTab) {
    setPrBoardTab(nextTab);
    if (nextTab === "rotation" && isTestingPrScope(prScopeFilter)) {
      setPrScopeFilter("all");
    }
  }

  function openCacheEvidenceImpact(target: CacheEvidenceImpactTarget) {
    if (target === "issues") {
      openIssuesWithFilter({ scope: "timeline_missing" });
      return;
    }
    if (target === "prs") {
      openPrsWithFilter("evidence_pending");
      return;
    }
    if (target === "testing") {
      openPrsWithFilter("testing_evidence_gap");
      return;
    }
    selectView("Drift");
  }

  function openPeopleWithFilter(scope: PeopleScopeFilter) {
    setPeopleScopeFilter(scope);
    selectView("People");
  }

  function openManualRefreshModal(layers?: ManualRefreshLayer[]) {
    if (layers) {
      setManualRefreshLayers(layers);
    }
    setManualRefreshError(null);
    setManualRefreshModalOpen(true);
  }

  async function queueManualRefreshForLayers(layers: ManualRefreshLayer[]) {
    if (layers.length === 0) {
      setManualRefreshError("Select at least one refresh layer.");
      return;
    }
    setManualRefreshSaving(true);
    setManualRefreshError(null);
    setManualRefreshResult(null);
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: jsonHeadersWithCsrf(),
        credentials: "same-origin",
        body: JSON.stringify({ layers })
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setManualRefreshResult((await response.json()) as ManualRefreshResult);
      setManualRefreshModalOpen(false);
      void load();
    } catch (err) {
      setManualRefreshError(displayError(err));
    } finally {
      setManualRefreshSaving(false);
    }
  }

  async function queueManualRefresh() {
    await queueManualRefreshForLayers(manualRefreshLayers);
  }

  async function retryFailedWebhooks() {
    if (!session?.authenticated) {
      setWebhookRetryError("Connect GitHub token before retrying failed webhooks.");
      return;
    }
    setWebhookRetrySaving(true);
    setWebhookRetryError(null);
    setWebhookRetryResult(null);
    try {
      const response = await fetch("/api/refresh/webhooks/retry-failed", {
        method: "POST",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setWebhookRetryResult((await response.json()) as WebhookRetryResult);
      void load({ silent: true });
    } catch (err) {
      setWebhookRetryError(displayError(err));
      void loadSession();
    } finally {
      setWebhookRetrySaving(false);
    }
  }

  async function acknowledgeNotification(delivery: NotificationDeliveryView) {
    if (!session?.authenticated) {
      setNotificationAckError("Connect GitHub token before acknowledging notifications.");
      return;
    }
    if (!notificationStatusRequiresAcknowledgement(delivery.status)) {
      setNotificationAckError(`${labelText(delivery.status)} notification deliveries do not require acknowledgement.`);
      return;
    }
    setNotificationAckSavingId(delivery.id);
    setNotificationAckError(null);
    try {
      const response = await fetch(`/api/notifications/deliveries/${delivery.id}/acknowledge`, {
        method: "POST",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      await load();
    } catch (err) {
      setNotificationAckError(displayError(err));
    } finally {
      setNotificationAckSavingId(null);
    }
  }

  async function retryNotification(delivery: NotificationDeliveryView) {
    if (!session?.authenticated) {
      setNotificationAckError("Connect GitHub token before retrying notifications.");
      return;
    }
    if (!notificationStatusAllowsRetry(delivery.status)) {
      setNotificationAckError(`${labelText(delivery.status)} notification deliveries cannot be retried.`);
      return;
    }
    setNotificationRetrySavingId(delivery.id);
    setNotificationAckError(null);
    try {
      const response = await fetch(`/api/notifications/deliveries/${delivery.id}/retry`, {
        method: "POST",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      await load();
    } catch (err) {
      setNotificationAckError(displayError(err));
    } finally {
      setNotificationRetrySavingId(null);
    }
  }

  async function sendNotificationTest() {
    if (!session?.authenticated) {
      setNotificationAckError("Connect GitHub token before sending notification tests.");
      return;
    }
    setNotificationTestSaving(true);
    setNotificationAckError(null);
    setNotificationTestResult(null);
    try {
      const response = await fetch("/api/notifications/test", {
        method: "POST",
        headers: csrfHeaders(),
        credentials: "same-origin"
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setNotificationTestResult((await response.json()) as NotificationTestResult);
      await load();
    } catch (err) {
      setNotificationAckError(displayError(err));
    } finally {
      setNotificationTestSaving(false);
    }
  }

  async function previewWorkflowFix(violation: WorkflowViolationView) {
    const actionKey = workflowFixActionForViolation(violation);
    if (!actionKey) {
      setPreviewError("No safe preview action is available for this workflow rule.");
      return;
    }
    const loadingKey = `${violation.objectType}-${violation.objectNumber}-${violation.ruleKey}`;
    setPreviewLoadingKey(loadingKey);
    setPreviewError(null);
    setWorkflowPreview(null);
    setWorkflowExecution(null);
    setPreviewModalOpen(true);
    try {
      const response = await fetch("/api/actions/workflow-fix/preview", {
        method: "POST",
        headers: jsonHeadersWithCsrf(),
        credentials: "same-origin",
        body: JSON.stringify({
          actionKey,
          objectType: violation.objectType,
          objectNumber: violation.objectNumber,
          ruleKey: violation.ruleKey
        })
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setWorkflowPreview((await response.json()) as WorkflowFixPreview);
    } catch (err) {
      setPreviewError(displayError(err));
      void loadSession();
    } finally {
      setPreviewLoadingKey(null);
    }
  }

  async function confirmWorkflowFix() {
    if (!workflowPreview) {
      return;
    }
    setExecutionSaving(true);
    setPreviewError(null);
    try {
      const response = await fetch("/api/actions/workflow-fix/confirm", {
        method: "POST",
        headers: jsonHeadersWithCsrf(),
        credentials: "same-origin",
        body: JSON.stringify({ previewId: workflowPreview.previewId })
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      const result = (await response.json()) as WorkflowFixExecutionResult;
      setWorkflowExecution(result);
      if (result.status === "token_unavailable") {
        void loadSession();
      }
      void load();
    } catch (err) {
      setPreviewError(displayError(err));
      void loadSession();
    } finally {
      setExecutionSaving(false);
    }
  }

  useEffect(() => {
    void load();
    void loadSession();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void load({ silent: true });
    };
    const intervalId = window.setInterval(refreshIfVisible, dashboardAutoRefreshMs);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, []);

  useEffect(() => {
    const syncViewFromHash = () => {
      const nextView = dashboardViewFromHash(window.location.hash);
      setView(nextView);
      if (nextView === "Personal") {
        setSelectedPerson(selectedPersonFromHash(window.location.hash));
      }
    };
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    if (!data?.personalViews.length) {
      return;
    }
    if (!selectedPerson || !data.personalViews.some((person) => person.login === selectedPerson)) {
      const fallbackLogin = data.personalViews[0].login;
      setSelectedPerson(fallbackLogin);
      if (view === "Personal") {
        replaceDashboardHash("Personal", fallbackLogin);
      }
    }
  }, [data, selectedPerson, view]);

  const criticalOwnerCoverageColumns: ColumnsType<CriticalOwnerCoverageView> = useMemo(
    () => [
      {
        title: "Owner",
        dataIndex: "ownerLogin",
        render: (owner, row) => (
          <Space size={[4, 4]} wrap>
            {owner ? <Tag>{owner}</Tag> : <Tag color="red">unowned</Tag>}
            <Tooltip title={ownerScopeTooltip(row.ownerScope)}>
              <Tag color={ownerScopeColor(row.ownerScope)}>{labelText(row.ownerScope)}</Tag>
            </Tooltip>
            {row.workflowSkipped ? (
              <Tooltip title={workflowSkipTooltip()}>
                <Tag color="default">skip automation</Tag>
              </Tooltip>
            ) : null}
          </Space>
        )
      },
      {
        title: "s-1/s0",
        dataIndex: "criticalIssues",
        width: 110,
        render: (value) => <Text strong>{value}</Text>
      },
      {
        title: "Avg Age",
        dataIndex: "averageAgeHours",
        width: 120,
        render: (value) => (value === null ? "-" : hours(value))
      }
    ],
    []
  );

  const criticalColumns: ColumnsType<CriticalIssueView> = useMemo(
    () => [
      {
        title: "Issue",
        dataIndex: "number",
        width: 92,
        render: (_, issue) => (
          <a href={issue.htmlUrl} target="_blank" rel="noreferrer">
            #{issue.number}
          </a>
        )
      },
      {
        title: "Preview",
        width: 112,
        render: (_, issue) => (
          <Tooltip title={`Preview issue ${issue.number}`}>
            <Button
              aria-label={`Preview issue ${issue.number}`}
              icon={<Eye size={14} />}
              size="small"
              onClick={() => setWorkObjectPreview({ objectType: "issue", issue })}
            >
              Preview
            </Button>
          </Tooltip>
        )
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title, issue) => (
          <Space size={8} className="table-title-cell">
            {!issue.isComplete ? <Badge color="#d97706" /> : null}
            <Text strong ellipsis={{ tooltip: title }}>
              {title}
            </Text>
          </Space>
        )
      },
      {
        title: "Workflow",
        width: 280,
        render: (_, issue) => (
          <Space size={[4, 4]} wrap>
            <Tag>{labelText(issue.lifecycleState)}</Tag>
            <Tag color={severityColor(issue.severity)}>{issue.severity ?? "unknown"}</Tag>
            <Tag color="blue">{effectiveAiEffortLabel(issue.aiEffortLabel)}</Tag>
            {!issue.isComplete ? <Tag color="gold">issue detail sync pending</Tag> : null}
            {issue.syncError ? (
              <Tooltip title={issue.syncError}>
                <Tag color="red">sync error</Tag>
              </Tooltip>
            ) : null}
          </Space>
        )
      },
      {
        title: "Linked PRs",
        width: 340,
        render: (_, issue) =>
          issue.linkedPullRequests.length === 0 ? (
            <Tag>none</Tag>
          ) : (
            <Space size={[4, 4]} wrap>
              {issue.linkedPullRequests.slice(0, 4).map((pr) => (
                <Tooltip title={linkedPrTooltip(pr)} key={pr.number}>
                  <Tag color={pr.attentionFlags.length > 0 ? "orange" : pr.state === "open" ? "blue" : "default"}>
                    <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                      #{pr.number}
                    </a>{" "}
                    {pr.testingState !== "not_ready" ? testingStateBusinessLabel(pr.testingState) : ""}
                  </Tag>
                </Tooltip>
              ))}
              {issue.linkedPullRequests.length > 4 ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview issue ${issue.number} with ${issue.linkedPullRequests.length - 4} more linked PRs`}
                  count={issue.linkedPullRequests.length - 4}
                  label="more PRs"
                  onClick={() => setWorkObjectPreview({ objectType: "issue", issue })}
                />
              ) : null}
            </Space>
          )
      },
      {
        title: "Blockers",
        width: 320,
        render: (_, issue) =>
          issue.blockers.length === 0 ? (
            <Tag color="green">clear</Tag>
          ) : (
            <Space size={[4, 4]} wrap>
              {issue.blockers.slice(0, 4).map((blocker) => (
                <Tooltip title={blocker.message} key={blocker.key}>
                  <Tag color={blockerColor(blocker.severity)}>
                    {labelText(blocker.key.split(":").at(-1) ?? blocker.key)}
                  </Tag>
                </Tooltip>
              ))}
              {issue.blockers.length > 4 ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview issue ${issue.number} with ${issue.blockers.length - 4} more blockers`}
                  count={issue.blockers.length - 4}
                  label="more blockers"
                  onClick={() => setWorkObjectPreview({ objectType: "issue", issue })}
                />
              ) : null}
            </Space>
          )
      },
      {
        title: "Owner",
        dataIndex: "ownerLogin",
        width: 216,
        render: (owner, issue) => (
          <Space size={[4, 4]} wrap>
            {owner ? (
              <Tooltip title={issue.ownerReason ? `by ${issue.ownerReason}` : undefined}>
                <Tag>{owner}</Tag>
              </Tooltip>
            ) : null}
            <Tooltip title={ownerScopeTooltip(issue.ownerScope)}>
              <Tag color={ownerScopeColor(issue.ownerScope)}>{labelText(issue.ownerScope)}</Tag>
            </Tooltip>
            {issue.workflowSkipped ? (
              <Tooltip title={workflowSkipTooltip()}>
                <Tag color="default">skip automation</Tag>
              </Tooltip>
            ) : null}
          </Space>
        )
      },
      {
        title: "s0/s-1 Duration",
        dataIndex: "criticalAgeHours",
        width: 140,
        render: (value, issue) => (
          <Tooltip
            title={
              issue.criticalAgeEvidence === "issue_timeline_event"
                ? `From GitHub issue label event at ${formatDate(issue.criticalStartedAt)}.`
                : "Missing severity timeline evidence; issue created age is not used as active severity duration."
            }
          >
            <Tag color={value === null ? "gold" : "red"}>
              {personalDurationText({ durationHours: value, durationKind: "critical_active" })}
            </Tag>
          </Tooltip>
        )
      },
      {
        title: "Last action",
        dataIndex: "lastHumanActionAt",
        width: 168,
        render: (value, issue) => (
          <Tooltip
            title={
              issue.lastHumanActionEvidence === "complete_cache"
                ? `From complete cached issue comments. Cache synced ${formatDate(issue.lastSyncedAt)}`
                : `Fallback evidence from cached issue update time. Cache synced ${formatDate(issue.lastSyncedAt)}`
            }
          >
            <Space size={4}>
              <Text>{formatDate(value)}</Text>
              {issue.lastHumanActionEvidence === "partial_cache" ? <Tag color="gold">cached update time</Tag> : null}
            </Space>
          </Tooltip>
        )
      }
    ],
    []
  );

  const prColumns: ColumnsType<PendingPrView> = useMemo(
    () => [
      {
        title: "PR",
        dataIndex: "number",
        width: 360,
        render: (_, pr) => (
          <Space orientation="vertical" size={2} className="table-title-cell">
            <Space size={6} wrap>
              <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                #{pr.number}
              </a>
              {pr.attentionFlags.length > 0 ? <Badge status="warning" /> : null}
              {pr.draft ? <Tag color="gold">draft</Tag> : null}
            </Space>
            <Text ellipsis={{ tooltip: pr.title }}>{pr.title}</Text>
          </Space>
        )
      },
      {
        title: "Preview",
        width: 112,
        render: (_, pr) => (
          <Tooltip title={`Preview PR ${pr.number}`}>
            <Button
              aria-label={`Preview PR ${pr.number}`}
              icon={<Eye size={14} />}
              size="small"
              onClick={() =>
                setWorkObjectPreview({
                  objectType: "pull_request",
                  pr,
                  activeIssues: criticalIssuesByPr.get(pr.number) ?? []
                })
              }
            >
              Preview
            </Button>
          </Tooltip>
        )
      },
      { title: "Owner", dataIndex: "ownerLogin", width: 136, render: (owner) => <Tag>{owner}</Tag> },
      {
        title: "Age",
        dataIndex: "ageHours",
        width: 104,
        render: (age) => <Tag color={age >= 24 ? "orange" : "default"}>{hours(age)}</Tag>
      },
      {
        title: "Attention",
        width: 250,
        render: (_, pr) => {
          const reasons = prAttentionReasons(pr);
          return reasons.length === 0 ? (
            <Tag color="green">clear</Tag>
          ) : (
            <Space size={[4, 4]} wrap>
              {reasons.slice(0, 4).map((reason) => (
                <Tag color={activityReasonColor(reason)} key={reason}>
                  {reason}
                </Tag>
              ))}
              {reasons.length > 4 ? (
                <LinkedOverflowButton
                  ariaLabel={`Preview PR ${pr.number} with ${reasons.length - 4} more attention signals`}
                  count={reasons.length - 4}
                  label="more signals"
                  onClick={() =>
                    setWorkObjectPreview({
                      objectType: "pull_request",
                      pr,
                      activeIssues: criticalIssuesByPr.get(pr.number) ?? []
                    })
                  }
                />
              ) : null}
            </Space>
          );
        }
      },
      {
        title: "PR blockers",
        width: 260,
        render: (_, pr) => {
          const hasBlocker =
            pr.draft ||
            prHasRequestChanges(pr) ||
            prHasFailedCi(pr) ||
            prHasConflict(pr) ||
            pr.attentionFlags.includes("review_requested_no_response");
          return hasBlocker ? (
            <Space size={[4, 4]} wrap>
              {pr.draft ? <Tag color="gold">draft</Tag> : null}
              {pr.reviewDecision ? (
                <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>
                  review {labelText(pr.reviewDecision)}
                </Tag>
              ) : pr.attentionFlags.includes("review_requested_no_response") ? (
                <Tag color="orange">review waiting</Tag>
              ) : null}
              {pr.ciState ? <Tag color={ciColor(pr.ciState)}>CI {labelText(pr.ciState)}</Tag> : null}
              {pr.mergeStateStatus ? (
                <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
              ) : null}
            </Space>
          ) : (
            <Tag color="green">no cached blocker</Tag>
          );
        }
      },
      {
        title: "Issue context",
        width: 340,
        render: (_, pr) => (
          <PrIssueContextCell
            activeIssues={criticalIssuesByPr.get(pr.number) ?? []}
            pr={pr}
            onPreview={() =>
              setWorkObjectPreview({
                objectType: "pull_request",
                pr,
                activeIssues: criticalIssuesByPr.get(pr.number) ?? []
              })
            }
          />
        )
      },
      {
        title: "Evidence",
        width: 172,
        render: (_, pr) =>
          pr.detailError ? (
            <Tooltip title={pr.detailError}>
              <Tag color="red">sync error</Tag>
            </Tooltip>
          ) : !pr.isComplete || !pr.detailSyncedAt ? (
            <Tooltip title="PR detail backfill has not completed yet. Review, CI, merge, and issue-link evidence may be incomplete.">
              <Tag color="gold">PR detail sync pending</Tag>
            </Tooltip>
          ) : (
            <Tag color="green">synced</Tag>
          )
      },
      {
        title: "Last human action",
        dataIndex: "lastHumanActionAt",
        width: 168,
        render: (value) => formatDate(value)
      }
    ],
    [criticalIssuesByPr]
  );

  const violationColumns: ColumnsType<WorkflowViolationView> = useMemo(
    () => [
      {
        title: "Object",
        width: 108,
        render: (_, violation) => (
          <a href={violation.htmlUrl} target="_blank" rel="noreferrer">
            {violation.objectType === "issue" ? "Issue" : "PR"} #{violation.objectNumber}
          </a>
        )
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title) => (
          <Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Text>
        )
      },
      {
        title: "Rule",
        dataIndex: "ruleKey",
        width: 220,
        render: (rule) => <Tag color="blue">{labelText(rule)}</Tag>
      },
      {
        title: "Severity",
        dataIndex: "severity",
        width: 112,
        render: (severity) => <Tag color={violationColor(severity)}>{severity}</Tag>
      },
      {
        title: "Related",
        dataIndex: "relatedLogin",
        width: 140,
        render: (login) => (login ? <Tag>{login}</Tag> : <Tag color="red">unowned</Tag>)
      },
      {
        title: "Notification",
        width: 220,
        render: (_, violation) => <NotificationTraceTag notification={violation.notification} />
      },
      {
        title: "Evidence",
        dataIndex: "evidenceSummary",
        width: 320,
        ellipsis: true,
        render: (value) => <Text ellipsis={{ tooltip: value }}>{value}</Text>
      },
      {
        title: "Suggested action",
        dataIndex: "suggestedAction",
        width: 360,
        ellipsis: true,
        render: (value, violation) => (
          <Space size={6}>
            {violation.fixable ? <Badge color="#2563eb" /> : null}
            <Text ellipsis={{ tooltip: value }}>{value}</Text>
          </Space>
        )
      },
      {
        title: "Preview",
        width: 132,
        render: (_, violation) => {
          const actionKey = workflowFixActionForViolation(violation);
          const supportsPreview = actionKey !== null;
          const issueLabelCapability = session?.user?.writeCapabilities.issueLabels ?? null;
          const tokenServerReady = session?.tokenEncryptionConfigured !== false;
          const canPreview = supportsPreview && tokenServerReady && issueLabelCapability?.enabled === true;
          const tooltip = !session?.authenticated
            ? "Connect GitHub token to preview fixes"
            : !tokenServerReady
              ? tokenEncryptionSetupHint
              : !supportsPreview
                ? "No safe preview action for this rule yet"
                : issueLabelCapability?.enabled
                  ? `Preview ${labelText(actionKey)}`
                  : (issueLabelCapability?.message ?? "Reconnect GitHub token before workflow fixes are enabled");
          return (
            <Tooltip title={tooltip}>
              <span>
                <Button
                  aria-label="Preview workflow fix"
                  icon={<ClipboardCheck size={15} />}
                  disabled={!session?.authenticated || !canPreview}
                  loading={
                    previewLoadingKey === `${violation.objectType}-${violation.objectNumber}-${violation.ruleKey}`
                  }
                  onClick={() => void previewWorkflowFix(violation)}
                />
              </span>
            </Tooltip>
          );
        }
      }
    ],
    [previewLoadingKey, session]
  );

  const driftColumns: ColumnsType<AiDriftSignalView> = useMemo(
    () => [
      {
        title: "Object",
        width: 108,
        render: (_, signal) => (
          <a href={signal.htmlUrl} target="_blank" rel="noreferrer">
            {signal.objectType === "issue" ? "Issue" : "PR"} #{signal.objectNumber}
          </a>
        )
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title) => (
          <Text strong ellipsis={{ tooltip: title }}>
            {title}
          </Text>
        )
      },
      {
        title: "Signal",
        dataIndex: "ruleKey",
        width: 220,
        render: (rule) => <Tag color="purple">{labelText(rule)}</Tag>
      },
      {
        title: "Severity",
        dataIndex: "severity",
        width: 112,
        render: (severity) => <Tag color={signalColor(severity)}>{severity}</Tag>
      },
      {
        title: "Owner",
        dataIndex: "ownerLogin",
        width: 140,
        render: (login) => (login ? <Tag>{login}</Tag> : <Tag color="red">unowned</Tag>)
      },
      {
        title: "AI label",
        dataIndex: "aiEffortLabel",
        width: 128,
        render: (label) => <Tag color="blue">{effectiveAiEffortLabel(label)}</Tag>
      },
      {
        title: "Notification",
        width: 220,
        render: (_, signal) => <NotificationTraceTag notification={signal.notification} />
      },
      {
        title: "Elapsed",
        dataIndex: "actualHours",
        width: 112,
        render: (value) => (typeof value === "number" ? hours(value) : "-")
      },
      {
        title: "Evidence",
        dataIndex: "evidenceSummary",
        width: 360,
        ellipsis: true,
        render: (value, signal) => (
          <Space size={6}>
            {signal.sourceCompleteness === "partial_cache" ? <Tag>incomplete evidence</Tag> : null}
            <Text ellipsis={{ tooltip: value }}>{value}</Text>
          </Space>
        )
      },
      {
        title: "Suggested action",
        dataIndex: "suggestedAction",
        width: 360,
        ellipsis: true,
        render: (value) => <Text ellipsis={{ tooltip: value }}>{value}</Text>
      }
    ],
    []
  );

  const notificationColumns: ColumnsType<NotificationDeliveryView> = useMemo(
    () => [
      {
        title: "Status",
        dataIndex: "status",
        width: 164,
        render: (status) => <Tag color={notificationStatusColor(status)}>{labelText(status)}</Tag>
      },
      {
        title: "Source",
        width: 172,
        render: (_, delivery) => (
          <Space size={[4, 4]} wrap>
            <Tag>{labelText(delivery.sourceType)}</Tag>
            <Tag color="blue">{labelText(delivery.ruleKey)}</Tag>
          </Space>
        )
      },
      {
        title: "Object",
        width: 120,
        render: (_, delivery) =>
          delivery.objectNumber ? (
            <Text>
              {labelText(delivery.objectType)} #{delivery.objectNumber}
            </Text>
          ) : (
            <Text type="secondary">-</Text>
          )
      },
      {
        title: "Route",
        dataIndex: "recipientScope",
        width: 148,
        render: (scope) => <Tag>{labelText(scope)}</Tag>
      },
      {
        title: "Attempted",
        dataIndex: "attemptedAt",
        width: 168,
        render: (value) => formatDate(value)
      },
      {
        title: "Acknowledgement",
        width: 188,
        render: (_, delivery) => {
          const canAcknowledge = notificationStatusRequiresAcknowledgement(delivery.status);
          if (delivery.acknowledgedAt) {
            return (
              <Tooltip title={`Acknowledged by ${delivery.acknowledgedBy ?? "unknown"}`}>
                <Tag color="green">{formatDate(delivery.acknowledgedAt)}</Tag>
              </Tooltip>
            );
          }
          if (!canAcknowledge) {
            return <Tag color="default">not required</Tag>;
          }
          return (
            <Tooltip
              title={session?.authenticated ? "Acknowledge notification" : "Connect GitHub token to acknowledge"}
            >
              <span>
                <Button
                  size="small"
                  icon={<ClipboardCheck size={14} />}
                  disabled={!session?.authenticated}
                  loading={notificationAckSavingId === delivery.id}
                  onClick={() => void acknowledgeNotification(delivery)}
                >
                  Ack
                </Button>
              </span>
            </Tooltip>
          );
        }
      },
      {
        title: "Error",
        dataIndex: "errorMessage",
        ellipsis: true,
        render: (value) =>
          value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : <Text type="secondary">-</Text>
      },
      {
        title: "Retry",
        width: 116,
        render: (_, delivery) => {
          const canRetry = notificationStatusAllowsRetry(delivery.status);
          if (!canRetry) {
            return <Text type="secondary">-</Text>;
          }
          return (
            <Tooltip title={session?.authenticated ? "Retry notification delivery" : "Connect GitHub token to retry"}>
              <span>
                <Button
                  size="small"
                  icon={<RefreshCw size={14} />}
                  disabled={!session?.authenticated}
                  loading={notificationRetrySavingId === delivery.id}
                  onClick={() => void retryNotification(delivery)}
                >
                  Retry
                </Button>
              </span>
            </Tooltip>
          );
        }
      }
    ],
    [notificationAckSavingId, notificationRetrySavingId, session]
  );

  const writeActionColumns: ColumnsType<WriteActionExecutionView> = useMemo(
    () => [
      {
        title: "Status",
        dataIndex: "status",
        width: 148,
        render: (status) => <Tag color={workflowExecutionStatusColor(status)}>{labelText(status)}</Tag>
      },
      {
        title: "Actor",
        dataIndex: "githubLogin",
        width: 140,
        render: (login) => <Tag>{login}</Tag>
      },
      {
        title: "Object",
        width: 132,
        render: (_, execution) => {
          if (execution.objectType === "notification_probe") {
            return <Text>{writeActionObjectLabel(execution.objectType)}</Text>;
          }
          return execution.htmlUrl ? (
            <a href={execution.htmlUrl} target="_blank" rel="noreferrer">
              {writeActionObjectLabel(execution.objectType)} #{execution.objectNumber}
            </a>
          ) : (
            <Text>
              {writeActionObjectLabel(execution.objectType)} #{execution.objectNumber}
            </Text>
          );
        }
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title) => <Text ellipsis={{ tooltip: title }}>{title}</Text>
      },
      {
        title: "Action",
        dataIndex: "actionKey",
        width: 180,
        render: (action) => <Tag color="blue">{labelText(action)}</Tag>
      },
      {
        title: "Operations",
        dataIndex: "executedOperations",
        width: 300,
        render: (operations: WriteActionExecutionView["executedOperations"]) =>
          operations.length === 0 ? (
            <Tag>none</Tag>
          ) : (
            <Space size={[4, 4]} wrap>
              {operations.slice(0, 4).map((operation, index) => (
                <Tooltip
                  key={`${operation.type}-${index}`}
                  title={operation.type === "add_comment" ? operation.body : undefined}
                >
                  <Tag color={operation.type === "remove_label" ? "orange" : "green"}>
                    {workflowOperationSummary(operation)}
                  </Tag>
                </Tooltip>
              ))}
              {operations.length > 4 ? <Tag>+{operations.length - 4}</Tag> : null}
            </Space>
          )
      },
      {
        title: "Finished",
        dataIndex: "finishedAt",
        width: 168,
        render: (value) => formatDate(value)
      },
      {
        title: "Error",
        dataIndex: "errorMessage",
        width: 300,
        ellipsis: true,
        render: (value) =>
          value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : <Text type="secondary">-</Text>
      }
    ],
    []
  );

  const testerColumns: ColumnsType<DashboardSummary["testing"]["testers"][number]> = useMemo(
    () => [
      { title: "Tester", dataIndex: "login", render: (login) => <Tag>{login}</Tag> },
      {
        title: "Queue Issues",
        dataIndex: "queueIssues",
        render: (value) => (value > 0 ? <Tag color="blue">{value}</Tag> : <Tag>0</Tag>)
      },
      {
        title: "Linked PRs",
        dataIndex: "queuePrs",
        render: (value) => (value > 0 ? <Tag color="blue">{value}</Tag> : <Tag>0</Tag>)
      },
      {
        title: "Average Issue Wait",
        dataIndex: "averageIssueQueueAgeHours",
        render: (value) => (value === null ? "-" : hours(value))
      },
      {
        title: "Handoff To Close",
        dataIndex: "averageHandoffToCloseHours",
        render: (value, row) =>
          value === null ? (
            <Text type="secondary">{row.handoffToCloseSamples} samples</Text>
          ) : (
            `${hours(value)} (${row.handoffToCloseSamples})`
          )
      }
    ],
    []
  );
  const testingIssueTransitionColumns: ColumnsType<DashboardSummary["testing"]["recentIssueTransitions"][number]> =
    useMemo(
      () => [
        {
          title: "Issue",
          dataIndex: "issueNumber",
          width: 112,
          render: (number) => (
            <a
              href={`https://github.com/${data?.repo.owner}/${data?.repo.name}/issues/${number}`}
              target="_blank"
              rel="noreferrer"
            >
              #{number}
            </a>
          )
        },
        {
          title: "Test start",
          width: 300,
          render: (_, transition) => (
            <Space size={4} wrap>
              <TestingStateTag state={transition.fromState} />
              <Text type="secondary">-&gt;</Text>
              <TestingStateTag state={transition.toState} />
            </Space>
          )
        },
        {
          title: "Testers",
          dataIndex: "testingTesters",
          width: 220,
          render: (testers: string[]) =>
            testers.length === 0 ? (
              <Text type="secondary">-</Text>
            ) : (
              <Space size={[4, 4]} wrap>
                {testers.map((tester) => (
                  <Tag key={tester}>{tester}</Tag>
                ))}
              </Space>
            )
        },
        {
          title: "Handoff evidence",
          dataIndex: "testingSignals",
          ellipsis: true,
          render: (signals: string[]) =>
            signals.length === 0 ? (
              <Text type="secondary">-</Text>
            ) : (
              <Space size={[4, 4]} wrap>
                {signals.slice(0, 4).map((signal) => (
                  <Tooltip key={signal} title={signal}>
                    <Tag color={testingSignalTagColor(signal)}>{testingSignalTagLabel(signal)}</Tag>
                  </Tooltip>
                ))}
                {signals.length > 4 ? <Tag>+{signals.length - 4}</Tag> : null}
              </Space>
            )
        },
        {
          title: "Started",
          dataIndex: "occurredAt",
          width: 148,
          render: (value) => formatDate(value)
        },
        {
          title: "Evidence",
          dataIndex: "sourceCompleteness",
          width: 116,
          render: (value) => (
            <Tag color={value === "complete_cache" ? "green" : "orange"}>
              {value === "complete_cache" ? "assignment event" : "issue timestamp"}
            </Tag>
          )
        }
      ],
      [data?.repo.name, data?.repo.owner]
    );
  const selectedPersonalView =
    data?.personalViews.find((person) => person.login === selectedPerson) ?? data?.personalViews[0] ?? null;
  const observedPeople = data
    ? observedPeopleFromDashboard({
        criticalIssues: data.criticalIssues,
        pendingPrs: data.pendingPrs
      })
    : [];
  const selectedObservedLogin =
    data && data.personalViews.length === 0 && observedPeople.length > 0
      ? ((observedPeople.some((person) => person.login === selectedPerson)
          ? selectedPerson
          : observedPeople[0]?.login) ?? null)
      : null;
  const selectedObservedPersonPreview =
    data && selectedObservedLogin ? observedPersonPreview(data, selectedObservedLogin) : null;
  const peopleBoardUsesObserved = Boolean(data && data.people.length === 0 && observedPeople.length > 0);
  const peopleBoardPeople = data ? (data.people.length > 0 ? data.people : observedPeople) : [];
  const peopleBoardCounts = peopleBoardScopeCounts(peopleBoardPeople, data?.personalViews ?? []);
  const teamTrendPoints = data ? teamMetricPoints(data.analytics, analyticsPeriod) : [];
  const teamTriage = data ? teamTriageSnapshot(data) : null;
  const personalTrendPoints = selectedPersonalView ? personalMetricPoints(selectedPersonalView, analyticsPeriod) : [];
  const filteredPendingPrs = data
    ? sortPendingPrsForAction(filterPendingPrs(data.pendingPrs, prScopeFilter, criticalIssuesByPr), criticalIssuesByPr)
    : [];
  const filteredCriticalIssuesForTable = data
    ? sortCriticalIssuesForAction(
        filterCriticalIssues(data.criticalIssues, criticalIssueAiFilter, criticalIssueScopeFilter)
      )
    : [];
  const filteredPeople = data ? filterPeopleByScope(peopleBoardPeople, data.personalViews, peopleScopeFilter) : [];
  const notificationDeliveryCounts = data ? notificationDeliveryScopeCounts(data.notifications.lastDeliveries) : null;
  const filteredNotificationDeliveries = data
    ? data.notifications.lastDeliveries.filter((delivery) =>
        notificationDeliveryMatchesScope(delivery, notificationDeliveryScopeFilter)
      )
    : [];
  const teamFlowSummary = data
    ? flowEfficiencySummary({
        points: teamTrendPoints,
        pendingPrs: data.pendingPrs,
        activeIssues: data.criticalIssues,
        testingQueuePrs: data.testing.queueIssues,
        averageTestingQueueAgeHours: data.testing.averageIssueQueueAgeHours,
        needsTriageIssues: teamTriage?.needsTriageIssues ?? 0,
        deferredIssues: teamTriage?.deferredIssues ?? 0
      })
    : null;
  const latestRateLimitHealth = data?.sync.health.find((item) => item.rateLimitRemaining !== null) ?? null;
  const latestRateLimitRemaining = latestRateLimitHealth?.rateLimitRemaining ?? null;
  const testingHasTurnoverHistory = data
    ? data.testing.issueTransitionEvents > 0 || data.testing.handoffToCloseSamples > 0
    : false;
  const testingHasIssueTransitions = data
    ? data.testing.issueTransitionEvents > 0 || data.testing.recentIssueTransitions.length > 0
    : false;
  const scrollTestingIssueQueueIntoView = () => {
    document.getElementById("testing-issue-queue")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const openTestingIssueQueueFilter = (nextFilter: TestingIssueQueueFilter) => {
    setTestingIssueQueueFilter(nextFilter);
    setPrBoardTab("testing");
    window.setTimeout(scrollTestingIssueQueueIntoView, 0);
  };
  const criticalOwnerCoverageRows = data
    ? data.criticalOwnerCoverage.filter((owner) => owner.ownerScope !== "watched" || owner.workflowSkipped).slice(0, 8)
    : [];
  const notStartedSyncLayers = data?.sync.health.filter((item) => item.status === "not_started") ?? [];
  const profileSetupIssueCount = data ? data.profileWarnings.length + data.profileActions.length : 0;
  const profileSetupCapabilities = data ? profileCapabilityCards(data) : [];
  const showProfileSetup =
    Boolean(data) &&
    view === "Overview" &&
    (profileSetupIssueCount > 0 || profileSetupCapabilities.some((capability) => capability.configured));
  const freshness = data ? summarizeFreshness(data.sync) : null;
  const cacheEvidence = data ? summarizeCacheEvidence({ sync: data.sync, visibility: data.visibility }) : null;
  const cacheImpactItems = data ? cacheEvidenceImpactItems(data) : [];
  const authenticatedUser = session?.authenticated && session.user ? session.user : null;
  const headerIssueLabelCapability = authenticatedUser?.writeCapabilities.issueLabels ?? null;
  const headerWriteBackDisabled = headerIssueLabelCapability?.status === "write_back_disabled";
  const tokenEncryptionUnavailable = session?.tokenEncryptionConfigured === false;
  const tokenRetryActive = tokenRetryRemainingSeconds !== null && tokenRetryRemainingSeconds > 0;
  const systemViewMenuItems: MenuProps["items"] = systemViewOptions.map((option) => ({
    key: option,
    label: option
  }));
  const systemViewActive = systemViewOptionSet.has(view);

  return (
    <Layout className="app-shell">
      <Header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            DF
          </span>
          <div>
            <Text className="eyebrow">DevFlow Observatory</Text>
            <Title level={3} className="page-title">
              {data ? data.repo.key : "Development Flow"}
            </Title>
            <Text className="brand-subtitle">Issue, PR, and testing rotation</Text>
          </div>
        </div>
        <Space className="topbar-actions" size={[8, 8]} wrap>
          <nav className="view-tabs-scroll" aria-label="Dashboard views">
            <Segmented
              className="view-tabs"
              value={view}
              onChange={(value) => selectView(String(value) as DashboardView)}
              options={[...primaryViewOptions]}
            />
            <Dropdown
              trigger={["click"]}
              menu={{
                items: systemViewMenuItems,
                selectedKeys: systemViewActive ? [view] : [],
                onClick: ({ key }) => selectView(key as DashboardView)
              }}
            >
              <Button className={`system-view-menu-trigger ${systemViewActive ? "is-active" : ""}`} size="small">
                System
                <ChevronDown size={14} aria-hidden="true" />
              </Button>
            </Dropdown>
          </nav>
          {authenticatedUser && headerIssueLabelCapability ? (
            <Space className="account-actions" size={[8, 8]} wrap>
              <Avatar size={28} src={authenticatedUser.avatarUrl}>
                {authenticatedUser.githubLogin.slice(0, 1).toUpperCase()}
              </Avatar>
              <Tooltip
                title={`This browser session is connected as ${authenticatedUser.githubLogin}. GitHub writes use this identity.`}
              >
                <Tag>{authenticatedUser.githubLogin}</Tag>
              </Tooltip>
              <Tag color="blue">this browser</Tag>
              <Tooltip title={<TokenCapabilityPanel capability={headerIssueLabelCapability} />}>
                <Tag color={capabilityStatusColor(headerIssueLabelCapability.status)}>
                  {headerIssueLabelCapability.enabled ? "write ready" : labelText(headerIssueLabelCapability.status)}
                </Tag>
              </Tooltip>
              <Tooltip
                title={
                  tokenEncryptionUnavailable
                    ? tokenEncryptionSetupHint
                    : headerIssueLabelCapability.enabled
                      ? "Reconnect GitHub token"
                      : headerIssueLabelCapability.message
                }
              >
                <Button
                  aria-label="Reconnect GitHub token"
                  icon={<KeyRound size={16} />}
                  disabled={tokenEncryptionUnavailable || headerWriteBackDisabled}
                  onClick={openTokenReconnect}
                >
                  {headerIssueLabelCapability.enabled ? null : headerWriteBackDisabled ? "Read-only" : "Reconnect"}
                </Button>
              </Tooltip>
              <Tooltip title="Sign out of this browser session">
                <Button icon={<LogOut size={16} />} onClick={() => void disconnectSession()} />
              </Tooltip>
            </Space>
          ) : (
            <Tooltip
              title={
                tokenEncryptionUnavailable
                  ? tokenEncryptionSetupHint
                  : "Connect your own GitHub token. Each teammate uses a separate session."
              }
            >
              <Button icon={<KeyRound size={16} />} disabled={tokenEncryptionUnavailable} onClick={openTokenReconnect}>
                Connect GitHub
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Refresh cached dashboard">
            <Button icon={<RefreshCw size={16} />} onClick={() => void load()} loading={loading || refreshing} />
          </Tooltip>
          <Tooltip
            title={session?.authenticated ? "Queue worker refresh" : "Connect GitHub token to queue worker refresh"}
          >
            <Button
              icon={<RefreshCcw size={16} />}
              disabled={!session?.authenticated}
              loading={manualRefreshSaving}
              onClick={() => openManualRefreshModal()}
            />
          </Tooltip>
        </Space>
      </Header>
      <Content className="content">
        {error ? (
          <Alert
            className="band"
            type="error"
            title="Dashboard unavailable"
            description={<DashboardLoadErrorDescription error={error} />}
            action={
              <Space size={[8, 8]} wrap>
                <Button
                  icon={<RefreshCw size={14} />}
                  loading={loading || refreshing}
                  size="small"
                  onClick={() => void load()}
                >
                  Retry
                </Button>
                <Button href="/health" icon={<ExternalLink size={14} />} size="small" target="_blank">
                  API health
                </Button>
              </Space>
            }
            showIcon
          />
        ) : null}
        {manualRefreshError ? (
          <Alert
            className="band"
            type="error"
            title="Refresh was not queued"
            description={manualRefreshError}
            showIcon
          />
        ) : null}
        {manualRefreshResult ? (
          <Alert
            className="band"
            type="success"
            title={`Queued ${manualRefreshResult.queuedJobs.length} refresh jobs`}
            description={`Request #${manualRefreshResult.requestId} at ${formatDate(manualRefreshResult.requestedAt)}: ${manualRefreshResult.requestedLayers
              .map(labelText)
              .join(", ")}`}
            showIcon
          />
        ) : null}
        {webhookRetryError ? (
          <Alert
            className="band"
            type="error"
            title="Webhook retry was not queued"
            description={webhookRetryError}
            showIcon
          />
        ) : null}
        {webhookRetryResult ? (
          <Alert
            className="band"
            type={webhookRetryResult.retriedDeliveries > 0 ? "success" : "info"}
            title={
              webhookRetryResult.retriedDeliveries > 0
                ? `Retried ${webhookRetryResult.retriedDeliveries} failed webhook deliveries`
                : "No failed webhook deliveries to retry"
            }
            description={
              webhookRetryResult.retriedDeliveries > 0
                ? `Queued ${webhookRetryResult.queuedJobs.length} repair jobs at ${formatDate(webhookRetryResult.requestedAt)}.`
                : "Webhook failure state was already clear when the retry was requested."
            }
            showIcon
          />
        ) : null}
        {autoRefreshError && data ? (
          <Alert
            className="band"
            type="warning"
            title="Dashboard auto refresh failed"
            description={autoRefreshError}
            showIcon
          />
        ) : null}
        {loading && !data ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : data ? (
          <>
            {dashboardReadModel?.status === "stale-if-error" ? (
              <Alert
                className="band"
                type="warning"
                title="Showing last successful dashboard snapshot"
                description={`Read-model refresh failed; visible data was generated ${formatDate(data.sync.generatedAt)} and returned from the in-memory dashboard cache at ${formatDate(dashboardReadModel.receivedAt)}.`}
                showIcon
              />
            ) : null}

            {freshness ? (
              <FreshnessStatusBar
                freshness={freshness}
                sync={data.sync}
                webhookReadiness={summarizeWebhookReadiness(data)}
                readModel={dashboardReadModel}
                refreshing={refreshing}
                autoRefreshError={autoRefreshError}
                lastLoadedAt={lastDashboardLoadedAt}
                expanded={freshnessExpanded}
                onExpandedChange={setFreshnessExpanded}
                onOpenHealth={() => selectView("Health")}
                onOpenWebhooks={() => selectView("Webhooks")}
              />
            ) : null}

            {cacheEvidence && cacheEvidence.severity !== "ok" ? (
              <CacheEvidenceBanner
                cacheEvidence={cacheEvidence}
                sync={data.sync}
                authenticated={Boolean(session?.authenticated)}
                saving={manualRefreshSaving}
                impactItems={cacheImpactItems}
                expanded={cacheEvidenceExpanded}
                onExpandedChange={setCacheEvidenceExpanded}
                onImpactSelect={openCacheEvidenceImpact}
                onPrepare={openManualRefreshModal}
                onQueue={(layers) => void queueManualRefreshForLayers(layers)}
              />
            ) : null}

            {notStartedSyncLayers.length > 0 && view !== "Health" ? (
              <Alert
                className="band"
                type="warning"
                title="Some sync layers have never run"
                description={`Missing layers: ${notStartedSyncLayers.map((item) => labelText(item.layer)).join(", ")}.`}
                showIcon
              />
            ) : null}

            {view === "Overview" ? (
              <TeamRotationOverview
                data={data}
                session={session}
                flowSummary={teamFlowSummary}
                trendPoints={teamTrendPoints}
                analyticsPeriod={analyticsPeriod}
                onAnalyticsPeriodChange={setAnalyticsPeriod}
                onNavigate={selectView}
                onConnectToken={openTokenReconnect}
                onPersonSelect={openPersonWorkbench}
                criticalAiFilter={criticalIssueAiFilter}
                criticalScopeFilter={criticalIssueScopeFilter}
                onCriticalAiFilterChange={setCriticalIssueAiFilter}
                onCriticalScopeFilterChange={setCriticalIssueScopeFilter}
                onOpenIssuesFilter={openIssuesWithFilter}
                onOpenPrsFilter={openPrsWithFilter}
                onOpenPeopleFilter={openPeopleWithFilter}
              />
            ) : null}

            {showProfileSetup ? (
              <details className="secondary-disclosure">
                <summary>
                  <span>Profile setup</span>
                  <Tag color={profileSetupIssueCount > 0 ? "orange" : "green"}>
                    {profileSetupIssueCount > 0
                      ? `${profileSetupIssueCount} ${profileSetupIssueCount === 1 ? "action" : "actions"}`
                      : "configured"}
                  </Tag>
                </summary>
                <div className="secondary-disclosure-body">
                  <div className="profile-capability-grid" aria-label="Repository profile capabilities">
                    {profileSetupCapabilities.map((capability) => (
                      <div className="profile-capability-item" key={capability.key}>
                        <div>
                          <Text strong>{capability.label}</Text>
                          <Text type="secondary">{capability.detail}</Text>
                        </div>
                        <Tag color={capability.configured ? "green" : "default"}>{capability.value}</Tag>
                      </div>
                    ))}
                  </div>

                  {data.profileWarnings.map((warning) => (
                    <Alert
                      key={warning.key}
                      className="band"
                      type={profileWarningAlertType(warning.severity)}
                      title={warning.title}
                      description={`${warning.description} ${warning.action}`}
                      showIcon
                    />
                  ))}

                  {!session?.authenticated &&
                  data.profileSetup.status === "action_required" &&
                  data.profileActions.length > 0 &&
                  !data.profileSetup.yamlPatch ? (
                    <Alert
                      className="band"
                      type="info"
                      title="Profile setup details are operator-only"
                      description="Anonymous viewers can see that repository setup is incomplete, but candidate GitHub logins and copyable YAML patches are hidden until login."
                      showIcon
                    />
                  ) : null}

                  {data.profileActions.length > 0 ? (
                    <section className="section">
                      <div className="section-heading">
                        <Title level={4}>Profile Actions</Title>
                        <Tag color="orange">{data.profileActions.length}</Tag>
                      </div>
                      {data.profileSetup.status === "action_required" && data.profileSetup.yamlPatch ? (
                        <div className="profile-setup-summary">
                          <div className="subsection-heading">
                            <Title level={5}>Setup Patch</Title>
                            <Space size={[4, 4]} wrap>
                              {data.profileSetup.missingCapabilities.map((capability) => (
                                <Tag color="orange" key={capability}>
                                  {profileSetupCapabilityLabel(capability)}
                                </Tag>
                              ))}
                            </Space>
                          </div>
                          {data.profileSetup.candidateLogins.length > 0 ? (
                            <Space size={[4, 4]} wrap>
                              {data.profileSetup.candidateLogins.map((login) => (
                                <Tag key={login}>{login}</Tag>
                              ))}
                            </Space>
                          ) : null}
                          <Paragraph className="config-snippet" copyable={{ text: data.profileSetup.yamlPatch }}>
                            {data.profileSetup.yamlPatch}
                          </Paragraph>
                        </div>
                      ) : null}
                      <Space orientation="vertical" size={12} className="full-width">
                        {data.profileActions.map((suggestion) => (
                          <Alert
                            key={suggestion.key}
                            type={profileWarningAlertType(suggestion.severity)}
                            title={suggestion.title}
                            description={
                              <Space orientation="vertical" size={8} className="full-width">
                                <Text>
                                  {suggestion.description} {suggestion.action}
                                </Text>
                                {suggestion.relatedLogins.length > 0 ? (
                                  <Space size={[4, 4]} wrap>
                                    {suggestion.relatedLogins.map((login) => (
                                      <Tag color={attentionSeverityColor(suggestion.severity)} key={login}>
                                        {login}
                                      </Tag>
                                    ))}
                                  </Space>
                                ) : null}
                                {suggestion.yamlSnippet ? (
                                  <Paragraph className="config-snippet" copyable={{ text: suggestion.yamlSnippet }}>
                                    {suggestion.yamlSnippet}
                                  </Paragraph>
                                ) : null}
                              </Space>
                            }
                            showIcon
                          />
                        ))}
                      </Space>
                    </section>
                  ) : null}
                </div>
              </details>
            ) : null}

            {view === "Health" ? (
              <HealthBoard
                data={data}
                session={session}
                authenticated={Boolean(session?.authenticated)}
                manualRefreshSaving={manualRefreshSaving}
                webhookRetrySaving={webhookRetrySaving}
                cacheImpactItems={cacheImpactItems}
                onQueueLayers={(layers) => void queueManualRefreshForLayers(layers)}
                onOpenView={selectView}
                onImpactSelect={openCacheEvidenceImpact}
                onConnectToken={openTokenReconnect}
                onRetryFailedWebhooks={() => void retryFailedWebhooks()}
              />
            ) : null}

            {view !== "Health" ? <UpdateRuntimeBanner data={data} onOpenHealth={() => selectView("Health")} /> : null}

            {latestRateLimitRemaining !== null && latestRateLimitRemaining <= 10 && view !== "Health" ? (
              <Alert
                className="band"
                type={latestRateLimitRemaining <= 0 ? "error" : "warning"}
                title="GitHub API rate limit is low"
                description={`Latest ${latestRateLimitHealth?.layer ?? "sync"} run reported ${latestRateLimitRemaining} requests remaining.`}
                showIcon
              />
            ) : null}

            {data.testing.staleQueueIssues > 0 && view !== "PRs" ? (
              <Alert
                className="band"
                type="warning"
                title={`${data.testing.staleQueueIssues} issues have waited on test too long`}
                description="Some test waits still use cached issue update time until GitHub issue timeline handoff evidence is backfilled."
                action={
                  <Button size="small" onClick={() => openPrsWithFilter("stale_testing")}>
                    Open test queue
                  </Button>
                }
                showIcon
              />
            ) : null}

            {data.webhooks.failedDeliveries > 0 && view !== "Health" && view !== "Webhooks" ? (
              <Alert
                className="band"
                type="warning"
                title="Webhook ingestion has failed deliveries"
                description={
                  data.webhooks.latestFailure ?? `${data.webhooks.failedDeliveries} webhook deliveries failed.`
                }
                action={
                  <Button
                    size="small"
                    disabled={!session?.authenticated}
                    loading={webhookRetrySaving}
                    onClick={() => void retryFailedWebhooks()}
                  >
                    Retry failed webhooks
                  </Button>
                }
                showIcon
              />
            ) : null}

            {view === "Notifications" ? (
              <section className="section">
                <div className="section-heading">
                  <Space>
                    <BellRing size={18} />
                    <Title level={4}>Notifications</Title>
                  </Space>
                  <Space size={[6, 6]} wrap>
                    <Tag color={notificationReadinessColor(data.notifications.readiness.status)}>
                      {labelText(data.notifications.readiness.status)}
                    </Tag>
                    <Tag color={data.notifications.enabled ? "green" : "default"}>
                      {data.notifications.enabled ? "enabled" : "disabled"}
                    </Tag>
                    <Tag color={data.notifications.webhookConfigured ? "green" : "orange"}>
                      {data.notifications.webhookConfigured ? "webhook configured" : "no webhook"}
                    </Tag>
                    <Tag>{data.notifications.readiness.mappedEmployees} mapped employees</Tag>
                    <Tag color={data.notifications.readiness.missingEmployeeMappings > 0 ? "orange" : "green"}>
                      {data.notifications.readiness.missingEmployeeMappings} missing mappings
                    </Tag>
                    <Tag>{data.notifications.cooldownHours}h cooldown</Tag>
                    <Tag color={data.notifications.unacknowledgedDeliveries > 0 ? "orange" : "green"}>
                      {data.notifications.unacknowledgedDeliveries} unacknowledged
                    </Tag>
                    <Tag color={data.notifications.escalationPendingDeliveries > 0 ? "red" : "green"}>
                      {data.notifications.escalationPendingDeliveries} escalation pending
                    </Tag>
                    <Tooltip
                      title={
                        session?.authenticated
                          ? "Send a controlled Enterprise WeChat test message"
                          : "Connect GitHub token before sending notification tests"
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          icon={<BellRing size={14} />}
                          disabled={!session?.authenticated}
                          loading={notificationTestSaving}
                          onClick={() => void sendNotificationTest()}
                        >
                          Send test
                        </Button>
                      </span>
                    </Tooltip>
                  </Space>
                </div>
                {notificationAckError ? (
                  <Alert
                    className="band"
                    type="error"
                    title="Notification action failed"
                    description={notificationAckError}
                    showIcon
                  />
                ) : null}
                {notificationTestResult ? (
                  <Alert
                    className="band"
                    type={notificationTestResult.auditRecorded ? "success" : "warning"}
                    title="Notification test sent"
                    description={`WeCom returned HTTP ${notificationTestResult.providerStatus} at ${formatDate(
                      notificationTestResult.attemptedAt
                    )}.${notificationTestResult.auditRecorded ? " Audit recorded." : " Audit recording failed; inspect API logs."}`}
                    showIcon
                  />
                ) : null}
                {data.notifications.escalationPendingDeliveries > 0 ? (
                  <Alert
                    className="band"
                    type="error"
                    title={`${data.notifications.escalationPendingDeliveries} critical notification acknowledgements are older than ${data.notifications.escalateAfterHours}h.`}
                    showIcon
                  />
                ) : null}
                {data.notifications.readiness.blockers.length > 0 ? (
                  <Alert
                    className="band"
                    type={data.notifications.readiness.status === "disabled" ? "info" : "error"}
                    title={`Notification readiness: ${labelText(data.notifications.readiness.status)}`}
                    description={data.notifications.readiness.blockers.join(" ")}
                    showIcon
                  />
                ) : null}
                {data.notifications.readiness.warnings.length > 0 ? (
                  <Alert
                    className="band"
                    type="warning"
                    title="Notification routing is degraded"
                    description={data.notifications.readiness.warnings.join(" ")}
                    showIcon
                  />
                ) : null}
                {data.notifications.failedDeliveries > 0 ? (
                  <Alert
                    className="band"
                    type="warning"
                    title={`${data.notifications.failedDeliveries} active failed notification deliveries need attention.`}
                    showIcon
                  />
                ) : null}
                {notificationDeliveryCounts ? (
                  <div
                    className="critical-board-summary notification-delivery-summary"
                    aria-label="Notification filters"
                  >
                    <CriticalBoardStat
                      label="attention"
                      value={notificationDeliveryCounts.attention}
                      tone={notificationDeliveryCounts.attention > 0 ? "attention" : "good"}
                      active={notificationDeliveryScopeFilter === "attention"}
                      onClick={() => setNotificationDeliveryScopeFilter("attention")}
                    />
                    <CriticalBoardStat
                      label="failed"
                      value={notificationDeliveryCounts.failed}
                      tone={notificationDeliveryCounts.failed > 0 ? "critical" : "good"}
                      active={notificationDeliveryScopeFilter === "failed"}
                      onClick={() => setNotificationDeliveryScopeFilter("failed")}
                    />
                    <CriticalBoardStat
                      label="ack pending"
                      value={notificationDeliveryCounts.ack_pending}
                      tone={notificationDeliveryCounts.ack_pending > 0 ? "attention" : "good"}
                      active={notificationDeliveryScopeFilter === "ack_pending"}
                      onClick={() => setNotificationDeliveryScopeFilter("ack_pending")}
                    />
                    <CriticalBoardStat
                      label="digests"
                      value={notificationDeliveryCounts.digest}
                      tone="muted"
                      active={notificationDeliveryScopeFilter === "digest"}
                      onClick={() => setNotificationDeliveryScopeFilter("digest")}
                    />
                    <CriticalBoardStat
                      label="all"
                      value={notificationDeliveryCounts.all}
                      tone="muted"
                      active={notificationDeliveryScopeFilter === "all"}
                      onClick={() => setNotificationDeliveryScopeFilter("all")}
                    />
                  </div>
                ) : null}
                <Table
                  rowKey="id"
                  size="middle"
                  columns={notificationColumns}
                  dataSource={filteredNotificationDeliveries}
                  scroll={{ x: 1340 }}
                  pagination={{ pageSize: 8 }}
                  locale={{
                    emptyText: (
                      <Empty
                        description={`No ${notificationDeliveryScopeLabel(notificationDeliveryScopeFilter)} recorded`}
                      />
                    )
                  }}
                />
              </section>
            ) : null}

            {view === "Webhooks" ? (
              <WebhookIngestionBoard
                data={data}
                scopeFilter={webhookScopeFilter}
                onScopeFilterChange={setWebhookScopeFilter}
                authenticated={Boolean(session?.authenticated)}
                retrySaving={webhookRetrySaving}
                onRetryFailed={() => void retryFailedWebhooks()}
                onRefreshWebhooks={() => openManualRefreshModal(["webhooks"])}
              />
            ) : null}

            {view === "Audit" ? (
              <WriteAuditBoard
                actions={data.writeActions}
                columns={writeActionColumns}
                scopeFilter={writeAuditScopeFilter}
                onScopeFilterChange={setWriteAuditScopeFilter}
                authenticated={Boolean(session?.authenticated)}
              />
            ) : null}

            {view === "PRs" ? (
              <section className="section pr-workflow-section">
                <div className="section-heading pr-workflow-heading">
                  <div>
                    <Title level={4}>{prBoardTab === "testing" ? "Issue Testing" : "PR Rotation"}</Title>
                    <Text type="secondary">
                      {prBoardTab === "testing"
                        ? "Issue assignment or configured issue label starts testing; linked PRs show execution blockers."
                        : `${prScopeLabel(prScopeFilter)} | Stale checks use last human action.`}
                    </Text>
                  </div>
                  <Segmented
                    value={prBoardTab}
                    onChange={(value) => switchPrBoardTab(value as PrBoardTab)}
                    options={[
                      { label: "PR Rotation", value: "rotation" },
                      { label: "Issue Testing", value: "testing" }
                    ]}
                  />
                </div>

                {prBoardTab === "testing" ? (
                  <>
                    <div className="pr-workflow-status-row" aria-label="Issue testing shortcuts">
                      <button
                        type="button"
                        className={`inline-filter-chip ${
                          data.testing.queueIssues > 0 ? "" : "inline-filter-chip-muted"
                        } ${testingIssueQueueFilter === "all" ? "inline-filter-chip-active" : ""}`}
                        onClick={() => openTestingIssueQueueFilter("all")}
                      >
                        {data.testing.queueIssues} issues in test
                      </button>
                      <button
                        type="button"
                        className={`inline-filter-chip ${
                          data.testing.staleQueueIssues > 0 ? "inline-filter-chip-red" : "inline-filter-chip-muted"
                        } ${testingIssueQueueFilter === "stale" ? "inline-filter-chip-active" : ""}`}
                        onClick={() => openTestingIssueQueueFilter("stale")}
                      >
                        {data.testing.staleQueueIssues} waiting &gt;24h
                      </button>
                      <button
                        type="button"
                        className={`inline-filter-chip ${data.testing.queuePrs > 0 ? "" : "inline-filter-chip-muted"}`}
                        onClick={() => openPrsWithFilter("testing")}
                      >
                        {data.testing.queuePrs} linked PRs
                      </button>
                      {testingHasIssueTransitions ? (
                        <Tag>{data.testing.issueTransitionEvents} issue handoffs</Tag>
                      ) : null}
                      {testingHasIssueTransitions ? (
                        <Tag>last start {formatDate(data.testing.lastIssueTransitionAt)}</Tag>
                      ) : null}
                    </div>
                    <TestingCommandBoard
                      pendingPrs={data.pendingPrs}
                      testing={data.testing}
                      testingIssueFilter={testingIssueQueueFilter}
                      onTestingIssueFilterChange={setTestingIssueQueueFilter}
                      onOpenPrsFilter={openPrsWithFilter}
                    />
                    <details className="secondary-disclosure pr-diagnostic-disclosure">
                      <summary>
                        <span>Issue testing evidence</span>
                        <Space size={[4, 4]} wrap>
                          <Tag>{data.testing.testers.length} testers</Tag>
                          <Tag>{data.testing.recentIssueTransitions.length} issue events</Tag>
                        </Space>
                      </summary>
                      <div className="secondary-disclosure-body">
                        <Table
                          rowKey="login"
                          size="middle"
                          columns={testerColumns}
                          dataSource={data.testing.testers}
                          scroll={{ x: 760 }}
                          pagination={false}
                          locale={{ emptyText: <Empty description="No configured tester queue in cache" /> }}
                        />
                        {testingHasIssueTransitions ? (
                          <Table
                            className="testing-transition-table"
                            rowKey="id"
                            size="middle"
                            columns={testingIssueTransitionColumns}
                            dataSource={data.testing.recentIssueTransitions}
                            scroll={{ x: 1040 }}
                            pagination={{ pageSize: 6 }}
                            locale={{ emptyText: <Empty description="No issue test assignment evidence yet" /> }}
                          />
                        ) : null}
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <PrFilterBar
                      scopeFilter={prScopeFilter}
                      onScopeFilterChange={(scope) => {
                        setPrScopeFilter(scope);
                        if (isTestingPrScope(scope)) {
                          setPrBoardTab("testing");
                        }
                      }}
                    />
                    <PrBoardSummary
                      prs={data.pendingPrs}
                      filteredPrs={filteredPendingPrs}
                      criticalIssuesByPr={criticalIssuesByPr}
                      scopeFilter={prScopeFilter}
                      onScopeFilterChange={(scope) => {
                        setPrScopeFilter(scope);
                        if (isTestingPrScope(scope)) {
                          setPrBoardTab("testing");
                        }
                      }}
                    />
                    <Table
                      rowKey="number"
                      size="middle"
                      columns={prColumns}
                      dataSource={filteredPendingPrs}
                      scroll={{ x: 1832 }}
                      pagination={{ pageSize: 10 }}
                      locale={{ emptyText: <Empty description="No pending PRs in cache" /> }}
                    />
                  </>
                )}
              </section>
            ) : null}

            {view === "Personal" ? (
              <section className="workbench-section">
                <div className="section-heading">
                  <div>
                    <Title level={4}>Personal Workbench</Title>
                    {!data.personalViews.length && observedPeople.length > 0 ? (
                      <Text type="secondary">Observed owner preview from visible cache</Text>
                    ) : null}
                  </div>
                  <Space size={[6, 6]} wrap>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        (selectedPersonalView?.summary.activeCriticalIssues ??
                        selectedObservedPersonPreview?.summary.activeCriticalIssues)
                          ? "inline-filter-chip-red"
                          : "inline-filter-chip-muted"
                      } ${personalDrilldownFilter === "active_issues" ? "inline-filter-chip-active" : ""}`}
                      onClick={() =>
                        selectedPersonalView
                          ? setPersonalDrilldownFilter("active_issues")
                          : selectedObservedPersonPreview
                            ? openObservedPersonalMetric(selectedObservedPersonPreview.login, "active_issues")
                            : setPersonalDrilldownFilter("active_issues")
                      }
                    >
                      {selectedPersonalView?.summary.activeCriticalIssues ??
                        selectedObservedPersonPreview?.summary.activeCriticalIssues ??
                        0}{" "}
                      s-1/s0
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        (selectedPersonalView?.summary.attentionPrs ??
                        selectedObservedPersonPreview?.summary.attentionPrs)
                          ? ""
                          : "inline-filter-chip-muted"
                      } ${personalDrilldownFilter === "pr_attention" ? "inline-filter-chip-active" : ""}`}
                      onClick={() =>
                        selectedPersonalView
                          ? setPersonalDrilldownFilter("pr_attention")
                          : selectedObservedPersonPreview
                            ? openObservedPersonalMetric(selectedObservedPersonPreview.login, "pr_attention")
                            : setPersonalDrilldownFilter("pr_attention")
                      }
                    >
                      {selectedPersonalView?.summary.attentionPrs ??
                        selectedObservedPersonPreview?.summary.attentionPrs ??
                        0}{" "}
                      PR attention
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        personalDrilldownFilter === (selectedPersonalView ? "testing" : "threads")
                          ? "inline-filter-chip-active"
                          : ""
                      }`}
                      onClick={() =>
                        selectedPersonalView
                          ? setPersonalDrilldownFilter("testing")
                          : selectedObservedPersonPreview
                            ? openObservedPersonalMetric(selectedObservedPersonPreview.login, "threads")
                            : setPersonalDrilldownFilter("testing")
                      }
                    >
                      {selectedPersonalView
                        ? personalTestingWorkCount(selectedPersonalView)
                        : (selectedObservedPersonPreview?.threads.length ?? 0)}{" "}
                      {selectedPersonalView ? "testing" : "threads"}
                    </button>
                  </Space>
                </div>
                {!data.personalViews.length && observedPeople.length > 0 ? (
                  <>
                    <Alert
                      className="band"
                      type="info"
                      showIcon
                      title="Showing observed owners, not full personal analytics"
                      description="Watched users are not configured. This preview only uses active s-1/s0 issue owners and pending PR authors from visible cache. Configure watched users to unlock needs-triage, deferred, yesterday PR, issue testing, and trend analytics."
                      action={
                        <Button size="small" onClick={() => selectView("People")}>
                          Open People
                        </Button>
                      }
                    />
                    <PersonWorkloadBoard
                      compact
                      mode="observed"
                      people={observedPeople}
                      personalViews={[]}
                      selectedLogin={selectedObservedLogin}
                      onSelect={selectObservedPersonal}
                      onMetricSelect={openObservedPersonalMetric}
                    />
                    {selectedObservedPersonPreview ? (
                      <ObservedPersonInlineWorkbench
                        preview={selectedObservedPersonPreview}
                        focus={personalDrilldownFilter}
                        onFocusChange={(filter) =>
                          openObservedPersonalMetric(selectedObservedPersonPreview.login, filter)
                        }
                        onOpenPreview={() => openObservedPersonPreview(selectedObservedPersonPreview.login)}
                      />
                    ) : (
                      <Empty description="No observed owner selected" />
                    )}
                  </>
                ) : (
                  <>
                    <PersonWorkloadBoard
                      compact
                      people={data.people}
                      personalViews={data.personalViews}
                      selectedLogin={selectedPersonalView?.login ?? null}
                      onSelect={selectPerson}
                      onMetricSelect={openPersonalDrilldown}
                    />
                    {selectedPersonalView ? (
                      <SelectedPersonWorkbench
                        person={selectedPersonalView}
                        analyticsPeriod={analyticsPeriod}
                        trendPoints={personalTrendPoints}
                        onAnalyticsPeriodChange={setAnalyticsPeriod}
                        drilldownFilter={personalDrilldownFilter}
                        onDrilldownChange={setPersonalDrilldownFilter}
                      />
                    ) : (
                      <Empty description="No watched users configured for personal action lists" />
                    )}
                  </>
                )}
              </section>
            ) : null}

            {view === "Analytics" ? (
              <section className="section">
                <div className="section-heading">
                  <div>
                    <Title level={4}>Analytics</Title>
                    <Text type="secondary">
                      Issue and PR flow, last {data.analytics.periodDays} days, grouped{" "}
                      {metricPeriodText(analyticsPeriod)} | {data.repo.timezone}
                    </Text>
                  </div>
                  <Segmented
                    value={analyticsPeriod}
                    onChange={(value) => setAnalyticsPeriod(value as MetricPeriod)}
                    options={metricPeriodOptions}
                  />
                </div>
                <Alert className="band" type="info" title={data.analytics.sourceNote} showIcon />
                {teamFlowSummary ? (
                  <FlowEfficiencyStrip
                    summary={teamFlowSummary}
                    actions={{
                      prFlow: () => openPrsWithFilter("all"),
                      issueDrain: () => openIssuesWithFilter({}),
                      pendingPrAge: () => openPrsWithFilter("all"),
                      prAttention: () => openPrsWithFilter("attention"),
                      activeCriticalAge: () => openIssuesWithFilter({}),
                      testingQueue: () => openPrsWithFilter("testing"),
                      workflowViolations: () => selectView("Violations")
                    }}
                  />
                ) : null}
                <TrendChart points={teamTrendPoints} />
              </section>
            ) : null}

            {view === "Drift" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>AI Drift</Title>
                  <Text type="secondary">Incomplete cache evidence until timeline and issue testing backfill</Text>
                </div>
                <Table
                  rowKey={(signal) => `${signal.objectType}-${signal.objectNumber}-${signal.ruleKey}`}
                  size="middle"
                  columns={driftColumns}
                  dataSource={data.aiDriftSignals}
                  scroll={{ x: 1700 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active AI drift signals in cache" /> }}
                />
              </section>
            ) : null}

            {view === "Violations" ? (
              <section className="section">
                <div className="section-heading">
                  <Space>
                    <ShieldAlert size={18} />
                    <Title level={4}>Workflow Violations</Title>
                  </Space>
                  <Text type="secondary">Open cache-derived rule outputs</Text>
                </div>
                <Table
                  rowKey={(violation) => `${violation.objectType}-${violation.objectNumber}-${violation.ruleKey}`}
                  size="middle"
                  columns={violationColumns}
                  dataSource={data.workflowViolations}
                  scroll={{ x: 1580 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active workflow violations in cache" /> }}
                />
              </section>
            ) : null}

            {view === "Issues" ? (
              <section className="section">
                <div className="section-heading">
                  <Space>
                    <ShieldAlert size={18} />
                    <Title level={4}>Active s-1/s0 Issues</Title>
                  </Space>
                  <Text type="secondary">
                    Generated {formatDate(data.sync.generatedAt)} | {data.repo.timezone}
                  </Text>
                </div>
                <CriticalIssueBoard
                  issues={data.criticalIssues}
                  aiFilter={criticalIssueAiFilter}
                  scopeFilter={criticalIssueScopeFilter}
                  onAiFilterChange={setCriticalIssueAiFilter}
                  onScopeFilterChange={setCriticalIssueScopeFilter}
                  onPreview={setWorkObjectPreview}
                />
                {criticalOwnerCoverageRows.length > 0 ? (
                  <div className="owner-coverage-strip">
                    <div className="subsection-heading">
                      <Title level={5}>Owner Coverage</Title>
                      <Space size={[4, 4]} wrap>
                        <Tag color="red">{data.counts.unownedCriticalIssues} unowned</Tag>
                        <Tag color="orange">{data.counts.nonWatchedCriticalIssues} non-watched</Tag>
                        <Tooltip title={workflowSkipTooltip()}>
                          <Tag>{data.counts.skippedCriticalIssues} skip automation</Tag>
                        </Tooltip>
                      </Space>
                    </div>
                    <Table
                      size="small"
                      rowKey={(owner) => owner.ownerLogin ?? "unowned"}
                      columns={criticalOwnerCoverageColumns}
                      dataSource={criticalOwnerCoverageRows}
                      pagination={false}
                    />
                  </div>
                ) : null}
                <Table
                  rowKey="number"
                  size="middle"
                  columns={criticalColumns}
                  dataSource={filteredCriticalIssuesForTable}
                  scroll={{ x: 1812 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active s-1/s0 issues in cache" /> }}
                />
              </section>
            ) : null}

            {view === "People" ? (
              <section className="workbench-section">
                <div className="section-heading">
                  <Title level={4}>People Workbench</Title>
                  <Space size={[6, 6]} wrap>
                    <button
                      type="button"
                      className={`inline-filter-chip ${peopleScopeFilter === "all" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("all")}
                    >
                      {peopleBoardUsesObserved
                        ? `${peopleBoardCounts.all} observed`
                        : `${peopleBoardCounts.all} watched`}
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.critical > 0 ? "inline-filter-chip-red" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "critical" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("critical")}
                    >
                      {peopleBoardCounts.critical} people s-1/s0
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.attention > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "attention" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("attention")}
                    >
                      {peopleBoardCounts.attention} people PR attention
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.triage > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "triage" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("triage")}
                    >
                      {peopleBoardCounts.triage} people triage
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.deferred > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "deferred" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("deferred")}
                    >
                      {peopleBoardCounts.deferred} people deferred
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.pending_pr > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "pending_pr" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("pending_pr")}
                    >
                      {peopleBoardCounts.pending_pr} people pending PR
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.testing > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "testing" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("testing")}
                    >
                      {peopleBoardCounts.testing} people issue testing
                    </button>
                    <button
                      type="button"
                      className={`inline-filter-chip ${
                        peopleBoardCounts.yesterday_pr > 0 ? "" : "inline-filter-chip-muted"
                      } ${peopleScopeFilter === "yesterday_pr" ? "inline-filter-chip-active" : ""}`}
                      onClick={() => setPeopleScopeFilter("yesterday_pr")}
                    >
                      {peopleBoardCounts.yesterday_pr} people PR yday
                    </button>
                  </Space>
                </div>
                {peopleBoardUsesObserved ? (
                  <Alert
                    className="band"
                    type="info"
                    showIcon
                    title="Watched users are not configured"
                    description="This board is temporarily grouped by owners observed in visible active s-1/s0 issues and pending PRs. Configure watched users to unlock needs-triage, deferred, yesterday PR, testing ownership, and personal analytics."
                  />
                ) : null}
                <PeopleFilterBar scopeFilter={peopleScopeFilter} onScopeFilterChange={setPeopleScopeFilter} />
                <PeopleBoardSummary
                  people={peopleBoardPeople}
                  personalViews={data.personalViews}
                  filteredPeople={filteredPeople}
                  scopeFilter={peopleScopeFilter}
                  onScopeFilterChange={setPeopleScopeFilter}
                />
                <PersonWorkloadBoard
                  people={filteredPeople}
                  personalViews={data.personalViews}
                  selectedLogin={selectedPersonalView?.login ?? null}
                  onSelect={openPeopleBoardPerson}
                  onMetricSelect={openPeopleBoardMetric}
                  mode={peopleBoardUsesObserved ? "observed" : "watched"}
                />
              </section>
            ) : null}
          </>
        ) : null}
      </Content>
      <TeamWorkPreviewModal preview={workObjectPreview} onClose={() => setWorkObjectPreview(null)} />
      <ObservedPersonPreviewModal
        preview={observedPersonPreviewState}
        onClose={() => setObservedPersonPreviewState(null)}
      />
      <Modal
        title={
          authenticatedUser
            ? `Reconnect GitHub token for ${authenticatedUser.githubLogin}`
            : "Connect Your GitHub Token"
        }
        open={tokenModalOpen}
        okText={tokenRetryActive ? `Retry in ${retryDelayText(tokenRetryRemainingSeconds)}` : "Connect"}
        confirmLoading={tokenSaving}
        okButtonProps={{ disabled: tokenEncryptionUnavailable || tokenInput.trim().length < 20 || tokenRetryActive }}
        onOk={() => void connectGitHubToken()}
        onCancel={() => {
          setTokenModalOpen(false);
          setTokenInput("");
          setTokenError(null);
        }}
      >
        <Space orientation="vertical" size={12} className="token-modal-body">
          {tokenEncryptionUnavailable ? <Alert type="warning" title={tokenEncryptionSetupHint} showIcon /> : null}
          <Alert
            type="info"
            title={
              authenticatedUser
                ? `This updates only ${authenticatedUser.githubLogin}'s token.`
                : "Each teammate connects their own GitHub token."
            }
            description="Write actions run as the currently connected GitHub user; anonymous viewers stay read-only."
            showIcon
          />
          {authenticatedUser ? (
            <div className="token-session-panel">
              <div className="token-session-heading">
                <Avatar size={32} src={authenticatedUser.avatarUrl}>
                  {authenticatedUser.githubLogin.slice(0, 1).toUpperCase()}
                </Avatar>
                <div>
                  <Text strong>{authenticatedUser.githubLogin}</Text>
                  <Text type="secondary">Current browser session</Text>
                </div>
              </div>
              <div className="token-session-facts">
                <div>
                  <span>Repo permission</span>
                  <strong>{labelText(authenticatedUser.tokenRepoPermission)}</strong>
                </div>
                <div>
                  <span>Token checked</span>
                  <strong>{formatDate(authenticatedUser.tokenLastValidatedAt)}</strong>
                </div>
                <div>
                  <span>Session expires</span>
                  <strong>{formatDate(authenticatedUser.sessionExpiresAt)}</strong>
                </div>
              </div>
              <Button
                danger
                icon={<Trash2 size={14} />}
                disabled={!authenticatedUser.tokenLastValidatedAt || tokenRevoking}
                loading={tokenRevoking}
                onClick={() => confirmRemoveConnectedToken(authenticatedUser.githubLogin)}
              >
                Remove saved token
              </Button>
            </div>
          ) : null}
          {authenticatedUser && headerIssueLabelCapability ? (
            <TokenCapabilityPanel capability={headerIssueLabelCapability} />
          ) : (
            <Alert
              type="info"
              title="Token needs repo or public_repo scope plus triage, write, maintain, or admin repository permission."
              showIcon
            />
          )}
          <Input.Password
            aria-label="GitHub token"
            value={tokenInput}
            autoComplete="off"
            placeholder="GitHub token"
            disabled={tokenEncryptionUnavailable || tokenRetryActive}
            onChange={(event) => setTokenInput(event.target.value)}
          />
          {tokenRetryActive ? (
            <Alert
              type="warning"
              title={`GitHub token connection is rate limited. Retry in ${retryDelayText(tokenRetryRemainingSeconds)}.`}
              showIcon
            />
          ) : null}
          {tokenError ? <Alert type={tokenRetryActive ? "warning" : "error"} title={tokenError} showIcon /> : null}
        </Space>
      </Modal>
      <Modal
        title="Queue Worker Refresh"
        open={manualRefreshModalOpen}
        okText="Queue"
        confirmLoading={manualRefreshSaving}
        okButtonProps={{ disabled: manualRefreshLayers.length === 0 || !session?.authenticated }}
        onOk={() => void queueManualRefresh()}
        onCancel={() => {
          setManualRefreshModalOpen(false);
          setManualRefreshError(null);
        }}
      >
        <Space orientation="vertical" size={12} className="token-modal-body">
          <Space size={[6, 6]} wrap>
            <Button size="small" onClick={() => setManualRefreshLayers([...syncHealthLayers])}>
              All
            </Button>
            <Button size="small" onClick={() => setManualRefreshLayers(["webhooks", "rules", "notifications"])}>
              Workflow
            </Button>
            <Button size="small" onClick={() => setManualRefreshLayers([])}>
              Clear
            </Button>
          </Space>
          {!session?.authenticated ? (
            <Alert
              type="info"
              title="Observer mode"
              description="You can inspect cached data without logging in. Queueing worker refresh jobs requires a connected GitHub token."
              action={
                <Button size="small" onClick={openTokenReconnect}>
                  Connect
                </Button>
              }
              showIcon
            />
          ) : null}
          <Checkbox.Group
            value={manualRefreshLayers}
            onChange={(values) => {
              setManualRefreshLayers(values.map(String).filter(isManualRefreshLayer));
            }}
          >
            <Space orientation="vertical" size={8}>
              {syncHealthLayers.map((layer) => (
                <Checkbox key={layer} value={layer}>
                  <Space orientation="vertical" size={0}>
                    <Text>{labelText(layer)}</Text>
                    <Text type="secondary">{manualRefreshLayerDescription(layer)}</Text>
                  </Space>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
          {manualRefreshError ? <Alert type="error" title={manualRefreshError} showIcon /> : null}
        </Space>
      </Modal>
      <Modal
        title="Workflow Fix Preview"
        open={previewModalOpen}
        okText={
          workflowPreview &&
          !workflowExecution &&
          !workflowPreview.blockedReason &&
          workflowPreview.operations.length > 0
            ? "Confirm Execute"
            : "Close"
        }
        confirmLoading={executionSaving}
        okButtonProps={{
          danger: Boolean(
            workflowPreview &&
            !workflowExecution &&
            !workflowPreview.blockedReason &&
            workflowPreview.operations.length > 0
          )
        }}
        cancelButtonProps={{ style: { display: workflowExecution ? "none" : undefined } }}
        onOk={() => {
          if (
            workflowPreview &&
            !workflowExecution &&
            !workflowPreview.blockedReason &&
            workflowPreview.operations.length > 0
          ) {
            void confirmWorkflowFix();
            return;
          }
          setPreviewModalOpen(false);
        }}
        onCancel={() => setPreviewModalOpen(false)}
      >
        {previewError ? <Alert type="error" title={previewError} showIcon /> : null}
        {!previewError && !workflowPreview ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {workflowPreview ? (
          <Space orientation="vertical" size={12} className="token-modal-body">
            <Space size={[6, 6]} wrap>
              <Tag color={workflowPreview.blockedReason ? "red" : "green"}>
                {workflowPreview.blockedReason ? "blocked" : "ready"}
              </Tag>
              <Tag>{labelText(workflowPreview.actionKey)}</Tag>
              <Tag>
                {workflowPreview.objectType} #{workflowPreview.objectNumber}
              </Tag>
            </Space>
            <Text strong>{workflowPreview.title}</Text>
            <Text type="secondary">{workflowPreview.reason}</Text>
            <div className="preview-state-grid">
              <WorkflowStateSnapshot title="Current" snapshot={workflowPreview.currentState} />
              <WorkflowStateSnapshot title="Proposed" snapshot={workflowPreview.proposedState} />
            </div>
            {workflowPreview.blockedReason ? (
              <Alert type="warning" title={workflowPreview.blockedReason} showIcon />
            ) : null}
            {workflowPreview.operations.length > 0 ? (
              <div className="preview-operations">
                {workflowPreview.operations.map((operation, index) => (
                  <div className="preview-operation" key={`${operation.type}-${index}`}>
                    <Tag color="blue">{labelText(operation.type)}</Tag>
                    {"label" in operation ? <Text>{operation.label}</Text> : <Text>{operation.body}</Text>}
                  </div>
                ))}
              </div>
            ) : null}
            {workflowPreview.warnings.map((warning) => (
              <Alert key={warning} type="info" title={warning} showIcon />
            ))}
            {workflowExecution ? (
              <Alert
                type={workflowExecution.status === "success" ? "success" : "warning"}
                title={labelText(workflowExecution.status)}
                description={workflowExecution.errorMessage ?? workflowExecution.message}
                showIcon
              />
            ) : null}
            {workflowExecution?.postWriteRefresh ? (
              <Alert
                type={workflowExecution.postWriteRefresh.queued ? "info" : "warning"}
                title={
                  workflowExecution.postWriteRefresh.queued
                    ? "Post-write refresh queued"
                    : "Post-write refresh was not queued"
                }
                description={
                  workflowExecution.postWriteRefresh.errorMessage ??
                  `${workflowExecution.postWriteRefresh.layers.map(labelText).join(", ")} will refresh from GitHub and recompute derived dashboards.`
                }
                showIcon
              />
            ) : null}
            {workflowExecution?.beforeState && workflowExecution.afterState ? (
              <div className="preview-state-grid">
                <WorkflowStateSnapshot title="Before execute" snapshot={workflowExecution.beforeState} />
                <WorkflowStateSnapshot title="After execute" snapshot={workflowExecution.afterState} />
              </div>
            ) : null}
            <Text type="secondary">Preview expires {formatDate(workflowPreview.expiresAt)}.</Text>
          </Space>
        ) : null}
      </Modal>
    </Layout>
  );
}
