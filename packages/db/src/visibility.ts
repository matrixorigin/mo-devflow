import type { RepoProfile, VisibilityClass } from "@mo-devflow/shared";

export interface DashboardViewer {
  authenticated: boolean;
  userId: number | null;
}

export function visibleClassesForDashboard(profile: RepoProfile, viewer: DashboardViewer): VisibilityClass[] {
  if (!viewer.authenticated && !profile.access.anonymousRead) {
    return [];
  }
  if (!viewer.authenticated) {
    return ["anonymous_readable"];
  }
  return viewer.userId === null
    ? ["anonymous_readable", "logged_in_readable"]
    : ["anonymous_readable", "logged_in_readable", "token_owner_only"];
}

export function dashboardVisibilityFilter(
  alias: string,
  profile: RepoProfile,
  viewer: DashboardViewer
): { sql: string; params: number[] } {
  const visibleClasses = visibleClassesForDashboard(profile, viewer);
  const classVisibleWithoutOwner = visibleClasses.filter((value) => value !== "token_owner_only");
  const clauses: string[] = [];
  const params: number[] = [];

  if (classVisibleWithoutOwner.length > 0) {
    clauses.push(`${alias}.visibility_class IN (${visibilityClassListSql(classVisibleWithoutOwner)})`);
  }

  if (visibleClasses.includes("token_owner_only")) {
    if (viewer.userId === null) {
      throw new Error("token_owner_only dashboard visibility requires viewer user id");
    }
    clauses.push(`(${alias}.visibility_class = 'token_owner_only' AND ${alias}.source_user_id = ?)`);
    params.push(viewer.userId);
  }

  if (clauses.length === 0) {
    return { sql: "1 = 0", params: [] };
  }
  return {
    sql: clauses.length === 1 ? (clauses[0] ?? "1 = 0") : `(${clauses.join(" OR ")})`,
    params
  };
}

function visibilityClassListSql(classes: VisibilityClass[]): string {
  return classes.map((value) => `'${value}'`).join(", ");
}
