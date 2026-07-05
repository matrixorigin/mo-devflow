export interface SqlSourceFile {
  path: string;
  source: string;
}

export interface SqlGuardViolation {
  path: string;
  line: number;
  rule: "wildcard_select" | "unbounded_row_query";
  snippet: string;
}

interface SqlLiteral {
  value: string;
  line: number;
}

const wildcardSelectPattern = /\bselect\s+(?:distinct\s+)?(?:[`"\w]+\.)?\*/i;
const sqlStringPattern = /`([\s\S]*?\bSELECT\b[\s\S]*?)`|"([^"\n]*\bSELECT\b[^"\n]*)"|'([^'\n]*\bSELECT\b[^'\n]*)'/gi;

export function sqlGuardViolations(files: SqlSourceFile[]): SqlGuardViolation[] {
  return files.flatMap((file) => sqlGuardViolationsForSource(file.path, file.source));
}

export function sqlGuardViolationsForSource(path: string, source: string): SqlGuardViolation[] {
  const literals = sqlLiterals(source);
  return literals.flatMap((literal) => {
    const query = compactSql(literal.value);
    const violations: SqlGuardViolation[] = [];
    if (hasWildcardSelect(query)) {
      violations.push({ path, line: literal.line, rule: "wildcard_select", snippet: query.slice(0, 180) });
    }
    if (isUnboundedRowReturningQuery(query)) {
      violations.push({ path, line: literal.line, rule: "unbounded_row_query", snippet: query.slice(0, 180) });
    }
    return violations;
  });
}

export function hasWildcardSelect(query: string): boolean {
  return wildcardSelectPattern.test(query);
}

export function isUnboundedRowReturningQuery(query: string): boolean {
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

export function formatSqlGuardViolation(violation: SqlGuardViolation): string {
  return `${violation.path}:${violation.line}: ${violation.rule}: ${violation.snippet}`;
}

function sqlLiterals(source: string): SqlLiteral[] {
  return Array.from(source.matchAll(sqlStringPattern), (match) => ({
    value: String(match[1] ?? match[2] ?? match[3] ?? ""),
    line: source.slice(0, match.index).split("\n").length
  }));
}

function compactSql(query: string): string {
  return query.replace(/\s+/g, " ").trim();
}
