import { describe, expect, test } from "vitest";
import { writeActionExecutionViewFromRow } from "./writeActions";

describe("write action audit views", () => {
  test("parses notification probe audit rows without requiring a GitHub object", () => {
    expect(
      writeActionExecutionViewFromRow({
        id: 1,
        preview_id: "audit:test",
        github_login: "alice",
        action_key: "send_test_notification",
        object_type: "notification_probe",
        object_number: 0,
        object_title: "Notification test",
        object_html_url: null,
        status: "success",
        operations_json: "[]",
        error_message: null,
        started_at: "2026-07-04 01:00:00",
        finished_at: "2026-07-04 01:00:00"
      })
    ).toEqual({
      id: 1,
      previewId: "audit:test",
      githubLogin: "alice",
      actionKey: "send_test_notification",
      objectType: "notification_probe",
      objectNumber: 0,
      title: "Notification test",
      htmlUrl: null,
      status: "success",
      executedOperations: [],
      errorMessage: null,
      startedAt: "2026-07-04T01:00:00Z",
      finishedAt: "2026-07-04T01:00:00Z"
    });
  });
});
