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
       COALESCE(issue_summary.stale_count, 0) + COALESCE(pr_summary.stale_count, 0) AS stale_count,
       CASE
         WHEN issue_summary.oldest_synced_at IS NULL THEN pr_summary.oldest_synced_at
         WHEN pr_summary.oldest_synced_at IS NULL THEN issue_summary.oldest_synced_at
         WHEN issue_summary.oldest_synced_at <= pr_summary.oldest_synced_at THEN issue_summary.oldest_synced_at
         ELSE pr_summary.oldest_synced_at
       END AS oldest_synced_at
     FROM (
       SELECT SUM(CASE WHEN i.last_synced_at < ${sqlStringLiteral(input.staleCutoff)} THEN 1 ELSE 0 END) AS stale_count,
              MIN(i.last_synced_at) AS oldest_synced_at
       FROM issues i
       WHERE i.repo_id = ? AND i.state = 'open' AND i.is_pull_request = 0${issueWhere}
     ) issue_summary
     CROSS JOIN (
       SELECT SUM(CASE WHEN p.last_synced_at < ${sqlStringLiteral(input.staleCutoff)} THEN 1 ELSE 0 END) AS stale_count,
              MIN(p.last_synced_at) AS oldest_synced_at
       FROM pull_requests p
       WHERE p.repo_id = ? AND p.state = 'open'${pullRequestWhere}
     ) pr_summary`;
}
