import { hasGitHubConnectClientId } from "./github-client-id.js";
import { isGitHubOAuthConfigured } from "./github-oauth.js";
import { setSessionCookie } from "./session.js";
import { updateUser } from "./users.js";
import { githubNoreplyEmail, type GitHubUserPublic } from "../repo/github.js";

import type { Context } from "hono";
import {
  DEFAULT_COMMIT_BRAND_NAME,
  loadAppSettings,
  resolveCommitBrand,
  updateAppSettings,
} from "../settings/store.js";

/** Device flow or web OAuth client id → per-user tokens and workspaces. */
export function usePerUserGitHubStorage(): boolean {
  return isGitHubOAuthConfigured() || hasGitHubConnectClientId();
}

export function persistGitHubConnection(
  c: Context,
  user: GitHubUserPublic,
  accessToken: string,
): void {
  if (usePerUserGitHubStorage()) {
    updateUser(user.login, {
      githubId: user.id,
      gitToken: accessToken,
    });
    setSessionCookie(c, user.login);
    return;
  }

  const settings = loadAppSettings();
  const botEmail = githubNoreplyEmail(user.id, user.login);
  const brand = resolveCommitBrand(settings.repo);
  updateAppSettings({
    repo: {
      gitToken: accessToken,
      githubLogin: user.login,
      gitAuthorName: brand.name || DEFAULT_COMMIT_BRAND_NAME,
      gitAuthorEmail: brand.email || botEmail,
    },
  });
}
