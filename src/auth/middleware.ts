import type { Context, Next } from "hono";
import {
  ensureUserWorkspace,
  loadUser,
  type UserRecord,
} from "./users.js";
import { getSessionLogin } from "./session.js";
import { isGitHubOAuthConfigured } from "./github-oauth.js";
import { usePerUserGitHubStorage } from "./connect-github.js";
import {
  getRequestUser,
  runWithUserContext,
  type RequestUserContext,
} from "../context/request.js";
import { loadAppSettings } from "../settings/store.js";

export function buildUserContext(user: UserRecord): RequestUserContext {
  const hasRemote = Boolean(user.repo.remoteUrl.trim() || user.repo.githubRepoFullName.trim());
  const workspaceRoot = hasRemote
    ? ensureUserWorkspace(user.login)
    : ensureUserWorkspace(user.login);
  return {
    login: user.login,
    githubId: user.githubId,
    gitToken: user.gitToken,
    repo: user.repo,
    workspaceRoot,
  };
}

export async function attachUserContext(c: Context, next: Next): Promise<Response | void> {
  const login = getSessionLogin(c);
  if (login) {
    const user = loadUser(login);
    if (user?.gitToken) {
      const ctx = buildUserContext(user);
      return runWithUserContext(ctx, () => next());
    }
  }
  await next();
}

export async function requireGitHubSignIn(c: Context, next: Next): Promise<Response | void> {
  if (!usePerUserGitHubStorage()) {
    await next();
    return;
  }
  const path = new URL(c.req.url).pathname;
  if (c.req.method === "GET" && (path === "/repo" || path === "/repo/")) {
    await next();
    return;
  }
  if (getRequestUser()) {
    await next();
    return;
  }
  return c.json(
    {
      error: "Sign in with GitHub first",
      signInUrl: "/auth/github/login",
    },
    401,
  );
}

export function authStatus(c: Context) {
  const oauth = isGitHubOAuthConfigured();
  const login = getSessionLogin(c);
  const user = login ? loadUser(login) : null;
  const app = loadAppSettings();
  return {
    oauthEnabled: oauth,
    signedIn: Boolean(user?.gitToken),
    login: user?.login ?? null,
    repo: user?.repo ?? null,
    commitBrand: {
      name: app.repo.gitAuthorName,
      email: app.repo.gitAuthorEmail,
    },
  };
}
