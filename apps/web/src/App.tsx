import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Empty,
  Layout,
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
import { RefreshCw, ShieldAlert } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState("Overview");

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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
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
      }
    ],
    []
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
            options={["Overview", "Analytics", "People", "PRs", "Violations", "Drift"]}
          />
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
            </section>

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
    </Layout>
  );
}
