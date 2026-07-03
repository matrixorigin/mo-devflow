import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "@mo-devflow/db";
import { syncOnce } from "./sync";

loadEnv();

try {
  await migrate();
  const result = await syncOnce();
  if (!result) {
    console.log("Sync skipped because another worker holds the job lease.");
  } else {
    console.log(
      `Synced ${result.issues} issues and ${result.pullRequests} PRs. Rate remaining: ${result.rateLimitRemaining ?? "unknown"}.`
    );
  }
  await closePool();
  process.exit(0);
} catch (error) {
  console.error("Sync failed.");
  console.error(error);
  await closePool();
  process.exit(1);
}
