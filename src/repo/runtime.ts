import { getRequestUser } from "../context/request.js";
import { usePerUserGitHubStorage } from "../auth/connect-github.js";
import {
  loadAppSettings,
  resolveCommitBrand,
  type RepoSettings,
} from "../settings/store.js";

/** Repo + token for the current request (signed-in user or legacy settings). */
export function activeRepoSettings(): RepoSettings {
  const app = loadAppSettings();
  const user = getRequestUser();
  const brand = resolveCommitBrand(app.repo);
  if (user) {
    return {
      ...app.repo,
      gitToken: user.gitToken,
      remoteUrl: user.repo.remoteUrl,
      branch: user.repo.branch || "main",
      githubRepoFullName: user.repo.githubRepoFullName,
      pushOnApprove: user.repo.pushOnApprove,
      githubLogin: user.login,
      gitAuthorName: brand.name,
      gitAuthorEmail: brand.email,
    };
  }
  if (usePerUserGitHubStorage()) {
    return {
      ...app.repo,
      gitToken: "",
      remoteUrl: "",
      branch: "main",
      githubRepoFullName: "",
      pushOnApprove: false,
      githubLogin: "",
      gitAuthorName: brand.name,
      gitAuthorEmail: brand.email,
    };
  }
  return app.repo;
}

export function usesActiveRemoteRepo(): boolean {
  const r = activeRepoSettings();
  return Boolean(r.remoteUrl.trim() || r.githubRepoFullName.trim());
}
