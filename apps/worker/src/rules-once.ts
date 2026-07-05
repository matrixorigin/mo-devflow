import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "@mo-devflow/db";
import { recomputeWorkflowViolationsFromCache } from "./sync";

loadEnv();

try {
  await migrate();
  const result = await recomputeWorkflowViolationsFromCache();
  console.log(`Recomputed ${result.workflowViolations} workflow violations from cache.`);
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(error);
  await closePool();
  process.exit(1);
}
