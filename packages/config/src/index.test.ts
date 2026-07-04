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
`);

    expect(loadRepoProfile(profilePath).access.writeBackEnabled).toBe(false);
  });
});
