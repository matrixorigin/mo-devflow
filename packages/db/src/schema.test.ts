import { describe, expect, test } from "vitest";
import { detectSchemaDrift, expectedSchemaColumnsFromStatements } from "./schema";

describe("schema contract", () => {
  test("derives expected columns from current create-table statements", () => {
    const expected = expectedSchemaColumnsFromStatements();

    expect(expected.get("issues")).toContain("source_user_id");
    expect(expected.get("pull_requests")).toContain("testing_state");
    expect(expected.get("notification_deliveries")).toContain("payload_json");
    expect(expected.get("workflow_violations")).toContain("fixable");
    expect(expected.get("workflow_violations")).not.toContain("UNIQUE");
  });

  test("reports missing and unexpected columns instead of repairing them", () => {
    const expected = new Map([
      ["issues", new Set(["id", "number", "source_user_id"])],
      ["pull_requests", new Set(["id", "number"])]
    ]);

    expect(
      detectSchemaDrift(expected, [
        { table_name: "issues", column_name: "id" },
        { table_name: "issues", column_name: "number" },
        { table_name: "issues", column_name: "legacy_column" },
        { table_name: "pull_requests", column_name: "id" },
        { table_name: "pull_requests", column_name: "number" }
      ])
    ).toEqual({
      missingColumns: ["issues.source_user_id"],
      unexpectedColumns: ["issues.legacy_column"]
    });
  });
});
