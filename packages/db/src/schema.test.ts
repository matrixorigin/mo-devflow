import { describe, expect, test } from "vitest";
import { detectSchemaDrift, expectedSchemaColumnSpecsFromStatements, expectedSchemaColumnsFromStatements } from "./schema";

describe("schema contract", () => {
  test("derives expected columns from current create-table statements", () => {
    const expected = expectedSchemaColumnsFromStatements();

    expect(expected.get("issues")).toContain("source_user_id");
    expect(expected.get("pull_requests")).toContain("testing_state");
    expect(expected.get("issue_comment_syncs")).toContain("is_complete");
    expect(expected.get("issue_comments")).toContain("body");
    expect(expected.get("notification_deliveries")).toContain("payload_json");
    expect(expected.get("workflow_violations")).toContain("fixable");
    expect(expected.get("workflow_violations")).not.toContain("UNIQUE");

    const specs = expectedSchemaColumnSpecsFromStatements();
    expect(specs.get("attention_items")?.get("dashboard_url")).toEqual({ nullable: false });
  });

  test("reports missing and unexpected columns instead of repairing them", () => {
    const expected = new Map([
      [
        "issues",
        new Map([
          ["id", { nullable: false }],
          ["number", { nullable: false }],
          ["source_user_id", { nullable: true }]
        ])
      ],
      [
        "pull_requests",
        new Map([
          ["id", { nullable: false }],
          ["number", { nullable: false }]
        ])
      ]
    ]);

    expect(
      detectSchemaDrift(expected, [
        { table_name: "issues", column_name: "id", is_nullable: "NO" },
        { table_name: "issues", column_name: "number", is_nullable: "YES" },
        { table_name: "issues", column_name: "legacy_column", is_nullable: "YES" },
        { table_name: "pull_requests", column_name: "id", is_nullable: "NO" },
        { table_name: "pull_requests", column_name: "number", is_nullable: "NO" }
      ])
    ).toEqual({
      missingColumns: ["issues.source_user_id"],
      unexpectedColumns: ["issues.legacy_column"],
      nullabilityMismatches: ["issues.number expected NOT NULL but found NULL"]
    });
  });
});
