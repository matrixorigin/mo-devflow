import { closePool, migrate } from "@mo-devflow/db";
import { sendNotificationsOnce } from "./sync";

try {
  await migrate();
  const result = await sendNotificationsOnce();
  console.log(
    `Processed ${result.candidates} notification candidates: sent=${result.sent}, skipped=${result.skipped}, failed=${result.failed}, cooldown=${result.cooldown}.`
  );
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(error);
  await closePool();
  process.exit(1);
}
