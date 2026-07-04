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
import { summarizeCacheEvidence, summarizeFreshness } from "./freshness";
import {
  criticalIssueReasons,
  personalActivityItems,
  personPrimaryReasons,
  personWorkloadStatus,
  personalIssueReasons,
  prAttentionReasons,
  sortPeopleByWorkload,
  type PersonalActivityItem,
  type WorkloadStatus
} from "./workbench";

const { Header, Content } = Layout;
const { Paragraph, Text, Title } = Typography;
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

type TrendMetricPoint = DailyMetricPoint | AggregatedMetricPoint;
const viewOptions = [
  "Overview",
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

function dashboardHashForView(view: DashboardView): string {
  return view.toLowerCase();
}

function initialDashboardView(): DashboardView {
  return typeof window === "undefined" ? "Overview" : dashboardViewFromHash(window.location.hash);
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
          {snapshot.aiEffortLabel ? <Tag color="blue">{snapshot.aiEffortLabel}</Tag> : null}
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

  return (
    <article className={`work-item-card ${critical ? "work-item-critical" : ""}`}>
      <div className="work-item-header">
        <WorkObjectLink href={issue.htmlUrl} icon={<CircleAlert size={15} aria-hidden="true" />}>
          Issue #{issue.number}
        </WorkObjectLink>
        <Tag>{hours(issue.ageHours)}</Tag>
      </div>
      <a className="work-item-title" href={issue.htmlUrl} target="_blank" rel="noreferrer">
        {issue.title}
      </a>
      <div className="work-tag-row">
        <Tag>{labelText(issue.lifecycleState)}</Tag>
        {issue.severity ? <Tag color={severityColor(issue.severity)}>{issue.severity}</Tag> : null}
        {critical && issue.aiEffortLabel ? <Tag color="blue">{issue.aiEffortLabel}</Tag> : null}
        {!issue.isComplete ? <Tag color="gold">partial</Tag> : null}
        {critical && issue.ownerLogin ? <Tag>{issue.ownerLogin}</Tag> : null}
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

function PersonalActivityFeed({ items }: { items: PersonalActivityItem[] }) {
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No current activity" />;
  }

  return (
    <div className="activity-feed-list">
      {items.slice(0, 24).map((item) => (
        <PersonalActivityCard item={item} key={item.id} />
      ))}
    </div>
  );
}

function PersonalActivityCard({ item }: { item: PersonalActivityItem }) {
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

  return (
    <article className={`activity-card activity-card-${item.tone}`}>
      <div className="activity-card-main">
        <div className="activity-object-row">
          <WorkObjectLink href={item.htmlUrl} icon={icon}>
            {objectLabel}
          </WorkObjectLink>
          <Tag color={activityToneColor(item.tone)}>{item.phase}</Tag>
          <Tag>{hours(item.ageHours)}</Tag>
          {!item.isComplete ? <Tag color="gold">partial</Tag> : null}
        </div>
        <a className="activity-title" href={item.htmlUrl} target="_blank" rel="noreferrer">
          {item.title}
        </a>
        <div className="activity-meta-row">
          <span>
            <TimerReset size={13} aria-hidden="true" />
            age {hours(item.ageHours)}
          </span>
          {item.lastHumanActionAt ? (
            <span>
              <UserRound size={13} aria-hidden="true" />
              human {formatDate(item.lastHumanActionAt)}
            </span>
          ) : null}
          {item.testingQueueAgeHours !== null ? (
            <span>
              <ClipboardCheck size={13} aria-hidden="true" />
              testing {hours(item.testingQueueAgeHours)}
            </span>
          ) : null}
        </div>
        <div className="activity-tag-row">
          {item.severity ? <Tag color={severityColor(item.severity)}>{item.severity}</Tag> : null}
          {item.lifecycleState ? <Tag>{labelText(item.lifecycleState)}</Tag> : null}
          {item.reviewDecision ? (
            <Tag color={item.reviewDecision === "changes_requested" ? "red" : "blue"}>
              {labelText(item.reviewDecision)}
            </Tag>
          ) : null}
          {item.ciState ? <Tag color={ciColor(item.ciState)}>ci {labelText(item.ciState)}</Tag> : null}
          {item.mergeStateStatus ? (
            <Tag color={mergeColor(item.mergeStateStatus)}>merge {labelText(item.mergeStateStatus)}</Tag>
          ) : null}
          {item.testingState ? (
            <Tag color={testingStateColor(item.testingState as TestingFlowState)}>{labelText(item.testingState)}</Tag>
          ) : null}
        </div>
        {linkedIssueUrls.length > 0 || linkedPrUrls.length > 0 ? (
          <div className="activity-link-row">
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
          </div>
        ) : null}
      </div>
      {item.reasons.length > 0 ? (
        <div className="activity-reason-row">
          {item.reasons.slice(0, 5).map((reason) => (
            <Tag color={activityReasonColor(reason)} key={reason}>
              {reason}
            </Tag>
          ))}
        </div>
      ) : null}
    </article>
  );
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
          <Title level={5}>Current Activity</Title>
          <Space size={[6, 6]} wrap>
            <Tag color={activityItems.some((item) => item.tone === "critical") ? "red" : "default"}>
              {activityItems.filter((item) => item.tone === "critical").length} active s-1/s0
            </Tag>
            <Tag color={activityItems.some((item) => item.tone === "attention") ? "orange" : "default"}>
              {activityItems.filter((item) => item.tone === "attention").length} attention
            </Tag>
            <Tag>{activityItems.filter((item) => item.linkedIssueNumbers.length > 0).length} linked issues</Tag>
          </Space>
        </div>
        <PersonalActivityFeed items={activityItems} />
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
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
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

  function selectView(nextView: DashboardView) {
    setView(nextView);
    const nextHash = `#${dashboardHashForView(nextView)}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }
  }

  function openPersonWorkbench(login: string) {
    setSelectedPerson(login);
    selectView("Personal");
  }

  function openManualRefreshModal() {
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
    const syncViewFromHash = () => setView(dashboardViewFromHash(window.location.hash));
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
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
        render: (label) => (label ? <Tag color="blue">{label}</Tag> : <Tag color="orange">missing</Tag>)
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
  const latestRateLimitHealth = data?.sync.health.find((item) => item.rateLimitRemaining !== null) ?? null;
  const latestRateLimitRemaining = latestRateLimitHealth?.rateLimitRemaining ?? null;
  const criticalOwnerCoverageRows = data
    ? data.criticalOwnerCoverage.filter((owner) => owner.ownerScope !== "watched").slice(0, 8)
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
              onClick={openManualRefreshModal}
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
              <Alert
                className="band evidence-alert"
                type={cacheEvidence.alertType}
                title={cacheEvidence.title}
                description={
                  <Space orientation="vertical" size={8} className="full-width">
                    <Text>{cacheEvidence.description}</Text>
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
                    {cacheEvidence.recommendedAction ? (
                      <Text type="secondary">{cacheEvidence.recommendedAction}</Text>
                    ) : null}
                  </Space>
                }
                showIcon
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
              <>
                <section className="kpi-grid">
                  <div className="metric">
                    <Statistic title="Active s-1/s0" value={data.counts.criticalIssues} />
                    <Progress
                      percent={Math.min(100, data.counts.criticalIssues * 10)}
                      showInfo={false}
                      strokeColor="#dc2626"
                    />
                  </div>
                  <div className="metric">
                    <Statistic title="Unowned s-1/s0" value={data.counts.unownedCriticalIssues} />
                    <Progress
                      percent={Math.min(100, data.counts.unownedCriticalIssues * 20)}
                      showInfo={false}
                      strokeColor="#d97706"
                    />
                  </div>
                  <div className="metric">
                    <Statistic title="Non-watched s-1/s0" value={data.counts.nonWatchedCriticalIssues} />
                    <Progress
                      percent={Math.min(100, data.counts.nonWatchedCriticalIssues * 20)}
                      showInfo={false}
                      strokeColor="#ca8a04"
                    />
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
                    <Progress
                      percent={Math.min(100, data.counts.attentionPrs * 10)}
                      showInfo={false}
                      strokeColor="#ca8a04"
                    />
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
                      percent={Math.min(
                        100,
                        data.counts.criticalWorkflowViolations * 25 + data.counts.workflowViolations
                      )}
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
                    <Statistic title="Active Notification Failures" value={data.notifications.failedDeliveries} />
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
                        data.sync.jobQueue.queueDepth * 20 +
                          data.sync.jobQueue.failedJobs * 25 +
                          data.sync.jobQueue.blockedJobs * 30
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
                      percent={Math.min(
                        100,
                        data.webhooks.pendingDeliveries * 20 +
                          data.webhooks.failedDeliveries * 25 +
                          data.webhooks.normalizationFailedDeliveries * 25 +
                          data.webhooks.ignoredDeliveries * 5
                      )}
                      showInfo={false}
                      strokeColor={data.webhooks.failedDeliveries > 0 ? "#dc2626" : "#16a34a"}
                    />
                  </div>
                </section>

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

                {criticalOwnerCoverageRows.length > 0 ? (
                  <section className="section">
                    <div className="section-heading">
                      <Title level={4}>Active s-1/s0 Owner Coverage</Title>
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
              </>
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

            {view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Operational Health</Title>
                  <Text type="secondary">
                    Generated {formatDate(data.sync.generatedAt)} | {data.repo.timezone}
                  </Text>
                </div>
                <div className="health-grid">
                  <Statistic
                    title="Worker"
                    value={labelText(data.sync.worker.status)}
                    styles={{ content: { color: workerStatusColor(data.sync.worker.status) } }}
                  />
                  <Statistic
                    title="Worker Phase"
                    value={data.sync.worker.phase ? labelText(data.sync.worker.phase) : "-"}
                  />
                  <Statistic title="Last Heartbeat" value={formatDate(data.sync.worker.heartbeatAt)} />
                  <Statistic title="Last Tick" value={formatDate(data.sync.worker.lastTickFinishedAt)} />
                  <Statistic
                    title="GitHub Rate"
                    value={latestRateLimitRemaining === null ? "-" : latestRateLimitRemaining}
                    styles={{ content: { color: rateLimitColor(latestRateLimitRemaining) } }}
                  />
                  <Statistic title="Stale Objects" value={data.sync.staleObjects} />
                  <Statistic
                    title="Oldest Cache"
                    value={data.sync.oldestCacheAgeHours === null ? "-" : hours(data.sync.oldestCacheAgeHours)}
                  />
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
                  <Statistic title="Webhook Normalization" value={data.webhooks.normalizationFailedDeliveries} />
                  <Statistic title="Webhook Ignored" value={data.webhooks.ignoredDeliveries} />
                  <Statistic title="Webhook Duplicates" value={data.webhooks.duplicateDeliveries} />
                  <Statistic title="Last Webhook" value={formatDate(data.webhooks.lastReceivedAt)} />
                  <Statistic title="Testing Queue" value={data.testing.queuePrs} />
                  <Statistic
                    title="Avg Testing Age"
                    value={data.testing.averageQueueAgeHours === null ? "-" : hours(data.testing.averageQueueAgeHours)}
                  />
                  <Statistic
                    title="Req To Pass"
                    value={
                      data.testing.averageRequestToPassHours === null
                        ? "-"
                        : hours(data.testing.averageRequestToPassHours)
                    }
                  />
                  <Statistic
                    title="Pass To Close"
                    value={
                      data.testing.averagePassToCloseHours === null ? "-" : hours(data.testing.averagePassToCloseHours)
                    }
                  />
                  <Statistic title="Testing Events" value={data.testing.transitionEvents} />
                  <Statistic title="Last Testing Event" value={formatDate(data.testing.lastTransitionAt)} />
                </div>
                <Space className="sync-health-tags" size={[6, 6]} wrap>
                  {data.sync.health.map((item) => (
                    <Space className="sync-health-layer" key={item.layer} size={2}>
                      <Tooltip title={syncHealthTooltip(item)}>
                        <Tag color={syncHealthTagColor(item.status)}>
                          {item.layer}: {item.status}
                        </Tag>
                      </Tooltip>
                      <Tag color={item.lastSuccessfulAt ? "default" : "red"}>
                        success {formatDate(item.lastSuccessfulAt)}
                      </Tag>
                      {item.lastFailedAt ? <Tag color="orange">failure {formatDate(item.lastFailedAt)}</Tag> : null}
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

            {view === "Audit" || view === "Overview" ? (
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

            {view === "PRs" || view === "Overview" ? (
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
                    <Tag>last {formatDate(data.testing.lastTransitionAt)}</Tag>
                  </Space>
                </div>
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
                  onSelect={setSelectedPerson}
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

            {view === "Analytics" || view === "Overview" ? (
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
                  scroll={{ x: 1700 }}
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
                  scroll={{ x: 1580 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No active workflow violations in cache" /> }}
                />
              </section>
            ) : null}

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

            {view === "People" || view === "Overview" ? (
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
