import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const runtimeRoots = ["packages/db/src", "apps/api/src", "apps/worker/src"];
const wildcardSelectPattern = /\bselect\s+(?:distinct\s+)?(?:[`"\w]+\.)?\*/gi;

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
});
