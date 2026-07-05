import type { DashboardViewer } from "@mo-devflow/db";
import type { RepoProfile } from "@mo-devflow/shared";
import { dashboardLoginRequiredPayload, type ApiErrorPayload } from "./apiErrors";

export type DashboardReadAccess =
  | { allowed: true }
  | { allowed: false; statusCode: 401; payload: ApiErrorPayload };

export function dashboardReadAccess(profile: RepoProfile, viewer: DashboardViewer): DashboardReadAccess {
  if (!viewer.authenticated && !profile.access.anonymousRead) {
    return {
      allowed: false,
      statusCode: 401,
      payload: dashboardLoginRequiredPayload()
    };
  }
  return { allowed: true };
}
