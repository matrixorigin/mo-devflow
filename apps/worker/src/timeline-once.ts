import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "@mo-devflow/db";
import { backfillIssueTimelineOnce } from "./sync";

loadEnv();

try {
  await migrate();
  const result = await backfillIssueTimelineOnce();
  console.log(
    `Backfilled issue timeline selected=${result.selected} refreshed=${result.refreshed} complete=${result.complete} partial=${result.partial} failed=${result.failed} skipped=${result.skipped}. Rate remaining: ${result.rateLimitRemaining ?? "unknown"}.`
  );
  await closePool();
  process.exit(0);
} catch (error) {
  console.error("Issue timeline backfill failed.");
  console.error(error);
  await closePool();
  process.exit(1);
}
