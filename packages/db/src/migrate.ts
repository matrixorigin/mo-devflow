import { loadEnv } from "@mo-devflow/config";
import { closePool, migrate } from "./index";

loadEnv();

try {
  await migrate();
  await closePool();
  console.log("Database migrations applied.");
  process.exit(0);
} catch (error) {
  console.error("Database migration failed.");
  console.error(error);
  await closePool();
  process.exitCode = 1;
}
