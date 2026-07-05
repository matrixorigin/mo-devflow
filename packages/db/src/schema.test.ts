import { describe, expect, test } from "vitest";
import {
  detectSchemaDrift,
  expectedSchemaColumnSpecsFromStatements,
  expectedSchemaColumnsFromStatements,
  expectedSchemaIndexStatements
} from "./schema";

function column(columnType: string, nullable: boolean) {
  return { columnType, nullable };
}

describe("schema contract", () => {
  test("derives expected columns from current create-table statements", () => {
    const expected = expectedSchemaColumnsFromStatements();

    expect(expected.get("issues")).toContain("source_user_id");
    expect(expected.get("pull_requests")).toContain("testing_state");
    expect(expected.get("pull_requests")).toContain("linked_issue_numbers_json");
    expect(expected.get("issue_comment_syncs")).toContain("is_complete");
    expect(expected.get("issue_comments")).toContain("body");
    expect(expected.get("issue_timeline_events")).toContain("label_name");
    expect(expected.get("issue_timeline_events")).toContain("assignee_login");
    expect(expected.get("issue_timeline_syncs")).toContain("is_complete");
    expect(expected.get("notification_deliveries")).toContain("payload_json");
    expect(expected.get("notification_deliveries")).toContain("dashboard_url");
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
    expect(specs.get("notification_deliveries")?.get("dashboard_url")).toEqual({
      columnType: "TEXT",
      nullable: false
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
    expect(specs.get("pull_requests")?.get("linked_issue_numbers_json")).toEqual({
      columnType: "TEXT",
      nullable: false
    });
    expect(specs.get("issue_timeline_events")?.get("assignee_login")).toEqual({
      columnType: "VARCHAR(255)",
      nullable: true
    });
  });

  test("declares dashboard hot-path indexes for bounded read models", () => {
    const indexes = expectedSchemaIndexStatements();

    expect(indexes).toContain(
      "CREATE INDEX idx_issues_dashboard_scan ON issues(repo_id, visibility_class, source_user_id, is_pull_request, state, updated_at, number)"
    );
    expect(indexes).toContain(
      "CREATE INDEX idx_pull_requests_dashboard_scan ON pull_requests(repo_id, visibility_class, source_user_id, state, updated_at, number)"
    );
    expect(indexes).toContain(
      "CREATE INDEX idx_issue_timeline_events_repo_issue_type_time ON issue_timeline_events(repo_id, issue_number, event_type, occurred_at)"
    );
    expect(indexes).toContain(
      "CREATE INDEX idx_workflow_violations_dashboard ON workflow_violations(repo_id, resolved_at, severity, last_detected_at)"
    );
    expect(indexes).toContain(
      "CREATE INDEX idx_notification_deliveries_source_latest ON notification_deliveries(repo_id, source_type, source_id, id)"
    );
    expect(indexes).toContain(
      "CREATE INDEX idx_github_webhook_repo_status_received ON github_webhook_deliveries(repo_id, status, received_at, id)"
    );
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
