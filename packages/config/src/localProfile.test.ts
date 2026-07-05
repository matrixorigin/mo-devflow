import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadRepoProfile } from "./index";

let tempDir: string | null = null;

function writeProfileFiles(baseYaml: string, localYaml?: string): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "mo-devflow-local-profile-"));
  const profilePath = path.join(tempDir, "profile.yaml");
  writeFileSync(profilePath, baseYaml, "utf8");
  if (localYaml) {
    writeFileSync(path.join(tempDir, "profile.local.yaml"), localYaml, "utf8");
  }
  return profilePath;
}

describe("local repo profile overrides", () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("merges untracked local people and workflow settings into the committed profile template", () => {
    const profilePath = writeProfileFiles(
      `
repo:
  owner: matrixorigin
  name: matrixone
access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide
  write_back_enabled: false
people:
  watched_users: []
  testers: []
labels: {}
workflow:
  skip_users: []
notifications:
  wecom:
    enabled: false
    webhook_url_env: MO_DEVFLOW_WECOM_WEBHOOK_URL
`,
      `
repo:
  local_path: /tmp/matrixone
people:
  watched_users:
    - watched-user-a
    - watched-user-b
  testers:
    - tester-a
workflow:
  skip_users:
    - workflow-skip-user-a
testing:
  handoff_signals:
    labels:
      - testing
notifications:
  routing:
    critical_issue_stalled:
      cooldown_hours: 8
      fallback_recipient: maintainers
      escalate_after_hours: 16
`
    );

    const profile = loadRepoProfile(profilePath);

    expect(profile.repo.localPath).toBe("/tmp/matrixone");
    expect(profile.people.watchedUsers).toEqual(["watched-user-a", "watched-user-b"]);
    expect(profile.people.testers).toEqual(["tester-a"]);
    expect(profile.workflow.skipUsers).toEqual(["workflow-skip-user-a"]);
    expect(profile.testing.handoffSignals).toEqual({
      labels: ["testing"]
    });
    expect(profile.notifications.wecom.webhookUrlEnv).toBe("MO_DEVFLOW_WECOM_WEBHOOK_URL");
    expect(profile.notifications.routing).toMatchObject({
      cooldownHours: 8,
      fallbackRecipient: "maintainers",
      escalateAfterHours: 16
    });
  });
});
