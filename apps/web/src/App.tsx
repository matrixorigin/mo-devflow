import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Empty,
  Input,
  Layout,
  Modal,
  Progress,
  Segmented,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { BarChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BellRing, ClipboardCheck, KeyRound, LogOut, RefreshCcw, RefreshCw, ShieldAlert } from "lucide-react";

const { Header, Content } = Layout;
const { Paragraph, Text, Title } = Typography;
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

type TestingFlowState =
  | "not_ready"
  | "dev_done"
  | "test_requested"
  | "testing"
  | "test_changes_requested"
  | "test_passed"
  | "closed_or_merged";

type CriticalIssueOwnerScope = "unowned" | "watched" | "non_watched";

interface CriticalIssueLinkedPullRequestView {
  number: number;
  title: string;
  htmlUrl: string;
  state: "open" | "closed";
  ownerLogin: string;
  ageHours: number;
  lastHumanActionAt: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  testingState: TestingFlowState;
  testingTesters: string[];
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  isComplete: boolean;
}

interface CriticalIssueBlockerView {
  key: string;
  severity: "info" | "warning" | "critical";
  message: string;
  relatedPrNumber: number | null;
}

interface CriticalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  ownerLogin: string | null;
  ownerScope: CriticalIssueOwnerScope;
  ownerReason: string | null;
  lifecycleState: string;
  aiEffortLabel: string | null;
  ageHours: number;
  sourceUpdatedAt: string;
  lastSyncedAt: string;
  syncError: string | null;
  isComplete: boolean;
  labels: string[];
  linkedPullRequests: CriticalIssueLinkedPullRequestView[];
  blockers: CriticalIssueBlockerView[];
}

interface PersonSummary {
  login: string;
  activeCriticalIssues: number;
  needsTriageIssues: number;
  deferredIssues: number;
  prsCreatedYesterday: number;
  prsMergedYesterday: number;
  pendingPrs: number;
  attentionPrs: number;
}

interface PersonalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  lifecycleState: string;
  ageHours: number;
  lastSyncedAt: string;
  isComplete: boolean;
  labels: string[];
}

interface PendingPrView {
  number: number;
  title: string;
  htmlUrl: string;
  ownerLogin: string;
  draft: boolean;
  ageHours: number;
  lastHumanActionAt: string;
  reviewDecision: string | null;
  mergeStateStatus: string | null;
  ciState: string | null;
  latestReviewState: string | null;
  latestReviewSubmittedAt: string | null;
  latestCommitAt: string | null;
  detailSyncedAt: string | null;
  detailError: string | null;
  testingState: TestingFlowState;
  testingTesters: string[];
  testingSignals: string[];
  testingQueueAgeHours: number | null;
  attentionFlags: string[];
  isComplete: boolean;
}

interface PersonalPullRequestView extends PendingPrView {
  state: "open" | "closed";
  createdAt: string;
  mergedAt: string | null;
}

interface PersonalActionView {
  login: string;
  summary: PersonSummary;
  activeCriticalIssues: CriticalIssueView[];
  needsTriageIssues: PersonalIssueView[];
  deferredIssues: PersonalIssueView[];
  pendingPrs: PersonalPullRequestView[];
  attentionPrs: PersonalPullRequestView[];
  testingPrs: PersonalPullRequestView[];
  prsCreatedYesterday: PersonalPullRequestView[];
  prsMergedYesterday: PersonalPullRequestView[];
  analytics: DailyMetricPoint[];
  analyticsWeekly: AggregatedMetricPoint[];
  analyticsMonthly: AggregatedMetricPoint[];
}

interface WorkflowViolationView {
  objectType: "issue" | "pull_request";
  objectNumber: number;
  title: string;
  htmlUrl: string;
  ruleKey: string;
  severity: "info" | "warning" | "critical";
  relatedLogin: string | null;
  evidenceSummary: string;
  suggestedAction: string;
  fixable: boolean;
  firstDetectedAt: string;
  lastDetectedAt: string;
}

interface AiDriftSignalView {
  objectType: "issue" | "pull_request";
  objectNumber: number;
  title: string;
  htmlUrl: string;
  ruleKey: string;
  severity: "info" | "warning" | "critical";
  ownerLogin: string | null;
  aiEffortLabel: string | null;
  expectedHours: number | null;
  actualHours: number | null;
  evidenceSummary: string;
  suggestedAction: string;
  sourceCompleteness: "partial_cache" | "complete_cache";
  firstDetectedAt: string;
  lastDetectedAt: string;
}

interface DailyMetricPoint {
  date: string;
  scopeType: "team" | "person";
  scopeKey: string;
  prsCreated: number;
  prsMerged: number;
  issuesOpened: number;
  issuesClosed: number;
  issuesDeferred: number;
  workflowViolationsDetected: number;
  sourceCompleteness: "partial_cache" | "complete_cache";
  generatedAt: string;
}

type MetricPeriod = "day" | "week" | "month";

interface AggregatedMetricPoint extends DailyMetricPoint {
  period: Exclude<MetricPeriod, "day">;
  periodStart: string;
  periodEnd: string;
  label: string;
}

type TrendMetricPoint = DailyMetricPoint | AggregatedMetricPoint;

interface AnalyticsSummary {
  periodDays: number;
  sourceNote: string;
  teamDaily: DailyMetricPoint[];
  teamWeekly: AggregatedMetricPoint[];
  teamMonthly: AggregatedMetricPoint[];
  peopleDaily: DailyMetricPoint[];
  peopleWeekly: AggregatedMetricPoint[];
  peopleMonthly: AggregatedMetricPoint[];
}

type NotificationStatus =
  | "sent"
  | "failed"
  | "dry_run"
  | "skipped_disabled"
  | "skipped_no_webhook"
  | "skipped_quiet_hours";

interface NotificationDeliveryView {
  id: number;
  sourceType: "attention_item" | "workflow_violation" | "ai_drift_signal" | "daily_digest";
  ruleKey: string;
  objectType: string;
  objectNumber: number | null;
  recipientScope: "fallback" | "mapped_employee";
  channel: string;
  status: NotificationStatus;
  errorMessage: string | null;
  attemptedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

interface NotificationHealth {
  enabled: boolean;
  channel: "wecom";
  webhookConfigured: boolean;
  cooldownHours: number;
  failedDeliveries: number;
  unacknowledgedDeliveries: number;
  lastDeliveries: NotificationDeliveryView[];
}

type GitHubWriteCapabilityStatus = "ready" | "missing_token" | "insufficient_scope" | "scope_unverified";

interface GitHubWriteCapability {
  enabled: boolean;
  status: GitHubWriteCapabilityStatus;
  message: string;
  requiredScopes: string[];
  currentScopes: string[];
}

interface SessionView {
  authenticated: boolean;
  user: {
    githubLogin: string;
    githubId: string;
    avatarUrl: string | null;
    tokenScopes: string[];
    tokenLastValidatedAt: string | null;
    sessionExpiresAt: string;
    writeCapabilities: {
      issueLabels: GitHubWriteCapability;
    };
  } | null;
  tokenEncryptionConfigured: boolean;
}

type WorkflowFixOperation =
  | { type: "add_label"; label: string }
  | { type: "remove_label"; label: string }
  | { type: "add_comment"; body: string };

interface WorkflowFixStateSnapshot {
  source: "cache" | "github";
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  lifecycleState: string | null;
  severity: string | null;
  aiEffortLabel: string | null;
  updatedAt: string | null;
}

interface WorkflowFixPreview {
  previewId: string;
  actionKey: WorkflowFixActionKey;
  repoKey: string;
  objectType: "issue" | "pull_request";
  objectNumber: number;
  ruleKey: string;
  title: string;
  htmlUrl: string;
  reason: string;
  currentState: WorkflowFixStateSnapshot;
  proposedState: WorkflowFixStateSnapshot;
  operations: WorkflowFixOperation[];
  warnings: string[];
  blockedReason: string | null;
  createdAt: string;
  expiresAt: string;
}

type WorkflowFixActionKey = "add_needs_triage" | "move_to_deferred";

interface WorkflowFixExecutionResult {
  previewId: string;
  status: "success" | "failed" | "stale_preview" | "blocked" | "token_unavailable";
  executedOperations: WorkflowFixOperation[];
  beforeState: WorkflowFixStateSnapshot | null;
  afterState: WorkflowFixStateSnapshot | null;
  message: string;
  errorMessage: string | null;
  executedAt: string;
}

interface ManualRefreshResult {
  requestId: number;
  requestedLayers: Array<"github_sync" | "webhooks" | "rules" | "metrics" | "ai_drift" | "notifications">;
  queuedJobs: Array<{
    jobKey: string;
    jobType: string;
    status: string;
    nextRunAt: string | null;
  }>;
  requestedAt: string;
}

interface ProfileConfigurationWarning {
  key: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  action: string;
}

interface ProfileActionSuggestion {
  key: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  action: string;
  relatedLogins: string[];
  yamlSnippet: string | null;
}

interface CriticalOwnerCoverageView {
  ownerLogin: string | null;
  ownerScope: CriticalIssueOwnerScope;
  criticalIssues: number;
  averageAgeHours: number | null;
}

interface DashboardSummary {
  repo: {
    key: string;
    owner: string;
    name: string;
    timezone: string;
  };
  profileWarnings: ProfileConfigurationWarning[];
  profileActions: ProfileActionSuggestion[];
  visibility: {
    scope: "anonymous" | "logged_in";
    visibleClasses: Array<"anonymous_readable" | "logged_in_readable" | "token_owner_only" | "admin_only">;
    hiddenIssues: number;
    hiddenPullRequests: number;
    hiddenObjects: number;
    note: string | null;
  };
  sync: {
    generatedAt: string;
    health: Array<{
      layer: string;
      status: string;
      lastSuccessfulAt: string | null;
      lastAttemptedAt: string | null;
      errorMessage: string | null;
      rateLimitRemaining: number | null;
    }>;
    staleObjects: number;
    staleThresholdHours: number;
    oldestCacheAgeHours: number | null;
    partialObjects: number;
    jobQueue: {
      queueDepth: number;
      runningJobs: number;
      failedJobs: number;
      blockedJobs: number;
      staleLeases: number;
      oldestPendingAgeHours: number | null;
      nextRunAt: string | null;
      latestFailure: string | null;
    };
    worker: {
      status: "offline" | "active" | "stale" | "failed";
      phase: "starting" | "running" | "idle" | "failed" | "stopped" | null;
      workerId: string | null;
      processId: number | null;
      host: string | null;
      heartbeatAt: string | null;
      lastTickStartedAt: string | null;
      lastTickFinishedAt: string | null;
      secondsSinceHeartbeat: number | null;
      staleAfterSeconds: number;
      lastError: string | null;
      recommendedAction: string | null;
      details: Record<string, unknown> | null;
    };
  };
  counts: {
    criticalIssues: number;
    unownedCriticalIssues: number;
    nonWatchedCriticalIssues: number;
    pendingPrs: number;
    attentionPrs: number;
    workflowViolations: number;
    criticalWorkflowViolations: number;
    aiDriftSignals: number;
    criticalAiDriftSignals: number;
  };
  criticalIssues: CriticalIssueView[];
  criticalOwnerCoverage: CriticalOwnerCoverageView[];
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  pendingPrs: PendingPrView[];
  workflowViolations: WorkflowViolationView[];
  aiDriftSignals: AiDriftSignalView[];
  analytics: AnalyticsSummary;
  testing: {
    queuePrs: number;
    staleQueuePrs: number;
    averageQueueAgeHours: number | null;
    testers: Array<{
      login: string;
      queuePrs: number;
      averageQueueAgeHours: number | null;
    }>;
  };
  notifications: NotificationHealth;
  webhooks: {
    pendingDeliveries: number;
    processedDeliveries: number;
    failedDeliveries: number;
    duplicateDeliveries: number;
    lastReceivedAt: string | null;
    latestFailure: string | null;
  };
}

function hours(value: number): string {
  if (value < 24) {
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}h`;
  }
  return `${(value / 24).toFixed(1)}d`;
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

function syncHealthTooltip(item: DashboardSummary["sync"]["health"][number]) {
  return (
    <div>
      <div>Last attempt: {formatDate(item.lastAttemptedAt)}</div>
      <div>Last success: {formatDate(item.lastSuccessfulAt)}</div>
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

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `API returned ${response.status}`;
  } catch {
    return `API returned ${response.status}`;
  }
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

function labelText(value: string): string {
  return value.replaceAll("_", " ");
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
  if (flag === "no_human_action_24h" || flag === "testing_stalled") {
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
  if (state === "test_requested" || state === "testing") {
    return "blue";
  }
  return "default";
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
  if (value === "failed" || value === "skipped_no_webhook") {
    return "red";
  }
  if (value === "dry_run" || value === "skipped_quiet_hours") {
    return "orange";
  }
  return "default";
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
      <Space direction="vertical" size={6}>
        <Space size={6} wrap>
          <Text strong>{title}</Text>
          <Tag>{snapshot.source}</Tag>
          <Tag color={snapshot.state === "open" ? "green" : "default"}>{snapshot.state}</Tag>
        </Space>
        <Space size={[4, 4]} wrap>
          <Text type="secondary">Labels</Text>
          {snapshot.labels.length > 0 ? snapshot.labels.map((label) => <Tag key={label}>{label}</Tag>) : <Tag>none</Tag>}
        </Space>
        <Space size={[4, 4]} wrap>
          <Text type="secondary">Assignees</Text>
          {snapshot.assignees.length > 0 ? snapshot.assignees.map((assignee) => <Tag key={assignee}>{assignee}</Tag>) : <Tag>none</Tag>}
        </Space>
        <Space size={[4, 4]} wrap>
          {snapshot.lifecycleState ? <Tag>{labelText(snapshot.lifecycleState)}</Tag> : null}
          {snapshot.severity ? <Tag color={severityColor(snapshot.severity)}>{snapshot.severity}</Tag> : null}
          {snapshot.aiEffortLabel ? <Tag color="blue">{snapshot.aiEffortLabel}</Tag> : null}
          {snapshot.updatedAt ? <Text type="secondary">{formatDate(snapshot.updatedAt)}</Text> : null}
        </Space>
      </Space>
    </div>
  );
}

function TrendChart({ points }: { points: TrendMetricPoint[] }) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current || points.length === 0) {
      return;
    }
    const chart = echarts.init(chartRef.current);
    const labels = points.map((point) => ("label" in point ? point.label : point.date.slice(5)));
    chart.setOption({
      color: ["#2563eb", "#16a34a", "#d97706", "#7c3aed"],
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 36, right: 20, top: 44, bottom: 32 },
      xAxis: { type: "category", data: labels, boundaryGap: false },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: "PR created",
          type: "line",
          smooth: true,
          data: points.map((point) => point.prsCreated)
        },
        {
          name: "PR merged",
          type: "line",
          smooth: true,
          data: points.map((point) => point.prsMerged)
        },
        {
          name: "Issue opened",
          type: "line",
          smooth: true,
          data: points.map((point) => point.issuesOpened)
        },
        {
          name: "Violations",
          type: "bar",
          barMaxWidth: 18,
          data: points.map((point) => point.workflowViolationsDetected)
        }
      ]
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [points]);

  if (points.length === 0) {
    return <Empty description="No cached analytics metrics yet" />;
  }
  return <div className="chart-canvas" ref={chartRef} />;
}

export default function App() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState("Overview");
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<MetricPeriod>("day");
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowFixPreview | null>(null);
  const [workflowExecution, setWorkflowExecution] = useState<WorkflowFixExecutionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const [executionSaving, setExecutionSaving] = useState(false);
  const [manualRefreshSaving, setManualRefreshSaving] = useState(false);
  const [manualRefreshResult, setManualRefreshResult] = useState<ManualRefreshResult | null>(null);
  const [manualRefreshError, setManualRefreshError] = useState<string | null>(null);
  const [notificationAckSavingId, setNotificationAckSavingId] = useState<number | null>(null);
  const [notificationAckError, setNotificationAckError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard");
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      setData((await response.json()) as DashboardSummary);
    } catch (err) {
      setError(displayError(err));
    } finally {
      setLoading(false);
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
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: tokenInput.trim() })
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
      setTokenSaving(false);
    }
  }

  function openTokenReconnect() {
    setTokenError(null);
    setTokenInput("");
    setTokenModalOpen(true);
  }

  async function disconnectSession() {
    try {
      const response = await fetch("/api/session", {
        method: "DELETE",
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

  async function queueManualRefresh() {
    setManualRefreshSaving(true);
    setManualRefreshError(null);
    setManualRefreshResult(null);
    try {
      const response = await fetch("/api/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({})
      });
      if (!response.ok) {
        throw new Error(await responseError(response));
      }
      setManualRefreshResult((await response.json()) as ManualRefreshResult);
      void load();
    } catch (err) {
      setManualRefreshError(displayError(err));
    } finally {
      setManualRefreshSaving(false);
    }
  }

  async function acknowledgeNotification(delivery: NotificationDeliveryView) {
    if (!session?.authenticated) {
      setNotificationAckError("Connect GitHub token before acknowledging notifications.");
      return;
    }
    setNotificationAckSavingId(delivery.id);
    setNotificationAckError(null);
    try {
      const response = await fetch(`/api/notifications/deliveries/${delivery.id}/acknowledge`, {
        method: "POST",
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
        headers: { "content-type": "application/json" },
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
        headers: { "content-type": "application/json" },
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
    if (!data?.personalViews.length) {
      return;
    }
    if (!selectedPerson || !data.personalViews.some((person) => person.login === selectedPerson)) {
      setSelectedPerson(data.personalViews[0].login);
    }
  }, [data, selectedPerson]);

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
          </Space>
        )
      },
      {
        title: "Critical",
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
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title, issue) => (
          <Space size={8} className="table-title-cell">
            {!issue.isComplete ? <Badge color="#d97706" /> : null}
            <Text strong ellipsis={{ tooltip: title }}>{title}</Text>
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
            {issue.aiEffortLabel ? <Tag color="blue">{issue.aiEffortLabel}</Tag> : <Tag>ai unknown</Tag>}
            {!issue.isComplete ? <Tag color="gold">partial</Tag> : null}
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
                    {labelText(pr.testingState)}
                  </Tag>
                </Tooltip>
              ))}
              {issue.linkedPullRequests.length > 4 ? <Tag>+{issue.linkedPullRequests.length - 4}</Tag> : null}
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
                  <Tag color={blockerColor(blocker.severity)}>{labelText(blocker.key.split(":").at(-1) ?? blocker.key)}</Tag>
                </Tooltip>
              ))}
              {issue.blockers.length > 4 ? <Tag>+{issue.blockers.length - 4}</Tag> : null}
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
          </Space>
        )
      },
      {
        title: "Age",
        dataIndex: "ageHours",
        width: 96,
        render: (age) => hours(age)
      },
      {
        title: "Updated",
        dataIndex: "sourceUpdatedAt",
        width: 168,
        render: (value, issue) => (
          <Tooltip title={`Cache synced ${formatDate(issue.lastSyncedAt)}`}>
            <Text>{formatDate(value)}</Text>
          </Tooltip>
        )
      }
    ],
    []
  );

  const peopleColumns: ColumnsType<PersonSummary> = useMemo(
    () => [
      { title: "Person", dataIndex: "login", render: (login) => <Text strong>{login}</Text> },
      { title: "Critical", dataIndex: "activeCriticalIssues", width: 104 },
      { title: "Needs triage", dataIndex: "needsTriageIssues", width: 128 },
      { title: "Deferred", dataIndex: "deferredIssues", width: 104 },
      { title: "PR created", dataIndex: "prsCreatedYesterday", width: 112 },
      { title: "PR merged", dataIndex: "prsMergedYesterday", width: 112 },
      { title: "Pending PR", dataIndex: "pendingPrs", width: 112 },
      {
        title: "Attention",
        dataIndex: "attentionPrs",
        width: 112,
        render: (value) => (value > 0 ? <Tag color="orange">{value}</Tag> : <Tag>0</Tag>)
      }
    ],
    []
  );

  const personalIssueColumns: ColumnsType<PersonalIssueView> = useMemo(
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
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title, issue) => (
          <Space size={8} className="table-title-cell">
            {!issue.isComplete ? <Badge color="#d97706" /> : null}
            <Text ellipsis={{ tooltip: title }}>{title}</Text>
          </Space>
        )
      },
      {
        title: "State",
        width: 220,
        render: (_, issue) => (
          <Space size={[4, 4]} wrap>
            <Tag>{labelText(issue.lifecycleState)}</Tag>
            {issue.severity ? <Tag color={severityColor(issue.severity)}>{issue.severity}</Tag> : null}
          </Space>
        )
      },
      { title: "Age", dataIndex: "ageHours", width: 96, render: (age) => hours(age) },
      {
        title: "Labels",
        dataIndex: "labels",
        width: 300,
        render: (labels: string[]) => (
          <Space size={[4, 4]} wrap>
            {labels.slice(0, 6).map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
            {labels.length > 6 ? <Tag>+{labels.length - 6}</Tag> : null}
          </Space>
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
        width: 88,
        render: (_, pr) => (
          <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
            #{pr.number}
          </a>
        )
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title, pr) => (
          <Space size={8} className="table-title-cell">
            {pr.attentionFlags.length > 0 ? <Badge status="warning" /> : null}
            {!pr.isComplete ? <Badge color="#d97706" /> : null}
            <Text ellipsis={{ tooltip: title }}>{title}</Text>
          </Space>
        )
      },
      { title: "Owner", dataIndex: "ownerLogin", width: 148, render: (owner) => <Tag>{owner}</Tag> },
      { title: "Age", dataIndex: "ageHours", width: 96, render: (age) => hours(age) },
      {
        title: "State",
        width: 320,
        render: (_, pr) => (
          <Space size={[4, 4]} wrap>
            {pr.draft ? <Tag color="gold">draft</Tag> : null}
            {pr.reviewDecision ? (
              <Tag
                color={
                  pr.reviewDecision === "changes_requested"
                    ? "red"
                    : pr.reviewDecision === "approved"
                      ? "green"
                      : "blue"
                }
              >
                {labelText(pr.reviewDecision)}
              </Tag>
            ) : null}
            {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
            {pr.mergeStateStatus ? (
              <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
            ) : null}
            {pr.detailError ? (
              <Tooltip title={pr.detailError}>
                <Tag color="red">detail error</Tag>
              </Tooltip>
            ) : !pr.detailSyncedAt ? (
              <Tag>partial</Tag>
            ) : null}
          </Space>
        )
      },
      {
        title: "Testing",
        width: 260,
        render: (_, pr) => (
          <Space size={[4, 4]} wrap>
            <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
            {pr.testingTesters.map((tester) => (
              <Tag key={tester}>{tester}</Tag>
            ))}
            {pr.testingQueueAgeHours !== null ? <Tag>{hours(pr.testingQueueAgeHours)}</Tag> : null}
          </Space>
        )
      },
      {
        title: "Last human action",
        dataIndex: "lastHumanActionAt",
        width: 168,
        render: (value) => formatDate(value)
      },
      {
        title: "Flags",
        dataIndex: "attentionFlags",
        width: 260,
        render: (flags: string[]) =>
          flags.length === 0 ? (
            <Tag>clear</Tag>
          ) : (
            flags.map((flag) => (
              <Tag color={flagColor(flag)} key={flag}>
                {labelText(flag)}
              </Tag>
            ))
          )
      }
    ],
    []
  );

  const personalPrColumns: ColumnsType<PersonalPullRequestView> = useMemo(
    () => [
      {
        title: "PR",
        dataIndex: "number",
        width: 88,
        render: (_, pr) => (
          <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
            #{pr.number}
          </a>
        )
      },
      {
        title: "Title",
        dataIndex: "title",
        ellipsis: true,
        render: (title, pr) => (
          <Space size={8} className="table-title-cell">
            {pr.attentionFlags.length > 0 ? <Badge status="warning" /> : null}
            {!pr.isComplete ? <Badge color="#d97706" /> : null}
            <Text ellipsis={{ tooltip: title }}>{title}</Text>
          </Space>
        )
      },
      {
        title: "State",
        width: 360,
        render: (_, pr) => (
          <Space size={[4, 4]} wrap>
            <Tag color={pr.state === "open" ? "green" : "default"}>{pr.state}</Tag>
            {pr.draft ? <Tag color="gold">draft</Tag> : null}
            {pr.reviewDecision ? <Tag color={pr.reviewDecision === "changes_requested" ? "red" : "blue"}>{labelText(pr.reviewDecision)}</Tag> : null}
            {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
            {pr.mergeStateStatus ? <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag> : null}
            <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
          </Space>
        )
      },
      { title: "Age", dataIndex: "ageHours", width: 96, render: (age) => hours(age) },
      {
        title: "Last human action",
        dataIndex: "lastHumanActionAt",
        width: 168,
        render: (value) => formatDate(value)
      },
      {
        title: "Flags",
        dataIndex: "attentionFlags",
        width: 260,
        render: (flags: string[]) =>
          flags.length === 0 ? (
            <Tag>clear</Tag>
          ) : (
            flags.map((flag) => (
              <Tag color={flagColor(flag)} key={flag}>
                {labelText(flag)}
              </Tag>
            ))
          )
      }
    ],
    []
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
              ? "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is not configured"
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
                  loading={previewLoadingKey === `${violation.objectType}-${violation.objectNumber}-${violation.ruleKey}`}
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
        render: (label) => (label ? <Tag color="blue">{label}</Tag> : <Tag color="orange">missing</Tag>)
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
            {signal.sourceCompleteness === "partial_cache" ? <Tag>partial</Tag> : null}
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
        render: (_, delivery) =>
          delivery.acknowledgedAt ? (
            <Tooltip title={`Acknowledged by ${delivery.acknowledgedBy ?? "unknown"}`}>
              <Tag color="green">{formatDate(delivery.acknowledgedAt)}</Tag>
            </Tooltip>
          ) : (
            <Tooltip title={session?.authenticated ? "Acknowledge notification" : "Connect GitHub token to acknowledge"}>
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
          )
      },
      {
        title: "Error",
        dataIndex: "errorMessage",
        ellipsis: true,
        render: (value) => (value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : <Text type="secondary">-</Text>)
      }
    ],
    [notificationAckSavingId, session]
  );

  const testerColumns: ColumnsType<DashboardSummary["testing"]["testers"][number]> = useMemo(
    () => [
      { title: "Tester", dataIndex: "login", render: (login) => <Tag>{login}</Tag> },
      { title: "Queue PRs", dataIndex: "queuePrs", render: (value) => (value > 0 ? <Tag color="blue">{value}</Tag> : <Tag>0</Tag>) },
      {
        title: "Average Queue Age",
        dataIndex: "averageQueueAgeHours",
        render: (value) => (value === null ? "-" : hours(value))
      }
    ],
    []
  );
  const selectedPersonalView =
    data?.personalViews.find((person) => person.login === selectedPerson) ?? data?.personalViews[0] ?? null;
  const teamTrendPoints = data ? teamMetricPoints(data.analytics, analyticsPeriod) : [];
  const personalTrendPoints = selectedPersonalView ? personalMetricPoints(selectedPersonalView, analyticsPeriod) : [];
  const latestRateLimitHealth =
    data?.sync.health.find((item) => item.rateLimitRemaining !== null) ?? null;
  const latestRateLimitRemaining = latestRateLimitHealth?.rateLimitRemaining ?? null;
  const criticalOwnerCoverageRows =
    data?.criticalOwnerCoverage?.filter((owner) => owner.ownerScope !== "watched").slice(0, 8) ?? [];

  return (
    <Layout className="app-shell">
      <Header className="topbar">
        <div>
          <Text className="eyebrow">mo-devflow</Text>
          <Title level={3} className="page-title">
            {data ? data.repo.key : "Development Flow"}
          </Title>
        </div>
        <Space>
          <Segmented
            value={view}
            onChange={(value) => setView(String(value))}
            options={["Overview", "Personal", "Analytics", "People", "PRs", "Violations", "Drift", "Notifications"]}
          />
          {session?.authenticated && session.user ? (
            <Space size={8}>
              <Avatar size={28} src={session.user.avatarUrl}>
                {session.user.githubLogin.slice(0, 1).toUpperCase()}
              </Avatar>
              <Tag>{session.user.githubLogin}</Tag>
              <Tooltip
                title={
                  session.tokenEncryptionConfigured === false
                    ? "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is not configured"
                    : session.user.writeCapabilities.issueLabels.enabled
                      ? "Reconnect GitHub token"
                      : session.user.writeCapabilities.issueLabels.message
                }
              >
                <Button
                  aria-label="Reconnect GitHub token"
                  icon={<KeyRound size={16} />}
                  disabled={session.tokenEncryptionConfigured === false}
                  onClick={openTokenReconnect}
                >
                  {session.user.writeCapabilities.issueLabels.enabled ? null : "Reconnect"}
                </Button>
              </Tooltip>
              <Tooltip title="Disconnect GitHub token">
                <Button icon={<LogOut size={16} />} onClick={() => void disconnectSession()} />
              </Tooltip>
            </Space>
          ) : (
            <Tooltip
              title={
                session?.tokenEncryptionConfigured === false
                  ? "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is not configured"
                  : "Connect GitHub token"
              }
            >
              <Button
                icon={<KeyRound size={16} />}
                disabled={session?.tokenEncryptionConfigured === false}
                onClick={openTokenReconnect}
              >
                Connect
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Refresh cached dashboard">
            <Button icon={<RefreshCw size={16} />} onClick={() => void load()} loading={loading} />
          </Tooltip>
          <Tooltip
            title={
              session?.authenticated
                ? "Queue worker refresh"
                : "Connect GitHub token to queue worker refresh"
            }
          >
            <Button
              icon={<RefreshCcw size={16} />}
              disabled={!session?.authenticated}
              loading={manualRefreshSaving}
              onClick={() => void queueManualRefresh()}
            />
          </Tooltip>
        </Space>
      </Header>
      <Content className="content">
        {error ? <Alert className="band" type="error" message="Dashboard unavailable" description={error} showIcon /> : null}
        {manualRefreshError ? (
          <Alert className="band" type="error" message="Refresh was not queued" description={manualRefreshError} showIcon />
        ) : null}
        {manualRefreshResult ? (
          <Alert
            className="band"
            type="success"
            message={`Queued ${manualRefreshResult.queuedJobs.length} refresh jobs`}
            description={`Request #${manualRefreshResult.requestId} at ${formatDate(manualRefreshResult.requestedAt)}: ${manualRefreshResult.requestedLayers
              .map(labelText)
              .join(", ")}`}
            showIcon
          />
        ) : null}
        {loading && !data ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : data ? (
          <>
            {data.sync.staleObjects > 0 ? (
              <Alert
                className="band"
                type="warning"
                message={`${data.sync.staleObjects} cached objects are stale`}
                description={`Oldest visible cache age is ${
                  data.sync.oldestCacheAgeHours === null ? "unknown" : hours(data.sync.oldestCacheAgeHours)
                }; stale threshold is ${hours(data.sync.staleThresholdHours)}.`}
                showIcon
              />
            ) : null}

            {data.sync.partialObjects > 0 ? (
              <Alert
                className="band"
                type="warning"
                message={`${data.sync.partialObjects} cached objects are partial`}
                description="Timeline, review, or CI backfill is not complete yet; stale decisions stay visible as partial evidence."
                showIcon
              />
            ) : null}

            {data.visibility.hiddenObjects > 0 ? (
              <Alert
                className="band"
                type="info"
                message="This view is filtered by repository visibility policy"
                description={`${data.visibility.note ?? ""} Scope: ${labelText(data.visibility.scope)}. Visible classes: ${data.visibility.visibleClasses
                  .map(labelText)
                  .join(", ") || "none"}.`}
                showIcon
              />
            ) : null}

            <section className="kpi-grid">
              <div className="metric">
                <Statistic title="Critical Issues" value={data.counts.criticalIssues} />
                <Progress percent={Math.min(100, data.counts.criticalIssues * 10)} showInfo={false} strokeColor="#dc2626" />
              </div>
              <div className="metric">
                <Statistic title="Unowned Critical" value={data.counts.unownedCriticalIssues} />
                <Progress percent={Math.min(100, data.counts.unownedCriticalIssues * 20)} showInfo={false} strokeColor="#d97706" />
              </div>
              <div className="metric">
                <Statistic title="Non-watched Critical" value={data.counts.nonWatchedCriticalIssues} />
                <Progress percent={Math.min(100, data.counts.nonWatchedCriticalIssues * 20)} showInfo={false} strokeColor="#ca8a04" />
              </div>
              <div className="metric">
                <Statistic title="Pending PRs" value={data.counts.pendingPrs} />
                <Progress percent={Math.min(100, data.counts.pendingPrs)} showInfo={false} strokeColor="#2563eb" />
              </div>
              <div className="metric">
                <Statistic title="Stale Cache" value={data.sync.staleObjects} />
                <Progress
                  percent={Math.min(100, data.sync.staleObjects * 5)}
                  showInfo={false}
                  strokeColor={data.sync.staleObjects > 0 ? "#d97706" : "#16a34a"}
                />
              </div>
              <div className="metric">
                <Statistic title="Attention PRs" value={data.counts.attentionPrs} />
                <Progress percent={Math.min(100, data.counts.attentionPrs * 10)} showInfo={false} strokeColor="#ca8a04" />
              </div>
              <div className="metric">
                <Statistic title="Testing Queue" value={data.testing.queuePrs} />
                <Progress
                  percent={Math.min(100, data.testing.queuePrs * 20 + data.testing.staleQueuePrs * 25)}
                  showInfo={false}
                  strokeColor={data.testing.staleQueuePrs > 0 ? "#dc2626" : "#2563eb"}
                />
              </div>
              <div className="metric">
                <Statistic title="Workflow Violations" value={data.counts.workflowViolations} />
                <Progress
                  percent={Math.min(100, data.counts.criticalWorkflowViolations * 25 + data.counts.workflowViolations)}
                  showInfo={false}
                  strokeColor="#7c3aed"
                />
              </div>
              <div className="metric">
                <Statistic title="AI Drift Signals" value={data.counts.aiDriftSignals} />
                <Progress
                  percent={Math.min(100, data.counts.criticalAiDriftSignals * 25 + data.counts.aiDriftSignals)}
                  showInfo={false}
                  strokeColor="#9333ea"
                />
              </div>
              <div className="metric">
                <Statistic title="Notification Failures" value={data.notifications.failedDeliveries} />
                <Progress
                  percent={Math.min(100, data.notifications.failedDeliveries * 20)}
                  showInfo={false}
                  strokeColor={data.notifications.failedDeliveries > 0 ? "#dc2626" : "#16a34a"}
                />
              </div>
              <div className="metric">
                <Statistic title="Job Queue" value={data.sync.jobQueue.queueDepth} />
                <Progress
                  percent={Math.min(
                    100,
                    data.sync.jobQueue.queueDepth * 20 + data.sync.jobQueue.failedJobs * 25 + data.sync.jobQueue.blockedJobs * 30
                  )}
                  showInfo={false}
                  strokeColor={
                    data.sync.jobQueue.failedJobs > 0 ||
                    data.sync.jobQueue.blockedJobs > 0 ||
                    data.sync.jobQueue.staleLeases > 0
                      ? "#dc2626"
                      : "#16a34a"
                  }
                />
              </div>
              <div className="metric">
                <Statistic title="Webhook Pending" value={data.webhooks.pendingDeliveries} />
                <Progress
                  percent={Math.min(100, data.webhooks.pendingDeliveries * 20 + data.webhooks.failedDeliveries * 25)}
                  showInfo={false}
                  strokeColor={data.webhooks.failedDeliveries > 0 ? "#dc2626" : "#16a34a"}
                />
              </div>
            </section>

            {(data.profileWarnings ?? []).map((warning) => (
              <Alert
                key={warning.key}
                className="band"
                type={profileWarningAlertType(warning.severity)}
                message={warning.title}
                description={`${warning.description} ${warning.action}`}
                showIcon
              />
            ))}

            {(data.profileActions ?? []).length > 0 ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Profile Actions</Title>
                  <Tag color="orange">{data.profileActions.length}</Tag>
                </div>
                <Space direction="vertical" size={12} className="full-width">
                  {(data.profileActions ?? []).map((suggestion) => (
                    <Alert
                      key={suggestion.key}
                      type={profileWarningAlertType(suggestion.severity)}
                      message={suggestion.title}
                      description={
                        <Space direction="vertical" size={8} className="full-width">
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

            {criticalOwnerCoverageRows.length > 0 ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Critical Owner Coverage</Title>
                  <Space size={[4, 4]} wrap>
                    <Tag color="red">{data.counts.unownedCriticalIssues} unowned</Tag>
                    <Tag color="orange">{data.counts.nonWatchedCriticalIssues} non-watched</Tag>
                  </Space>
                </div>
                <Table
                  size="small"
                  rowKey={(owner) => owner.ownerLogin ?? "unowned"}
                  columns={criticalOwnerCoverageColumns}
                  dataSource={criticalOwnerCoverageRows}
                  pagination={false}
                />
              </section>
            ) : null}

            {data.sync.jobQueue.failedJobs > 0 || data.sync.jobQueue.blockedJobs > 0 || data.sync.jobQueue.staleLeases > 0 ? (
              <Alert
                className="band"
                type="warning"
                message="Worker job queue needs attention"
                description={
                  data.sync.jobQueue.latestFailure ??
                  `${data.sync.jobQueue.failedJobs} failed jobs, ${data.sync.jobQueue.blockedJobs} blocked jobs, ${data.sync.jobQueue.staleLeases} stale leases.`
                }
                showIcon
              />
            ) : null}

            {data.sync.worker.status !== "active" ? (
              <Alert
                className="band"
                type={data.sync.worker.status === "failed" ? "error" : "warning"}
                message="Worker heartbeat needs attention"
                description={workerStatusDescription(data.sync.worker)}
                showIcon
              />
            ) : null}

            {latestRateLimitRemaining !== null && latestRateLimitRemaining <= 10 ? (
              <Alert
                className="band"
                type={latestRateLimitRemaining <= 0 ? "error" : "warning"}
                message="GitHub API rate limit is low"
                description={`Latest ${latestRateLimitHealth?.layer ?? "sync"} run reported ${latestRateLimitRemaining} requests remaining.`}
                showIcon
              />
            ) : null}

            {data.testing.staleQueuePrs > 0 ? (
              <Alert
                className="band"
                type="warning"
                message={`${data.testing.staleQueuePrs} PRs are stale in testing`}
                description="Testing queue age currently uses cached PR update time until timeline handoff events are backfilled."
                showIcon
              />
            ) : null}

            {data.webhooks.failedDeliveries > 0 ? (
              <Alert
                className="band"
                type="warning"
                message="Webhook ingestion has failed deliveries"
                description={data.webhooks.latestFailure ?? `${data.webhooks.failedDeliveries} webhook deliveries failed.`}
                showIcon
              />
            ) : null}

            {view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Operational Health</Title>
                  <Text type="secondary">Generated {formatDate(data.sync.generatedAt)} | {data.repo.timezone}</Text>
                </div>
                <div className="health-grid">
                  <Statistic
                    title="Worker"
                    value={labelText(data.sync.worker.status)}
                    valueStyle={{ color: workerStatusColor(data.sync.worker.status) }}
                  />
                  <Statistic title="Worker Phase" value={data.sync.worker.phase ? labelText(data.sync.worker.phase) : "-"} />
                  <Statistic title="Last Heartbeat" value={formatDate(data.sync.worker.heartbeatAt)} />
                  <Statistic title="Last Tick" value={formatDate(data.sync.worker.lastTickFinishedAt)} />
                  <Statistic
                    title="GitHub Rate"
                    value={latestRateLimitRemaining === null ? "-" : latestRateLimitRemaining}
                    valueStyle={{ color: rateLimitColor(latestRateLimitRemaining) }}
                  />
                  <Statistic title="Stale Objects" value={data.sync.staleObjects} />
                  <Statistic title="Oldest Cache" value={data.sync.oldestCacheAgeHours === null ? "-" : hours(data.sync.oldestCacheAgeHours)} />
                  <Statistic title="Due Jobs" value={data.sync.jobQueue.queueDepth} />
                  <Statistic title="Running Jobs" value={data.sync.jobQueue.runningJobs} />
                  <Statistic title="Failed Jobs" value={data.sync.jobQueue.failedJobs} />
                  <Statistic title="Blocked Jobs" value={data.sync.jobQueue.blockedJobs} />
                  <Statistic title="Stale Leases" value={data.sync.jobQueue.staleLeases} />
                  <Statistic
                    title="Oldest Due"
                    value={
                      data.sync.jobQueue.oldestPendingAgeHours === null
                        ? "-"
                        : hours(data.sync.jobQueue.oldestPendingAgeHours)
                    }
                  />
                  <Statistic title="Next Run" value={formatDate(data.sync.jobQueue.nextRunAt)} />
                  <Statistic title="Webhook Pending" value={data.webhooks.pendingDeliveries} />
                  <Statistic title="Webhook Duplicates" value={data.webhooks.duplicateDeliveries} />
                  <Statistic title="Last Webhook" value={formatDate(data.webhooks.lastReceivedAt)} />
                  <Statistic title="Testing Queue" value={data.testing.queuePrs} />
                  <Statistic title="Avg Testing Age" value={data.testing.averageQueueAgeHours === null ? "-" : hours(data.testing.averageQueueAgeHours)} />
                </div>
                <Space size={[6, 6]} wrap>
                  {data.sync.health.map((item) => (
                    <Space key={item.layer} size={2}>
                      <Tooltip title={syncHealthTooltip(item)}>
                        <Tag color={item.status === "success" ? "green" : item.status === "partial" ? "orange" : "red"}>
                          {item.layer}: {item.status}
                        </Tag>
                      </Tooltip>
                      <Tag color={item.lastSuccessfulAt ? "default" : "red"}>
                        success {formatDate(item.lastSuccessfulAt)}
                      </Tag>
                      {item.rateLimitRemaining === null ? null : (
                        <Tag color={rateLimitHealthTagColor(item.rateLimitRemaining)}>
                          rate {item.rateLimitRemaining}
                        </Tag>
                      )}
                    </Space>
                  ))}
                </Space>
              </section>
            ) : null}

            {view === "Notifications" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Space>
                    <BellRing size={18} />
                    <Title level={4}>Notifications</Title>
                  </Space>
                  <Space size={[6, 6]} wrap>
                    <Tag color={data.notifications.enabled ? "green" : "default"}>
                      {data.notifications.enabled ? "enabled" : "disabled"}
                    </Tag>
                    <Tag color={data.notifications.webhookConfigured ? "green" : "orange"}>
                      {data.notifications.webhookConfigured ? "webhook configured" : "no webhook"}
                    </Tag>
                    <Tag>{data.notifications.cooldownHours}h cooldown</Tag>
                    <Tag color={data.notifications.unacknowledgedDeliveries > 0 ? "orange" : "green"}>
                      {data.notifications.unacknowledgedDeliveries} unacknowledged
                    </Tag>
                  </Space>
                </div>
                {notificationAckError ? (
                  <Alert
                    className="band"
                    type="error"
                    message="Notification acknowledgement failed"
                    description={notificationAckError}
                    showIcon
                  />
                ) : null}
                {!data.notifications.enabled ? (
                  <Alert
                    className="band"
                    type="info"
                    message="WeCom delivery is disabled; notification runs are recorded as skipped without sending external requests."
                    showIcon
                  />
                ) : !data.notifications.webhookConfigured ? (
                  <Alert
                    className="band"
                    type="error"
                    message="WeCom delivery is enabled but the webhook environment variable is not configured."
                    showIcon
                  />
                ) : data.notifications.failedDeliveries > 0 ? (
                  <Alert
                    className="band"
                    type="warning"
                    message={`${data.notifications.failedDeliveries} failed notification deliveries need attention.`}
                    showIcon
                  />
                ) : null}
                <Table
                  rowKey="id"
                  size="middle"
                  columns={notificationColumns}
                  dataSource={data.notifications.lastDeliveries}
                  scroll={{ x: 1220 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No notification delivery attempts recorded" /> }}
                />
              </section>
            ) : null}

            {view === "PRs" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Testing Flow</Title>
                  <Space size={[6, 6]} wrap>
                    <Tag color={data.testing.queuePrs > 0 ? "blue" : "default"}>{data.testing.queuePrs} queued</Tag>
                    <Tag color={data.testing.staleQueuePrs > 0 ? "red" : "default"}>{data.testing.staleQueuePrs} stale</Tag>
                  </Space>
                </div>
                <Table
                  rowKey="login"
                  size="middle"
                  columns={testerColumns}
                  dataSource={data.testing.testers}
                  pagination={false}
                  locale={{ emptyText: <Empty description="No configured tester queue in cache" /> }}
                />
              </section>
            ) : null}

            {view === "Personal" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Personal Action List</Title>
                  {data.personalViews.length > 0 ? (
                    <Segmented
                      value={selectedPersonalView?.login}
                      onChange={(value) => setSelectedPerson(String(value))}
                      options={data.personalViews.map((person) => person.login)}
                    />
                  ) : null}
                </div>
                {selectedPersonalView ? (
                  <Space direction="vertical" size={16} className="token-modal-body">
                    <Space size={[6, 6]} wrap>
                      <Tag color={selectedPersonalView.summary.activeCriticalIssues > 0 ? "red" : "default"}>
                        {selectedPersonalView.summary.activeCriticalIssues} critical
                      </Tag>
                      <Tag color={selectedPersonalView.summary.needsTriageIssues > 0 ? "orange" : "default"}>
                        {selectedPersonalView.summary.needsTriageIssues} needs triage
                      </Tag>
                      <Tag>{selectedPersonalView.summary.deferredIssues} deferred</Tag>
                      <Tag color={selectedPersonalView.summary.pendingPrs > 0 ? "blue" : "default"}>
                        {selectedPersonalView.summary.pendingPrs} pending PRs
                      </Tag>
                      <Tag color={selectedPersonalView.summary.attentionPrs > 0 ? "orange" : "default"}>
                        {selectedPersonalView.summary.attentionPrs} PR attention
                      </Tag>
                      <Tag>{selectedPersonalView.summary.prsCreatedYesterday} PRs created yesterday</Tag>
                      <Tag>{selectedPersonalView.summary.prsMergedYesterday} PRs merged yesterday</Tag>
                    </Space>

                    <div>
                      <Title level={5}>Active Critical Issues</Title>
                      <Table
                        rowKey="number"
                        size="small"
                        columns={criticalColumns}
                        dataSource={selectedPersonalView.activeCriticalIssues}
                        scroll={{ x: 1700 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No active critical issues for this user" /> }}
                      />
                    </div>

                    <div>
                      <Title level={5}>Needs Triage Issues</Title>
                      <Table
                        rowKey="number"
                        size="small"
                        columns={personalIssueColumns}
                        dataSource={selectedPersonalView.needsTriageIssues}
                        scroll={{ x: 860 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No needs-triage issues for this user" /> }}
                      />
                    </div>

                    <div>
                      <Title level={5}>Deferred Issues</Title>
                      <Table
                        rowKey="number"
                        size="small"
                        columns={personalIssueColumns}
                        dataSource={selectedPersonalView.deferredIssues}
                        scroll={{ x: 860 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No deferred issues for this user" /> }}
                      />
                    </div>

                    <div>
                      <Title level={5}>Pending PRs</Title>
                      <Table
                        rowKey="number"
                        size="small"
                        columns={personalPrColumns}
                        dataSource={selectedPersonalView.pendingPrs}
                        scroll={{ x: 1220 }}
                        pagination={{ pageSize: 6 }}
                        locale={{ emptyText: <Empty description="No pending PRs for this user" /> }}
                      />
                    </div>

                    <div>
                      <Title level={5}>Testing Handoff PRs</Title>
                      <Table
                        rowKey="number"
                        size="small"
                        columns={personalPrColumns}
                        dataSource={selectedPersonalView.testingPrs}
                        scroll={{ x: 1220 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No PRs currently in testing handoff for this user" /> }}
                      />
                    </div>

                    <div>
                      <Title level={5}>Yesterday PR Flow</Title>
                      <Table
                        rowKey={(pr) => `created-${pr.number}`}
                        size="small"
                        columns={personalPrColumns}
                        dataSource={selectedPersonalView.prsCreatedYesterday}
                        scroll={{ x: 1220 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No PRs created yesterday for this user" /> }}
                      />
                      <Table
                        rowKey={(pr) => `merged-${pr.number}`}
                        size="small"
                        columns={personalPrColumns}
                        dataSource={selectedPersonalView.prsMergedYesterday}
                        scroll={{ x: 1220 }}
                        pagination={{ pageSize: 5 }}
                        locale={{ emptyText: <Empty description="No PRs merged yesterday for this user" /> }}
                      />
                    </div>

                    <div>
                      <div className="subsection-heading">
                        <Title level={5}>Personal Trend</Title>
                        <Segmented
                          size="small"
                          value={analyticsPeriod}
                          onChange={(value) => setAnalyticsPeriod(value as MetricPeriod)}
                          options={metricPeriodOptions}
                        />
                      </div>
                      <TrendChart points={personalTrendPoints} />
                    </div>
                  </Space>
                ) : (
                  <Empty description="No watched users configured for personal action lists" />
                )}
              </section>
            ) : null}

            {view === "Analytics" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <div>
                    <Title level={4}>Analytics</Title>
                    <Text type="secondary">
                      Last {data.analytics.periodDays} days, grouped {metricPeriodText(analyticsPeriod)} | {data.repo.timezone}
                    </Text>
                  </div>
                  <Segmented
                    value={analyticsPeriod}
                    onChange={(value) => setAnalyticsPeriod(value as MetricPeriod)}
                    options={metricPeriodOptions}
                  />
                </div>
                <Alert className="band" type="info" message={data.analytics.sourceNote} showIcon />
                <TrendChart points={teamTrendPoints} />
              </section>
            ) : null}

            {view === "Drift" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>AI Drift</Title>
                  <Text type="secondary">Partial cache evidence until timeline and testing handoff backfill</Text>
                </div>
                <Table
                  rowKey={(signal) => `${signal.objectType}-${signal.objectNumber}-${signal.ruleKey}`}
                  size="middle"
                  columns={driftColumns}
                  dataSource={data.aiDriftSignals}
                  scroll={{ x: 1480 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active AI drift signals in cache" /> }}
                />
              </section>
            ) : null}

            {view === "Violations" || view === "Overview" ? (
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
                  scroll={{ x: 1360 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active workflow violations in cache" /> }}
                />
              </section>
            ) : null}

            <section className="section">
              <div className="section-heading">
                <Space>
                  <ShieldAlert size={18} />
                  <Title level={4}>Critical Issues</Title>
                </Space>
                <Text type="secondary">Generated {formatDate(data.sync.generatedAt)} | {data.repo.timezone}</Text>
              </div>
              <Table
                rowKey="number"
                size="middle"
                columns={criticalColumns}
                dataSource={data.criticalIssues}
                scroll={{ x: 1700 }}
                pagination={{ pageSize: 8 }}
                locale={{ emptyText: <Empty description="No active critical issues in cache" /> }}
              />
            </section>

            {view === "People" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>People</Title>
                  <Text type="secondary">Watched users only</Text>
                </div>
                <Table
                  rowKey="login"
                  size="middle"
                  columns={peopleColumns}
                  dataSource={data.people}
                  scroll={{ x: 900 }}
                  pagination={false}
                  locale={{ emptyText: <Empty description="No watched users configured" /> }}
                />
              </section>
            ) : null}

            {view === "PRs" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Pending PRs</Title>
                  <Text type="secondary">Stale checks use last human action</Text>
                </div>
                <Table
                  rowKey="number"
                  size="middle"
                  columns={prColumns}
                  dataSource={data.pendingPrs}
                  scroll={{ x: 1220 }}
                  pagination={{ pageSize: 10 }}
                  locale={{ emptyText: <Empty description="No pending PRs in cache" /> }}
                />
              </section>
            ) : null}

          </>
        ) : null}
      </Content>
      <Modal
        title="Connect GitHub Token"
        open={tokenModalOpen}
        okText="Connect"
        confirmLoading={tokenSaving}
        okButtonProps={{ disabled: tokenInput.trim().length < 20 }}
        onOk={() => void connectGitHubToken()}
        onCancel={() => {
          setTokenModalOpen(false);
          setTokenInput("");
          setTokenError(null);
        }}
      >
        <Space direction="vertical" size={12} className="token-modal-body">
          <Input.Password
            aria-label="GitHub token"
            value={tokenInput}
            autoComplete="off"
            placeholder="GitHub token"
            onChange={(event) => setTokenInput(event.target.value)}
          />
          {tokenError ? <Alert type="error" message={tokenError} showIcon /> : null}
        </Space>
      </Modal>
      <Modal
        title="Workflow Fix Preview"
        open={previewModalOpen}
        okText={
          workflowPreview && !workflowExecution && !workflowPreview.blockedReason && workflowPreview.operations.length > 0
            ? "Confirm Execute"
            : "Close"
        }
        confirmLoading={executionSaving}
        okButtonProps={{
          danger: Boolean(workflowPreview && !workflowExecution && !workflowPreview.blockedReason && workflowPreview.operations.length > 0)
        }}
        cancelButtonProps={{ style: { display: workflowExecution ? "none" : undefined } }}
        onOk={() => {
          if (workflowPreview && !workflowExecution && !workflowPreview.blockedReason && workflowPreview.operations.length > 0) {
            void confirmWorkflowFix();
            return;
          }
          setPreviewModalOpen(false);
        }}
        onCancel={() => setPreviewModalOpen(false)}
      >
        {previewError ? <Alert type="error" message={previewError} showIcon /> : null}
        {!previewError && !workflowPreview ? <Skeleton active paragraph={{ rows: 4 }} /> : null}
        {workflowPreview ? (
          <Space direction="vertical" size={12} className="token-modal-body">
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
            {workflowPreview.blockedReason ? <Alert type="warning" message={workflowPreview.blockedReason} showIcon /> : null}
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
              <Alert key={warning} type="info" message={warning} showIcon />
            ))}
            {workflowExecution ? (
              <Alert
                type={workflowExecution.status === "success" ? "success" : "warning"}
                message={labelText(workflowExecution.status)}
                description={workflowExecution.errorMessage ?? workflowExecution.message}
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
