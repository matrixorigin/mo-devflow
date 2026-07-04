import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
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
  notificationStatusAllowsRetry,
  notificationStatusRequiresAcknowledgement,
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
  KeyRound,
  LogOut,
  RefreshCcw,
  RefreshCw,
  ShieldAlert,
  TimerReset,
  UserRound
} from "lucide-react";
import {
  recommendCacheRepair,
  summarizeCacheEvidence,
  summarizeFreshness,
  type CacheEvidenceSummary
} from "./freshness";
import {
  criticalIssueReasons,
  effectiveAiEffortLabel,
  flowThreadDurationWarnings,
  flowThreadNextAction,
  flowEfficiencySummary,
  personalGanttChart,
  personalActivityItems,
  personalActivityNextAction,
  personalActivityPrimarySignal,
  personalDurationText,
  personPrimaryReasons,
  personWorkloadStatus,
  personalIssueReasons,
  prAttentionReasons,
  sortPeopleByWorkload,
  type FlowEfficiencySummary,
  type PersonalActivityItem,
  type PersonalGanttChart,
  type PersonalGanttPrBar,
  type PersonalGanttRow,
  type WorkloadStatus
} from "./workbench";

const { Header, Content } = Layout;
const { Paragraph, Text, Title } = Typography;
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

type TrendMetricPoint = DailyMetricPoint | AggregatedMetricPoint;
const viewOptions = [
  "Overview",
  "Issues",
  "Personal",
  "Analytics",
  "People",
  "PRs",
  "Violations",
  "Drift",
  "Notifications",
  "Audit"
] as const;
type DashboardView = (typeof viewOptions)[number];

const hashViewMap: Record<string, DashboardView> = {
  overview: "Overview",
  issues: "Issues",
  personal: "Personal",
  analytics: "Analytics",
  people: "People",
  prs: "PRs",
  violations: "Violations",
  drift: "Drift",
  notifications: "Notifications",
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

function syncHealthTooltip(item: DashboardSummary["sync"]["health"][number]) {
  return (
    <div>
      <div>Last attempt: {formatDate(item.lastAttemptedAt)}</div>
      <div>Last success: {formatDate(item.lastSuccessfulAt)}</div>
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

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `API returned ${response.status}`;
  } catch {
    return `API returned ${response.status}`;
  }
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
    return "testing handoff";
  }
  return "notification employees";
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

function FlowEfficiencyStrip({ summary }: { summary: FlowEfficiencySummary }) {
  return (
    <div className="flow-efficiency-strip" aria-label="Flow efficiency summary">
      <FlowEfficiencyItem
        label="PR flow"
        value={`${summary.prsMerged}/${summary.prsCreated}`}
        detail={`${percentText(summary.prMergeRatePercent)} merged | open delta ${signedNumber(summary.prOpenDelta)}`}
        tone={summary.prOpenDelta > 0 ? "attention" : "good"}
      />
      <FlowEfficiencyItem
        label="Issue drain"
        value={`${summary.issuesResolved}/${summary.issuesOpened}`}
        detail={`${percentText(summary.issueDrainRatePercent)} resolved | open delta ${signedNumber(
          summary.issueOpenDelta
        )}`}
        tone={summary.issueOpenDelta > 0 ? "attention" : "good"}
      />
      <FlowEfficiencyItem
        label="Pending PR age"
        value={String(summary.pendingPrs)}
        detail={`avg ${optionalHours(summary.averagePendingPrAgeHours)} | ${summary.attentionPrs} need attention`}
        tone={
          summary.averagePendingPrAgeHours !== null && summary.averagePendingPrAgeHours >= 24 ? "attention" : "normal"
        }
      />
      <FlowEfficiencyItem
        label="PR attention"
        value={percentText(summary.prAttentionRatePercent)}
        detail={`${summary.attentionPrs}/${summary.pendingPrs} pending PRs`}
        tone={summary.attentionPrs > 0 ? "attention" : "good"}
      />
      <FlowEfficiencyItem
        label="Active s-1/s0 age"
        value={String(summary.activeCriticalIssues)}
        detail={`avg ${optionalHours(summary.averageActiveIssueAgeHours)} | highest priority`}
        tone={summary.activeCriticalIssues > 0 ? "critical" : "good"}
      />
      <FlowEfficiencyItem
        label="Testing queue"
        value={String(summary.testingQueuePrs)}
        detail={`avg ${optionalHours(summary.averageTestingQueueAgeHours)} | workflow violations ${
          summary.workflowViolations
        }`}
        tone={summary.testingQueuePrs > 0 ? "attention" : "normal"}
      />
    </div>
  );
}

function FlowEfficiencyItem({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "critical" | "attention" | "normal" | "good";
}) {
  return (
    <div className={`flow-efficiency-item flow-efficiency-${tone}`}>
      <Text type="secondary">{label}</Text>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}

function TeamRotationOverview({
  data,
  flowSummary,
  trendPoints,
  analyticsPeriod,
  onAnalyticsPeriodChange,
  onNavigate,
  onPersonSelect
}: {
  data: DashboardSummary;
  flowSummary: FlowEfficiencySummary | null;
  trendPoints: TrendMetricPoint[];
  analyticsPeriod: MetricPeriod;
  onAnalyticsPeriodChange: (period: MetricPeriod) => void;
  onNavigate: (view: DashboardView) => void;
  onPersonSelect: (login: string) => void;
}) {
  const criticalIssues = sortCriticalIssuesForAction(data.criticalIssues);
  const prRisks = sortPendingPrsForAction(data.pendingPrs);
  const testingPrs = sortTestingQueuePrs(data.pendingPrs.filter(isTestingQueuePr));
  const peopleFocus = sortPeopleForTeamFocus(data.people, data.personalViews).slice(0, 6);
  const sMinusOneIssues = data.criticalIssues.filter((issue) => issue.severity === "severity/s-1").length;
  const teamFocus = teamPrimaryFocus(data, sMinusOneIssues);

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
            <Tag color={sMinusOneIssues > 0 ? "red" : "default"}>{sMinusOneIssues} s-1</Tag>
            <Tag color={data.counts.criticalIssues > 0 ? "red" : "default"}>
              {data.counts.criticalIssues} active s-1/s0
            </Tag>
            <Tag color={data.counts.attentionPrs > 0 ? "orange" : "default"}>
              {data.counts.attentionPrs} PR attention
            </Tag>
          </Space>
        </div>
        <div className="team-focus-callout">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <Text strong>{teamFocus.title}</Text>
            <span>{teamFocus.detail}</span>
          </div>
        </div>
        <div className="team-monitor-grid" aria-label="Team flow monitor">
          <TeamMonitorTile
            label="Critical issues"
            value={data.counts.criticalIssues}
            detail={`${sMinusOneIssues} s-1 | ${data.counts.unownedCriticalIssues} unowned`}
            tone={data.counts.criticalIssues > 0 ? "critical" : "good"}
            onClick={() => onNavigate("Issues")}
          />
          <TeamMonitorTile
            label="PR blockers"
            value={data.counts.attentionPrs}
            detail={`${data.counts.pendingPrs} pending | ${oldestPendingPrText(data.pendingPrs)}`}
            tone={data.counts.attentionPrs > 0 ? "attention" : "good"}
            onClick={() => onNavigate("PRs")}
          />
          <TeamMonitorTile
            label="Testing handoff"
            value={data.testing.queuePrs}
            detail={`${data.testing.staleQueuePrs} stale | avg ${optionalHours(data.testing.averageQueueAgeHours)}`}
            tone={data.testing.staleQueuePrs > 0 ? "critical" : data.testing.queuePrs > 0 ? "attention" : "good"}
            onClick={() => onNavigate("PRs")}
          />
          <TeamMonitorTile
            label="People focus"
            value={data.people.filter((person) => person.activeCriticalIssues > 0 || person.attentionPrs > 0).length}
            detail={`${data.people.length} watched | ${data.people.reduce((sum, person) => sum + person.needsTriageIssues, 0)} triage`}
            tone={peopleFocus.length > 0 ? "attention" : "good"}
            onClick={() => onNavigate("People")}
          />
          <TeamMonitorTile
            label="Data confidence"
            value={data.sync.partialObjects}
            detail={`${data.sync.staleObjects} stale | worker ${labelText(data.sync.worker.status)}`}
            tone={data.sync.staleObjects > 0 || data.sync.partialObjects > 0 ? "attention" : "good"}
            onClick={() => onNavigate("Analytics")}
          />
        </div>
      </section>

      <div className="team-rotation-grid">
        <div className="team-rotation-main">
          <TeamRotationLane
            title="Critical Issue Rotation"
            count={data.counts.criticalIssues}
            actionLabel="Open Issues"
            tone="critical"
            onAction={() => onNavigate("Issues")}
          >
            {criticalIssues.slice(0, 6).map((issue) => (
              <TeamCriticalIssueRow issue={issue} key={issue.number} />
            ))}
          </TeamRotationLane>
          <TeamRotationLane
            title="PR Rotation Risks"
            count={data.counts.attentionPrs}
            actionLabel="Open PRs"
            tone="attention"
            onAction={() => onNavigate("PRs")}
          >
            {prRisks.slice(0, 6).map((pr) => (
              <TeamPrRiskRow pr={pr} key={pr.number} />
            ))}
          </TeamRotationLane>
          <TeamRotationLane
            title="Testing Handoff"
            count={data.testing.queuePrs}
            actionLabel="Open PRs"
            tone={data.testing.staleQueuePrs > 0 ? "critical" : "attention"}
            onAction={() => onNavigate("PRs")}
          >
            {testingPrs.slice(0, 5).map((pr) => (
              <TeamPrRiskRow pr={pr} key={pr.number} />
            ))}
          </TeamRotationLane>
        </div>

        <aside className="team-rotation-side">
          <TeamPeopleFocus people={peopleFocus} personalViews={data.personalViews} onPersonSelect={onPersonSelect} />
          <TeamOpsStatus data={data} />
        </aside>
      </div>

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
        {flowSummary ? <FlowEfficiencyStrip summary={flowSummary} /> : null}
        <TrendChart points={trendPoints} />
      </section>
    </div>
  );
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
  onClick: () => void;
}) {
  return (
    <button type="button" className={`team-monitor-tile team-monitor-${tone}`} onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </button>
  );
}

function TeamRotationLane({
  title,
  count,
  actionLabel,
  tone,
  onAction,
  children
}: {
  title: string;
  count: number;
  actionLabel: string;
  tone: "critical" | "attention";
  onAction: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`team-rotation-lane team-rotation-lane-${tone}`}>
      <div className="team-rotation-lane-heading">
        <Space size={[6, 6]} wrap>
          <Text strong>{title}</Text>
          <Tag color={tone === "critical" ? "red" : "orange"}>{count}</Tag>
        </Space>
        <Button size="small" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
      <div className="team-rotation-list">{children}</div>
    </section>
  );
}

function TeamCriticalIssueRow({ issue }: { issue: CriticalIssueView }) {
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
                  #{pr.number} {labelText(pr.testingState)}
                </a>
              </Tooltip>
            ))}
            {issue.linkedPullRequests.length > linkedPrs.length ? (
              <span>+{issue.linkedPullRequests.length - linkedPrs.length}</span>
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

function TeamPrRiskRow({ pr }: { pr: PendingPrView }) {
  const reasons = prAttentionReasons(pr);
  const visibleReasons = reasons.slice(0, 4);
  const linkedIssues = pr.linkedIssueNumbers.slice(0, 4).map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));

  return (
    <article className="team-work-row">
      <div className="team-work-object">
        <div className="team-work-title-row">
          <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
            PR #{pr.number}
          </WorkObjectLink>
          <Tag>{hours(pr.ageHours)}</Tag>
          {pr.testingState !== "not_ready" ? (
            <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
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
          {pr.testingState !== "not_ready" && pr.testingTesters.length === 0 ? (
            <Tag color="red">no tester owner</Tag>
          ) : null}
        </div>
        <div className={`team-linked-row ${linkedIssues.length === 0 ? "team-linked-row-missing" : ""}`}>
          {linkedIssues.length > 0 ? (
            <>
              <span>Issues</span>
              {linkedIssues.map((link) => (
                <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                  #{link.number}
                </a>
              ))}
              {pr.linkedIssueNumbers.length > linkedIssues.length ? (
                <span>+{pr.linkedIssueNumbers.length - linkedIssues.length}</span>
              ) : null}
            </>
          ) : (
            "No linked issue visible"
          )}
        </div>
      </div>
      <div className="team-work-action">
        <Text type="secondary">Next</Text>
        <Text strong>{teamPrNextAction(pr)}</Text>
        <small>
          {pr.testingTesters.length > 0 ? `testers ${pr.testingTesters.slice(0, 3).join(", ")}` : "no tester owner"}
        </small>
      </div>
    </article>
  );
}

function TeamPeopleFocus({
  people,
  personalViews,
  onPersonSelect
}: {
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  onPersonSelect: (login: string) => void;
}) {
  return (
    <section className="team-side-panel">
      <div className="team-side-heading">
        <Text strong>People Focus</Text>
        <Tag>{people.length}</Tag>
      </div>
      <div className="team-people-list">
        {people.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No watched people with active risk" />
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
                  {testingCountForPerson(person.login, personalViews)} testing
                </small>
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function TeamOpsStatus({ data }: { data: DashboardSummary }) {
  const notificationRisk =
    data.notifications.failedDeliveries +
    data.notifications.unacknowledgedDeliveries +
    data.notifications.escalationPendingDeliveries;
  return (
    <section className="team-side-panel">
      <div className="team-side-heading">
        <Text strong>Data And Automation</Text>
        <Tag color={data.sync.worker.status === "active" ? "green" : "orange"}>
          {labelText(data.sync.worker.status)}
        </Tag>
      </div>
      <div className="team-status-list">
        <TeamStatusRow label="Cache" value={`${data.sync.staleObjects} stale / ${data.sync.partialObjects} partial`} />
        <TeamStatusRow
          label="Worker"
          value={`${labelText(data.sync.worker.phase ?? data.sync.worker.status)} | queue ${data.sync.jobQueue.queueDepth}`}
        />
        <TeamStatusRow
          label="Webhook"
          value={`${data.webhooks.pendingDeliveries} pending / ${data.webhooks.failedDeliveries} failed`}
        />
        <TeamStatusRow label="Notifications" value={`${notificationRisk} active delivery risk`} />
      </div>
    </section>
  );
}

function TeamStatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="team-status-row">
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
  if (data.testing.staleQueuePrs > 0) {
    return {
      title: `${data.testing.staleQueuePrs} testing handoffs are stale.`,
      detail: `${data.testing.queuePrs} PRs are currently in testing flow.`
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

function sortPendingPrsForAction(prs: PendingPrView[]): PendingPrView[] {
  return [...prs].sort((left, right) => {
    const riskDelta = pendingPrRiskScore(right) - pendingPrRiskScore(left);
    if (riskDelta !== 0) {
      return riskDelta;
    }
    return right.ageHours - left.ageHours || left.number - right.number;
  });
}

function pendingPrRiskScore(pr: PendingPrView): number {
  return (
    prAttentionReasons(pr).length * 80 +
    (pr.reviewDecision === "changes_requested" ? 180 : 0) +
    (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)
      ? 160
      : 0) +
    (pr.mergeStateStatus === "dirty" ? 160 : 0) +
    (isTestingStalePr(pr) ? 150 : 0) +
    (pr.testingQueueAgeHours !== null ? 80 : 0) +
    (pr.ageHours >= 24 ? 60 : 0) +
    (pr.linkedIssueNumbers.length === 0 ? 45 : 0) +
    (!pr.isComplete ? 30 : 0)
  );
}

function teamPrNextAction(pr: PendingPrView): string {
  const syntheticItem: PersonalActivityItem = {
    id: `pull_request:${pr.number}`,
    objectType: "pull_request",
    number: pr.number,
    title: pr.title,
    htmlUrl: pr.htmlUrl,
    ownerLogin: pr.ownerLogin,
    phase: isTestingQueuePr(pr) ? "Testing handoff" : "Pending PR",
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

function sortPeopleForTeamFocus(people: PersonSummary[], personalViews: PersonalActionView[]): PersonSummary[] {
  const testingByLogin = new Map(personalViews.map((person) => [person.login, person.testingPrs.length]));
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
  return personalViews.find((person) => person.login === login)?.testingPrs.length ?? 0;
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

function cacheEvidenceObjectLabel(sample: CacheEvidenceSample): string {
  return sample.objectType === "pull_request" ? `PR #${sample.number}` : `Issue #${sample.number}`;
}

function cacheEvidenceReasonLabel(sample: CacheEvidenceSample): string {
  if (sample.reason === "stale_and_partial") {
    return "stale + partial";
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
        title="Partial workflow evidence"
        total={sync.partialObjects}
        samples={sync.partialSamples}
        emptyText="Partial objects exist in the cache, but no open visible objects were returned in the sample."
      />
    </div>
  );
}

function CacheRepairPlan({
  sync,
  authenticated,
  onPrepare
}: {
  sync: DashboardSummary["sync"];
  authenticated: boolean;
  onPrepare: (layers: ManualRefreshLayer[]) => void;
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
            Suggested worker layers based on the sampled stale/partial objects and sync health.
          </Text>
        </div>
        <Tooltip
          title={authenticated ? "Preselect these layers in Queue Worker Refresh" : "Connect GitHub token first"}
        >
          <Button
            size="small"
            icon={<RefreshCcw size={14} />}
            disabled={!authenticated}
            onClick={() => onPrepare(recommendation.layers)}
          >
            Select layers
          </Button>
        </Tooltip>
      </div>
      <Space size={[4, 4]} wrap>
        {recommendation.layers.map((layer) => (
          <Tag
            color={sync.health.find((item) => item.layer === layer)?.status === "success" ? "blue" : "orange"}
            key={layer}
          >
            {labelText(layer)}
          </Tag>
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

function CacheEvidenceBanner({
  cacheEvidence,
  sync,
  authenticated,
  expanded,
  onExpandedChange,
  onPrepare
}: {
  cacheEvidence: CacheEvidenceSummary;
  sync: DashboardSummary["sync"];
  authenticated: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPrepare: (layers: ManualRefreshLayer[]) => void;
}) {
  return (
    <Alert
      className={`band evidence-alert ${expanded ? "evidence-alert-expanded" : "evidence-alert-compact"}`}
      type={cacheEvidence.alertType}
      title={cacheEvidence.title}
      description={
        <Space orientation="vertical" size={expanded ? 8 : 6} className="full-width">
          <div className="evidence-alert-summary">
            <Text>{cacheEvidence.description}</Text>
            <Button
              size="small"
              type="text"
              icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded ? "Hide evidence" : "Show evidence"}
            </Button>
          </div>
          {cacheEvidence.facts.length > 0 ? (
            <Space size={[4, 4]} wrap>
              {cacheEvidence.facts.map((fact) => (
                <Tag key={fact}>{fact}</Tag>
              ))}
            </Space>
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
          {expanded ? (
            <>
              <CacheEvidenceSamples sync={sync} />
              <CacheRepairPlan sync={sync} authenticated={authenticated} onPrepare={onPrepare} />
            </>
          ) : null}
          {cacheEvidence.recommendedAction ? <Text type="secondary">{cacheEvidence.recommendedAction}</Text> : null}
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
    tags.push({ key: "partial", label: "partial cache", color: "gold" });
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

function CriticalIssueBoard({ issues }: { issues: CriticalIssueView[] }) {
  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active s-1/s0 issues" />;
  }
  const sMinusOneIssues = sortCriticalIssuesForAction(issues.filter((issue) => issue.severity === "severity/s-1"));
  const sZeroIssues = sortCriticalIssuesForAction(issues.filter((issue) => issue.severity === "severity/s0"));
  const otherCriticalIssues = sortCriticalIssuesForAction(
    issues.filter((issue) => issue.severity !== "severity/s-1" && issue.severity !== "severity/s0")
  );
  const missingTimeline = issues.filter((issue) => issue.criticalAgeEvidence === "missing_timeline").length;
  const noLinkedPr = issues.filter((issue) => issue.linkedPullRequests.length === 0).length;
  const ownerGaps = issues.filter((issue) => issue.ownerScope !== "watched").length;
  const skipped = issues.filter((issue) => issue.workflowSkipped).length;

  return (
    <div className="critical-board">
      <div className="critical-board-summary" aria-label="Active critical issue summary">
        <CriticalBoardStat label="s-1" value={sMinusOneIssues.length} tone="critical" />
        <CriticalBoardStat label="s0" value={sZeroIssues.length} tone="attention" />
        <CriticalBoardStat label="no linked PR" value={noLinkedPr} tone={noLinkedPr > 0 ? "attention" : "good"} />
        <CriticalBoardStat
          label="timeline missing"
          value={missingTimeline}
          tone={missingTimeline > 0 ? "attention" : "good"}
        />
        <CriticalBoardStat label="owner gaps" value={ownerGaps} tone={ownerGaps > 0 ? "attention" : "good"} />
        <CriticalBoardStat label="skip automation" value={skipped} tone={skipped > 0 ? "muted" : "good"} />
      </div>
      <div className="critical-board-lanes">
        <CriticalIssueLane
          title="s-1 Emergency Lane"
          description="Highest-severity active issues. These should be reviewed before s0 work."
          issues={sMinusOneIssues}
          tone="critical"
          emptyText="No active s-1 issues"
        />
        <CriticalIssueLane
          title="s0 Execution Risks"
          description="s0 issues sorted by owner, linked PR, blocker, and evidence risk."
          issues={sZeroIssues.slice(0, 10)}
          tone="attention"
          emptyText="No active s0 issues"
          hiddenCount={Math.max(0, sZeroIssues.length - 10)}
        />
        {otherCriticalIssues.length > 0 ? (
          <CriticalIssueLane
            title="Other Active Severity"
            description="Configured active severity labels outside s-1/s0."
            issues={otherCriticalIssues}
            tone="normal"
            emptyText="No other active severity issues"
          />
        ) : null}
      </div>
    </div>
  );
}

function CriticalBoardStat({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "critical" | "attention" | "good" | "muted";
}) {
  return (
    <span className={`critical-board-stat critical-board-stat-${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function CriticalIssueLane({
  title,
  description,
  issues,
  tone,
  emptyText,
  hiddenCount = 0
}: {
  title: string;
  description: string;
  issues: CriticalIssueView[];
  tone: "critical" | "attention" | "normal";
  emptyText: string;
  hiddenCount?: number;
}) {
  return (
    <section className={`critical-lane critical-lane-${tone}`}>
      <div className="critical-lane-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>
          {issues.length + hiddenCount}
        </Tag>
      </div>
      {issues.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <div className="critical-issue-list">
          {issues.map((issue) => (
            <CriticalIssueBoardRow issue={issue} key={issue.number} />
          ))}
        </div>
      )}
      {hiddenCount > 0 ? (
        <div className="critical-lane-more">+{hiddenCount} additional s0 issues in the table</div>
      ) : null}
    </section>
  );
}

function CriticalIssueBoardRow({ issue }: { issue: CriticalIssueView }) {
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
          {riskTags.length > 5 ? <Tag>+{riskTags.length - 5}</Tag> : null}
        </div>
      </div>
      <div className="critical-issue-action">
        <Text type="secondary">Next</Text>
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
              <span>+{issue.linkedPullRequests.length - linkedPrs.length}</span>
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
  return (
    pr.testingQueueAgeHours !== null ||
    ["dev_done", "test_requested", "testing", "test_changes_requested"].includes(pr.testingState)
  );
}

function isTestingStalePr(pr: PendingPrView): boolean {
  return pr.attentionFlags.includes("testing_stalled") || (pr.testingQueueAgeHours ?? 0) >= 24;
}

function sortTestingQueuePrs(prs: PendingPrView[]): PendingPrView[] {
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
  return pr.testingQueueAgeHours === null ? "testing age unknown" : `testing ${hours(pr.testingQueueAgeHours)}`;
}

function testingQueueNextAction(pr: PendingPrView): string {
  if (pr.testingTesters.length === 0) {
    return "Assign tester owner";
  }
  if (pr.testingState === "test_changes_requested" || pr.reviewDecision === "changes_requested") {
    return "Return feedback to developer";
  }
  if (pr.ciState && ["failure", "failed", "error", "timed_out", "action_required", "cancelled"].includes(pr.ciState)) {
    return "Fix CI before test closure";
  }
  if (pr.mergeStateStatus === "dirty") {
    return "Resolve merge conflict";
  }
  if (isTestingStalePr(pr)) {
    return "Request tester update";
  }
  if (pr.testingState === "testing") {
    return "Drive test result";
  }
  return "Confirm testing handoff";
}

function testingQueueRiskTags(pr: PendingPrView): string[] {
  const tags = pr.attentionFlags.map(labelText);
  if (pr.testingTesters.length === 0) {
    tags.push("no tester");
  }
  if (pr.testingQueueAgeHours === null) {
    tags.push("queue age unknown");
  }
  if (!pr.isComplete) {
    tags.push("partial cache");
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
    normalized.includes("conflict") ||
    normalized.includes("no tester")
  ) {
    return "red";
  }
  if (normalized.includes("partial") || normalized.includes("unknown")) {
    return "gold";
  }
  return "orange";
}

function TestingCommandBoard({
  pendingPrs,
  testing
}: {
  pendingPrs: PendingPrView[];
  testing: DashboardSummary["testing"];
}) {
  const queuePrs = sortTestingQueuePrs(pendingPrs.filter(isTestingQueuePr));
  const stalePrs = queuePrs.filter(isTestingStalePr);
  const missingTesterPrs = queuePrs.filter((pr) => pr.testingTesters.length === 0);
  const activePrs = queuePrs.filter((pr) => !isTestingStalePr(pr) && pr.testingTesters.length > 0);
  const partialTransitions = testing.recentTransitions.filter(
    (transition) => transition.sourceCompleteness === "partial_cache"
  ).length;
  const testerRows = [...testing.testers]
    .sort((left, right) => {
      const queueDelta = right.queuePrs - left.queuePrs;
      if (queueDelta !== 0) {
        return queueDelta;
      }
      return (right.averageQueueAgeHours ?? 0) - (left.averageQueueAgeHours ?? 0);
    })
    .slice(0, 8);

  if (queuePrs.length === 0 && testing.testers.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No testing queue in cache" />;
  }

  return (
    <div className="testing-command-board">
      <div className="testing-command-summary" aria-label="Testing command summary">
        <TestingBoardStat label="testing queue" value={testing.queuePrs} tone="normal" />
        <TestingBoardStat label="stale handoff" value={testing.staleQueuePrs} tone="critical" />
        <TestingBoardStat
          label="avg queue age"
          value={testing.averageQueueAgeHours === null ? "-" : hours(testing.averageQueueAgeHours)}
          tone={testing.averageQueueAgeHours !== null && testing.averageQueueAgeHours >= 24 ? "attention" : "normal"}
        />
        <TestingBoardStat label="tester lanes" value={testing.testers.length} tone="normal" />
        <TestingBoardStat
          label="closed no pass"
          value={testing.closedWithoutPassSignalSamples}
          tone={testing.closedWithoutPassSignalSamples > 0 ? "critical" : "normal"}
        />
        <TestingBoardStat
          label="partial events"
          value={partialTransitions}
          tone={partialTransitions > 0 ? "attention" : "normal"}
        />
      </div>

      {testerRows.length > 0 ? (
        <div className="testing-tester-strip" aria-label="Tester queue ownership">
          {testerRows.map((tester) => (
            <article className="testing-tester-card" key={tester.login}>
              <div>
                <Text strong>{tester.login}</Text>
                <Text type="secondary">{tester.queuePrs} queued</Text>
              </div>
              <strong>{tester.averageQueueAgeHours === null ? "-" : hours(tester.averageQueueAgeHours)}</strong>
              <small>avg queue age</small>
            </article>
          ))}
        </div>
      ) : null}

      <div className="testing-command-lanes">
        <TestingQueueLane
          title="Stale Testing Handoffs"
          description="PRs in testing for more than a day or flagged by testing attention rules."
          prs={stalePrs.slice(0, 8)}
          hiddenCount={Math.max(0, stalePrs.length - 8)}
          tone="critical"
          emptyText="No stale testing handoffs in cached pending PRs"
        />
        <TestingQueueLane
          title="Missing Tester Owner"
          description="Testing-state PRs where the cache cannot identify a tester owner."
          prs={missingTesterPrs.slice(0, 6)}
          hiddenCount={Math.max(0, missingTesterPrs.length - 6)}
          tone="attention"
          emptyText="All visible testing PRs have tester owners"
        />
        <TestingQueueLane
          title="Active Testing Movement"
          description="Recently active testing handoffs without stale attention flags."
          prs={activePrs.slice(0, 6)}
          hiddenCount={Math.max(0, activePrs.length - 6)}
          tone="normal"
          emptyText="No active testing movement outside stale lanes"
        />
      </div>
    </div>
  );
}

function TestingBoardStat({
  label,
  value,
  tone
}: {
  label: string;
  value: string | number;
  tone: "critical" | "attention" | "normal" | "muted";
}) {
  return (
    <span className={`testing-board-stat testing-board-stat-${tone}`}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function TestingQueueLane({
  title,
  description,
  prs,
  hiddenCount,
  tone,
  emptyText
}: {
  title: string;
  description: string;
  prs: PendingPrView[];
  hiddenCount: number;
  tone: "critical" | "attention" | "normal";
  emptyText: string;
}) {
  return (
    <section className={`testing-queue-lane testing-queue-lane-${tone}`}>
      <div className="testing-queue-lane-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>
          {prs.length + hiddenCount}
        </Tag>
      </div>
      {prs.length > 0 ? (
        <div className="testing-queue-list">
          {prs.map((pr) => (
            <TestingQueueRow pr={pr} key={pr.number} />
          ))}
        </div>
      ) : (
        <div className="testing-queue-empty">
          <Text type="secondary">{emptyText}</Text>
        </div>
      )}
      {hiddenCount > 0 ? <div className="testing-queue-more">+{hiddenCount} more PRs in this lane</div> : null}
    </section>
  );
}

function TestingQueueRow({ pr }: { pr: PendingPrView }) {
  const risks = testingQueueRiskTags(pr);
  const issueLinks = pr.linkedIssueNumbers.map((number) => ({
    number,
    url: linkedObjectUrl(pr.htmlUrl, "issues", number)
  }));
  return (
    <article className={`testing-queue-row ${isTestingStalePr(pr) ? "testing-queue-row-critical" : ""}`}>
      <div className="testing-queue-main">
        <div className="testing-queue-object">
          <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
            PR #{pr.number}
          </WorkObjectLink>
          <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
          <Tag>{testingQueueAgeText(pr)}</Tag>
          {!pr.isComplete ? <Tag color="gold">partial cache</Tag> : null}
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
            <span>no tester owner</span>
          )}
        </div>
      </div>
      <div className="testing-queue-action">
        <Text type="secondary">Next</Text>
        <Text strong>{testingQueueNextAction(pr)}</Text>
        <div className="testing-queue-risks">
          {risks.slice(0, 4).map((risk) => (
            <Tag color={testingRiskColor(risk)} key={risk}>
              {risk}
            </Tag>
          ))}
          {risks.length > 4 ? <Tag>+{risks.length - 4}</Tag> : null}
          {pr.ciState ? <Tag color={ciColor(pr.ciState)}>ci {labelText(pr.ciState)}</Tag> : null}
          {pr.mergeStateStatus ? (
            <Tag color={mergeColor(pr.mergeStateStatus)}>merge {labelText(pr.mergeStateStatus)}</Tag>
          ) : null}
        </div>
        {issueLinks.length > 0 ? (
          <div className="testing-queue-links">
            {issueLinks.slice(0, 4).map((link) => (
              <a href={link.url} target="_blank" rel="noreferrer" key={link.number}>
                issue #{link.number}
              </a>
            ))}
            {issueLinks.length > 4 ? <span>+{issueLinks.length - 4}</span> : null}
          </div>
        ) : (
          <Text type="secondary">No linked issue visible</Text>
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
  compact = false
}: {
  people: PersonSummary[];
  personalViews: PersonalActionView[];
  selectedLogin: string | null;
  onSelect: (login: string) => void;
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
    return <Empty description="No watched users configured" />;
  }

  return (
    <div className={`person-board${compact ? " person-board-compact" : ""}`} role="list">
      {sortedPeople.map((person) => {
        const personal = personalByLogin.get(person.login);
        const testingPrs = personal?.testingPrs.length ?? 0;
        const status = personWorkloadStatus(person);
        const reasons = personPrimaryReasons(person, testingPrs);
        const selected = selectedLogin === person.login;

        return (
          <button
            type="button"
            className={`person-card person-card-${status}${selected ? " is-selected" : ""}`}
            aria-pressed={selected}
            aria-label={`Open ${person.login} workbench`}
            key={person.login}
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
            <span className="person-stat-grid">
              <span>
                <strong>{person.activeCriticalIssues}</strong>
                <small>s-1/s0</small>
              </span>
              <span>
                <strong>{person.attentionPrs}</strong>
                <small>attention</small>
              </span>
              <span>
                <strong>{person.needsTriageIssues}</strong>
                <small>triage</small>
              </span>
              <span>
                <strong>{person.pendingPrs}</strong>
                <small>pending PR</small>
              </span>
              <span>
                <strong>{testingPrs}</strong>
                <small>testing</small>
              </span>
              <span>
                <strong>
                  {person.prsCreatedYesterday}/{person.prsMergedYesterday}
                </strong>
                <small>PR yday</small>
              </span>
            </span>
            <span className="person-reasons">
              {reasons.slice(0, 3).map((reason) => (
                <span key={reason}>{reason}</span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function isCriticalIssueView(issue: CriticalIssueView | PersonalIssueView): issue is CriticalIssueView {
  return "linkedPullRequests" in issue;
}

function IssueWorkCard({ issue }: { issue: CriticalIssueView | PersonalIssueView }) {
  const critical = isCriticalIssueView(issue);
  const reasons = critical ? criticalIssueReasons(issue) : personalIssueReasons(issue);
  const durationText = critical
    ? personalDurationText({ durationHours: issue.criticalAgeHours, durationKind: "critical_active" })
    : hours(issue.ageHours);

  return (
    <article className={`work-item-card ${critical ? "work-item-critical" : ""}`}>
      <div className="work-item-header">
        <WorkObjectLink href={issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
          Issue #{issue.number}
        </WorkObjectLink>
        <Tag color={critical && issue.criticalAgeHours === null ? "gold" : undefined}>{durationText}</Tag>
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
        {!issue.isComplete ? <Tag color="gold">partial</Tag> : null}
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
                #{pr.number} {labelText(pr.testingState)}
              </a>
            </Tooltip>
          ))}
          {issue.linkedPullRequests.length > 4 ? <span>+{issue.linkedPullRequests.length - 4}</span> : null}
        </div>
      ) : null}
      {reasons.length > 0 ? (
        <div className="work-reasons">
          {reasons.slice(0, 4).map((reason) => (
            <Tag color={reason.includes("Partial") ? "gold" : "orange"} key={reason}>
              {reason}
            </Tag>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function PullRequestWorkCard({ pr, emphasized = false }: { pr: PersonalPullRequestView; emphasized?: boolean }) {
  const attentionReasons = prAttentionReasons(pr);

  return (
    <article className={`work-item-card ${emphasized || attentionReasons.length > 0 ? "work-item-attention" : ""}`}>
      <div className="work-item-header">
        <WorkObjectLink href={pr.htmlUrl} icon={<GitPullRequest size={15} aria-hidden="true" />}>
          PR #{pr.number}
        </WorkObjectLink>
        <Tag>{hours(pr.ageHours)}</Tag>
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
        <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
        {!pr.isComplete ? <Tag color="gold">partial</Tag> : null}
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
  emptyText
}: {
  issues: Array<CriticalIssueView | PersonalIssueView>;
  emptyText: string;
}) {
  if (issues.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <div className="work-item-list">
      {issues.map((issue) => (
        <IssueWorkCard issue={issue} key={issue.number} />
      ))}
    </div>
  );
}

function PullRequestCardList({
  prs,
  emptyText,
  emphasized = false
}: {
  prs: PersonalPullRequestView[];
  emptyText: string;
  emphasized?: boolean;
}) {
  if (prs.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <div className="work-item-list">
      {prs.map((pr) => (
        <PullRequestWorkCard emphasized={emphasized} pr={pr} key={pr.number} />
      ))}
    </div>
  );
}

function PersonalActionQueue({ items }: { items: PersonalActivityItem[] }) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No current activity" />;
  }
  const criticalItems = items.filter((item) => item.tone === "critical");
  const attentionItems = items.filter((item) => item.tone === "attention");
  const routineItems = items.filter((item) => item.tone !== "critical" && item.tone !== "attention");
  const visibleRoutineItems = routineItems.slice(0, 6);
  const prItems = items.filter((item) => item.objectType === "pull_request");
  const issueItems = items.filter((item) => item.objectType === "issue");
  const oldestPr = maxAge(prItems);
  const testingItems = items.filter((item) => item.testingQueueAgeHours !== null);
  const blockedPrItems = prItems.filter(actionItemHasBlockingSignal);
  const linkedObjects = items.filter(
    (item) => item.linkedIssueNumbers.length > 0 || item.linkedPullRequestNumbers.length > 0
  ).length;
  const unlinkedObjects = items.length - linkedObjects;

  return (
    <div className="activity-command-center">
      <div className="activity-summary-strip" aria-label="Personal activity summary">
        <ActivitySummaryTile
          label="Now"
          value={criticalItems.length}
          detail={criticalActivitySummary(criticalItems)}
          tone="critical"
        />
        <ActivitySummaryTile
          label="Blocked PRs"
          value={blockedPrItems.length}
          detail={`${attentionItems.length} attention`}
          tone="attention"
        />
        <ActivitySummaryTile
          label="Issue threads"
          value={issueItems.length}
          detail={`${linkedObjects} linked`}
          tone="normal"
        />
        <ActivitySummaryTile
          label="Testing handoff"
          value={testingItems.length}
          detail={optionalHours(maxTestingAge(testingItems))}
          tone="normal"
        />
        <ActivitySummaryTile
          label="Oldest PR"
          value={oldestPr === null ? "-" : hours(oldestPr)}
          detail={`${unlinkedObjects} unlinked`}
          tone="muted"
        />
      </div>
      <div className="action-queue-sections" role="list" aria-label="Personal action queue">
        <ActionQueueSection
          title="Critical now"
          description="Active s-1/s0 issues that should drive the day."
          items={criticalItems}
          offset={0}
          tone="critical"
        />
        <ActionQueueSection
          title="Needs attention"
          description="PRs, testing handoffs, and triage items with blocking signals."
          items={attentionItems}
          offset={criticalItems.length}
          tone="attention"
        />
        <ActionQueueSection
          title="Routine movement"
          description="Pending, deferred, created, or merged work to keep rotating."
          items={visibleRoutineItems}
          offset={criticalItems.length + attentionItems.length}
          tone="normal"
          hiddenCount={Math.max(0, routineItems.length - visibleRoutineItems.length)}
        />
      </div>
    </div>
  );
}

function ActivitySummaryTile({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: "critical" | "attention" | "normal" | "muted";
}) {
  return (
    <div className={`activity-summary-tile activity-summary-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ActionQueueSection({
  title,
  description,
  items,
  offset,
  tone,
  hiddenCount = 0
}: {
  title: string;
  description: string;
  items: PersonalActivityItem[];
  offset: number;
  tone: "critical" | "attention" | "normal";
  hiddenCount?: number;
}) {
  if (items.length === 0 && hiddenCount === 0) {
    return null;
  }

  return (
    <section className={`action-queue-section action-queue-section-${tone}`} role="listitem" aria-label={title}>
      <div className="action-queue-section-heading">
        <div className="action-queue-section-copy">
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <ActionQueueSectionStats hiddenCount={hiddenCount} items={items} tone={tone} />
      </div>
      {items.length > 0 ? (
        <div className="action-queue-section-list" role="list">
          {items.map((item, index) => (
            <PersonalActionQueueItem index={offset + index + 1} item={item} key={item.id} />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 ? (
        <div className="action-queue-more">+{hiddenCount} routine objects hidden in this compact queue</div>
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
  const oldestAge = hasCriticalActiveDuration ? null : maxAge(items);
  const missingCriticalDuration = items.filter(
    (item) => item.durationKind === "critical_active" && item.durationHours === null
  ).length;
  const blocked = items.filter(actionItemHasBlockingSignal).length;
  const unlinked = items.filter(
    (item) => item.linkedIssueNumbers.length === 0 && item.linkedPullRequestNumbers.length === 0
  ).length;
  const ageText =
    oldestDuration !== null
      ? `${hours(oldestDuration)} active`
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
      {unlinked > 0 ? <span>{unlinked} unlinked</span> : null}
    </div>
  );
}

function PersonalActionQueueItem({ item, index }: { item: PersonalActivityItem; index: number }) {
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
                <Tag color={testingStateColor(item.testingState)}>{labelText(item.testingState)}</Tag>
              ) : null}
              {!item.isComplete ? <Tag color="gold">partial cache</Tag> : null}
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
                testing {hours(item.testingQueueAgeHours)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="action-queue-command-grid">
          <div className="action-queue-command-card action-queue-command-primary">
            <Text type="secondary">Next action</Text>
            <span className="action-command">
              <TimerReset size={14} aria-hidden="true" />
              {nextAction}
            </span>
          </div>
          <div className="action-queue-command-card">
            <Text type="secondary">Duration</Text>
            <strong>{duration}</strong>
            <small>{labelText(item.durationEvidence)}</small>
          </div>
          <div className="action-queue-command-card">
            <Text type="secondary">Signal</Text>
            <strong>{primarySignal}</strong>
          </div>
        </div>
        <div className="action-queue-footer">
          <div className="action-queue-tags" aria-label="Queue evidence">
            {visibleReasons.map((reason) => (
              <Tag color={activityReasonColor(reason)} key={reason}>
                {reason}
              </Tag>
            ))}
            {hiddenReasonCount > 0 ? <Tag>+{hiddenReasonCount}</Tag> : null}
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

function actionItemHasBlockingSignal(item: PersonalActivityItem): boolean {
  if (item.objectType === "issue") {
    return item.tone === "critical" && (item.linkedPullRequestNumbers.length === 0 || !item.isComplete);
  }
  const reasons = item.reasons.map((reason) => reason.toLowerCase());
  return (
    reasons.some(
      (reason) =>
        reason.includes("ci failed") ||
        reason.includes("changes requested") ||
        reason.includes("merge conflict") ||
        reason.includes("no human action") ||
        reason.includes("testing")
    ) ||
    item.reviewDecision === "changes_requested" ||
    item.mergeStateStatus === "dirty" ||
    item.testingState === "test_changes_requested" ||
    item.testingQueueAgeHours !== null
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

function PersonalFlowMap({ chart }: { chart: PersonalGanttChart }) {
  if (chart.rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No issue or PR flow data" />;
  }
  const criticalRows = chart.rows.filter((row) => row.tone === "critical");
  const attentionRows = chart.rows.filter((row) => row.tone === "attention");
  const routineRows = chart.rows.filter((row) => row.tone !== "critical" && row.tone !== "attention");
  const visibleRoutineRows = routineRows.slice(0, 8);

  return (
    <div className="flow-map">
      <div className="flow-map-summary">
        <span>
          <strong>{chart.rows.length}</strong> threads
        </span>
        <span>
          <strong>{hours(chart.maxAgeHours)}</strong> oldest visible work
        </span>
        <span>
          <strong>{chart.sharedPrCount}</strong> shared PR
        </span>
        <span>
          <strong>{chart.unlinkedPrCount}</strong> unlinked PR
        </span>
      </div>
      <div className="flow-thread-sections" role="list" aria-label="Personal work threads">
        <FlowThreadSection
          title="Critical issue threads"
          description="Active s-1/s0 issue lanes and their visible execution PRs."
          rows={criticalRows}
          tone="critical"
        />
        <FlowThreadSection
          title="Attention threads"
          description="PR or issue lanes with blocker, testing, review, CI, or linking risks."
          rows={attentionRows}
          tone="attention"
        />
        <FlowThreadSection
          title="Routine threads"
          description="Open movement that should keep rotating after critical and blocked work."
          rows={visibleRoutineRows}
          tone="normal"
          hiddenCount={Math.max(0, routineRows.length - visibleRoutineRows.length)}
        />
      </div>
    </div>
  );
}

function FlowThreadSection({
  title,
  description,
  rows,
  tone,
  hiddenCount = 0
}: {
  title: string;
  description: string;
  rows: PersonalGanttRow[];
  tone: "critical" | "attention" | "normal";
  hiddenCount?: number;
}) {
  if (rows.length === 0 && hiddenCount === 0) {
    return null;
  }

  return (
    <section className={`flow-thread-section flow-thread-section-${tone}`} role="listitem" aria-label={title}>
      <div className="flow-thread-section-heading">
        <div>
          <Text strong>{title}</Text>
          <Text type="secondary">{description}</Text>
        </div>
        <Tag color={tone === "critical" ? "red" : tone === "attention" ? "orange" : "blue"}>
          {rows.length + hiddenCount}
        </Tag>
      </div>
      {rows.length > 0 ? (
        <div className="flow-thread-list" role="list">
          {rows.map((row) => (
            <PersonalFlowThread row={row} key={row.id} />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 ? <div className="flow-thread-more">+{hiddenCount} routine threads hidden</div> : null}
    </section>
  );
}

function PersonalFlowThread({ row }: { row: PersonalGanttRow }) {
  const reasons = flowThreadReasons(row);
  const nextAction = flowThreadNextAction(row);
  const durationWarnings = flowThreadDurationWarnings(row);
  const sourceUrl = row.issue.htmlUrl ?? row.prs[0]?.htmlUrl ?? null;
  const linkedIssueUrls = sourceUrl
    ? row.linkedIssueNumbers.map((number) => ({ number, url: linkedObjectUrl(sourceUrl, "issues", number) }))
    : [];

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
        </div>
        <div className="flow-thread-next">
          <TimerReset size={14} aria-hidden="true" />
          {nextAction}
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
          {row.prs.length > 0 ? <Tag>{row.prs.length} PR</Tag> : null}
          {row.prs.some((pr) => pr.isShared) ? <Tag color="purple">shared</Tag> : null}
        </div>
      </div>

      <div className="flow-thread-body">
        <div className="flow-age-row">
          <span className="flow-age-label">
            {row.issue.durationKind === "critical_active" ? "s0/s-1 active" : "issue age"}
          </span>
          <div className="flow-age-track" aria-label={`${row.issue.title} elapsed ${personalDurationText(row.issue)}`}>
            <span
              className={`flow-age-fill flow-tone-${row.issue.tone}`}
              style={{ width: `${Math.max(4, row.issue.widthPercent)}%` }}
            />
          </div>
          <span className="flow-age-value">
            {row.issue.durationHours === null ? "unknown" : hours(row.issue.durationHours)}
          </span>
        </div>
        <div className="flow-pr-stack">
          {row.prs.length === 0 ? (
            <div className="flow-pr-empty">No linked PR visible</div>
          ) : (
            <>
              {row.prs.slice(0, 6).map((pr) => (
                <FlowPrRow pr={pr} key={pr.number} />
              ))}
              {row.prs.length > 6 ? <div className="flow-pr-more">+{row.prs.length - 6} more PRs</div> : null}
            </>
          )}
        </div>
      </div>

      <div className="flow-thread-signals">
        <div className="flow-thread-kpis">
          <span>
            <strong>{row.issue.durationHours === null ? "unknown" : hours(row.issue.durationHours)}</strong>
            <small>{row.issue.durationKind === "critical_active" ? "s0/s-1" : "issue age"}</small>
          </span>
          <span>
            <strong>{row.prs.length}</strong>
            <small>PRs</small>
          </span>
          <span>
            <strong>{row.prs.filter((pr) => pr.tone === "attention").length}</strong>
            <small>blocked</small>
          </span>
        </div>
        <div className="flow-signal-tags">
          {reasons.length === 0 ? <Tag color="green">clear</Tag> : null}
          {durationWarnings.map((warning) => (
            <Tag color="red" key={warning}>
              {warning}
            </Tag>
          ))}
          {reasons.slice(0, 5).map((reason) => (
            <Tag color={activityReasonColor(reason)} key={reason}>
              {reason}
            </Tag>
          ))}
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
    </article>
  );
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
          {pr.testingState !== "not_ready" ? (
            <Tag color={testingStateColor(pr.testingState)}>{labelText(pr.testingState)}</Tag>
          ) : null}
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
  if (normalized.includes("partial")) {
    return "gold";
  }
  return "orange";
}

function SelectedPersonWorkbench({
  person,
  analyticsPeriod,
  trendPoints,
  onAnalyticsPeriodChange
}: {
  person: PersonalActionView;
  analyticsPeriod: MetricPeriod;
  trendPoints: TrendMetricPoint[];
  onAnalyticsPeriodChange: (period: MetricPeriod) => void;
}) {
  const attentionNumbers = new Set(person.attentionPrs.map((pr) => pr.number));
  const routinePendingPrs = person.pendingPrs.filter((pr) => !attentionNumbers.has(pr.number));
  const activityItems = personalActivityItems(person);
  const gantt = personalGanttChart(person);
  const flowSummary = flowEfficiencySummary({
    points: trendPoints,
    pendingPrs: person.pendingPrs,
    activeIssues: person.activeCriticalIssues,
    testingPrs: person.testingPrs
  });

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
              <Tag>{person.testingPrs.length} testing</Tag>
              <Tag>
                yesterday {person.summary.prsCreatedYesterday}/{person.summary.prsMergedYesterday}
              </Tag>
            </Space>
          </div>
        </div>
      </div>

      <section className="activity-panel">
        <div className="subsection-heading">
          <Title level={5}>Action Queue</Title>
          <Space size={[6, 6]} wrap>
            <Tag color={activityItems.some((item) => item.tone === "critical") ? "red" : "default"}>
              {activityItems.filter((item) => item.tone === "critical").length} active s-1/s0
            </Tag>
            <Tag color={activityItems.some((item) => item.tone === "attention") ? "orange" : "default"}>
              {activityItems.filter((item) => item.tone === "attention").length} attention
            </Tag>
            <Tag>
              {
                activityItems.filter(
                  (item) => item.linkedIssueNumbers.length > 0 || item.linkedPullRequestNumbers.length > 0
                ).length
              }{" "}
              linked objects
            </Tag>
          </Space>
        </div>
        <PersonalActionQueue items={activityItems} />
      </section>

      <section className="flow-map-panel">
        <div className="subsection-heading">
          <Title level={5}>Work Threads</Title>
          <Space size={[6, 6]} wrap>
            <Tag>{gantt.rows.length} threads</Tag>
            <Tag color={gantt.sharedPrCount > 0 ? "purple" : "default"}>{gantt.sharedPrCount} shared PR</Tag>
            <Tag color={gantt.unlinkedPrCount > 0 ? "orange" : "default"}>{gantt.unlinkedPrCount} unlinked PR</Tag>
            <Tag color={gantt.outsideIssuePrCount > 0 ? "blue" : "default"}>
              {gantt.outsideIssuePrCount} outside issue lane
            </Tag>
          </Space>
        </div>
        <PersonalFlowMap chart={gantt} />
      </section>

      <div className="work-lane-grid work-lane-grid-priority">
        <WorkLane title="Active s-1/s0 Issues" count={person.activeCriticalIssues.length} tone="critical">
          <IssueCardList issues={person.activeCriticalIssues} emptyText="No active s-1/s0 issues" />
        </WorkLane>
        <WorkLane title="PR Attention" count={person.attentionPrs.length} tone="attention">
          <PullRequestCardList emphasized prs={person.attentionPrs} emptyText="No PR attention items" />
        </WorkLane>
        <WorkLane title="Needs Triage" count={person.needsTriageIssues.length} tone="attention">
          <IssueCardList issues={person.needsTriageIssues} emptyText="No needs-triage issues" />
        </WorkLane>
      </div>

      <div className="work-lane-grid">
        <WorkLane title="Pending PRs" count={routinePendingPrs.length} tone="normal">
          <PullRequestCardList prs={routinePendingPrs} emptyText="No routine pending PRs" />
        </WorkLane>
        <WorkLane title="Testing Handoff" count={person.testingPrs.length} tone="normal">
          <PullRequestCardList prs={person.testingPrs} emptyText="No testing handoff PRs" />
        </WorkLane>
        <WorkLane title="Deferred Issues" count={person.deferredIssues.length} tone="normal">
          <IssueCardList issues={person.deferredIssues} emptyText="No deferred issues" />
        </WorkLane>
      </div>

      <div className="work-lane-grid work-lane-grid-secondary">
        <WorkLane title="PRs Created Yesterday" count={person.prsCreatedYesterday.length} tone="normal">
          <PullRequestCardList prs={person.prsCreatedYesterday} emptyText="No PRs created yesterday" />
        </WorkLane>
        <WorkLane title="PRs Merged Yesterday" count={person.prsMergedYesterday.length} tone="normal">
          <PullRequestCardList prs={person.prsMergedYesterday} emptyText="No PRs merged yesterday" />
        </WorkLane>
      </div>

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
        <FlowEfficiencyStrip summary={flowSummary} />
        <TrendChart points={trendPoints} />
      </section>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DashboardView>(initialDashboardView);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(initialSelectedPerson);
  const [analyticsPeriod, setAnalyticsPeriod] = useState<MetricPeriod>("day");
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
  const [cacheEvidenceExpanded, setCacheEvidenceExpanded] = useState(false);
  const [notificationAckSavingId, setNotificationAckSavingId] = useState<number | null>(null);
  const [notificationRetrySavingId, setNotificationRetrySavingId] = useState<number | null>(null);
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
        headers: jsonHeadersWithCsrf(),
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

  function openManualRefreshModal(layers?: ManualRefreshLayer[]) {
    if (layers) {
      setManualRefreshLayers(layers);
    }
    setManualRefreshError(null);
    setManualRefreshModalOpen(true);
  }

  async function queueManualRefresh() {
    if (manualRefreshLayers.length === 0) {
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
        body: JSON.stringify({ layers: manualRefreshLayers })
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
                  <Tag color={blockerColor(blocker.severity)}>
                    {labelText(blocker.key.split(":").at(-1) ?? blocker.key)}
                  </Tag>
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
                : `Partial evidence from cached issue update time. Cache synced ${formatDate(issue.lastSyncedAt)}`
            }
          >
            <Space size={4}>
              <Text>{formatDate(value)}</Text>
              {issue.lastHumanActionEvidence === "partial_cache" ? <Tag color="gold">partial</Tag> : null}
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
        render: (_, execution) =>
          execution.htmlUrl ? (
            <a href={execution.htmlUrl} target="_blank" rel="noreferrer">
              {writeActionObjectLabel(execution.objectType)} #{execution.objectNumber}
            </a>
          ) : (
            <Text>
              {writeActionObjectLabel(execution.objectType)} #{execution.objectNumber}
            </Text>
          )
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
        title: "Queue PRs",
        dataIndex: "queuePrs",
        render: (value) => (value > 0 ? <Tag color="blue">{value}</Tag> : <Tag>0</Tag>)
      },
      {
        title: "Average Queue Age",
        dataIndex: "averageQueueAgeHours",
        render: (value) => (value === null ? "-" : hours(value))
      },
      {
        title: "Req To Pass",
        dataIndex: "averageRequestToPassHours",
        render: (value, row) =>
          value === null ? (
            <Text type="secondary">{row.requestToPassSamples} samples</Text>
          ) : (
            `${hours(value)} (${row.requestToPassSamples})`
          )
      },
      {
        title: "Pass To Close",
        dataIndex: "averagePassToCloseHours",
        render: (value, row) =>
          value === null ? (
            <Text type="secondary">{row.passToCloseSamples} samples</Text>
          ) : (
            `${hours(value)} (${row.passToCloseSamples})`
          )
      },
      {
        title: "Closed No Pass",
        dataIndex: "closedWithoutPassSignalSamples",
        render: (value) => (value > 0 ? <Tag color="orange">{value}</Tag> : <Tag>0</Tag>)
      }
    ],
    []
  );
  const testingTransitionColumns: ColumnsType<DashboardSummary["testing"]["recentTransitions"][number]> = useMemo(
    () => [
      {
        title: "PR",
        dataIndex: "prNumber",
        width: 104,
        render: (number) => (
          <a
            href={`https://github.com/${data?.repo.owner}/${data?.repo.name}/pull/${number}`}
            target="_blank"
            rel="noreferrer"
          >
            #{number}
          </a>
        )
      },
      {
        title: "Transition",
        width: 260,
        render: (_, transition) => (
          <Space size={4} wrap>
            <Tag>{labelText(transition.fromState)}</Tag>
            <Text type="secondary">-&gt;</Text>
            <Tag color="blue">{labelText(transition.toState)}</Tag>
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
        title: "Signals",
        dataIndex: "testingSignals",
        ellipsis: true,
        render: (signals: string[]) =>
          signals.length === 0 ? (
            <Text type="secondary">-</Text>
          ) : (
            <Space size={[4, 4]} wrap>
              {signals.slice(0, 4).map((signal) => (
                <Tooltip key={signal} title={signal}>
                  <Tag>{signal}</Tag>
                </Tooltip>
              ))}
              {signals.length > 4 ? <Tag>+{signals.length - 4}</Tag> : null}
            </Space>
          )
      },
      {
        title: "Occurred",
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
            {value === "complete_cache" ? "complete" : "partial"}
          </Tag>
        )
      }
    ],
    [data?.repo.name, data?.repo.owner]
  );
  const selectedPersonalView =
    data?.personalViews.find((person) => person.login === selectedPerson) ?? data?.personalViews[0] ?? null;
  const teamTrendPoints = data ? teamMetricPoints(data.analytics, analyticsPeriod) : [];
  const personalTrendPoints = selectedPersonalView ? personalMetricPoints(selectedPersonalView, analyticsPeriod) : [];
  const teamFlowSummary = data
    ? flowEfficiencySummary({
        points: teamTrendPoints,
        pendingPrs: data.pendingPrs,
        activeIssues: data.criticalIssues,
        testingQueuePrs: data.testing.queuePrs,
        averageTestingQueueAgeHours: data.testing.averageQueueAgeHours
      })
    : null;
  const latestRateLimitHealth = data?.sync.health.find((item) => item.rateLimitRemaining !== null) ?? null;
  const latestRateLimitRemaining = latestRateLimitHealth?.rateLimitRemaining ?? null;
  const criticalOwnerCoverageRows = data
    ? data.criticalOwnerCoverage.filter((owner) => owner.ownerScope !== "watched" || owner.workflowSkipped).slice(0, 8)
    : [];
  const notStartedSyncLayers = data?.sync.health.filter((item) => item.status === "not_started") ?? [];
  const freshness = data ? summarizeFreshness(data.sync) : null;
  const cacheEvidence = data ? summarizeCacheEvidence({ sync: data.sync, visibility: data.visibility }) : null;
  const authenticatedUser = session?.authenticated && session.user ? session.user : null;
  const headerIssueLabelCapability = authenticatedUser?.writeCapabilities.issueLabels ?? null;
  const headerWriteBackDisabled = headerIssueLabelCapability?.status === "write_back_disabled";
  const tokenEncryptionUnavailable = session?.tokenEncryptionConfigured === false;

  return (
    <Layout className="app-shell">
      <Header className="topbar">
        <div>
          <Text className="eyebrow">mo-devflow</Text>
          <Title level={3} className="page-title">
            {data ? data.repo.key : "Development Flow"}
          </Title>
        </div>
        <Space className="topbar-actions" size={[8, 8]} wrap>
          <div className="view-tabs-scroll">
            <Segmented
              className="view-tabs"
              value={view}
              onChange={(value) => selectView(String(value) as DashboardView)}
              options={[...viewOptions]}
            />
          </div>
          {authenticatedUser && headerIssueLabelCapability ? (
            <Space className="account-actions" size={[8, 8]} wrap>
              <Avatar size={28} src={authenticatedUser.avatarUrl}>
                {authenticatedUser.githubLogin.slice(0, 1).toUpperCase()}
              </Avatar>
              <Tag>{authenticatedUser.githubLogin}</Tag>
              <Tooltip title={<TokenCapabilityPanel capability={headerIssueLabelCapability} />}>
                <Tag color={capabilityStatusColor(headerIssueLabelCapability.status)}>
                  {headerIssueLabelCapability.enabled ? "write ready" : labelText(headerIssueLabelCapability.status)}
                </Tag>
              </Tooltip>
              <Tooltip
                title={
                  tokenEncryptionUnavailable
                    ? "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is not configured"
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
              <Tooltip title="Disconnect GitHub token">
                <Button icon={<LogOut size={16} />} onClick={() => void disconnectSession()} />
              </Tooltip>
            </Space>
          ) : (
            <Tooltip
              title={
                tokenEncryptionUnavailable
                  ? "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY is not configured"
                  : "Connect GitHub token"
              }
            >
              <Button icon={<KeyRound size={16} />} disabled={tokenEncryptionUnavailable} onClick={openTokenReconnect}>
                Connect
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Refresh cached dashboard">
            <Button icon={<RefreshCw size={16} />} onClick={() => void load()} loading={loading} />
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
          <Alert className="band" type="error" title="Dashboard unavailable" description={error} showIcon />
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
        {loading && !data ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : data ? (
          <>
            {freshness ? (
              <section className="freshness-bar">
                <Space className="freshness-main" size={[8, 8]} wrap>
                  <Text strong>Freshness</Text>
                  <Tag color={freshness.tagColor}>{freshness.label}</Tag>
                  <Tag>generated {formatDate(data.sync.generatedAt)}</Tag>
                  <Tag color={freshness.oldestLayerSuccessAt ? "default" : "red"}>
                    oldest sync {formatDate(freshness.oldestLayerSuccessAt)}
                  </Tag>
                  <Tag color={data.sync.staleObjects > 0 ? "orange" : "green"}>{data.sync.staleObjects} stale</Tag>
                  <Tag color={data.sync.partialObjects > 0 ? "orange" : "green"}>
                    {data.sync.partialObjects} partial
                  </Tag>
                </Space>
                <Space className="freshness-layers" size={[4, 4]} wrap>
                  {data.sync.health.map((item) => (
                    <Tooltip title={syncHealthTooltip(item)} key={item.layer}>
                      <Tag color={syncHealthTagColor(item.status)}>
                        {labelText(item.layer)} {formatDate(item.lastSuccessfulAt)}
                      </Tag>
                    </Tooltip>
                  ))}
                </Space>
              </section>
            ) : null}

            {cacheEvidence && cacheEvidence.severity !== "ok" ? (
              <CacheEvidenceBanner
                cacheEvidence={cacheEvidence}
                sync={data.sync}
                authenticated={Boolean(session?.authenticated)}
                expanded={cacheEvidenceExpanded}
                onExpandedChange={setCacheEvidenceExpanded}
                onPrepare={openManualRefreshModal}
              />
            ) : null}

            {notStartedSyncLayers.length > 0 ? (
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
                flowSummary={teamFlowSummary}
                trendPoints={teamTrendPoints}
                analyticsPeriod={analyticsPeriod}
                onAnalyticsPeriodChange={setAnalyticsPeriod}
                onNavigate={selectView}
                onPersonSelect={openPersonWorkbench}
              />
            ) : null}

            {view === "Overview" && (data.profileWarnings.length > 0 || data.profileActions.length > 0) ? (
              <details className="secondary-disclosure">
                <summary>
                  <span>Profile setup</span>
                  <Tag color="orange">{data.profileWarnings.length + data.profileActions.length}</Tag>
                </summary>
                <div className="secondary-disclosure-body">
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

            {data.sync.jobQueue.status === "attention" ? (
              <Alert
                className="band"
                type="warning"
                title="Worker job queue needs attention"
                description={
                  data.sync.jobQueue.recommendedAction ??
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
                title="Worker heartbeat needs attention"
                description={workerStatusDescription(data.sync.worker)}
                showIcon
              />
            ) : null}

            {latestRateLimitRemaining !== null && latestRateLimitRemaining <= 10 ? (
              <Alert
                className="band"
                type={latestRateLimitRemaining <= 0 ? "error" : "warning"}
                title="GitHub API rate limit is low"
                description={`Latest ${latestRateLimitHealth?.layer ?? "sync"} run reported ${latestRateLimitRemaining} requests remaining.`}
                showIcon
              />
            ) : null}

            {data.testing.staleQueuePrs > 0 ? (
              <Alert
                className="band"
                type="warning"
                title={`${data.testing.staleQueuePrs} PRs are stale in testing`}
                description="Testing queue age currently uses cached PR update time until timeline handoff events are backfilled."
                showIcon
              />
            ) : null}

            {data.webhooks.failedDeliveries > 0 ? (
              <Alert
                className="band"
                type="warning"
                title="Webhook ingestion has failed deliveries"
                description={
                  data.webhooks.latestFailure ?? `${data.webhooks.failedDeliveries} webhook deliveries failed.`
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
                <Table
                  rowKey="id"
                  size="middle"
                  columns={notificationColumns}
                  dataSource={data.notifications.lastDeliveries}
                  scroll={{ x: 1340 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No notification delivery attempts recorded" /> }}
                />
              </section>
            ) : null}

            {view === "Audit" ? (
              <section className="section">
                <div className="section-heading">
                  <Space>
                    <ClipboardCheck size={18} />
                    <Title level={4}>Write Audit</Title>
                  </Space>
                  <Text type="secondary">{session?.authenticated ? "Recent write actions" : "Login required"}</Text>
                </div>
                <Table
                  rowKey="id"
                  size="middle"
                  columns={writeActionColumns}
                  dataSource={data.writeActions}
                  scroll={{ x: 1420 }}
                  pagination={{ pageSize: 8 }}
                  locale={{
                    emptyText: (
                      <Empty
                        description={
                          session?.authenticated
                            ? "No write actions visible in cache"
                            : "Connect GitHub token to view write audit"
                        }
                      />
                    )
                  }}
                />
              </section>
            ) : null}

            {view === "PRs" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Testing Flow</Title>
                  <Space size={[6, 6]} wrap>
                    <Tag color={data.testing.queuePrs > 0 ? "blue" : "default"}>{data.testing.queuePrs} queued</Tag>
                    <Tag color={data.testing.staleQueuePrs > 0 ? "red" : "default"}>
                      {data.testing.staleQueuePrs} stale
                    </Tag>
                    <Tag>{data.testing.transitionEvents} transitions</Tag>
                    <Tag>{data.testing.requestToPassSamples} req-pass samples</Tag>
                    <Tag>{data.testing.passToCloseSamples} pass-close samples</Tag>
                    <Tag color={data.testing.closedWithoutPassSignalSamples > 0 ? "orange" : "default"}>
                      {data.testing.closedWithoutPassSignalSamples} closed no pass
                    </Tag>
                    <Tag>last {formatDate(data.testing.lastTransitionAt)}</Tag>
                  </Space>
                </div>
                <TestingCommandBoard pendingPrs={data.pendingPrs} testing={data.testing} />
                <Table
                  rowKey="login"
                  size="middle"
                  columns={testerColumns}
                  dataSource={data.testing.testers}
                  scroll={{ x: 760 }}
                  pagination={false}
                  locale={{ emptyText: <Empty description="No configured tester queue in cache" /> }}
                />
                <Table
                  className="testing-transition-table"
                  rowKey="id"
                  size="middle"
                  columns={testingTransitionColumns}
                  dataSource={data.testing.recentTransitions}
                  scroll={{ x: 1040 }}
                  pagination={{ pageSize: 6 }}
                  locale={{ emptyText: <Empty description="No testing transitions recorded yet" /> }}
                />
              </section>
            ) : null}

            {view === "Personal" ? (
              <section className="workbench-section">
                <div className="section-heading">
                  <Title level={4}>Personal Workbench</Title>
                  <Space size={[6, 6]} wrap>
                    <Tag color={selectedPersonalView?.summary.activeCriticalIssues ? "red" : "default"}>
                      {selectedPersonalView?.summary.activeCriticalIssues ?? 0} s-1/s0
                    </Tag>
                    <Tag color={selectedPersonalView?.summary.attentionPrs ? "orange" : "default"}>
                      {selectedPersonalView?.summary.attentionPrs ?? 0} PR attention
                    </Tag>
                    <Tag>{selectedPersonalView?.testingPrs.length ?? 0} testing</Tag>
                  </Space>
                </div>
                <PersonWorkloadBoard
                  compact
                  people={data.people}
                  personalViews={data.personalViews}
                  selectedLogin={selectedPersonalView?.login ?? null}
                  onSelect={selectPerson}
                />
                {selectedPersonalView ? (
                  <SelectedPersonWorkbench
                    person={selectedPersonalView}
                    analyticsPeriod={analyticsPeriod}
                    trendPoints={personalTrendPoints}
                    onAnalyticsPeriodChange={setAnalyticsPeriod}
                  />
                ) : (
                  <Empty description="No watched users configured for personal action lists" />
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
                {teamFlowSummary ? <FlowEfficiencyStrip summary={teamFlowSummary} /> : null}
                <TrendChart points={teamTrendPoints} />
              </section>
            ) : null}

            {view === "Drift" ? (
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
                <CriticalIssueBoard issues={data.criticalIssues} />
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
                  dataSource={data.criticalIssues}
                  scroll={{ x: 1700 }}
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
                    <Tag>{data.people.length} watched</Tag>
                    <Tag color={data.people.some((person) => person.activeCriticalIssues > 0) ? "red" : "default"}>
                      {data.people.reduce((sum, person) => sum + person.activeCriticalIssues, 0)} s-1/s0
                    </Tag>
                    <Tag color={data.people.some((person) => person.attentionPrs > 0) ? "orange" : "default"}>
                      {data.people.reduce((sum, person) => sum + person.attentionPrs, 0)} PR attention
                    </Tag>
                  </Space>
                </div>
                <PersonWorkloadBoard
                  people={data.people}
                  personalViews={data.personalViews}
                  selectedLogin={selectedPersonalView?.login ?? null}
                  onSelect={openPersonWorkbench}
                />
              </section>
            ) : null}

            {view === "PRs" ? (
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
        <Space orientation="vertical" size={12} className="token-modal-body">
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
            onChange={(event) => setTokenInput(event.target.value)}
          />
          {tokenError ? <Alert type="error" title={tokenError} showIcon /> : null}
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
          <Checkbox.Group
            value={manualRefreshLayers}
            onChange={(values) => {
              setManualRefreshLayers(values.map(String).filter(isManualRefreshLayer));
            }}
          >
            <Space orientation="vertical" size={8}>
              {syncHealthLayers.map((layer) => (
                <Checkbox key={layer} value={layer}>
                  {labelText(layer)}
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
