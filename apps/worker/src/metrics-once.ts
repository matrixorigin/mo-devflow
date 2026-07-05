import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "@mo-devflow/db";
import { recomputeMetricsFromCache } from "./sync";

loadEnv();

try {
  await migrate();
  const result = await recomputeMetricsFromCache();
  console.log(`Recomputed ${result.dailyMetrics} daily metric rows from cache.`);
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(error);
  await closePool();
  process.exit(1);
}
