function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function activeCacheStaleSummarySql(input: {
  staleCutoff: string;
  issueWhereSql?: string;
  pullRequestWhereSql?: string;
}): string {
  const issueWhere = input.issueWhereSql ? ` AND ${input.issueWhereSql}` : "";
  const pullRequestWhere = input.pullRequestWhereSql ? ` AND ${input.pullRequestWhereSql}` : "";
  return `SELECT
       SUM(CASE WHEN last_synced_at < ${sqlStringLiteral(input.staleCutoff)} THEN 1 ELSE 0 END) AS stale_count,
       MIN(last_synced_at) AS oldest_synced_at
     FROM (
       SELECT i.last_synced_at FROM issues i WHERE i.repo_id = ? AND i.state = 'open' AND i.is_pull_request = 0${issueWhere}
       UNION ALL
       SELECT p.last_synced_at FROM pull_requests p WHERE p.repo_id = ? AND p.state = 'open'${pullRequestWhere}
     ) active_cache`;
}
