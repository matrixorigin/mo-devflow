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
import { BellRing, ClipboardCheck, KeyRound, LogOut, RefreshCw, ShieldAlert } from "lucide-react";

const { Header, Content } = Layout;
const { Text, Title } = Typography;
echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

interface CriticalIssueView {
  number: number;
  title: string;
  htmlUrl: string;
  severity: string | null;
  ownerLogin: string | null;
  ownerReason: string | null;
  lifecycleState: string;
  ageHours: number;
  lastSyncedAt: string;
  isComplete: boolean;
  labels: string[];
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
  attentionFlags: string[];
  isComplete: boolean;
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

interface AnalyticsSummary {
  periodDays: number;
  sourceNote: string;
  teamDaily: DailyMetricPoint[];
  peopleDaily: DailyMetricPoint[];
}

type NotificationStatus =
  | "sent"
  | "failed"
  | "dry_run"
  | "skipped_disabled"
  | "skipped_no_webhook"
  | "skipped_quiet_hours";

interface NotificationDeliveryView {
  sourceType: "attention_item" | "workflow_violation" | "ai_drift_signal";
  ruleKey: string;
  objectType: string;
  objectNumber: number | null;
  recipientScope: "fallback" | "mapped_employee";
  channel: string;
  status: NotificationStatus;
  errorMessage: string | null;
  attemptedAt: string;
}

interface NotificationHealth {
  enabled: boolean;
  channel: "wecom";
  webhookConfigured: boolean;
  cooldownHours: number;
  failedDeliveries: number;
  lastDeliveries: NotificationDeliveryView[];
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
  } | null;
  tokenEncryptionConfigured: boolean;
}

type WorkflowFixOperation =
  | { type: "add_label"; label: string }
  | { type: "remove_label"; label: string }
  | { type: "add_comment"; body: string };

interface WorkflowFixPreview {
  previewId: string;
  actionKey: "add_needs_triage";
  repoKey: string;
  objectType: "issue" | "pull_request";
  objectNumber: number;
  ruleKey: string;
  title: string;
  htmlUrl: string;
  operations: WorkflowFixOperation[];
  warnings: string[];
  blockedReason: string | null;
  createdAt: string;
  expiresAt: string;
}

interface WorkflowFixExecutionResult {
  previewId: string;
  status: "success" | "failed" | "stale_preview" | "blocked" | "token_unavailable";
  executedOperations: WorkflowFixOperation[];
  message: string;
  errorMessage: string | null;
  executedAt: string;
}

interface DashboardSummary {
  repo: {
    key: string;
    owner: string;
    name: string;
    timezone: string;
  };
  sync: {
    generatedAt: string;
    health: Array<{
      layer: string;
      status: string;
      lastSuccessfulAt: string | null;
      lastAttemptedAt: string | null;
      errorMessage: string | null;
    }>;
    staleObjects: number;
    partialObjects: number;
  };
  counts: {
    criticalIssues: number;
    unownedCriticalIssues: number;
    pendingPrs: number;
    attentionPrs: number;
    workflowViolations: number;
    criticalWorkflowViolations: number;
    aiDriftSignals: number;
    criticalAiDriftSignals: number;
  };
  criticalIssues: CriticalIssueView[];
  people: PersonSummary[];
  pendingPrs: PendingPrView[];
  workflowViolations: WorkflowViolationView[];
  aiDriftSignals: AiDriftSignalView[];
  analytics: AnalyticsSummary;
  notifications: NotificationHealth;
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

function labelText(value: string): string {
  return value.replaceAll("_", " ");
}

function flagColor(flag: string): string {
  if (flag === "requested_changes" || flag === "ci_failed" || flag === "merge_conflict") {
    return "red";
  }
  if (flag === "no_human_action_24h") {
    return "orange";
  }
  return "blue";
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

function TrendChart({ points }: { points: DailyMetricPoint[] }) {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current || points.length === 0) {
      return;
    }
    const chart = echarts.init(chartRef.current);
    const dates = points.map((point) => point.date.slice(5));
    chart.setOption({
      color: ["#2563eb", "#16a34a", "#d97706", "#7c3aed"],
      tooltip: { trigger: "axis" },
      legend: { top: 0 },
      grid: { left: 36, right: 20, top: 44, bottom: 32 },
      xAxis: { type: "category", data: dates, boundaryGap: false },
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
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [workflowPreview, setWorkflowPreview] = useState<WorkflowFixPreview | null>(null);
  const [workflowExecution, setWorkflowExecution] = useState<WorkflowFixExecutionResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const [executionSaving, setExecutionSaving] = useState(false);

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

  async function previewWorkflowFix(violation: WorkflowViolationView) {
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
          actionKey: "add_needs_triage",
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
      setWorkflowExecution((await response.json()) as WorkflowFixExecutionResult);
      void load();
    } catch (err) {
      setPreviewError(displayError(err));
    } finally {
      setExecutionSaving(false);
    }
  }

  useEffect(() => {
    void load();
    void loadSession();
  }, []);

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
        title: "Severity",
        dataIndex: "severity",
        width: 132,
        render: (severity) => <Tag color={severityColor(severity)}>{severity ?? "unknown"}</Tag>
      },
      {
        title: "Owner",
        dataIndex: "ownerLogin",
        width: 148,
        render: (owner, issue) =>
          owner ? (
            <Tooltip title={issue.ownerReason ? `by ${issue.ownerReason}` : undefined}>
              <Tag>{owner}</Tag>
            </Tooltip>
          ) : (
            <Tag color="red">unowned</Tag>
          )
      },
      {
        title: "Age",
        dataIndex: "ageHours",
        width: 96,
        render: (age) => hours(age)
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
        width: 280,
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
          const canPreview = violation.fixable && violation.objectType === "issue" && violation.ruleKey === "bug_missing_needs_triage";
          const tooltip = !session?.authenticated
            ? "Connect GitHub token to preview fixes"
            : canPreview
              ? "Preview workflow fix"
              : "No safe preview action for this rule yet";
          return (
            <Tooltip title={tooltip}>
              <Button
                icon={<ClipboardCheck size={15} />}
                disabled={!session?.authenticated || !canPreview}
                loading={previewLoadingKey === `${violation.objectType}-${violation.objectNumber}-${violation.ruleKey}`}
                onClick={() => void previewWorkflowFix(violation)}
              />
            </Tooltip>
          );
        }
      }
    ],
    [previewLoadingKey, session?.authenticated]
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
        title: "Error",
        dataIndex: "errorMessage",
        ellipsis: true,
        render: (value) => (value ? <Text ellipsis={{ tooltip: value }}>{value}</Text> : <Text type="secondary">-</Text>)
      }
    ],
    []
  );

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
            options={["Overview", "Analytics", "People", "PRs", "Violations", "Drift", "Notifications"]}
          />
          {session?.authenticated && session.user ? (
            <Space size={8}>
              <Avatar size={28} src={session.user.avatarUrl}>
                {session.user.githubLogin.slice(0, 1).toUpperCase()}
              </Avatar>
              <Tag>{session.user.githubLogin}</Tag>
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
                onClick={() => {
                  setTokenError(null);
                  setTokenModalOpen(true);
                }}
              >
                Connect
              </Button>
            </Tooltip>
          )}
          <Tooltip title="Refresh cached dashboard">
            <Button icon={<RefreshCw size={16} />} onClick={() => void load()} loading={loading} />
          </Tooltip>
        </Space>
      </Header>
      <Content className="content">
        {error ? <Alert className="band" type="error" message="Dashboard unavailable" description={error} showIcon /> : null}
        {loading && !data ? (
          <Skeleton active paragraph={{ rows: 10 }} />
        ) : data ? (
          <>
            {data.sync.partialObjects > 0 ? (
              <Alert
                className="band"
                type="warning"
                message={`${data.sync.partialObjects} cached objects are partial`}
                description="Timeline, review, or CI backfill is not complete yet; stale decisions stay visible as partial evidence."
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
                <Statistic title="Pending PRs" value={data.counts.pendingPrs} />
                <Progress percent={Math.min(100, data.counts.pendingPrs)} showInfo={false} strokeColor="#2563eb" />
              </div>
              <div className="metric">
                <Statistic title="Attention PRs" value={data.counts.attentionPrs} />
                <Progress percent={Math.min(100, data.counts.attentionPrs * 10)} showInfo={false} strokeColor="#ca8a04" />
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
            </section>

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
                  </Space>
                </div>
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
                  rowKey={(delivery) =>
                    `${delivery.sourceType}-${delivery.objectType}-${delivery.objectNumber ?? "none"}-${delivery.ruleKey}-${delivery.attemptedAt}`
                  }
                  size="middle"
                  columns={notificationColumns}
                  dataSource={data.notifications.lastDeliveries}
                  scroll={{ x: 1040 }}
                  pagination={{ pageSize: 8 }}
                  locale={{ emptyText: <Empty description="No notification delivery attempts recorded" /> }}
                />
              </section>
            ) : null}

            {view === "Analytics" || view === "Overview" ? (
              <section className="section">
                <div className="section-heading">
                  <Title level={4}>Analytics</Title>
                  <Text type="secondary">Last {data.analytics.periodDays} days | {data.repo.timezone}</Text>
                </div>
                <Alert className="band" type="info" message={data.analytics.sourceNote} showIcon />
                <TrendChart points={data.analytics.teamDaily} />
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
                scroll={{ x: 760 }}
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
            <Text type="secondary">Preview expires {formatDate(workflowPreview.expiresAt)}.</Text>
          </Space>
        ) : null}
      </Modal>
    </Layout>
  );
}
