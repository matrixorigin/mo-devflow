import { describe, expect, test } from "vitest";
import { prEvidence } from "./sync";

describe("PR attention evidence", () => {
  test("marks stale PR attention as partial when detail backfill is incomplete", () => {
    expect(prEvidence("no_human_action_24h", 42, false)).toContain(
      "Evidence is partial until PR detail, review, and timeline backfill completes."
    );
  });

  test("keeps confirmed review and CI evidence concise when PR detail is complete", () => {
    expect(prEvidence("requested_changes", 42, true)).toBe("PR #42 has unresolved requested changes.");
    expect(prEvidence("ci_failed", 42, true)).toBe("PR #42 has failing CI checks.");
  });
});
