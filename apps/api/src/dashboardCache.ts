import type { DashboardViewer } from "@mo-devflow/db";
import type { DashboardSummary, RepoProfile } from "@mo-devflow/shared";
import { createHash } from "node:crypto";

export type DashboardCacheStatus = "miss" | "hit" | "stale-if-error" | "not-modified";

interface DashboardCacheEntry {
  etag: string;
  expiresAt: number;
  summary: DashboardSummary;
  version: string;
}

export interface DashboardCacheResult {
  etag: string;
  status: DashboardCacheStatus;
  summary: DashboardSummary | null;
  version: string;
}

export interface DashboardCacheRequest {
  buildSummary: () => Promise<DashboardSummary>;
  ifNoneMatch?: string | null;
  loadVersion: () => Promise<string>;
  profile: RepoProfile;
  viewer: DashboardViewer;
}

export function dashboardCacheTtlMsFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.MO_DEVFLOW_DASHBOARD_CACHE_SECONDS?.trim();
  if (!raw) {
    return 15_000;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 15_000;
  }
  return Math.round(seconds * 1000);
}

export function createDashboardSummaryCache(options: { now?: () => number; ttlMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = Math.max(0, options.ttlMs ?? 15_000);
  const entries = new Map<string, DashboardCacheEntry>();
  const pendingBuilds = new Map<string, Promise<DashboardSummary>>();

  return {
    clear() {
      entries.clear();
    },

    async get(request: DashboardCacheRequest): Promise<DashboardCacheResult> {
      const key = dashboardCacheKey(request.profile, request.viewer);
      const cached = entries.get(key) ?? null;
      let version: string;
      try {
        version = await request.loadVersion();
      } catch (error) {
        if (cached) {
          return {
            etag: cached.etag,
            status: "stale-if-error",
            summary: cached.summary,
            version: cached.version
          };
        }
        throw error;
      }

      const etag = dashboardEtag(key, version);
      const freshCached = cached && cached.version === version && now() < cached.expiresAt ? cached : null;
      if (freshCached) {
        if (etagMatches(request.ifNoneMatch, etag)) {
          return {
            etag,
            status: "not-modified",
            summary: null,
            version
          };
        }
        return {
          etag,
          status: "hit",
          summary: freshCached.summary,
          version
        };
      }

      const pendingKey = `${key}:${version}`;
      const pendingBuild = pendingBuilds.get(pendingKey);
      if (pendingBuild) {
        try {
          const pendingSummary = await pendingBuild;
          if (etagMatches(request.ifNoneMatch, etag)) {
            return {
              etag,
              status: "not-modified",
              summary: null,
              version
            };
          }
          return {
            etag,
            status: "hit",
            summary: pendingSummary,
            version
          };
        } catch (error) {
          if (cached) {
            return {
              etag: cached.etag,
              status: "stale-if-error",
              summary: cached.summary,
              version: cached.version
            };
          }
          throw error;
        }
      }

      let summary: DashboardSummary;
      try {
        const build = request.buildSummary();
        pendingBuilds.set(pendingKey, build);
        summary = await build;
      } catch (error) {
        if (cached) {
          return {
            etag: cached.etag,
            status: "stale-if-error",
            summary: cached.summary,
            version: cached.version
          };
        }
        throw error;
      } finally {
        pendingBuilds.delete(pendingKey);
      }
      if (ttlMs > 0) {
        entries.set(key, {
          etag,
          expiresAt: now() + ttlMs,
          summary,
          version
        });
      }
      return {
        etag,
        status: "miss",
        summary,
        version
      };
    }
  };
}

function dashboardCacheKey(profile: RepoProfile, viewer: DashboardViewer): string {
  const viewerKey = viewer.authenticated ? `user:${viewer.userId ?? "unknown"}` : "anonymous";
  return hashJson({
    profile,
    viewer: viewerKey
  });
}

function dashboardEtag(key: string, version: string): string {
  return `"dashboard-${hashJson({ key, version })}"`;
}

function etagMatches(ifNoneMatch: string | null | undefined, etag: string): boolean {
  if (!ifNoneMatch) {
    return false;
  }
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === `W/${etag}`);
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
