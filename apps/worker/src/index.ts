import { loadEnv } from "@mo-devflow/config";
import { migrate } from "@mo-devflow/db";
import { intervalSecondsFromEnv, runDueJobsOnce } from "./jobs";

loadEnv();

const intervalSeconds = intervalSecondsFromEnv("MO_DEVFLOW_WORKER_TICK_SECONDS", 30, 10);

async function tick(): Promise<void> {
  try {
    const result = await runDueJobsOnce();
    if (result.claimedJobs > 0) {
      for (const run of result.runs) {
        console.log(`[worker] ${run.status} ${run.jobKey}: ${run.message}`);
      }
    } else {
      console.log("[worker] no due jobs");
    }
  } catch (error) {
    console.error("[worker] job tick failed", error);
  }
}

await migrate();
await tick();
setInterval(() => {
  void tick();
}, intervalSeconds * 1000);
