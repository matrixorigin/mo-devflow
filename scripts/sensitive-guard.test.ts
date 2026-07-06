import { describe, expect, test } from "vitest";
import {
  formatSensitiveGuardFinding,
  sensitiveGuardFindings,
  sensitiveGuardFindingsForSource
} from "./sensitive-guard";

describe("sensitive guard", () => {
  test("rejects tracked runtime env files and local repo profiles", () => {
    expect(
      sensitiveGuardFindings([
        { path: ".env", source: "" },
        { path: "config/repos/matrixone.local.yaml", source: "" },
        { path: "config/repos/matrixone.local.example.yaml", source: "" }
      ]).map((finding) => finding.rule)
    ).toEqual(["tracked_env_file", "tracked_local_profile"]);
  });

  test("detects common committed token and webhook secrets without printing values", () => {
    const token = "ghp_" + "123456789012345678901234567890123456";
    const webhookUrl =
      "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=" + "12345678-1234-1234-1234-123456789012";
    const source = [
      `const token = '${token}';`,
      `const url = '${webhookUrl}';`
    ].join("\n");

    const findings = sensitiveGuardFindingsForSource("apps/api/src/example.ts", source);

    expect(findings.map((finding) => finding.rule)).toEqual(["github_token", "wecom_webhook_url"]);
    expect(findings.map(formatSensitiveGuardFinding).join("\n")).not.toContain("123456789012345678901234");
  });

  test("detects inline database passwords but allows environment expansion", () => {
    expect(
      sensitiveGuardFindingsForSource(
        "Makefile",
        "mysql -h db.local -u root -" + 'p111\nmysql --password="$${MO_DEVFLOW_DB_PASSWORD}"'
      ).map((finding) => finding.rule)
    ).toEqual(["inline_mysql_password"]);
  });

  test("detects non-placeholder dotenv secret assignments", () => {
    const findings = sensitiveGuardFindingsForSource(
      ".env.example",
      [
        "MO_DEVFLOW_DB_PASSWORD=",
        "#MO_DEVFLOW_GITHUB_TOKEN=",
        "MO_DEVFLOW_GITHUB_OAUTH_CLIENT_SECRET=client-secret",
        "MO_DEVFLOW_GITHUB_WEBHOOK_SECRET=actual-local-secret-value"
      ].join("\n")
    );

    expect(findings.map((finding) => finding.rule)).toEqual(["dotenv_secret_assignment"]);
  });
});
