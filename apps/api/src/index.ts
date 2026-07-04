import Fastify from "fastify";
import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  getDashboardSummary,
  getJobQueueHealth,
  getRepoId,
  getWorkerHealth,
  migrate,
  pingDatabase,
  upsertRepoProfile
} from "@mo-devflow/db";
import { registerApiSecurity } from "./apiSecurity";
import { registerActionRoutes } from "./actionRoutes";
import { getSessionRecordFromRequest, registerAuthRoutes } from "./authRoutes";
import { apiHealthStatus } from "./health";
import { registerNotificationRoutes } from "./notificationRoutes";
import { registerRefreshRoutes } from "./refreshRoutes";
import { registerWebhookRoutes } from "./webhookRoutes";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

loadEnv();

const host = process.env.MO_DEVFLOW_API_HOST ?? "0.0.0.0";
const port = Number(process.env.MO_DEVFLOW_API_PORT ?? "18081");
const app = Fastify({
  logger: {
    level: process.env.MO_DEVFLOW_LOG_LEVEL ?? "info"
  }
});

app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  const rawBody = typeof body === "string" ? body : body.toString("utf8");
  request.rawBody = rawBody;
  if (!rawBody) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(rawBody));
  } catch (error) {
    done(error as Error);
  }
});

await registerApiSecurity(app);

await registerAuthRoutes(app);
await registerActionRoutes(app);
await registerRefreshRoutes(app);
await registerNotificationRoutes(app);
await registerWebhookRoutes(app);

app.get("/health", async () => {
  try {
    await pingDatabase();
    const [worker, jobQueue] = await Promise.all([getWorkerHealth(), getJobQueueHealth()]);
    return {
      status: apiHealthStatus({ worker, jobQueue }),
      database: "connected",
      worker,
      jobQueue,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    app.log.error({ error }, "health check failed");
    return {
      status: "unhealthy",
      database: "disconnected",
      generatedAt: new Date().toISOString()
    };
  }
});

app.get("/api/dashboard", async (request, reply) => {
  const profile = loadRepoProfile();
  const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
  try {
    const session = await getSessionRecordFromRequest(request, reply);
    return await getDashboardSummary(profile, repoId, {
      authenticated: Boolean(session),
      userId: session?.userId ?? null
    });
  } catch (error) {
    app.log.error({ error }, "dashboard query failed");
    return reply.status(500).send({
      error: "dashboard_query_failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/profile", async () => {
  const profile = loadRepoProfile();
  return {
    key: profile.key,
    repo: profile.repo,
    reporting: profile.reporting,
    access: profile.access,
    people: profile.people,
    labels: profile.labels,
    thresholds: profile.thresholds,
    workflow: profile.workflow
  };
});

try {
  await migrate();
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
