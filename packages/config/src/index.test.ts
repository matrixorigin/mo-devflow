import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadRepoProfile } from "./index";

let tempDir: string | null = null;

function writeProfile(yaml: string): string {
  tempDir = mkdtempSync(path.join(tmpdir(), "mo-devflow-profile-"));
  const profilePath = path.join(tempDir, "profile.yaml");
  writeFileSync(profilePath, yaml, "utf8");
  return profilePath;
}

describe("repo profile config", () => {
  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test("requires explicit write-back policy", () => {
    const profilePath = writeProfile(`
repo:
  owner: matrixorigin
  name: matrixone
access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide
labels: {}
workflow:
  skip_users: []
`);

    expect(() => loadRepoProfile(profilePath)).toThrow(/write_back_enabled/);
  });

  test("maps explicit write-back policy into the repo profile", () => {
    const profilePath = writeProfile(`
repo:
  owner: matrixorigin
  name: matrixone
access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide
  write_back_enabled: false
labels: {}
workflow:
  skip_users:
    - workflow-skip-user-a
    - workflow-skip-user-b
`);

    const profile = loadRepoProfile(profilePath);
    expect(profile.access.writeBackEnabled).toBe(false);
    expect(profile.workflow.skipUsers).toEqual(["workflow-skip-user-a", "workflow-skip-user-b"]);
  });

  test("maps critical notification escalation policy into the repo profile", () => {
    const profilePath = writeProfile(`
repo:
  owner: matrixorigin
  name: matrixone
access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide
  write_back_enabled: false
labels: {}
workflow:
  skip_users: []
notifications:
  routing:
    critical_issue_stalled:
      cooldown_hours: 6
      fallback_recipient: maintainers
      escalate_after_hours: 18
`);

    const profile = loadRepoProfile(profilePath);
    expect(profile.testing.handoffScope).toBe("issue");
    expect(profile.notifications.routing.cooldownHours).toBe(6);
    expect(profile.notifications.routing.fallbackRecipient).toBe("maintainers");
    expect(profile.notifications.routing.escalateAfterHours).toBe(18);
  });

  test("rejects PR-side testing handoff configuration", () => {
    const profilePath = writeProfile(`
repo:
  owner: matrixorigin
  name: matrixone
access:
  anonymous_read: true
  expose_user_token_synced_private_data: false
  critical_scope: repo-wide
  write_back_enabled: false
labels: {}
workflow:
  skip_users: []
testing:
  handoff_signals:
    assignee_users:
      - tester-a
`);

    expect(() => loadRepoProfile(profilePath)).toThrow(/assignee_users/);
  });
});
