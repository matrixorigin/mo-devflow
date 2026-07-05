import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const runtimeRoots = ["packages/db/src", "apps/api/src", "apps/worker/src"];
const wildcardSelectPattern = /\bselect\s+(?:distinct\s+)?(?:[`"\w]+\.)?\*/gi;
const sqlStringPattern = /`([\s\S]*?\bSELECT\b[\s\S]*?)`|"([^"\n]*\bSELECT\b[^"\n]*)"|'([^'\n]*\bSELECT\b[^'\n]*)'/gi;

function collectRuntimeTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      files.push(...collectRuntimeTypeScriptFiles(path));
      continue;
    }
    if (!path.endsWith(".ts") || path.endsWith(".test.ts")) {
      continue;
    }
    files.push(path);
  }
  return files;
}

describe("SQL query guardrails", () => {
  test("runtime database code does not use wildcard select projections", () => {
    const violations = runtimeRoots.flatMap(collectRuntimeTypeScriptFiles).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(source.matchAll(wildcardSelectPattern), (match) => `${path}: ${match[0]}`);
    });

    expect(violations).toEqual([]);
  });

  test("runtime database row-returning queries are explicitly bounded", () => {
    const violations = runtimeRoots.flatMap(collectRuntimeTypeScriptFiles).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return Array.from(source.matchAll(sqlStringPattern))
        .map((match) => ({
          query: String(match[1] ?? match[2] ?? match[3] ?? "").replace(/\s+/g, " ").trim(),
          line: source.slice(0, match.index).split("\n").length
        }))
        .filter(({ query }) => isUnboundedRowReturningQuery(query))
        .map(({ query, line }) => `${path}:${line}: ${query.slice(0, 180)}`);
    });

    expect(violations).toEqual([]);
  });
});

function isUnboundedRowReturningQuery(query: string): boolean {
  if (!/\bselect\b/i.test(query) || !/\bfrom\b/i.test(query)) {
    return false;
  }
  if (/\blimit\b/i.test(query)) {
    return false;
  }
  if (/\b(count|sum|min|max|avg)\s*\(|\bgroup\s+by\b|\binformation_schema\b/i.test(query)) {
    return false;
  }
  if (/\$\{hidden(?:Issue|Pr)Expression\}/.test(query)) {
    return false;
  }
  if (/\bselect\s+1\b/i.test(query)) {
    return false;
  }
  if (/\bin\s*\(\$\{[^}]+\}\)/i.test(query)) {
    return false;
  }
  if (query.includes("comment_synced_at") && !query.includes("comment_candidates")) {
    return false;
  }
  return true;
}
