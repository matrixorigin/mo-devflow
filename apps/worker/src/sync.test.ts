import { describe, expect, test } from "vitest";
import { WeComSendError } from "@mo-devflow/notifications";
import { metricsRetentionDaysFromEnv, notificationFailureStatus, prEvidence } from "./sync";

describe("PR attention evidence", () => {
  test("marks stale PR attention as partial when detail backfill is incomplete", () => {
    expect(prEvidence("no_human_action_24h", 42, false)).toContain(
      "Evidence is partial until PR detail, review, and timeline backfill completes."
    );
  });

  test("keeps confirmed review and CI evidence concise when PR detail is complete", () => {
    expect(prEvidence("requested_changes", 42, true)).toBe("PR #42 has unresolved requested changes.");
    expect(prEvidence("review_requested_no_response", 42, true)).toBe(
      "PR #42 has a stale review request without reviewer response."
    );
    expect(prEvidence("ci_failed", 42, true)).toBe("PR #42 has failing CI checks.");
  });
});

describe("metrics retention", () => {
  test("uses a monthly-digest-safe default retention window", () => {
    expect(metricsRetentionDaysFromEnv({})).toBe(120);
  });

  test("accepts configured positive retention days and clamps short windows", () => {
    expect(metricsRetentionDaysFromEnv({ MO_DEVFLOW_METRICS_RETENTION_DAYS: "180" })).toBe(180);
    expect(metricsRetentionDaysFromEnv({ MO_DEVFLOW_METRICS_RETENTION_DAYS: "7" })).toBe(31);
    expect(metricsRetentionDaysFromEnv({ MO_DEVFLOW_METRICS_RETENTION_DAYS: "invalid" })).toBe(120);
  });
});

describe("notification failure status", () => {
  test("maps permanent WeCom failures to permanent delivery status", () => {
    expect(
      notificationFailureStatus(
        new WeComSendError("invalid webhook", {
          failureKind: "permanent",
          status: null
        })
      )
    ).toBe("failed_permanent");
  });

  test("maps unknown delivery exceptions to transient delivery status", () => {
    expect(notificationFailureStatus(new Error("network unavailable"))).toBe("failed_transient");
  });
});
