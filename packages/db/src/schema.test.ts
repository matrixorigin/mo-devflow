import { describe, expect, test } from "vitest";
import {
  detectSchemaDrift,
  expectedSchemaColumnSpecsFromStatements,
  expectedSchemaColumnsFromStatements
} from "./schema";

function column(columnType: string, nullable: boolean) {
  return { columnType, nullable };
}

describe("schema contract", () => {
  test("derives expected columns from current create-table statements", () => {
    const expected = expectedSchemaColumnsFromStatements();

    expect(expected.get("issues")).toContain("source_user_id");
    expect(expected.get("pull_requests")).toContain("testing_state");
    expect(expected.get("pr_testing_events")).toContain("from_state");
    expect(expected.get("pr_testing_events")).toContain("source_completeness");
    expect(expected.get("issue_comment_syncs")).toContain("is_complete");
    expect(expected.get("issue_comments")).toContain("body");
    expect(expected.get("notification_deliveries")).toContain("payload_json");
    expect(expected.get("workflow_violations")).toContain("fixable");
    expect(expected.get("user_github_tokens")).toContain("repo_permission");
    expect(expected.get("daily_metrics")).toContain("active_critical_issues");
    expect(expected.get("daily_metrics")).toContain("avg_pending_pr_age_hours");
    expect(expected.get("daily_metrics")).toContain("ci_failed_prs");
    expect(expected.get("daily_metrics")).toContain("requested_change_prs");
    expect(expected.get("daily_metrics")).toContain("review_waiting_prs");
    expect(expected.get("daily_metrics")).toContain("merge_conflict_prs");
    expect(expected.get("workflow_violations")).not.toContain("UNIQUE");

    const specs = expectedSchemaColumnSpecsFromStatements();
    expect(specs.get("attention_items")?.get("dashboard_url")).toEqual({ columnType: "TEXT", nullable: false });
    expect(specs.get("write_action_executions")?.get("object_number")).toEqual({
      columnType: "BIGINT",
      nullable: false
    });
    expect(specs.get("notification_deliveries")?.get("payload_json")).toEqual({
      columnType: "TEXT",
      nullable: true
    });
    expect(specs.get("user_github_tokens")?.get("repo_permission")).toEqual({
      columnType: "VARCHAR(64)",
      nullable: false
    });
    expect(specs.get("daily_metrics")?.get("avg_testing_queue_age_hours")).toEqual({
      columnType: "DOUBLE",
      nullable: true
    });
    expect(specs.get("daily_metrics")?.get("ci_failed_prs")).toEqual({
      columnType: "INT",
      nullable: false
    });
  });

  test("reports missing and unexpected columns instead of repairing them", () => {
    const expected = new Map([
      [
        "issues",
        new Map([
          ["id", column("BIGINT", false)],
          ["number", column("BIGINT", false)],
          ["source_user_id", column("BIGINT", true)]
        ])
      ],
      [
        "pull_requests",
        new Map([
          ["id", column("BIGINT", false)],
          ["number", column("INT", false)]
        ])
      ]
    ]);

    expect(
      detectSchemaDrift(expected, [
        { table_name: "issues", column_name: "id", column_type: "BIGINT(64)", is_nullable: "NO" },
        { table_name: "issues", column_name: "number", column_type: "INT(32)", is_nullable: "YES" },
        { table_name: "issues", column_name: "legacy_column", column_type: "TEXT", is_nullable: "YES" },
        { table_name: "pull_requests", column_name: "id", column_type: "BIGINT(64)", is_nullable: "NO" },
        { table_name: "pull_requests", column_name: "number", column_type: "INT(32)", is_nullable: "NO" }
      ])
    ).toEqual({
      missingColumns: ["issues.source_user_id"],
      unexpectedColumns: ["issues.legacy_column"],
      typeMismatches: ["issues.number expected BIGINT but found INT"],
      nullabilityMismatches: ["issues.number expected NOT NULL but found NULL"]
    });
  });
});
