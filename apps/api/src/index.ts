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
import { apiAccessHealthFromConfig, apiHealthFindings, apiHealthHttpStatus, apiHealthStatus } from "./health";
import { registerNotificationRoutes } from "./notificationRoutes";
import { publicRepoProfileView } from "./profileView";
import { registerRefreshRoutes } from "./refreshRoutes";
import { registerWebhookRoutes } from "./webhookRoutes";
import { createDashboardSummaryCache, dashboardCacheTtlMsFromEnv } from "./dashboardCache";
import { dashboardReadAccess } from "./dashboardAccess";
import { readCookieValue, sessionCookieName } from "./sessionCookie";
import { dashboardQueryFailurePayload, publicStartupMigrationError } from "./apiErrors";
import { generateApiRequestId } from "./requestId";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

loadEnv();

const host = process.env.MO_DEVFLOW_API_HOST ?? "0.0.0.0";
const port = Number(process.env.MO_DEVFLOW_API_PORT ?? "18081");
const app = Fastify({
  genReqId: generateApiRequestId,
  logger: {
    level: process.env.MO_DEVFLOW_LOG_LEVEL ?? "info"
  }
});
const dashboardCacheTtlMs = dashboardCacheTtlMsFromEnv();
const dashboardCache = createDashboardSummaryCache({ ttlMs: dashboardCacheTtlMs });
let startupMigrationError: string | null = null;

async function runMigration(label: "startup" | "retry"): Promise<void> {
  try {
    await migrate();
    startupMigrationError = null;
  } catch (error) {
    startupMigrationError = errorMessage(error);
    app.log.error({ error, label }, "database migration failed");
    throw error;
  }
}

async function ensureMigrationReady(): Promise<void> {
  if (!startupMigrationError) {
    return;
  }
  await runMigration("retry");
}

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
await registerActionRoutes(app, { onDashboardMutated: () => dashboardCache.clear() });
await registerRefreshRoutes(app, { onDashboardMutated: () => dashboardCache.clear() });
await registerNotificationRoutes(app);
await registerWebhookRoutes(app, { onDashboardMutated: () => dashboardCache.clear() });

app.get("/health", async (_request, reply) => {
  try {
    await pingDatabase();
    await ensureMigrationReady();
    const [worker, jobQueue] = await Promise.all([getWorkerHealth(), getJobQueueHealth()]);
    const profile = loadRepoProfile();
    const access = apiAccessHealthFromConfig(profile, process.env);
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
    const status = apiHealthStatus({ worker, jobQueue, operational, operationalError, access });
    const findings = apiHealthFindings({ worker, jobQueue, operational, operationalError, access });
    return reply.status(apiHealthHttpStatus(status)).send({
      status,
      database: "connected",
      findings,
      access,
      worker,
      jobQueue,
      operational,
      operationalError,
      migration: {
        status: startupMigrationError ? "failed" : "ok",
        error: publicStartupMigrationError(startupMigrationError)
      },
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    app.log.error({ error }, "health check failed");
    return reply.status(apiHealthHttpStatus("unhealthy")).send({
      status: "unhealthy",
      database: "disconnected",
      migration: {
        status: startupMigrationError ? "failed" : "unknown",
        error: publicStartupMigrationError(startupMigrationError)
      },
      generatedAt: new Date().toISOString()
    });
  }
});

app.get("/api/dashboard", async (request, reply) => {
  try {
    const profile = loadRepoProfile();
    const hasSessionCookie = readCookieValue(request.headers.cookie, sessionCookieName) !== null;
    let session: Awaited<ReturnType<typeof getSessionRecordFromRequest>>;
    try {
      session = await getSessionRecordFromRequest(request, reply);
    } catch (error) {
      if (hasSessionCookie) {
        throw error;
      }
      session = null;
    }
    const viewer = {
      authenticated: Boolean(session),
      userId: session?.userId ?? null
    };
    const access = dashboardReadAccess(profile, viewer);
    if (!access.allowed) {
      return reply.status(access.statusCode).send(access.payload);
    }
    const ifNoneMatchHeader = request.headers["if-none-match"];
    const ifNoneMatch = Array.isArray(ifNoneMatchHeader) ? ifNoneMatchHeader.join(",") : ifNoneMatchHeader;
    let repoId: number | null = null;
    const resolveRepoId = async (): Promise<number> => {
      if (repoId !== null) {
        return repoId;
      }
      await ensureMigrationReady();
      repoId = (await getRepoId(profile.key)) ?? (await upsertRepoProfile(profile));
      return repoId;
    };
    const result = await dashboardCache.get({
      profile,
      viewer,
      ifNoneMatch,
      loadVersion: async () => {
        try {
          return await getDashboardDataVersion(await resolveRepoId());
        } catch (error) {
          app.log.warn({ error, repoKey: profile.key }, "dashboard data version query failed");
          throw error;
        }
      },
      buildSummary: async () => getDashboardSummary(profile, await resolveRepoId(), viewer)
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
    return reply.status(500).send(dashboardQueryFailurePayload());
  }
});

app.get("/api/profile", async () => {
  const profile = loadRepoProfile();
  return publicRepoProfileView(profile);
});

try {
  await runMigration("startup");
} catch {
  app.log.warn("API is starting without a ready database; /health will report unhealthy until MatrixOne recovers.");
}

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
