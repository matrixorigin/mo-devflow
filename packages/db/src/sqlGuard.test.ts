import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  formatSqlGuardViolation,
  hasWildcardSelect,
  isUnboundedRowReturningQuery,
  sqlGuardViolations
} from "./sqlGuard";

const databaseQueryRoots = ["packages/db/src", "apps/api/src", "apps/worker/src", "scripts"];

function collectDatabaseSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectDatabaseSourceFiles(path));
      continue;
    }
    if (!/\.(mjs|js|ts|tsx)$/.test(path) || /\.test\.(ts|tsx)$/.test(path)) {
      continue;
    }
    files.push(path);
  }
  return files;
}

describe("SQL query guardrails", () => {
  test("database source code does not use wildcard selects or unbounded row-returning selects", () => {
    const files = databaseQueryRoots.flatMap(collectDatabaseSourceFiles).map((path) => ({
      path,
      source: readFileSync(path, "utf8")
    }));

    expect(sqlGuardViolations(files).map(formatSqlGuardViolation)).toEqual([]);
  });

  test("detects wildcard select projections", () => {
    expect(hasWildcardSelect("SELECT * FROM issues LIMIT 10")).toBe(true);
    expect(hasWildcardSelect("SELECT i.* FROM issues i LIMIT 10")).toBe(true);
    expect(hasWildcardSelect("SELECT DISTINCT `i`.* FROM issues i LIMIT 10")).toBe(true);
    expect(hasWildcardSelect("SELECT id, number FROM issues LIMIT 10")).toBe(false);
  });

  test("requires normal row-returning selects to be bounded", () => {
    expect(isUnboundedRowReturningQuery("SELECT id, number FROM issues WHERE repo_id = ?")).toBe(true);
    expect(isUnboundedRowReturningQuery("SELECT id, number FROM issues WHERE repo_id = ? LIMIT ?")).toBe(false);
    expect(isUnboundedRowReturningQuery("SELECT COUNT(*) AS issue_count FROM issues WHERE repo_id = ?")).toBe(false);
    expect(isUnboundedRowReturningQuery("SELECT 1")).toBe(false);
    expect(isUnboundedRowReturningQuery("SELECT table_name FROM information_schema.tables")).toBe(false);
  });

  test("reports source file and line for query guard violations", () => {
    const source = [
      "const ok = `SELECT id FROM issues WHERE repo_id = ? LIMIT ?`;",
      "const wildcard = `SELECT * FROM pull_requests LIMIT 10`;",
      "const unbounded = `SELECT number FROM pull_requests WHERE repo_id = ?`;"
    ].join("\n");

    expect(
      sqlGuardViolations([{ path: "packages/db/src/example.ts", source }]).map(formatSqlGuardViolation)
    ).toEqual([
      "packages/db/src/example.ts:2: wildcard_select: SELECT * FROM pull_requests LIMIT 10",
      "packages/db/src/example.ts:3: unbounded_row_query: SELECT number FROM pull_requests WHERE repo_id = ?"
    ]);
  });
});
