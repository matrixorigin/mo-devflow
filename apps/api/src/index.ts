import Fastify from "fastify";
import { loadEnv, loadRepoProfile } from "@mo-devflow/config";
import {
  getDashboardDataVersion,
  getDashboardSummary,
  getJobQueueHealth,
  getOperationalHealth,
  getRepoId,
  getWorkerHealth,
  migrate,
  pingDatabase,
  upsertRepoProfile
} from "@mo-devflow/db";
import { registerApiSecurity } from "./apiSecurity";
import { registerActionRoutes } from "./actionRoutes";
import { getSessionRecordFromRequest, registerAuthRoutes } from "./authRoutes";
import { apiHealthHttpStatus, apiHealthStatus } from "./health";
import { registerNotificationRoutes } from "./notificationRoutes";
import { registerRefreshRoutes } from "./refreshRoutes";
import { registerWebhookRoutes } from "./webhookRoutes";
import { createDashboardSummaryCache, dashboardCacheTtlMsFromEnv } from "./dashboardCache";

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
const dashboardCacheTtlMs = dashboardCacheTtlMsFromEnv();
const dashboardCache = createDashboardSummaryCache({ ttlMs: dashboardCacheTtlMs });

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

app.get("/health", async (_request, reply) => {
  try {
    await pingDatabase();
    const [worker, jobQueue] = await Promise.all([getWorkerHealth(), getJobQueueHealth()]);
    const profile = loadRepoProfile();
    const repoId = await getRepoId(profile.key);
    let operational = null;
    let operationalError: string | null = null;
    if (repoId) {
      try {
        operational = await getOperationalHealth(repoId);
      } catch (error) {
        app.log.error({ error, repoKey: profile.key }, "operational health query failed");
        operationalError = "Operational health summary failed; inspect API logs.";
      }
    }
    const status = apiHealthStatus({ worker, jobQueue, operational, operationalError });
    return reply.status(apiHealthHttpStatus(status)).send({
      status,
      database: "connected",
      worker,
      jobQueue,
      operational,
      operationalError,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    app.log.error({ error }, "health check failed");
    return reply.status(apiHealthHttpStatus("unhealthy")).send({
      status: "unhealthy",
      database: "disconnected",
      generatedAt: new Date().toISOString()
    });
  }
});

app.get("/api/dashboard", async (request, reply) => {
  const profile = loadRepoProfile();
  const repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
  try {
    const session = await getSessionRecordFromRequest(request, reply);
    const viewer = {
      authenticated: Boolean(session),
      userId: session?.userId ?? null
    };
    const ifNoneMatchHeader = request.headers["if-none-match"];
    const ifNoneMatch = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader.join(",") : ifNoneMatchHeader;
    const result = await dashboardCache.get({
      profile,
      viewer,
      ifNoneMatch,
      loadVersion: async () => {
        try {
          return await getDashboardDataVersion(repoId);
        } catch (error) {
          app.log.warn({ error, repoKey: profile.key }, "dashboard data version query failed");
          throw error;
        }
      },
      buildSummary: () => getDashboardSummary(profile, repoId, viewer)
    });
    reply.header("Cache-Control", `private, max-age=${Math.floor(dashboardCacheTtlMs / 1000)}, must-revalidate`);
    reply.header("ETag", result.etag);
    reply.header("X-MO-Devflow-Dashboard-Cache", result.status);
    reply.header("X-MO-Devflow-Dashboard-Version", result.version);
    if (result.status === "not-modified") {
      return reply.status(304).send();
    }
    return result.summary;
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
