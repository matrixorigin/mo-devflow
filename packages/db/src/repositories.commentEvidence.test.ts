import { beforeEach, describe, expect, test, vi } from "vitest";
import { issueCommentEvidenceByIssueNumber } from "./repositories";

const mocks = vi.hoisted(() => ({
  execute: vi.fn()
}));

vi.mock("./client", () => ({
  getPool: () => ({
    execute: mocks.execute
  }),
  nowSql: () => "2026-07-04 12:00:00",
  sqlDate: (value: string | null) => value,
  fromSqlDate: (value: unknown) => (value ? `${String(value).replace(" ", "T")}Z` : null)
}));

describe("issue comment evidence visibility", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  test("applies dashboard visibility filters to comment sync and comment rows", async () => {
    mocks.execute.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM issue_comment_syncs")) {
        expect(sql).toContain("issue_comment_syncs s");
        expect(sql).toContain("s.visibility_class IN ('anonymous_readable')");
        expect(params).toEqual([1, 42]);
        return [
          [
            {
              issue_number: 42,
              is_complete: 1,
              sync_error: null,
              last_synced_at: "2026-07-04 01:00:00"
            }
          ]
        ];
      }

      if (sql.includes("FROM issue_comments")) {
        expect(sql).toContain("issue_comments c");
        expect(sql).toContain("c.visibility_class IN ('anonymous_readable')");
        expect(params).toEqual([1, 42, 200]);
        return [
          [
            {
              issue_number: 42,
              author_login: "alice",
              body: "Deferred because reproduction is unstable.",
              created_at: "2026-07-04 00:30:00",
              updated_at: "2026-07-04 00:45:00"
            }
          ]
        ];
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await issueCommentEvidenceByIssueNumber(1, [42], {
      syncs: { sql: "s.visibility_class IN ('anonymous_readable')", params: [] },
      comments: { sql: "c.visibility_class IN ('anonymous_readable')", params: [] }
    });

    expect(evidence.get(42)).toEqual({
      isComplete: true,
      lastSyncedAt: "2026-07-04T01:00:00Z",
      syncError: null,
      comments: [
        {
          authorLogin: "alice",
          body: "Deferred because reproduction is unstable.",
          createdAt: "2026-07-04T00:30:00Z",
          updatedAt: "2026-07-04T00:45:00Z"
        }
      ]
    });
  });

  test("does not report hidden token-owned comment syncs as visible evidence", async () => {
    mocks.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM issue_comment_syncs")) {
        return [[]];
      }

      if (sql.includes("FROM issue_comments")) {
        return [
          [
            {
              issue_number: 42,
              author_login: "alice",
              body: "Private token-owned context.",
              created_at: "2026-07-04 00:30:00",
              updated_at: "2026-07-04 00:45:00"
            }
          ]
        ];
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const evidence = await issueCommentEvidenceByIssueNumber(1, [42], {
      syncs: { sql: "s.visibility_class IN ('anonymous_readable')", params: [] },
      comments: { sql: "c.visibility_class IN ('anonymous_readable')", params: [] }
    });

    expect(evidence.has(42)).toBe(false);
  });
});
