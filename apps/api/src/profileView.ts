import type { RepoProfile } from "@mo-devflow/shared";

export function publicRepoProfileView(profile: RepoProfile) {
  return {
    key: profile.key,
    repo: {
      owner: profile.repo.owner,
      name: profile.repo.name
    },
    reporting: profile.reporting,
    access: {
      anonymousRead: profile.access.anonymousRead,
      criticalScope: profile.access.criticalScope,
      writeBackEnabled: profile.access.writeBackEnabled,
      userTokenPrivateDataProtected: !profile.access.exposeUserTokenSyncedPrivateData
    },
    labels: profile.labels,
    thresholds: profile.thresholds,
    configuration: {
      localCheckoutConfigured: Boolean(profile.repo.localPath),
      watchedUsersConfigured: profile.people.watchedUsers.length > 0,
      watchedUserCount: profile.people.watchedUsers.length,
      testersConfigured: profile.people.testers.length > 0,
      testerCount: profile.people.testers.length,
      workflowSkipUsersConfigured: profile.workflow.skipUsers.length > 0,
      workflowSkipUserCount: profile.workflow.skipUsers.length,
      notificationEmployeesConfigured: Object.keys(profile.notifications.employees).length > 0,
      notificationEmployeeCount: Object.keys(profile.notifications.employees).length
    }
  };
}
