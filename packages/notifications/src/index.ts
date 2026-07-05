import type { NotificationCandidate, RepoProfile } from "@mo-devflow/shared";

export interface WeComSendResult {
  status: number;
  body: unknown;
}

export type WeComFailureKind = "transient" | "permanent";

export class WeComSendError extends Error {
  readonly failureKind: WeComFailureKind;
  readonly status: number | null;
  readonly providerBody: unknown;

  constructor(
    message: string,
    input: { failureKind: WeComFailureKind; status: number | null; providerBody?: unknown }
  ) {
    super(message);
    this.name = "WeComSendError";
    this.failureKind = input.failureKind;
    this.status = input.status;
    this.providerBody = input.providerBody;
  }
}

export function weComFailureKindFromHttpStatus(status: number): WeComFailureKind {
  if (status === 408 || status === 429 || status >= 500) {
    return "transient";
  }
  return "permanent";
}

export function weComFailureKindFromProviderCode(code: number): WeComFailureKind {
  return code === 45009 ? "transient" : "permanent";
}

export function classifyWeComFailure(error: unknown): WeComFailureKind {
  if (error instanceof WeComSendError) {
    return error.failureKind;
  }
  return "transient";
}

export function buildWeComMarkdown(profile: RepoProfile, candidate: NotificationCandidate): string {
  const objectText = candidate.objectNumber
    ? `${candidate.objectType} #${candidate.objectNumber}`
    : candidate.objectType;
  const title = candidate.title.length > 120 ? `${candidate.title.slice(0, 117)}...` : candidate.title;
  const evidence =
    candidate.evidenceSummary.length > 280
      ? `${candidate.evidenceSummary.slice(0, 277)}...`
      : candidate.evidenceSummary;
  const target = candidate.htmlUrl ? `[${objectText}](${candidate.htmlUrl})` : objectText;
  const dashboardTarget = `[Open in mo-devflow](${candidate.dashboardUrl})`;
  const owner = candidate.relatedLogin ? `\n> Owner: ${candidate.relatedLogin}` : "";
  if (
    candidate.sourceType === "daily_digest" ||
    candidate.sourceType === "weekly_digest" ||
    candidate.sourceType === "monthly_digest"
  ) {
    const digestPeriod =
      candidate.sourceType === "monthly_digest"
        ? "monthly"
        : candidate.sourceType === "weekly_digest"
          ? "weekly"
          : "daily";
    return [
      `## mo-devflow ${digestPeriod} digest`,
      `> Repo: ${profile.key}`,
      `> Date: ${title}`,
      candidate.relatedLogin ? `> Person: ${candidate.relatedLogin}` : null,
      `> Dashboard: ${dashboardTarget}`,
      "",
      evidence
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }
  return [
    `## mo-devflow ${candidate.severity.toUpperCase()} alert`,
    `> Repo: ${profile.key}`,
    `> Rule: ${candidate.ruleKey}`,
    `> Dashboard: ${dashboardTarget}`,
    `> Object: ${target}`,
    `> Title: ${title}${owner}`,
    "",
    evidence
  ].join("\n");
}

export function isInQuietHours(
  quietHours: { start: string; end: string } | undefined,
  timezone: string,
  now = new Date()
): boolean {
  if (!quietHours) {
    return false;
  }
  const currentMinutes = minutesInTimezone(now, timezone);
  const start = parseClockMinutes(quietHours.start);
  const end = parseClockMinutes(quietHours.end);
  if (start === null || end === null || start === end) {
    return false;
  }
  if (start < end) {
    return currentMinutes >= start && currentMinutes < end;
  }
  return currentMinutes >= start || currentMinutes < end;
}

export async function sendWeComMarkdown(webhookUrl: string, markdown: string): Promise<WeComSendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(validatedWebhookUrl(webhookUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: markdown }
      }),
      redirect: "error",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep provider text as-is.
  }
  if (!response.ok) {
    throw new WeComSendError(`WeCom webhook returned ${response.status}: ${text.slice(0, 240)}`, {
      failureKind: weComFailureKindFromHttpStatus(response.status),
      status: response.status,
      providerBody: body
    });
  }
  const providerFailure = weComProviderFailureFromBody(body);
  if (providerFailure) {
    throw new WeComSendError(
      `WeCom webhook rejected message ${providerFailure.code}: ${providerFailure.message.slice(0, 240)}`,
      {
        failureKind: weComFailureKindFromProviderCode(providerFailure.code),
        status: response.status,
        providerBody: body
      }
    );
  }
  return { status: response.status, body };
}

function weComProviderFailureFromBody(body: unknown): { code: number; message: string } | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const errcode =
    typeof record.errcode === "number"
      ? record.errcode
      : typeof record.errcode === "string"
        ? Number(record.errcode)
        : null;
  if (errcode === null || !Number.isFinite(errcode) || errcode === 0) {
    return null;
  }
  return {
    code: errcode,
    message: typeof record.errmsg === "string" ? record.errmsg : `errcode ${errcode}`
  };
}

function validatedWebhookUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WeComSendError("WeCom webhook URL is invalid.", {
      failureKind: "permanent",
      status: null
    });
  }
  if (url.protocol !== "https:") {
    throw new WeComSendError("WeCom webhook URL must use https.", {
      failureKind: "permanent",
      status: null
    });
  }
  return url.toString();
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function minutesInTimezone(value: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
