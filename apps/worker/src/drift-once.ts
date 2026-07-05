import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "@mo-devflow/db";
import { recomputeAiDriftFromCache } from "./sync";

loadEnv();

try {
  await migrate();
  const result = await recomputeAiDriftFromCache();
  console.log(`Recomputed ${result.aiDriftSignals} AI drift signals from cache.`);
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(error);
  await closePool();
  process.exit(1);
}
