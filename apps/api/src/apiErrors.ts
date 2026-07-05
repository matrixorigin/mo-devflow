export interface ApiErrorPayload {
  error: string;
  message: string;
}

export function dashboardQueryFailurePayload(): ApiErrorPayload {
  return {
    error: "dashboard_query_failed",
    message:
      "Dashboard data is unavailable because the API could not read the local cache. Check /health, API logs, and MO_DEVFLOW_DB_* configuration."
  };
}

export function dashboardLoginRequiredPayload(): ApiErrorPayload {
  return {
    error: "dashboard_login_required",
    message: "This repository profile does not allow anonymous dashboard reads. Sign in with GitHub to view cached data."
  };
}

export function publicStartupMigrationError(error: string | null): string | null {
  if (!error) {
    return null;
  }
  return "Database migration is not ready. Check API logs and MatrixOne connection configuration.";
}
