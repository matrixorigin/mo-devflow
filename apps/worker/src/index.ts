import { loadEnv } from "@mo-devflow/config";
import { migrate } from "@mo-devflow/db";
import { syncOnce } from "./sync";

loadEnv();

const intervalSeconds = Math.max(60, Number(process.env.MO_DEVFLOW_SYNC_INTERVAL_SECONDS ?? "300"));

async function tick(): Promise<void> {
  try {
    const result = await syncOnce();
    if (result) {
      console.log(
        `[worker] synced issues=${result.issues} prs=${result.pullRequests} rate=${result.rateLimitRemaining ?? "unknown"}`
      );
    } else {
      console.log("[worker] sync skipped; lease held elsewhere");
    }
  } catch (error) {
    console.error("[worker] sync failed", error);
  }
}

await migrate();
await tick();
setInterval(() => {
  void tick();
}, intervalSeconds * 1000);
