import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

export interface SensitiveSourceFile {
  path: string;
  source: string;
}

export interface SensitiveGuardFinding {
  path: string;
  line: number;
  rule:
    | "tracked_env_file"
    | "tracked_local_profile"
    | "github_token"
    | "wecom_webhook_url"
    | "inline_mysql_password"
    | "dotenv_secret_assignment";
  snippet: string;
}

const githubTokenPattern = /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/g;
const wecomWebhookPattern = /https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9_-]{16,}/gi;
const inlineMysqlPasswordPattern = new RegExp(
  String.raw`(^|\s)--password=(?!["']?\$\{?|["']?\$|["']{2}|<)[^\s"']+|(^|\s)-` +
    String.raw`p(?!\s|["']?\$\{?|["']?\$|["']|<)[^\s"']+`,
  "g"
);
const sensitiveEnvNames = [
  "MO_DEVFLOW_DB_PASSWORD",
  "MO_DEVFLOW_GITHUB_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET",
  "MO_DEVFLOW_GITHUB_WEBHOOK_SECRET",
  "MO_DEVFLOW_TOKEN_ENCRYPTION_KEY",
  "MO_DEVFLOW_WECOM_WEBHOOK_URL"
];
const dotenvSecretAssignmentPattern = new RegExp(
  String.raw`^\s*(?:${sensitiveEnvNames.join("|")})\s*=\s*([^\s#]+)`
);
const placeholderValuePattern = /^(?:changeme|example|secret|token|service-token|client-secret|<[^>]+>|your-.+)$/i;

export function sensitiveGuardFindings(files: SensitiveSourceFile[]): SensitiveGuardFinding[] {
  return files.flatMap((file) => sensitiveGuardFindingsForSource(file.path, file.source));
}

export function sensitiveGuardFindingsForSource(path: string, source: string): SensitiveGuardFinding[] {
  const findings: SensitiveGuardFinding[] = [];
  findings.push(...sensitivePathFindings(path));

  const lines = source.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    findings.push(...contentFindingsForLine(path, lineNumber, line));
  }

  return findings;
}

export function formatSensitiveGuardFinding(finding: SensitiveGuardFinding): string {
  return `${finding.path}:${finding.line}: ${finding.rule}: ${finding.snippet}`;
}

function sensitivePathFindings(path: string): SensitiveGuardFinding[] {
  if (basename(path) === ".env") {
    return [{ path, line: 1, rule: "tracked_env_file", snippet: "Do not track runtime .env files" }];
  }
  if (/^config\/repos\/.+\.local\.ya?ml$/i.test(path) && !/\.local\.example\.ya?ml$/i.test(path)) {
    return [{ path, line: 1, rule: "tracked_local_profile", snippet: "Do not track local repo profiles" }];
  }
  return [];
}

function contentFindingsForLine(path: string, line: number, sourceLine: string): SensitiveGuardFinding[] {
  const findings: SensitiveGuardFinding[] = [];
  const trimmed = sourceLine.trim();

  findings.push(...patternFindings(path, line, sourceLine, githubTokenPattern, "github_token"));
  findings.push(...patternFindings(path, line, sourceLine, wecomWebhookPattern, "wecom_webhook_url"));
  findings.push(...patternFindings(path, line, sourceLine, inlineMysqlPasswordPattern, "inline_mysql_password"));

  if (!trimmed.startsWith("#") && !trimmed.startsWith("//")) {
    const dotenvMatch = dotenvSecretAssignmentPattern.exec(sourceLine);
    const value = dotenvMatch?.[1]?.trim();
    if (value && !placeholderValuePattern.test(value)) {
      findings.push({
        path,
        line,
        rule: "dotenv_secret_assignment",
        snippet: redactSnippet(sourceLine)
      });
    }
  }

  return findings;
}

function patternFindings(
  path: string,
  line: number,
  sourceLine: string,
  pattern: RegExp,
  rule: SensitiveGuardFinding["rule"]
): SensitiveGuardFinding[] {
  pattern.lastIndex = 0;
  return Array.from(sourceLine.matchAll(pattern), (match) => ({
    path,
    line,
    rule,
    snippet: redactSnippet(match[0] ?? sourceLine)
  }));
}

function redactSnippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= 24) {
    return "[redacted]";
  }
  return `${compact.slice(0, 12)}...[redacted]...${compact.slice(-6)}`;
}

function trackedSourceFiles(): SensitiveSourceFile[] {
  const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

function runCli(): void {
  const findings = sensitiveGuardFindings(trackedSourceFiles()).map(formatSensitiveGuardFinding);
  if (findings.length > 0) {
    console.error("Sensitive guard failed. Remove secrets or local-only profiles from tracked files.");
    for (const finding of findings) {
      console.error(finding);
    }
    process.exitCode = 1;
    return;
  }
  console.log("Sensitive guard passed for tracked files.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
