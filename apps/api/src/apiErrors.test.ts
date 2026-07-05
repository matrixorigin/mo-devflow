import { describe, expect, test } from "vitest";
import { dashboardLoginRequiredPayload, dashboardQueryFailurePayload, publicStartupMigrationError } from "./apiErrors";

describe("public API error payloads", () => {
  test("does not expose underlying dashboard query failures", () => {
    const payload = dashboardQueryFailurePayload();

    expect(payload.error).toBe("dashboard_query_failed");
    expect(payload.message).toContain("Dashboard data is unavailable");
    expect(payload.message).toContain("MO_DEVFLOW_DB_*");
    expect(payload.message).not.toContain("check password failed");
    expect(payload.message).not.toContain("Access denied");
  });

  test("sanitizes startup migration errors for health responses", () => {
    expect(publicStartupMigrationError(null)).toBeNull();
    expect(publicStartupMigrationError("Access denied for user root. internal error: check password failed")).toBe(
      "Database migration is not ready. Check API logs and MatrixOne connection configuration."
    );
  });

  test("explains dashboard login requirements without exposing server internals", () => {
    expect(dashboardLoginRequiredPayload()).toEqual({
      error: "dashboard_login_required",
      message:
        "This repository profile does not allow anonymous dashboard reads. Sign in with GitHub to view cached data."
    });
  });
});
