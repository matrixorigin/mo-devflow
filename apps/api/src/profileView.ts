import { repoProfileConfigurationStatus, type RepoProfile } from "@mo-devflow/shared";

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
    configuration: repoProfileConfigurationStatus(profile, process.env)
  };
}
