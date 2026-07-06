import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { formatSqlGuardViolation, sqlGuardViolations, type SqlSourceFile } from "../packages/db/src/sqlGuard";

const defaultRoots = ["packages/db/src", "apps/api/src", "apps/worker/src", "scripts"];
const ignoredDirectoryNames = new Set(["node_modules", "dist", ".git"]);
const sourceFilePattern = /\.(mjs|js|ts|tsx)$/;
const testFilePattern = /\.test\.(ts|tsx|js|mjs)$/;

function collectSourceFiles(root: string): SqlSourceFile[] {
  const files: SqlSourceFile[] = [];
  for (const entry of readdirSync(root).sort()) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry)) {
        files.push(...collectSourceFiles(path));
      }
      continue;
    }
    if (!sourceFilePattern.test(path) || testFilePattern.test(path)) {
      continue;
    }
    files.push({ path, source: readFileSync(path, "utf8") });
  }
  return files;
}

const roots = process.argv.slice(2);
const sourceFiles = (roots.length > 0 ? roots : defaultRoots).flatMap(collectSourceFiles);
const violations = sqlGuardViolations(sourceFiles).map(formatSqlGuardViolation);

if (violations.length > 0) {
  console.error("SQL guard failed. Avoid wildcard SELECTs and bound row-returning queries with LIMIT.");
  for (const violation of violations) {
    console.error(violation);
  }
  process.exitCode = 1;
} else {
  console.log(`SQL guard passed for ${sourceFiles.length} source files.`);
}
